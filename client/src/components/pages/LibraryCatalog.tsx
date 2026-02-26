/**
 * LibraryCatalog — Browsable grid of all guild pages grouped by category.
 *
 * Renders a searchable, collapsible catalog of wiki/knowledge-base pages
 * organized into categories. Supports page creation and category management
 * for users with appropriate permissions.
 */

import { createSignal, createMemo, For, Show } from "solid-js";
import {
  BookOpen,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  FileText,
  Settings,
} from "lucide-solid";
import type { PageListItem, PageCategory } from "@/lib/types";

interface LibraryCatalogProps {
  guildId: string;
  pages: PageListItem[];
  categories: PageCategory[];
  canManage?: boolean;
  onPageClick?: (page: PageListItem) => void;
  onNewPage?: (categoryId?: string) => void;
  onManageCategories?: () => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function LibraryCatalog(props: LibraryCatalogProps) {
  const [searchText, setSearchText] = createSignal("");
  const [expandedCategories, setExpandedCategories] = createSignal<
    Record<string, boolean>
  >({});

  const isCategoryExpanded = (categoryId: string): boolean => {
    const state = expandedCategories()[categoryId];
    // Default to expanded
    return state === undefined ? true : state;
  };

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [categoryId]: !isCategoryExpanded(categoryId),
    }));
  };

  const filteredPages = createMemo(() => {
    const query = searchText().toLowerCase().trim();
    if (!query) return props.pages;
    return props.pages.filter((page) =>
      page.title.toLowerCase().includes(query),
    );
  });

  const pagesByCategory = createMemo(() => {
    const map = new Map<string | null, PageListItem[]>();

    for (const page of filteredPages()) {
      const key = page.category_id ?? null;
      const existing = map.get(key) ?? [];
      existing.push(page);
      map.set(key, existing);
    }

    // Sort pages within each category by position
    for (const [key, pages] of map) {
      map.set(
        key,
        pages.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      );
    }

    return map;
  });

  const categorizedSections = createMemo(() => {
    const map = pagesByCategory();
    return props.categories
      .filter(
        (cat) => map.has(cat.id) || (!searchText().trim() && props.canManage),
      )
      .map((cat) => ({
        id: cat.id,
        name: cat.name,
        pages: map.get(cat.id) ?? [],
      }));
  });

  const uncategorizedPages = createMemo(() => {
    return pagesByCategory().get(null) ?? [];
  });

  const hasAnyPages = createMemo(() => props.pages.length > 0);
  const hasFilteredResults = createMemo(() => filteredPages().length > 0);

  return (
    <div class="flex flex-col h-full bg-zinc-900 text-white">
      {/* Header */}
      <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-700">
        <div class="flex items-center gap-3">
          <BookOpen class="w-6 h-6 text-zinc-300" />
          <h1 class="text-xl font-semibold">Library</h1>
        </div>
        <Show when={props.canManage}>
          <button
            type="button"
            class="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-300 rounded-md hover:bg-zinc-700 transition-colors"
            onClick={() => props.onManageCategories?.()}
          >
            <Settings class="w-4 h-4" />
            Manage Categories
          </button>
        </Show>
      </div>

      {/* Search */}
      <div class="px-6 py-3">
        <div class="relative">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search pages..."
            value={searchText()}
            onInput={(e) => setSearchText(e.currentTarget.value)}
            class="w-full pl-10 pr-4 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
          />
        </div>
      </div>

      {/* Content */}
      <div class="flex-1 overflow-y-auto px-6 pb-6">
        <Show
          when={hasAnyPages() || props.canManage}
          fallback={
            <div class="flex flex-col items-center justify-center py-16 text-zinc-400">
              <FileText class="w-12 h-12 mb-4 text-zinc-600" />
              <p class="text-lg font-medium mb-1">No pages yet</p>
              <p class="text-sm text-zinc-500">
                This library doesn't have any pages.
              </p>
            </div>
          }
        >
          <Show
            when={hasFilteredResults() || !searchText().trim()}
            fallback={
              <div class="flex flex-col items-center justify-center py-16 text-zinc-400">
                <Search class="w-12 h-12 mb-4 text-zinc-600" />
                <p class="text-lg font-medium mb-1">No results</p>
                <p class="text-sm text-zinc-500">
                  No pages match "{searchText()}"
                </p>
              </div>
            }
          >
            <div class="flex flex-col gap-4 mt-2">
              {/* Categorized sections */}
              <For each={categorizedSections()}>
                {(section) => (
                  <CategorySection
                    id={section.id}
                    name={section.name}
                    pages={section.pages}
                    expanded={isCategoryExpanded(section.id)}
                    canManage={props.canManage}
                    onToggle={() => toggleCategory(section.id)}
                    onPageClick={props.onPageClick}
                    onNewPage={() => props.onNewPage?.(section.id)}
                  />
                )}
              </For>

              {/* Uncategorized section */}
              <Show
                when={
                  uncategorizedPages().length > 0 ||
                  (!searchText().trim() && props.canManage)
                }
              >
                <CategorySection
                  id="__uncategorized__"
                  name="Uncategorized"
                  pages={uncategorizedPages()}
                  expanded={isCategoryExpanded("__uncategorized__")}
                  canManage={props.canManage}
                  onToggle={() => toggleCategory("__uncategorized__")}
                  onPageClick={props.onPageClick}
                  onNewPage={() => props.onNewPage?.()}
                />
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

interface CategorySectionProps {
  id: string;
  name: string;
  pages: PageListItem[];
  expanded: boolean;
  canManage?: boolean;
  onToggle: () => void;
  onPageClick?: (page: PageListItem) => void;
  onNewPage?: () => void;
}

function CategorySection(props: CategorySectionProps) {
  return (
    <div>
      {/* Category header */}
      <button
        type="button"
        class="flex items-center gap-2 w-full py-2 text-left text-sm font-medium text-zinc-300 hover:text-white transition-colors"
        onClick={() => props.onToggle()}
      >
        <Show
          when={props.expanded}
          fallback={<ChevronRight class="w-4 h-4 text-zinc-500" />}
        >
          <ChevronDown class="w-4 h-4 text-zinc-500" />
        </Show>
        <span>{props.name}</span>
        <span class="text-xs text-zinc-500">({props.pages.length})</span>
      </button>

      {/* Category content */}
      <Show when={props.expanded}>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-1 ml-6">
          <For each={props.pages}>
            {(page) => (
              <button
                type="button"
                class="bg-zinc-800 rounded-lg p-4 border border-zinc-700 text-left hover:bg-zinc-700 transition-colors cursor-pointer"
                onClick={() => props.onPageClick?.(page)}
              >
                <div class="flex items-start gap-3">
                  <FileText class="w-5 h-5 text-zinc-400 mt-0.5 shrink-0" />
                  <div class="min-w-0 flex-1">
                    <h3 class="text-sm font-medium text-white truncate">
                      {page.title}
                    </h3>
                    <div class="flex items-center gap-2 mt-1.5">
                      <Show when={page.updated_at}>
                        <span class="text-xs text-zinc-500">
                          {formatDate(page.updated_at!)}
                        </span>
                      </Show>
                      <Show when={page.requires_acceptance}>
                        <span class="px-2 py-0.5 bg-amber-900/40 text-amber-400 rounded text-xs font-medium">
                          Requires Acceptance
                        </span>
                      </Show>
                    </div>
                  </div>
                </div>
              </button>
            )}
          </For>

          {/* New Page button */}
          <Show when={props.canManage}>
            <button
              type="button"
              class="flex items-center justify-center gap-2 rounded-lg p-4 border border-dashed border-zinc-700 text-zinc-400 hover:text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 transition-colors cursor-pointer"
              onClick={() => props.onNewPage?.()}
            >
              <Plus class="w-4 h-4" />
              <span class="text-sm">New Page</span>
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
