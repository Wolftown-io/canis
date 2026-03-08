# Screen Sharing Fixes — Design Document

**Date:** 2026-03-08
**Scope:** Fix all issues found during screen sharing implementation review
**Approach:** Lua script + comprehensive refactor (Approach A)

## Issues Addressed

| # | Severity | Issue | Root Cause |
|---|----------|-------|------------|
| 1 | Critical | Redis TTL expires during long shares, losing counter | 5-min TTL not refreshed |
| 2 | High | TOCTOU race in `try_start_screen_share` | Non-atomic GET → INCR |
| 3 | High | `i32 as u32` unchecked cast on `max_screen_shares` | Missing bounds validation |
| 4 | Medium | Encoder busy-wait burns CPU | `try_recv()` + `sleep(1ms)` loop |
| 5 | Medium | Duplicated logic in check/start REST handlers | No shared helpers |
| 6 | Medium | Client/server type mismatch (`started_at`) | Field missing server-side |
| 7 | Medium | WS handler uses hardcoded `max_screen_shares = 2` | TODO not implemented |
| 8 | Low | Theater mode hardcoded sidebar offset | Magic number `312px` |
| 9 | Low | Volume toggle forgets pre-mute level | No stored previous volume |
| 10 | Low | Console.log noise in production | Debug logs not gated |
| 11 | Low | All integration tests are stubs | Marked `#[ignore]` with only comments |
| 12 | Low | Misleading "WATCH/MULTI/EXEC" doc comment | Replaced by Lua script |

## Design

### 1. Atomic Redis Lua Script (Issues 1, 2, 12)

Replace `check_limit`, `try_start_screen_share`, and `stop_screen_share` in
`server/src/voice/screen_share.rs` with a single Lua script.

**New file:** `server/src/voice/screen_share_limit.lua`

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

Key decisions:
- **No TTL.** Counter managed by explicit start/stop + disconnect cleanup (`handle_leave` already calls `stop_screen_share` on disconnect).
- **Single script, multi-operation.** Reduces cognitive overhead vs. separate scripts.
- **Script SHA caching.** Follow the `RateLimiter` pattern: `script_load` at startup, `evalsha` at runtime, reload on NOSCRIPT error.

**New struct:** `ScreenShareLimiter` in `server/src/voice/screen_share.rs`

```rust
pub struct ScreenShareLimiter {
    redis: Client,
    script_sha: Arc<RwLock<String>>,
}

impl ScreenShareLimiter {
    pub fn new(redis: Client) -> Self { ... }
    pub async fn init(&mut self) -> Result<(), Error> { ... }
    pub async fn check(&self, channel_id: Uuid, max: u32) -> Result<(), ScreenShareError> { ... }
    pub async fn start(&self, channel_id: Uuid, max: u32) -> Result<(), ScreenShareError> { ... }
    pub async fn stop(&self, channel_id: Uuid) { ... }
}
```

The `ScreenShareLimiter` is stored in `AppState` (alongside the existing `RateLimiter`)
and initialized during server startup. All call sites (`chat/screenshare.rs`, `voice/ws_handler.rs`)
use the limiter instead of calling free functions.

### 2. Server-Side Helper Extraction (Issues 5, 7)

Extract shared logic from REST handlers into helpers in `chat/screenshare.rs`:

```rust
/// Fetch channel voice settings needed for screen share checks.
/// Returns (guild_id, max_screen_shares as u32).
async fn fetch_channel_settings(
    pool: &PgPool,
    channel_id: Uuid,
) -> Result<(Option<Uuid>, u32), ScreenShareError> { ... }

/// Resolve the granted quality tier based on user features.
/// Downgrades Premium to High if user lacks PREMIUM_VIDEO.
async fn resolve_quality(
    pool: &PgPool,
    user_id: Uuid,
    requested: Quality,
) -> Result<Quality, ScreenShareError> { ... }
```

The WS handler (`handle_screen_share_start`) replaces:
```rust
// Before: hardcoded
const DEFAULT_MAX_SCREEN_SHARES: u32 = 2;
let max_shares = DEFAULT_MAX_SCREEN_SHARES;

// After: DB query via shared helper
let (_, max_shares) = fetch_channel_settings(pool, channel_id).await?;
```

The `fetch_channel_settings` helper handles the `i32 → u32` conversion internally (Issue 3):
```rust
let raw: i32 = row.try_get("max_screen_shares").unwrap_or(1);
let max: u32 = raw.try_into().unwrap_or(1);
```

### 3. Encoder Busy-Wait Fix (Issue 4)

In `client/src-tauri/src/commands/screen_share.rs`, replace the encoder loop:

```rust
// Before: busy-wait
match frame_rx.try_recv() {
    Ok(i420) => { ... }
    Err(TryRecvError::Empty) => {
        std::thread::sleep(Duration::from_millis(1));
    }
    ...
}

// After: blocking receive with timeout
match frame_rx.recv_timeout(Duration::from_millis(16)) {
    Ok(i420) => { ... }
    Err(RecvTimeoutError::Timeout) => {
        // No frame this interval — check shutdown and continue
    }
    Err(RecvTimeoutError::Disconnected) => { break; }
}
```

The 16ms timeout aligns with ~60fps ceiling. `tokio::sync::mpsc` doesn't have
`recv_timeout`, so switch the frame channel to `std::sync::mpsc` (the encoder
runs on a blocking thread anyway). Alternatively, keep tokio mpsc and use
`blocking_recv()` with a separate shutdown check interval.

**Decision:** Use `std::sync::mpsc::recv_timeout` since the encoder thread is
already a `spawn_blocking` context and doesn't need async. The shutdown signal
is checked between receives via `shutdown_rx.borrow()`.

### 4. Client/Server Type Alignment (Issue 6)

Add `started_at` to server `ScreenShareInfo`:

```rust
pub struct ScreenShareInfo {
    pub user_id: Uuid,
    pub username: String,
    pub source_label: String,
    pub has_audio: bool,
    pub quality: Quality,
    pub started_at: chrono::DateTime<chrono::Utc>,  // NEW
}
```

The `new()` constructor sets `started_at: chrono::Utc::now()`.
Serializes as ISO 8601 string via serde, matching the client's `started_at: string`.

### 5. Theater Mode Sidebar Offset (Issue 8)

Replace magic number with self-documenting calculation:

```tsx
// Before
<div class="fixed top-0 left-[312px] ...">

// After — ServerRail (72px) + Sidebar (240px)
<div class="fixed top-0 left-[calc(72px+240px)] ...">
```

### 6. Volume Toggle Memory (Issue 9)

Add `previousVolume` to `ScreenShareViewerState`:

```typescript
interface ScreenShareViewerState {
    // ... existing fields
    previousVolume: number;  // NEW — stores pre-mute volume
}

// Mute/unmute logic:
const toggleMute = () => {
    if (isMuted()) {
        setScreenVolume(viewerState.previousVolume || 100);
    } else {
        setViewerState({ previousVolume: viewerState.screenVolume });
        setScreenVolume(0);
    }
};
```

### 7. Console.log Cleanup (Issue 10)

Remove `console.log` calls from `screenShareViewer.ts`. The store operations
(add/remove track, start/stop viewing) are simple enough to not need runtime
logging. Keep `console.warn` calls for actual warnings (e.g., "No track available").

### 8. Integration Tests (Issue 11)

Implement the 6 stub tests in `server/tests/integration/screenshare.rs`.
Follow the existing integration test patterns (ratelimit tests use a shared
test harness with DB + Redis). Tests:

1. `test_screen_share_check_requires_auth` — unauthenticated request → 401
2. `test_screen_share_check_requires_permission` — user without SCREEN_SHARE → denied
3. `test_screen_share_check_allowed` — permitted user → allowed
4. `test_screen_share_start_and_stop_flow` — full lifecycle
5. `test_screen_share_start_limit_enforcement` — max_screen_shares respected
6. `test_screen_share_start_already_sharing` — duplicate start → 409

## Files Modified

### Server (Rust)
| File | Change |
|------|--------|
| `server/src/voice/screen_share_limit.lua` | **NEW** — Lua script |
| `server/src/voice/screen_share.rs` | Add `ScreenShareLimiter`, `started_at` field, remove old free functions |
| `server/src/chat/screenshare.rs` | Extract helpers, use `ScreenShareLimiter`, fix cast |
| `server/src/voice/ws_handler.rs` | Remove hardcoded constant, use DB query + limiter |
| `server/src/voice/mod.rs` | Export `ScreenShareLimiter` |
| `server/src/api/mod.rs` | Add `ScreenShareLimiter` to `AppState`, init at startup |
| `server/tests/integration/screenshare.rs` | Implement 6 integration tests |

### Client (TypeScript/Solid.js)
| File | Change |
|------|--------|
| `client/src/stores/screenShareViewer.ts` | Add `previousVolume`, remove `console.log` |
| `client/src/components/voice/ScreenShareViewer.tsx` | Fix sidebar offset, use `previousVolume` in toggle |

### Client (Tauri/Rust)
| File | Change |
|------|--------|
| `client/src-tauri/src/commands/screen_share.rs` | Replace busy-wait with `recv_timeout` |

## Implementation Order

1. Lua script + `ScreenShareLimiter` (foundational — other server changes depend on it)
2. Helper extraction + WS handler fix (uses the limiter)
3. `started_at` field addition (independent)
4. Encoder busy-wait fix (independent, client-side)
5. Client-side fixes (sidebar, volume, console.log — all independent)
6. Integration tests (last — validates everything)
