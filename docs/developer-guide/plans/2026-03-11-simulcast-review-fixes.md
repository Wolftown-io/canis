# Simulcast Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 7 issues found in the PR #361 code review: serde mismatch, listener leak, CHANGELOG honesty, race condition, type safety, encapsulation, and workspace dep hygiene.

**Architecture:** All fixes are surgical patches to existing simulcast code. No new modules. The serde fix (Task 1) touches the most files because `LayerPreference` is used across server + client.

**Tech Stack:** Rust (serde, webrtc-rs), TypeScript/Solid.js, Cargo workspace

---

### Task 1: Flatten LayerPreference enum (serde mismatch)

**Files:**
- Modify: `server/src/voice/track_types.rs:278-287`
- Modify: `server/src/voice/track.rs:54-66` (select_layer)
- Modify: `server/src/voice/track.rs:303` (update_remb call to select_layer)
- Modify: `server/src/voice/track.rs:339` (set_layer_preference call to select_layer)
- Test: `server/src/voice/track.rs` (existing simulcast_tests)

**Step 1: Update LayerPreference enum**

In `server/src/voice/track_types.rs`, replace lines 278-287:

```rust
/// Viewer's layer preference for a specific track.
///
/// Flat enum matching the wire format (`"auto"`, `"high"`, `"medium"`, `"low"`).
/// When not `Auto`, acts as a ceiling: the server may select a lower layer
/// if bandwidth cannot sustain the requested one.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LayerPreference {
    /// Server selects layer based on REMB bandwidth estimate.
    #[default]
    Auto,
    High,
    Medium,
    Low,
}

impl LayerPreference {
    /// Convert to the equivalent [`Layer`], returning `None` for `Auto`.
    #[must_use]
    pub const fn layer(self) -> Option<Layer> {
        match self {
            Self::Auto => None,
            Self::High => Some(Layer::High),
            Self::Medium => Some(Layer::Medium),
            Self::Low => Some(Layer::Low),
        }
    }
}
```

**Step 2: Update select_layer to use flat enum**

In `server/src/voice/track.rs`, replace the `select_layer` function (lines 53-66):

```rust
/// Select the best simulcast layer given a preference and bandwidth estimate.
const fn select_layer(pref: LayerPreference, remb: u64) -> Layer {
    let bandwidth_layer = if remb >= REMB_THRESHOLD_HIGH {
        Layer::High
    } else if remb >= REMB_THRESHOLD_MEDIUM {
        Layer::Medium
    } else {
        Layer::Low
    };

    match pref.layer() {
        Some(ceiling) => layer_min(ceiling, bandwidth_layer),
        None => bandwidth_layer,
    }
}
```

Note: `pref.layer()` is `const fn` so this stays `const fn`.

**Step 3: Update existing tests**

In the `simulcast_tests` module, update tests that use `LayerPreference::Manual(Layer::X)` to use `LayerPreference::X`:

- `LayerPreference::Manual(Layer::Medium)` → `LayerPreference::Medium`
- `LayerPreference::Manual(Layer::High)` → `LayerPreference::High`

**Step 4: Run tests**

Run: `SQLX_OFFLINE=true cargo test -p vc-server -- simulcast layer 2>&1 | tail -15`
Expected: all tests pass

**Step 5: Run clippy**

Run: `SQLX_OFFLINE=true cargo clippy -- -D warnings 2>&1 | tail -5`
Expected: clean

**Step 6: Commit**

```
fix(voice): flatten LayerPreference enum to match wire format
```

---

### Task 2: Fix listener leak in QualityContextMenu

**Files:**
- Modify: `client/src/components/voice/ScreenShareViewer.tsx:354-365`

**Step 1: Fix the setTimeout/onCleanup race**

Replace lines 354-365:

```typescript
  onMount(() => {
    // Delay to avoid the menu being immediately closed by the contextmenu event.
    // Track cleanup state to prevent listener leak if component unmounts
    // before the timeout fires.
    let cleaned = false;
    const addListeners = () => {
      if (cleaned) return;
      window.addEventListener("click", handleClickOutside);
      window.addEventListener("contextmenu", handleClickOutside);
    };
    setTimeout(addListeners, 0);

    onCleanup(() => {
      cleaned = true;
      window.removeEventListener("click", handleClickOutside);
      window.removeEventListener("contextmenu", handleClickOutside);
    });
  });
```

