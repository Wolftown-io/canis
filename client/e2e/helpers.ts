/**
 * Shared E2E Test Helpers
 *
 * Common utilities for Playwright tests. All tests should use these
 * helpers instead of duplicating login/navigation logic.
 *
 * Test users (created via scripts/create-test-users.sh):
 *   admin / admin123  — Guild owner, system admin
 *   alice / password123 — Regular member
 *   bob   / password123 — Regular member
 */

import { expect, type Page } from "@playwright/test";

/** Login as a specific user and wait for the app to load. */
export async function login(
  page: Page,
  username: string,
  password: string = "password123"
) {
  await page.goto("/login");
  await page.fill('input[placeholder="Enter your username"]', username);
  await page.fill('input[placeholder="Enter your password"]', password);
  await page.click('button[type="submit"]');
  // Wait for sidebar (indicates successful login + app loaded)
  await expect(page.locator("aside")).toBeVisible({ timeout: 15000 });
}

/** Login as admin (owner, system admin). */
export async function loginAsAdmin(page: Page) {
  await login(page, "admin", "admin123");
}

/** Login as alice (regular member). */
export async function loginAsAlice(page: Page) {
  await login(page, "alice");
}

/** Click the first guild in the server rail. */
export async function selectFirstGuild(page: Page) {
  // Guilds appear after the home button in the server rail
  const guildButtons = page.locator(
    'nav button:not([title="Home"]):not([title="Create Server"]):not([title="Join Server"])'
  );
  const firstGuild = guildButtons.first();
  await expect(firstGuild).toBeVisible({ timeout: 10000 });
  await firstGuild.click();
}

/** Click the first text channel in the channel list. */
export async function selectFirstChannel(page: Page) {
  // Wait for channel list and click first channel item
  const channel = page.locator('[role="button"]').filter({ hasText: /#|general/ }).first();
  await expect(channel).toBeVisible({ timeout: 10000 });
  await channel.click();
}

/** Open the user settings modal via the gear icon in UserPanel. */
export async function openUserSettings(page: Page) {
  await page.click('button[title="User Settings"]');
  await expect(page.locator('[role="dialog"], .fixed.inset-0')).toBeVisible({
    timeout: 5000,
  });
}

/** Navigate to home view by clicking the Home button. */
export async function goHome(page: Page) {
  await page.click('button[title="Home"]');
}

/** Open the global search panel (button or keyboard shortcut). */
export async function openSearch(page: Page) {
  const searchBtn = page.locator('button:has-text("Search")');
  if (await searchBtn.isVisible({ timeout: 2000 })) {
    await searchBtn.click();
  } else {
    await page.keyboard.press("Control+Shift+f");
  }
  await expect(
    page.locator('input[placeholder*="search" i], input[type="search"]')
  ).toBeVisible({ timeout: 5000 });
}

/** Navigate to the admin dashboard and wait for it to load. */
export async function navigateToAdmin(page: Page) {
  await page.goto("/admin");
  await expect(
    page.locator('text=Admin Dashboard').or(page.locator('text=Admin'))
  ).toBeVisible({ timeout: 10000 });
}

/** Generate a unique string for test data to avoid collisions. */
export function uniqueId(prefix: string = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
