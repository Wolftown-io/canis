# Session Expiry Notification — Implementation Plan


**Goal:** Notify users when their session expires and provide a clean path to re-login.

**Architecture:** Add a `visibilitychange` listener to refresh tokens when returning to a background tab, listen for the existing `kaiku:session-expired` event with one automatic retry, and show a non-dismissable modal when the session is truly lost.

**Tech Stack:** Solid.js, TypeScript, Vitest, UnoCSS, lucide-solid

---

### Task 1: Add `sessionExpired` to auth state

**Files:**
- Modify: `client/src/stores/auth.ts:26-45`
- Modify: `client/src/stores/__tests__/auth.test.ts:80-99`

**Step 1: Add `sessionExpired` to AuthState interface and initial state**

In `client/src/stores/auth.ts`, add `sessionExpired: boolean` to the `AuthState` interface (line 26) and set it to `false` in the initial store (line 37):

```typescript
// Auth state interface
interface AuthState {
  user: User | null;
  serverUrl: string | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  setupRequired: boolean;
  mfaRequired: boolean;
  sessionExpired: boolean;
}

// Create the store
const [authState, setAuthState] = createStore<AuthState>({
  user: null,
  serverUrl: null,
  isLoading: false,
  isInitialized: false,
  error: null,
  setupRequired: false,
  mfaRequired: false,
  sessionExpired: false,
});
```

**Step 2: Update test `beforeEach` to include `sessionExpired`**

In `client/src/stores/__tests__/auth.test.ts`, update the `beforeEach` reset (line 82) to include `sessionExpired: false`:

```typescript
beforeEach(() => {
  vi.clearAllMocks();
  setAuthState({
    user: null,
    serverUrl: null,
    isLoading: false,
    isInitialized: false,
    error: null,
    setupRequired: false,
    sessionExpired: false,
  });
});
```

**Step 3: Add test for initial sessionExpired state**

In the `"initial state"` describe block, add:

```typescript
it("has sessionExpired false initially", () => {
  expect(authState.sessionExpired).toBe(false);
});
```

**Step 4: Run tests**

Run: `cd client && bun run test:run -- --reporter verbose src/stores/__tests__/auth.test.ts`
Expected: All pass, including the new test.

**Step 5: Commit**

```bash
git add client/src/stores/auth.ts client/src/stores/__tests__/auth.test.ts
git commit -m "feat(client): add sessionExpired flag to auth state"
```

---

### Task 2: Handle `kaiku:session-expired` event with silent retry

**Files:**
- Modify: `client/src/stores/auth.ts`
- Modify: `client/src/stores/__tests__/auth.test.ts`

**Step 1: Write tests for session-expired event handling**

Add a new describe block in `client/src/stores/__tests__/auth.test.ts`. The mock for `tauri` already exists at the top of the file. Add `refreshAccessToken` to the mock:

Update the existing mock at the top of the file (line 3):

```typescript
vi.mock("@/lib/tauri", () => ({
  getCurrentUser: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  oidcCompleteLogin: vi.fn(),
  refreshAccessToken: vi.fn(),
}));
```

Update the import (line 34):

```typescript
import * as tauri from "@/lib/tauri";
```

Add the test block after the `clearSetupRequired` describe:

```typescript
describe("session expired handling", () => {
  it("retries refresh on kaiku:session-expired and recovers", async () => {
    setAuthState({ user: createUser(), isInitialized: true });
    vi.mocked(tauri.refreshAccessToken).mockResolvedValue(true);

    window.dispatchEvent(new CustomEvent("kaiku:session-expired"));

    // Allow async handler to run
    await vi.waitFor(() => {
      expect(tauri.refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    expect(authState.sessionExpired).toBe(false);
    expect(authState.user).not.toBeNull();
  });

  it("sets sessionExpired and cleans up when retry fails", async () => {
    setAuthState({ user: createUser(), isInitialized: true });
    vi.mocked(tauri.refreshAccessToken).mockResolvedValue(false);
    vi.mocked(wsDisconnect).mockResolvedValue(undefined);
    vi.mocked(cleanupWebSocket).mockResolvedValue(undefined);

    window.dispatchEvent(new CustomEvent("kaiku:session-expired"));

    await vi.waitFor(() => {
      expect(authState.sessionExpired).toBe(true);
    });

    expect(authState.user).toBeNull();
    expect(wsDisconnect).toHaveBeenCalled();
  });

  it("ignores event when not authenticated", async () => {
    setAuthState({ user: null, isInitialized: true });

    window.dispatchEvent(new CustomEvent("kaiku:session-expired"));

    // Give time for any async handler
    await new Promise((r) => setTimeout(r, 50));

    expect(tauri.refreshAccessToken).not.toHaveBeenCalled();
    expect(authState.sessionExpired).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd client && bun run test:run -- --reporter verbose src/stores/__tests__/auth.test.ts`
