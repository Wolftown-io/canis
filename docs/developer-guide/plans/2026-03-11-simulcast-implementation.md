# Simulcast Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 3-layer simulcast (high/medium/low) to all video tracks so the SFU can forward per-viewer quality based on bandwidth.

**Architecture:** Senders encode 3 RTP streams (RID h/m/l) via `RTCRtpEncodingParameters`. The SFU receives all 3, stores them per-source, and forwards only the active layer per subscriber. Layer selection is REMB-driven with manual viewer override. See `docs/developer-guide/plans/2026-03-11-simulcast-design.md`.

**Tech Stack:** Rust (webrtc-rs, tokio), TypeScript/Solid.js, WebSocket signaling

---

### Task 1: Add Layer types to track_types.rs

**Files:**
- Modify: `server/src/voice/track_types.rs`
- Test: `server/src/voice/track_types.rs` (inline tests)

**Step 1: Add Layer and LayerPreference types**

Add after the `TrackSource` impl block (after line ~142):

```rust
/// Simulcast layer identifier, matching the RID sent by the client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Layer {
    High,
    Medium,
    Low,
}

impl Layer {
    /// RID string used in RTP headers.
    pub fn rid(&self) -> &'static str {
        match self {
            Layer::High => "h",
            Layer::Medium => "m",
            Layer::Low => "l",
        }
    }

    /// Parse from RID string.
    pub fn from_rid(rid: &str) -> Option<Self> {
        match rid {
            "h" => Some(Layer::High),
            "m" => Some(Layer::Medium),
            "l" => Some(Layer::Low),
            _ => None,
        }
    }

    /// Target bitrate for this layer (bps).
    pub fn target_bitrate(&self) -> u64 {
        match self {
            Layer::High => 4_000_000,   // Sender's quality tier overrides this
            Layer::Medium => 800_000,
            Layer::Low => 200_000,
        }
    }
}

/// Viewer's layer preference for a specific track.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LayerPreference {
    /// Server selects layer based on REMB bandwidth estimate.
    Auto,
    /// Viewer requested a specific layer (used as ceiling).
    Manual(Layer),
}

impl Default for LayerPreference {
    fn default() -> Self {
        LayerPreference::Auto
    }
}
```

**Step 2: Write tests**

Add a `#[cfg(test)]` module at the end of the file:

```rust
#[cfg(test)]
mod layer_tests {
    use super::*;

    #[test]
    fn test_layer_rid_roundtrip() {
        assert_eq!(Layer::from_rid("h"), Some(Layer::High));
        assert_eq!(Layer::from_rid("m"), Some(Layer::Medium));
        assert_eq!(Layer::from_rid("l"), Some(Layer::Low));
        assert_eq!(Layer::from_rid("x"), None);
    }

    #[test]
    fn test_layer_rid_string() {
        assert_eq!(Layer::High.rid(), "h");
        assert_eq!(Layer::Medium.rid(), "m");
        assert_eq!(Layer::Low.rid(), "l");
    }

    #[test]
    fn test_layer_preference_default() {
        assert_eq!(LayerPreference::default(), LayerPreference::Auto);
    }
}
```

**Step 3: Run tests**

Run: `cargo test -p vc-server layer_tests -- --nocapture 2>&1 | tail -10`
Expected: 3 tests pass

**Step 4: Commit**

```
feat(voice): add Layer and LayerPreference types for simulcast
```

---

### Task 2: Update Subscription struct and layer selection logic in track.rs

**Files:**
- Modify: `server/src/voice/track.rs:21-28` (Subscription struct)
- Modify: `server/src/voice/track.rs:34-38` (TrackRouter struct)
- Modify: `server/src/voice/track.rs:100-122` (forward_rtp)
- Test: `server/src/voice/track.rs` (inline tests)

**Step 1: Write unit tests for layer selection**

Add at the end of the file:

