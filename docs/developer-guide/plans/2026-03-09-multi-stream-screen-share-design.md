# Multi-Stream Screen Sharing — Design Document

**Date:** 2026-03-09
**Status:** Approved
**Phase:** 6 (Competitive Differentiators & Mastery)

## Overview

Enable multiple simultaneous screen share streams per user (up to 3) and per channel (configurable, default 6). Each stream is independently startable/stoppable and identified by a unique `stream_id: Uuid`.

## Requirements

1. A single user can share up to 3 windows/displays simultaneously
2. Multiple users can share in the same voice channel (configurable per-channel limit, default 6)
3. Viewers can watch streams in single-focus mode (primary + thumbnails) or 2x2 grid mode
4. Both Tauri desktop and browser clients support multi-stream sending
5. Full parity between Tauri and browser clients

## Architecture: Stream ID Approach

Each screen share is identified by a `stream_id: Uuid` generated client-side. This extends the existing track routing naturally — `TrackSource::ScreenVideo(stream_id)` becomes the routing key alongside the user ID.

### Why Stream ID over alternatives

- **vs. Indexed slots (0,1,2):** Slots create gap-management complexity when stopping stream 1 but keeping 0 and 2.
- **vs. SSRC multiplexing:** Fights webrtc-rs abstractions, non-standard, harder to debug.
- **Stream ID:** Clean lifecycle, fits existing UUID-everywhere convention, independent start/stop.

## Section 1: Data Model Changes

### ScreenShareInfo

```rust
pub struct ScreenShareInfo {
    pub stream_id: Uuid,        // unique per stream
    pub user_id: Uuid,
    pub username: String,
    pub source_label: String,   // "Display 1", "Firefox", etc.
    pub has_audio: bool,
    pub quality: Quality,
    pub started_at: DateTime<Utc>,
}
```

### Room Storage

Changes from `HashMap<UserId, ScreenShareInfo>` to `HashMap<StreamId, ScreenShareInfo>`.

Helper methods:
- `add_screen_share(info)` — inserts by `stream_id`
- `remove_screen_share(stream_id)` — removes by `stream_id`
- `remove_user_screen_shares(user_id)` — removes all streams for a user (leave/disconnect)
- `get_user_stream_count(user_id) -> usize` — for per-user limit enforcement

### TrackSource Enum

```rust
pub enum TrackSource {
    Microphone,
    ScreenVideo(Uuid),    // was ScreenVideo
    ScreenAudio(Uuid),    // was ScreenAudio
    Webcam,
}
```

### Redis Limiter

Stays per-channel (unchanged key format `screenshare:limit:{channel_id}`). New per-user check added server-side: `get_user_stream_count(user_id) < 3`.

### Channel Settings

`max_screen_shares` default changes from 2 to 6, configurable per-guild/channel.

## Section 2: Signaling Changes

### WebSocket Events

```rust
// Client → Server
ClientEvent::VoiceScreenShareStart {
    channel_id: Uuid,
    stream_id: Uuid,          // client generates
    quality: Quality,
    has_audio: bool,
    source_label: String,
}
ClientEvent::VoiceScreenShareStop {
    channel_id: Uuid,
    stream_id: Uuid,          // identifies which stream
}

// Server → Client
ServerEvent::ScreenShareStarted {
    channel_id: Uuid,
    user_id: Uuid,
    stream_id: Uuid,
    username: String,
    source_label: String,
    has_audio: bool,
    quality: Quality,
    started_at: String,
}
ServerEvent::ScreenShareStopped {
    channel_id: Uuid,
    user_id: Uuid,
    stream_id: Uuid,          // so clients know which stream ended
}
```

### REST Endpoints

- `POST /api/channels/{id}/screenshare/check` — unchanged (checks if a slot is available)
- `POST /api/channels/{id}/screenshare/start` — request body adds `stream_id`
- `POST /api/channels/{id}/screenshare/stop` — request body adds `stream_id`

### Disconnect Cleanup

On leave/disconnect, the server calls `remove_user_screen_shares(user_id)`, decrements the Redis counter by the number of streams removed. The Lua script gets a `stop_n` operation for atomic multi-decrement.

## Section 3: Server Track Routing

### Track Identification

1. Client sends `VoiceScreenShareStart { stream_id, ... }`
2. Server pushes `TrackSource::ScreenVideo(stream_id)` (and optionally `ScreenAudio(stream_id)`) to `pending_track_sources`
3. `on_track` callback pops from `pending_track_sources` and sets up forwarding with key `(user_id, TrackSource::ScreenVideo(stream_id))`

### TrackRouter

No structural change to `DashMap<(UserId, TrackSource), Vec<Subscription>>`. The richer `TrackSource` variants naturally differentiate streams.

### Cleanup on Leave

