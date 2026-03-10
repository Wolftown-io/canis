# Push-to-Talk / Push-to-Mute Hotkey Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add configurable push-to-talk (PTT) and push-to-mute (PTM) hotkeys that work system-wide in Tauri and window-scoped in browser.

**Architecture:** PTT and PTM are input activation modes controlling mic mute state via held hotkeys. A new `pttManager` module owns hotkey registration, state resolution, and mic toggling. Tauri uses `@tauri-apps/plugin-global-shortcut` for OS-level hotkeys; browser falls back to `window` keydown/keyup listeners. Both modes can coexist — mute always wins conflicts.

**Tech Stack:** `tauri-plugin-global-shortcut` (Rust crate + JS package), Solid.js signals, existing voice adapter `setMute()`, vitest.

**Design Doc:** `docs/developer-guide/plans/2026-03-10-ptt-hotkey-design.md`

---

### Task 1: Add Tauri Global Shortcut Plugin Dependencies

**Files:**
- Modify: `client/src-tauri/Cargo.toml:22-25`
- Modify: `client/src-tauri/src/lib.rs:55-57`
- Modify: `client/package.json:19-34`
- Modify: `client/src-tauri/capabilities/default.json` (if it exists; otherwise create)

**Step 1: Add Rust dependency**

In `client/src-tauri/Cargo.toml`, after line 25 (`tauri-plugin-notification = "2"`), add:

```toml
tauri-plugin-global-shortcut = "2"
```

**Step 2: Register plugin in Tauri builder**

In `client/src-tauri/src/lib.rs`, after line 57 (`.plugin(tauri_plugin_notification::init())`), add:

```rust
.plugin(tauri_plugin_global_shortcut::Builder::new().build())
```

**Step 3: Add JS package**

Run:
```bash
cd client && bun add @tauri-apps/plugin-global-shortcut
```

**Step 4: Add capability permission**

Check if `client/src-tauri/capabilities/default.json` exists. If it does, add `"global-shortcut:allow-register"`, `"global-shortcut:allow-unregister"`, and `"global-shortcut:allow-is-registered"` to the permissions array. If there's no capabilities file, check `client/src-tauri/tauri.conf.json` for a permissions/capabilities section and add there.

**Step 5: Verify it compiles**

Run:
```bash
cd client && SQLX_OFFLINE=true cargo check -p vc-client
```
Expected: compiles without errors.

**Step 6: Commit**

```bash
git add client/src-tauri/Cargo.toml client/src-tauri/src/lib.rs client/package.json client/bun.lockb
git commit -m "chore(client): add tauri-plugin-global-shortcut dependency"
```

---

### Task 2: Extend VoiceSettings Data Model

**Files:**
- Modify: `client/src-tauri/src/commands/settings.rs:42-60` (VoiceSettings struct + defaults)
- Modify: `client/src-tauri/src/commands/settings.rs:82-97` (validation)
- Modify: `client/src/lib/types.ts:685-690` (TypeScript interface)
- Modify: `client/src/lib/tauri.ts:2545-2550` (browser defaults)

**Step 1: Extend Rust VoiceSettings struct**

In `client/src-tauri/src/commands/settings.rs`, replace the `VoiceSettings` struct (lines 42-60) with:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct VoiceSettings {
    pub push_to_talk: bool,
    pub push_to_talk_key: Option<String>,
    pub push_to_talk_release_delay: u32,
    pub push_to_mute: bool,
    pub push_to_mute_key: Option<String>,
    pub push_to_mute_release_delay: u32,
    pub voice_activity_detection: bool,
    pub vad_threshold: f32,
}

impl Default for VoiceSettings {
    fn default() -> Self {
        Self {
            push_to_talk: false,
            push_to_talk_key: None,
            push_to_talk_release_delay: 200,
            push_to_mute: false,
            push_to_mute_key: None,
            push_to_mute_release_delay: 200,
            voice_activity_detection: true,
            vad_threshold: 0.5,
        }
    }
}
```

**Step 2: Update validation logic**

In `client/src-tauri/src/commands/settings.rs`, replace the validation section (lines 91-95) with:

```rust
// PTT without a key binding is unusable — fall back to VAD
if self.voice.push_to_talk && self.voice.push_to_talk_key.is_none() {
    self.voice.push_to_talk = false;
    self.voice.voice_activity_detection = true;
}
// PTM without a key binding is unusable — disable it
if self.voice.push_to_mute && self.voice.push_to_mute_key.is_none() {
    self.voice.push_to_mute = false;
}
// PTT and PTM keys must differ
if self.voice.push_to_talk
    && self.voice.push_to_mute
    && self.voice.push_to_talk_key == self.voice.push_to_mute_key
{
    self.voice.push_to_mute = false;
    self.voice.push_to_mute_key = None;
}
// Clamp release delays
self.voice.push_to_talk_release_delay = self.voice.push_to_talk_release_delay.min(1000);
self.voice.push_to_mute_release_delay = self.voice.push_to_mute_release_delay.min(1000);
```

**Step 3: Update TypeScript interface**

In `client/src/lib/types.ts`, replace the `VoiceSettings` interface (lines 685-690) with:

```typescript
export interface VoiceSettings {
  push_to_talk: boolean;
  push_to_talk_key: string | null;
  push_to_talk_release_delay: number;
  push_to_mute: boolean;
  push_to_mute_key: string | null;
  push_to_mute_release_delay: number;
  voice_activity_detection: boolean;
  vad_threshold: number;
}
```

**Step 4: Update browser defaults**

In `client/src/lib/tauri.ts`, replace the voice defaults (lines 2545-2550) with:

```typescript
    voice: {
      push_to_talk: false,
      push_to_talk_key: null,
      push_to_talk_release_delay: 200,
      push_to_mute: false,
      push_to_mute_key: null,
      push_to_mute_release_delay: 200,
      voice_activity_detection: true,
      vad_threshold: 0.5,
    },
```

**Step 5: Verify compilation**

Run:
```bash
cd client && SQLX_OFFLINE=true cargo check -p vc-client && bun run build
```
Expected: Both compile without errors. Existing settings files deserialize correctly due to `#[serde(default)]`.