```rust
#[cfg(test)]
mod simulcast_tests {
    use super::*;
    use crate::voice::track_types::{Layer, LayerPreference};
    use std::time::{Duration, Instant};

    const REMB_HIGH: u64 = 2_000_000;
    const REMB_MED: u64 = 800_000;
    const REMB_LOW: u64 = 200_000;

    #[test]
    fn test_select_layer_auto_high_bandwidth() {
        let layer = select_layer(LayerPreference::Auto, REMB_HIGH);
        assert_eq!(layer, Layer::High);
    }

    #[test]
    fn test_select_layer_auto_medium_bandwidth() {
        let layer = select_layer(LayerPreference::Auto, REMB_MED);
        assert_eq!(layer, Layer::Medium);
    }

    #[test]
    fn test_select_layer_auto_low_bandwidth() {
        let layer = select_layer(LayerPreference::Auto, REMB_LOW);
        assert_eq!(layer, Layer::Low);
    }

    #[test]
    fn test_select_layer_manual_acts_as_ceiling() {
        // Manual(Medium) with enough bandwidth for High -> Medium
        let layer = select_layer(LayerPreference::Manual(Layer::Medium), REMB_HIGH);
        assert_eq!(layer, Layer::Medium);
    }

    #[test]
    fn test_select_layer_manual_drops_below_ceiling() {
        // Manual(High) but only enough bandwidth for Low -> Low
        let layer = select_layer(LayerPreference::Manual(Layer::High), REMB_LOW);
        assert_eq!(layer, Layer::Low);
    }

    #[test]
    fn test_hysteresis_prevents_immediate_upgrade() {
        let now = Instant::now();
        let recent = now - Duration::from_secs(1); // 1s ago, within 3s window
        assert!(!should_upgrade(Layer::Medium, Layer::High, recent));
    }

    #[test]
    fn test_hysteresis_allows_upgrade_after_delay() {
        let now = Instant::now();
        let old = now - Duration::from_secs(4); // 4s ago, past 3s window
        assert!(should_upgrade(Layer::Medium, Layer::High, old));
    }

    #[test]
    fn test_downgrade_is_immediate() {
        let now = Instant::now();
        let recent = now - Duration::from_millis(100); // very recent
        // Downgrade should always be allowed
        assert!(should_downgrade(Layer::High, Layer::Low));
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cargo test -p vc-server simulcast_tests -- --nocapture 2>&1 | tail -15`
Expected: FAIL — functions not defined

**Step 3: Update Subscription struct**

Replace the existing `Subscription` struct (lines 21-28) with:

```rust
#[derive(Clone)]
struct Subscription {
    /// The subscriber's user ID.
    subscriber_id: Uuid,
    /// The local track that forwards to the subscriber.
    local_track: Arc<TrackLocalStaticRTP>,
    /// Viewer's layer preference (Auto or Manual ceiling).
    preferred_layer: LayerPreference,
    /// Currently active layer being forwarded.
    active_layer: Layer,
    /// Last REMB bandwidth estimate in bps.
    remb_estimate: u64,
    /// Timestamp of last layer change (for hysteresis).
    last_layer_change: Instant,
}
```

**Step 4: Add simulcast track storage to TrackRouter**

Update the `TrackRouter` struct (lines 34-38) to add a second DashMap for
storing the 3 RID tracks per source:

```rust
pub struct TrackRouter {
    /// Map: `(source_user_id, source_type)` -> list of subscriptions
    subscriptions: DashMap<(Uuid, TrackSource), Vec<Subscription>>,
    /// Simulcast layers: `(source_user_id, source_type, layer)` -> remote track
    simulcast_tracks: DashMap<(Uuid, TrackSource, Layer), Arc<TrackRemote>>,
}
```

Update `TrackRouter::new()` to initialize the new map.

**Step 5: Implement layer selection functions**

Add as free functions or `impl TrackRouter` methods:

```rust
/// REMB thresholds for automatic layer selection.
const REMB_THRESHOLD_HIGH: u64 = 1_500_000;
const REMB_THRESHOLD_MEDIUM: u64 = 400_000;
/// Hysteresis delay before upgrading layer.
const UPGRADE_HYSTERESIS: Duration = Duration::from_secs(3);

/// Select the best layer given preference and bandwidth.
fn select_layer(pref: LayerPreference, remb: u64) -> Layer {
    let bandwidth_layer = if remb >= REMB_THRESHOLD_HIGH {
        Layer::High
    } else if remb >= REMB_THRESHOLD_MEDIUM {
        Layer::Medium
    } else {
        Layer::Low
    };

    match pref {
        LayerPreference::Auto => bandwidth_layer,
        LayerPreference::Manual(ceiling) => {
            // Manual acts as ceiling: pick min(ceiling, bandwidth_layer)
            layer_min(ceiling, bandwidth_layer)
        }
    }
}

/// Return the lower of two layers (High > Medium > Low).
fn layer_min(a: Layer, b: Layer) -> Layer {
    let order = |l: &Layer| match l {
        Layer::High => 2,
        Layer::Medium => 1,
        Layer::Low => 0,
    };
    if order(&a) <= order(&b) { a } else { b }
}

/// Whether an upgrade should proceed (checks hysteresis).
fn should_upgrade(current: Layer, target: Layer, last_change: Instant) -> bool {
    let order = |l: &Layer| match l {
        Layer::High => 2,
        Layer::Medium => 1,
        Layer::Low => 0,
    };
    order(&target) > order(&current) && last_change.elapsed() >= UPGRADE_HYSTERESIS
}

/// Whether a downgrade should proceed (always immediate).
fn should_downgrade(current: Layer, target: Layer) -> bool {
    let order = |l: &Layer| match l {
        Layer::High => 2,
        Layer::Medium => 1,
        Layer::Low => 0,
    };
    order(&target) < order(&current)
}
```

**Step 6: Update forward_rtp to filter by active layer**

The `forward_rtp` method needs a new `layer: Layer` parameter. Only
forward to subscribers whose `active_layer` matches:

```rust
pub async fn forward_rtp(
    &self,
    source_user_id: Uuid,
    source_type: TrackSource,
    layer: Layer,
    rtp_packet: &RtpPacket,
) {
    let key = (source_user_id, source_type);
    if let Some(subs) = self.subscriptions.get(&key) {
        for sub in subs.iter() {
            if sub.active_layer == layer {
                if let Err(e) = sub.local_track.write_rtp(rtp_packet).await {
                    tracing::warn!(
                        subscriber = %sub.subscriber_id,
                        error = %e,
                        "Failed to forward RTP"
                    );
                }
            }
        }
    }
}
```

**Step 7: Add methods for REMB updates and layer preference**

```rust
impl TrackRouter {
    /// Update a subscriber's REMB estimate and re-evaluate active layer.
    pub fn update_remb(
        &self,
        subscriber_id: Uuid,
        source_user_id: Uuid,
        source_type: TrackSource,
        remb_bps: u64,
    ) -> Option<Layer> {
        let key = (source_user_id, source_type);
        let mut changed = None;
        if let Some(mut subs) = self.subscriptions.get_mut(&key) {
            for sub in subs.iter_mut() {
                if sub.subscriber_id == subscriber_id {
                    sub.remb_estimate = remb_bps;
                    let target = select_layer(sub.preferred_layer, remb_bps);
                    if target != sub.active_layer {
                        let switch = if should_downgrade(sub.active_layer, target) {
                            true
                        } else {
                            should_upgrade(sub.active_layer, target, sub.last_layer_change)
                        };
                        if switch {
                            sub.active_layer = target;
                            sub.last_layer_change = Instant::now();
                            changed = Some(target);
                        }
                    }
                }
            }
        }
        changed
    }

    /// Set a subscriber's layer preference for a specific track.
    pub fn set_layer_preference(
        &self,
        subscriber_id: Uuid,
        source_user_id: Uuid,
        source_type: TrackSource,
        pref: LayerPreference,
    ) -> Option<Layer> {
        let key = (source_user_id, source_type);
        let mut changed = None;
        if let Some(mut subs) = self.subscriptions.get_mut(&key) {
            for sub in subs.iter_mut() {
                if sub.subscriber_id == subscriber_id {
                    sub.preferred_layer = pref;
                    let target = select_layer(pref, sub.remb_estimate);
                    if target != sub.active_layer {
                        sub.active_layer = target;
                        sub.last_layer_change = Instant::now();
                        changed = Some(target);
                    }
                }
            }
        }
        changed
    }
}
```

