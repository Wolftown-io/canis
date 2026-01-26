/**
 * Members Store
 *
 * Handles member-related operations and patches.
 * Member data is stored in the guilds store.
 */

import { guildsState, setGuildsState } from "./guilds";
import type { GuildMember } from "@/lib/types";

/**
 * Apply a partial patch to a member's data.
 * The entity_id format is "guild_id:user_id".
 */
export function patchMember(entityId: string, diff: Record<string, unknown>): void {
  // Parse the entity ID - expected format: "guild_id:user_id"
  const [guildId, userId] = entityId.split(":");
  if (!guildId || !userId) {
    console.warn("[Members] Invalid member entity ID format:", entityId);
    return;
  }

  const members = guildsState.members[guildId];
  if (!members) {
    // No members loaded for this guild, ignore patch
    return;
  }

  const memberIndex = members.findIndex((m) => m.user_id === userId);
  if (memberIndex === -1) {
    // Member not in store, ignore patch
    return;
  }

  // Filter to only valid GuildMember fields
  const validFields: (keyof GuildMember)[] = [
    "username", "display_name", "avatar_url", "nickname", "status", "last_seen_at"
  ];
  const updates: Partial<GuildMember> = {};
  for (const field of validFields) {
    if (field in diff) {
      (updates as Record<string, unknown>)[field] = diff[field];
    }
  }

  if (Object.keys(updates).length > 0) {
    setGuildsState("members", guildId, memberIndex, (prev) => ({ ...prev, ...updates }));
  }
}

/**
 * Get members for a guild (re-export from guilds store).
 */
export function getMembers(guildId: string): GuildMember[] {
  return guildsState.members[guildId] || [];
}

/**
 * Get a specific member.
 */
export function getMember(guildId: string, userId: string): GuildMember | undefined {
  return guildsState.members[guildId]?.find((m) => m.user_id === userId);
}

// Re-export setGuildsState for internal use
export { setGuildsState };