**Step 6: Commit**

```bash
git add client/src-tauri/src/commands/settings.rs client/src/lib/types.ts client/src/lib/tauri.ts
git commit -m "feat(client): extend VoiceSettings with PTT/PTM fields"
```

---

### Task 3: Create pttManager Module — Core State Resolution

This is the core logic module. It resolves PTT/PTM state into a mute decision.

**Files:**
- Create: `client/src/lib/pttManager.ts`
- Create: `client/src/lib/__tests__/pttManager.test.ts`

**Step 1: Write the failing tests**

Create `client/src/lib/__tests__/pttManager.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock setMute from voice store
const mockSetMute = vi.fn().mockResolvedValue(undefined);
vi.mock("@/stores/voice", () => ({
  setMute: (...args: unknown[]) => mockSetMute(...args),
  voiceState: { state: "connected", muted: false },
}));

// Import after mocks
import { resolveState, PttConfig } from "@/lib/pttManager";

describe("pttManager state resolution", () => {
  describe("resolveState", () => {
    it("returns muted when PTT enabled and no keys held", () => {
      const config: PttConfig = { pttEnabled: true, ptmEnabled: false };
      expect(resolveState(config, false, false)).toBe(true); // muted
    });

    it("returns unmuted when PTT key held", () => {
      const config: PttConfig = { pttEnabled: true, ptmEnabled: false };
      expect(resolveState(config, true, false)).toBe(false); // unmuted
    });

    it("returns unmuted when only PTM enabled and no keys held", () => {
      const config: PttConfig = { pttEnabled: false, ptmEnabled: true };
      expect(resolveState(config, false, false)).toBe(false); // unmuted
    });

    it("returns muted when PTM key held", () => {
      const config: PttConfig = { pttEnabled: false, ptmEnabled: true };
      expect(resolveState(config, false, true)).toBe(true); // muted
    });

    it("returns muted when both PTT and PTM enabled, no keys held", () => {
      const config: PttConfig = { pttEnabled: true, ptmEnabled: true };
      expect(resolveState(config, false, false)).toBe(true); // PTT resting = muted
    });

    it("returns unmuted when both enabled and PTT held", () => {
      const config: PttConfig = { pttEnabled: true, ptmEnabled: true };
      expect(resolveState(config, true, false)).toBe(false); // unmuted
    });

    it("returns muted when both enabled and PTM held (mute wins)", () => {
      const config: PttConfig = { pttEnabled: true, ptmEnabled: true };
      expect(resolveState(config, false, true)).toBe(true); // muted
    });

    it("returns muted when both keys held (mute wins)", () => {
      const config: PttConfig = { pttEnabled: true, ptmEnabled: true };
      expect(resolveState(config, true, true)).toBe(true); // mute wins
    });

    it("returns unmuted when neither PTT nor PTM enabled", () => {
      const config: PttConfig = { pttEnabled: false, ptmEnabled: false };
      expect(resolveState(config, false, false)).toBe(false); // VAD mode
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
cd client && bun run test:run -- --reporter=verbose src/lib/__tests__/pttManager.test.ts
```
Expected: FAIL — `pttManager` module does not exist.

**Step 3: Implement resolveState and PttConfig**

Create `client/src/lib/pttManager.ts`:

```typescript
/**
 * Push-to-Talk / Push-to-Mute Manager
 *
 * Manages hotkey registration and mic mute state for PTT/PTM modes.
 * Tauri: uses global-shortcut plugin for system-wide hotkeys.
 * Browser: uses window keydown/keyup listeners (active only when focused).
 */

import { setMute } from "@/stores/voice";

export interface PttConfig {
  pttEnabled: boolean;
  ptmEnabled: boolean;
}

/**
 * Resolve the desired mute state from PTT/PTM config and key states.
 *
 * Truth table:
 *   PTT only:  rest=muted,  PTT held=unmuted
 *   PTM only:  rest=unmuted, PTM held=muted
 *   Both:      rest=muted (PTT defines rest), PTT held=unmuted, PTM held=muted
 *   Conflict:  mute wins (safety first)
 *   Neither:   unmuted (VAD mode)
 *
 * @returns true if mic should be muted
 */
export function resolveState(
  config: PttConfig,
  pttHeld: boolean,
  ptmHeld: boolean,
): boolean {
  // PTM always wins — if PTM key is held, mute
  if (config.ptmEnabled && ptmHeld) return true;

  // PTT: if enabled, rest=muted; held=unmuted
  if (config.pttEnabled) {
    return !pttHeld; // muted when not held
  }

  // Neither PTT nor PTM active (or PTM active but not held) → unmuted
  return false;
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
cd client && bun run test:run -- --reporter=verbose src/lib/__tests__/pttManager.test.ts
```
Expected: All 9 tests PASS.

**Step 5: Commit**

```bash
git add client/src/lib/pttManager.ts client/src/lib/__tests__/pttManager.test.ts
git commit -m "feat(client): add pttManager core state resolution logic"
```

---

### Task 4: Add Release Delay and Key Event Handling to pttManager

**Files:**
- Modify: `client/src/lib/pttManager.ts`
- Modify: `client/src/lib/__tests__/pttManager.test.ts`

**Step 1: Add release delay tests**

Append to `client/src/lib/__tests__/pttManager.test.ts`:

```typescript
import { PttController } from "@/lib/pttManager";

describe("PttController", () => {
  let controller: PttController;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    controller = new PttController(mockSetMute);
  });

  afterEach(() => {
    controller.deactivate();
    vi.useRealTimers();
  });

  it("mutes immediately on activate with PTT", () => {
    controller.activate({
      pttEnabled: true,
      pttKey: "Space",
      pttReleaseDelay: 200,
      ptmEnabled: false,
      ptmKey: null,
      ptmReleaseDelay: 200,
    });
    expect(mockSetMute).toHaveBeenCalledWith(true);
  });

  it("unmutes on PTT key press", () => {
    controller.activate({
      pttEnabled: true,
      pttKey: "Space",
      pttReleaseDelay: 200,
      ptmEnabled: false,
      ptmKey: null,
      ptmReleaseDelay: 200,
    });
    mockSetMute.mockClear();

    controller.handleKeyDown("Space");
    expect(mockSetMute).toHaveBeenCalledWith(false);
  });

  it("re-mutes after release delay on PTT key release", () => {
    controller.activate({
      pttEnabled: true,
      pttKey: "Space",
      pttReleaseDelay: 200,
      ptmEnabled: false,
      ptmKey: null,
      ptmReleaseDelay: 200,
    });
    controller.handleKeyDown("Space");
    mockSetMute.mockClear();

    controller.handleKeyUp("Space");
    // Should not re-mute immediately
    expect(mockSetMute).not.toHaveBeenCalled();

    // After delay, should re-mute
    vi.advanceTimersByTime(200);
    expect(mockSetMute).toHaveBeenCalledWith(true);
  });

  it("cancels release timer if key pressed again", () => {
    controller.activate({
      pttEnabled: true,
      pttKey: "Space",
      pttReleaseDelay: 200,
      ptmEnabled: false,
      ptmKey: null,
      ptmReleaseDelay: 200,
    });
    controller.handleKeyDown("Space");
    controller.handleKeyUp("Space");
    mockSetMute.mockClear();

    // Press again before delay expires
    vi.advanceTimersByTime(100);
    controller.handleKeyDown("Space");
    expect(mockSetMute).toHaveBeenCalledWith(false);

    // Original timer should be cancelled
    vi.advanceTimersByTime(200);
    expect(mockSetMute).toHaveBeenCalledTimes(1); // only the press, no delayed mute
  });

  it("ignores key repeat (duplicate keydown)", () => {
    controller.activate({
      pttEnabled: true,
      pttKey: "Space",
      pttReleaseDelay: 200,
      ptmEnabled: false,
      ptmKey: null,
      ptmReleaseDelay: 200,
    });
    controller.handleKeyDown("Space");
    mockSetMute.mockClear();

    // Repeated keydown events (OS auto-repeat)
    controller.handleKeyDown("Space");
    controller.handleKeyDown("Space");
    expect(mockSetMute).not.toHaveBeenCalled(); // already held, no-op
  });

  it("PTM mutes on key press", () => {
    controller.activate({
      pttEnabled: false,
      pttKey: null,
      pttReleaseDelay: 200,
      ptmEnabled: true,
      ptmKey: "KeyM",
      ptmReleaseDelay: 200,
    });
    mockSetMute.mockClear();

    controller.handleKeyDown("KeyM");
    expect(mockSetMute).toHaveBeenCalledWith(true);
  });

  it("PTM unmutes after release delay", () => {
    controller.activate({
      pttEnabled: false,
      pttKey: null,
      pttReleaseDelay: 200,
      ptmEnabled: true,
      ptmKey: "KeyM",
      ptmReleaseDelay: 300,
    });
    controller.handleKeyDown("KeyM");
    mockSetMute.mockClear();

    controller.handleKeyUp("KeyM");
    expect(mockSetMute).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(mockSetMute).toHaveBeenCalledWith(false); // unmute
  });

  it("mute wins when both PTT and PTM held", () => {
    controller.activate({
      pttEnabled: true,
      pttKey: "Space",
      pttReleaseDelay: 200,
      ptmEnabled: true,
      ptmKey: "KeyM",
      ptmReleaseDelay: 200,
    });
    controller.handleKeyDown("Space"); // unmute via PTT
    mockSetMute.mockClear();

    controller.handleKeyDown("KeyM"); // PTM overrides → mute
    expect(mockSetMute).toHaveBeenCalledWith(true);
  });

  it("deactivate clears state and cancels timers", () => {
    controller.activate({
      pttEnabled: true,
      pttKey: "Space",
      pttReleaseDelay: 200,
      ptmEnabled: false,
      ptmKey: null,
      ptmReleaseDelay: 200,
    });
    controller.handleKeyDown("Space");
    controller.handleKeyUp("Space");
    mockSetMute.mockClear();

    controller.deactivate();

    // Timer should be cancelled — no mute call after delay
    vi.advanceTimersByTime(500);
    expect(mockSetMute).not.toHaveBeenCalled();
  });

  it("ignores unrelated keys", () => {
    controller.activate({
      pttEnabled: true,
      pttKey: "Space",
      pttReleaseDelay: 200,
      ptmEnabled: false,
      ptmKey: null,
      ptmReleaseDelay: 200,
    });
    mockSetMute.mockClear();

    controller.handleKeyDown("KeyA");
    controller.handleKeyUp("KeyA");
    expect(mockSetMute).not.toHaveBeenCalled();
  });
});
```

Add `afterEach` import at top if not present.

**Step 2: Run tests to verify they fail**

Run:
```bash
cd client && bun run test:run -- --reporter=verbose src/lib/__tests__/pttManager.test.ts
```
Expected: FAIL — `PttController` class does not exist.

**Step 3: Implement PttController**

Add to `client/src/lib/pttManager.ts`:

```typescript
export interface PttFullConfig {
  pttEnabled: boolean;
  pttKey: string | null;
  pttReleaseDelay: number;
  ptmEnabled: boolean;
  ptmKey: string | null;
  ptmReleaseDelay: number;
}

type SetMuteFn = (muted: boolean) => void | Promise<void>;

/**
 * Controller that tracks key states and applies mute state with release delays.
 * Decoupled from event sources — call handleKeyDown/handleKeyUp from any input.
 */
export class PttController {
  private config: PttFullConfig | null = null;
  private pttHeld = false;
  private ptmHeld = false;
  private pttReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private ptmReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private setMuteFn: SetMuteFn;

  constructor(setMuteFn: SetMuteFn) {
    this.setMuteFn = setMuteFn;
  }

  activate(config: PttFullConfig): void {
    this.config = config;
    this.pttHeld = false;
    this.ptmHeld = false;
    this.clearTimers();
    // Apply initial state
    this.applyState();
  }

  deactivate(): void {
    this.config = null;
    this.pttHeld = false;
    this.ptmHeld = false;
    this.clearTimers();
  }

  handleKeyDown(code: string): void {
    if (!this.config) return;

    if (this.config.pttEnabled && code === this.config.pttKey) {
      if (this.pttHeld) return; // ignore key repeat
      this.pttHeld = true;
      // Cancel any pending PTT release
      if (this.pttReleaseTimer !== null) {
        clearTimeout(this.pttReleaseTimer);
        this.pttReleaseTimer = null;
      }
      this.applyState();
    }

    if (this.config.ptmEnabled && code === this.config.ptmKey) {
      if (this.ptmHeld) return; // ignore key repeat
      this.ptmHeld = true;
      // Cancel any pending PTM release
      if (this.ptmReleaseTimer !== null) {
        clearTimeout(this.ptmReleaseTimer);
        this.ptmReleaseTimer = null;
      }
      this.applyState();
    }
  }

  handleKeyUp(code: string): void {
    if (!this.config) return;

    if (this.config.pttEnabled && code === this.config.pttKey) {
      this.pttHeld = false;
      // Delay the state change
      if (this.pttReleaseTimer !== null) clearTimeout(this.pttReleaseTimer);
      this.pttReleaseTimer = setTimeout(() => {
        this.pttReleaseTimer = null;
        this.applyState();
      }, this.config.pttReleaseDelay);
    }

    if (this.config.ptmEnabled && code === this.config.ptmKey) {
      this.ptmHeld = false;
      if (this.ptmReleaseTimer !== null) clearTimeout(this.ptmReleaseTimer);
      this.ptmReleaseTimer = setTimeout(() => {
        this.ptmReleaseTimer = null;
        this.applyState();
      }, this.config.ptmReleaseDelay);
    }
  }

  /** Release all held keys (e.g. on window blur). */
  releaseAll(): void {
    if (!this.config) return;
    const hadPtt = this.pttHeld;
    const hadPtm = this.ptmHeld;
    this.pttHeld = false;
    this.ptmHeld = false;
    this.clearTimers();
    if (hadPtt || hadPtm) {
      this.applyState();
    }
  }

  isActive(): boolean {
    return this.config !== null;
  }

  isPttOrPtmEnabled(): boolean {
    return this.config !== null && (this.config.pttEnabled || this.config.ptmEnabled);
  }

  private applyState(): void {
    if (!this.config) return;
    const shouldMute = resolveState(
      { pttEnabled: this.config.pttEnabled, ptmEnabled: this.config.ptmEnabled },
      this.pttHeld,
      this.ptmHeld,
    );
    this.setMuteFn(shouldMute);
  }

  private clearTimers(): void {
    if (this.pttReleaseTimer !== null) {
      clearTimeout(this.pttReleaseTimer);
      this.pttReleaseTimer = null;
    }
    if (this.ptmReleaseTimer !== null) {
      clearTimeout(this.ptmReleaseTimer);
      this.ptmReleaseTimer = null;
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
cd client && bun run test:run -- --reporter=verbose src/lib/__tests__/pttManager.test.ts
```
Expected: All tests PASS (9 state resolution + 10 controller tests).

**Step 5: Commit**

```bash
git add client/src/lib/pttManager.ts client/src/lib/__tests__/pttManager.test.ts
git commit -m "feat(client): add PttController with release delay and key handling"
```

---

### Task 5: Add Browser Event Listeners and Blur Handling to pttManager

**Files:**
- Modify: `client/src/lib/pttManager.ts`
- Modify: `client/src/lib/__tests__/pttManager.test.ts`

**Step 1: Add blur handling test**

Append to the `PttController` describe block in `pttManager.test.ts`:

```typescript
  it("releases all keys on blur (releaseAll)", () => {
    controller.activate({
      pttEnabled: true,
      pttKey: "Space",
      pttReleaseDelay: 200,
      ptmEnabled: false,
      ptmKey: null,
      ptmReleaseDelay: 200,
    });
    controller.handleKeyDown("Space"); // unmuted
    mockSetMute.mockClear();

    controller.releaseAll(); // simulates blur
    expect(mockSetMute).toHaveBeenCalledWith(true); // back to muted
  });
```

**Step 2: Run tests to verify they pass**

The `releaseAll` method already exists from Task 4.

Run:
```bash
cd client && bun run test:run -- --reporter=verbose src/lib/__tests__/pttManager.test.ts
```
Expected: All tests PASS.

**Step 3: Add browser event binding functions**

Add to `client/src/lib/pttManager.ts`:

```typescript
const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

/**
 * Create a PttController wired to browser keyboard events.
 * Call the returned cleanup function to remove listeners.
 */
export function createBrowserPttListeners(controller: PttController): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    controller.handleKeyDown(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    controller.handleKeyUp(e.code);
  };
  const onBlur = () => {
    controller.releaseAll();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  };
}

/**
 * Register global shortcuts via Tauri plugin.
 * Returns a cleanup function to unregister.
 * Falls back to browser listeners on registration failure.
 */
export async function createTauriPttListeners(
  controller: PttController,
  config: PttFullConfig,
): Promise<() => void> {
  // Always set up browser listeners as baseline
  const cleanupBrowser = createBrowserPttListeners(controller);

  if (!isTauri) return cleanupBrowser;

  try {
    const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
    const registeredKeys: string[] = [];

    if (config.pttEnabled && config.pttKey) {
      const tauriKey = mapCodeToTauriShortcut(config.pttKey);
      if (tauriKey) {
        await register(tauriKey, (event) => {
          if (event.state === "Pressed") controller.handleKeyDown(config.pttKey!);
          if (event.state === "Released") controller.handleKeyUp(config.pttKey!);
        });
        registeredKeys.push(tauriKey);
      }
    }

    if (config.ptmEnabled && config.ptmKey) {
      const tauriKey = mapCodeToTauriShortcut(config.ptmKey);
      if (tauriKey) {
        await register(tauriKey, (event) => {
          if (event.state === "Pressed") controller.handleKeyDown(config.ptmKey!);
          if (event.state === "Released") controller.handleKeyUp(config.ptmKey!);
        });
        registeredKeys.push(tauriKey);
      }
    }

    return async () => {
      cleanupBrowser();
      for (const key of registeredKeys) {
        try {
          await unregister(key);
        } catch {
          // Ignore unregister errors during cleanup
        }
      }
    };
  } catch (err) {
    console.warn("[PTT] Failed to register global shortcuts, using browser-only:", err);
    return cleanupBrowser;
  }
}

/**
 * Map browser event.code to Tauri shortcut string.
 * Tauri uses accelerator strings like "Space", "F1", "CapsLock".
 * Returns null if the key cannot be mapped.
 */
export function mapCodeToTauriShortcut(code: string): string | null {
  // Direct mappings for common PTT keys
  const map: Record<string, string> = {
    Space: "Space",
    CapsLock: "CapsLock",
    Backquote: "`",
    Tab: "Tab",
    // Letter keys: "KeyA" → "A"
    // Number keys: "Digit0" → "0"
    // Function keys: "F1" → "F1"
  };

  if (map[code]) return map[code];

  // Letter keys
  const letterMatch = code.match(/^Key([A-Z])$/);
  if (letterMatch) return letterMatch[1];

  // Digit keys
  const digitMatch = code.match(/^Digit(\d)$/);
  if (digitMatch) return digitMatch[1];

  // Function keys
  const fnMatch = code.match(/^(F\d{1,2})$/);
  if (fnMatch) return fnMatch[1];

  // Numpad keys
  const numpadMatch = code.match(/^Numpad(\d)$/);
  if (numpadMatch) return `Num${numpadMatch[1]}`;

  console.warn(`[PTT] Cannot map key code "${code}" to Tauri shortcut`);
  return null;
}
```

**Step 4: Add mapCodeToTauriShortcut tests**

Append to test file:

```typescript
import { mapCodeToTauriShortcut } from "@/lib/pttManager";

