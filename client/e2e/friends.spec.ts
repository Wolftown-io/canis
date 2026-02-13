/**
 * Friends & DMs E2E Tests
 *
 * Tests friends list, friend requests, and DM conversations.
 * Prerequisites: Backend running, test users created
 */

import { test, expect } from "@playwright/test";
import { loginAsAlice, goHome } from "./helpers";

test.describe("Friends & DMs", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAlice(page);
    await goHome(page);
  });

  test("should display friends list", async ({ page }) => {
    await expect(
      page.locator('button:has-text("Online")').or(page.locator('text=Friends'))
    ).toBeVisible({ timeout: 5000 });
  });

  test("should switch between tabs", async ({ page }) => {
    const tabs = ["Online", "All", "Pending", "Blocked"];
    for (const tab of tabs) {
      const tabBtn = page.locator(`button:has-text("${tab}")`);
      await expect(tabBtn).toBeVisible({ timeout: 2000 });
      await tabBtn.click();
    }
  });

  test("should show add friend form", async ({ page }) => {
    const addBtn = page.locator(
      'button[title="Add Friend"], button:has-text("Add Friend")'
    );
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();

    await expect(
      page.locator('input[placeholder*="username" i]')
    ).toBeVisible({ timeout: 3000 });
  });

  test("should send a friend request", async ({ page }) => {
    const addBtn = page.locator(
      'button[title="Add Friend"], button:has-text("Add Friend")'
    );
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();

    const input = page.locator('input[placeholder*="username" i]');
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.fill("bob");

    const sendBtn = page.locator('button:has-text("Send"), button:has-text("Add")').first();
    await expect(sendBtn).toBeVisible({ timeout: 2000 });
    await sendBtn.click();

    // Should show success feedback or "already sent" message
    await expect(
      page.locator('text=sent').or(page.locator('text=already'))
        .or(page.locator('text=Success')).or(page.locator('[role="alert"]'))
    ).toBeVisible({ timeout: 5000 });
  });

  test("should open DM conversation", async ({ page }) => {
    const dmItem = page.locator('aside [role="button"]').first();
    await expect(dmItem).toBeVisible({ timeout: 3000 });
    await dmItem.click();

    await expect(
      page.locator('textarea[placeholder*="Message"]')
    ).toBeVisible({ timeout: 5000 });
  });
});
