# Phase 6 QA Polish Design: Keyboard Shortcuts, Formatting Toolbar, Friends Empty State

**Date:** 2026-03-07
**Status:** Approved
**Scope:** Three independent client-side UX improvements

---

## 1. Keyboard Shortcuts Help Dialog

### Problem
Six keyboard shortcuts exist but are undiscoverable — no UI lists them.

### Design

**Triggers:**
- `Ctrl+/` — global, always works
- `?` — global, only when no input/textarea is focused
- `/?` — client-only slash command in the message composer

**Component:** `client/src/components/ui/KeyboardShortcutsDialog.tsx`

**State:** `showShortcutsDialog` signal in `Main.tsx` (same pattern as `showGlobalSearch`).

**UI:** Full-screen semi-transparent overlay (`bg-black/60`) with centered modal. Dismiss via `Escape` or backdrop click.

**Shortcut data:** Static `SHORTCUTS` array in the component file. Each entry:
```typescript
{ keys: string[], description: string, category: string }
```

**Categories and entries:**

| Category | Shortcut | Description |
|----------|----------|-------------|
| General | `Ctrl+K` | Command Palette |
| General | `Ctrl+Shift+F` | Global Search |
| General | `Ctrl+/` or `?` | Keyboard Shortcuts |
| Voice | `Ctrl+Shift+M` | Toggle Mute |
| Voice | `Ctrl+Shift+D` | Toggle Deafen |
| Chat | `Enter` | Send Message |
| Chat | `Shift+Enter` | New Line |
| Chat | `Ctrl+B` | Bold |
| Chat | `Ctrl+I` | Italic |
| Chat | `Ctrl+E` | Inline Code |

**Slash command integration:** Add `/?` as a client-only command in the existing slash command system (no server round-trip). It opens the same dialog.

**No central registry refactor.** Shortcuts remain handled by their respective components. The dialog is a static reference list only.

---

## 2. Message Formatting Toolbar

### Problem
The message display side fully supports markdown (via marked.js + DOMPurify), but there's no input-side toolbar to help users format text.

### Design

**Location:** Slim toolbar row inside `MessageInput.tsx`, rendered directly above the `<textarea>`. Always visible.

**Buttons:**

| Button | Icon (lucide) | Markdown Syntax | Keyboard Shortcut |
|--------|---------------|-----------------|-------------------|
| Bold | `Bold` | `**text**` | `Ctrl+B` |
| Italic | `Italic` | `*text*` | `Ctrl+I` |
| Code | `Code` | `` `text` `` | `Ctrl+E` |
| Spoiler | `EyeOff` | `\|\|text\|\|` | — |

**Implementation:** Reuse PageEditor's `insertText(before, after)` pattern from `client/src/components/pages/PageEditor.tsx:124-148`:
- Text selected → wraps selection (e.g., `**selected**`)
- No selection → inserts empty markers at cursor (e.g., `****`) with cursor positioned between them
- After insertion: refocus textarea, restore cursor position via `requestAnimationFrame`

**Keyboard shortcuts:** `Ctrl+B`, `Ctrl+I`, `Ctrl+E` handled in the textarea's existing `onKeyDown` handler with `e.preventDefault()`.

**Styling:** Compact row with `gap-1`, icon buttons `w-7 h-7` with `hover:bg-white/10 rounded`. Border between toolbar and textarea: `border-b border-white/10`.

**Scope:** MessageInput only. PageEditor keeps its existing toolbar unchanged.

---

## 3. Friends Tab Empty State

### Problem
Empty state shows a generic Ghost icon with minimal guidance. Inconsistent with the Floki mascot branding used throughout the rest of the app.

### Design

**Location:** Modify fallback content in `client/src/components/social/FriendsList.tsx`.

**Per-tab empty states:**

| Tab | Floki Emote | Heading | Tip | CTA |
|-----|-------------|---------|-----|-----|
| Online | `floki_emote_2` (thinking) | "No one's online right now" | "When friends come online, they'll appear here" | — |
| All | `floki_emote_1` (happy) | "No friends yet" | "Add friends to start chatting, calling, and gaming together" | "Add Friend" button |
| Pending | `floki_emote_2` (thinking) | "No pending requests" | "Friend requests you send or receive will show up here" | — |
| Blocked | `floki_emote_4` (cool) | "No blocked users" | "Users you block won't be able to message or call you" | — |

**Layout:** Centered flex column:
- Floki emote: `w-12 h-12 object-contain`
- Heading: `text-sm text-text-primary font-medium`
- Tip: `text-xs text-text-muted mt-1`
- CTA (All tab only): `mt-3` button with accent color, opens AddFriend modal

**Matches existing patterns:** HomeSidebar DM empty state, UnreadModule, PinsModule all use Floki emotes with centered text.

**Change scope:** Only the `fallback` prop contents in each tab's `<Show>` component. No structural changes.

---

## Files Affected

| Feature | Files |
|---------|-------|
| Shortcuts Dialog | Create `KeyboardShortcutsDialog.tsx`, modify `Main.tsx` (triggers + render), modify `MessageInput.tsx` (`/?` slash command) |
| Formatting Toolbar | Modify `MessageInput.tsx` (toolbar + keyboard shortcuts) |
| Friends Empty State | Modify `FriendsList.tsx` (fallback content per tab) |

## Testing

- **Shortcuts:** Unit test for trigger logic (Ctrl+/, ? filtering, /? command). Manual test: dialog opens/closes, all shortcuts listed.
- **Toolbar:** Unit test for `insertText` with selection and without. Manual test: each button wraps/inserts correctly, keyboard shortcuts work.
- **Friends empty state:** Visual verification per tab. No logic changes to test.
