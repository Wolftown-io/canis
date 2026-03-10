# Channel Pins Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-channel message pinning with a PIN_MESSAGES permission, system messages, WebSocket events, and a pin drawer UI.

**Architecture:** New `channel_pins` join table, `message_type` column on messages, `PIN_MESSAGES` permission bit (1 << 25). Server API follows the reactions pattern (channel-scoped, permission-gated, WebSocket broadcast). Client adds a channel pins store, pin drawer side panel, context menu integration, and inline pin indicators.

**Tech Stack:** PostgreSQL (sqlx), axum, Solid.js, lucide-solid icons, existing WebSocket broadcast infrastructure.

---

### Task 1: Database Migration

**Files:**
- Create: `server/migrations/20260310000000_channel_pins.sql`

**Step 1: Write the migration**

```sql
-- Channel pins: per-channel pinned messages visible to all members
CREATE TABLE channel_pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(channel_id, message_id)
);

CREATE INDEX idx_channel_pins_channel ON channel_pins(channel_id, pinned_at DESC);

COMMENT ON TABLE channel_pins IS 'Per-channel pinned messages, max 50 per channel';

-- Add message_type to distinguish user vs system messages
ALTER TABLE messages ADD COLUMN message_type VARCHAR(10) NOT NULL DEFAULT 'user';
ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
    CHECK (message_type IN ('user', 'system'));
```

**Step 2: Run the migration**

Run: `DATABASE_URL="postgresql://voicechat:voicechat_dev@localhost:5433/voicechat" sqlx migrate run --source server/migrations`
Expected: Migration applied successfully.

**Step 3: Commit**

```bash
git add server/migrations/20260310000000_channel_pins.sql
git commit -m "feat(db): add channel_pins table and message_type column"
```

---

### Task 2: Add PIN_MESSAGES Permission Bit

**Files:**
- Modify: `server/src/permissions/guild.rs`
- Modify: `client/src/lib/permissionConstants.ts`

**Step 1: Add the server-side permission bit**

In `server/src/permissions/guild.rs`, add after `VIEW_CHANNEL` (bit 24):

```rust
        // === Pins (bit 25) ===
        /// Permission to pin and unpin messages in channels
        const PIN_MESSAGES       = 1 << 25;
```

Add `PIN_MESSAGES` to `MODERATOR_DEFAULT`:

```rust
    pub const MODERATOR_DEFAULT: Self = Self::EVERYONE_DEFAULT
        // ... existing ...
        .union(Self::MENTION_EVERYONE)
        .union(Self::PIN_MESSAGES);
```

Add `PIN_MESSAGES` to `EVERYONE_FORBIDDEN`:

```rust
    pub const EVERYONE_FORBIDDEN: Self = Self::VOICE_MUTE_OTHERS
        // ... existing ...
        .union(Self::MENTION_EVERYONE)
        .union(Self::PIN_MESSAGES);
```

**Step 2: Add the client-side permission bit**

In `client/src/lib/permissionConstants.ts`, add after `VIEW_CHANNEL`:

```typescript
  // Pins (bit 25)
  PIN_MESSAGES: 1 << 25,
```

Also add it to the `PERMISSION_INFO` object lower in the file:

```typescript
  PIN_MESSAGES: {
    label: "Pin Messages",
    description: "Allows pinning and unpinning messages in channels",
    category: "moderation",
  },
```

**Step 3: Verify server compiles**

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings`
Expected: Clean build.

**Step 4: Commit**

```bash
git add server/src/permissions/guild.rs client/src/lib/permissionConstants.ts
git commit -m "feat(auth): add PIN_MESSAGES permission bit (1 << 25)"
```

---

### Task 3: Server — Channel Pins API

**Files:**
- Create: `server/src/api/channel_pins.rs`
- Modify: `server/src/api/mod.rs` (add routes + `pub mod channel_pins;`)

**Step 1: Write the channel pins module**

Create `server/src/api/channel_pins.rs` following the reactions API pattern (`server/src/api/reactions.rs`):

```rust
//! Channel Pins API
//!
//! Handlers for pinning and unpinning messages in channels.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

