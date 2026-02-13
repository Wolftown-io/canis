/**
 * Navigation E2E Tests
 *
 * Tests app layout, server rail, sidebar, channel selection, and logout.
 * Prerequisites: Backend running, test users + seed data
 */

import { test, expect } from "@playwright/test";
import { login, loginAsAdmin, selectFirstGuild, goHome } from "./helpers";

test.describe("Navigation", () => {
  test("should show sidebar after login", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.locator("aside")).toBeVisible();
  });

  test("should display server rail with home button", async ({ page }) => {
    await loginAsAdmin(page);
    const homeButton = page.locator('button[title="Home"]');
    await expect(homeButton).toBeVisible();
  });

  test("should display guild icons", async ({ page }) => {
    await loginAsAdmin(page);
    // Server rail should have at least one guild (from seed data)
    const nav = page.locator("nav");
    await expect(nav).toBeVisible();
    // There should be at least Home + Create Server + one guild
    const buttons = nav.locator("button");
    expect(await buttons.count()).toBeGreaterThanOrEqual(3);
  });

  test("should navigate to home view", async ({ page }) => {
    await loginAsAdmin(page);
    await selectFirstGuild(page);
    // Now go home
    await goHome(page);
    // Home view should show friends or DMs
    await expect(
      page.locator('button:has-text("Online")').or(page.locator('text=Friends'))
    ).toBeVisible({ timeout: 5000 });
  });

  test("should switch guild on click", async ({ page }) => {
    await loginAsAdmin(page);
    await selectFirstGuild(page);
    // Channel list should appear in sidebar
    await expect(page.locator("aside")).toContainText(/.+/, { timeout: 5000 });
  });

  test("should show channels when guild selected", async ({ page }) => {
    await loginAsAdmin(page);
    await selectFirstGuild(page);
    // Should see at least one channel in the sidebar
    const channelItems = page.locator('aside [role="button"]');
    await expect(channelItems.first()).toBeVisible({ timeout: 5000 });
  });

  test("should select channel on click", async ({ page }) => {
    await loginAsAdmin(page);
    await selectFirstGuild(page);
    // Find and click a text channel
    const channelItem = page.locator('aside [role="button"]').first();
    await expect(channelItem).toBeVisible({ timeout: 5000 });
    await channelItem.click();
    // Message input should appear
    await expect(
      page.locator('textarea[placeholder*="Message"]')
    ).toBeVisible({ timeout: 5000 });
  });

  test("should show user panel", async ({ page }) => {
    await loginAsAdmin(page);
    // User panel at bottom of sidebar should show username
    await expect(page.locator('button[title="User Settings"]')).toBeVisible();
  });

  test("should logout successfully", async ({ page }) => {
    await loginAsAdmin(page);
    // Click logout
    await page.click('button[title="Logout"]');
    // Should redirect to login page
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});
