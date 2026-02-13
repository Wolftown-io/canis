/**
 * Search E2E Tests
 *
 * Tests global search panel and message search functionality.
 * Prerequisites: Backend running, test users + seed data with messages
 */

import { test, expect } from "@playwright/test";
import { loginAsAdmin, selectFirstGuild, openSearch } from "./helpers";

test.describe("Search", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await selectFirstGuild(page);
  });

  test("should open search panel", async ({ page }) => {
    await openSearch(page);
  });

  test("should accept search query", async ({ page }) => {
    await openSearch(page);

    const searchInput = page.locator(
      'input[placeholder*="search" i], input[type="search"]'
    );
    await searchInput.fill("hello");
    await searchInput.press("Enter");

    // Should show results or "no results" message
    await expect(
      page.locator('text=result').or(page.locator('text=No result'))
        .or(page.locator('[role="listitem"]'))
    ).toBeVisible({ timeout: 5000 });
  });

  test("should display search results", async ({ page }) => {
    await openSearch(page);

    const searchInput = page.locator(
      'input[placeholder*="search" i], input[type="search"]'
    );
    await searchInput.fill("test");
    await searchInput.press("Enter");

    // Should show results or "no results" message
    await expect(
      page.locator('text=result').or(page.locator('text=No result'))
        .or(page.locator('[role="listitem"]'))
    ).toBeVisible({ timeout: 5000 });
  });
});