use crate::api::AppState;
use crate::auth::AuthUser;
use crate::chat::messages::build_message_response;
use crate::db;
use crate::permissions::{require_guild_permission, GuildPermissions};
use crate::ws::{broadcast_to_channel, ServerEvent};

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ChannelPinResponse {
    pub message: serde_json::Value,
    pub pinned_by: Uuid,
    pub pinned_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct PinRow {
    id: Uuid,
    message_id: Uuid,
    pinned_by: Uuid,
    pinned_at: DateTime<Utc>,
}

// ============================================================================
// Error Types
// ============================================================================

#[derive(Debug, thiserror::Error)]
pub enum ChannelPinsError {
    #[error("Message not found")]
    MessageNotFound,
    #[error("Channel not found")]
    ChannelNotFound,
    #[error("Not a guild channel")]
    NotGuildChannel,
    #[error("Pin limit reached (50)")]
    PinLimitReached,
    #[error("Forbidden")]
    Forbidden,
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
}

impl IntoResponse for ChannelPinsError {
    fn into_response(self) -> axum::response::Response {
        let (status, code, message) = match &self {
            Self::MessageNotFound => (
                StatusCode::NOT_FOUND,
                "MESSAGE_NOT_FOUND",
                "Message not found",
            ),
            Self::ChannelNotFound => (
                StatusCode::NOT_FOUND,
                "CHANNEL_NOT_FOUND",
                "Channel not found",
            ),
            Self::NotGuildChannel => (
                StatusCode::BAD_REQUEST,
                "NOT_GUILD_CHANNEL",
                "Pins are only supported in guild channels",
            ),
            Self::PinLimitReached => (
                StatusCode::CONFLICT,
                "PIN_LIMIT_REACHED",
                "This channel has reached the maximum of 50 pins",
            ),
            Self::Forbidden => (StatusCode::FORBIDDEN, "FORBIDDEN", "Forbidden"),
            Self::Database(err) => {
                tracing::error!("Database error: {}", err);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    "Database error",
                )
            }
        };
        (
            status,
            Json(serde_json::json!({ "error": code, "message": message })),
        )
            .into_response()
    }
}

const MAX_PINS_PER_CHANNEL: i64 = 50;

// ============================================================================
// Handlers
// ============================================================================

