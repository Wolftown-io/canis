# Message Editing — Client Integration Design

**Date:** 2026-03-06
**Status:** Approved
**Scope:** Client-side only (server API, WebSocket broadcast, and incoming event handling already complete)

## Context

The server PATCH `/api/messages/:id` endpoint is fully implemented with owner validation, content filtering, and `MessageEdit` WebSocket broadcast. The client already handles incoming `message_edit` events (updating content and `edited_at` in the message store) and renders the "(edited)" indicator. The entire client-side *sending* path is missing.

## Design

### API Layer

Add `editMessage(messageId, content)` to `client/src/lib/tauri.ts`, following the existing dual-mode pattern:

- **Tauri mode:** `invoke("edit_message", { messageId, content })`
- **Browser mode:** `httpRequest<Message>("PATCH", /api/messages/${messageId}, { content })`
- Returns `Promise<Message>`
- Placed after the existing `deleteMessage()` function

### Edit State Management

A store-level signal `editingMessageId` (exported from the messages/websocket store) tracks which message is currently being edited.

- Only one message can be edited at a time; starting a new edit cancels any in-progress edit.
- `MessageItem` checks `editingMessageId() === props.message.id` to determine edit mode.

Local signals inside MessageItem when editing:
- `editContent` — textarea value, initialized from `props.message.content`
- `isSaving` — loading state during the API call

Lifecycle:
1. User triggers edit → sets `editingMessageId` to the message ID.
2. MessageItem detects active edit → shows textarea pre-filled with raw content.
3. **Enter** → calls `editMessage()`. On success, clears `editingMessageId`. On error, shows toast, keeps textarea open.
4. **Escape** → clears `editingMessageId` (no API call).
5. **Content unchanged + Enter** → treated as cancel (no API call).
6. **Shift+Enter** → inserts newline (consistent with MessageInput).

### Inline Edit UI

When the message is in edit mode, the rendered markdown content is replaced with a `<textarea>`:

- Auto-focused, pre-filled with `message.content` (raw markdown)
- Auto-resizes to fit content (reuse existing `resizeTextarea` pattern)
- Below the textarea: hint text `escape to cancel · enter to save`
- Message container gets a subtle highlight border
- Author name, avatar, and timestamp remain visible — only the content area swaps

```
┌─ avatar ── username ── timestamp ─────────────────┐
│  ┌──────────────────────────────────────────────┐  │
│  │ Hello wrold! I mean world!█                  │  │
│  └──────────────────────────────────────────────┘  │
│  escape to cancel · enter to save                  │
└────────────────────────────────────────────────────┘
```

Error handling: if `editMessage()` fails (403 content filtered, 404 message deleted, network error), show a toast notification and keep the textarea open so the user's edit is not lost.

### Entry Points

**Context menu** (`MessageItem.tsx` `handleContextMenu`):
- "Edit Message" item with `Pencil` icon from lucide-solid
- Only shown for own messages (`isOwn` guard, same as Delete)
- Positioned before the Delete item, after a separator

**Hover action bar** (`MessageActions.tsx`):
- Pencil icon button, shown only for own messages
- Positioned before the divider/"more actions" button
- New props: `isOwn?: boolean`, `onEdit?: () => void`

### Files Changed

| File | Change |
|------|--------|
| `client/src/lib/tauri.ts` | Add `editMessage()` function |
| `client/src/components/messages/MessageItem.tsx` | Edit state, inline textarea UI, context menu entry |
| `client/src/components/messages/MessageActions.tsx` | Pencil button for own messages |
| `client/src/stores/websocket.ts` | Export `editingMessageId` signal |

No new files, no server changes, no new dependencies.