1. Collect all `stream_id`s for the user from `room.screen_shares`
2. Remove each from `screen_shares` and `track_router`
3. Call `limiter.stop_n(channel_id, count)` to decrement Redis by total
4. Broadcast `ScreenShareStopped` for each stream

### Per-User Limit Enforcement

```rust
let user_stream_count = room.screen_shares.values()
    .filter(|s| s.user_id == user_id)
    .count();
if user_stream_count >= 3 {
    return Err(VoiceError::Signaling("Maximum 3 streams per user".into()));
}
```

## Section 4: Browser Client

### WebRTC Adapter

Single-stream state becomes a map:

```typescript
// Before
screenShareStream: MediaStream | null
screenShareTrack: MediaStreamTrack | null

// After
screenShares: Map<string, {  // keyed by stream_id
  stream: MediaStream
  videoTrack: MediaStreamTrack
  audioTrack: MediaStreamTrack | null
  sender: RTCRtpSender
  audioSender: RTCRtpSender | null
}>
```

### Starting a Stream

1. User clicks "Share Screen" (even if already sharing)
2. Browser calls `getDisplayMedia()` — user picks a window/display
3. Client generates `stream_id = crypto.randomUUID()`
4. Adds video (+ optional audio) track to existing `RTCPeerConnection`
5. Sends `VoiceScreenShareStart { channel_id, stream_id, quality, has_audio, source_label }`
6. Stores in `screenShares` map

### Stopping a Stream

1. User clicks stop on a specific stream
2. Removes track via `RTCRtpSender.replaceTrack(null)` + `removeTrack(sender)`
3. Sends `VoiceScreenShareStop { channel_id, stream_id }`
4. Removes from map

### UI Gating

"Share Screen" button stays visible until 3 active streams. After 3, disabled with tooltip.

## Section 5: Tauri Client

### CaptureManager

New struct owning multiple concurrent capture sessions:

```rust
pub struct CaptureManager {
    sessions: HashMap<Uuid, CaptureSession>,  // keyed by stream_id
}

pub struct CaptureSession {
    stream_id: Uuid,
    source: CaptureSource,
    encoder: Encoder,             // VP9 encoder instance
    frame_tx: SyncSender<I420Frame>,
    shutdown: Arc<AtomicBool>,
}
```

### Lifecycle

- `start_capture(stream_id, source, quality)` — spawns capturer + encoder thread pair
- `stop_capture(stream_id)` — signals shutdown, joins threads
- `stop_all()` — called on leave/disconnect

Each session gets its own `sync_channel(2)` and `recv_timeout(16ms)` encoder loop.

### Tauri Commands

- `start_screen_share` → takes `stream_id`, creates `CaptureSession`
- `stop_screen_share` → takes `stream_id`, stops that session
- `list_screen_shares` → returns active `stream_id`s with source labels

### Performance

3 simultaneous VP9 encodes at Medium (720p/30fps) ≈ 15-30% CPU. No artificial restrictions — functionality is prioritized over CPU budget.

## Section 6: Viewer UI

### Single-Focus Mode (Default)

- One stream fills the main view area
- Thumbnails strip along the bottom for all other active streams
- Each thumbnail: source label, username, small preview
- Click thumbnail → swaps into primary view

### Grid Mode (2x2)

- Toggled via layout button in viewer toolbar
- Up to 4 streams in 2-row × 2-column grid
- Fewer than 4: tiles expand (1 = full, 2 = side by side, 3 = 2 top + 1 bottom centered)
- More than 4: 4 most recently selected shown in grid, rest in overflow thumbnail strip

### Stream Identification

- Each tile/thumbnail shows "username — source label" (e.g., "Alice — Display 1")
- Streams from same user visually grouped in thumbnail strip (adjacent, subtle shared border)

## Section 7: Limits & Permissions

### Three-Layer Enforcement

1. **Per-user: 3 streams** — hardcoded server-side, not configurable
2. **Per-channel: default 6, configurable** — stored in channel settings, enforced via Redis Lua script
3. **Permission: `SCREEN_SHARE`** — existing permission, no changes needed

### Error Messages

- Per-user limit → "You can share up to 3 streams at once"
- Per-channel limit → "This channel's screen share limit has been reached"
- No permission → existing flow

### Migration

SQL migration: `ALTER TABLE channel_settings ALTER COLUMN max_screen_shares SET DEFAULT 6`. Existing channels keep their current value.

## Section 8: Wire Compatibility

### Breaking Changes

`stream_id` additions to WebSocket events and REST endpoints are not backward-compatible. Pre-1.0 self-hosted project — clean break is acceptable.

- Server requires `stream_id` on all screen share events
- No compatibility shim
- Document breaking change in CHANGELOG

### Database

- Default change for `max_screen_shares` (new channels only)
- No schema change for screen share state (in-memory in SFU rooms)

### Redis

No key format change. Counter still `screenshare:limit:{channel_id}`, counts total streams per channel.