/// List pinned messages for a channel.
/// GET `/api/channels/:channel_id/pins`
pub async fn list_channel_pins(
    State(state): State<AppState>,
    Path(channel_id): Path<Uuid>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, ChannelPinsError> {
    let channel = db::find_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ChannelPinsError::ChannelNotFound)?;

    // Permission check: VIEW_CHANNEL
    crate::permissions::require_channel_access(&state.db, auth_user.id, channel_id)
        .await
        .map_err(|_| ChannelPinsError::Forbidden)?;

    let pins = sqlx::query_as::<_, PinRow>(
        r"
        SELECT cp.id, cp.message_id, cp.pinned_by, cp.pinned_at
        FROM channel_pins cp
        WHERE cp.channel_id = $1
        ORDER BY cp.pinned_at DESC
        ",
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;

    // Build full message responses for each pinned message
    let mut responses = Vec::with_capacity(pins.len());
    for pin in &pins {
        if let Ok(Some(msg)) = db::find_message_by_id(&state.db, pin.message_id).await {
            let msg_response = build_message_response(&state.db, msg, auth_user.id).await;
            responses.push(serde_json::json!({
                "message": msg_response,
                "pinned_by": pin.pinned_by,
                "pinned_at": pin.pinned_at,
            }));
        }
    }

    Ok(Json(responses))
}

/// Pin a message to a channel.
/// PUT `/api/channels/:channel_id/messages/:message_id/pin`
pub async fn pin_message(
    State(state): State<AppState>,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, ChannelPinsError> {
    let channel = db::find_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ChannelPinsError::ChannelNotFound)?;

    let guild_id = channel.guild_id.ok_or(ChannelPinsError::NotGuildChannel)?;

    // Permission check: PIN_MESSAGES
    require_guild_permission(&state.db, guild_id, auth_user.id, GuildPermissions::PIN_MESSAGES)
        .await
        .map_err(|_| ChannelPinsError::Forbidden)?;

    // Verify message exists, belongs to channel, and is not deleted
    let message = db::find_message_by_id(&state.db, message_id)
        .await?
        .ok_or(ChannelPinsError::MessageNotFound)?;

    if message.channel_id != channel_id {
        return Err(ChannelPinsError::MessageNotFound);
    }

    if message.deleted_at.is_some() {
        return Err(ChannelPinsError::MessageNotFound);
    }

    // Check pin limit
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM channel_pins WHERE channel_id = $1",
    )
    .bind(channel_id)
    .fetch_one(&state.db)
    .await?;

    if count.0 >= MAX_PINS_PER_CHANNEL {
        return Err(ChannelPinsError::PinLimitReached);
    }

    // Insert pin (idempotent — ON CONFLICT DO NOTHING)
    let result = sqlx::query(
        r"
        INSERT INTO channel_pins (channel_id, message_id, pinned_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (channel_id, message_id) DO NOTHING
        ",
    )
    .bind(channel_id)
    .bind(message_id)
    .bind(auth_user.id)
    .execute(&state.db)
    .await?;

    // Only broadcast + system message if this was a new pin
    if result.rows_affected() > 0 {
        let pinned_at = Utc::now();

        // Insert system message
        sqlx::query(
            r"
            INSERT INTO messages (channel_id, user_id, content, message_type)
            VALUES ($1, $2, 'pinned a message to this channel.', 'system')
            ",
        )
        .bind(channel_id)
        .bind(auth_user.id)
        .execute(&state.db)
        .await?;

        // Broadcast pin event
        if let Err(e) = broadcast_to_channel(
            &state.redis,
            channel_id,
            &ServerEvent::ChannelPinAdded {
                channel_id,
                message_id,
                pinned_by: auth_user.id,
                pinned_at: pinned_at.to_rfc3339(),
            },
        )
        .await
        {
            tracing::warn!("Failed to broadcast channel_pin_added event: {}", e);
        }
    }

    Ok(StatusCode::OK)
}

/// Unpin a message from a channel.
/// DELETE `/api/channels/:channel_id/messages/:message_id/pin`
pub async fn unpin_message(
    State(state): State<AppState>,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, ChannelPinsError> {
    let channel = db::find_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ChannelPinsError::ChannelNotFound)?;

    let guild_id = channel.guild_id.ok_or(ChannelPinsError::NotGuildChannel)?;

    // Permission check: PIN_MESSAGES
    require_guild_permission(&state.db, guild_id, auth_user.id, GuildPermissions::PIN_MESSAGES)
        .await
        .map_err(|_| ChannelPinsError::Forbidden)?;

    sqlx::query(
        "DELETE FROM channel_pins WHERE channel_id = $1 AND message_id = $2",
    )
    .bind(channel_id)
    .bind(message_id)
    .execute(&state.db)
    .await?;

    // Broadcast unpin event
    if let Err(e) = broadcast_to_channel(
        &state.redis,
        channel_id,
        &ServerEvent::ChannelPinRemoved {
            channel_id,
            message_id,
        },
    )
    .await
    {
        tracing::warn!("Failed to broadcast channel_pin_removed event: {}", e);
    }

    Ok(StatusCode::NO_CONTENT)
}
```

**Step 2: Register routes and module**

In `server/src/api/mod.rs`, add `pub mod channel_pins;` with the other module declarations.

Add routes in the `api_routes` Router, near the reactions routes (around line 299):

```rust
        // Channel pins
        .route(
            "/api/channels/{channel_id}/pins",
            get(channel_pins::list_channel_pins),
        )
        .route(
            "/api/channels/{channel_id}/messages/{message_id}/pin",
            put(channel_pins::pin_message).delete(channel_pins::unpin_message),
        )
```

**Step 3: Add WebSocket event variants**

In `server/src/ws/mod.rs`, add to the `ServerEvent` enum (near `ReactionAdd`/`ReactionRemove`):

```rust
        ChannelPinAdded {
            channel_id: Uuid,
            message_id: Uuid,
            pinned_by: Uuid,
            pinned_at: String,
        },
        ChannelPinRemoved {
            channel_id: Uuid,
            message_id: Uuid,
        },
```

**Step 4: Add `pinned` and `message_type` to MessageResponse**

In `server/src/chat/messages.rs`, add to the `MessageResponse` struct:

```rust
    /// Whether this message is pinned in its channel.
    #[serde(default)]
    pub pinned: bool,
    /// Message type: "user" for normal messages, "system" for system events.
    #[serde(default = "default_message_type")]
    pub message_type: String,
```

Add a default function:

```rust
fn default_message_type() -> String {
    "user".to_string()
}
```

Update the `Message` struct in `server/src/db/models.rs` to include `message_type`:

```rust
    pub message_type: String,
```

Update the `build_message_response` function (or wherever `MessageResponse` is constructed) to populate `pinned` by checking `channel_pins`:

```rust
    // Check if message is pinned
    let pinned = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM channel_pins WHERE message_id = $1)"
    )
    .bind(message.id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);
