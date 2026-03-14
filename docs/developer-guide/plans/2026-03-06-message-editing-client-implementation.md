# Message Editing Client Integration — Implementation Plan


**Goal:** Wire up client-side message editing — API function, edit state signal, inline textarea UI, context menu entry, and hover pencil button.

**Architecture:** Local edit state per MessageItem driven by a store-level `editingMessageId` signal (only one message editable at a time). Inline `<textarea>` replaces rendered content during edit. `editMessage()` in tauri.ts calls `PATCH /api/messages/:id`.

**Tech Stack:** Solid.js, TypeScript, lucide-solid, vitest

**Design doc:** `docs/plans/2026-03-06-message-editing-client-design.md`

---

### Task 1: Add `editMessage()` to tauri.ts

**Files:**
- Modify: `client/src/lib/tauri.ts:4128-4135` (after `deleteMessage`)
- Test: `client/src/lib/__tests__/tauriEditMessage.test.ts` (new)

**Step 1: Write the failing test**

Create `client/src/lib/__tests__/tauriEditMessage.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editMessage } from "../tauri";

describe("editMessage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("sends PATCH request with content in browser mode", async () => {
    const updatedMessage = {
      id: "msg-1",
      channel_id: "ch-1",
      content: "updated content",
      edited_at: "2026-03-06T12:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(updatedMessage)),
      }),
    );

    const result = await editMessage("msg-1", "updated content");

    expect(result).toEqual(updatedMessage);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/messages\/msg-1$/),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ content: "updated content" }),
      }),
    );
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: vi.fn().mockResolvedValue("CONTENT_FILTERED"),
      }),
    );

    await expect(editMessage("msg-1", "bad content")).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd client && bun run test:run -- --reporter=verbose tauriEditMessage`
Expected: FAIL — `editMessage` is not exported from `../tauri`

**Step 3: Write minimal implementation**

In `client/src/lib/tauri.ts`, add after the `deleteMessage` function (after line 4135):

```typescript
/**
 * Edit a message (own messages only).
 */
export async function editMessage(
  messageId: string,
  content: string,
): Promise<Message> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("edit_message", { messageId, content });
  }

  return httpRequest<Message>("PATCH", `/api/messages/${messageId}`, {
    content,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd client && bun run test:run -- --reporter=verbose tauriEditMessage`
Expected: PASS (2 tests)

**Step 5: Commit**

```
feat(client): add editMessage API function

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 2: Add `editingMessageId` signal to messages store

**Files:**
- Modify: `client/src/stores/messages.ts` (add signal export)
- Test: `client/src/stores/__tests__/messages.test.ts` (add tests)

**Step 1: Write the failing tests**

Add to the end of `client/src/stores/__tests__/messages.test.ts`:

```typescript
describe("editingMessageId", () => {
  it("is null initially", () => {
    expect(editingMessageId()).toBeNull();
  });

  it("can be set and cleared", () => {
    setEditingMessageId("msg-1");
    expect(editingMessageId()).toBe("msg-1");

    setEditingMessageId(null);
    expect(editingMessageId()).toBeNull();
  });

  it("setting a new ID replaces the previous one", () => {
    setEditingMessageId("msg-1");
    setEditingMessageId("msg-2");
    expect(editingMessageId()).toBe("msg-2");
  });
});
```

Update the import at the top of the test file to include `editingMessageId` and `setEditingMessageId`:

```typescript
import {
  messagesState,
  setMessagesState,
  loadMessages,
  loadInitialMessages,
  sendMessage,
  addMessage,
  updateMessage,
  removeMessage,
  getChannelMessages,
  isLoadingMessages,
  hasMoreMessages,
  clearChannelMessages,
  clearCurve25519KeyCache,
  editingMessageId,
  setEditingMessageId,
} from "../messages";
```

**Step 2: Run test to verify it fails**

Run: `cd client && bun run test:run -- --reporter=verbose messages.test`
Expected: FAIL — `editingMessageId` is not exported

**Step 3: Write minimal implementation**

In `client/src/stores/messages.ts`, add near the top after the existing imports (around line 14, after the `showToast` import):

```typescript
import { createSignal } from "solid-js";
```

Then add after the `clearCurve25519KeyCache` function (after line 38):

```typescript
// ============================================================================
// Edit State
// ============================================================================

/**
 * Tracks which message is currently being edited (only one at a time).
 * null means no message is being edited.
 */
const [editingMessageId, setEditingMessageId] = createSignal<string | null>(null);
export { editingMessageId, setEditingMessageId };
```

**Step 4: Run test to verify it passes**

Run: `cd client && bun run test:run -- --reporter=verbose messages.test`
Expected: PASS (all existing + 3 new tests)

**Step 5: Commit**

```
feat(client): add editingMessageId signal to messages store

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 3: Add pencil button to MessageActions