describe("mapCodeToTauriShortcut", () => {
  it("maps Space", () => expect(mapCodeToTauriShortcut("Space")).toBe("Space"));
  it("maps letter keys", () => expect(mapCodeToTauriShortcut("KeyV")).toBe("V"));
  it("maps digit keys", () => expect(mapCodeToTauriShortcut("Digit5")).toBe("5"));
  it("maps function keys", () => expect(mapCodeToTauriShortcut("F5")).toBe("F5"));
  it("maps CapsLock", () => expect(mapCodeToTauriShortcut("CapsLock")).toBe("CapsLock"));
  it("maps Backquote", () => expect(mapCodeToTauriShortcut("Backquote")).toBe("`"));
  it("returns null for unmappable keys", () => expect(mapCodeToTauriShortcut("ContextMenu")).toBeNull());
});
```

**Step 5: Run all tests**

Run:
```bash
cd client && bun run test:run -- --reporter=verbose src/lib/__tests__/pttManager.test.ts
```
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add client/src/lib/pttManager.ts client/src/lib/__tests__/pttManager.test.ts
git commit -m "feat(client): add browser/Tauri event listeners and key mapping to pttManager"
```

---

### Task 6: Integrate pttManager with Voice Store

**Files:**
- Modify: `client/src/stores/voice.ts`
- Modify: `client/src/stores/settings.ts`

**Step 1: Add PTT controller to voice store**

In `client/src/stores/voice.ts`, add imports at the top:

```typescript
import { PttController, createTauriPttListeners, PttFullConfig } from "@/lib/pttManager";
import { appSettings } from "@/stores/settings";
```

Add module-level state after the store creation:

```typescript
// PTT/PTM controller instance
let pttController: PttController | null = null;
let pttCleanup: (() => void) | null = null;
```

**Step 2: Add PTT activation/deactivation functions**

Add to `client/src/stores/voice.ts`:

```typescript
function getPttConfig(): PttFullConfig | null {
  const settings = appSettings();
  if (!settings) return null;

  const { voice } = settings;
  if (!voice.push_to_talk && !voice.push_to_mute) return null;

  return {
    pttEnabled: voice.push_to_talk,
    pttKey: voice.push_to_talk_key,
    pttReleaseDelay: voice.push_to_talk_release_delay,
    ptmEnabled: voice.push_to_mute,
    ptmKey: voice.push_to_mute_key,
    ptmReleaseDelay: voice.push_to_mute_release_delay,
  };
}

async function activatePtt(): Promise<void> {
  await deactivatePtt();

  const config = getPttConfig();
  if (!config) return;

  pttController = new PttController(setMute);
  pttController.activate(config);
  pttCleanup = await createTauriPttListeners(pttController, config);
}

async function deactivatePtt(): Promise<void> {
  if (pttCleanup) {
    // cleanup may be async (Tauri unregister)
    const fn = pttCleanup;
    pttCleanup = null;
    await Promise.resolve(fn());
  }
  if (pttController) {
    pttController.deactivate();
    pttController = null;
  }
}

/** Re-sync PTT state when settings change mid-call. */
export async function updatePttFromSettings(): Promise<void> {
  if (voiceState.state !== "connected") return;
  await activatePtt(); // re-activates with new config (deactivates old first)
}

/** Whether PTT or PTM is currently controlling the mute state. */
export function isPttActive(): boolean {
  return pttController !== null && pttController.isPttOrPtmEnabled();
}
```

**Step 3: Wire PTT into joinVoice and leaveVoice**

In the `joinVoice` function, after the successful connection (after `setVoiceState({ state: "connected", ... })`), add:

```typescript
// Activate PTT/PTM if configured
await activatePtt();
```

In the `leaveVoice` function, before or after the adapter leave call, add:

```typescript
await deactivatePtt();
```

**Step 4: Wire settings changes to PTT update**

In `client/src/stores/settings.ts`, add at the end of `updateVoiceSetting`:

```typescript
// Re-sync PTT controller if voice is connected
const { updatePttFromSettings } = await import("@/stores/voice");
await updatePttFromSettings();
```

The dynamic import avoids circular dependency issues.

**Step 5: Verify compilation**

Run:
```bash
cd client && bun run build
```
Expected: Compiles without errors.

**Step 6: Commit**

```bash
git add client/src/stores/voice.ts client/src/stores/settings.ts
git commit -m "feat(client): integrate pttManager with voice store lifecycle"
```

---

### Task 7: Update VoiceSettings UI — PTT/PTM Toggles with Key Binding

