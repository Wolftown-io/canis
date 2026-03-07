# Phase 6 QA Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three independent UI polish features: keyboard shortcuts help dialog, message formatting toolbar, and improved friends tab empty states.

**Architecture:** Three independent features sharing no state. The shortcuts dialog is a new component triggered from Main.tsx. The formatting toolbar adds a row and keyboard handlers to MessageInput.tsx. The friends empty state replaces fallback content in FriendsList.tsx.

**Tech Stack:** Solid.js, TypeScript, lucide-solid icons, vitest

**Design doc:** `docs/developer-guide/plans/2026-03-07-phase6-qa-polish-design.md`

---

## Task 1: Create KeyboardShortcutsDialog component

**Files:**
- Create: `client/src/components/ui/KeyboardShortcutsDialog.tsx`

**Step 1: Create the component**

Create `client/src/components/ui/KeyboardShortcutsDialog.tsx`:

```tsx
import { Component, For, Show } from "solid-js";
import { X } from "lucide-solid";

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutCategory {
  name: string;
  shortcuts: Shortcut[];
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    name: "General",
    shortcuts: [
      { keys: ["Ctrl", "K"], description: "Command Palette" },
      { keys: ["Ctrl", "Shift", "F"], description: "Global Search" },
      { keys: ["Ctrl", "/"], description: "Keyboard Shortcuts" },
    ],
  },
  {
    name: "Voice",
    shortcuts: [
      { keys: ["Ctrl", "Shift", "M"], description: "Toggle Mute" },
      { keys: ["Ctrl", "Shift", "D"], description: "Toggle Deafen" },
    ],
  },
  {
    name: "Chat",
    shortcuts: [
      { keys: ["Enter"], description: "Send Message" },
      { keys: ["Shift", "Enter"], description: "New Line" },
      { keys: ["Ctrl", "B"], description: "Bold" },
      { keys: ["Ctrl", "I"], description: "Italic" },
      { keys: ["Ctrl", "E"], description: "Inline Code" },
    ],
  },
];

interface KeyboardShortcutsDialogProps {
  onClose: () => void;
}

const KeyboardShortcutsDialog: Component<KeyboardShortcutsDialogProps> = (props) => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
  };

  return (
    <div
      class="fixed inset-0 z-[100] flex items-center justify-center"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div class="absolute inset-0 bg-black/60" onClick={props.onClose} />

      {/* Dialog */}
      <div
        class="relative w-[520px] max-h-[70vh] overflow-y-auto rounded-xl border border-white/10 shadow-2xl p-6"
        style="background-color: var(--color-surface-layer2)"
      >
        {/* Header */}
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-lg font-semibold text-text-primary">Keyboard Shortcuts</h2>
          <button
            onClick={props.onClose}
            class="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/10 transition-colors"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        {/* Categories */}
        <div class="space-y-6">
          <For each={SHORTCUT_CATEGORIES}>
            {(category) => (
              <div>
                <h3 class="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
                  {category.name}
                </h3>
                <div class="space-y-2">
                  <For each={category.shortcuts}>
                    {(shortcut) => (
                      <div class="flex items-center justify-between py-1.5">
                        <span class="text-sm text-text-primary">{shortcut.description}</span>
                        <div class="flex items-center gap-1">
                          <For each={shortcut.keys}>
                            {(key, i) => (
                              <>
                                <kbd class="px-2 py-0.5 text-xs font-mono bg-white/10 border border-white/15 rounded text-text-secondary">
                                  {key}
                                </kbd>
                                <Show when={i() < shortcut.keys.length - 1}>
                                  <span class="text-text-muted text-xs">+</span>
                                </Show>
                              </>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>

        {/* Footer hint */}
        <div class="mt-6 pt-4 border-t border-white/10 text-xs text-text-muted text-center">
          Press <kbd class="px-1.5 py-0.5 bg-white/10 border border-white/15 rounded font-mono">?</kbd> or <kbd class="px-1.5 py-0.5 bg-white/10 border border-white/15 rounded font-mono">Ctrl+/</kbd> to toggle this dialog
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsDialog;
```