Note: `onCleanup` is moved inside `onMount` so `cleaned` is in scope. In
Solid.js, `onCleanup` called inside `onMount` registers cleanup for that
component's lifecycle — same behavior as before.

**Step 2: Run client tests**

Run: `cd client && bun run test:run 2>&1 | tail -10`
Expected: 541 tests pass

**Step 3: Commit**

```
fix(client): prevent listener leak in quality context menu
```

---

### Task 3: Fix CHANGELOG — REMB is infrastructure only

**Files:**
- Modify: `CHANGELOG.md:31`

**Step 1: Update the CHANGELOG entry**

Replace line 31:

```
- Simulcast video — 3-layer adaptive quality (high/medium/low) for screen shares and webcam, with automatic REMB-based layer selection, manual viewer override via right-click context menu, and quality badge overlay on video tiles
```

With:

```
- Simulcast video — 3-layer adaptive quality (high/medium/low) for screen shares and webcam, with manual viewer override via right-click context menu, quality badge overlay on video tiles, and REMB bandwidth monitoring (automatic layer switching in a follow-up)
```

**Step 2: Commit**

```
fix(voice): clarify CHANGELOG — REMB auto-switching is not yet wired
```

---

### Task 4: Fix race condition — secondary simulcast layers

**Files:**
- Modify: `server/src/voice/track.rs:96-115` (TrackRouter struct + new method)
- Modify: `server/src/voice/sfu.rs:603-611` (is_secondary_simulcast handler)

**Step 1: Add pending secondary layers map to TrackRouter**

In `server/src/voice/track.rs`, add a third field to `TrackRouter`:

```rust
pub struct TrackRouter {
    subscriptions: DashMap<(Uuid, TrackSource), Vec<Subscription>>,
    simulcast_tracks: DashMap<(Uuid, TrackSource, Layer), Arc<TrackRemote>>,
    /// Holds secondary layers (Medium/Low) that arrived before their High layer.
    /// Key: (user_id, layer), Value: remote track.
    /// Drained when the High layer's source_type is resolved.
    pending_secondary: DashMap<(Uuid, Layer), Arc<TrackRemote>>,
}
```

Update `TrackRouter::new()` to initialize the new field.

**Step 2: Add `store_simulcast_track` method (also fixes encapsulation — Task 6)**

```rust
/// Store a simulcast track and drain any pending secondary layers.
///
/// When the High layer arrives first, secondary entries don't exist yet — nothing
/// to drain. When a secondary layer arrives first, it is stashed in
/// `pending_secondary`. When High then arrives, this method drains and stores
/// those pending entries under the now-known `source_type`.
pub fn store_simulcast_track(
    &self,
    user_id: Uuid,
    source_type: TrackSource,
    layer: Layer,
    track: Arc<TrackRemote>,
) {
    self.simulcast_tracks
        .insert((user_id, source_type, layer), track);

    // If this is the High layer, drain any pending secondaries for this user.
    if layer == Layer::High {
        for pending_layer in [Layer::Medium, Layer::Low] {
            if let Some((_, pending_track)) =
                self.pending_secondary.remove(&(user_id, pending_layer))
            {
                self.simulcast_tracks.insert(
                    (user_id, source_type, pending_layer),
                    pending_track,
                );
                tracing::debug!(
                    source = %user_id,
                    source_type = ?source_type,
                    layer = ?pending_layer,
                    "Drained pending secondary simulcast track"
                );
            }
        }
    }
}

/// Stash a secondary simulcast layer that arrived before the High layer.
pub fn stash_pending_secondary(
    &self,
    user_id: Uuid,
    layer: Layer,
    track: Arc<TrackRemote>,
) {
    self.pending_secondary.insert((user_id, layer), track);
    tracing::debug!(
        source = %user_id,
        layer = ?layer,
        "Stashed pending secondary simulcast track (High not yet received)"
    );
}
```

**Step 3: Update sfu.rs on_track handler**

Replace the `is_secondary_simulcast` block (lines 603-631 and 634-644):

