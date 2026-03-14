# Session Expiry Notification — Design

**Date:** 2026-03-06
**Status:** Approved

## Problem

When the browser tab is in the background, `setTimeout` gets throttled/paused. The scheduled token refresh (60s before the 15-min access token expiry) never fires, causing the access token to expire silently. When the user returns, the app is in a degraded state with 401 errors and no feedback.

Additionally, the `kaiku:session-expired` custom event is already dispatched when a refresh token fails, but nothing in the UI listens to it. Users experience silent session loss with no path to recovery.

## Solution

Three components working together:

### 1. Visibility-Based Token Refresh

**File:** `client/src/lib/tauri.ts`

- Add a `visibilitychange` event listener.
- When the tab becomes visible: check if the access token is expired or within 60s of expiry.
- If so, trigger `refreshAccessToken()` immediately.
- This covers the browser-background-tab throttling problem.

### 2. Session Expired Event Handling

**File:** `client/src/stores/auth.ts`

- Listen for the existing `kaiku:session-expired` custom event (already dispatched, currently unhandled).
- On event: attempt one silent retry of `refreshAccessToken()`.
- If retry succeeds: dismiss, resume normally.
- If retry fails: set `sessionExpired: true` in auth state, disconnect WebSocket, clear tokens.

### 3. Session Expired Modal

**File:** `client/src/components/auth/SessionExpiredModal.tsx`

- New modal component, shown when `sessionExpired` is true.
- Message: "Your session has expired. Please log in again."
- Single "Log in" button that clears auth state and navigates to the login page.
- Non-dismissable (no backdrop click, no escape key) — the app is in a broken state.
- Rendered at root level (in `App.tsx` alongside existing Toast portal).

## Data Flow

```
Token refresh fails
  -> dispatches kaiku:session-expired (existing)
  -> auth store listener catches it
  -> silent retry once
  -> fails again -> set sessionExpired=true, cleanup
  -> SessionExpiredModal renders
  -> user clicks "Log in" -> navigate to /login
```

## Logging

All session recovery events logged to browser console with `[Kaiku:Auth]` prefix for easy filtering:

- `[Kaiku:Auth] Visibility refresh: token expired/near-expiry, refreshing...`
- `[Kaiku:Auth] Visibility refresh: success`
- `[Kaiku:Auth] Session expired: attempting silent retry...`
- `[Kaiku:Auth] Silent retry: success — session recovered`
- `[Kaiku:Auth] Silent retry: failed — showing expiry modal`

## Out of Scope

- Proactive "session ending soon" warnings
- Multi-device session management
- Server-side push notification of session revocation
- Changes to token lifetimes
