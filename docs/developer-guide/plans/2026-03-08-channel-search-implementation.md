# Channel Message Search — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add channel-scoped search with a scope selector to the existing SearchPanel, triggered by Ctrl+F.

**Architecture:** Extend the existing SearchPanel with a `scope` prop and segmented control. Add `channel_id` parameter to the global search API. Implement scroll-to-message highlighting in MessageList.

**Tech Stack:** Rust/axum (backend), Solid.js/TypeScript (frontend), PostgreSQL full-text search

---

### Task 1: Add `channel_id` filter to global search API

**Files:**
- Modify: `server/src/api/global_search.rs:57-73` (GlobalSearchQuery struct)
- Modify: `server/src/api/global_search.rs:128-389` (search_all handler)

**Step 1: Add channel_id to GlobalSearchQuery**

In `server/src/api/global_search.rs`, add `channel_id` to the query struct:

```rust
#[derive(Debug, Deserialize, IntoParams)]
pub struct GlobalSearchQuery {
    pub q: String,
    #[param(default = 25, minimum = 1, maximum = 100)]
    pub limit: i64,
    #[param(default = 0)]
    pub offset: i64,
    pub date_from: Option<DateTime<Utc>>,
    pub date_to: Option<DateTime<Utc>>,
    pub author_id: Option<Uuid>,
    pub has: Option<String>,
    pub sort: Option<String>,
    /// Filter results to a specific channel
    pub channel_id: Option<Uuid>,
}
```

**Step 2: Apply channel_id filter in handler**

In the `search_all` handler, after the permission-based channel list is built, add channel_id filtering:

```rust
// After building all_channel_ids, before the SQL query:
if let Some(target_channel_id) = query.channel_id {
    if !all_channel_ids.contains(&target_channel_id) {
        return Err(SearchError::Forbidden);
    }
    all_channel_ids = vec![target_channel_id];
}
```

This ensures the user has permission to search the channel before narrowing.

**Step 3: Run server tests**

Run: `SQLX_OFFLINE=true cargo test -p vc-server -- search`
Expected: All existing search tests pass.

