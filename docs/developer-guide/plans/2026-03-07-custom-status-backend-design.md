# Custom Status Backend Support — Design

**Date:** 2026-03-07
**Phase:** 6 (Competitive Differentiators & Mastery)
**Status:** Approved

## Goal

Add user-settable custom status (text + emoji + optional expiry) to the presence system. The client UI already exists (StatusPicker, CustomStatusModal, UserPanel rendering). This design covers the backend implementation, WebSocket event wiring, server-side expiry, and client integration.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Expiry enforcement | Hybrid (client timer + server sweep) | Client timer for instant UX, server sweep as authoritative fallback |
| Storage | JSONB column on `users` table | Consistent with existing `activity JSONB` pattern |
| WebSocket event | Dedicated `CustomStatusUpdate` event | Follows existing pattern (`PresenceUpdate`, `RichPresenceUpdate` are separate). Self-explanatory name over generic `Patch` |
| Expiry cleanup | 60-second periodic sweep | Broadcasts to friends in real time when status expires |
| Connect flow | Send all presence data (status + activity + custom_status) | Fixes pre-existing gap where friends' activities weren't sent on connect |
| Offline/invisible | Hide custom status | Custom status remains in DB but is not sent to friends when user is offline/invisible |
| Content filtering | Skip (cross-guild/personal) | Same rationale as DM messages skipping guild content filters |
| Emoji field limit | 10 grapheme clusters | Allows emoji combos; validated via `unicode-segmentation` crate |
| `status_message` column | Keep as-is for now | May be deprecated in a future phase |
| camelCase fixes | Separate `refactor/snake-case-convention` task | 22 fields across preferences/focus/etc. — out of scope for this feature |

## Database Schema

### Migration

```sql
ALTER TABLE users ADD COLUMN custom_status JSONB;

-- Partial index for periodic expiry sweep
CREATE INDEX idx_users_custom_status_expires_at
  ON users ((custom_status->>'expires_at'))
  WHERE custom_status IS NOT NULL
    AND custom_status->>'expires_at' IS NOT NULL;
```

### JSONB Structure

```json
{
  "text": "In a meeting",
  "emoji": "📅",
  "expires_at": "2026-03-07T15:00:00Z"
}
```

- `text` — required, 1-128 chars after trim
- `emoji` — optional, 1-10 grapheme clusters
- `expires_at` — optional, ISO 8601 UTC timestamp, must be in the future
- Clearing custom status sets column to `NULL`

## Rust Types

```rust
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct CustomStatus {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
}
```

## WebSocket Events

### Client to Server

```rust
SetCustomStatus { custom_status: Option<CustomStatus> }
// None = clear custom status
```

### Server to Client

```rust
CustomStatusUpdate {
    user_id: Uuid,
    custom_status: Option<CustomStatus>,
}
// None = status was cleared (manually or by expiry)
```

## Validation

### Custom Status Fields

- `text`: 1-128 chars after whitespace trim, reject empty-after-trim
- `emoji`: 0-10 grapheme clusters (via `unicode-segmentation` crate, MIT/Apache-2.0, already a transitive dependency)
- `expires_at`: must be in the future if provided
- Rate limit: 10-second minimum between updates (matches `ACTIVITY_UPDATE_INTERVAL`)

### Unicode Safety (applied to text + emoji fields)

- Reject control characters (Cc category) except space
- Reject format characters (Cf category): zero-width space (`U+200B`), zero-width non-joiner (`U+200C`), zero-width joiner (`U+200D`)
- Reject bidi override characters: `U+202C`, `U+202D`, `U+202E`
- Limit combining marks: max 3 combining marks per base character (prevents Zalgo text / display DoS)

### Existing Validation Fixes (same Unicode safety rules)

- `Activity::validate()` in `server/src/presence/types.rs` — extend with format char + combining mark filtering
- Display name validation in `server/src/auth/handlers.rs` — extend with format char + combining mark filtering
- Extract shared `validate_unicode_text()` helper for reuse

## Offline/Invisible Behavior

- When a user's base status is `offline` or `invisible`, their custom status is **hidden** from friends
- On connect flow: only send `CustomStatusUpdate` for friends whose base status is not offline
- On `PresenceUpdate` to offline/invisible: also broadcast `CustomStatusUpdate { custom_status: None }` to hide it from friends
- The custom status **remains in the DB** — it reappears when the user comes back online
- If a custom status expires while the user is offline, the sweep clears it in DB; on next connect the user sees no custom status

## Expiry Sweep

- Background `tokio::spawn` task, started during server initialization
- Runs every 60 seconds
- Steps:
  1. Query: `SELECT id FROM users WHERE custom_status IS NOT NULL AND custom_status->>'expires_at' IS NOT NULL AND (custom_status->>'expires_at')::timestamptz <= NOW()`
  2. Clear: `UPDATE users SET custom_status = NULL WHERE id = ANY($1)`
  3. Broadcast: `CustomStatusUpdate { user_id, custom_status: None }` via Redis `presence:{user_id}` for each cleared user