**Step 8: Update create_subscriber_track to initialize new fields**

In `create_subscriber_track` (~line 51), update the `Subscription` construction:

```rust
Subscription {
    subscriber_id,
    local_track: local_track.clone(),
    preferred_layer: LayerPreference::Auto,
    active_layer: Layer::High, // Start at highest, REMB will adjust
    remb_estimate: u64::MAX,   // Assume good bandwidth until REMB arrives
    last_layer_change: Instant::now(),
}
```

**Step 9: Run tests**

Run: `cargo test -p vc-server simulcast_tests -- --nocapture 2>&1 | tail -15`
Expected: all 8 tests pass

**Step 10: Commit**

```
feat(voice): simulcast subscription model and layer selection logic
```

---

### Task 3: SFU on_track RID parsing and REMB callback

**Files:**
- Modify: `server/src/voice/sfu.rs:569-647` (on_track callback)
- Modify: `server/src/voice/sfu.rs` (add REMB handler)

**Step 1: Update on_track to parse RID and store simulcast layers**

In the `on_track` callback (line ~569), after receiving a `TrackRemote`,
read its RID to determine the simulcast layer:

```rust
let rid = track.rid().to_string();
let layer = Layer::from_rid(&rid);
```

For video tracks with a recognized RID, store in the simulcast_tracks
map instead of immediately creating subscriber tracks. Only create
subscriber tracks for the first layer received (High), or for audio
tracks (which have no RID / single layer).

For non-simulcast tracks (audio, or video without RID), keep the existing
behavior unchanged.

**Step 2: Update spawn_rtp_forwarder to pass layer**

In the RTP forwarding spawn (called from on_track), pass the parsed
`Layer` to `track_router.forward_rtp()`:

```rust
let layer = Layer::from_rid(&rid).unwrap_or(Layer::High);
// In the forwarding loop:
track_router.forward_rtp(source_user_id, source_type, layer, &rtp_packet).await;
```

**Step 3: Add REMB callback on peer connections**

After creating a peer connection in `create_peer()` (~line 503), register
a REMB interceptor or use `on_track`'s RTCP reader. webrtc-rs exposes
REMB via RTCP packets on the `TrackRemote`'s RTCP reader:

```rust
// In the RTP forwarder task, also read RTCP:
let rtcp_reader = track.clone();
tokio::spawn(async move {
    let mut buf = vec![0u8; 1500];
    loop {
        match rtcp_reader.read_rtcp().await {
            Ok((packets, _)) => {
                for pkt in &packets {
                    if let Some(remb) = pkt.as_any().downcast_ref::<webrtc::rtcp::receiver_estimated_maximum_bitrate::ReceiverEstimatedMaximumBitrate>() {
                        let bitrate = remb.bitrate as u64;
                        // Update subscriber layer via track_router
                        if let Some(new_layer) = track_router.update_remb(
                            subscriber_id, source_user_id, source_type, bitrate
                        ) {
                            // Send VoiceLayerChanged event
                            let _ = signal_tx.send(ServerEvent::VoiceLayerChanged {
                                channel_id,
                                source_user_id,
                                track_source: source_type.to_string(),
                                active_layer: new_layer,
                            }).await;
                        }
                    }
                }
            }
            Err(_) => break,
        }
    }
});
```

