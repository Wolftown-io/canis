import { describe, it, expect, vi } from "vitest";
import { createVirtualizer } from "../virtualizer";

function makeScrollElement(height = 500, scrollTop = 0): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperties(el, {
    clientHeight: { value: height, configurable: true },
    scrollTop: { value: scrollTop, writable: true, configurable: true },
    scrollTo: { value: vi.fn(), configurable: true },
  });
  return el;
}

describe("createVirtualizer", () => {
  it("returns empty items when count is 0", () => {
    const v = createVirtualizer({
      count: 0,
      getScrollElement: () => makeScrollElement(),
      estimateSize: () => 50,
      overscan: 0,
    });
    expect(v.getVirtualItems()).toEqual([]);
    expect(v.getTotalSize()).toBe(0);
  });

  it("returns all items when they fit in viewport", () => {
    const el = makeScrollElement(500);
    const v = createVirtualizer({
      count: 5,
      getScrollElement: () => el,
      estimateSize: () => 50,
      overscan: 0,
    });
    const items = v.getVirtualItems();
    expect(items.length).toBe(5);
    expect(v.getTotalSize()).toBe(250);
  });

  it("applies overscan correctly", () => {
    const el = makeScrollElement(100, 200);
    const v = createVirtualizer({
      count: 100,
      getScrollElement: () => el,
      estimateSize: () => 50,
      overscan: 2,
    });
    const items = v.getVirtualItems();
    // Viewport at 200-300 covers items 4-5, overscan adds 2 each side
    expect(items[0].index).toBeLessThanOrEqual(2);
  });

  it("scrollToIndex calls scrollTo on the element", () => {
    const el = makeScrollElement(200);
    const v = createVirtualizer({
      count: 50,
      getScrollElement: () => el,
      estimateSize: () => 50,
      overscan: 0,
    });
    v.scrollToIndex(10, { align: "start" });
    expect(el.scrollTo).toHaveBeenCalled();
  });

  it("measureElement accepts an element without throwing", () => {
    const el = makeScrollElement();
    const v = createVirtualizer({
      count: 10,
      getScrollElement: () => el,
      estimateSize: () => 50,
      overscan: 0,
    });
    const item = document.createElement("div");
    item.setAttribute("data-index", "0");
    expect(() => v.measureElement(item)).not.toThrow();
  });

  it("getTotalSize reflects all items", () => {
    const v = createVirtualizer({
      count: 20,
      getScrollElement: () => makeScrollElement(),
      estimateSize: (i) => (i < 10 ? 50 : 100),
      overscan: 0,
    });
    expect(v.getTotalSize()).toBe(10 * 50 + 10 * 100);
  });
});