- Graceful shutdown via existing `CancellationToken`
- Logging at `debug!` level when statuses are cleared
- Client keeps local `setTimeout` for instant local UX (existing `customStatusClearTimer` pattern in `presence.ts`)

## Connect Flow (Holistic Fix)

### Current Problem

`get_friends_presence()` returns `Vec<(Uuid, String)>` — only user ID and base status. Friends' activities and custom statuses are not sent on connect.

### Solution

Introduce `FriendPresenceSnapshot`:

```rust
struct FriendPresenceSnapshot {
    user_id: Uuid,
    status: String,
    activity: Option<serde_json::Value>,
    custom_status: Option<serde_json::Value>,
}
```

Extended query:

```sql
SELECT
    CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END as user_id,
    u.status::text,
    u.activity,
    u.custom_status
FROM friendships f
JOIN users u ON u.id = CASE
    WHEN f.requester_id = $1 THEN f.addressee_id
    ELSE f.requester_id
END
WHERE (f.requester_id = $1 OR f.addressee_id = $1)
  AND f.status = 'accepted'
```

On connect, for each friend:
1. Always send `PresenceUpdate { user_id, status }`
2. If `activity` is not null and status is not offline: send `RichPresenceUpdate { user_id, activity }`
3. If `custom_status` is not null and status is not offline: send `CustomStatusUpdate { user_id, custom_status }`

## Client Changes

### `UserPanel.tsx`

Connect `handleCustomStatusSave` to `setMyCustomStatus()`:

```typescript
const handleCustomStatusSave = async (status: CustomStatus | null) => {
  await setMyCustomStatus(status);
};
```

### `presence.ts`

- `setMyCustomStatus()`: send `SetCustomStatus` WebSocket message instead of HTTP `updateCustomStatus()` workaround
- Add handler for incoming `CustomStatusUpdate` event: update `presenceState.users[userId].customStatus`
- Keep local expiry timer for instant UX

### `tauri.ts`

- Remove `updateCustomStatus()` HTTP workaround function
- Custom status now flows through WebSocket, not HTTP profile update

### `types.ts`

- Rename `expiresAt` to `expires_at` in `CustomStatus` interface (required for server compat; part of the broader snake_case convention but must be done here)

## Files Changed

| Layer | File | Change |
|-------|------|--------|
| Migration | `server/migrations/YYYYMMDD_add_custom_status.sql` | Add `custom_status JSONB` column + partial index |
| Models | `server/src/db/models.rs` | `CustomStatus` struct |
| Validation | `server/src/presence/types.rs` | Shared `validate_unicode_text()` helper, fix `Activity::validate()` |
| Auth | `server/src/auth/handlers.rs` | Fix display name validation (combining marks, format chars) |
| WS events | `server/src/ws/mod.rs` | `SetCustomStatus` client event, `CustomStatusUpdate` server event |
| WS handler | `server/src/ws/mod.rs` | Handle `SetCustomStatus`: validate, persist, broadcast |
| WS connect | `server/src/ws/mod.rs` | `FriendPresenceSnapshot`, send all presence data on connect |
| WS presence | `server/src/ws/mod.rs` | Hide custom status on offline/invisible transition |
| Sweep task | `server/src/ws/mod.rs` or new module | Periodic expiry cleanup with broadcast |
| Client types | `client/src/lib/types.ts` | Rename `expiresAt` to `expires_at` |
| Client store | `client/src/stores/presence.ts` | Wire WS send + handle incoming event |
| Client panel | `client/src/components/layout/UserPanel.tsx` | Connect `handleCustomStatusSave` |
| Client tauri | `client/src/lib/tauri.ts` | Remove HTTP workaround |

## Testing

### Server Integration Tests

- Set custom status via WS, verify DB update and broadcast to friend
- Clear custom status, verify NULL in DB and broadcast
- Validation errors: text too long, empty text, combining mark abuse, format chars, emoji too many graphemes, `expires_at` in past
- Expiry sweep: insert expired status, trigger sweep, verify cleared + broadcast
- Connect flow: friend has custom status + activity, verify both sent on connect
- Connect flow: offline friend has custom status, verify it is NOT sent
- Rate limiting: rapid updates rejected (10s interval)
- Offline transition hides custom status from friends
- Coming back online reveals custom status to friends

### Client Unit Tests

- `setMyCustomStatus()` sends correct WS message format
- Incoming `CustomStatusUpdate` updates `presenceState`
- Expiry timer auto-clears status locally
- `handleCustomStatusSave` calls `setMyCustomStatus()`

## Out of Scope

- **`refactor/snake-case-convention`** — fix 22 camelCase fields across DisplayPreferences, FocusMode, FocusState, UserPreferences; document snake_case convention in developer standards and CLAUDE.md
- **`status_message` deprecation** — column stays as-is; consider removal in a future phase
- **Multi-node sweep coordination** — current design assumes single-node; add Valkey distributed lock when multi-node deployment is needed