**Step 4: Run clippy**

Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings`
Expected: No warnings.

**Step 5: Commit**

```bash
git add server/src/api/global_search.rs
git commit -m "feat(api): add channel_id filter to global search endpoint"
```

---

### Task 2: Add channel_id to client search store

**Files:**
- Modify: `client/src/stores/search.ts` (searchGlobal function)
- Modify: `client/src/lib/tauri.ts` (if the Tauri bridge needs updating)

**Step 1: Update searchGlobal to accept channel_id**

In `client/src/stores/search.ts`, update the `searchGlobal` function (around line 193) to accept and pass `channel_id`:

```typescript
async searchGlobal(query: string, filters?: SearchFilters & { channel_id?: string }) {
```

Pass `channel_id` through to the API call alongside existing filter parameters.

**Step 2: Update Tauri bridge if needed**

Check `client/src/lib/tauri.ts` for the `searchGlobalMessages` function. Add `channel_id` to the parameters object it sends.

**Step 3: Run client tests**

Run: `cd client && bun run test:run`
Expected: All existing tests pass.

**Step 4: Commit**

```bash
git add client/src/stores/search.ts client/src/lib/tauri.ts
git commit -m "feat(client): pass channel_id filter in global search store"
```

---

### Task 3: Add scope selector to SearchPanel

**Files:**
- Modify: `client/src/components/search/SearchPanel.tsx:51-79` (props and state)

**Step 1: Extend SearchPanel props and state**

Add new props and a scope signal:

```typescript
interface SearchPanelProps {
  onClose: () => void;
  mode?: "guild" | "dm" | "global";
  initialScope?: "channel" | "guild" | "all";
  channelId?: string;
}
```

Add scope signal inside the component:

```typescript
const [scope, setScope] = createSignal<"channel" | "guild" | "all">(
  props.initialScope ?? (props.mode === "global" ? "all" : "guild")
);
```

**Step 2: Render segmented control**

Add a segmented control in the SearchPanel header, below the search input:

```tsx
<div class="flex gap-1 px-3 py-1.5 border-b border-white/5">
  <button
    class={`px-2 py-0.5 text-xs rounded ${scope() === "channel" ? "bg-white/10 text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
    onClick={() => setScope("channel")}
    disabled={!props.channelId}
  >
    This Channel
  </button>
  <button
    class={`px-2 py-0.5 text-xs rounded ${scope() === "guild" ? "bg-white/10 text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
    onClick={() => setScope("guild")}
  >
    This Server
  </button>
  <button
    class={`px-2 py-0.5 text-xs rounded ${scope() === "all" ? "bg-white/10 text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
    onClick={() => setScope("all")}
  >
    All
  </button>
</div>
```

**Step 3: Wire scope to search calls**

In the `triggerSearch` function (~line 97), switch the API call based on scope:

```typescript
const triggerSearch = async () => {
  const q = inputValue().trim();
  if (!q) return;

  if (scope() === "channel" && props.channelId) {
    await searchState.searchGlobal(q, { channel_id: props.channelId });
  } else if (scope() === "guild") {
    await searchState.search(currentGuildId(), q, filters);
  } else {
    await searchState.searchGlobal(q, filters);
  }
};
```

**Step 4: Re-trigger search on scope change**

Add a `createEffect` that re-triggers search when scope changes:

```typescript
createEffect(on(scope, () => {
  if (inputValue().trim()) {
    triggerSearch();
  }
}));
```

**Step 5: Run client tests**

Run: `cd client && bun run test:run`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add client/src/components/search/SearchPanel.tsx
git commit -m "feat(client): add scope selector to SearchPanel"
```

---

### Task 4: Add Ctrl+F keyboard shortcut

**Files:**
- Modify: `client/src/views/Main.tsx:55-61` (keyboard handler)
- Modify: `client/src/components/ui/KeyboardShortcutsDialog.tsx:27-53` (shortcut list)

**Step 1: Add Ctrl+F handler in Main.tsx**

In the `handleGlobalKeydown` function, add a Ctrl+F handler before the existing Ctrl+Shift+F handler (order matters — Ctrl+Shift+F must be checked first):

```typescript
// Ctrl+Shift+F → global search (existing, check FIRST)
if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "F") {
    e.preventDefault();
    setShowGlobalSearch(!showGlobalSearch());
    return;
}

// Ctrl+F → channel search (new)
if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "f") {
    e.preventDefault();
    setChannelSearchScope(true);
    setShowGlobalSearch(true);
    return;
}
```

Add state for channel search scope:

```typescript
const [channelSearchScope, setChannelSearchScope] = createSignal(false);
```

**Step 2: Pass scope props to SearchPanel**

Update the SearchPanel rendering in Main.tsx:

```tsx
<Show when={showGlobalSearch()}>
  <SearchPanel
    onClose={() => {
      setShowGlobalSearch(false);
      setChannelSearchScope(false);
    }}
    mode="global"
    initialScope={channelSearchScope() ? "channel" : "all"}
    channelId={currentChannelId()}
  />
</Show>
```

**Step 3: Add Ctrl+F to KeyboardShortcutsDialog**

In `KeyboardShortcutsDialog.tsx`, add to the Chat category (around line 44):

```typescript
{
  keys: [isMac ? "⌘" : "Ctrl", "F"],
  description: "Search in channel",
},
```

**Step 4: Run client tests**

Run: `cd client && bun run test:run`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add client/src/views/Main.tsx client/src/components/ui/KeyboardShortcutsDialog.tsx
git commit -m "feat(client): add Ctrl+F shortcut for channel-scoped search"
```

---

### Task 5: Implement scroll-to-message highlighting

**Files:**
- Modify: `client/src/components/messages/MessageList.tsx` (highlight handling)

**Step 1: Watch for highlight query param**

In MessageList, check for `?highlight=` in the URL when the component mounts or the URL changes:

```typescript
const [highlightedId, setHighlightedId] = createSignal<string | null>(null);

createEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const highlightId = params.get("highlight");
  if (highlightId) {
    scrollToMessage(highlightId);
    // Clean up URL
    const url = new URL(window.location.href);
    url.searchParams.delete("highlight");
    window.history.replaceState({}, "", url.toString());
  }
});
```

**Step 2: Implement scrollToMessage**

```typescript
const scrollToMessage = async (messageId: string) => {
  const messages = messagesState.byChannel[channelId()];
  if (!messages) return;

  const index = messages.findIndex((m) => m.id === messageId);
  if (index !== -1) {
    // Message is loaded — scroll directly
    virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" });
    setHighlightedId(messageId);
    setTimeout(() => setHighlightedId(null), 2000);
  } else {
    // Message not loaded — fetch around it, then scroll
    await messagesState.loadAroundMessage(channelId(), messageId);
    // After load, find index again
    const newMessages = messagesState.byChannel[channelId()];
    const newIndex = newMessages?.findIndex((m) => m.id === messageId) ?? -1;
    if (newIndex !== -1) {
      virtualizer.scrollToIndex(newIndex, { align: "center", behavior: "smooth" });
      setHighlightedId(messageId);
      setTimeout(() => setHighlightedId(null), 2000);
    }
  }
};
```

**Step 3: Apply highlight CSS class**

In the message row rendering, add a conditional highlight class:

```tsx
<div
  class={`message-row ${highlightedId() === message.id ? "message-highlight" : ""}`}
>
```

Add CSS (in the component or a global stylesheet):

```css
.message-highlight {
  background-color: rgba(255, 200, 50, 0.15);
  animation: highlight-fade 2s ease-out forwards;
}

@keyframes highlight-fade {
  0% { background-color: rgba(255, 200, 50, 0.15); }
  100% { background-color: transparent; }
}
```

**Step 4: Add loadAroundMessage to messages store**

If not already present, add a function to the messages store that fetches messages around a target:

```typescript
async loadAroundMessage(channelId: string, messageId: string) {
  const messages = await tauri.getMessagesAround(channelId, messageId, 50);
  // Replace channel messages with these results
  setState("byChannel", channelId, messages);
}
```

Check if the backend already supports a `?around=` parameter. If not, fetch `?before=messageId&limit=25` and `?after=messageId&limit=25` and merge.

**Step 5: Run client tests**

Run: `cd client && bun run test:run`
Expected: All tests pass.

**Step 6: Manual test**

1. Open a channel with messages
2. Ctrl+F → search for text → click result → message scrolls into view with yellow highlight that fades
3. Ctrl+Shift+F → global search → click result in different channel → navigates and highlights

**Step 7: Commit**

```bash
git add client/src/components/messages/MessageList.tsx client/src/stores/messages.ts
git commit -m "feat(client): scroll-to-message with highlight on search result click"
```
