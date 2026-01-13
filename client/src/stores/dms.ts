/**
 * DMs Store
 *
 * Manages DM channels state for Home view.
 */

import { createStore } from "solid-js/store";
import type { DMListItem, Message } from "@/lib/types";
import * as tauri from "@/lib/tauri";

interface DMsStoreState {
  dms: DMListItem[];
  selectedDMId: string | null;
  isShowingFriends: boolean;
  typingUsers: Record<string, string[]>;
  isLoading: boolean;
  error: string | null;
}

const [dmsState, setDmsState] = createStore<DMsStoreState>({
  dms: [],
  selectedDMId: null,
  isShowingFriends: true,
  typingUsers: {},
  isLoading: false,
  error: null,
});

/**
 * Load all DMs for the current user
 */
export async function loadDMs(): Promise<void> {
  setDmsState({ isLoading: true, error: null });

  try {
    const dms = await tauri.getDMList();
    setDmsState({ dms, isLoading: false });
  } catch (err) {
    console.error("Failed to load DMs:", err);
    setDmsState({
      error: err instanceof Error ? err.message : "Failed to load DMs",
      isLoading: false,
    });
  }
}

/**
 * Select a DM to view
 */
export function selectDM(channelId: string): void {
  setDmsState({
    selectedDMId: channelId,
    isShowingFriends: false,
  });
}

/**
 * Switch to Friends tab
 */
export function selectFriendsTab(): void {
  setDmsState({
    selectedDMId: null,
    isShowingFriends: true,
  });
}

/**
 * Update last message for a DM (from WebSocket)
 */
export function updateDMLastMessage(channelId: string, message: Message): void {
  const dmIndex = dmsState.dms.findIndex((d) => d.id === channelId);
  if (dmIndex === -1) return;

  setDmsState("dms", dmIndex, {
    last_message: {
      id: message.id,
      content: message.content,
      user_id: message.author.id,
      username: message.author.username,
      created_at: message.created_at,
    },
    unread_count: dmsState.dms[dmIndex].unread_count + 1,
  });

  // Re-sort DMs by last message time
  const sortedDMs = [...dmsState.dms].sort((a, b) => {
    const aTime = a.last_message?.created_at || a.created_at;
    const bTime = b.last_message?.created_at || b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });
  setDmsState({ dms: sortedDMs });
}

/**
 * Mark DM as read (called when viewing a DM)
 */
export async function markDMAsRead(channelId: string): Promise<void> {
  const dm = dmsState.dms.find((d) => d.id === channelId);
  if (!dm || dm.unread_count === 0) return;

  try {
    await tauri.markDMAsRead(channelId, dm.last_message?.id);

    const dmIndex = dmsState.dms.findIndex((d) => d.id === channelId);
    if (dmIndex !== -1) {
      setDmsState("dms", dmIndex, "unread_count", 0);
    }
  } catch (err) {
    console.error("Failed to mark DM as read:", err);
  }
}

/**
 * Handle dm_read event from WebSocket (cross-device sync)
 */
export function handleDMReadEvent(channelId: string): void {
  const dmIndex = dmsState.dms.findIndex((d) => d.id === channelId);
  if (dmIndex !== -1) {
    setDmsState("dms", dmIndex, "unread_count", 0);
  }
}

/**
 * Get the currently selected DM
 */
export function getSelectedDM(): DMListItem | null {
  if (!dmsState.selectedDMId) return null;
  return dmsState.dms.find((d) => d.id === dmsState.selectedDMId) || null;
}

/**
 * Get total unread count across all DMs
 */
export function getTotalUnreadCount(): number {
  return dmsState.dms.reduce((sum, dm) => sum + dm.unread_count, 0);
}

export { dmsState };
