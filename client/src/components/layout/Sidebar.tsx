/**
 * Sidebar - Context Navigation
 *
 * Middle-left panel containing:
 * - Server/Guild header with dropdown
 * - Search bar
 * - Favorites (cross-server starred channels)
 * - Channel list
 * - User panel at bottom
 *
 * Note: Voice controls moved to VoiceIsland (floating overlay)
 */

import { Component, onMount } from "solid-js";
import { ChevronDown } from "lucide-solid";
import { loadChannels } from "@/stores/channels";
import ChannelList from "@/components/channels/ChannelList";
import UserPanel from "./UserPanel";

const Sidebar: Component = () => {
  // Load channels when sidebar mounts
  onMount(() => {
    loadChannels();
  });

  return (
    <aside class="w-[240px] flex flex-col bg-surface-layer2 z-10 transition-all duration-300">
      {/* Server Header with Dropdown */}
      <header class="h-12 px-4 flex items-center justify-between border-b border-white/5 hover:bg-surface-highlight cursor-pointer group">
        <h1 class="font-bold text-lg text-text-primary truncate">VoiceChat</h1>
        <ChevronDown class="w-4 h-4 text-text-secondary transition-transform duration-200 group-hover:rotate-180" />
      </header>

      {/* Search Bar */}
      <div class="px-3 py-2">
        <input
          type="text"
          placeholder="Search..."
          class="w-full px-3 py-2 bg-surface-base rounded-xl text-sm text-text-primary placeholder:text-text-secondary/50 outline-none focus:ring-2 focus:ring-accent-primary/30 border border-white/5"
        />
      </div>

      {/* Favorites Section - Placeholder for Phase 3 */}
      {/* <div class="px-3 py-2">
        <div class="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">
          Starred
        </div>
        Cross-server favorites will appear here
      </div> */}

      {/* Channel List */}
      <ChannelList />

      {/* User Panel (Bottom) */}
      <UserPanel />
    </aside>
  );
};

export default Sidebar;