**Step 4: Commit**

```
feat(voice): SFU RID parsing and REMB-driven layer switching
```

---

### Task 4: WebSocket signaling — new events

**Files:**
- Modify: `server/src/ws/mod.rs` (ClientEvent + ServerEvent enums)
- Modify: `server/src/voice/ws_handler.rs` (handle new client event)

**Step 1: Add VoiceSetLayerPreference to ClientEvent**

In `server/src/ws/mod.rs`, add to the `ClientEvent` enum after the
existing voice events (~line 217):

```rust
VoiceSetLayerPreference {
    channel_id: Uuid,
    target_user_id: Uuid,
    track_source: String,
    preferred_layer: LayerPreference,
},
```

**Step 2: Add VoiceLayerChanged to ServerEvent**

In the `ServerEvent` enum (~line 556):

```rust
VoiceLayerChanged {
    channel_id: Uuid,
    source_user_id: Uuid,
    track_source: String,
    active_layer: Layer,
},
```

**Step 3: Handle VoiceSetLayerPreference in ws_handler**

In `server/src/voice/ws_handler.rs`, add a match arm for the new event.
Parse `track_source` string back into `TrackSource`, call
`track_router.set_layer_preference()`, and if the layer changed, send
`VoiceLayerChanged` back to the requesting client.

**Step 4: Add to Tauri ServerEvent enum**

In `client/src-tauri/src/network/websocket.rs`, add:

```rust
VoiceLayerChanged {
    channel_id: String,
    source_user_id: String,
    track_source: String,
    active_layer: String,
},
```

And in `handle_server_message`:

```rust
ServerEvent::VoiceLayerChanged { .. } => "ws:voice_layer_changed",
```

**Step 5: Commit**

```
feat(ws): add VoiceSetLayerPreference and VoiceLayerChanged events
```

---

### Task 5: Client sender — 3 simulcast encodings (browser)

**Files:**
- Modify: `client/src/lib/webrtc/browser.ts:715-857` (startScreenShare)
- Modify: `client/src/lib/webrtc/browser.ts:921-972` (startWebcam)

**Step 1: Create simulcast encoding helper**

Add a helper function in `browser.ts`:

```typescript
function simulcastEncodings(highBitrate: number): RTCRtpEncodingParameters[] {
  return [
    { rid: "h", maxBitrate: highBitrate, scaleResolutionDownBy: 1.0, maxFramerate: 30 },
    { rid: "m", maxBitrate: 800_000, scaleResolutionDownBy: 2.0, maxFramerate: 24 },
    { rid: "l", maxBitrate: 200_000, scaleResolutionDownBy: 4.0, maxFramerate: 15 },
  ];
}
```

**Step 2: Update screen share to use addTransceiver with simulcast**

Replace the `addTrack` call for video (line ~752) with `addTransceiver`:

```typescript
const transceiver = this.peerConnection.addTransceiver(videoTrack, {
  direction: "sendonly",
  sendEncodings: simulcastEncodings(qualityBitrate),
});
const videoSender = transceiver.sender;
```

Where `qualityBitrate` comes from the existing `Quality` tier's
`max_bitrate` value.

Audio tracks remain single-layer (use `addTrack` as before).

**Step 3: Update webcam to use addTransceiver with simulcast**

Same pattern for webcam (line ~963):

```typescript
const transceiver = this.peerConnection.addTransceiver(videoTrack, {
  direction: "sendonly",
  sendEncodings: simulcastEncodings(qualityBitrate),
});
this.webcamSender = transceiver.sender;
```

**Step 4: Commit**

```
feat(client): send 3 simulcast layers for video tracks
```

---

### Task 6: Client sender — Tauri simulcast

**Files:**
- Modify: `client/src-tauri/src/webrtc/` (Tauri WebRTC setup)

**Step 1: Update Tauri WebRTC track setup**