**Files:**
- Modify: `client/src/components/messages/MessageActions.tsx:12-25,43-111`

**Step 1: Add props**

In `MessageActions.tsx`, add to the `MessageActionsProps` interface (after line 24):

```typescript
/** Whether the current user owns this message */
isOwn?: boolean;
/** Callback to enter edit mode */
onEdit?: () => void;
```

Add the `Pencil` import to the lucide-solid import (line 9):

```typescript
import { SmilePlus, MoreHorizontal, MessageSquareMore, Pencil } from "lucide-solid";
```

**Step 2: Add the pencil button**

In the JSX, add the edit button before the divider (before line 98 `{/* Divider */}`):

```tsx
{/* Edit button (own messages only) */}
<Show when={props.isOwn && props.onEdit}>
  <button
    class="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors"
    data-testid="message-action-edit"
    onClick={() => props.onEdit?.()}
    title="Edit Message"
    aria-label="Edit Message"
  >
    <Pencil class="w-4 h-4" />
  </button>
</Show>
```

**Step 3: Run lint check**

Run: `cd client && bunx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```
feat(client): add pencil edit button to message hover actions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 4: Wire edit entry points and inline edit UI in MessageItem

This is the main task — context menu entry, MessageActions wiring, and inline textarea.

**Files:**
- Modify: `client/src/components/messages/MessageItem.tsx`

**Step 1: Add imports**

Add to the lucide-solid import (line 13-21), append `Pencil`:

```typescript
import {
  File,
  Download,
  Copy,
  Link,
  Hash,
  Trash2,
  Flag,
  MessageSquareMore,
  Pencil,
} from "lucide-solid";
```

Add `editMessage` to the tauri import (line 31-36):

```typescript
import {
  getSignedUrl,
  addReaction,
  removeReaction,
  deleteMessage,
  editMessage,
} from "@/lib/tauri";
```

Add the editing signal import (line 45):

```typescript
import { removeMessage } from "@/stores/messages";
```

Change to:

```typescript
import { removeMessage, editingMessageId, setEditingMessageId } from "@/stores/messages";
```

**Step 2: Add edit state inside the component**

Inside the `MessageItem` component function (after line 277 `const isEdited = () => !!props.message.edited_at;`), add:

```typescript
const isBeingEdited = () => editingMessageId() === props.message.id;
const [editContent, setEditContent] = createSignal("");
const [isSavingEdit, setIsSavingEdit] = createSignal(false);
let editTextareaRef: HTMLTextAreaElement | undefined;

const startEdit = () => {
  setEditContent(props.message.content);
  setEditingMessageId(props.message.id);
  // Auto-focus happens in onMount/createEffect when textarea renders
};

const cancelEdit = () => {
  if (editingMessageId() === props.message.id) {
    setEditingMessageId(null);
  }
};

const saveEdit = async () => {
  const newContent = editContent().trim();
  if (!newContent || newContent === props.message.content) {
    cancelEdit();
    return;
  }

  setIsSavingEdit(true);
  try {
    await editMessage(props.message.id, newContent);
    setEditingMessageId(null);
  } catch (err) {
    console.error("Failed to edit message:", err);
    showToast({
      type: "error",
      title: "Edit Failed",
      message: err instanceof Error ? err.message : "Could not edit message.",
      duration: 5000,
    });
    // Keep textarea open so user doesn't lose their edit
  } finally {
    setIsSavingEdit(false);
  }
};

const handleEditKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    e.preventDefault();
    cancelEdit();
  } else if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void saveEdit();
  }
};

const resizeEditTextarea = () => {
  if (!editTextareaRef) return;
  editTextareaRef.style.height = "auto";
  const newHeight = Math.min(Math.max(editTextareaRef.scrollHeight, 24), 192);
  editTextareaRef.style.height = `${newHeight}px`;
};
```

**Step 3: Add "Edit Message" to context menu**

In `handleContextMenu` (line 468), before the existing `if (isOwn)` block that adds Delete, insert:

```typescript
if (isOwn) {
  items.push(
    { separator: true },
    {
      label: "Edit Message",
      icon: Pencil,
      action: () => startEdit(),
    },
    {
      label: "Delete Message",
      icon: Trash2,
      danger: true,
      // ... existing delete handler ...
```

This replaces the existing `if (isOwn)` block. The separator, Edit, then Delete all go in the same block.

Full replacement of lines 468-487:

```typescript
    if (isOwn) {
      items.push(
        { separator: true },
        {
          label: "Edit Message",
          icon: Pencil,
          action: () => startEdit(),
        },
        {
          label: "Delete Message",
          icon: Trash2,
          danger: true,
          action: async () => {
            if (confirm("Delete this message? This cannot be undone.")) {
              try {
                await deleteMessage(msg.id);
                removeMessage(msg.channel_id, msg.id);
              } catch (e) {
                console.error("Failed to delete message:", e);
              }
            }
          },
        },
      );
    }
```