**Step 2: Verify it compiles**

Run: `cd client && bun run tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add client/src/components/ui/KeyboardShortcutsDialog.tsx
git commit -m "feat(client): add KeyboardShortcutsDialog component"
```

---

## Task 2: Wire shortcuts dialog triggers in Main.tsx

**Files:**
- Modify: `client/src/views/Main.tsx`

**Step 1: Add imports, state, and keyboard handler**

In `Main.tsx`, add these changes:

1. Add import (after existing imports around line 29):
```tsx
import KeyboardShortcutsDialog from "@/components/ui/KeyboardShortcutsDialog";
```

2. Inside the `Main` component (after line 44 `const channel = selectedChannel;`), add state:
```tsx
const [showShortcuts, setShowShortcuts] = createSignal(false);
```

Note: `createSignal` is NOT currently imported in Main.tsx. Add it to the solid-js import on line 11:
```tsx
import {
  Component,
  Show,
  lazy,
  Suspense,
  onMount,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
```

3. Rename existing `handleGlobalSearchShortcut` to a general `handleGlobalKeydown` that handles both search AND shortcuts. Replace lines 52-63:

```tsx
  // Global keyboard shortcuts
  const handleGlobalKeydown = (e: KeyboardEvent) => {
    // Ctrl+Shift+F: Global Search
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "F") {
      e.preventDefault();
      setShowGlobalSearch(!showGlobalSearch());
      return;
    }

    // Ctrl+/: Keyboard Shortcuts dialog
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      setShowShortcuts((prev) => !prev);
      return;
    }

    // ?: Keyboard Shortcuts dialog (only when not in an input)
    if (
      e.key === "?" &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !(document.activeElement instanceof HTMLInputElement) &&
      !(document.activeElement instanceof HTMLTextAreaElement) &&
      !(document.activeElement?.getAttribute("contenteditable"))
    ) {
      e.preventDefault();
      setShowShortcuts((prev) => !prev);
    }
  };

  createEffect(() => {
    window.addEventListener("keydown", handleGlobalKeydown);
    onCleanup(() => window.removeEventListener("keydown", handleGlobalKeydown));
  });
```

4. Render the dialog (after the `<CommandPalette />` line, around line 69):
```tsx
      {/* Keyboard Shortcuts Dialog */}
      <Show when={showShortcuts()}>
        <KeyboardShortcutsDialog onClose={() => setShowShortcuts(false)} />
      </Show>
```

**Step 2: Verify it compiles**

Run: `cd client && bun run tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add client/src/views/Main.tsx
git commit -m "feat(client): wire keyboard shortcuts dialog triggers (Ctrl+/, ?)"
```

---

## Task 3: Add /? slash command in MessageInput

**Files:**
- Modify: `client/src/components/messages/MessageInput.tsx`

**Step 1: Add /? interception in handleSubmit**

The `/?` command should open the shortcuts dialog instead of sending a message. Since the dialog state lives in `Main.tsx`, use a custom event to communicate.

In `Main.tsx`, add a listener for the custom event (inside the existing `createEffect` that adds keyboard handlers):
```tsx
  // Listen for /? command from MessageInput
  const handleShortcutsCommand = () => setShowShortcuts(true);

  createEffect(() => {
    window.addEventListener("keydown", handleGlobalKeydown);
    window.addEventListener("open-shortcuts-dialog", handleShortcutsCommand);
    onCleanup(() => {
      window.removeEventListener("keydown", handleGlobalKeydown);
      window.removeEventListener("open-shortcuts-dialog", handleShortcutsCommand);
    });
  });
```

In `MessageInput.tsx`, add interception at the top of `handleSubmit` (after `const text = content().trim();` on line 305):