**Files:**
- Modify: `client/src/components/settings/VoiceSettings.tsx`

**Step 1: Read the human-readable key label utility**

We need a helper to convert `event.code` (e.g. "KeyV") to a display label (e.g. "V"). Add this to the component file or to `pttManager.ts`:

```typescript
/** Convert event.code to human-readable label. */
export function keyCodeToLabel(code: string): string {
  const map: Record<string, string> = {
    Space: "Space",
    CapsLock: "Caps Lock",
    Backquote: "~",
    Tab: "Tab",
    Escape: "Esc",
    ShiftLeft: "Left Shift",
    ShiftRight: "Right Shift",
    ControlLeft: "Left Ctrl",
    ControlRight: "Right Ctrl",
    AltLeft: "Left Alt",
    AltRight: "Right Alt",
  };
  if (map[code]) return map[code];
  const letterMatch = code.match(/^Key([A-Z])$/);
  if (letterMatch) return letterMatch[1];
  const digitMatch = code.match(/^Digit(\d)$/);
  if (digitMatch) return digitMatch[1];
  const fnMatch = code.match(/^(F\d{1,2})$/);
  if (fnMatch) return fnMatch[1];
  const numpadMatch = code.match(/^Numpad(\d)$/);
  if (numpadMatch) return `Numpad ${numpadMatch[1]}`;
  return code;
}
```

Add this to `client/src/lib/pttManager.ts` and export it.

**Step 2: Rewrite VoiceSettings.tsx**

Replace the full content of `client/src/components/settings/VoiceSettings.tsx` with:

