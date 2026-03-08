# Screen Sharing Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 12 issues found during screen sharing review — atomic Redis ops, code dedup, type alignment, encoder fix, client polish, and real integration tests.

**Architecture:** Replace non-atomic Redis GET/INCR/DECR with a single Lua script (following the existing `RateLimiter` pattern). Extract shared REST handler logic into helpers. Fix client-side bugs independently.

**Tech Stack:** Rust (fred Redis, sqlx, axum), Lua (Redis scripting), TypeScript/Solid.js, Tauri

---

## Task 1: Lua Script + ScreenShareLimiter

**Files:**
- Create: `server/src/voice/screen_share_limit.lua`
- Modify: `server/src/voice/screen_share.rs`
- Modify: `server/src/voice/mod.rs:34-36`

### Step 1: Create the Lua script

Create `server/src/voice/screen_share_limit.lua`:

```lua
-- Atomic screen share limit management.
-- KEYS[1] = screenshare:limit:{channel_id}
-- ARGV[1] = max_shares
-- ARGV[2] = operation: "start" | "stop" | "check"
-- Returns: {allowed (1/0), current_count}

local key = KEYS[1]
local max = tonumber(ARGV[1])
local op = ARGV[2]

if op == "check" then
    local count = tonumber(redis.call('GET', key) or '0')
    if count >= max then return {0, count} end
    return {1, count}
elseif op == "start" then
    local count = tonumber(redis.call('GET', key) or '0')
    if count >= max then return {0, count} end
    local new = redis.call('INCR', key)
    return {1, new}
elseif op == "stop" then
    local count = tonumber(redis.call('GET', key) or '0')
    if count > 0 then
        count = redis.call('DECR', key)
    end
    return {1, count}
end

return {0, -1}
```

### Step 2: Add `ScreenShareLimiter` struct to `screen_share.rs`

Replace the three free functions (`check_limit`, `try_start_screen_share`, `stop_screen_share`)
with a `ScreenShareLimiter` struct. Keep all existing types (`ScreenShareInfo`, `ScreenShareCheckResponse`,
`ScreenShareError`, `ScreenShareStartRequest`, `validate_source_label`).

Add at the top of `server/src/voice/screen_share.rs`:

```rust
use std::sync::Arc;
use fred::interfaces::LuaInterface;
use tokio::sync::RwLock;
```

Remove the existing `fred::prelude::*` import and replace with specific imports as needed.

Add the struct after `validate_source_label`:

```rust
/// Embedded Lua script for atomic screen share limit management.
const SCREEN_SHARE_LIMIT_SCRIPT: &str = include_str!("screen_share_limit.lua");

/// Atomic screen share limit manager backed by a Redis Lua script.
///
/// Provides `check()`, `start()`, and `stop()` operations that are each
/// executed as a single atomic Redis command (via EVALSHA).
#[derive(Clone)]
pub struct ScreenShareLimiter {
    redis: Client,
    script_sha: Arc<RwLock<String>>,
}

impl ScreenShareLimiter {
    /// Create a new limiter. Call [`init`] before use to load the script.
    pub fn new(redis: Client) -> Self {
        Self {
            redis,
            script_sha: Arc::new(RwLock::new(String::new())),
        }
    }

    /// Load the Lua script into Redis. Must be called at startup.
    pub async fn init(&mut self) -> Result<(), fred::error::Error> {
        let sha: String = self.redis.script_load(SCREEN_SHARE_LIMIT_SCRIPT).await?;
        tracing::info!(sha = %sha, "Screen share limit script loaded");
        *self.script_sha.write().await = sha;
        Ok(())
    }

    /// Reload script on NOSCRIPT error.
    async fn reload_script(&self) -> Result<String, fred::error::Error> {
        let sha: String = self.redis.script_load(SCREEN_SHARE_LIMIT_SCRIPT).await?;
        *self.script_sha.write().await = sha.clone();
        Ok(sha)
    }

    /// Run the Lua script with retry on NOSCRIPT.
    async fn run_script(
        &self,
        channel_id: Uuid,
        max_shares: u32,
        op: &str,
    ) -> Result<(bool, i64), ScreenShareError> {
        let key = format!("screenshare:limit:{channel_id}");
        let sha = self.script_sha.read().await.clone();
        let args = vec![max_shares.to_string(), op.to_string()];

        match self
            .redis
            .evalsha::<Vec<i64>, _, _, _>(&sha, vec![&key], args.clone())
            .await
        {
            Ok(result) => Self::parse_result(&result),
            Err(e) if e.to_string().contains("NOSCRIPT") => {
                warn!(
                    channel_id = %channel_id,
                    "NOSCRIPT error, reloading screen share limit script"
                );
                let new_sha = self.reload_script().await.map_err(|e| {
                    error!(error = %e, "Failed to reload screen share limit script");
                    ScreenShareError::InternalError
                })?;
                let result = self
                    .redis
                    .evalsha::<Vec<i64>, _, _, _>(&new_sha, vec![&key], args)
                    .await
                    .map_err(|e| {
                        error!(
                            channel_id = %channel_id,
                            error = %e,
                            "EVALSHA failed after reload"
                        );
                        ScreenShareError::InternalError
                    })?;
                Self::parse_result(&result)
            }
            Err(e) => {
                error!(
                    channel_id = %channel_id,
                    error = %e,
                    "Redis EVALSHA failed"
                );
                Err(ScreenShareError::InternalError)
            }
        }
    }

    fn parse_result(result: &[i64]) -> Result<(bool, i64), ScreenShareError> {
        if result.len() < 2 {
            error!("Unexpected Lua script result length: {}", result.len());
            return Err(ScreenShareError::InternalError);
        }
        Ok((result[0] == 1, result[1]))
    }

    /// Check if a screen share slot is available (does not reserve it).
    pub async fn check(
        &self,
        channel_id: Uuid,
        max_shares: u32,
    ) -> Result<(), ScreenShareError> {
        let (allowed, _) = self.run_script(channel_id, max_shares, "check").await?;
        if allowed {
            Ok(())
        } else {
            Err(ScreenShareError::LimitReached)
        }
    }

    /// Atomically reserve a screen share slot. Returns error if limit reached.
    pub async fn start(
        &self,
        channel_id: Uuid,
        max_shares: u32,
    ) -> Result<(), ScreenShareError> {
        let (allowed, _) = self.run_script(channel_id, max_shares, "start").await?;
        if allowed {
            Ok(())
        } else {
            Err(ScreenShareError::LimitReached)
        }
    }

    /// Release a screen share slot (decrements if count > 0).
    pub async fn stop(&self, channel_id: Uuid) {
        // max_shares arg is unused by "stop" op, pass 0
        if let Err(e) = self.run_script(channel_id, 0, "stop").await {
            warn!(
                channel_id = %channel_id,
                error = ?e,
                "Failed to decrement screen share counter"
            );
        }
    }
}
```

### Step 3: Remove old free functions

Delete the following functions from `server/src/voice/screen_share.rs`:
- `check_limit` (lines 131-159)
- `try_start_screen_share` (lines 161-221)
- `stop_screen_share` (lines 223-251)

### Step 4: Update exports in `server/src/voice/mod.rs`

Change line 34-36 from:

```rust
pub use screen_share::{
    ScreenShareCheckResponse, ScreenShareError, ScreenShareInfo, ScreenShareStartRequest,
};
```

To:

```rust
pub use screen_share::{
    ScreenShareCheckResponse, ScreenShareError, ScreenShareInfo, ScreenShareLimiter,
    ScreenShareStartRequest,
};
```

### Step 5: Update existing unit tests

The tests in `screen_share.rs` that test `ScreenShareInfo`, `ScreenShareCheckResponse`,
`ScreenShareError`, `validate_source_label`, and `ScreenShareStartRequest` remain unchanged.
Remove any tests that tested the old free functions (there are none — those were async and
only tested via integration tests).

### Step 6: Run tests

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings && cargo test -p vc-server`
Expected: Compilation errors from call sites — those are fixed in Task 2.

### Step 7: Commit

```
feat(ws): atomic screen share limit via Redis Lua script
```

---

## Task 2: Wire ScreenShareLimiter into AppState + Fix Call Sites

**Files:**
- Modify: `server/src/api/mod.rs:51-109` (AppState + AppStateConfig)
- Modify: `server/src/main.rs:92-118` (init at startup)
- Modify: `server/src/chat/screenshare.rs` (REST handlers)
- Modify: `server/src/voice/ws_handler.rs:540-666` (WS handler)
- Modify: `server/tests/integration/helpers/mod.rs:200-266` (TestApp)

### Step 1: Add `ScreenShareLimiter` to `AppState`

In `server/src/api/mod.rs`, add to `AppState` struct (after `rate_limiter` field, line 63):

```rust
    /// Screen share limit manager (uses Redis Lua script)
    pub screen_share_limiter: Option<ScreenShareLimiter>,