```

And set `message_type: message.message_type.clone()` in the response.

**Note:** The `build_message_response` function may need adjustment based on its exact signature. Read it before implementing. If it doesn't exist as a standalone function, you may need to create one or modify the message list query to LEFT JOIN `channel_pins`.

**Step 5: Verify server compiles**

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings`
Expected: Clean build (may need to regenerate `.sqlx/` cache).

If sqlx offline check fails, run against live DB:
```bash
DATABASE_URL="postgresql://voicechat:voicechat_dev@localhost:5433/voicechat" cargo sqlx prepare --workspace
```

**Step 6: Commit**

```bash
git add server/src/api/channel_pins.rs server/src/api/mod.rs server/src/ws/mod.rs \
  server/src/chat/messages.rs server/src/db/models.rs .sqlx/
git commit -m "feat(api): channel pins API with PIN_MESSAGES permission"
```

---

### Task 4: Server Integration Tests

**Files:**
- Create: `server/tests/channel_pins_test.rs` (or add to existing test file — check `server/tests/` for the convention)

**Step 1: Check existing test patterns**

Read `server/tests/` directory to understand the test setup — how tests create users, guilds, channels, and messages. Look at reactions tests if they exist, or message tests.

**Step 2: Write integration tests**

Cover these scenarios:
1. **Pin a message** — returns 200, message appears in list
2. **Unpin a message** — returns 204, message disappears from list
3. **Idempotent re-pin** — pinning same message twice returns 200, only one pin in list
4. **Pin limit (50)** — pin 50 messages, then try 51st → 409
5. **Permission denied** — user without PIN_MESSAGES gets 403
6. **Message not in channel** — returns 404
7. **Deleted message** — returns 404
8. **Not a guild channel** — DM channel returns 400
9. **Cascade on message delete** — delete a pinned message, pin row disappears
10. **System message created** — after pinning, a system message exists in the channel
11. **`pinned: bool` in message list** — fetch messages, pinned message has `pinned: true`

**Step 3: Run tests**

Run: `cargo test -p vc-server -- channel_pin`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add server/tests/
git commit -m "test(api): channel pins integration tests"
```

---

### Task 5: Client — Types, API Functions, and Tauri Commands

**Files:**
- Modify: `client/src/lib/types.ts` — add `ChannelPin` type, extend `Message` with `pinned` and `message_type`
- Modify: `client/src/lib/tauri.ts` — add `listChannelPins`, `pinMessage`, `unpinMessage` functions
- Modify: `client/src-tauri/src/commands/chat.rs` — add Tauri commands (if following existing pattern)

**Step 1: Extend TypeScript types**

In `client/src/lib/types.ts`, add to the `Message` interface:

```typescript
  pinned: boolean;
  message_type: string; // "user" | "system"
```

Add new type:

```typescript
export interface ChannelPin {
  message: Message;
  pinned_by: string;
  pinned_at: string;
}
```

**Step 2: Add API functions to tauri.ts**

In `client/src/lib/tauri.ts`, add near the existing pin functions:

```typescript
export async function listChannelPins(channelId: string): Promise<ChannelPin[]> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ChannelPin[]>("list_channel_pins", { channelId });
  }
  return httpRequest<ChannelPin[]>("GET", `/api/channels/${channelId}/pins`);
}

export async function pinMessage(channelId: string, messageId: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("pin_message", { channelId, messageId });
  }
  await httpRequest<void>("PUT", `/api/channels/${channelId}/messages/${messageId}/pin`);
}

export async function unpinMessage(channelId: string, messageId: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("unpin_message", { channelId, messageId });
  }
  await httpRequest<void>("DELETE", `/api/channels/${channelId}/messages/${messageId}/pin`);
}
```

**Step 3: Add Tauri commands**

In `client/src-tauri/src/commands/chat.rs`, add commands following the existing pattern (HTTP proxy via `reqwest`). Check how existing commands like `delete_message` are structured.

Register the new commands in `client/src-tauri/src/lib.rs` builder chain.

**Step 4: Commit**

```bash
git add client/src/lib/types.ts client/src/lib/tauri.ts client/src-tauri/src/commands/chat.rs \
  client/src-tauri/src/lib.rs