```tsx
    // Handle /? command — open keyboard shortcuts dialog
    if (text === "/?") {
      setContent("");
      window.dispatchEvent(new CustomEvent("open-shortcuts-dialog"));
      return;
    }
```

**Step 2: Verify it compiles**

Run: `cd client && bun run tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add client/src/views/Main.tsx client/src/components/messages/MessageInput.tsx
git commit -m "feat(client): add /? slash command to open shortcuts dialog"
```

---

## Task 4: Add formatting toolbar to MessageInput

**Files:**
- Modify: `client/src/components/messages/MessageInput.tsx`

**Step 1: Add icon imports**

Add to the existing lucide import (line 2):
```tsx
import { PlusCircle, Send, Smile, UploadCloud, X, File as FileIcon, Bold, Italic, Code, EyeOff } from "lucide-solid";
```

**Step 2: Add insertText helper function**

Add after the `textareaRef` declaration (around line 47), before `resizeFrame`:

```tsx
  // Insert markdown syntax around selection or at cursor
  const insertFormatting = (before: string, after: string = "") => {
    if (!textareaRef) return;

    const start = textareaRef.selectionStart;
    const end = textareaRef.selectionEnd;
    const selected = content().slice(start, end);

    const newContent =
      content().slice(0, start) +
      before +
      selected +
      after +
      content().slice(end);

    setContent(newContent);

    // Restore cursor: if text was selected, place cursor after; if not, place between markers
    requestAnimationFrame(() => {
      if (textareaRef) {
        const cursorPos = selected.length > 0
          ? start + before.length + selected.length + after.length
          : start + before.length;
        textareaRef.focus();
        textareaRef.setSelectionRange(cursorPos, cursorPos);
      }
    });
  };
```

**Step 3: Add keyboard shortcuts to handleKeyDown**

In `handleKeyDown` (line 352), add formatting shortcuts before the Enter check (before line 369). After the autocomplete block (line 367):

```tsx
    // Formatting shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "b") {
        e.preventDefault();
        insertFormatting("**", "**");
        return;
      }
      if (e.key === "i") {
        e.preventDefault();
        insertFormatting("*", "*");
        return;
      }
      if (e.key === "e") {
        e.preventDefault();
        insertFormatting("`", "`");
        return;
      }
    }
```

**Step 4: Add toolbar row in JSX**

In the JSX, add a toolbar row inside the input container div (line 521), before the attachment button (line 523). The toolbar goes at the top of the container, so restructure slightly:

Replace the container div opening and its first children. The toolbar should be above the row that contains the attachment button, textarea, and send button. Change the container to use `flex-col`:

The current container (line 521):
```tsx
<div class="relative flex items-center rounded-xl border border-white/5 focus-within:border-accent-primary/30 transition-colors" style="background-color: var(--color-surface-layer2)">
```

Replace with:
```tsx
<div class="relative rounded-xl border border-white/5 focus-within:border-accent-primary/30 transition-colors" style="background-color: var(--color-surface-layer2)">
  {/* Formatting toolbar */}
  <div class="flex items-center gap-1 px-2 py-1 border-b border-white/5">
    <button
      type="button"
      class="p-1.5 rounded hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors"
      title="Bold (Ctrl+B)"
      onClick={() => insertFormatting("**", "**")}
    >
      <Bold class="w-4 h-4" />
    </button>
    <button
      type="button"
      class="p-1.5 rounded hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors"
      title="Italic (Ctrl+I)"
      onClick={() => insertFormatting("*", "*")}
    >
      <Italic class="w-4 h-4" />
    </button>
    <button
      type="button"
      class="p-1.5 rounded hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors"
      title="Code (Ctrl+E)"
      onClick={() => insertFormatting("`", "`")}
    >
      <Code class="w-4 h-4" />
    </button>
    <button
      type="button"
      class="p-1.5 rounded hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors"
      title="Spoiler"
      onClick={() => insertFormatting("||", "||")}
    >
      <EyeOff class="w-4 h-4" />
    </button>
  </div>

  {/* Input row */}
  <div class="flex items-center">
```

