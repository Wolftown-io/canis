# Frontend Visual Polish — Design Document

**Date:** 2026-03-14

**Goal:** Fix 9 visual issues identified from a full-app screenshot review, covering contrast, visibility, consistency, and layout across all 4 themes.

## Context

A systematic screenshot review of 33 screens revealed visual issues ranging from unreadable badges to low-contrast icons. All fixes use existing semantic theme tokens and work across all 4 themes (Focused Hybrid, Solarized Dark, Solarized Light, Pixel Cozy) without per-theme overrides.

## Issues and Fixes

### Fix 1: Admin Elevation Badge — Low Contrast (P1)
- **File:** `AdminDashboard.tsx`
- **Problem:** `bg-status-warning/15` produces near-invisible badge on darker themes
- **Fix:** Increase to `bg-status-warning/20`; change banner text from `text-text-primary/80` to `text-text-primary`

### Fix 2: Admin GuildsPanel — Inconsistent Status Tokens (P1)
- **File:** `GuildsPanel.tsx`
- **Problem:** Uses `text-accent-success`/`text-accent-danger` while UsersPanel uses `text-status-success`/`text-status-error`
- **Fix:** Unify to `text-status-success`/`text-status-error`

### Fix 3: Friend Request Buttons — Too Small (P1)
- **File:** `PendingModule.tsx`
- **Problem:** Buttons are tiny (`p-1.5`) with low-opacity backgrounds (`/20`)
- **Fix:** Increase to `p-2`, boost opacity to `/25` default and `/40` hover

### Fix 4: Formatting Toolbar — Low Contrast Icons (P2)
- **File:** `MessageInput.tsx`
- **Problem:** `text-text-secondary` on `surface-layer2` fails AA contrast on Solarized Dark
- **Fix:** Change to `text-text-primary/50 hover:text-text-primary`

### Fix 5: Settings Modal — Weak Backdrop (P2)
- **File:** `SettingsModal.tsx`
- **Problem:** `bg-black/60` lets too much content bleed through
- **Fix:** Increase to `bg-black/70`

### Fix 6: Settings Nav — Weak Active Tab (P2)
- **File:** `SettingsModal.tsx`
- **Problem:** Active tab highlight (`bg-accent-primary/20`) barely distinguishable
- **Fix:** Increase to `bg-accent-primary/25`

### Fix 7: Server Rail — Low Default Opacity (P2)
- **File:** `ServerRail.tsx`
- **Problem:** Default guild icon opacity of 0.8 makes abbreviations hard to read
- **Fix:** Increase to 0.85

### Fix 8: User Panel — Low Background Contrast (P3)
- **File:** `UserPanel.tsx`
- **Problem:** `bg-surface-base/50` blends into sidebar
- **Fix:** Increase to `bg-surface-base/80`

### Fix 9: Search Panel — Overlay Escapes Sidebar (P2)
- **File:** `Sidebar.tsx`
- **Problem:** `absolute inset-0 z-50` search panel overflows sidebar bounds
- **Fix:** Add `relative overflow-hidden` to sidebar `<aside>`

## Theme Compatibility

All fixes use existing semantic tokens. No new CSS variables needed. Verified against:
- Focused Hybrid (Nord dark)
- Solarized Dark
- Solarized Light
- Pixel Cozy (8-bit RPG)