Expected: The 3 new tests fail (no listener registered yet).

**Step 3: Implement the session-expired event listener**

In `client/src/stores/auth.ts`, add the handler after the `registerWebSocketReconnectListener` function (after line 72). Import `refreshAccessToken` from `@/lib/tauri`:

Update the import at line 9:

```typescript
import * as tauri from "@/lib/tauri";
import { refreshAccessToken } from "@/lib/tauri";
```

Wait — `refreshAccessToken` is already exported from `@/lib/tauri`. The existing import uses `* as tauri`. Add `refreshAccessToken` to the named imports or use `tauri.refreshAccessToken`. Since the file already uses `import * as tauri`, use `tauri.refreshAccessToken`.

Add after line 72 (after the `registerWebSocketReconnectListener` function):

```typescript
// Session-expired listener (registered once globally to prevent leaks)
let sessionExpiredListenerRegistered = false;

function registerSessionExpiredListener() {
  if (typeof window === "undefined" || sessionExpiredListenerRegistered) return;

  window.addEventListener("kaiku:session-expired", async () => {
    // Ignore if not authenticated
    if (!authState.user) return;

    console.warn("[Kaiku:Auth] Session expired: attempting silent retry...");

    const success = await tauri.refreshAccessToken();
    if (success) {
      console.log("[Kaiku:Auth] Silent retry: success — session recovered");
      return;
    }

    console.warn("[Kaiku:Auth] Silent retry: failed — showing expiry modal");

    // Clean up connections
    try {
      await wsDisconnect();
      await cleanupWebSocket();
      stopIdleDetectionCleanup();
      cleanupPresence();
    } catch (err) {
      console.error("[Auth] Cleanup during session expiry failed:", err);
    }

    setAuthState({
      user: null,
      sessionExpired: true,
      error: null,
    });
  });

  sessionExpiredListenerRegistered = true;
}

// Register immediately — the listener checks auth state internally
registerSessionExpiredListener();
```

**Step 4: Run tests to verify they pass**

Run: `cd client && bun run test:run -- --reporter verbose src/stores/__tests__/auth.test.ts`
Expected: All pass.

**Step 5: Commit**

```bash
git add client/src/stores/auth.ts client/src/stores/__tests__/auth.test.ts
git commit -m "feat(client): handle kaiku:session-expired with silent retry"
```

---

### Task 3: Add visibility-based token refresh

**Files:**
- Modify: `client/src/lib/tauri.ts:506-514`

**Step 1: Add visibilitychange listener**

In `client/src/lib/tauri.ts`, replace the block at lines 507-514 (the existing on-load refresh) with a version that also registers a visibility listener:

```typescript
// On browser load, attempt to restore session from HttpOnly cookie.
// The cookie is sent automatically; the server returns a fresh access token.
if (!isTauri && !browserState.accessToken) {
  if (!isSessionRestoreBlocked()) {
    // refreshAccessToken never throws (returns false on failure), so no .catch() needed.
    void refreshAccessToken();
  }
}

// When the tab becomes visible again, check if the token needs refreshing.
// Browsers throttle/pause setTimeout in background tabs, so the scheduled
// refresh may not fire before the access token expires.
if (!isTauri && typeof document !== "undefined") {
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return;
    if (!browserState.accessToken) return;

    const now = Date.now();
    const expiresAt = browserState.tokenExpiresAt;

    // Refresh if expired or within 60s of expiry
    if (expiresAt && expiresAt - now < 60000) {
      console.warn(
        "[Kaiku:Auth] Visibility refresh: token expired/near-expiry, refreshing...",
      );
      const success = await refreshAccessToken();
      if (success) {
        console.log("[Kaiku:Auth] Visibility refresh: success");
      }
      // If refresh fails, scheduleTokenRefresh's failure handler already
      // dispatches kaiku:session-expired, which Task 2's listener handles.
    }
  });
}
```

Note: If `refreshAccessToken()` fails here, it calls `clearBrowserTokens()` and dispatches `kaiku:session-expired` (line 419-421), which triggers the retry logic from Task 2. No duplicate handling needed.

**Step 2: Run all client tests**

Run: `cd client && bun run test:run -- --reporter verbose`
Expected: All pass (no regressions).

**Step 3: Commit**

```bash
git add client/src/lib/tauri.ts
git commit -m "feat(client): refresh token on tab visibility change"
```

---

### Task 4: Create SessionExpiredModal component

**Files:**
- Create: `client/src/components/auth/SessionExpiredModal.tsx`

**Step 1: Create the modal component**

Create `client/src/components/auth/SessionExpiredModal.tsx`. Follow the existing modal pattern from `BlockConfirmModal.tsx` (Portal-based, fixed overlay), but without dismiss-on-backdrop or escape key:

```typescript
import { Component, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { useNavigate } from "@solidjs/router";
import { LogIn } from "lucide-solid";
import { authState, setAuthState, logout } from "@/stores/auth";

const SessionExpiredModal: Component = () => {
  const navigate = useNavigate();

  const handleLogin = async () => {
    // Clear session state and navigate to login
    try {
      await logout();
    } catch {
      // Logout may fail if session is already gone — that's fine
    }
    setAuthState({ sessionExpired: false });
    navigate("/login", { replace: true });
  };

  return (
    <Show when={authState.sessionExpired}>
      <Portal>
        <div class="fixed inset-0 z-50 flex items-center justify-center">
          <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          <div
            class="relative rounded-xl border border-white/10 w-[400px] shadow-2xl animate-[fadeIn_0.15s_ease-out]"
            style="background-color: var(--color-surface-layer1)"
          >
            {/* Header */}
            <div class="flex items-center gap-3 px-5 py-4 border-b border-white/10">
              <div class="w-9 h-9 rounded-lg bg-status-warning/20 flex items-center justify-center">
                <LogIn class="w-5 h-5 text-status-warning" />
              </div>
              <h2 class="text-lg font-bold text-text-primary">
                Session Expired
              </h2>
            </div>

            {/* Content */}
            <div class="p-5 space-y-4">
              <p class="text-text-secondary text-sm">
                Your session has expired. Please log in again to continue.
              </p>

              <div class="flex justify-end">
                <button
                  onClick={handleLogin}
                  class="px-4 py-2 rounded-lg bg-primary text-white font-medium transition-colors hover:bg-primary/90"
                >
                  Log in
                </button>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export default SessionExpiredModal;
```

**Step 2: Run all client tests**

Run: `cd client && bun run test:run -- --reporter verbose`
Expected: All pass (new file, no regressions).

**Step 3: Commit**

```bash
git add client/src/components/auth/SessionExpiredModal.tsx
git commit -m "feat(client): add SessionExpiredModal component"
```

---

### Task 5: Mount SessionExpiredModal in App.tsx

**Files:**
- Modify: `client/src/App.tsx:39,90`

**Step 1: Import and render SessionExpiredModal**

In `client/src/App.tsx`, add the import after line 39 (after the `BlockConfirmModal` import):

```typescript
import SessionExpiredModal from "./components/auth/SessionExpiredModal";
```

Add `<SessionExpiredModal />` inside the `Layout` component, after `<ToastContainer />` (line 90):

```tsx
<ToastContainer />
<SessionExpiredModal />
<ContextMenuContainer />
```

**Step 2: Run all client tests**

Run: `cd client && bun run test:run -- --reporter verbose`
Expected: All pass.

**Step 3: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(client): mount SessionExpiredModal in app layout"
```

---

### Task 6: Reset sessionExpired on successful login

**Files:**
- Modify: `client/src/stores/auth.ts`

**Step 1: Add `sessionExpired: false` to login/register/initAuth success paths**

In the `login` function (around line 147), add `sessionExpired: false` to the `setAuthState` call:

```typescript
setAuthState({
  user: result.user,
  serverUrl,
  isLoading: false,
  isInitialized: true,
  error: null,
  setupRequired: result.setup_required,
  mfaRequired: false,
  sessionExpired: false,
});
```

Do the same in `register` (around line 221) and `loginWithOidc` (around line 284).

**Step 2: Run tests**

Run: `cd client && bun run test:run -- --reporter verbose src/stores/__tests__/auth.test.ts`
Expected: All pass.

**Step 3: Commit**

```bash
git add client/src/stores/auth.ts
git commit -m "feat(client): reset sessionExpired on login"
```

---

### Task 7: Manual smoke test

**Step 1: Start dev environment**

```bash
podman compose -f docker-compose.dev.yml --profile storage up -d
cd client && bun run dev
```

**Step 2: Test visibility refresh**

1. Log in to the app in the browser
2. Open DevTools console, filter for `[Kaiku:Auth]`
3. Switch to another tab, wait >15 minutes (or temporarily change `refreshIn` threshold for testing)
4. Switch back — verify `Visibility refresh: token expired/near-expiry, refreshing...` appears
5. Verify the app continues to work normally

**Step 3: Test session expired modal**

1. While logged in, open DevTools console
2. Run: `window.dispatchEvent(new CustomEvent("kaiku:session-expired"))`
3. Verify console shows `Session expired: attempting silent retry...`
4. If refresh succeeds (token still valid): verify `Silent retry: success` and no modal
5. To force the modal: clear cookies first, then dispatch the event
6. Verify the modal appears, is non-dismissable, and "Log in" navigates to `/login`

**Step 4: Commit (no code changes expected)**

If any fixes were needed during smoke testing, commit them here.