And close the inner `<div>` after the send button area (after the existing closing `</div>` for character counter / send button container around line 589):
```tsx
  </div> {/* end input row */}
```

**Step 5: Verify it compiles**

Run: `cd client && bun run tsc --noEmit`
Expected: no errors

**Step 6: Commit**

```bash
git add client/src/components/messages/MessageInput.tsx
git commit -m "feat(client): add message formatting toolbar (bold, italic, code, spoiler)"
```

---

## Task 5: Write tests for formatting toolbar

**Files:**
- Create: `client/src/components/messages/__tests__/insertFormatting.test.ts`

**Step 1: Write tests**

Create `client/src/components/messages/__tests__/insertFormatting.test.ts`:

```tsx
import { describe, expect, it } from "vitest";

// Test the insertFormatting logic in isolation (pure function extraction)
function applyFormatting(
  content: string,
  selectionStart: number,
  selectionEnd: number,
  before: string,
  after: string,
): { newContent: string; cursorPos: number } {
  const selected = content.slice(selectionStart, selectionEnd);
  const newContent =
    content.slice(0, selectionStart) +
    before +
    selected +
    after +
    content.slice(selectionEnd);

  const cursorPos =
    selected.length > 0
      ? selectionStart + before.length + selected.length + after.length
      : selectionStart + before.length;

  return { newContent, cursorPos };
}

describe("insertFormatting", () => {
  it("wraps selected text with markers", () => {
    const result = applyFormatting("hello world", 6, 11, "**", "**");
    expect(result.newContent).toBe("hello **world**");
    expect(result.cursorPos).toBe(15); // After closing **
  });

  it("inserts empty markers at cursor when no selection", () => {
    const result = applyFormatting("hello world", 5, 5, "**", "**");
    expect(result.newContent).toBe("hello**** world");
    expect(result.cursorPos).toBe(7); // Between the markers
  });

  it("handles bold formatting", () => {
    const result = applyFormatting("some text", 5, 9, "**", "**");
    expect(result.newContent).toBe("some **text**");
  });

  it("handles italic formatting", () => {
    const result = applyFormatting("some text", 5, 9, "*", "*");
    expect(result.newContent).toBe("some *text*");
  });

  it("handles inline code formatting", () => {
    const result = applyFormatting("some text", 5, 9, "`", "`");
    expect(result.newContent).toBe("some `text`");
  });

  it("handles spoiler formatting", () => {
    const result = applyFormatting("some text", 5, 9, "||", "||");
    expect(result.newContent).toBe("some ||text||");
  });

  it("handles empty content", () => {
    const result = applyFormatting("", 0, 0, "**", "**");
    expect(result.newContent).toBe("****");
    expect(result.cursorPos).toBe(2);
  });

  it("handles formatting at start of content", () => {
    const result = applyFormatting("hello", 0, 5, "**", "**");
    expect(result.newContent).toBe("**hello**");
    expect(result.cursorPos).toBe(9);
  });
});
```

**Step 2: Run tests**

Run: `cd client && bun run test:run -- --reporter=verbose src/components/messages/__tests__/insertFormatting.test.ts`
Expected: 8 tests pass

**Step 3: Commit**

```bash
git add client/src/components/messages/__tests__/insertFormatting.test.ts
git commit -m "test(client): add unit tests for message formatting logic"
```

---

## Task 6: Improve friends tab empty states

**Files:**
- Modify: `client/src/components/social/FriendsList.tsx`

**Step 1: Add Floki emote imports**

Replace the `Ghost` import. Change line 8 from:
```tsx
import { Users, Search, UserPlus, Ghost } from "lucide-solid";
```
to:
```tsx
import { Users, Search, UserPlus } from "lucide-solid";
```

