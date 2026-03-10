import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSetMute = vi.fn().mockResolvedValue(undefined);

import { resolveState, PttConfig, PttController, PttFullConfig, mapCodeToTauriShortcut, keyCodeToLabel } from "@/lib/pttManager";

describe("resolveState", () => {
  it("returns muted when PTT enabled and no keys held", () => {
    expect(resolveState({ pttEnabled: true, ptmEnabled: false }, false, false)).toBe(true);
  });

  it("returns unmuted when PTT key held", () => {
    expect(resolveState({ pttEnabled: true, ptmEnabled: false }, true, false)).toBe(false);
  });

  it("returns unmuted when only PTM enabled and no keys held", () => {
    expect(resolveState({ pttEnabled: false, ptmEnabled: true }, false, false)).toBe(false);
  });

  it("returns muted when PTM key held", () => {
    expect(resolveState({ pttEnabled: false, ptmEnabled: true }, false, true)).toBe(true);
  });

  it("returns muted when both PTT and PTM enabled, no keys held", () => {
    expect(resolveState({ pttEnabled: true, ptmEnabled: true }, false, false)).toBe(true);
  });

  it("returns unmuted when both enabled and PTT held", () => {
    expect(resolveState({ pttEnabled: true, ptmEnabled: true }, true, false)).toBe(false);
  });

  it("returns muted when both enabled and PTM held (mute wins)", () => {
    expect(resolveState({ pttEnabled: true, ptmEnabled: true }, false, true)).toBe(true);
  });

  it("returns muted when both keys held (mute wins)", () => {
    expect(resolveState({ pttEnabled: true, ptmEnabled: true }, true, true)).toBe(true);
  });

  it("returns unmuted when neither PTT nor PTM enabled", () => {
    expect(resolveState({ pttEnabled: false, ptmEnabled: false }, false, false)).toBe(false);
  });
});

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
      pttEnabled: true, pttKey: "Space", pttReleaseDelay: 200,
      ptmEnabled: false, ptmKey: null, ptmReleaseDelay: 200,
    });
    expect(mockSetMute).toHaveBeenCalledWith(true);
  });

  it("unmutes on PTT key press", () => {
    controller.activate({
      pttEnabled: true, pttKey: "Space", pttReleaseDelay: 200,
      ptmEnabled: false, ptmKey: null, ptmReleaseDelay: 200,
    });
    mockSetMute.mockClear();
    controller.handleKeyDown("Space");
    expect(mockSetMute).toHaveBeenCalledWith(false);
  });

  it("re-mutes after release delay on PTT key release", () => {
    controller.activate({
      pttEnabled: true, pttKey: "Space", pttReleaseDelay: 200,
      ptmEnabled: false, ptmKey: null, ptmReleaseDelay: 200,
    });
    controller.handleKeyDown("Space");
    mockSetMute.mockClear();
    controller.handleKeyUp("Space");
    expect(mockSetMute).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(mockSetMute).toHaveBeenCalledWith(true);
  });

  it("ignores duplicate keyUp (e.g. browser + Tauri both fire)", () => {
    controller.activate({
      pttEnabled: true, pttKey: "Space", pttReleaseDelay: 200,
      ptmEnabled: false, ptmKey: null, ptmReleaseDelay: 200,
    });
    controller.handleKeyDown("Space");
    mockSetMute.mockClear();
    controller.handleKeyUp("Space");
    // Second keyUp should be ignored — timer should NOT restart
    vi.advanceTimersByTime(100);
    controller.handleKeyUp("Space");
    // Original timer fires at 200ms from first keyUp, not reset
    vi.advanceTimersByTime(100);
    expect(mockSetMute).toHaveBeenCalledTimes(1);
    expect(mockSetMute).toHaveBeenCalledWith(true);
  });

  it("cancels release timer if key pressed again", () => {
    controller.activate({
      pttEnabled: true, pttKey: "Space", pttReleaseDelay: 200,
      ptmEnabled: false, ptmKey: null, ptmReleaseDelay: 200,
    });
    controller.handleKeyDown("Space");
    controller.handleKeyUp("Space");
    mockSetMute.mockClear();
    vi.advanceTimersByTime(100);
    controller.handleKeyDown("Space");
    expect(mockSetMute).toHaveBeenCalledWith(false);
    vi.advanceTimersByTime(200);
    expect(mockSetMute).toHaveBeenCalledTimes(1);
  });

  it("ignores key repeat (duplicate keydown)", () => {
    controller.activate({
      pttEnabled: true, pttKey: "Space", pttReleaseDelay: 200,
      ptmEnabled: false, ptmKey: null, ptmReleaseDelay: 200,
    });
    controller.handleKeyDown("Space");
    mockSetMute.mockClear();
    controller.handleKeyDown("Space");
    controller.handleKeyDown("Space");
    expect(mockSetMute).not.toHaveBeenCalled();
  });

  it("PTM mutes on key press", () => {
    controller.activate({
      pttEnabled: false, pttKey: null, pttReleaseDelay: 200,
      ptmEnabled: true, ptmKey: "KeyM", ptmReleaseDelay: 200,
    });
    mockSetMute.mockClear();
    controller.handleKeyDown("KeyM");
    expect(mockSetMute).toHaveBeenCalledWith(true);
  });

  it("PTM unmutes after release delay", () => {
    controller.activate({
      pttEnabled: false, pttKey: null, pttReleaseDelay: 200,
      ptmEnabled: true, ptmKey: "KeyM", ptmReleaseDelay: 300,
    });
    controller.handleKeyDown("KeyM");
    mockSetMute.mockClear();
    controller.handleKeyUp("KeyM");
    expect(mockSetMute).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(mockSetMute).toHaveBeenCalledWith(false);
  });

  it("mute wins when both PTT and PTM held", () => {
    controller.activate({
      pttEnabled: true, pttKey: "Space", pttReleaseDelay: 200,
      ptmEnabled: true, ptmKey: "KeyM", ptmReleaseDelay: 200,
    });
    controller.handleKeyDown("Space");
    mockSetMute.mockClear();
    controller.handleKeyDown("KeyM");
    expect(mockSetMute).toHaveBeenCalledWith(true);
  });

  it("deactivate clears state and cancels timers", () => {
    controller.activate({
      pttEnabled: true, pttKey: "Space", pttReleaseDelay: 200,
      ptmEnabled: false, ptmKey: null, ptmReleaseDelay: 200,
    });
    controller.handleKeyDown("Space");
    controller.handleKeyUp("Space");
    mockSetMute.mockClear();
    controller.deactivate();
    vi.advanceTimersByTime(500);
    expect(mockSetMute).not.toHaveBeenCalled();
  });

  it("ignores unrelated keys", () => {
    controller.activate({
      pttEnabled: true, pttKey: "Space", pttReleaseDelay: 200,
      ptmEnabled: false, ptmKey: null, ptmReleaseDelay: 200,
    });
    mockSetMute.mockClear();
    controller.handleKeyDown("KeyA");
    controller.handleKeyUp("KeyA");
    expect(mockSetMute).not.toHaveBeenCalled();
  });

  it("releases all keys on releaseAll", () => {
    controller.activate({
      pttEnabled: true, pttKey: "Space", pttReleaseDelay: 200,
      ptmEnabled: false, ptmKey: null, ptmReleaseDelay: 200,
    });
    controller.handleKeyDown("Space");
    mockSetMute.mockClear();
    controller.releaseAll();
    expect(mockSetMute).toHaveBeenCalledWith(true);
  });
});

