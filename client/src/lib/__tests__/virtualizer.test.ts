import { describe, it, expect, vi } from "vitest";
import { createRoot } from "solid-js";
import { createVirtualizer } from "../virtualizer";

function makeScrollElement(height = 500, scrollTop = 0): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperties(el, {
    clientHeight: { value: height, configurable: true },
    offsetHeight: { value: height, configurable: true },
    offsetWidth: { value: 200, configurable: true },
    scrollTop: { value: scrollTop, writable: true, configurable: true },
    scrollTo: { value: vi.fn(), configurable: true },
  });
  return el;
}

/** Flush one microtask so Solid's onMount callbacks execute. */
function tick(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe("createVirtualizer", () => {
  it("returns empty items when count is 0", async () => {
    await createRoot(async (dispose) => {
      const v = createVirtualizer({
        count: 0,
        getScrollElement: () => makeScrollElement(),
        estimateSize: () => 50,
        overscan: 0,
      });
      await tick();
      expect(v.getVirtualItems()).toEqual([]);
      expect(v.getTotalSize()).toBe(0);
      dispose();
    });
  });

  it("returns all items when they fit in viewport", async () => {
    await createRoot(async (dispose) => {
      const el = makeScrollElement(500);
      const v = createVirtualizer({
        count: 5,
        getScrollElement: () => el,
        estimateSize: () => 50,
        overscan: 0,
      });
      await tick();
      const items = v.getVirtualItems();
      expect(items.length).toBe(5);
      expect(v.getTotalSize()).toBe(250);
      dispose();
    });
  });

  it("applies overscan correctly", async () => {
    await createRoot(async (dispose) => {
      const el = makeScrollElement(100, 200);
      const v = createVirtualizer({
        count: 100,
        getScrollElement: () => el,
        estimateSize: () => 50,
        overscan: 2,
      });
      await tick();
      const items = v.getVirtualItems();
      expect(items[0].index).toBeLessThanOrEqual(2);
      dispose();
    });
  });

  it("scrollToIndex calls scrollTo on the element", async () => {
    await createRoot(async (dispose) => {
      const el = makeScrollElement(200);
      const v = createVirtualizer({
        count: 50,
        getScrollElement: () => el,
        estimateSize: () => 50,
        overscan: 0,
      });
      await tick();
      v.scrollToIndex(10, { align: "start" });
      expect(el.scrollTo).toHaveBeenCalled();
      dispose();
    });
  });

  it("measureElement accepts an element without throwing", async () => {
    await createRoot(async (dispose) => {
      const el = makeScrollElement();
      const v = createVirtualizer({
        count: 10,
        getScrollElement: () => el,
        estimateSize: () => 50,
        overscan: 0,
      });
      await tick();
      const item = document.createElement("div");
      item.setAttribute("data-index", "0");
      expect(() => v.measureElement(item)).not.toThrow();
      dispose();
    });
  });

  it("getTotalSize reflects all items", async () => {
    await createRoot(async (dispose) => {
      const v = createVirtualizer({
        count: 20,
        getScrollElement: () => makeScrollElement(),
        estimateSize: (i) => (i < 10 ? 50 : 100),
        overscan: 0,
      });
      await tick();
      expect(v.getTotalSize()).toBe(10 * 50 + 10 * 100);
      dispose();
    });
  });
});
