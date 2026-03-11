# Channel Pins Design

**Goal:** Add per-channel message pinning so members can highlight important messages, plus improve existing user pins for personal bookmarking. System messages announce pin actions in chat.

**Architecture:** New `channel_pins` join table links messages to channels. A `PIN_MESSAGES` permission bit controls access. Pin/unpin actions broadcast WebSocket events and insert system messages. A new `message_type` column on `messages` distinguishes user vs system messages. Client adds a pin drawer, context menu options, and inline pin indicators.

**Tech Stack:** PostgreSQL (migration), axum (REST endpoints), WebSocket broadcast, Solid.js (drawer component, store, context menu).

---

## Data Model

### New table: `channel_pins`

```sql
CREATE TABLE channel_pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(channel_id, message_id)
);
CREATE INDEX idx_channel_pins_channel ON channel_pins(channel_id, pinned_at DESC);
```

### Messages table extension

```sql
ALTER TABLE messages ADD COLUMN message_type VARCHAR(10) NOT NULL DEFAULT 'user'
    CHECK (message_type IN ('user', 'system'));
```

System messages are inserted by the server when a message is pinned. They render with distinct styling (centered, muted, icon).

### New permission bit

```rust
const PIN_MESSAGES = 1 << 25; // Next available after VIEW_CHANNEL (bit 24)
```

Restricted from `@everyone` by default (in `EVERYONE_FORBIDDEN`). Granted to moderators and above via `MODERATOR_DEFAULT`. Admins can grant to other roles via role settings.

### Limits

- Maximum 50 pins per channel (hardcoded, matches Discord).

## API Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/channels/:channel_id/pins` | `VIEW_CHANNEL` | List pinned messages ordered by `pinned_at DESC` |
| `PUT` | `/api/channels/:channel_id/messages/:message_id/pin` | `PIN_MESSAGES` | Pin a message |
| `DELETE` | `/api/channels/:channel_id/messages/:message_id/pin` | `PIN_MESSAGES` | Unpin a message |

### Pin (PUT) behavior

1. Validate message belongs to the channel and is not deleted.
2. Check 50-pin limit — return 409 if full.
3. Insert into `channel_pins` (idempotent — re-pinning returns 200 with no duplicate).
4. Insert system message: `"pinned a message to this channel."` with `message_type = 'system'` and `user_id` = pinner.
5. Broadcast `MessagePinned` WebSocket event.
6. Broadcast `MessageNew` for the system message.

### Unpin (DELETE) behavior

1. Remove from `channel_pins`.
2. Broadcast `MessageUnpinned` WebSocket event.
3. No system message on unpin.

### List (GET) behavior

- Returns full `MessageResponse` objects (with author, attachments, reactions) so the pin drawer can render rich previews.
- Each entry includes `pinned_at` and `pinned_by` metadata.

## WebSocket Events

Two new `ServerEvent` variants:

```rust
MessagePinned {
    channel_id: Uuid,
    message_id: Uuid,
    pinned_by: Uuid,
    pinned_at: String,
}
MessageUnpinned {
    channel_id: Uuid,
    message_id: Uuid,
}
```

Broadcast to all channel subscribers via `broadcast_to_channel()`.

## Extended MessageResponse

- Add `pinned: bool` — derived from LEFT JOIN on `channel_pins` when fetching messages.
- Add `message_type: String` — `"user"` or `"system"`.

The regular message list endpoint (`GET /api/messages/channel/:channel_id`) includes both fields.

## UI Changes

### Channel header

Pin icon (lucide-solid) next to the channel name/topic. Shows pin count badge when > 0. Clicking opens the pins drawer.

### Pins drawer

Side panel (right side) listing all pinned messages for the current channel:
- Message author, avatar, timestamp
- Message content preview (truncated)
- "Jump to message" button (scrolls to and highlights the message in chat)
- "Unpin" button (visible only with `PIN_MESSAGES` permission)

### Message context menu

Add "Pin Message" / "Unpin Message" option, gated by `PIN_MESSAGES` permission. Shows pin icon.

### Message inline indicator

Pinned messages in the regular chat view show a small pin icon next to the timestamp.

### System message rendering

Messages with `message_type: "system"` render as a centered, muted line with a pin icon — e.g. "Alice pinned a message to this channel."

### User pins integration

The existing "Save to personal pins" option stays separate from "Pin to channel". Both coexist in the message context menu.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Pin limit reached (50) | 409 response, toast: "This channel has reached the maximum of 50 pins" |
| Message already pinned | Idempotent 200, no duplicate insert |
| Pin a deleted message | 404, deleted messages can't be pinned |
| Message not in channel | 404, validates `message.channel_id == channel_id` |
| Pinned message gets deleted | `ON DELETE CASCADE` removes pin row; broadcast `MessageUnpinned` |
| No permission | 403 |
| Channel deleted | `ON DELETE CASCADE` removes all pins |

## Testing

**Server integration tests:**
- Pin/unpin CRUD with permission checks
- 50-pin limit enforcement
- Idempotent re-pin
- Cascade on message/channel delete
- System message creation on pin
- `pinned: bool` field in message list response

**Client unit tests:**
- Channel pins store: load, add, remove, count
- Pin drawer rendering
- Context menu option visibility based on permission
- System message rendering

## Dependencies

- No new crates or npm packages required.
- Existing infrastructure: `broadcast_to_channel()`, permission checks, `MessageResponse`, message context menu, lucide-solid icons.

## Interaction with Existing User Pins

User pins (personal bookmarks) and channel pins (shared) are independent systems:
- **User pins:** stored in `user_pins` table, scoped to user, managed via `/api/me/pins`.
- **Channel pins:** stored in `channel_pins` table, scoped to channel, managed via `/api/channels/:channel_id/.../pin`.
- A message can be both channel-pinned and user-pinned by different users independently.
