/**
 * Guild Store (Phase 3 Preparation)
 *
 * Manages guild (server) state for multi-server support.
 * Currently a skeleton for Phase 3 - will be populated when guild backend is ready.
 *
 * This store exists to:
 * 1. Prevent refactoring debt when Phase 3 arrives
 * 2. Establish the interface early (ServerRail can wire to it now)
 * 3. Define guild-scoped data flows before implementation
 */

import { createStore } from "solid-js/store";

/**
 * Guild (Server) entity
 */
export interface Guild {
  id: string;
  name: string;
  icon_url?: string;
  owner_id: string;
  created_at: string;
}

/**
 * Guild store state
 */
interface GuildStoreState {
  // All guilds the user is a member of
  guilds: Guild[];
  // Currently active/selected guild ID
  activeGuildId: string | null;
  // Loading state
  isLoading: boolean;
  // Error state
  error: string | null;
}

// Create the store
const [guildsState, setGuildsState] = createStore<GuildStoreState>({
  guilds: [],
  activeGuildId: null,
  isLoading: false,
  error: null,
});

/**
 * Load all guilds for the current user
 * @phase3 - Will fetch from /api/guilds when backend is ready
 */
export async function loadGuilds(): Promise<void> {
  setGuildsState({ isLoading: true, error: null });

  try {
    // @phase3 - Fetch guilds from backend when API is ready
    // const guilds = await invoke<Guild[]>("get_user_guilds");
    // setGuildsState({ guilds, isLoading: false });

    // For now, just clear loading state (no guilds until Phase 3)
    setGuildsState({ isLoading: false });
  } catch (err) {
    console.error("Failed to load guilds:", err);
    setGuildsState({
      error: err instanceof Error ? err.message : "Failed to load servers",
      isLoading: false,
    });
  }
}

/**
 * Select/activate a guild
 * This will trigger:
 * - Channel list reload (scoped to guild)
 * - Message history clear
 * - Voice disconnect if in different guild's channel
 *
 * @phase3 - Will coordinate with channelsStore and voiceStore
 */
export function selectGuild(guildId: string): void {
  setGuildsState({ activeGuildId: guildId });

  // @phase3 - Trigger channel reload for selected guild
  // await loadChannelsForGuild(guildId);

  // @phase3 - Disconnect from voice if switching to different guild
  // if (voiceState.channelId && !belongsToGuild(voiceState.channelId, guildId)) {
  //   await leaveVoice();
  // }
}

/**
 * Select "Home" view (no guild selected)
 * This shows DMs, mentions, and cross-server activity
 */
export function selectHome(): void {
  setGuildsState({ activeGuildId: null });

  // @phase3 - Load unified home view (DMs, mentions, cross-server activity)
}

/**
 * Get the currently active guild
 */
export function getActiveGuild(): Guild | null {
  if (!guildsState.activeGuildId) return null;
  return guildsState.guilds.find((g) => g.id === guildsState.activeGuildId) ?? null;
}

/**
 * Check if a channel belongs to the active guild
 * @phase3 - Channels will have guild_id field
 */
export function isChannelInActiveGuild(_channelId: string): boolean {
  // @phase3 - Check channel.guild_id === activeGuildId when channels are guild-scoped
  // For now, all channels belong to implicit "Home" guild
  return true;
}

// Export the store for reading
export { guildsState };
