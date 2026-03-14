# Nordic Default Theme & Border Separation

**Date:** 2026-03-07
**Status:** Approved
**Scope:** Client default theme colors + layout border strategy

## Goal

Align the client's default theme with the CachyOS Nordic color scheme used on the landing page, and add solid border lines between major UI layout areas for clearer visual separation.

## Color Palette Update

Replace the "focused-hybrid" surface and text colors with true Nord palette values. Accents already match and remain unchanged.

| Token | Current | New (Nord) | Source |
|---|---|---|---|
| `surface-base` | `#1e1e2e` | `#242933` | Landing `--bg-darker` |
| `surface-layer1` | `#252535` | `#2E3440` | Landing `--bg-dark` |
| `surface-layer2` | `#2a2a3c` | `#3B4252` | Nord Polar Night 2 |
| `surface-highlight` | `#36364d` | `#434C5E` | Nord Polar Night 3 |
| `text-secondary` | `#9ca3af` | `#D8DEE9` | Landing `--text-muted` |
| `text-input` | `#ffffff` | `#ECEFF4` | Nord Snow Storm 3 |

Unchanged tokens: `text-primary` (#ECEFF4), all accents (Frost/Aurora colors), selection, error.

The `:root` fallback block receives the same values.

## Border Strategy

Three-tier border system:

1. **Solid borders** (`--color-border-solid: #4C566A`) — Major vertical layout dividers between ServerRail, Sidebar, and Main Stage.
2. **Default borders** (`--color-border-default: rgba(216, 222, 233, 0.12)`) — Input fields, cards, panels.
3. **Subtle borders** (`--color-border-subtle: rgba(216, 222, 233, 0.06)`) — Horizontal dividers within panels (sidebar header, user panel separator).

New `--color-border-solid` token added to theme system and mapped in UnoCSS config alongside existing `border-subtle` and `border-default`.

## Component Changes

### Solid borders (vertical layout dividers)
- `ServerRail.tsx` — `border-r border-white/10` -> `border-r border-border-solid`
- `AppShell.tsx` — `border-l border-white/10` -> `border-l border-border-solid`
- `Sidebar.tsx` — `border-r border-white/10` -> `border-r border-border-solid`

### Subtle borders (horizontal internal dividers)
- `Sidebar.tsx` header — `border-b border-white/10` -> `border-b border-border-subtle`
- `Sidebar.tsx` divider — `border-t border-white/10` -> `border-t border-border-subtle`
- `UserPanel.tsx` — `border-t border-white/10` -> `border-t border-border-subtle`

## Files Changed

1. `client/src/styles/themes.css` — Update focused-hybrid + `:root` fallback, add `--color-border-solid`
2. `client/uno.config.ts` — Add `border` color mappings
3. `client/src/components/layout/ServerRail.tsx` — Solid border class
4. `client/src/components/layout/AppShell.tsx` — Solid border class
5. `client/src/components/layout/Sidebar.tsx` — Solid + subtle border classes
6. `client/src/components/layout/UserPanel.tsx` — Subtle border class

## Not Changed

- Theme name stays "focused-hybrid"
- Theme store, types, preferences untouched
- Other themes (solarized-dark, solarized-light, pixel-cozy) untouched
- Internal component borders (inputs, cards, modals) left as-is
