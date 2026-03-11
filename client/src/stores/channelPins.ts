import { createSignal } from "solid-js";
import type { ChannelPin } from "@/lib/types";
import { listChannelPins, pinMessage as apiPinMessage, unpinMessage as apiUnpinMessage } from "@/lib/tauri";

const [channelPins, setChannelPins] = createSignal<ChannelPin[]>([]);
const [isPinsLoading, setIsPinsLoading] = createSignal(false);
const [pinsChannelId, setPinsChannelId] = createSignal<string | null>(null);

export { channelPins, isPinsLoading, pinsChannelId };

export async function loadChannelPins(channelId: string): Promise<void> {
  setIsPinsLoading(true);
  setPinsChannelId(channelId);
  try {
    const pins = await listChannelPins(channelId);
    setChannelPins(pins);
  } catch (err) {
    console.error("Failed to load channel pins:", err);
    setChannelPins([]);
  } finally {
    setIsPinsLoading(false);
  }
}

export async function pinMessageAction(channelId: string, messageId: string): Promise<void> {
  await apiPinMessage(channelId, messageId);
}

export async function unpinMessageAction(channelId: string, messageId: string): Promise<void> {
  await apiUnpinMessage(channelId, messageId);
}

export function handlePinAdded(channelId: string, _messageId: string, _pinnedBy: string, _pinnedAt: string): void {
  if (pinsChannelId() === channelId) {
    // Reload pins to get full message data
    loadChannelPins(channelId);
  }
}

export function handlePinRemoved(channelId: string, messageId: string): void {
  if (pinsChannelId() === channelId) {
    setChannelPins((prev) => prev.filter((p) => p.message.id !== messageId));
  }
}

export function pinCount(): number {
  return channelPins().length;
}

export function isMessagePinned(messageId: string): boolean {
  return channelPins().some((p) => p.message.id === messageId);
}

export function clearChannelPins(): void {
  setChannelPins([]);
  setPinsChannelId(null);
}
