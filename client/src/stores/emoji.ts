import { createStore } from "solid-js/store";
import type { GuildEmoji } from "@/lib/types";

interface EmojiState {
  recents: string[];
  favorites: string[];
  guildEmojis: Record<string, GuildEmoji[]>;
}

const [emojiState, setEmojiState] = createStore<EmojiState>({
  recents: [],
  favorites: [],
  guildEmojis: {},
});

const MAX_RECENTS = 20;

export function addToRecents(emoji: string): void {
  setEmojiState("recents", (prev) => {
    const filtered = prev.filter((e) => e !== emoji);
    return [emoji, ...filtered].slice(0, MAX_RECENTS);
  });
  // TODO: Persist to server
}

export function setGuildEmojis(guildId: string, emojis: GuildEmoji[]): void {
  setEmojiState("guildEmojis", guildId, emojis);
}

export function getGuildEmojis(guildId: string): GuildEmoji[] {
  return emojiState.guildEmojis[guildId] ?? [];
}

export { emojiState };