git commit -m "feat(client): channel pins types, API functions, and Tauri commands"
```

---

### Task 6: Client — Channel Pins Store

**Files:**
- Create: `client/src/stores/channelPins.ts`
- Modify: `client/src/stores/websocket.ts` — handle `ChannelPinAdded` / `ChannelPinRemoved` events

**Step 1: Create the channel pins store**

```typescript
import { createSignal } from "solid-js";
import type { ChannelPin } from "@/lib/types";
import { listChannelPins, pinMessage as apiPinMessage, unpinMessage as apiUnpinMessage } from "@/lib/tauri";

const [channelPins, setChannelPins] = createSignal<ChannelPin[]>([]);
const [isPinsLoading, setIsPinsLoading] = createSignal(false);
const [pinsChannelId, setPinsChannelId] = createSignal<string | null>(null);

export { channelPins, isPinsLoading, pinsChannelId };

export async function loadChannelPins(channelId: string): Promise<void> {
  setIsPinsLoading(true);
  setPinsChannelId(channelId);
  try {
    const pins = await listChannelPins(channelId);
    setChannelPins(pins);
  } catch (err) {
    console.error("Failed to load channel pins:", err);
    setChannelPins([]);
  } finally {
    setIsPinsLoading(false);
  }
}

export async function pinMessageAction(channelId: string, messageId: string): Promise<void> {
  await apiPinMessage(channelId, messageId);
}

export async function unpinMessageAction(channelId: string, messageId: string): Promise<void> {
  await apiUnpinMessage(channelId, messageId);
}

export function handlePinAdded(channelId: string, messageId: string, pinnedBy: string, pinnedAt: string): void {
  if (pinsChannelId() === channelId) {
    // Reload pins to get full message data
    loadChannelPins(channelId);
  }
}

export function handlePinRemoved(channelId: string, messageId: string): void {
  if (pinsChannelId() === channelId) {
    setChannelPins((prev) => prev.filter((p) => p.message.id !== messageId));
  }
}

export function pinCount(): number {
  return channelPins().length;
}

export function isMessagePinned(messageId: string): boolean {
  return channelPins().some((p) => p.message.id === messageId);
}

export function clearChannelPins(): void {
  setChannelPins([]);
  setPinsChannelId(null);
}
```

**Step 2: Wire WebSocket events**

In `client/src/stores/websocket.ts`, add handlers for the new events. Find where other events like `reaction_add` are handled and add:

```typescript
case "channel_pin_added":
  handlePinAdded(event.channel_id, event.message_id, event.pinned_by, event.pinned_at);
  break;
case "channel_pin_removed":
  handlePinRemoved(event.channel_id, event.message_id);
  break;
```

Import `handlePinAdded` and `handlePinRemoved` from `@/stores/channelPins`.

**Step 3: Also update message `pinned` field on WebSocket events**

When a `channel_pin_added` event is received, update the message in the messages store to set `pinned: true`. When `channel_pin_removed`, set `pinned: false`. Check how the message store handles `message_edit` events for the pattern.

**Step 4: Commit**

```bash
git add client/src/stores/channelPins.ts client/src/stores/websocket.ts
git commit -m "feat(client): channel pins store with WebSocket event handling"
```

---

### Task 7: Client — Pin Drawer Component

**Files:**
- Create: `client/src/components/channels/PinDrawer.tsx`

**Step 1: Build the pin drawer**

The pin drawer is a side panel that slides in from the right when the pin icon in the channel header is clicked. Reference the thread view or any existing side panel in the codebase.

```typescript
import { Component, For, Show } from "solid-js";
import { Pin } from "lucide-solid";
import { channelPins, isPinsLoading, unpinMessageAction } from "@/stores/channelPins";
import type { ChannelPin } from "@/lib/types";

// ... component implementation
```

Contents of each pin entry:
- Author avatar + name + pinned timestamp
- Message content preview (first ~200 chars, rendered as markdown if possible, or plain text)
- "Jump" button — scrolls to the message in the channel
- "Unpin" button — visible only if user has `PIN_MESSAGES` permission

**Step 2: Commit**

```bash
git add client/src/components/channels/PinDrawer.tsx
git commit -m "feat(client): pin drawer side panel component"
```

---

### Task 8: Client — Channel Header Pin Button

**Files:**
- Modify: `client/src/views/Main.tsx` — add pin icon button in channel header

**Step 1: Add pin button to channel header**

In `client/src/views/Main.tsx`, find the channel header (around line 186). Add a pin icon button after the channel topic:

```tsx
<button
  onClick={() => togglePinDrawer()}
  class="ml-auto p-1.5 rounded hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors relative"
  title="Pinned Messages"
