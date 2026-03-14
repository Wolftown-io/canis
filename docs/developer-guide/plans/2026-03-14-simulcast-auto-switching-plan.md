# Simulcast Auto-Switching Implementation Plan


**Goal:** Wire up REMB-based automatic simulcast layer switching so the SFU downgrades/upgrades video quality per subscriber based on their bandwidth.

**Architecture:** Capture the `RTCRtpSender` from `add_outgoing_track()`, spawn a per-sender RTCP reader that calls the existing `TrackRouter::update_remb()`, and send `VoiceLayerChanged` events when layers switch. No client changes needed.

**Tech Stack:** Rust, webrtc-rs (`RTCRtpSender`, REMB RTCP), tokio, DashMap

**Design doc:** `docs/developer-guide/plans/2026-03-14-simulcast-auto-switching-design.md`

---

### Task 1: Return RTCRtpSender from add_outgoing_track

**Files:**
- Modify: `server/src/voice/peer.rs:109-127`

**Step 1: Update the return type and capture the sender**

In `peer.rs`, change `add_outgoing_track` to return the sender:

```rust
use webrtc::rtp_transceiver::rtp_sender::RTCRtpSender;

/// Add an outgoing track to forward media from another user.
pub async fn add_outgoing_track(
    &self,
    source_user_id: Uuid,
    source_type: TrackSource,
    track: Arc<TrackLocalStaticRTP>,
) -> Result<Arc<RTCRtpSender>, VoiceError> {
    // Add track to peer connection
    let sender = self.peer_connection
        .add_track(
            track.clone() as Arc<dyn webrtc::track::track_local::TrackLocal + Send + Sync>
        )
        .await?;

    // Store reference
    let mut tracks = self.outgoing_tracks.write().await;
    tracks.insert((source_user_id, source_type), track);

    Ok(sender)
}
```

**Step 2: Verify it compiles**

Run: `SQLX_OFFLINE=true cargo check -p vc-server`

This will fail with errors at call sites that expect `Result<(), VoiceError>`. That's expected — we fix those in Task 3.

**Step 3: Commit**

```
feat(voice): return RTCRtpSender from add_outgoing_track
```

---

### Task 2: Add spawn_subscriber_remb_reader

**Files:**
- Modify: `server/src/voice/track.rs` (add function after `spawn_rtcp_reader`, ~line 498)

**Step 1: Write the REMB reader function**

Add this function after the existing `spawn_rtcp_reader`:

```rust
/// Spawn a task to read REMB feedback from a subscriber's outgoing sender.
///
/// When the subscriber's browser reports its available bandwidth via REMB,
/// this updates the corresponding subscription in the track router and
/// notifies the subscriber if the active layer changes.
pub fn spawn_subscriber_remb_reader(
    track_router: Arc<TrackRouter>,
    subscriber_id: Uuid,
    source_user_id: Uuid,
    source_type: TrackSource,
    sender: Arc<webrtc::rtp_transceiver::rtp_sender::RTCRtpSender>,
    signal_tx: mpsc::Sender<crate::ws::ServerEvent>,
    channel_id: Uuid,
) {
    tokio::spawn(async move {
        use webrtc::rtcp::payload_feedbacks::receiver_estimated_maximum_bitrate::ReceiverEstimatedMaximumBitrate;

        while let Ok((packets, _)) = sender.read_rtcp().await {
            for pkt in &packets {
                if let Some(remb) = pkt
                    .as_any()
                    .downcast_ref::<ReceiverEstimatedMaximumBitrate>()
                {
                    let bitrate = remb.bitrate as u64;
                    tracing::trace!(
                        subscriber = %subscriber_id,
                        source = %source_user_id,
                        source_type = ?source_type,
                        bitrate,
                        "Subscriber REMB received"
                    );

                    if let Some(new_layer) = track_router.update_remb(
                        subscriber_id,
                        source_user_id,
                        source_type,
                        bitrate,
                    ) {
                        tracing::info!(
                            subscriber = %subscriber_id,
                            source = %source_user_id,
                            source_type = ?source_type,
                            new_layer = ?new_layer,
                            bitrate,
                            "Auto-switched simulcast layer"
                        );

                        let _ = signal_tx
                            .send(crate::ws::ServerEvent::VoiceLayerChanged {
                                channel_id,
                                source_user_id,
                                track_source: source_type,
                                active_layer: new_layer,
                            })
                            .await;
                    }
                }
            }
        }

        tracing::debug!(
            subscriber = %subscriber_id,
            source = %source_user_id,
            source_type = ?source_type,
            "Subscriber REMB reader stopped"
        );
    });
}
```

