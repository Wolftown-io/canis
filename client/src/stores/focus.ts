/**
 * Focus Store
 *
 * Manages focus mode state and notification policy evaluation.
 * All logic is client-side — focus configuration lives in UserPreferences JSONB,
 * runtime state (active mode) is device-local.
 */

import { createSignal } from "solid-js";
import type { FocusMode, FocusState, FocusTriggerCategory } from "@/lib/types";
import type { SoundEvent } from "@/lib/sound/types";
import { isDndActive } from "@/stores/sound";
import { preferences } from "./preferences";

// ============================================================================
// Runtime State (device-local, not persisted)
// ============================================================================

const [focusState, setFocusState] = createSignal<FocusState>({
  active_mode_id: null,
  auto_activated: false,
  activated_at: null,
  triggering_category: null,
});

// ============================================================================
// VIP Lookup Helpers
// ============================================================================

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Build a Set from a mode's VIP list for O(1) lookups.
 * Called on every evaluateFocusPolicy to stay in sync with live preferences.
 * Lists are capped at 50 entries so construction cost is negligible.
 */
function buildVipSet(ids: readonly string[]): ReadonlySet<string> {
  return ids.length > 0
    ? new Set(ids.map((id) => id.toLowerCase()))
    : EMPTY_SET;
}

// Module-level cache using reference equality (O(1) per check)
let cachedModeId: string | null = null;
let cachedVipUserIds: readonly string[] | null = null;
let cachedVipChannelIds: readonly string[] | null = null;
let cachedUserSet: ReadonlySet<string> = EMPTY_SET;
let cachedChannelSet: ReadonlySet<string> = EMPTY_SET;

function getCachedVipSets(mode: FocusMode): {
  userSet: ReadonlySet<string>;
  channelSet: ReadonlySet<string>;
} {
  if (cachedModeId !== mode.id) {
    cachedModeId = mode.id;
    cachedVipUserIds = null;
    cachedVipChannelIds = null;
    cachedUserSet = EMPTY_SET;
    cachedChannelSet = EMPTY_SET;
  }

  if (cachedVipUserIds !== mode.vip_user_ids) {
    cachedVipUserIds = mode.vip_user_ids;
    cachedUserSet = buildVipSet(mode.vip_user_ids);
  }

  if (cachedVipChannelIds !== mode.vip_channel_ids) {
    cachedVipChannelIds = mode.vip_channel_ids;
    cachedChannelSet = buildVipSet(mode.vip_channel_ids);
  }

  return { userSet: cachedUserSet, channelSet: cachedChannelSet };
}

// ============================================================================
// Mode Accessors
// ============================================================================

/**
 * Get the currently active focus mode, or null if none.
 */
export function getActiveFocusMode(): FocusMode | null {
  const state = focusState();
  if (!state.active_mode_id) return null;

  const modes = preferences().focus?.modes;
  if (!modes) return null;

  return modes.find((m) => m.id === state.active_mode_id) ?? null;
}

// ============================================================================
// Activation / Deactivation
// ============================================================================

/**
 * Manually activate a focus mode by ID.
 */
export function activateFocusMode(modeId: string): void {
  const modes = preferences().focus?.modes;
  if (!modes) return;

  const mode = modes.find((m) => m.id === modeId);
  if (!mode) return;

  setFocusState({
    active_mode_id: modeId,
    auto_activated: false,
    activated_at: new Date().toISOString(),
    triggering_category: null,
  });
}

/**
 * Deactivate the current focus mode.
 */
export function deactivateFocusMode(): void {
  setFocusState({
    active_mode_id: null,
    auto_activated: false,
    activated_at: null,
    triggering_category: null,
  });
}

/**
 * Handle activity category changes from the process scanner.
 * Auto-activates/deactivates focus modes when the global toggle and
 * per-mode toggle are both enabled.
 */
export function handleActivityChange(
  category: FocusTriggerCategory | null,
): void {
  const state = focusState();
  const focusPrefs = preferences().focus;
  if (!focusPrefs) return;

  // If activity cleared and current mode was auto-activated, deactivate
  // (must run even when auto_activate_global is off — user may have toggled it
  // off while an auto-activated mode was running)
  if (category === null) {
    if (state.auto_activated) {
      deactivateFocusMode();
    }
    return;
  }

  // Master switch must be on for new activations
  if (!focusPrefs.auto_activate_global) return;

  // Don't override a manually activated mode
  if (state.active_mode_id && !state.auto_activated) return;

  // Find a mode that matches this category and has auto-activate enabled
  const matchingMode = focusPrefs.modes.find(
    (m) =>
      m.auto_activate_enabled &&
      m.trigger_categories !== null &&
      m.trigger_categories.includes(category),
  );

  if (matchingMode) {
    // Already active for this mode? Skip
    if (state.active_mode_id === matchingMode.id) return;

    setFocusState({
      active_mode_id: matchingMode.id,
      auto_activated: true,
      activated_at: new Date().toISOString(),
      triggering_category: category,
    });
  } else if (state.auto_activated) {
    // Category changed but no mode matches — deactivate if was auto-activated
    deactivateFocusMode();
  }
}

// ============================================================================
// Notification Policy Evaluation
// ============================================================================

/**
 * Evaluate whether a notification event should be suppressed or allowed
 * based on the current focus state.
 *
 * Priority:
 * 1. DND/quiet hours active → suppress (absolute, no overrides)
 * 2. No focus mode → allow
 * 3. VIP user → allow
 * 4. VIP channel → allow
 * 5. Emergency keyword match → allow
 * 6. Apply suppression level
 */
export function evaluateFocusPolicy(event: SoundEvent): "suppress" | "allow" {
  // 1. DND is absolute — no overrides
  if (isDndActive()) {
    return "suppress";
  }

  // 2. No active focus mode → allow (fall through to existing checks)
  const mode = getActiveFocusMode();
  if (!mode) {
    return "allow";
  }

  const vipSets = getCachedVipSets(mode);

  // 3. VIP user check (O(1) Set lookup)
  if (event.authorId && vipSets.userSet.has(event.authorId.toLowerCase())) {
    return "allow";
  }

  // 4. VIP channel check (O(1) Set lookup)
  if (vipSets.channelSet.has(event.channelId.toLowerCase())) {
    return "allow";
  }

  // 5. Emergency keyword check (linear scan, max 5 keywords)
  if (event.content && mode.emergency_keywords.length > 0) {
    const lowerContent = event.content.toLowerCase();
    for (const keyword of mode.emergency_keywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        return "allow";
      }
    }
  }

  // 6. Apply suppression level
  switch (mode.suppression_level) {
    case "all":
      return "suppress";

    case "except_mentions":
      return event.mentionType ? "allow" : "suppress";

    case "except_dms":
      return event.isDm ? "allow" : "suppress";

    default:
      return "suppress";
  }
}

// ============================================================================
// Exports
// ============================================================================

export { focusState };
