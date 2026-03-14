# Simulcast Auto-Switching Design

**Date:** 2026-03-14

**Goal:** Wire up REMB-based automatic simulcast layer switching so viewers receive the best quality their bandwidth supports, without manual intervention.

**Prerequisite:** 3-layer simulcast (#361) — fully implemented with manual override, quality badges, and dormant `update_remb()` logic.

## Problem

The SFU already has:
- 3 simulcast layers (h/m/l) encoded by senders
- `TrackRouter::update_remb()` with correct threshold logic (≥1.5 Mbps → High, ≥400 kbps → Medium, <400 kbps → Low), hysteresis (3s upgrade delay, immediate downgrade), and manual preference as ceiling
- `spawn_rtcp_reader()` on source-side receivers that logs REMB but doesn't act on it

The gap: `update_remb()` is never called because there's no SSRC-to-subscriber mapping. REMB feedback comes from the **subscriber's** browser, not the source's. The current RTCP reader is on the wrong side.

## Approach: Sender-Side RTCP Reader

When `peer.add_outgoing_track()` adds a track to a subscriber's PeerConnection, `RTCPeerConnection::add_track()` returns an `RTCRtpSender`. That sender's `read_rtcp()` receives RTCP feedback (including REMB) from the subscriber's browser. We spawn a reader task per sender that calls `update_remb()` and notifies the client on layer changes.

## Data Flow

```
Subscriber browser
  → RTCP REMB (bandwidth estimate)
  → RTCRtpSender.read_rtcp()
  → spawn_subscriber_remb_reader()
  → track_router.update_remb(subscriber_id, source_user_id, source_type, bps)
  → if layer changed: subscriber.signal_tx.send(VoiceLayerChanged)
```

## Changes Required

### 1. `peer.rs` — Return RTCRtpSender from add_outgoing_track

`add_outgoing_track()` currently discards the `RTCRtpSender` returned by `peer_connection.add_track()`. Change it to return `Arc<RTCRtpSender>` so the caller can spawn the RTCP reader.

### 2. `track.rs` — Add spawn_subscriber_remb_reader

New function alongside existing `spawn_rtcp_reader`:

```rust
pub fn spawn_subscriber_remb_reader(
    track_router: Arc<TrackRouter>,
    subscriber_id: Uuid,
    source_user_id: Uuid,
    source_type: TrackSource,
    sender: Arc<RTCRtpSender>,
    signal_tx: mpsc::Sender<ServerEvent>,
    channel_id: Uuid,
)
```

Spawns a tokio task that:
1. Loops on `sender.read_rtcp().await`
2. Downcasts packets to `ReceiverEstimatedMaximumBitrate`
3. Calls `track_router.update_remb(subscriber_id, source_user_id, source_type, bitrate)`
4. If `Some(new_layer)` returned, sends `VoiceLayerChanged` via `signal_tx`
5. Logs at `trace!` level for observability

### 3. `sfu.rs` — Wire up at subscription creation

At the two call sites where `add_outgoing_track()` is called (on_track handler + join-existing-peers), capture the returned sender and call `spawn_subscriber_remb_reader()` with the room's `track_router`, the subscriber's `signal_tx`, and the channel ID.

### 4. No client changes needed

The client already handles `VoiceLayerChanged` events and updates the quality badge + layer store. Auto-switching is transparent — the viewer sees the badge change from HD → SD → LD as bandwidth fluctuates. Manual override (right-click → preference) still acts as a ceiling via `LayerPreference`.

## Existing Logic (No Changes)

- `select_layer()` — picks layer based on preference ceiling + REMB bandwidth
- REMB thresholds: High ≥1.5 Mbps, Medium ≥400 kbps, Low <400 kbps
- Hysteresis: 3s sustained bandwidth before upgrade, immediate downgrade
- `forward_rtp()` — filters packets by `active_layer` per subscriber
- Manual preference — acts as ceiling (can't auto-upgrade above it)
- Quality badge + context menu UI — already reactive to layer changes

## Task Overhead

One spawned tokio task per subscriber-per-outgoing-track. For a 10-person voice channel with 2 screen shares, that's ~18 reader tasks. Negligible for gaming community scale.

## Testing

- Existing unit tests for `update_remb()` cover threshold/hysteresis logic (8 tests)
- New tests: verify `spawn_subscriber_remb_reader` calls `update_remb` and sends notification
- Integration: manual test with browser DevTools network throttling to observe auto-switching
