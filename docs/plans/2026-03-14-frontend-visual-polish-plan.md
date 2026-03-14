# Frontend Visual Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 9 visual issues (contrast, visibility, consistency, layout) identified from a 33-screen screenshot audit.

**Architecture:** Pure CSS/class changes in Solid.js components. No new tokens, no backend changes. All fixes use existing UnoCSS semantic tokens and work across all 4 themes.

**Tech Stack:** Solid.js, UnoCSS, CSS custom properties

**Design doc:** `docs/plans/2026-03-14-frontend-visual-polish-design.md`

---

### Task 1: Admin Elevation Badge Contrast

**Files:**
- Modify: `client/src/views/AdminDashboard.tsx:139,146,278,285`

**Step 1: Fix the "Not Elevated" badge background opacity**

In `AdminDashboard.tsx`, find line 139:
```tsx
class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-status-warning/15 text-status-warning text-sm font-medium hover:bg-status-warning/25 transition-colors cursor-pointer"
```
Change `bg-status-warning/15` to `bg-status-warning/20` and `hover:bg-status-warning/25` to `hover:bg-status-warning/30`.

**Step 2: Fix the "Elevated" badge background opacity**

On line 146:
```tsx
class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-status-success/20 text-status-success text-sm font-medium"
```
Change `bg-status-success/20` to `bg-status-success/25`.

**Step 3: Fix elevation notice banner background and text**

On line 278:
```tsx
class="p-4 rounded-xl bg-status-warning/15 border border-status-warning/50"
```
Change `bg-status-warning/15` to `bg-status-warning/20`.

On line 285:
```tsx
<p class="text-sm text-text-primary/80 mt-1">
```
Change `text-text-primary/80` to `text-text-primary`.

**Step 4: Commit**

```
fix(client): improve admin elevation badge contrast across themes
```

---

### Task 2: GuildsPanel Status Token Consistency

**Files:**
- Modify: `client/src/components/admin/GuildsPanel.tsx:473,479,623,629`

**Step 1: Fix guild list status badges**

On line 473, change:
```tsx
<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-status-success/20 text-accent-success">
```
to:
```tsx
<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-status-success/20 text-status-success">
```

On line 479, change:
```tsx
<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-status-error/20 text-accent-danger">
```
to:
```tsx
<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-status-error/20 text-status-error">
```

**Step 2: Fix guild detail panel status badges**

On line 623, change `text-accent-success` to `text-status-success`.
On line 629, change `text-accent-danger` to `text-status-error`.

**Step 3: Commit**

```
fix(client): unify GuildsPanel status badge tokens with UsersPanel
```

---

### Task 3: Friend Request Buttons Visibility

**Files:**
- Modify: `client/src/components/home/modules/PendingModule.tsx:83-95`

**Step 1: Increase accept button size and contrast**

On line 84, change:
```tsx
class="p-1.5 rounded-full bg-status-success/20 text-status-success hover:bg-status-success/30 transition-colors"
```
to:
```tsx
class="p-2 rounded-full bg-status-success/25 text-status-success hover:bg-status-success/40 transition-colors"
```

**Step 2: Increase decline button size and contrast**

On line 91, change:
```tsx
class="p-1.5 rounded-full bg-status-error/20 text-status-error hover:bg-status-error/30 transition-colors"
```
to:
```tsx
class="p-2 rounded-full bg-status-error/25 text-status-error hover:bg-status-error/40 transition-colors"
```

**Step 3: Commit**

```
fix(client): increase friend request button size and visibility
```

---

### Task 4: Formatting Toolbar Icon Contrast

**Files:**
- Modify: `client/src/components/messages/MessageInput.tsx:559-569`

**Step 1: Update all 4 toolbar button classes**

Change all four formatting buttons from:
```tsx
class="p-1.5 rounded hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors"
```
to:
```tsx
class="p-1.5 rounded hover:bg-white/10 text-text-primary/50 hover:text-text-primary transition-colors"
```

There are 4 buttons (Bold, Italic, Code, Spoiler) on lines 559, 561, 563, 565 — update all four.

**Step 2: Commit**

```
fix(client): improve formatting toolbar icon contrast for all themes
```

---

### Task 5: Settings Modal Backdrop and Active Tab

**Files:**
- Modify: `client/src/components/settings/SettingsModal.tsx:139,171`

**Step 1: Increase backdrop opacity**

On line 139, change:
```tsx
class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
```
to:
```tsx
class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
```

**Step 2: Strengthen active tab highlight**

On line 171, change:
```tsx
"bg-accent-primary/20 text-text-primary":
```
to:
```tsx
"bg-accent-primary/25 text-text-primary":
```

**Step 3: Commit**

```
fix(client): strengthen settings modal backdrop and active tab highlight
```

---

### Task 6: Server Rail Default Opacity

**Files:**
- Modify: `client/src/components/layout/ServerRail.tsx:83`

**Step 1: Increase guild icon default opacity**

On line 83, change:
```tsx
opacity: isActive("home") || isHovered("home") ? 1 : 0.8,
```
to:
```tsx
opacity: isActive("home") || isHovered("home") ? 1 : 0.85,
```

Also find the equivalent line in the guild icon loop (around the `<For each={guildsState.guilds}>` block) and apply the same change.

**Step 2: Commit**

```
fix(client): increase server rail icon default opacity for readability
```

---

### Task 7: User Panel Background Contrast

**Files:**
- Modify: `client/src/components/layout/UserPanel.tsx:75`

**Step 1: Increase panel background opacity**

On line 75, change:
```tsx
<div class="mt-auto p-3 bg-surface-base/50 border-t border-border-subtle relative">
```
to:
```tsx
<div class="mt-auto p-3 bg-surface-base/80 border-t border-border-subtle relative">
```

**Step 2: Commit**

```
fix(client): improve user panel background contrast
```

---

### Task 8: Search Panel Sidebar Overflow

**Files:**
- Modify: `client/src/components/layout/Sidebar.tsx:94`

**Step 1: Add relative and overflow-hidden to sidebar**

On line 94, change:
```tsx
<aside class="w-[240px] flex flex-col bg-surface-layer2 z-10 transition-all duration-300 border-r border-border-solid">
```
to:
```tsx
<aside class="w-[240px] flex flex-col bg-surface-layer2 z-10 transition-all duration-300 border-r border-border-solid relative overflow-hidden">
```

**Step 2: Commit**

```
fix(client): contain search panel overlay within sidebar bounds
```

---

### Task 9: Final Verification and Squash Commit

**Step 1: Run lints**

```bash
cd client && bun run lint
```

**Step 2: Run client tests**

```bash
cd client && bun run test:run
```

**Step 3: Visual verification**

Switch between all 4 themes (Focused Hybrid, Solarized Dark, Solarized Light, Pixel Cozy) and verify each fix area looks correct.
