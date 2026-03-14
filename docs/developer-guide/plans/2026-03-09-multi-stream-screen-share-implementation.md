# Multi-Stream Screen Sharing Implementation Plan


**Goal:** Enable up to 3 simultaneous screen shares per user and configurable per-channel limits (default 6), with a flexible viewer UI (single-focus + 2x2 grid).

**Architecture:** Each screen share is identified by a client-generated `stream_id: Uuid`. `TrackSource::ScreenVideo` and `ScreenAudio` gain a `Uuid` parameter. Room storage changes from `HashMap<UserId, ScreenShareInfo>` to `HashMap<StreamId, ScreenShareInfo>`. The Redis limiter stays per-channel. A new `CaptureManager` in Tauri manages multiple concurrent capture+encode pipelines.

**Tech Stack:** Rust (webrtc-rs, sqlx, fred), Solid.js, TypeScript, Tauri, VP9 (vpx-encode), Redis Lua scripts

**Design Doc:** `docs/developer-guide/plans/2026-03-09-multi-stream-screen-share-design.md`

---

### Task 1: TrackSource Enum — Add Stream ID

**Files:**
- Modify: `server/src/voice/track_types.rs:20-32`
- Modify: all files that pattern-match on `TrackSource::ScreenVideo` or `TrackSource::ScreenAudio`

**Step 1: Update TrackSource enum**

Change `ScreenVideo` and `ScreenAudio` to carry a `Uuid`:

```rust
pub enum TrackSource {
    Microphone,
    ScreenVideo(Uuid),
    ScreenAudio(Uuid),
    Webcam,
}
```

Update `Display`, `FromStr`, `Hash`, `Eq`, serialization, and any match arms throughout the codebase. Search for `TrackSource::ScreenVideo` and `TrackSource::ScreenAudio` across all server files and update every match arm to handle the `(stream_id)` parameter.