>
  <Pin class="w-4 h-4" />
  <Show when={pinCount() > 0}>
    <span class="absolute -top-1 -right-1 bg-accent-primary text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
      {pinCount()}
    </span>
  </Show>
</button>
```

Add state for drawer visibility:

```typescript
const [showPinDrawer, setShowPinDrawer] = createSignal(false);
```

Render the `PinDrawer` component conditionally when `showPinDrawer()` is true.

Load pins when channel changes:

```typescript
createEffect(() => {
  const ch = channel();
  if (ch) loadChannelPins(ch.id);
});
```

**Step 2: Commit**

```bash
git add client/src/views/Main.tsx
git commit -m "feat(client): pin button in channel header with count badge"
```

---

### Task 9: Client — Message Context Menu Pin/Unpin

**Files:**
- Modify: `client/src/components/messages/MessageActions.tsx` (or the context menu component)

**Step 1: Find the context menu component**

Read `MessageActions.tsx` and trace where `onShowContextMenu` is handled. Find the context menu component that renders items like "Edit Message", "Delete Message", etc. This is where "Pin Message" / "Unpin Message" goes.

**Step 2: Add pin/unpin context menu item**

Add a menu item gated by `PIN_MESSAGES` permission:

```tsx
<Show when={hasPermission(memberPermissions(), PermissionBits.PIN_MESSAGES)}>
  <button onClick={() => isPinned ? handleUnpin() : handlePin()}>
    <Pin class="w-4 h-4" />
    {isPinned ? "Unpin Message" : "Pin Message"}
  </button>
</Show>
```

The `handlePin` / `handleUnpin` functions call `pinMessageAction(channelId, messageId)` / `unpinMessageAction(channelId, messageId)` from the channel pins store.

**Step 3: Add inline pin indicator**

In the message rendering component (`MessageItem.tsx` or similar), add a small pin icon next to the timestamp when `message.pinned` is true:

```tsx
<Show when={props.message.pinned}>
  <Pin class="w-3 h-3 text-text-secondary inline ml-1" />
</Show>
```

**Step 4: Commit**

```bash
git add client/src/components/messages/
git commit -m "feat(client): pin/unpin in message context menu with inline indicator"
```

---

### Task 10: Client — System Message Rendering

**Files:**
- Modify: `client/src/components/messages/MessageItem.tsx` (or the message list component)

**Step 1: Add system message rendering**

When `message.message_type === "system"`, render the message differently — centered, muted text, pin icon, no avatar:

```tsx
<Show
  when={props.message.message_type !== "system"}
  fallback={
    <div class="flex items-center justify-center gap-2 py-2 text-xs text-text-secondary">
      <Pin class="w-3 h-3" />
      <span>
        <strong class="text-text-primary">{props.message.author.display_name}</strong>
        {" "}{props.message.content}
      </span>
    </div>
  }
>
  {/* Normal message rendering */}
</Show>
```

**Step 2: Commit**

```bash
git add client/src/components/messages/
git commit -m "feat(client): system message rendering for pin notifications"
```

---

### Task 11: Client Unit Tests

**Files:**
- Create: `client/src/stores/__tests__/channelPins.test.ts`

**Step 1: Write unit tests**

Test the channel pins store functions:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock tauri.ts
vi.mock("@/lib/tauri", () => ({
  listChannelPins: vi.fn(),
  pinMessage: vi.fn(),
  unpinMessage: vi.fn(),
}));

describe("channelPins store", () => {
  // Test loadChannelPins populates the signal
  // Test handlePinAdded triggers reload for matching channel
  // Test handlePinRemoved removes pin from list
  // Test isMessagePinned returns correct boolean
  // Test pinCount returns correct count
  // Test clearChannelPins resets state
});
```

**Step 2: Run tests**

Run: `cd client && bun run test:run`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add client/src/stores/__tests__/channelPins.test.ts
git commit -m "test(client): channel pins store unit tests"
```

---

### Task 12: CHANGELOG and Final Verification

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add CHANGELOG entry**

Under `[Unreleased]` → `### Added`:

```markdown
- Channel message pinning — pin up to 50 messages per channel with `PIN_MESSAGES` permission, pin drawer in channel header, pin/unpin via message context menu, inline pin indicators, and system messages announcing pin actions (#XXX)
```

Replace `#XXX` with the PR number after creation.

**Step 2: Run full test suite**

```bash
cd client && bun run test:run
SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings
cargo test -p vc-server
```

**Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "chore(client): add channel pins CHANGELOG entry"
```