describe("mapCodeToTauriShortcut", () => {
  it("maps Space", () => expect(mapCodeToTauriShortcut("Space")).toBe("Space"));
  it("maps letter keys", () => expect(mapCodeToTauriShortcut("KeyV")).toBe("V"));
  it("maps digit keys", () => expect(mapCodeToTauriShortcut("Digit5")).toBe("5"));
  it("maps function keys", () => expect(mapCodeToTauriShortcut("F5")).toBe("F5"));
  it("maps CapsLock", () => expect(mapCodeToTauriShortcut("CapsLock")).toBe("CapsLock"));
  it("maps Backquote", () => expect(mapCodeToTauriShortcut("Backquote")).toBe("`"));
  it("returns null for unmappable keys", () => expect(mapCodeToTauriShortcut("ContextMenu")).toBeNull());
});

describe("keyCodeToLabel", () => {
  it("maps Space", () => expect(keyCodeToLabel("Space")).toBe("Space"));
  it("maps letter keys", () => expect(keyCodeToLabel("KeyV")).toBe("V"));
  it("maps CapsLock", () => expect(keyCodeToLabel("CapsLock")).toBe("Caps Lock"));
  it("maps Backquote to ~", () => expect(keyCodeToLabel("Backquote")).toBe("~"));
  it("maps digit keys", () => expect(keyCodeToLabel("Digit3")).toBe("3"));
  it("maps function keys", () => expect(keyCodeToLabel("F12")).toBe("F12"));
  it("maps numpad keys", () => expect(keyCodeToLabel("Numpad5")).toBe("Numpad 5"));
  it("returns raw code for unknown keys", () => expect(keyCodeToLabel("ContextMenu")).toBe("ContextMenu"));
});
