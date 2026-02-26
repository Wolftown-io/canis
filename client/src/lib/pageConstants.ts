/**
 * Page-related constants.
 *
 * These values should match the server-side constants in
 * server/src/pages/constants.rs.
 */

/** Maximum content size in bytes (100KB). */
export const MAX_CONTENT_SIZE = 102_400;

/** Maximum slug length in characters. */
export const MAX_SLUG_LENGTH = 100;

/** Default maximum pages per scope (platform or guild). Must match server constant. */
export const DEFAULT_MAX_PAGES_PER_SCOPE = 10;

/** Maximum category name length in characters. */
export const MAX_CATEGORY_NAME_LENGTH = 50;

/** Maximum categories per guild. */
export const MAX_CATEGORIES_PER_GUILD = 20;

/** Scroll tolerance in pixels for "read to bottom" detection. */
export const SCROLL_TOLERANCE = 20;