**Step 4: Wire MessageActions props**

Update the `<MessageActions>` usage (lines 539-548) to pass `isOwn` and `onEdit`:

```tsx
<MessageActions
  onAddReaction={handleAddReaction}
  onShowContextMenu={handleContextMenu}
  guildId={props.guildId}
  isThreadReply={!!props.message.parent_id || !!props.isInsideThread}
  onReplyInThread={
    props.isInsideThread ? undefined : () => openThread(props.message)
  }
  threadsEnabled={props.threadsEnabled}
  isOwn={currentUser()?.id === props.message.author.id}
  onEdit={startEdit}
/>
```

**Step 5: Replace content area with edit textarea when editing**

Replace the content `<div>` block (lines 573-597) with a `<Show>` that switches between edit mode and display mode:

```tsx
<Show
  when={!isBeingEdited()}
  fallback={
    <div class="mt-1">
      <textarea
        ref={(el) => {
          editTextareaRef = el;
          // Auto-focus and resize on mount
          requestAnimationFrame(() => {
            el.focus();
            el.selectionStart = el.value.length;
            resizeEditTextarea();
          });
        }}
        class="w-full bg-surface-base border border-accent-primary/50 rounded-lg px-3 py-2 text-text-primary text-sm resize-none focus:outline-none focus:border-accent-primary transition-colors"
        value={editContent()}
        onInput={(e) => {
          setEditContent(e.currentTarget.value);
          resizeEditTextarea();
        }}
        onKeyDown={handleEditKeyDown}
        disabled={isSavingEdit()}
        rows={1}
      />
      <div class="text-xs text-text-secondary mt-1">
        escape to cancel · enter to save
      </div>
    </div>
  }
  <div
    ref={contentRef}
    class="text-text-primary break-words leading-relaxed prose prose-invert max-w-none"
  >
    <For each={contentBlocks()}>
      {(block) => (
        <Show
          when={block.type === "code"}
          fallback={<div innerHTML={(block as TextBlock).html} />}
        >
          <CodeBlock language={(block as CodeBlockData).language}>
            {(block as CodeBlockData).code}
          </CodeBlock>
        </Show>
      )}
    </For>
    <Show when={isEdited()}>
      <span
        class="text-xs text-text-secondary/70 ml-1.5 align-super"
        title={`Edited ${formatTimestamp(props.message.edited_at!)}`}
      >
        (edited)
      </span>
    </Show>
  </div>
</Show>
```

**Step 6: Add highlight border when editing**

In the root `<div>` of the component (line 502), add a conditional class for edit mode:

```tsx
class={`group relative flex gap-4 px-4 py-0.5 hover:bg-white/3 transition-colors ${
  props.compact ? "mt-0" : "mt-4"
} ${isBeingEdited() ? "bg-accent-primary/5 ring-1 ring-accent-primary/20 rounded-lg" : ""}`}
```

**Step 7: Run type check and lint**

Run: `cd client && bunx tsc --noEmit`
Expected: No type errors

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings` (shouldn't be affected but verify)
Expected: No warnings

**Step 8: Commit**

```
feat(client): add inline message editing with context menu and hover button

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 5: Manual QA verification

**Step 1: Start dev environment**

Run:
```bash
podman compose -f docker-compose.dev.yml --profile storage up -d
cd client && bun run dev
```

**Step 2: Test edit flow**

1. Send a message in any channel
2. Right-click the message → verify "Edit Message" appears with pencil icon (only on own messages)
3. Click "Edit Message" → verify inline textarea appears with message content
4. Edit the text and press Enter → verify message updates and shows "(edited)"
5. Right-click another own message → click Edit → verify previous edit is cancelled
6. Enter edit mode → press Escape → verify edit is cancelled, original content restored
7. Enter edit mode → don't change anything → press Enter → verify it cancels (no API call)
8. Hover over own message → verify pencil icon appears in action bar
9. Click pencil icon → verify edit mode starts
10. Hover over someone else's message → verify no pencil icon
11. Right-click someone else's message → verify no "Edit Message" item

**Step 3: Test error handling**

1. Enter edit mode → disconnect network → try to save → verify error toast appears and textarea stays open

**Step 4: Run all client tests**

Run: `cd client && bun run test:run`
Expected: All tests pass

**Step 5: Final commit (if any fixes needed)**

```
fix(client): address QA findings from message editing

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | `editMessage()` API function + test | `tauri.ts`, `tauriEditMessage.test.ts` (new) |
| 2 | `editingMessageId` signal + tests | `messages.ts`, `messages.test.ts` |
| 3 | Pencil button in MessageActions | `MessageActions.tsx` |
| 4 | Context menu + inline edit UI | `MessageItem.tsx` |
| 5 | Manual QA | — |

Total: 4 files modified, 1 new test file, 0 new components, 0 server changes.