```tsx
import { Component, Show, createSignal, onCleanup } from "solid-js";
import { appSettings, updateVoiceSetting, isSettingsLoading } from "@/stores/settings";
import { keyCodeToLabel } from "@/lib/pttManager";

const VoiceSettings: Component = () => {
    return (
        <div class="space-y-6">
            <div>
                <h3 class="text-lg font-semibold text-text-primary mb-1">Voice Settings</h3>
                <p class="text-sm text-text-secondary">
                    Configure how your voice is captured and processed.
                </p>
            </div>

            <Show when={!isSettingsLoading() && appSettings()} fallback={<p class="text-text-secondary">Loading...</p>}>
                {(settings) => (
                    <>
                        {/* Audio Processing */}
                        <div class="space-y-4">
                            <ToggleCard
                                label="Noise Suppression"
                                description="Filters out background noise like keyboard typing and fans"
                                checked={settings().audio.noise_suppression}
                                onChange={(v) => {
                                    // updateAudioSetting imported inline to keep imports clean
                                    import("@/stores/settings").then(m => m.updateAudioSetting("noise_suppression", v));
                                }}
                            />
                            <ToggleCard
                                label="Echo Cancellation"
                                description="Prevents your microphone from picking up audio from your speakers"
                                checked={settings().audio.echo_cancellation}
                                onChange={(v) => {
                                    import("@/stores/settings").then(m => m.updateAudioSetting("echo_cancellation", v));
                                }}
                            />
                        </div>

                        {/* Input Mode */}
                        <div class="space-y-4 pt-4 border-t border-white/10">
                            {/* VAD */}
                            <div class="p-4 rounded-xl border border-white/10 bg-surface-layer2">
                                <ToggleRow
                                    label="Voice Activity Detection"
                                    description="Automatically activate your microphone when you speak"
                                    checked={settings().voice.voice_activity_detection}
                                    onChange={(v) => updateVoiceSetting("voice_activity_detection", v)}
                                />
                                <Show when={settings().voice.voice_activity_detection}>
                                    <div class="mt-4 pt-4 border-t border-white/10">
                                        <label class="text-sm font-medium text-text-primary flex items-center gap-2 mb-2">
                                            Sensitivity Threshold
                                        </label>
                                        <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={Math.round(settings().voice.vad_threshold * 100)}
                                            onInput={(e) => updateVoiceSetting("vad_threshold", parseInt(e.currentTarget.value, 10) / 100)}
                                            class="w-full h-2 rounded-full bg-surface-highlight appearance-none cursor-pointer accent-accent-primary"
                                        />
                                    </div>
                                </Show>
                            </div>

                            {/* PTT */}
                            <div class="p-4 rounded-xl border border-white/10 bg-surface-layer2">
                                <ToggleRow
                                    label="Push to Talk"
                                    description="Only transmit voice when a specific key is held"
                                    checked={settings().voice.push_to_talk}
                                    onChange={(v) => {
                                        if (v && !settings().voice.push_to_talk_key) {
                                            // Enable PTT but need key — will show capture UI
                                            updateVoiceSetting("push_to_talk", true);
                                        } else {
                                            updateVoiceSetting("push_to_talk", v);
                                        }
                                    }}
                                />
                                <Show when={settings().voice.push_to_talk || (!settings().voice.push_to_talk && settings().voice.push_to_talk_key)}>
                                    <div class="mt-4 pt-4 border-t border-white/10 space-y-3">
                                        <KeyBindInput
                                            label="PTT Key"
                                            currentKey={settings().voice.push_to_talk_key}
                                            otherKey={settings().voice.push_to_mute_key}
                                            onBind={(code) => updateVoiceSetting("push_to_talk_key", code)}
                                            onClear={() => {
                                                updateVoiceSetting("push_to_talk_key", null);
                                                updateVoiceSetting("push_to_talk", false);
                                            }}
                                            autoCapture={settings().voice.push_to_talk && !settings().voice.push_to_talk_key}
                                        />
                                        <DelaySlider
                                            label="Release Delay"
                                            value={settings().voice.push_to_talk_release_delay}
                                            onChange={(v) => updateVoiceSetting("push_to_talk_release_delay", v)}
                                        />
                                    </div>
                                </Show>
                            </div>

                            {/* PTM */}
                            <div class="p-4 rounded-xl border border-white/10 bg-surface-layer2">
                                <ToggleRow
                                    label="Push to Mute"
                                    description="Mute your microphone while a specific key is held"
                                    checked={settings().voice.push_to_mute}
                                    onChange={(v) => {
                                        if (v && !settings().voice.push_to_mute_key) {
                                            updateVoiceSetting("push_to_mute", true);
                                        } else {
                                            updateVoiceSetting("push_to_mute", v);
                                        }
                                    }}
                                />
                                <Show when={settings().voice.push_to_mute || (!settings().voice.push_to_mute && settings().voice.push_to_mute_key)}>
                                    <div class="mt-4 pt-4 border-t border-white/10 space-y-3">
                                        <KeyBindInput
                                            label="PTM Key"
                                            currentKey={settings().voice.push_to_mute_key}
                                            otherKey={settings().voice.push_to_talk_key}
                                            onBind={(code) => updateVoiceSetting("push_to_mute_key", code)}
                                            onClear={() => {
                                                updateVoiceSetting("push_to_mute_key", null);
                                                updateVoiceSetting("push_to_mute", false);
                                            }}
                                            autoCapture={settings().voice.push_to_mute && !settings().voice.push_to_mute_key}
                                        />
                                        <DelaySlider
                                            label="Release Delay"
                                            value={settings().voice.push_to_mute_release_delay}
                                            onChange={(v) => updateVoiceSetting("push_to_mute_release_delay", v)}
                                        />
                                    </div>
                                </Show>
                            </div>
                        </div>
                    </>
                )}
            </Show>
        </div>
    );
};

// ============================================================================
// Sub-components
// ============================================================================

const ToggleCard: Component<{
    label: string;
    description: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}> = (props) => (
    <div class="p-4 rounded-xl border border-white/10 bg-surface-layer2">
        <ToggleRow {...props} />
    </div>
);

const ToggleRow: Component<{
    label: string;
    description: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}> = (props) => (
    <label class="flex items-center gap-3 cursor-pointer">
        <input
            type="checkbox"
            checked={props.checked}
            onChange={(e) => props.onChange(e.currentTarget.checked)}
            class="w-5 h-5 rounded border-2 border-white/30 bg-transparent checked:bg-accent-primary checked:border-accent-primary transition-colors cursor-pointer accent-accent-primary"
        />
        <div>
            <span class="text-text-primary font-medium">{props.label}</span>
            <p class="text-xs text-text-secondary mt-0.5">{props.description}</p>
        </div>
    </label>
);

const KeyBindInput: Component<{
    label: string;
    currentKey: string | null;
    otherKey: string | null;
    onBind: (code: string) => void;
    onClear: () => void;
    autoCapture?: boolean;
}> = (props) => {
    const [capturing, setCapturing] = createSignal(props.autoCapture ?? false);
    const [error, setError] = createSignal<string | null>(null);

    const handleKeyDown = (e: KeyboardEvent) => {
        if (!capturing()) return;
        e.preventDefault();
        e.stopPropagation();

        // Ignore modifier-only presses
        if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;

        if (e.code === "Escape") {
            setCapturing(false);
            return;
        }

        // Check for conflict with other key
        if (props.otherKey && e.code === props.otherKey) {
            setError("PTT and PTM keys must be different");
            return;
        }

        setError(null);
        setCapturing(false);
        props.onBind(e.code);
    };

    // Auto-capture: listen immediately
    if (props.autoCapture) {
        window.addEventListener("keydown", handleKeyDown);
        onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
    }

    return (
        <div>
            <label class="text-sm font-medium text-text-primary mb-1 block">{props.label}</label>
            <div class="flex items-center gap-2">
                <Show
                    when={!capturing()}
                    fallback={
                        <div class="flex-1 px-3 py-2 rounded-lg border-2 border-accent-primary bg-accent-primary/10 text-accent-primary text-sm animate-pulse">
                            Press any key... (Esc to cancel)
                        </div>
                    }
                >
                    <Show
                        when={props.currentKey}
                        fallback={
                            <button
                                onClick={() => {
                                    setCapturing(true);
                                    // One-shot listener for this capture session
                                    const handler = (e: KeyboardEvent) => {
                                        handleKeyDown(e);
                                        if (!capturing()) {
                                            window.removeEventListener("keydown", handler);
                                        }
                                    };
                                    window.addEventListener("keydown", handler);
                                }}
                                class="flex-1 px-3 py-2 rounded-lg border border-dashed border-white/20 text-text-secondary text-sm hover:border-white/40 transition-colors"
                            >
                                Click to set key...
                            </button>
                        }
                    >
                        <button
                            onClick={() => {
                                setCapturing(true);
                                const handler = (e: KeyboardEvent) => {
                                    handleKeyDown(e);
                                    if (!capturing()) {
                                        window.removeEventListener("keydown", handler);
                                    }
                                };
                                window.addEventListener("keydown", handler);
                            }}
                            class="flex-1 px-3 py-2 rounded-lg border border-white/20 bg-surface-base text-text-primary text-sm hover:border-white/40 transition-colors"
                        >
                            <kbd class="px-2 py-0.5 bg-surface-highlight rounded border border-white/10 text-sm font-mono">
                                {keyCodeToLabel(props.currentKey!)}
                            </kbd>
                        </button>
                    </Show>
                </Show>
                <Show when={props.currentKey}>
                    <button
                        onClick={() => props.onClear()}
                        class="p-2 rounded-lg text-text-secondary hover:text-accent-danger hover:bg-accent-danger/10 transition-colors"
                        title="Clear key binding"
                    >
                        &times;
                    </button>
                </Show>
            </div>
            <Show when={error()}>
                <p class="text-xs text-accent-danger mt-1">{error()}</p>
            </Show>
        </div>
    );
};

const DelaySlider: Component<{
    label: string;
    value: number;
    onChange: (v: number) => void;
}> = (props) => (
    <div>
        <label class="text-sm font-medium text-text-primary flex items-center gap-2 mb-1">
            {props.label}
            <span class="text-xs text-text-secondary font-normal">{props.value}ms</span>
        </label>
        <input
            type="range"
            min="0"
            max="1000"
            step="50"
            value={props.value}
            onInput={(e) => props.onChange(parseInt(e.currentTarget.value, 10))}
            class="w-full h-2 rounded-full bg-surface-highlight appearance-none cursor-pointer accent-accent-primary"
        />
    </div>
);

export default VoiceSettings;
```

