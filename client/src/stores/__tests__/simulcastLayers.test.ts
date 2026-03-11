import { describe, it, expect, beforeEach } from "vitest";
import {
  layerState,
  handleLayerChanged,
  getActiveLayer,
  getLayerPreference,
  setLayerPreference,
  resetLayerState,
} from "../simulcastLayers";

describe("simulcastLayers store", () => {
  beforeEach(() => {
    resetLayerState();
  });

  describe("getActiveLayer", () => {
    it("defaults to high for unknown keys", () => {
      expect(getActiveLayer("user-1", "screen_video:abc")).toBe("high");
    });

    it("returns the layer set by handleLayerChanged", () => {
      handleLayerChanged("user-1", "screen_video:abc", "medium");
      expect(getActiveLayer("user-1", "screen_video:abc")).toBe("medium");
    });
  });

  describe("handleLayerChanged", () => {
    it("tracks active layers per user:trackSource key", () => {
      handleLayerChanged("user-1", "screen_video:abc", "low");
      handleLayerChanged("user-2", "screen_video:def", "high");

      expect(getActiveLayer("user-1", "screen_video:abc")).toBe("low");
      expect(getActiveLayer("user-2", "screen_video:def")).toBe("high");
    });

    it("overwrites previous layer value", () => {
      handleLayerChanged("user-1", "screen_video:abc", "high");
      handleLayerChanged("user-1", "screen_video:abc", "low");

      expect(getActiveLayer("user-1", "screen_video:abc")).toBe("low");
    });

    it("updates the store's activeLayers record", () => {
      handleLayerChanged("user-1", "screen_video:abc", "medium");
      expect(layerState.activeLayers["user-1:screen_video:abc"]).toBe(
        "medium",
      );
    });
  });

  describe("getLayerPreference", () => {
    it("defaults to auto for unknown keys", () => {
      expect(getLayerPreference("user-1", "screen_video:abc")).toBe("auto");
    });

    it("returns the preference set by setLayerPreference", () => {
      setLayerPreference("user-1", "screen_video:abc", "low");
      expect(getLayerPreference("user-1", "screen_video:abc")).toBe("low");
    });
  });

  describe("setLayerPreference", () => {
    it("stores preferences per user:trackSource key", () => {
      setLayerPreference("user-1", "screen_video:abc", "high");
      setLayerPreference("user-2", "screen_video:def", "medium");

      expect(getLayerPreference("user-1", "screen_video:abc")).toBe("high");
      expect(getLayerPreference("user-2", "screen_video:def")).toBe("medium");
    });

    it("allows setting auto preference", () => {
      setLayerPreference("user-1", "screen_video:abc", "high");
      setLayerPreference("user-1", "screen_video:abc", "auto");

      expect(getLayerPreference("user-1", "screen_video:abc")).toBe("auto");
    });

    it("updates the store's preferences record", () => {
      setLayerPreference("user-1", "screen_video:abc", "low");
      expect(layerState.preferences["user-1:screen_video:abc"]).toBe("low");
    });
  });

  describe("resetLayerState", () => {
    it("clears all active layers and preferences", () => {
      handleLayerChanged("user-1", "screen_video:abc", "low");
      setLayerPreference("user-1", "screen_video:abc", "medium");

      resetLayerState();

      expect(getActiveLayer("user-1", "screen_video:abc")).toBe("high");
      expect(getLayerPreference("user-1", "screen_video:abc")).toBe("auto");
    });
  });
});
