/**
 * Simulcast Layer Store
 *
 * Tracks the active simulcast layer for each subscribed video track and
 * stores viewer layer preferences. Keys use the format
 * "userId:trackSource" (e.g. "abc-123:screen_video:def-456").
 */

import { createStore } from "solid-js/store";

export type Layer = "high" | "medium" | "low";
export type LayerPreference = "auto" | "high" | "medium" | "low";

interface LayerState {
  /** Map: "userId:trackSource" -> active layer */
  activeLayers: Record<string, Layer>;
  /** Map: "userId:trackSource" -> viewer preference */
  preferences: Record<string, LayerPreference>;
}

const [layerState, setLayerState] = createStore<LayerState>({
  activeLayers: {},
  preferences: {},
});

/**
 * Handle a layer change notification from the server.
 * Called when the SFU switches the active simulcast layer for a track.
 */
export function handleLayerChanged(
  sourceUserId: string,
  trackSource: string,
  activeLayer: Layer,
): void {
  const key = `${sourceUserId}:${trackSource}`;
  setLayerState("activeLayers", key, activeLayer);
}

/**
 * Get the currently active layer for a track.
 * Returns "high" as a default if no layer info has been received yet.
 */
export function getActiveLayer(
  sourceUserId: string,
  trackSource: string,
): Layer {
  const key = `${sourceUserId}:${trackSource}`;
  return layerState.activeLayers[key] ?? "high";
}

/**
 * Get the viewer's layer preference for a track.
 * Returns "auto" as a default (server-driven quality selection).
 */
export function getLayerPreference(
  sourceUserId: string,
  trackSource: string,
): LayerPreference {
  const key = `${sourceUserId}:${trackSource}`;
  return layerState.preferences[key] ?? "auto";
}

/**
 * Set the viewer's layer preference for a track.
 * This is the local state; the caller should also send a WS message.
 */
export function setLayerPreference(
  sourceUserId: string,
  trackSource: string,
  pref: LayerPreference,
): void {
  const key = `${sourceUserId}:${trackSource}`;
  setLayerState("preferences", key, pref);
}

/**
 * Reset the layer state (e.g. on disconnect).
 */
export function resetLayerState(): void {
  setLayerState({ activeLayers: {}, preferences: {} });
}

export { layerState };
