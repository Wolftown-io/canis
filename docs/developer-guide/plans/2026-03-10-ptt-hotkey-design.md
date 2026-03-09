# Push-to-Talk / Push-to-Mute Hotkey Design

**Goal:** Add configurable push-to-talk (PTT) and push-to-mute (PTM) hotkeys that work system-wide in Tauri and window-scoped in browser.

**Architecture:** PTT and PTM are input activation modes that control mic mute state via held hotkeys. A new `pttManager` module owns hotkey registration, state resolution, and mic toggling. Tauri uses `@tauri-apps/plugin-global-shortcut` for OS-level hotkeys; browser falls back to `window` keydown/keyup listeners.

**Tech Stack:** Tauri global shortcut plugin (Rust + JS), Solid.js signals, existing voice adapter `setMute()`.

---

## Input Modes

Three input modes control mic activation. They are not mutually exclusive — PTT and PTM can coexist.

| Mode | Resting State | Activation | Notes |
|------|---------------|------------|-------|
| **VAD** | Mic open | VAD detects speech | Default mode |
| **PTT** | Mic muted | Hold key to unmute | Overrides mute button |
| **PTM** | Mic open | Hold key to mute | Override/panic mute |

When PTT is enabled, the mute button is disabled. PTT defines the resting state (muted). PTM acts as an override on top.

## State Resolution

When both PTT and PTM are active:

```
No keys held     → muted (PTT resting state)
PTT held         → unmuted
PTM held         → muted
Both held        → muted (mute wins — safety first)
```

When only PTM is active (no PTT):

```
No keys held     → unmuted (VAD handles speech detection)
PTM held         → muted
```

## Data Model

Extends existing `VoiceSettings` in `settings.rs` and `types.ts`:

```rust
pub struct VoiceSettings {
    pub push_to_talk: bool,
    pub push_to_talk_key: Option<String>,       // event.code, e.g. "KeyV"
    pub push_to_talk_release_delay: u32,        // ms, default 200, clamped 0-1000
    pub push_to_mute: bool,
    pub push_to_mute_key: Option<String>,
    pub push_to_mute_release_delay: u32,        // ms, default 200, clamped 0-1000
    pub voice_activity_detection: bool,
    pub vad_threshold: f32,
}
```

### Validation Rules

- PTT enabled without key → prompt for key (do not silently fall back to VAD)
- PTM enabled without key → prompt for key
- PTT key and PTM key must differ
- Release delay clamped to 0–1000 ms
- VAD is independent of PTT/PTM — it drives speaking indicators when mic is unmuted

## Hotkey Registration

### pttManager Module

New module at `client/src/lib/pttManager.ts` managing all hotkey lifecycle:

```
pttManager.activate(config)    → register hotkeys, set initial mute state
pttManager.deactivate()        → unregister hotkeys, cancel timers, restore state
pttManager.updateKeys(config)  → unregister old, register new
```

### Tauri (Global)

```typescript
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

await register(pttKey, (event) => {
  if (event.state === 'Pressed') onPttPress();
  if (event.state === 'Released') onPttRelease();
});
```

Works system-wide — active while gaming, coding, etc.

### Browser (Window-only)

```typescript
window.addEventListener('keydown', handler);
window.addEventListener('keyup', handler);
```

Matches `event.code` against configured key. Only works when tab is focused.

### Release Delay

```
onPttRelease():
  clearTimeout(releaseTimer)
  releaseTimer = setTimeout(() → setMute(true), releaseDelay)

onPttPress():
  clearTimeout(releaseTimer)   // cancel pending re-mute
  setMute(false)
```

Same pattern for PTM with inverted polarity.

## Lifecycle

- **Activate** on voice channel join when PTT/PTM is enabled
- **Deactivate** on voice disconnect or when disabling PTT/PTM in settings
- **Update** on key or delay change mid-call (unregister old → register new)

## UI Changes

### VoiceSettings.tsx

- PTT toggle: on enable without key → inline key capture prompt ("Press any key...")
- PTM toggle: same behavior
- Captures `event.code`, displays human-readable label ("V", "CapsLock", "~")
- Click bound key to re-bind, "×" to clear
- Release delay slider (0–1000 ms) below each toggle
- Error if PTT and PTM keys match

### VoicePanel.tsx (Voice Island)

- Mute button stays visible but disabled when PTT/PTM active
- Tooltip: "Controlled by Push-to-Talk" or "Controlled by Push-to-Mute"
- Existing speaking indicator (green pulse via VAD) works as-is

### KeyboardShortcutsDialog.tsx

- Dynamic entries if PTT/PTM configured:
  - `[key]` — "Push to Talk (hold)"
  - `[key]` — "Push to Mute (hold)"

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Global shortcut registration fails | Toast warning, fall back to window-only listener |
| Voice disconnect while key held | `deactivate()` clears state, cancels timers |
| Settings change mid-call | Unregister old key, register new, no interruption |
| Disable PTT/PTM mid-call | Restore to VAD mode, unmute |
| OS key repeat (held key) | Track `pttHeld`/`ptmHeld` booleans, ignore duplicate press |
| Browser tab blur while key held | `blur` event → treat as release for both PTT and PTM |

## Dependencies

- `@tauri-apps/plugin-global-shortcut` (JS, client dependency)
- `tauri-plugin-global-shortcut` (Rust, src-tauri/Cargo.toml)
- Plugin registered in `src-tauri/src/lib.rs` builder chain

## Testing

**Unit tests (vitest):**
- State resolution: PTT only, PTM only, both active, mute-wins priority
- Release delay: timer fires, press cancels pending release
- Key repeat filtering
- Browser blur treated as release
- Settings validation: matching keys rejected, delay clamping

**Integration tests (voice test infrastructure):**
- PTT enable → mic muted
- PTT press/release → setMute called correctly
- PTM press during PTT hold → mute wins
- Disconnect while key held → clean teardown
- Settings change mid-call → re-registered

No server-side changes needed. PTT/PTM is purely client-side; the server already handles mute/unmute via existing WebSocket events.
