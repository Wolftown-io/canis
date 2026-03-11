import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  listChannelPins: vi.fn(),
  pinMessage: vi.fn(),
  unpinMessage: vi.fn(),
}));

import * as tauri from "@/lib/tauri";
import type { ChannelPin, Message } from "@/lib/types";
import {
  channelPins,
  isPinsLoading,
  pinsChannelId,
  loadChannelPins,
  pinMessageAction,
  unpinMessageAction,
  handlePinAdded,
  handlePinRemoved,
  pinCount,
  isMessagePinned,
  clearChannelPins,
} from "../channelPins";

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    channel_id: "ch-1",
    author: {
      id: "user-1",
      username: "alice",
      display_name: "Alice",
      avatar_url: null,
      status: "online",
    },
    content: "hello",
    encrypted: false,
    attachments: [],
    reply_to: null,
    parent_id: null,
    thread_reply_count: 0,
    thread_last_reply_at: null,
    edited_at: null,
    created_at: "2025-01-01T12:00:00Z",
    mention_type: null,
    pinned: true,
    message_type: "user",
    reactions: [],
    ...overrides,
  };
}

function createPin(overrides: Partial<ChannelPin> = {}): ChannelPin {
  return {
    message: createMessage(),
    pinned_by: "user-2",
    pinned_at: "2025-01-02T00:00:00Z",
    ...overrides,
  };
}

describe("channelPins store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChannelPins();
  });

  describe("loadChannelPins", () => {
    it("loads pins, sets channelPins signal, sets pinsChannelId, and manages loading state", async () => {
      const pins = [
        createPin({ message: createMessage({ id: "msg-1" }) }),
        createPin({ message: createMessage({ id: "msg-2" }) }),
      ];
      vi.mocked(tauri.listChannelPins).mockResolvedValue(pins);

      const promise = loadChannelPins("ch-1");

      expect(isPinsLoading()).toBe(true);
      expect(pinsChannelId()).toBe("ch-1");

      await promise;

      expect(channelPins()).toEqual(pins);
      expect(isPinsLoading()).toBe(false);
      expect(pinsChannelId()).toBe("ch-1");
      expect(tauri.listChannelPins).toHaveBeenCalledWith("ch-1");
    });
  });

  describe("loadChannelPins error", () => {
    it("sets empty array on failure and loading becomes false", async () => {
      vi.mocked(tauri.listChannelPins).mockRejectedValue(new Error("Network error"));

      await loadChannelPins("ch-1");

      expect(channelPins()).toEqual([]);
      expect(isPinsLoading()).toBe(false);
      expect(pinsChannelId()).toBe("ch-1");
    });
  });

  describe("pinMessageAction", () => {
    it("calls apiPinMessage with correct args", async () => {
      vi.mocked(tauri.pinMessage).mockResolvedValue(undefined);

      await pinMessageAction("ch-1", "msg-1");

      expect(tauri.pinMessage).toHaveBeenCalledWith("ch-1", "msg-1");
    });
  });

  describe("unpinMessageAction", () => {
    it("calls apiUnpinMessage with correct args", async () => {
      vi.mocked(tauri.unpinMessage).mockResolvedValue(undefined);

      await unpinMessageAction("ch-1", "msg-1");

      expect(tauri.unpinMessage).toHaveBeenCalledWith("ch-1", "msg-1");
    });
  });

  describe("handlePinAdded", () => {
    it("reloads pins when channelId matches pinsChannelId", async () => {
      const initialPins = [createPin({ message: createMessage({ id: "msg-1" }) })];
      vi.mocked(tauri.listChannelPins).mockResolvedValue(initialPins);
      await loadChannelPins("ch-1");

      const updatedPins = [
        createPin({ message: createMessage({ id: "msg-1" }) }),
        createPin({ message: createMessage({ id: "msg-2" }) }),
      ];
      vi.mocked(tauri.listChannelPins).mockResolvedValue(updatedPins);

      handlePinAdded("ch-1", "msg-2", "user-3", "2025-01-03T00:00:00Z");

      // Wait for the async reload triggered by handlePinAdded
      await vi.waitFor(() => {
        expect(tauri.listChannelPins).toHaveBeenCalledTimes(2);
      });
    });

    it("ignores when channelId does not match pinsChannelId", async () => {
      const pins = [createPin()];
      vi.mocked(tauri.listChannelPins).mockResolvedValue(pins);
      await loadChannelPins("ch-1");

      vi.clearAllMocks();

      handlePinAdded("ch-other", "msg-2", "user-3", "2025-01-03T00:00:00Z");

      expect(tauri.listChannelPins).not.toHaveBeenCalled();
    });
  });

  describe("handlePinRemoved", () => {
    it("removes pin from signal when channelId matches", async () => {
      const pins = [
        createPin({ message: createMessage({ id: "msg-1" }) }),
        createPin({ message: createMessage({ id: "msg-2" }) }),
      ];
      vi.mocked(tauri.listChannelPins).mockResolvedValue(pins);
      await loadChannelPins("ch-1");

      expect(channelPins()).toHaveLength(2);

      handlePinRemoved("ch-1", "msg-1");

      expect(channelPins()).toHaveLength(1);
      expect(channelPins()[0].message.id).toBe("msg-2");
    });

    it("ignores when channelId does not match pinsChannelId", async () => {
      const pins = [
        createPin({ message: createMessage({ id: "msg-1" }) }),
        createPin({ message: createMessage({ id: "msg-2" }) }),
      ];
      vi.mocked(tauri.listChannelPins).mockResolvedValue(pins);
      await loadChannelPins("ch-1");

      handlePinRemoved("ch-other", "msg-1");

      expect(channelPins()).toHaveLength(2);
    });
  });

  describe("pinCount", () => {
    it("returns length of channelPins", async () => {
      expect(pinCount()).toBe(0);

      const pins = [
        createPin({ message: createMessage({ id: "msg-1" }) }),
        createPin({ message: createMessage({ id: "msg-2" }) }),
        createPin({ message: createMessage({ id: "msg-3" }) }),
      ];
      vi.mocked(tauri.listChannelPins).mockResolvedValue(pins);
      await loadChannelPins("ch-1");

      expect(pinCount()).toBe(3);
    });
  });

  describe("isMessagePinned", () => {
    it("returns true when message is pinned", async () => {
      const pins = [
        createPin({ message: createMessage({ id: "msg-1" }) }),
        createPin({ message: createMessage({ id: "msg-2" }) }),
      ];
      vi.mocked(tauri.listChannelPins).mockResolvedValue(pins);
      await loadChannelPins("ch-1");

      expect(isMessagePinned("msg-1")).toBe(true);
      expect(isMessagePinned("msg-2")).toBe(true);
    });

    it("returns false when message is not pinned", async () => {
      const pins = [createPin({ message: createMessage({ id: "msg-1" }) })];
      vi.mocked(tauri.listChannelPins).mockResolvedValue(pins);
      await loadChannelPins("ch-1");

      expect(isMessagePinned("msg-99")).toBe(false);
    });
  });

  describe("clearChannelPins", () => {
    it("resets signals to initial state", async () => {
      const pins = [createPin()];
      vi.mocked(tauri.listChannelPins).mockResolvedValue(pins);
      await loadChannelPins("ch-1");

      expect(channelPins()).toHaveLength(1);
      expect(pinsChannelId()).toBe("ch-1");

      clearChannelPins();

      expect(channelPins()).toEqual([]);
      expect(pinsChannelId()).toBeNull();
    });
  });
});