In the Tauri-side WebRTC code that creates transceivers for screen share
and webcam, configure 3 `RTCRtpEncodingParameters` with RIDs `h`, `m`,
`l` and the same scale/bitrate/framerate values as the browser path.

The exact file depends on how Tauri's webrtc-rs peer connection is set up
— check `client/src-tauri/src/webrtc/` for the `add_track` or
`add_transceiver` calls and update them to pass encoding parameters.

**Step 2: Commit**

```
feat(client): Tauri simulcast encodings for video tracks
```

---

### Task 7: Client viewer UI — quality badge and context menu

**Files:**
- Modify: `client/src/components/voice/ScreenShareViewer.tsx`
- Modify: `client/src/stores/websocket.ts` (handle VoiceLayerChanged)
- Create: `client/src/stores/simulcastLayers.ts`

**Step 1: Create simulcast layer store**

```typescript
import { createStore } from "solid-js/store";

interface LayerState {
  /** Map: "userId:trackSource" -> active layer */
  activeLayers: Record<string, "high" | "medium" | "low">;
  /** Map: "userId:trackSource" -> viewer preference */
  preferences: Record<string, "auto" | "high" | "medium" | "low">;
}

const [layerState, setLayerState] = createStore<LayerState>({
  activeLayers: {},
  preferences: {},
});

export function handleLayerChanged(
  sourceUserId: string,
  trackSource: string,
  activeLayer: "high" | "medium" | "low",
) {
  const key = `${sourceUserId}:${trackSource}`;
  setLayerState("activeLayers", key, activeLayer);
}

export function getActiveLayer(
  sourceUserId: string,
  trackSource: string,
): string {
  const key = `${sourceUserId}:${trackSource}`;
  return layerState.activeLayers[key] ?? "high";
}

export function setLayerPreference(
  sourceUserId: string,
  trackSource: string,
  pref: "auto" | "high" | "medium" | "low",
) {
  const key = `${sourceUserId}:${trackSource}`;
  setLayerState("preferences", key, pref);
}

export { layerState };
```

**Step 2: Handle VoiceLayerChanged in websocket.ts**

Add handler for `voice_layer_changed` event that calls
`handleLayerChanged()`.

**Step 3: Add quality badge to ScreenShareViewer.tsx**

Add a small overlay badge showing the current layer resolution
(e.g. "1080p", "540p", "270p") in the corner of each video tile.
Read from `getActiveLayer()`.

**Step 4: Add quality context menu to video tiles**

Add right-click context menu with options: Auto / High / Medium / Low.
On selection, send `VoiceSetLayerPreference` via WebSocket and update
local preference via `setLayerPreference()`.

**Step 5: Write store tests**

```typescript
describe("simulcastLayers store", () => {
  it("should track active layers", () => {
    handleLayerChanged("user1", "screen_video:uuid", "medium");
    expect(getActiveLayer("user1", "screen_video:uuid")).toBe("medium");
  });

  it("should default to high", () => {
    expect(getActiveLayer("unknown", "screen_video:uuid")).toBe("high");
  });
});
```

**Step 6: Commit**

```
feat(client): simulcast layer store, quality badge, and viewer controls
```

---

### Task 8: CHANGELOG and final verification

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add CHANGELOG entry**

Under `### Added` in `[Unreleased]`:

```
- Simulcast video — 3-layer adaptive quality (high/medium/low) for screen shares and webcam, with automatic REMB-based layer selection and manual viewer override via context menu (#PR_NUMBER)
```

**Step 2: Run server tests**

Run: `cargo test -p vc-server 2>&1 | tail -15`
Expected: all tests pass

**Step 3: Run client tests**

Run: `cd client && bun run test:run 2>&1 | tail -10`
Expected: all tests pass

**Step 4: Run clippy**

Run: `SQLX_OFFLINE=true cargo clippy -- -D warnings 2>&1 | tail -5`
Expected: no warnings

**Step 5: Commit**

```
docs(voice): add simulcast to CHANGELOG
```
