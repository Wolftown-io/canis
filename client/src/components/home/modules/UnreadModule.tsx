/**
 * UnreadModule Component
 *
 * Shows aggregate unread counts across all guilds and DMs.
 * Provides quick navigation to channels with unread messages.
 */

import { Component, Show, For, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { Inbox, Hash } from "lucide-solid";
import { getUnreadAggregate, type UnreadAggregate } from "@/lib/tauri";
import { selectGuild } from "@/stores/guilds";
import { selectChannel } from "@/stores/channels";
import { selectDM } from "@/stores/dms";
import { showToast } from "@/components/ui/Toast";
import CollapsibleModule from "./CollapsibleModule";

const UnreadModule: Component = () => {
  const [unreadData, setUnreadData] = createSignal<UnreadAggregate | null>(null);
  const [loading, setLoading] = createSignal(true);

  // Fetch unread data
  const fetchUnreads = async () => {
    try {
      const data = await getUnreadAggregate();
      setUnreadData(data);
    } catch (error) {
      console.error("Failed to fetch unread aggregate:", error);
      showToast({
        type: "error",
        title: "Failed to Load Unreads",
        message: "Could not fetch unread messages. Will retry when window gains focus.",
      });
    } finally {
      setLoading(false);
    }
  };

  // Refresh when window gains focus (throttled to once per 30s)
  let lastFetchTime = 0;
  const FOCUS_REFRESH_INTERVAL_MS = 30_000;

  const throttledFetch = () => {
    const now = Date.now();
    if (now - lastFetchTime >= FOCUS_REFRESH_INTERVAL_MS) {
      lastFetchTime = now;
      fetchUnreads();
    }
  };

  // Debounced fetch for WebSocket events (5s)
  let wsDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  const WS_DEBOUNCE_MS = 5_000;

  const debouncedFetch = () => {
    if (wsDebounceTimer) clearTimeout(wsDebounceTimer);
    wsDebounceTimer = setTimeout(() => {
      lastFetchTime = Date.now();
      fetchUnreads();
    }, WS_DEBOUNCE_MS);
  };

  onMount(() => {
    lastFetchTime = Date.now();
    fetchUnreads();
  });

  createEffect(() => {
    const handleFocus = () => throttledFetch();
    const handleUnreadUpdate = () => debouncedFetch();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("unread-update", handleUnreadUpdate);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("unread-update", handleUnreadUpdate);
    };
  });

  onCleanup(() => {
    if (wsDebounceTimer) clearTimeout(wsDebounceTimer);
  });

  const totalUnread = () => unreadData()?.total ?? 0;
  const hasUnreads = () => totalUnread() > 0;

  const navigateToChannel = async (guildId: string, channelId: string) => {
    try {
      // Switch to guild first
      await selectGuild(guildId);
      // Then switch to channel
      selectChannel(channelId);
    } catch (error) {
      console.error("Failed to navigate to channel:", error);
      showToast({
        type: "error",
        title: "Navigation Failed",
        message: "Could not navigate to channel. Please try again.",
      });
    }
  };

  const navigateToDM = (channelId: string) => {
    try {
      // Select the DM (this automatically switches to DMs view)
      selectDM(channelId);
    } catch (error) {
      console.error("Failed to navigate to DM:", error);
      showToast({
        type: "error",
        title: "Navigation Failed",
        message: "Could not navigate to DM. Please try again.",
      });
    }
  };

  return (
    <CollapsibleModule id="unread" title="Unread" badge={totalUnread()}>
      <Show
        when={!loading() && hasUnreads()}
        fallback={
          <Show
            when={!loading()}
            fallback={
              <div class="flex items-center justify-center py-4">
                <div class="animate-spin w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full"></div>
              </div>
            }
          >
            <div class="flex flex-col items-center justify-center py-4 text-center">
              <Inbox class="w-8 h-8 text-text-secondary mb-2 opacity-50" />
              <p class="text-sm text-text-secondary">All caught up!</p>
              <p class="text-xs text-text-muted mt-1">
                No unread messages
              </p>
            </div>
          </Show>
        }
      >
        <div class="space-y-4">
          {/* Guild Unreads */}
          <Show when={unreadData()?.guilds && unreadData()!.guilds.length > 0}>
            <div class="space-y-3">
              <For each={unreadData()!.guilds}>
                {(guild) => (
                  <div class="space-y-1">
                    <div class="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                      {guild.guild_name}
                    </div>
                    <div class="space-y-1">
                      <For each={guild.channels}>
                        {(channel) => (
                          <button
                            onClick={() => navigateToChannel(guild.guild_id, channel.channel_id)}
                            class="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/5 transition-colors group"
                          >
                            <div class="flex items-center gap-2 min-w-0">
                              <Hash class="w-4 h-4 text-text-secondary flex-shrink-0" />
                              <span class="text-sm text-text-primary truncate group-hover:text-accent-primary">
                                {channel.channel_name}
                              </span>
                            </div>
                            <span class="px-1.5 py-0.5 text-xs font-medium bg-accent-primary text-white rounded flex-shrink-0">
                              {channel.unread_count}
                            </span>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* DM Unreads */}
          <Show when={unreadData()?.dms && unreadData()!.dms.length > 0}>
            <div class="space-y-1">
              <div class="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                Direct Messages
              </div>
              <div class="space-y-1">
                <For each={unreadData()!.dms}>
                  {(dm) => (
                    <button
                      onClick={() => navigateToDM(dm.channel_id)}
                      class="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/5 transition-colors group"
                    >
                      <span class="text-sm text-text-primary truncate group-hover:text-accent-primary">
                        {dm.channel_name}
                      </span>
                      <span class="px-1.5 py-0.5 text-xs font-medium bg-accent-primary text-white rounded flex-shrink-0">
                        {dm.unread_count}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </CollapsibleModule>
  );
};

export default UnreadModule;
