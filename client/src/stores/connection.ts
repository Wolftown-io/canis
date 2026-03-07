/**
 * Connection Settings Store
 *
 * Manages user preferences for connection status display through the unified preferences store.
 * Connection settings are synced across devices through the preferences system.
 */

import { preferences, updateNestedPreference } from "./preferences";

// ============================================================================
// Types
// ============================================================================

export interface ConnectionSettings {
  display_mode: "circle" | "number";
  show_notifications: boolean;
}

// ============================================================================
// Derived Signals
// ============================================================================

/**
 * Get connection settings from preferences.
 */
export const connectionSettings = (): ConnectionSettings => {
  const connection = preferences().connection;
  return {
    display_mode: connection.display_mode,
    show_notifications: connection.show_notifications,
  };
};

// ============================================================================
// Connection Settings Functions
// ============================================================================

export function getConnectionDisplayMode(): "circle" | "number" {
  return preferences().connection.display_mode;
}

export function setConnectionDisplayMode(mode: "circle" | "number"): void {
  updateNestedPreference("connection", "display_mode", mode);
}

export function getShowNotifications(): boolean {
  return preferences().connection.show_notifications;
}

export function setShowNotifications(show: boolean): void {
  updateNestedPreference("connection", "show_notifications", show);
}