Add Floki emote imports after the existing imports (after line 25):
```tsx
import flokiHappy from "@/assets/emotes/floki_emote_1.png";
import flokiThinking from "@/assets/emotes/floki_emote_2.png";
import flokiCool from "@/assets/emotes/floki_emote_4.png";
```

**Step 2: Replace empty state fallback**

Replace the entire fallback content (lines 213-240) — from the opening `<div class="flex flex-col items-center...` to its closing `</div>` — with:

```tsx
            <div class="flex flex-col items-center justify-center h-full py-12">
              <Show
                when={!friendsState.isLoading}
                fallback={<div class="text-text-secondary">Loading...</div>}
              >
                <img
                  src={
                    tab() === "blocked"
                      ? flokiCool
                      : tab() === "all"
                        ? flokiHappy
                        : flokiThinking
                  }
                  alt=""
                  class="w-12 h-12 object-contain mb-3"
                  loading="lazy"
                />
                <div class="text-sm font-medium text-text-primary mb-1">
                  {tab() === "online"
                    ? "No one's online right now"
                    : tab() === "pending"
                      ? "No pending requests"
                      : tab() === "blocked"
                        ? "No blocked users"
                        : "No friends yet"}
                </div>
                <p class="text-xs text-text-muted">
                  {tab() === "online"
                    ? "When friends come online, they'll appear here"
                    : tab() === "pending"
                      ? "Friend requests you send or receive will show up here"
                      : tab() === "blocked"
                        ? "Users you block won't be able to message or call you"
                        : "Add friends to start chatting, calling, and gaming together"}
                </p>
                <Show when={tab() === "all"}>
                  <button
                    onClick={() => setShowAddFriend(true)}
                    class="mt-3 btn-primary py-1.5 px-4 text-sm flex items-center gap-2"
                  >
                    <UserPlus class="w-4 h-4" />
                    Add Friend
                  </button>
                </Show>
              </Show>
            </div>
```

**Step 3: Verify it compiles**

Run: `cd client && bun run tsc --noEmit`
Expected: no errors

**Step 4: Run all tests to verify nothing broke**

Run: `cd client && bun run test:run`
Expected: all tests pass (449+)

**Step 5: Commit**

```bash
git add client/src/components/social/FriendsList.tsx
git commit -m "feat(client): improve friends tab empty states with Floki mascot"
```

---

## Task 7: Update roadmap and changelog

**Files:**
- Modify: `docs/developer-guide/project/roadmap.md`
- Modify: `CHANGELOG.md`

**Step 1: Mark items complete in roadmap**

In `docs/developer-guide/project/roadmap.md`, find and update these three items under Phase 6:

Change:
```markdown
- [ ] **[UX] Keyboard Shortcuts Help Dialog** `Priority: Medium`
```
to:
```markdown
- [x] **[UX] Keyboard Shortcuts Help Dialog** `Priority: Medium` ✅
```

Change:
```markdown
- [ ] **[Chat] Message Formatting Toolbar** `Priority: Medium`
```
to:
```markdown
- [x] **[Chat] Message Formatting Toolbar** `Priority: Medium` ✅
```

Change:
```markdown
- [ ] **[UX] Friends Tab Empty State Improvement** `Priority: Low`
```
to:
```markdown
- [x] **[UX] Friends Tab Empty State Improvement** `Priority: Low` ✅
```

Update the Phase 6 completion percentage in the Quick Status Overview table (line 19).

**Step 2: Add changelog entries**

In `CHANGELOG.md` under `[Unreleased]`, add under `### Added`:

```markdown
- Keyboard shortcuts help dialog — press `Ctrl+/`, `?`, or type `/?` in chat to view all shortcuts
- Message formatting toolbar with Bold, Italic, Code, and Spoiler buttons above the message input
- Improved friends tab empty states with Floki mascot illustrations and contextual tips
```

**Step 3: Commit**

```bash
git add docs/developer-guide/project/roadmap.md CHANGELOG.md
git commit -m "docs: mark keyboard shortcuts, formatting toolbar, friends empty state complete"
```
