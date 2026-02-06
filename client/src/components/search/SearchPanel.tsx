/**
 * SearchPanel Component
 *
 * Displays message search results with pagination and advanced filters.
 * Supports both guild and DM search modes.
 */

import { Component, Show, For, createSignal, createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Search, X, Loader2, Hash, Filter, Link, Paperclip } from "lucide-solid";
import { searchState, search, searchDMs, loadMore, clearSearch, hasMore } from "@/stores/search";
import { getActiveGuild } from "@/stores/guilds";
import type { SearchFilters } from "@/lib/types";
import Avatar from "@/components/ui/Avatar";
import { formatTimestamp } from "@/lib/utils";

interface SearchPanelProps {
  onClose: () => void;
  mode?: "guild" | "dm";
}

const SearchPanel: Component<SearchPanelProps> = (props) => {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = createSignal("");
  const [showFilters, setShowFilters] = createSignal(false);
  const [dateFrom, setDateFrom] = createSignal("");
  const [dateTo, setDateTo] = createSignal("");
  const [authorFilter, setAuthorFilter] = createSignal("");
  const [hasFilter, setHasFilter] = createSignal<"link" | "file" | "">("");
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  const mode = () => props.mode ?? "guild";

  const buildFilters = (): SearchFilters => {
    const filters: SearchFilters = {};
    if (dateFrom()) filters.date_from = new Date(dateFrom()).toISOString();
    if (dateTo()) filters.date_to = new Date(dateTo() + "T23:59:59").toISOString();
    if (authorFilter()) filters.author_id = authorFilter();
    if (hasFilter()) filters.has = hasFilter() as "link" | "file";
    return filters;
  };

  const triggerSearch = () => {
    const value = inputValue();
    if (value.trim().length < 2) {
      clearSearch();
      return;
    }

    const filters = buildFilters();
    if (mode() === "dm") {
      searchDMs(value, filters);
    } else {
      const guild = getActiveGuild();
      if (guild) {
        search(guild.id, value, filters);
      }
    }
  };

  // Debounced search
  const handleInput = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    setInputValue(value);

    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    searchTimeout = setTimeout(triggerSearch, 300);
  };

  // Navigate to the message's channel when clicked
  const handleResultClick = (channelId: string, messageId: string) => {
    if (mode() === "dm") {
      navigate(`/home/dm/${channelId}?highlight=${messageId}`);
    } else {
      const guild = getActiveGuild();
      if (guild) {
        navigate(`/guilds/${guild.id}/channels/${channelId}?highlight=${messageId}`);
      }
    }
    props.onClose();
  };

  // Escape HTML to prevent XSS
  const escapeHtml = (text: string): string => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  };

  // Escape regex special characters
  const escapeRegex = (text: string): string => {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  // Highlight search terms in content (XSS-safe)
  const highlightMatches = (content: string) => {
    const query = searchState.query.toLowerCase();
    if (!query) return escapeHtml(content);

    const safeContent = escapeHtml(content);

    const words = query.split(/\s+/).filter(w => w.length >= 2);
    let result = safeContent;

    for (const word of words) {
      const safeWord = escapeRegex(word);
      const regex = new RegExp(`(${safeWord})`, "gi");
      result = result.replace(regex, '<mark class="bg-accent-primary/30 text-text-primary rounded px-0.5">$1</mark>');
    }

    return result;
  };

  // Cleanup on unmount
  createEffect(() => {
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  });

  return (
    <div class="absolute inset-0 z-50 flex flex-col bg-surface-layer2">
      {/* Search Header */}
      <div class="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div class="relative flex-1 max-w-md">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-secondary" />
          <input
            type="text"
            placeholder={mode() === "dm" ? "Search DMs..." : "Search messages..."}
            value={inputValue()}
            onInput={handleInput}
            autofocus
            class="w-full pl-8 pr-3 py-1.5 rounded-md text-sm text-text-primary placeholder:text-text-secondary bg-surface-layer1 border border-white/10 outline-none focus:ring-1 focus:ring-accent-primary/30"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters())}
          class="ml-2 p-1.5 rounded transition-colors"
          classList={{
            "text-accent-primary bg-accent-primary/10": showFilters(),
            "text-text-secondary hover:text-text-primary": !showFilters(),
          }}
          title="Toggle filters"
        >
          <Filter class="w-4 h-4" />
        </button>
        <button
          onClick={props.onClose}
          class="ml-1 p-1.5 text-text-secondary hover:text-text-primary rounded transition-colors"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      {/* Filters Panel */}
      <Show when={showFilters()}>
        <div class="px-3 py-2 border-b border-white/10 space-y-2">
          <div class="flex gap-2">
            <div class="flex-1">
              <label class="text-xs text-text-secondary block mb-1">From date</label>
              <input
                type="date"
                value={dateFrom()}
                onInput={(e) => { setDateFrom(e.currentTarget.value); triggerSearch(); }}
                class="w-full px-2 py-1 rounded text-xs text-text-primary bg-surface-layer1 border border-white/10 outline-none"
              />
            </div>
            <div class="flex-1">
              <label class="text-xs text-text-secondary block mb-1">To date</label>
              <input
                type="date"
                value={dateTo()}
                onInput={(e) => { setDateTo(e.currentTarget.value); triggerSearch(); }}
                class="w-full px-2 py-1 rounded text-xs text-text-primary bg-surface-layer1 border border-white/10 outline-none"
              />
            </div>
          </div>
          <div>
            <label class="text-xs text-text-secondary block mb-1">Author ID</label>
            <input
              type="text"
              placeholder="User ID"
              value={authorFilter()}
              onInput={(e) => { setAuthorFilter(e.currentTarget.value); triggerSearch(); }}
              class="w-full px-2 py-1 rounded text-xs text-text-primary placeholder:text-text-secondary/50 bg-surface-layer1 border border-white/10 outline-none"
            />
          </div>
          <div class="flex gap-2">
            <button
              onClick={() => { setHasFilter(hasFilter() === "link" ? "" : "link"); triggerSearch(); }}
              class="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
              classList={{
                "bg-accent-primary/20 text-accent-primary": hasFilter() === "link",
                "bg-surface-layer1 text-text-secondary hover:text-text-primary": hasFilter() !== "link",
              }}
            >
              <Link class="w-3 h-3" />
              Has link
            </button>
            <button
              onClick={() => { setHasFilter(hasFilter() === "file" ? "" : "file"); triggerSearch(); }}
              class="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
              classList={{
                "bg-accent-primary/20 text-accent-primary": hasFilter() === "file",
                "bg-surface-layer1 text-text-secondary hover:text-text-primary": hasFilter() !== "file",
              }}
            >
              <Paperclip class="w-3 h-3" />
              Has file
            </button>
          </div>
        </div>
      </Show>

      <Show when={searchState.total > 0}>
        <span class="ml-3 text-xs text-text-secondary">
          {searchState.total} result{searchState.total !== 1 ? "s" : ""}
        </span>
      </Show>

      {/* Results */}
      <div class="flex-1 overflow-y-auto">
        {/* Loading State */}
        <Show when={searchState.isSearching && searchState.results.length === 0}>
          <div class="flex items-center justify-center py-8">
            <Loader2 class="w-6 h-6 text-text-secondary animate-spin" />
          </div>
        </Show>

        {/* Empty State */}
        <Show when={!searchState.isSearching && searchState.query.length >= 2 && searchState.results.length === 0}>
          <div class="flex flex-col items-center justify-center py-8 text-text-secondary">
            <Search class="w-12 h-12 mb-3 opacity-50" />
            <p class="text-sm">No results found</p>
            <p class="text-xs mt-1">Try different keywords</p>
          </div>
        </Show>

        {/* Hint State */}
        <Show when={searchState.query.length < 2}>
          <div class="flex flex-col items-center justify-center py-8 text-text-secondary">
            <Search class="w-12 h-12 mb-3 opacity-50" />
            <p class="text-sm">Type at least 2 characters to search</p>
          </div>
        </Show>

        {/* Error State */}
        <Show when={searchState.error}>
          <div class="p-4 text-center text-red-400 text-sm">
            {searchState.error}
          </div>
        </Show>

        {/* Results List */}
        <Show when={searchState.results.length > 0}>
          <div class="divide-y divide-white/5">
            <For each={searchState.results}>
              {(result) => (
                <button
                  onClick={() => handleResultClick(result.channel_id, result.id)}
                  class="w-full p-3 text-left hover:bg-white/5 transition-colors"
                >
                  {/* Channel Name */}
                  <div class="flex items-center gap-1 text-xs text-text-secondary mb-1">
                    <Hash class="w-3 h-3" />
                    <span>{result.channel_name}</span>
                  </div>

                  {/* Author and Time */}
                  <div class="flex items-center gap-2 mb-1">
                    <Avatar
                      src={result.author.avatar_url}
                      alt={result.author.display_name}
                      size="sm"
                    />
                    <span class="text-sm font-medium text-text-primary">
                      {result.author.display_name}
                    </span>
                    <span class="text-xs text-text-secondary">
                      {formatTimestamp(result.created_at)}
                    </span>
                  </div>

                  {/* Content Preview */}
                  <p
                    class="text-sm text-text-secondary line-clamp-2"
                    innerHTML={highlightMatches(result.content.substring(0, 200))}
                  />
                </button>
              )}
            </For>
          </div>

          {/* Load More Button */}
          <Show when={hasMore()}>
            <div class="p-3 text-center">
              <button
                onClick={loadMore}
                disabled={searchState.isSearching}
                class="px-4 py-2 text-sm text-accent-primary hover:bg-white/5 rounded-lg disabled:opacity-50"
              >
                <Show when={searchState.isSearching} fallback="Load more">
                  <Loader2 class="w-4 h-4 animate-spin inline mr-2" />
                  Loading...
                </Show>
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default SearchPanel;