Add the required import at the top of `track.rs`:

```rust
use tokio::sync::mpsc;
```

**Step 2: Verify it compiles**

Run: `SQLX_OFFLINE=true cargo check -p vc-server`

Should compile (function exists but isn't called yet).

**Step 3: Commit**

```
feat(voice): add spawn_subscriber_remb_reader for auto layer switching
```

---

### Task 3: Wire up REMB reader at subscription sites

**Files:**
- Modify: `server/src/voice/sfu.rs:685-714` (on_track handler)
- Modify: `server/src/voice/ws_handler.rs:186-209` (join-existing-peers)

**Step 1: Update sfu.rs on_track handler**

At `sfu.rs` line 693-694, capture the sender and spawn the reader. The surrounding context needs `room` and `channel_id`. The `room` is already in scope (cloned into the closure). Add channel_id from room.

Replace lines 693-712 (the `add_outgoing_track` block inside the `for other_peer` loop):

```rust
if let Err(e) = other_peer
    .add_outgoing_track(uid, source_type, local_track)
    .await
{
    warn!(
        source = %uid,
        subscriber = %other_peer.user_id,
        error = %e,
        "Failed to add outgoing track"
    );
}
```

With:

```rust
match other_peer
    .add_outgoing_track(uid, source_type, local_track)
    .await
{
    Ok(sender) => {
        // Spawn REMB reader for automatic layer switching
        if source_type.is_video() {
            spawn_subscriber_remb_reader(
                room.track_router.clone(),
                other_peer.user_id,
                uid,
                source_type,
                sender,
                other_peer.signal_tx.clone(),
                room.channel_id,
            );
        }
        // Renegotiate so subscriber receives updated SDP
        if let Err(e) = Self::renegotiate(&other_peer).await {
            warn!(
                subscriber = %other_peer.user_id,
                error = %e,
                "Renegotiation failed after track add"
            );
        }
    }
    Err(e) => {
        warn!(
            source = %uid,
            subscriber = %other_peer.user_id,
            error = %e,
            "Failed to add outgoing track"
        );
    }
}
```

Add the import at the top of `sfu.rs` if not already present:

```rust
use super::track::spawn_subscriber_remb_reader;
```

**Step 2: Update ws_handler.rs join-existing-peers**

At `ws_handler.rs` line 191-195, same pattern. Replace the `add_outgoing_track` call:

```rust
if let Err(e) = peer
    .add_outgoing_track(other_peer.user_id, *source_type, local_track)
    .await
{
    warn!("Failed to add outgoing track: {}", e);
} else if matches!(source_type, TrackSource::ScreenVideo(_)) {
```

With:

```rust
match peer
    .add_outgoing_track(other_peer.user_id, *source_type, local_track)
    .await
{
    Ok(sender) => {
        // Spawn REMB reader for automatic layer switching
        if source_type.is_video() {
            spawn_subscriber_remb_reader(
                room.track_router.clone(),
                peer.user_id,
                other_peer.user_id,
                *source_type,
                sender,
                peer.signal_tx.clone(),
                room.channel_id,
            );
        }
        if matches!(source_type, TrackSource::ScreenVideo(_)) {
```

Make sure the `else if` chain for PLI and renegotiation stays intact inside the `Ok` arm. Add the closing `}` for the match arm properly.

Add import at the top of `ws_handler.rs`:

```rust
use super::track::spawn_subscriber_remb_reader;
```

**Step 3: Verify it compiles**

Run: `SQLX_OFFLINE=true cargo check -p vc-server`
Expected: Clean compile.

**Step 4: Run existing tests**

Run: `cargo test -p vc-server`
Expected: All existing tests pass (the REMB reader is spawned but not exercised in unit tests since it needs a real PeerConnection).

**Step 5: Commit**

```
feat(voice): wire REMB auto-switching at subscription sites
```

---

### Task 4: Update CHANGELOG and run final checks

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add CHANGELOG entry**

Under `[Unreleased] → ### Added`, add:

```
- Automatic simulcast layer switching — SFU monitors each viewer's bandwidth via REMB and adjusts video quality (HD/SD/LD) in real time, with 3-second upgrade hysteresis and immediate downgrade; manual right-click override still acts as quality ceiling
```

**Step 2: Run full checks**

```bash
cargo fmt --check
SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings
cargo test -p vc-server
```

All must pass.

**Step 3: Commit**

```
feat(voice): REMB-based simulcast auto-switching (#361 follow-up)
```
