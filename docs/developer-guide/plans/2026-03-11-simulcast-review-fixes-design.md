# Simulcast Review Fixes Design

**Date:** 2026-03-11
**Phase:** 6 (Expansion)
**Scope:** Fix 7 issues identified in PR #361 code review

## Issues and Fixes

### Fix 1: CHANGELOG honesty — REMB is infrastructure only

`spawn_rtcp_reader` logs REMB but never calls `update_remb()`. Wiring
real REMB requires SSRC-to-subscriber mapping. Update the CHANGELOG to
accurately describe what's delivered: manual layer selection works,
REMB monitoring is infrastructure-ready for a follow-up.

### Fix 2: Race condition — secondary layers before High

If Medium/Low `on_track` fires before High,
`find_source_type_for_user(uid, Layer::High)` returns `None` and falls
back to `ScreenVideo(Uuid::nil())`. Fix: store secondary layers in a
temporary pending map. When High arrives and resolves the source type,
drain pending entries and store under the correct key.

### Fix 3: `event: any` type safety

Replace `event: any` in `handleVoiceLayerChanged` with an inline typed
object matching the wire format fields.

### Fix 4: Listener leak in QualityContextMenu

Track cleanup state with a `let cleaned = false` flag. In `onCleanup`,
set it to `true`. In the `setTimeout` callback, check the flag before
adding listeners.

### Fix 5: LayerPreference serde mismatch

`Manual(Layer::High)` serializes as `{"manual":"high"}` but the client
sends `"high"`. Flatten the enum to `Auto | High | Medium | Low` with
a `layer()` method. This matches the wire format exactly.

### Fix 6: `pub simulcast_tracks` encapsulation

Make the field private. Add a `store_simulcast_track()` method. Update
`sfu.rs` to use the method.

### Fix 7: `smol_str` workspace dependency

Move `smol_str = "0.2"` to root `Cargo.toml` `[workspace.dependencies]`.
Change `client/src-tauri/Cargo.toml` to `smol_str.workspace = true`.