**Step 2: Fix all compilation errors**

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings`

Every file that matches on `TrackSource::ScreenVideo` or `TrackSource::ScreenAudio` will fail. Fix each:
- `ws_handler.rs`: pass `stream_id` when constructing `ScreenVideo(stream_id)` / `ScreenAudio(stream_id)`
- `track.rs`: update subscription key handling
- `peer.rs`: update track source matching
- `sfu.rs`: update any track source references
- Test files: update accordingly

**Step 3: Commit**

```
feat(ws): add stream_id to TrackSource::ScreenVideo and ScreenAudio
```

---

### Task 2: ScreenShareInfo — Add stream_id Field

**Files:**
- Modify: `server/src/voice/screen_share.rs:35-69`

**Step 1: Add stream_id field**

```rust
pub struct ScreenShareInfo {
    pub stream_id: Uuid,        // NEW
    pub user_id: Uuid,
    pub username: String,
    pub source_label: String,
    pub has_audio: bool,
    pub quality: Quality,
    pub started_at: DateTime<Utc>,
}
```

Update `ScreenShareInfo::new()` to accept `stream_id: Uuid` as the first parameter.

**Step 2: Fix all callers of ScreenShareInfo::new()**

Search for `ScreenShareInfo::new(` across the codebase and add the `stream_id` argument:
- `server/src/chat/screenshare.rs` (start handler)
- `server/src/voice/ws_handler.rs` (handle_screen_share_start)

**Step 3: Run clippy and fix**

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings`

**Step 4: Commit**

```
feat(ws): add stream_id to ScreenShareInfo
```

---

### Task 3: Room Storage — HashMap<StreamId, ScreenShareInfo>

**Files:**
- Modify: `server/src/voice/sfu.rs:60-87` (Room struct)
- Modify: `server/src/voice/sfu.rs:138-153` (screen share methods)

**Step 1: Change the screen_shares field type**

The `screen_shares` field is `RwLock<HashMap<Uuid, ScreenShareInfo>>`. The key changes from `user_id` to `stream_id`. No type change needed — it's still `Uuid` — but the semantics change.

**Step 2: Update helper methods**

```rust
pub async fn add_screen_share(&self, info: ScreenShareInfo) {
    let mut shares = self.screen_shares.write().await;
    shares.insert(info.stream_id, info);  // was info.user_id
}

pub async fn remove_screen_share(&self, stream_id: Uuid) -> Option<ScreenShareInfo> {
    let mut shares = self.screen_shares.write().await;
    shares.remove(&stream_id)  // was user_id
}

pub async fn remove_user_screen_shares(&self, user_id: Uuid) -> Vec<ScreenShareInfo> {
    let mut shares = self.screen_shares.write().await;
    let stream_ids: Vec<Uuid> = shares.values()
        .filter(|s| s.user_id == user_id)
        .map(|s| s.stream_id)
        .collect();
    stream_ids.iter().filter_map(|id| shares.remove(id)).collect()
}

pub async fn get_user_stream_count(&self, user_id: Uuid) -> usize {
    let shares = self.screen_shares.read().await;
    shares.values().filter(|s| s.user_id == user_id).count()
}
```

**Step 3: Fix all callers**

Search for `remove_screen_share(user_id)` and update to pass `stream_id` instead. The `handle_leave` cleanup path should now use `remove_user_screen_shares(user_id)`.

**Step 4: Run clippy and fix**

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings`

**Step 5: Commit**

```
refactor(ws): key screen_shares by stream_id instead of user_id
```

---

### Task 4: WebSocket Event Signaling — Add stream_id

**Files:**
- Modify: `server/src/ws/mod.rs:109-232` (ClientEvent)
- Modify: `server/src/ws/mod.rs:287-833` (ServerEvent)

**Step 1: Update ClientEvent variants**

```rust
VoiceScreenShareStart {
    channel_id: Uuid,
    stream_id: Uuid,          // NEW
    quality: Quality,
    has_audio: bool,
    source_label: String,
},
VoiceScreenShareStop {
    channel_id: Uuid,
    stream_id: Uuid,          // NEW (was only channel_id)
},
```

**Step 2: Update ServerEvent variants**

```rust
ScreenShareStarted {
    channel_id: Uuid,
    user_id: Uuid,
    stream_id: Uuid,          // NEW
    username: String,
    source_label: String,
    has_audio: bool,
    quality: Quality,
    started_at: String,
},
ScreenShareStopped {
    channel_id: Uuid,
    user_id: Uuid,
    stream_id: Uuid,          // NEW
    reason: String,
},
```

**Step 3: Fix all match arms in ws_handler.rs**

Update `handle_voice_event` to destructure the new `stream_id` field and pass it to `handle_screen_share_start` and `handle_screen_share_stop`.

Update the `ServerEvent` construction in all broadcast calls to include `stream_id`.

**Step 4: Run clippy and fix**

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings`

**Step 5: Commit**

```
feat(ws): add stream_id to screen share WebSocket events
```

---

### Task 5: WS Handler — Multi-Stream Start/Stop/Leave

**Files:**
- Modify: `server/src/voice/ws_handler.rs:554-676` (handle_screen_share_start)
- Modify: `server/src/voice/ws_handler.rs:679-761` (handle_screen_share_stop)
- Modify: `server/src/voice/ws_handler.rs:249-392` (handle_leave)

**Step 1: Update handle_screen_share_start**

Add `stream_id` parameter. Replace the existing "already sharing" check (which checks by user_id) with a per-user stream count check:

```rust
// Per-user limit (max 3 streams)
let user_stream_count = room.get_user_stream_count(params.user_id).await;
if user_stream_count >= 3 {
    return Err(VoiceError::Signaling("Maximum 3 streams per user".into()));
}
```

Pass `stream_id` when constructing `ScreenShareInfo::new()` and `TrackSource::ScreenVideo(stream_id)`.

Push `TrackSource::ScreenVideo(stream_id)` (and optionally `ScreenAudio(stream_id)`) to `pending_track_sources`.

**Step 2: Update handle_screen_share_stop**

Change from user_id-based lookup to stream_id-based:

```rust
let removed = room.remove_screen_share(stream_id).await;
let Some(info) = removed else {
    debug!(user_id = %user_id, "User tried to stop screen share but wasn't sharing");
    return Ok(());
};
```

Update track cleanup to use `TrackSource::ScreenVideo(stream_id)` and `TrackSource::ScreenAudio(stream_id)`.

**Step 3: Update handle_leave**

Replace single-stream cleanup with multi-stream cleanup:

```rust
let removed_shares = room.remove_user_screen_shares(user_id).await;
let share_count = removed_shares.len();
if share_count > 0 {
    if let Some(limiter) = screen_share_limiter {
        limiter.stop_n(channel_id, share_count as u32).await;
    } else {
        tracing::warn!("Screen share limiter unavailable during leave");
    }

    for info in &removed_shares {
        // Clean up tracks for each stream
        room.track_router.remove_source_track(user_id, TrackSource::ScreenVideo(info.stream_id)).await;
        room.track_router.remove_source_track(user_id, TrackSource::ScreenAudio(info.stream_id)).await;

        room.broadcast_except(
            user_id,
            ServerEvent::ScreenShareStopped {
                channel_id,
                user_id,
                stream_id: info.stream_id,
                reason: "user_left".to_string(),
            },
        ).await;
    }
}
```

**Step 4: Run clippy and fix**

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings`

**Step 5: Commit**

```
feat(ws): multi-stream screen share start/stop/leave handling
```

---

### Task 6: Redis Lua Script — Add stop_n Operation

**Files:**
- Modify: `server/src/voice/screen_share_limit.lua`
- Modify: `server/src/voice/screen_share.rs:144-272` (ScreenShareLimiter)

**Step 1: Add stop_n to Lua script**

Add a new operation that decrements by N:

```lua
elseif op == "stop_n" then
    local n = tonumber(ARGV[3]) or 1
    local count = tonumber(redis.call('GET', key) or '0')
    if count >= n then
        local new_count = redis.call('DECRBY', key, n)
        return {1, new_count}
    elseif count > 0 then
        redis.call('SET', key, '0')
        return {1, 0}
    else
        return {1, 0}
    end
```

**Step 2: Add stop_n method to ScreenShareLimiter**

```rust
pub async fn stop_n(&self, channel_id: Uuid, count: u32) {
    let key = format!("screenshare:limit:{}", channel_id);
    // Call with op="stop_n" and ARGV[3]=count
    if let Err(e) = self.run_script(&key, 0, "stop_n", Some(count)).await {
        tracing::warn!("Failed to decrement screen share counter by {}: {}", count, e);
    }
}
```

Update `run_script` to accept an optional extra argument for the count.

**Step 3: Run clippy and tests**

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings`

**Step 4: Commit**

```
feat(ws): add stop_n operation to screen share Redis limiter
```

---

### Task 7: REST Handlers — Add stream_id to Start/Stop

**Files:**
- Modify: `server/src/chat/screenshare.rs:72-80` (ScreenShareStartRequest)
- Modify: `server/src/chat/screenshare.rs:163-239` (start handler)
- Modify: `server/src/chat/screenshare.rs:252-290` (stop handler)

**Step 1: Update request types**

Add `stream_id` to `ScreenShareStartRequest`:

```rust
pub struct ScreenShareStartRequest {
    pub stream_id: Uuid,       // NEW
    pub quality: Quality,
    pub has_audio: bool,
    pub source_label: String,
}
```

Create a `ScreenShareStopRequest` (or add `stream_id` to the stop endpoint path/body):

```rust
pub struct ScreenShareStopRequest {
    pub stream_id: Uuid,
}
```

**Step 2: Update start handler**

Replace the "already sharing" check (which checks `screen_shares.contains_key(&user.id)`) with the per-user stream count check:

```rust
let user_stream_count = room.get_user_stream_count(user.id).await;
if user_stream_count >= 3 {
    return Err(ScreenShareError::AlreadySharing);
}
```

Pass `req.stream_id` to `ScreenShareInfo::new()`.

**Step 3: Update stop handler**

Change from user_id-based removal to stream_id-based:

```rust
let had_screen_share = if let Some(room) = state.sfu.get_room(channel_id).await {
    room.remove_screen_share(req.stream_id).await.is_some()
} else {
    false
};
```

Broadcast with `stream_id` included.

**Step 4: Run clippy and fix**

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings`

**Step 5: Commit**

```
feat(ws): add stream_id to REST screen share start/stop
```

---

### Task 8: Database Migration — Update max_screen_shares Default

**Files:**
- Create: `server/migrations/20260309000000_update_max_screen_shares_default.sql`

**Step 1: Write migration**

```sql
-- Update default max_screen_shares from 1 to 6 for multi-stream support
ALTER TABLE channels ALTER COLUMN max_screen_shares SET DEFAULT 6;

COMMENT ON COLUMN channels.max_screen_shares IS 'Maximum concurrent screen shares in this channel (default 6, supports multi-stream)';
```

This only affects new channels. Existing channels keep their current value.

**Step 2: Run migration locally**

```bash
DATABASE_URL="postgresql://voicechat:voicechat_dev@localhost:5433/voicechat" sqlx migrate run --source server/migrations
```

**Step 3: Regenerate sqlx offline cache if needed**

If any queries reference `max_screen_shares`, regenerate:

```bash
cd server && cargo sqlx prepare -- --lib
```

**Step 4: Commit**

```
feat(db): update max_screen_shares default to 6 for multi-stream
```

---

### Task 9: Server Tests — Update Existing, Add Multi-Stream

**Files:**
- Modify: `server/src/voice/ws_handler_test.rs`
- Modify: `server/tests/integration/screenshare.rs`
- Modify: `server/tests/integration/helpers/mod.rs`

**Step 1: Fix existing test compilation**

All tests that construct `ScreenShareInfo`, `TrackSource::ScreenVideo`, `ClientEvent::VoiceScreenShareStart`, or `ServerEvent::ScreenShareStarted` need the new `stream_id` field. Fix each.

**Step 2: Add multi-stream test**

Add a test that starts 3 streams for one user:

```rust
#[tokio::test]
async fn test_user_can_start_multiple_streams() {
    // Start stream 1 — should succeed
    // Start stream 2 — should succeed
    // Start stream 3 — should succeed
    // Start stream 4 — should fail with per-user limit error
}
```

**Step 3: Add leave cleanup test**

```rust
#[tokio::test]
async fn test_leave_cleans_up_all_user_streams() {
    // Start 2 streams for user
    // User leaves
    // Verify both streams removed
    // Verify 2 ScreenShareStopped events broadcast
}
```

**Step 4: Run tests**

Run: `cargo test -p vc-server`

**Step 5: Commit**

```
test(ws): update screen share tests for multi-stream support
```

---

### Task 10: TypeScript Types — Add stream_id

**Files:**
- Modify: `client/src/lib/webrtc/types.ts:95-142`

**Step 1: Update ScreenShareInfo**

```typescript
export interface ScreenShareInfo {
  stream_id: string;           // NEW
  user_id: string;
  username: string;
  source_label: string;
  has_audio: boolean;
  quality: ScreenShareQuality;
  started_at: string;
}
```

**Step 2: Update ScreenShareOptions**

```typescript
export interface ScreenShareOptions {
  sourceId?: string;
  quality?: ScreenShareQuality;
  withAudio?: boolean;
  streamId?: string;           // NEW — auto-generated if not provided
}
```

**Step 3: Update VoiceAdapterEvents**

Update screen share callbacks to use `stream_id` where needed:

```typescript
onScreenShareStarted?: (info: ScreenShareInfo) => void;
onScreenShareStopped?: (userId: string, streamId: string, reason: string) => void;
onScreenShareTrack?: (userId: string, streamId: string, track: MediaStreamTrack) => void;
onScreenShareTrackRemoved?: (userId: string, streamId: string) => void;
```

**Step 4: Run type check**

Run: `cd client && bun run typecheck` (or equivalent)

**Step 5: Commit**

```
feat(client): add stream_id to screen share TypeScript types
```

---

### Task 11: Browser WebRTC Adapter — Multi-Stream

**Files:**
- Modify: `client/src/lib/webrtc/browser.ts:40-43` (state)
- Modify: `client/src/lib/webrtc/browser.ts:688-830` (startScreenShare)
- Modify: `client/src/lib/webrtc/browser.ts:832-848` (stopScreenShare)
- Modify: `client/src/lib/webrtc/browser.ts:666-668` (isScreenSharing)

**Step 1: Replace single-stream state with Map**

```typescript
// Replace these three fields:
// private screenShareStream: MediaStream | null = null;
// private screenShareTrack: RTCRtpSender | null = null;
// private screenShareAudioTrack: RTCRtpSender | null = null;

// With:
private screenShares: Map<string, {
  stream: MediaStream;
  videoTrack: MediaStreamTrack;
  sender: RTCRtpSender;
  audioTrack: MediaStreamTrack | null;
  audioSender: RTCRtpSender | null;
}> = new Map();
```

**Step 2: Update startScreenShare()**

Generate `streamId`, call `getDisplayMedia()`, add tracks to peer connection, store in map, send WS event with `stream_id`.

The method should accept an optional `streamId` from `ScreenShareOptions` or generate one via `crypto.randomUUID()`.

**Step 3: Update stopScreenShare()**

Change signature to `stopScreenShare(streamId: string)`. Remove specific stream from map and peer connection.

Add `stopAllScreenShares()` for disconnect cleanup.

**Step 4: Update isScreenSharing()**

```typescript
isScreenSharing(): boolean {
  return this.screenShares.size > 0;
}

getActiveStreamCount(): number {
  return this.screenShares.size;
}
```

**Step 5: Update remote track handling**

In the `on_track` handler (lines 1069-1094), parse `stream_id` from the track metadata/label and pass it to `onScreenShareTrack(userId, streamId, track)`.

**Step 6: Run type check**

Run: `cd client && bun run typecheck`

**Step 7: Commit**

```
feat(client): multi-stream screen share in browser WebRTC adapter
```

---

### Task 12: Screen Share Viewer Store — Multi-Stream

**Files:**
- Modify: `client/src/stores/screenShareViewer.ts`

**Step 1: Update state to track by streamId**

```typescript
interface ScreenShareViewerState {
  // Primary view
  viewingStreamId: string | null;       // was viewingUserId
  videoTrack: MediaStreamTrack | null;
  viewMode: ViewMode;

  // Grid mode
  gridStreamIds: string[];              // NEW — up to 4 streams for grid view
  layoutMode: "focus" | "grid";         // NEW

  // Volume
  screenVolume: number;
  previousVolume: number;

  // PiP
  pipPosition: PipPosition;
  pipSize: { width: number; height: number };

  // Available streams — keyed by streamId now
  availableTracks: Map<string, {
    track: MediaStreamTrack;
    userId: string;
    username: string;
    sourceLabel: string;
  }>;
}
```

**Step 2: Update store functions**

- `addAvailableTrack(streamId, track, userId, username, sourceLabel)` — register by streamId
- `removeAvailableTrack(streamId)` — remove specific stream
- `startViewing(streamId)` — view specific stream
- `getAvailableSharers()` — returns list of `{ streamId, userId, username, sourceLabel }`
- `setLayoutMode(mode: "focus" | "grid")` — NEW
- `addToGrid(streamId)` — NEW, add to gridStreamIds (max 4)
- `removeFromGrid(streamId)` — NEW
- `swapPrimary(streamId)` — NEW, swap thumbnail into primary view

**Step 3: Add tests**

Modify: `client/src/stores/__tests__/screenShareViewer.test.ts`

Add tests for:
- Adding multiple streams
- Removing a stream while viewing it (should auto-switch)
- Grid mode with 4 streams
- swapPrimary behavior

**Step 4: Run tests**

Run: `cd client && bun run test:run`

**Step 5: Commit**

```
feat(client): multi-stream screen share viewer store
```

---

### Task 13: Viewer UI — Single-Focus + Thumbnails

**Files:**
- Modify: `client/src/components/voice/ScreenShareViewer.tsx`

**Step 1: Add thumbnail strip**

Below the primary video view, render a horizontal strip of thumbnails for all available streams except the primary:

```tsx
const ThumbnailStrip = () => {
  const sharers = getAvailableSharers();
  const others = () => sharers().filter(s => s.streamId !== viewerState.viewingStreamId);

  return (
    <div class="flex gap-2 p-2 bg-zinc-900 overflow-x-auto">
      <For each={others()}>
        {(sharer) => (
          <button
            class="flex-shrink-0 w-40 h-24 rounded border border-zinc-700 hover:border-blue-500 relative overflow-hidden"
            onClick={() => swapPrimary(sharer.streamId)}
          >
            <video ref={/* attach sharer.track */} autoplay muted class="w-full h-full object-contain" />
            <div class="absolute bottom-0 left-0 right-0 bg-black/70 text-xs px-1 py-0.5 truncate">
              {sharer.username} — {sharer.sourceLabel}
            </div>
          </button>
        )}
      </For>
    </div>
  );
};
```

**Step 2: Add layout toggle button**

Add a button in the viewer toolbar to toggle between focus and grid mode. Use a grid icon from lucide-solid.

**Step 3: Update SpotlightView, PipView, TheaterView**

Each view mode now renders the primary stream + thumbnail strip. The thumbnail strip appears at the bottom in Spotlight and Theater, and is hidden in PiP mode.

**Step 4: Run dev server and test visually**

Run: `cd client && bun run dev`

**Step 5: Commit**

```
feat(client): thumbnail strip for multi-stream screen share viewer
```

---

### Task 14: Viewer UI — 2x2 Grid Mode

**Files:**
- Modify: `client/src/components/voice/ScreenShareViewer.tsx`

**Step 1: Add GridView component**

```tsx
const GridView = () => {
  const streams = () => viewerState.gridStreamIds
    .map(id => {
      const info = viewerState.availableTracks.get(id);
      return info ? { streamId: id, ...info } : null;
    })
    .filter(Boolean);

  const count = () => streams().length;

  return (
    <div class={`grid gap-1 w-full h-full ${
      count() <= 1 ? 'grid-cols-1' :
      count() <= 2 ? 'grid-cols-2 grid-rows-1' :
      'grid-cols-2 grid-rows-2'
    }`}>
      <For each={streams()}>
        {(stream) => (
          <div class="relative bg-black flex items-center justify-center">
            <video ref={/* attach track */} autoplay class="max-w-full max-h-full object-contain" />
            <div class="absolute bottom-2 left-2 bg-black/70 text-sm px-2 py-1 rounded">
              {stream.username} — {stream.sourceLabel}
            </div>
          </div>
        )}
      </For>
    </div>
  );
};
```

**Step 2: Handle 3-stream layout**

For 3 streams: 2 top + 1 bottom centered. Use CSS:

```css
/* 3 streams: top row 2 cols, bottom row centered */
grid-template-columns: 1fr 1fr;
grid-template-rows: 1fr 1fr;
/* Third item spans center */
```

Or use flexbox for the 3-stream case.

**Step 3: Handle overflow**

If more than 4 streams are active but only 4 fit in the grid, show a thumbnail overflow strip below the grid for remaining streams. Clicking a thumbnail swaps it into the grid (replacing the oldest entry).

**Step 4: Update keyboard shortcut V**

Cycle: focus → grid → pip → theater → focus (add grid to the cycle).

**Step 5: Run dev server and test visually**

Run: `cd client && bun run dev`

**Step 6: Commit**

```
feat(client): 2x2 grid view mode for multi-stream screen share
```

---

### Task 15: Tauri CaptureManager — Multi-Pipeline Support

**Files:**
- Create: `client/src-tauri/src/capture/manager.rs`
- Modify: `client/src-tauri/src/capture/mod.rs`
- Modify: `client/src-tauri/src/lib.rs:301` (VoiceState)

**Step 1: Create CaptureManager**

```rust
use std::collections::HashMap;
use uuid::Uuid;

pub struct CaptureManager {
    sessions: HashMap<Uuid, CaptureSession>,
}

pub struct CaptureSession {
    pub stream_id: Uuid,
    pub source_name: String,
    pub quality: String,
    pub with_audio: bool,
    pub source_type: CaptureSourceType,
    pub shutdown_tx: watch::Sender<bool>,
    pub capturer_handle: tokio::task::JoinHandle<()>,
    pub encoder_handle: tokio::task::JoinHandle<()>,
    pub rtp_handle: tokio::task::JoinHandle<()>,
}

impl CaptureManager {
    pub fn new() -> Self {
        Self { sessions: HashMap::new() }
    }

    pub fn start(&mut self, stream_id: Uuid, session: CaptureSession) -> Result<(), CaptureError> {
        if self.sessions.len() >= 3 {
            return Err(CaptureError::Internal("Maximum 3 streams".into()));
        }
        self.sessions.insert(stream_id, session);
        Ok(())
    }

    pub async fn stop(&mut self, stream_id: Uuid) -> Result<(), CaptureError> {
        let session = self.sessions.remove(&stream_id)
            .ok_or(CaptureError::NotRunning)?;
        session.shutdown().await;
        Ok(())
    }

    pub async fn stop_all(&mut self) {
        let sessions: Vec<_> = self.sessions.drain().collect();
        for (_, session) in sessions {
            session.shutdown().await;
        }
    }

    pub fn active_count(&self) -> usize {
        self.sessions.len()
    }

    pub fn get_status(&self, stream_id: Uuid) -> Option<ScreenShareStatus> { ... }
    pub fn list_active(&self) -> Vec<(Uuid, ScreenShareStatus)> { ... }
}
```

**Step 2: Update VoiceState**

In `client/src-tauri/src/lib.rs`, change:

```rust
// Before:
pub screen_share: Option<ScreenSharePipeline>,

// After:
pub capture_manager: CaptureManager,
```

**Step 3: Run clippy**

Run: `cd client/src-tauri && cargo clippy -- -D warnings`

**Step 4: Commit**

```
feat(client): CaptureManager for multi-stream screen capture
```

---

### Task 16: Tauri Commands — Multi-Stream Start/Stop

**Files:**
- Modify: `client/src-tauri/src/commands/screen_share.rs`

**Step 1: Update start_screen_share command**

Add `stream_id: String` parameter. Parse to Uuid. Use `capture_manager.start()` instead of setting `voice_state.screen_share`.

The pipeline creation logic stays the same — each call creates a new capturer + encoder + RTP sender chain. The `CaptureManager` stores the pipeline keyed by `stream_id`.

**Step 2: Update stop_screen_share command**

Add `stream_id: String` parameter. Call `capture_manager.stop(stream_id)`.

**Step 3: Update get_screen_share_status command**

Return status for a specific `stream_id`, or update to `list_screen_shares` returning all active sessions.

**Step 4: Update voice disconnect cleanup**

In `client/src-tauri/src/commands/voice.rs:230`, change from `voice_state.screen_share.take()` to `capture_manager.stop_all()`.

**Step 5: Run clippy**

Run: `cd client/src-tauri && cargo clippy -- -D warnings`

**Step 6: Commit**

```
feat(client): multi-stream Tauri screen share commands
```

---

### Task 17: ScreenShareQualityPicker — Multi-Stream Awareness

**Files:**
- Modify: `client/src/components/voice/ScreenShareQualityPicker.tsx`

**Step 1: Update handleStart()**

Generate `streamId` before calling `startScreenShare()`:

```typescript
const handleStart = async () => {
  const streamId = crypto.randomUUID();
  await startScreenShare({
    quality: selectedQuality(),
    sourceId: props.sourceId,
    withAudio: true,
    streamId,
  });
};
```

**Step 2: Update share button visibility**

The button that opens the picker should check `getActiveStreamCount() < 3`. If the user is already sharing 3, disable the button.

**Step 3: Commit**

```
feat(client): multi-stream support in screen share quality picker
```

---

### Task 18: Integration Testing & CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`
- Run: full test suite

**Step 1: Run server tests**

```bash
cargo test -p vc-server
```

Fix any failures.

**Step 2: Run client tests**

```bash
cd client && bun run test:run
```

Fix any failures.

**Step 3: Run clippy on full workspace**

```bash
SQLX_OFFLINE=true cargo clippy -- -D warnings
```

**Step 4: Update CHANGELOG**

Add under `[Unreleased]`:

```markdown
### Added
- Multi-stream screen sharing: users can share up to 3 windows/displays simultaneously (#<PR>)
- 2x2 grid view mode for watching multiple screen shares side by side (#<PR>)
- Per-channel screen share limit now configurable (default raised to 6) (#<PR>)

### Changed
- Screen share events now include `stream_id` for multi-stream identification (breaking WebSocket change) (#<PR>)
```

**Step 5: Commit**

```
docs: update CHANGELOG for multi-stream screen sharing
```

---

## Task Dependency Order

```
Task 1 (TrackSource enum)
  └→ Task 2 (ScreenShareInfo stream_id)
       └→ Task 3 (Room storage)
            └→ Task 4 (WS events)
                 └→ Task 5 (WS handlers)
                      └→ Task 6 (Lua stop_n)
                           └→ Task 7 (REST handlers)
                                └→ Task 8 (DB migration)
                                     └→ Task 9 (Server tests)

Task 10 (TS types) — can start after Task 4
  └→ Task 11 (Browser adapter)
       └→ Task 12 (Viewer store)
            └→ Task 13 (Thumbnails UI)
                 └→ Task 14 (Grid UI)

Task 15 (CaptureManager) — can start after Task 10
  └→ Task 16 (Tauri commands)

Task 17 (QualityPicker) — after Task 11

Task 18 (Integration + CHANGELOG) — after all above
```

**Parallelizable groups:**
- Server chain: Tasks 1-9 (sequential)
- Client types: Task 10 (after Task 4)
- Browser chain: Tasks 11-14 (sequential, after Task 10)
- Tauri chain: Tasks 15-16 (sequential, after Task 10)
- Task 17 after Task 11
- Task 18 last
