/**
 * Emoji Store
 *
 * Manages emoji state including recents and search functionality.
 */

import { createStore } from "solid-js/store";

// ============================================================================
// Types
// ============================================================================

export interface Emoji {
  /** Unicode emoji character or custom emoji ID */
  id: string;
  /** Display name */
  name: string;
  /** Category (e.g., "smileys", "people", "animals") */
  category: string;
  /** Keywords for search */
  keywords?: string[];
  /** Whether this is a custom guild emoji */
  isCustom?: boolean;
  /** URL for custom emoji image */
  imageUrl?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of recent emojis to store */
const MAX_RECENTS = 20;

/** Local storage key for recent emojis */
const RECENTS_STORAGE_KEY = "emoji_recents";

// ============================================================================
// State
// ============================================================================

interface EmojiState {
  /** Recently used emojis */
  recents: Emoji[];
  /** Search query */
  searchQuery: string;
  /** Loading state */
  isLoading: boolean;
}

const [emojiState, setEmojiState] = createStore<EmojiState>({
  recents: [],
  searchQuery: "",
  isLoading: false,
});

// ============================================================================
// Pure Helper Functions (Testable)
// ============================================================================

/**
 * Add an emoji to recents array (pure function for testing).
 * Returns a new array with the emoji at the front, limited to MAX_RECENTS.
 * If the emoji already exists, it's moved to the front.
 */
export function addEmojiToRecentsArray(
  recents: Emoji[],
  emoji: Emoji,
  maxRecents: number = MAX_RECENTS
): Emoji[] {
  // Filter out existing instance of this emoji
  const filtered = recents.filter((e) => e.id !== emoji.id);
  // Add to front and limit size
  return [emoji, ...filtered].slice(0, maxRecents);
}

/**
 * Search emojis by name or keywords (pure function for testing).
 * Returns emojis that match the query.
 */
export function searchEmojisInArray(
  emojis: Emoji[],
  query: string
): Emoji[] {
  if (!query.trim()) {
    return emojis;
  }

  const normalizedQuery = query.toLowerCase().trim();

  return emojis.filter((emoji) => {
    // Check name
    if (emoji.name.toLowerCase().includes(normalizedQuery)) {
      return true;
    }
    // Check keywords
    if (emoji.keywords?.some((kw) => kw.toLowerCase().includes(normalizedQuery))) {
      return true;
    }
    return false;
  });
}

// ============================================================================
// Store Actions
// ============================================================================

/**
 * Load recents from local storage.
 */
export function loadRecentsFromStorage(): void {
  try {
    const stored = localStorage.getItem(RECENTS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Emoji[];
      setEmojiState("recents", parsed.slice(0, MAX_RECENTS));
    }
  } catch (err) {
    console.warn("Failed to load emoji recents from storage:", err);
  }
}

/**
 * Save recents to local storage.
 */
function saveRecentsToStorage(recents: Emoji[]): void {
  try {
    localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(recents));
  } catch (err) {
    console.warn("Failed to save emoji recents to storage:", err);
  }
}

/**
 * Add an emoji to recents.
 */
export function addToRecents(emoji: Emoji): void {
  const newRecents = addEmojiToRecentsArray(emojiState.recents, emoji, MAX_RECENTS);
  setEmojiState("recents", newRecents);
  saveRecentsToStorage(newRecents);
}

/**
 * Clear all recents.
 */
export function clearRecents(): void {
  setEmojiState("recents", []);
  try {
    localStorage.removeItem(RECENTS_STORAGE_KEY);
  } catch (err) {
    console.warn("Failed to clear emoji recents from storage:", err);
  }
}

/**
 * Get recents.
 */
export function getRecents(): Emoji[] {
  return emojiState.recents;
}

/**
 * Set search query.
 */
export function setSearchQuery(query: string): void {
  setEmojiState("searchQuery", query);
}

/**
 * Get search query.
 */
export function getSearchQuery(): string {
  return emojiState.searchQuery;
}

// ============================================================================
// Export
// ============================================================================

export { emojiState, MAX_RECENTS };