```

Add to `AppStateConfig` (after `rate_limiter` field, line 87):

```rust
    pub screen_share_limiter: Option<ScreenShareLimiter>,
```

Add to `AppState::new` body (after line 103):

```rust
            screen_share_limiter: cfg.screen_share_limiter,
```

Add import at top of file:

```rust
use crate::voice::ScreenShareLimiter;
```

### Step 2: Initialize at startup in `main.rs`

In `server/src/main.rs`, after the rate limiter initialization block (after line ~118), add:

```rust
    // Initialize screen share limiter
    let screen_share_limiter = {
        use vc_server::voice::ScreenShareLimiter;

        let mut limiter = ScreenShareLimiter::new(redis.clone());
        match limiter.init().await {
            Ok(()) => {
                info!("Screen share limiter initialized");
                Some(limiter)
            }
            Err(e) => {
                tracing::warn!(
                    "Screen share limiter initialization failed: {}. Screen share limits disabled.",
                    e
                );
                None
            }
        }
    };
```

Add `screen_share_limiter` to the `AppStateConfig` construction (around line 340):

```rust
    let state = api::AppState::new(api::AppStateConfig {
        // ... existing fields ...
        screen_share_limiter,
    });
```

### Step 3: Update REST handlers in `chat/screenshare.rs`

Remove the old imports:

```rust
use crate::voice::screen_share::{
    check_limit, stop_screen_share, try_start_screen_share, validate_source_label,
};
```

Replace with:

```rust
use crate::voice::screen_share::validate_source_label;
```

**Extract shared helper — `fetch_channel_settings`:**

Add this function at the top of `chat/screenshare.rs` (after imports):

```rust
/// Fetch channel voice settings for screen share checks.
/// Returns `(guild_id, max_screen_shares)`.
async fn fetch_channel_settings(
    pool: &PgPool,
    channel_id: Uuid,
) -> Result<(Option<Uuid>, u32), ScreenShareError> {
    let row = sqlx::query("SELECT guild_id, max_screen_shares FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            error!(channel_id = %channel_id, error = %e, "Database error fetching channel");
            ScreenShareError::InternalError
        })?
        .ok_or(ScreenShareError::InternalError)?;

    let guild_id: Option<Uuid> = row.try_get("guild_id").unwrap_or_else(|e| {
        warn!(channel_id = %channel_id, error = %e, "Failed to read guild_id, defaulting to None");
        None
    });

    let raw: i32 = row.try_get("max_screen_shares").unwrap_or_else(|e| {
        warn!(channel_id = %channel_id, error = %e, "Failed to read max_screen_shares, defaulting to 1");
        1
    });
    let max_screen_shares: u32 = raw.try_into().unwrap_or(1);

    Ok((guild_id, max_screen_shares))
}
```

**Extract shared helper — `resolve_quality`:**

```rust
/// Resolve the granted quality tier based on user feature flags.
/// Downgrades Premium to High if user lacks `PREMIUM_VIDEO`.
async fn resolve_quality(
    pool: &PgPool,
    user_id: Uuid,
    requested: Quality,
) -> Result<Quality, ScreenShareError> {
    if requested != Quality::Premium {
        return Ok(requested);
    }

    let user_row = sqlx::query("SELECT feature_flags FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            error!(user_id = %user_id, error = %e, "Database error fetching user features");
            ScreenShareError::InternalError
        })?
        .ok_or(ScreenShareError::InternalError)?;

    let flags: i64 = user_row.try_get("feature_flags").unwrap_or_else(|e| {
        warn!(user_id = %user_id, error = %e, "Failed to read feature_flags, defaulting to 0");
        0
    });
    let features = UserFeatures::from_bits_truncate(flags);

    if features.contains(UserFeatures::PREMIUM_VIDEO) {
        Ok(Quality::Premium)
    } else {
        Ok(Quality::High)
    }
}
```

**Rewrite `check` handler** to use helpers + limiter:

```rust
pub async fn check(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<ScreenShareStartRequest>,
) -> Result<Json<ScreenShareCheckResponse>, ScreenShareError> {
    validate_source_label(&req.source_label)?;

    let (guild_id, max_screen_shares) = fetch_channel_settings(&state.db, channel_id).await?;

    // Check guild permissions
    if let Some(gid) = guild_id {
        let required = GuildPermissions::SCREEN_SHARE | GuildPermissions::VOICE_CONNECT;
        if require_guild_permission(&state.db, gid, user.id, required).await.is_err() {
            return Ok(Json(ScreenShareCheckResponse::denied(ScreenShareError::NoPermission)));
        }
    }

    // Check limits via limiter
    if let Some(ref limiter) = state.screen_share_limiter {
        if let Err(e) = limiter.check(channel_id, max_screen_shares).await {
            return Ok(Json(ScreenShareCheckResponse::denied(e)));
        }
    }

    let granted_quality = resolve_quality(&state.db, user.id, req.quality).await?;
    Ok(Json(ScreenShareCheckResponse::allowed(granted_quality)))
}
```

**Rewrite `start` handler** similarly (use helpers + limiter, keep room membership + already-sharing checks):

```rust
pub async fn start(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<ScreenShareStartRequest>,
) -> Result<Json<ScreenShareCheckResponse>, ScreenShareError> {
    validate_source_label(&req.source_label)?;

    let (guild_id, max_screen_shares) = fetch_channel_settings(&state.db, channel_id).await?;

    // Check guild permissions
    if let Some(gid) = guild_id {
        let required = GuildPermissions::SCREEN_SHARE | GuildPermissions::VOICE_CONNECT;
        if require_guild_permission(&state.db, gid, user.id, required).await.is_err() {
            return Err(ScreenShareError::NoPermission);
        }
    }

    let granted_quality = resolve_quality(&state.db, user.id, req.quality).await?;

    // Check room membership BEFORE reserving slot
    let room = state.sfu.get_room(channel_id).await
        .ok_or(ScreenShareError::NotInChannel)?;
    if room.get_peer(user.id).await.is_none() {
        return Err(ScreenShareError::NotInChannel);
    }

    // Check not already sharing
    {
        let screen_shares = room.screen_shares.read().await;
        if screen_shares.contains_key(&user.id) {
            return Err(ScreenShareError::AlreadySharing);
        }
    }

    // Reserve slot via limiter
    if let Some(ref limiter) = state.screen_share_limiter {
        limiter.start(channel_id, max_screen_shares).await?;
    }

    // Update room & broadcast
    let info = ScreenShareInfo::new(
        user.id, user.username.clone(), req.source_label.clone(),
        req.has_audio, granted_quality,
    );
    room.add_screen_share(info).await;

    let event = ServerEvent::ScreenShareStarted {
        channel_id, user_id: user.id, username: user.username,
        source_label: req.source_label, has_audio: req.has_audio,
        quality: granted_quality,
    };
    if let Err(e) = broadcast_to_channel(&state.redis, channel_id, &event).await {
        error!(channel_id = %channel_id, user_id = %user.id, error = %e,
            "Failed to broadcast screen share started event");
    }

    Ok(Json(ScreenShareCheckResponse::allowed(granted_quality)))
}
```

**Rewrite `stop` handler** to use limiter:

```rust
pub async fn stop(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<(), ScreenShareError> {
    let had_screen_share = if let Some(room) = state.sfu.get_room(channel_id).await {
        room.screen_shares.read().await.contains_key(&user.id)
    } else {
        false
    };

    if had_screen_share {
        if let Some(ref limiter) = state.screen_share_limiter {
            limiter.stop(channel_id).await;
        }
    }

    if let Some(room) = state.sfu.get_room(channel_id).await {
        room.remove_screen_share(user.id).await;

        let event = ServerEvent::ScreenShareStopped {
            channel_id, user_id: user.id, reason: "user_stopped".to_string(),
        };
        if let Err(e) = broadcast_to_channel(&state.redis, channel_id, &event).await {
            error!(channel_id = %channel_id, user_id = %user.id, error = %e,
                "Failed to broadcast screen share stopped event");
        }
    }

    Ok(())
}
```

### Step 4: Fix WS handler — remove hardcoded constant, use DB query

In `server/src/voice/ws_handler.rs`:

1. Remove `const DEFAULT_MAX_SCREEN_SHARES: u32 = 2;` (line 543).

2. Add `max_screen_shares: u32` field to `HandleScreenShareStartParams` (line 546-552).

3. In `handle_screen_share_start` (line 555), replace lines 598-600:

```rust
    // Before:
    // TODO: Get max_screen_shares from channel settings
    let max_shares = DEFAULT_MAX_SCREEN_SHARES;

    // After:
    let max_shares = params.max_screen_shares;
```

4. At the call site (wherever `handle_screen_share_start` is called), add a DB query to fetch
   `max_screen_shares` from the channels table before constructing `HandleScreenShareStartParams`.
   Use `sqlx::query_scalar`:

```rust
let max_screen_shares: i32 = sqlx::query_scalar(
    "SELECT max_screen_shares FROM channels WHERE id = $1"
)
    .bind(channel_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or(1);
let max_screen_shares: u32 = max_screen_shares.try_into().unwrap_or(1);
```

5. Update `handle_leave` (line 272) to use the `ScreenShareLimiter` from `AppState` instead
   of calling the old `stop_screen_share` free function. The limiter needs to be passed down
   or accessed via a shared reference. Since the WS handler functions take `redis: &Client`,
   add a `screen_share_limiter: Option<&ScreenShareLimiter>` parameter to `handle_leave` and
   `handle_screen_share_start`, and replace:

```rust
// Before:
stop_screen_share(redis, channel_id).await;
// After:
if let Some(limiter) = screen_share_limiter {
    limiter.stop(channel_id).await;
}
```

And for start:
```rust
// Before:
if let Err(e) = try_start_screen_share(redis, params.channel_id, max_shares).await {
// After:
if let Some(limiter) = screen_share_limiter {
    if let Err(e) = limiter.start(params.channel_id, max_shares).await {
```

6. Remove the old imports of `check_limit`, `try_start_screen_share`, `stop_screen_share`.

### Step 5: Update TestApp in test helpers

In `server/tests/integration/helpers/mod.rs`, add `screen_share_limiter: None` to all
`AppStateConfig` constructions (lines 217-227, 247-257, and any others found).

### Step 6: Run full check

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings && cargo test -p vc-server`
Expected: PASS — all compilation errors resolved, existing tests pass.

### Step 7: Commit

```
refactor(ws): wire ScreenShareLimiter into AppState and all call sites
```

---

## Task 3: Add `started_at` to Server `ScreenShareInfo`

**Files:**
- Modify: `server/src/voice/screen_share.rs` (ScreenShareInfo struct + new())
- Modify: `server/src/chat/screenshare.rs` (where ScreenShareInfo::new is called)
- Modify: `server/src/voice/ws_handler.rs` (where ScreenShareInfo::new is called)

### Step 1: Add `started_at` field

In `server/src/voice/screen_share.rs`, add to `ScreenShareInfo` (after `quality` field):

```rust
    /// When the screen share session started
    pub started_at: chrono::DateTime<chrono::Utc>,
```

Update the `new()` constructor — remove `const` (since `Utc::now()` is not const) and set
`started_at` internally:

```rust
    #[must_use]
    pub fn new(
        user_id: Uuid,
        username: String,
        source_label: String,
        has_audio: bool,
        quality: Quality,
    ) -> Self {
        Self {
            user_id,
            username,
            source_label,
            has_audio,
            quality,
            started_at: chrono::Utc::now(),
        }
    }
```

### Step 2: Update tests

Update `test_screen_share_info_creation` and `test_screen_share_info_without_audio` to
check that `started_at` is recent (within 1 second of now). Update
`test_screen_share_info_serialization` to verify `started_at` appears in JSON.

### Step 3: Run tests

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings && cargo test -p vc-server`
Expected: PASS

### Step 4: Commit

```
feat(ws): add started_at timestamp to ScreenShareInfo
```

---

## Task 4: Fix Encoder Busy-Wait

**Files:**
- Modify: `client/src-tauri/src/commands/screen_share.rs:116,129-175`

### Step 1: Change frame channel to `std::sync::mpsc`

In `client/src-tauri/src/commands/screen_share.rs`, the frame channel (line 116) is currently
`tokio::sync::mpsc`. Since the encoder runs on `spawn_blocking`, switch to `std::sync::mpsc`
for the frame channel only (keep `tokio::sync::mpsc` for the packet channel since the RTP
sender is async):

```rust
// Line 116: change from
let (frame_tx, mut frame_rx) = mpsc::channel(2);
// To
let (frame_tx, frame_rx) = std::sync::mpsc::sync_channel(2);
```

Update the `FrameCapturer::start()` call to use `std::sync::mpsc::SyncSender` instead of
`tokio::sync::mpsc::Sender`. If `FrameCapturer` already accepts a generic sender, this may
work. If not, update its interface to accept `std::sync::mpsc::SyncSender`.

### Step 2: Replace busy-wait loop

Replace the encoder loop (lines 144-171) with:

```rust
loop {
    if *shutdown_rx.borrow() {
        info!("Encoder shutdown requested");
        break;
    }

    match frame_rx.recv_timeout(std::time::Duration::from_millis(16)) {
        Ok(i420) => match encoder.encode(&i420) {
            Ok(packets) => {
                if !packets.is_empty() && pkt_tx.blocking_send(packets).is_err() {
                    info!("Packet channel closed, stopping encoder");
                    break;
                }
            }
            Err(e) => {
                warn!("Encode error: {e}");
            }
        },
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            // No frame this interval — loop back to check shutdown
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            info!("Frame channel closed, stopping encoder");
            break;
        }
    }
}
```

### Step 3: Verify compilation

Run: `cd client && cargo clippy -p kaiku-tauri -- -D warnings`
Expected: PASS (or adjust `FrameCapturer` interface if needed)

### Step 4: Commit

```
perf(client): replace encoder busy-wait with recv_timeout
```

---

## Task 5: Client-Side Fixes (Volume, Sidebar, Console Logs)

**Files:**
- Modify: `client/src/stores/screenShareViewer.ts`
- Modify: `client/src/components/voice/ScreenShareViewer.tsx:305,348-353`

### Step 1: Add `previousVolume` to store

In `client/src/stores/screenShareViewer.ts`, add `previousVolume` to the interface and default:

```typescript
interface ScreenShareViewerState {
  // ... existing fields ...
  /** Volume before muting (for unmute restore) */
  previousVolume: number;
}

const [viewerState, setViewerState] = createStore<ScreenShareViewerState>({
  // ... existing defaults ...
  previousVolume: 100,
});
```

Export `previousVolume` setter — no new function needed, `setScreenVolume` already exists.
Add a `toggleMute` export:

```typescript
/**
 * Toggle mute with volume memory.
 * Stores pre-mute volume and restores it on unmute.
 */
export function toggleMute(): void {
  if (viewerState.screenVolume === 0) {
    setScreenVolume(viewerState.previousVolume || 100);
  } else {
    setViewerState({ previousVolume: viewerState.screenVolume });
    setScreenVolume(0);
  }
}
```

### Step 2: Remove `console.log` calls

Remove all `console.log("[ScreenShareViewer]` calls from `screenShareViewer.ts`.
Keep the `console.warn` calls (lines 116, 122) — those indicate actual problems.

### Step 3: Update `ScreenShareViewer.tsx` — volume toggle

In `ScreenShareViewer.tsx`, update the `VolumeControl` component (line 348-378) to use `toggleMute`:

```typescript
import {
  viewerState,
  stopViewing,
  setViewMode,
  setScreenVolume,
  toggleMute,
  type ViewMode,
} from "@/stores/screenShareViewer";
```

Replace the `VolumeControl` component's inline `toggleMute` (lines 350-352) with the
imported store function. Also update the keyboard shortcut handler (line 112):

```typescript
// Before:
setScreenVolume(viewerState.screenVolume === 0 ? 100 : 0);
// After:
toggleMute();
```

### Step 4: Fix theater mode sidebar offset

In `ScreenShareViewer.tsx` line 305, replace:

```tsx
// Before:
<div class="fixed top-0 left-[312px] right-0 bottom-0 z-40 bg-black/95 flex flex-col">

// After — ServerRail (72px) + Sidebar (240px):
<div class="fixed top-0 left-[calc(72px+240px)] right-0 bottom-0 z-40 bg-black/95 flex flex-col">
```

### Step 5: Run client tests

Run: `cd client && bun run test:run`
Expected: PASS

### Step 6: Commit

```
fix(client): volume toggle memory, sidebar offset, remove debug logs
```

---

## Task 6: Integration Tests

**Files:**
- Modify: `server/tests/integration/screenshare.rs`
- Modify: `server/tests/integration/helpers/mod.rs` (add voice channel helper)

### Step 1: Add a voice channel helper

In `server/tests/integration/helpers/mod.rs`, add after `create_channel` (around line 611):

```rust
/// Create a voice channel in a guild and return its ID.
pub async fn create_voice_channel(pool: &PgPool, guild_id: Uuid, name: &str) -> Uuid {
    let channel_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO channels (id, guild_id, name, channel_type) VALUES ($1, $2, $3, 'voice')",
    )
    .bind(channel_id)
    .bind(guild_id)
    .bind(name)
    .execute(pool)
    .await
    .expect("Failed to create voice channel");
    channel_id
}
```

### Step 2: Implement the integration tests

Replace the `#[ignore]` stubs in `server/tests/integration/screenshare.rs` (lines 155-249)
with real implementations. Keep the existing unit tests (lines 1-153) unchanged.

```rust
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;

use super::helpers::{
    create_guild_with_default_role, create_test_user, create_voice_channel,
    generate_access_token, TestApp,
};
use vc_server::permissions::GuildPermissions;

/// Screen share check requires authentication.
#[tokio::test]
async fn test_screen_share_check_requires_auth() {
    let app = TestApp::new().await;
    let (user_id, _) = create_test_user(&app.pool).await;
    let perms = GuildPermissions::VIEW_CHANNELS
        | GuildPermissions::VOICE_CONNECT
        | GuildPermissions::SCREEN_SHARE;
    let guild_id = create_guild_with_default_role(&app.pool, user_id, perms).await;
    let channel_id = create_voice_channel(&app.pool, guild_id, "voice-test").await;
    let _guard = app.cleanup_guard();

    let body = serde_json::json!({
        "quality": "medium",
        "has_audio": false,
        "source_label": "Display 1"
    });

    let req = TestApp::request(
        Method::POST,
        &format!("/api/channels/{channel_id}/screenshare/check"),
    )
    .header("content-type", "application/json")
    // No Authorization header
    .body(Body::from(serde_json::to_string(&body).unwrap()))
    .unwrap();

    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

/// Screen share check requires SCREEN_SHARE permission.
#[tokio::test]
async fn test_screen_share_check_requires_permission() {
    let app = TestApp::new().await;
    let (user_id, _) = create_test_user(&app.pool).await;
    // Grant VIEW_CHANNELS + VOICE_CONNECT but NOT SCREEN_SHARE
    let perms = GuildPermissions::VIEW_CHANNELS | GuildPermissions::VOICE_CONNECT;
    let guild_id = create_guild_with_default_role(&app.pool, user_id, perms).await;
    let channel_id = create_voice_channel(&app.pool, guild_id, "voice-test").await;
    let token = generate_access_token(&app.config, user_id);
    let _guard = app.cleanup_guard();

    let body = serde_json::json!({
        "quality": "medium",
        "has_audio": false,
        "source_label": "Display 1"
    });

    let req = TestApp::request(
        Method::POST,
        &format!("/api/channels/{channel_id}/screenshare/check"),
    )
    .header("content-type", "application/json")
    .header("authorization", format!("Bearer {token}"))
    .body(Body::from(serde_json::to_string(&body).unwrap()))
    .unwrap();

    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let result: ScreenShareCheckResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!result.allowed);
    assert_eq!(result.error, Some(ScreenShareError::NoPermission));
}

/// Screen share check allows permitted users.
#[tokio::test]
async fn test_screen_share_check_allowed() {
    let app = TestApp::new().await;
    let (user_id, _) = create_test_user(&app.pool).await;
    let perms = GuildPermissions::VIEW_CHANNELS
        | GuildPermissions::VOICE_CONNECT
        | GuildPermissions::SCREEN_SHARE;
    let guild_id = create_guild_with_default_role(&app.pool, user_id, perms).await;
    let channel_id = create_voice_channel(&app.pool, guild_id, "voice-test").await;
    let token = generate_access_token(&app.config, user_id);
    let _guard = app.cleanup_guard();

    let body = serde_json::json!({
        "quality": "high",
        "has_audio": false,
        "source_label": "Display 1"
    });

    let req = TestApp::request(
        Method::POST,
        &format!("/api/channels/{channel_id}/screenshare/check"),
    )
    .header("content-type", "application/json")
    .header("authorization", format!("Bearer {token}"))
    .body(Body::from(serde_json::to_string(&body).unwrap()))
    .unwrap();

    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let result: ScreenShareCheckResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert!(result.allowed);
    assert_eq!(result.granted_quality, Some(Quality::High));
}

/// Screen share start requires room membership (returns NotInChannel).
#[tokio::test]
async fn test_screen_share_start_requires_room_membership() {
    let app = TestApp::new().await;
    let (user_id, _) = create_test_user(&app.pool).await;
    let perms = GuildPermissions::VIEW_CHANNELS
        | GuildPermissions::VOICE_CONNECT
        | GuildPermissions::SCREEN_SHARE;
    let guild_id = create_guild_with_default_role(&app.pool, user_id, perms).await;
    let channel_id = create_voice_channel(&app.pool, guild_id, "voice-test").await;
    let token = generate_access_token(&app.config, user_id);
    let _guard = app.cleanup_guard();

    let body = serde_json::json!({
        "quality": "medium",
        "has_audio": false,
        "source_label": "Display 1"
    });

    let req = TestApp::request(
        Method::POST,
        &format!("/api/channels/{channel_id}/screenshare/start"),
    )
    .header("content-type", "application/json")
    .header("authorization", format!("Bearer {token}"))
    .body(Body::from(serde_json::to_string(&body).unwrap()))
    .unwrap();

    let resp = app.oneshot(req).await;
    // User is not in a voice room, so expect NotInChannel error
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

/// Screen share stop on non-existent share is a no-op (200 OK).
#[tokio::test]
async fn test_screen_share_stop_noop() {
    let app = TestApp::new().await;
    let (user_id, _) = create_test_user(&app.pool).await;
    let perms = GuildPermissions::VIEW_CHANNELS
        | GuildPermissions::VOICE_CONNECT
        | GuildPermissions::SCREEN_SHARE;
    let guild_id = create_guild_with_default_role(&app.pool, user_id, perms).await;
    let channel_id = create_voice_channel(&app.pool, guild_id, "voice-test").await;
    let token = generate_access_token(&app.config, user_id);
    let _guard = app.cleanup_guard();

    let req = TestApp::request(
        Method::POST,
        &format!("/api/channels/{channel_id}/screenshare/stop"),
    )
    .header("authorization", format!("Bearer {token}"))
    .body(Body::empty())
    .unwrap();

    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), StatusCode::OK);
}

/// Screen share check with invalid source label is rejected.
#[tokio::test]
async fn test_screen_share_check_invalid_source_label() {
    let app = TestApp::new().await;
    let (user_id, _) = create_test_user(&app.pool).await;
    let perms = GuildPermissions::VIEW_CHANNELS
        | GuildPermissions::VOICE_CONNECT
        | GuildPermissions::SCREEN_SHARE;
    let guild_id = create_guild_with_default_role(&app.pool, user_id, perms).await;
    let channel_id = create_voice_channel(&app.pool, guild_id, "voice-test").await;
    let token = generate_access_token(&app.config, user_id);
    let _guard = app.cleanup_guard();

    let body = serde_json::json!({
        "quality": "medium",
        "has_audio": false,
        "source_label": "test<script>alert(1)</script>"
    });

    let req = TestApp::request(
        Method::POST,
        &format!("/api/channels/{channel_id}/screenshare/check"),
    )
    .header("content-type", "application/json")
    .header("authorization", format!("Bearer {token}"))
    .body(Body::from(serde_json::to_string(&body).unwrap()))
    .unwrap();

    let resp = app.oneshot(req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}
```

### Step 3: Run integration tests

Run: `cargo test --test integration screenshare`
Expected: PASS (requires running DB + Redis)

### Step 4: Commit

```
test(ws): implement screen share integration tests
```

---

## Task 7: Final Verification

### Step 1: Full server check

Run: `SQLX_OFFLINE=true cargo clippy -- -D warnings && cargo test`
Expected: PASS

### Step 2: Full client check

Run: `cd client && bun run test:run`
Expected: PASS

### Step 3: Commit all remaining changes (if any)

Squash-ready state — all issues resolved.
