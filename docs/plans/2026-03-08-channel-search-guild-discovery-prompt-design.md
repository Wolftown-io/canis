# Channel Search & Guild Discovery Prompt — Design

**Date:** 2026-03-08
**Phase:** 6 (Competitive Differentiators & Mastery)
**Status:** Approved

Two separate features designed together: (A) Channel Message Search and (B) Guild Discovery Default Prompt.

---

## A: Channel Message Search

### Goal

Provide in-channel search with the same UX as the existing global SearchPanel, pre-scoped to the current channel. Users can switch scope without reopening.

### Behavior

- **Ctrl+F** opens SearchPanel scoped to the current channel
- **Ctrl+Shift+F** opens SearchPanel scoped to the current guild (existing)
- A **scope selector** (segmented control) in the SearchPanel header allows switching between: **This Channel** | **This Server** | **All**
- Text-only search for channel scope (no advanced filters in v1)
- Clicking a result scrolls to the message and highlights it; the panel stays open

### Backend Changes

**Global search endpoint** (`GET /api/search/messages`):
- Add optional `channel_id: Option<Uuid>` query parameter to `GlobalSearchQuery`
- When provided, constrain the query to that single channel (permission-checked)
- No new endpoint needed

### Frontend Changes

1. **SearchPanel.tsx**
   - Add `scope` signal: `"channel" | "guild" | "all"`
   - Add `initialScope` and `channelId` props
   - Render segmented control in panel header
   - Pass `channel_id` to search API when scope is `"channel"`

2. **Main.tsx**
   - Add Ctrl+F handler that opens SearchPanel with `initialScope: "channel"` and current `channelId`

3. **KeyboardShortcutsDialog.tsx**
   - Add Ctrl+F entry under "Chat" category

4. **MessageList.tsx**
   - Handle `?highlight={messageId}` URL query param
   - If message is loaded: scroll to it and apply highlight CSS (fade after ~2s)
   - If not loaded: re-fetch messages around target ID, replace view, then scroll

### Scroll-to-Message

- **Same channel, message loaded:** Scroll directly via virtualizer
- **Same channel, message not loaded:** Re-fetch messages around the target message ID using cursor-based pagination, replace view, scroll to target
- **Different channel:** Navigate via URL with `?highlight={messageId}` (existing pattern)

### Decisions

- Reuse existing SearchPanel rather than building a new component
- No advanced filters for channel-scoped search in v1 — text search only
- Simple re-fetch approach for scroll-to-message (not incremental insertion)

---

## B: Guild Discovery Default Prompt

### Goal

Nudge guild owners to enable discoverability during guild creation and in settings for existing guilds.

### Guild Creation Step

Add a **"Discovery" step** to CreateGuildModal after name/description:

- **Toggle:** "Make this server visible in the server browser" (default: off)
- **Tags input:** Up to 5 tags (reuse GeneralTab pattern — regex validated, pill display)
- **Banner upload:** Optional banner image URL (HTTPS only)
- **Preview:** Mini GuildCard showing how the server appears in discovery
- **Skip note:** "You can always set this up later in Server Settings"

When the toggle is off, tags and banner inputs are hidden.

### Settings Banner for Existing Guilds

A dismissible banner in **GeneralTab** for guilds where `discoverable: false` and no tags are set:

- Text: "Make your server easier to find — set up server discovery"
- "Set up" button scrolls to/expands the discovery settings section
- Dismiss button hides the banner permanently (per-user per-guild)

### Dismissal Persistence

- Add `discovery_prompt_dismissed_at: Option<DateTime<Utc>>` column to a per-user per-guild settings table
- Nullable timestamp — `NULL` means not dismissed
- Survives cache clears unlike Valkey-based storage

### Backend Changes

1. **Migration:** Add `discovery_prompt_dismissed_at` column (nullable timestamp)
2. **API:** Endpoint to dismiss the prompt (PATCH on guild member settings or dedicated route)
3. **Guild creation handler:** Accept optional `discoverable`, `tags`, and `banner_url` fields in create guild request

### Frontend Changes

1. **CreateGuildModal.tsx**
   - Add discovery step after name/description
   - Conditional tag/banner fields shown only when toggle is on

2. **GeneralTab.tsx**
   - Add dismissible banner at top when: user is owner/admin, `discoverable: false`, no tags, not dismissed
   - Fetch dismissal state on mount

### Decisions

- DB-based dismissal (not Valkey) for persistence across cache flushes
- Discovery setup during creation is a soft prompt, not required
- Reuse existing tag input validation and GuildCard component