**Step 3: Verify it compiles**

Run:
```bash
cd client && bun run build
```
Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add client/src/components/settings/VoiceSettings.tsx client/src/lib/pttManager.ts
git commit -m "feat(client): PTT/PTM voice settings UI with key binding capture"
```

---

### Task 8: Update VoiceControls Mute Button for PTT/PTM

**Files:**
- Modify: `client/src/components/voice/VoiceControls.tsx:47-67`

**Step 1: Import isPttActive**

At the top of `client/src/components/voice/VoiceControls.tsx`, add:

```typescript
import { voiceState, toggleMute, toggleDeafen, isPttActive } from "@/stores/voice";
```

(Replace the existing import that has `voiceState, toggleMute, toggleDeafen`.)

**Step 2: Update the mute button**

Replace the mute button section (lines 50-67) with:

```tsx
        {/* Mute button */}
        <button
          data-testid="voice-mute"
          onClick={() => { if (!isPttActive()) toggleMute(); }}
          class={`p-2 rounded-full transition-colors ${
            voiceState.muted
              ? "bg-accent-danger/20 text-accent-danger hover:bg-accent-danger/30"
              : "bg-white/5 text-text-secondary hover:bg-white/10 hover:text-text-primary"
          } ${isPttActive() ? "opacity-50 cursor-not-allowed" : ""}`}
          title={
            isPttActive()
              ? "Controlled by Push-to-Talk / Push-to-Mute"
              : voiceState.muted
                ? "Unmute (Ctrl+Shift+M)"
                : "Mute (Ctrl+Shift+M)"
          }
          disabled={voiceState.state !== "connected" || isPttActive()}
        >
          {voiceState.muted ? (
            <MicOff class="w-5 h-5" />
          ) : (
            <Mic class="w-5 h-5" />
          )}
        </button>
```

**Step 3: Disable Ctrl+Shift+M when PTT active**

In the `handleKeyDown` function (lines 25-34), update the mute shortcut:

```typescript
  const handleKeyDown = (e: KeyboardEvent) => {
    if (voiceState.state !== "connected") return;
    if (e.ctrlKey && e.shiftKey && e.key === "M") {
      e.preventDefault();
      if (!isPttActive()) toggleMute();
    } else if (e.ctrlKey && e.shiftKey && e.key === "D") {
      e.preventDefault();
      toggleDeafen();
    }
  };
```

**Step 4: Verify compilation**

Run:
```bash
cd client && bun run build
```
Expected: Compiles without errors.

**Step 5: Commit**

```bash
git add client/src/components/voice/VoiceControls.tsx
git commit -m "feat(client): disable mute button when PTT/PTM active"
```

---

### Task 9: Update KeyboardShortcutsDialog with Dynamic PTT/PTM Entries

**Files:**
- Modify: `client/src/components/ui/KeyboardShortcutsDialog.tsx:27-54`

**Step 1: Import settings and key label helper**

Add at the top of `client/src/components/ui/KeyboardShortcutsDialog.tsx`:

```typescript
import { appSettings } from "@/stores/settings";
import { keyCodeToLabel } from "@/lib/pttManager";
```

**Step 2: Make shortcuts dynamic**

Replace the static `SHORTCUT_CATEGORIES` array (lines 27-54) with a function:

```typescript
function getShortcutCategories(): ShortcutCategory[] {
  const settings = appSettings();
  const voiceShortcuts: ShortcutEntry[] = [
    { keys: ["Ctrl", "Shift", "M"], description: "Toggle microphone mute" },
    { keys: ["Ctrl", "Shift", "D"], description: "Toggle deafen" },
  ];

  if (settings?.voice.push_to_talk && settings.voice.push_to_talk_key) {
    voiceShortcuts.push({
      keys: [keyCodeToLabel(settings.voice.push_to_talk_key)],
      description: "Push to Talk (hold)",
    });
  }

  if (settings?.voice.push_to_mute && settings.voice.push_to_mute_key) {
    voiceShortcuts.push({
      keys: [keyCodeToLabel(settings.voice.push_to_mute_key)],
      description: "Push to Mute (hold)",
    });
  }

  return [
    {
      title: "General",
      shortcuts: [
        { keys: ["Ctrl", "K"], description: "Open command palette" },
        { keys: ["Ctrl", "Shift", "F"], description: "Toggle global search" },
        { keys: ["Ctrl", "/"], description: "Toggle this dialog" },
      ],
    },
    {
      title: "Voice",
      shortcuts: voiceShortcuts,
    },
    {
      title: "Chat",
      shortcuts: [
        { keys: ["Ctrl", "F"], description: "Search in channel" },
        { keys: ["Enter"], description: "Send message" },
        { keys: ["Shift", "Enter"], description: "New line" },
        { keys: ["Ctrl", "B"], description: "Bold text" },
        { keys: ["Ctrl", "I"], description: "Italic text" },
        { keys: ["Ctrl", "E"], description: "Inline code" },
      ],
    },
  ];
}
```

**Step 3: Update the template to use the function**

Replace `<For each={SHORTCUT_CATEGORIES}>` (line 106) with:

```tsx
<For each={getShortcutCategories()}>
```

**Step 4: Verify compilation**

Run:
```bash
cd client && bun run build
```
Expected: Compiles without errors.

**Step 5: Commit**

```bash
git add client/src/components/ui/KeyboardShortcutsDialog.tsx
git commit -m "feat(client): show dynamic PTT/PTM entries in keyboard shortcuts dialog"
```

---

### Task 10: Update CHANGELOG and Run Full Test Suite

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add CHANGELOG entry**

Under `[Unreleased]` → `### Added`, add:

```markdown
- Push-to-Talk and Push-to-Mute hotkeys with configurable key bindings, release delay, and Tauri global shortcut support
```

**Step 2: Run all client tests**

Run:
```bash
cd client && bun run test:run
```
Expected: All tests pass, including the new pttManager tests.

**Step 3: Run clippy**

Run:
```bash
cd client && SQLX_OFFLINE=true cargo clippy -p vc-client -- -D warnings
```
Expected: No warnings.

**Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add PTT/PTM hotkey to CHANGELOG"
```
