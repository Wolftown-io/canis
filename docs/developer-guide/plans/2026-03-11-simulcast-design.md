# Simulcast Design

**Date:** 2026-03-11
**Phase:** 6 (Expansion)
**Scope:** 3-layer simulcast for all video tracks (screen share + future webcam)

## Goal

Enable per-viewer adaptive video quality so viewers on slow connections
receive a lower-resolution stream instead of stuttering, while viewers on
fast connections get full quality. Reduces server egress bandwidth.

## Architecture

The sender encodes 3 simultaneous layers (high/medium/low) using WebRTC
native simulcast via `RTCRtpEncodingParameters`. The SFU receives all 3
layers as separate RTP streams (identified by RID) and forwards only the
appropriate layer to each viewer. Layer selection is server-driven via
REMB bandwidth estimation, with manual viewer override.

```
Sender -> [3 RTP streams: h/m/l] -> SFU -> [1 RTP stream per viewer] -> Viewer
```

The SFU never transcodes — it selects and forwards. CPU cost is on the
sender (3x encode), mitigated by lower layers being significantly reduced
resolution. Audio remains single-layer Opus (already efficient at ~48kbps
with in-band FEC).

**Library:** webrtc-rs (current). str0m migration is a v2 concern.

## Simulcast Layers

| Layer | RID | Scale | FPS | Target Bitrate | Use Case |
|-------|-----|-------|-----|----------------|----------|
| High | `h` | 1x (sender quality) | 30 | 2-6 Mbps | Focused/fullscreen viewer |
| Medium | `m` | 1/2 resolution | 24 | 500-1000 kbps | Grid view, small tiles |
| Low | `l` | 1/4 resolution | 15 | 150-300 kbps | Minimized, background, constrained |

The high layer's bitrate follows the sender's existing quality tier
selection (Low/Medium/High/Premium). Medium and low layers use fixed
bitrates since they are already scaled down.

## Server-Side Layer Selection

### Automatic mode (default)

Server tracks each viewer's bandwidth via REMB feedback. Thresholds:

- REMB > 1.5 Mbps -> High
- REMB 400 kbps - 1.5 Mbps -> Medium
- REMB < 400 kbps -> Low

**Hysteresis:** Downgrade is immediate (protect viewer experience).
Upgrade requires 3 seconds of sustained bandwidth above threshold
(prevent flapping).

### Manual override

Viewer sends a `VoiceSetLayerPreference` message specifying a preferred
layer for a specific track. Server honors it as a **ceiling** — if
bandwidth cannot sustain the requested layer, it still drops down.

## Client-Side Changes

### Sender (browser + Tauri)

When starting a video track (screen share or webcam), configure 3
encodings on the transceiver:

```typescript
const encodings = [
  { rid: "h", maxBitrate: highBitrate, scaleResolutionDownBy: 1.0, maxFramerate: 30 },
  { rid: "m", maxBitrate: 800_000, scaleResolutionDownBy: 2.0, maxFramerate: 24 },
  { rid: "l", maxBitrate: 200_000, scaleResolutionDownBy: 4.0, maxFramerate: 15 },
];
```

`highBitrate` comes from the existing quality tier (Low/Medium/High/Premium).

### Viewer UI

- Quality indicator badge on video tiles showing current layer
  (e.g. "720p", "360p", "Auto")
- Right-click context menu on video tiles: "Video Quality" ->
  Auto / High / Medium / Low
- Default is "Auto" (server-driven)

## WebSocket Signaling

### Client -> Server

```json
{
  "type": "voice_set_layer_preference",
  "target_user_id": "...",
  "track_source": "screen_video:<uuid>",
  "preferred_layer": "high" | "medium" | "low" | "auto"
}
```

### Server -> Client (informational)

```json
{
  "type": "voice_layer_changed",
  "source_user_id": "...",
  "track_source": "screen_video:<uuid>",
  "active_layer": "high" | "medium" | "low"
}
```

## Server-Side SFU Changes

### Subscription model (track.rs)

```rust
enum LayerPreference {
    Auto,
    Manual(Layer),
}

enum Layer {
    High,
    Medium,
    Low,
}

struct Subscription {
    local_track: Arc<TrackLocalStaticRTP>,
    preferred_layer: LayerPreference,
    active_layer: Layer,
    remb_estimate: u64,         // Last REMB value in bps
    last_layer_change: Instant, // Hysteresis tracking
}
```

### RID parsing

When the SFU receives an `on_track` callback, it reads the RID from the
`TrackRemote`. Each sender produces 3 tracks per video source (one per
RID). The SFU stores all 3 and selects per-subscriber.

### REMB handling

Register an `on_remb` callback on each peer's receiver. Update the
subscriber's `remb_estimate` and trigger layer re-evaluation. Apply
3-second hysteresis before upgrading; downgrade is immediate.

### Hot path performance

The `forward_rtp` path adds one RID comparison per packet — negligible
versus the existing DashMap lookup. No extra allocations. Stays within
the <5ms server forwarding budget.

## Testing Strategy

- **Unit tests:** Layer selection logic (REMB thresholds, hysteresis
  timing, manual override ceiling, edge cases at boundary values)
- **Integration tests:** Verify SFU forwards correct RID stream per
  subscriber preference; verify layer switching on REMB changes
- **Client tests:** Verify encoding parameters are set correctly on
  transceiver; verify WS message serialization

No E2E browser tests for simulcast — too brittle with real media.

## Non-Goals (v1)

- str0m migration (v2)
- Audio simulcast (Opus is already efficient)
- SVC (Scalable Video Coding) — requires codec support (AV1 SVC/VP9 SVC)
- Transcoding / server-side re-encoding