```rust
let is_secondary_simulcast = !rid.is_empty()
    && layer != Layer::High
    && track.kind() == RTPCodecType::Video;

let source_type = if is_secondary_simulcast {
    // Secondary layer: look up source type from the High layer.
    match room.track_router.find_source_type_for_user(uid, Layer::High) {
        Some(st) => st,
        None => {
            // High layer hasn't arrived yet — stash and skip forwarding.
            // When High arrives, store_simulcast_track will drain this.
            room.track_router.stash_pending_secondary(uid, layer, track.clone());
            return;
        }
    }
} else {
    // ... existing audio/video source resolution (unchanged) ...
};

// Store in simulcast_tracks (drains pending secondaries if this is High).
let is_simulcast = !rid.is_empty() && source_type.is_video();
if is_simulcast {
    room.track_router.store_simulcast_track(uid, source_type, layer, track.clone());
    debug!(
        source = %uid,
        source_type = ?source_type,
        layer = ?layer,
        "Stored simulcast track"
    );
}
```

Note: When a secondary layer is stashed and returns early, no RTP forwarder
is spawned. That layer's packets are dropped until the High layer resolves it.
This is acceptable — the server defaults to High anyway, and the brief gap is
invisible compared to the connection setup latency.

**Step 4: Run tests and clippy**

Run: `SQLX_OFFLINE=true cargo test -p vc-server -- simulcast layer 2>&1 | tail -15`
Run: `SQLX_OFFLINE=true cargo clippy -- -D warnings 2>&1 | tail -5`
Expected: pass

**Step 5: Commit**

```
fix(voice): handle secondary simulcast layers arriving before High
```

---

### Task 5: Type handleVoiceLayerChanged (event: any)

**Files:**
- Modify: `client/src/stores/websocket.ts:1934`

**Step 1: Replace `any` with typed parameter**

Replace:

```typescript
async function handleVoiceLayerChanged(event: any): Promise<void> {
```

With:

```typescript
async function handleVoiceLayerChanged(event: {
  source_user_id: string;
  track_source: string;
  active_layer: "high" | "medium" | "low";
}): Promise<void> {
```

**Step 2: Run TypeScript check**

Run: `cd client && bun tsc --noEmit 2>&1 | grep "error TS" | head -5`
Expected: no new errors

**Step 3: Commit**

```
fix(client): type handleVoiceLayerChanged parameter
```

---

### Task 6: Make simulcast_tracks private (encapsulation)

This is handled within Task 4 (`store_simulcast_track` method). The
remaining change is to remove the `pub` visibility.

**Files:**
- Modify: `server/src/voice/track.rs:106`

**Step 1: Remove `pub` from simulcast_tracks**

Change:

```rust
pub simulcast_tracks: DashMap<(Uuid, TrackSource, Layer), Arc<TrackRemote>>,
```

To:

```rust
simulcast_tracks: DashMap<(Uuid, TrackSource, Layer), Arc<TrackRemote>>,
```

Verify that `sfu.rs` no longer accesses the field directly (should use
`store_simulcast_track` from Task 4).

**Step 2: Run clippy**

Run: `SQLX_OFFLINE=true cargo clippy -- -D warnings 2>&1 | tail -5`
Expected: clean

**Step 3: Commit**

```
refactor(voice): make simulcast_tracks private
```

---

### Task 7: Move smol_str to workspace dependencies

**Files:**
- Modify: `Cargo.toml` (root workspace)
- Modify: `client/src-tauri/Cargo.toml`

**Step 1: Add smol_str to workspace**

In root `Cargo.toml`, under `[workspace.dependencies]`, add after an
appropriate section (e.g. after the WebRTC section around line 37):

```toml
smol_str = "0.2"
```

**Step 2: Update client Cargo.toml**

In `client/src-tauri/Cargo.toml`, replace:

```toml
smol_str = "0.2"
```

With:

```toml
smol_str.workspace = true
```

**Step 3: Verify build**

Run: `SQLX_OFFLINE=true cargo clippy -p vc-client -- -D warnings 2>&1 | tail -5`
Expected: clean

**Step 4: Commit**

```
chore(infra): move smol_str to workspace dependencies
```
