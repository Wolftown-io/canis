/**
 * Messaging E2E Tests
 *
 * Tests message sending, display, and input behavior.
 * Prerequisites: Backend running, test users + seed data, at least one text channel
 */

import { test, expect } from "@playwright/test";
import { loginAsAdmin, selectFirstGuild, uniqueId } from "./helpers";

test.describe("Messaging", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await selectFirstGuild(page);
    // Click the first text channel
    const channelItem = page.locator('aside [role="button"]').first();
    await expect(channelItem).toBeVisible({ timeout: 5000 });
    await channelItem.click();
    await expect(
      page.locator('textarea[placeholder*="Message"]')
    ).toBeVisible({ timeout: 10000 });
  });

  test("should display message input", async ({ page }) => {
    const input = page.locator('textarea[placeholder*="Message"]');
    await expect(input).toBeVisible();
    await expect(input).toBeEditable();
  });

  test("should send and display a message", async ({ page }) => {
    const testMessage = `Hello from E2E ${uniqueId()}`;
    const input = page.locator('textarea[placeholder*="Message"]');
    await input.fill(testMessage);
    await input.press("Enter");

    // Message should appear in the message list
    await expect(page.locator(`text=${testMessage}`)).toBeVisible({
      timeout: 10000,
    });
  });

  test("should not send empty message", async ({ page }) => {
    const input = page.locator('textarea[placeholder*="Message"]');
    // Count messages before
    const messagesBefore = await page
      .locator('[role="listitem"]')
      .count();

    // Try to send empty message
    await input.press("Enter");

    // Message count should not increase
    await expect(page.locator('[role="listitem"]')).toHaveCount(messagesBefore, {
      timeout: 2000,
    });
  });

  test("should render markdown in messages", async ({ page }) => {
    const boldText = uniqueId("bold");
    const input = page.locator('textarea[placeholder*="Message"]');
    await input.fill(`**${boldText}**`);
    await input.press("Enter");

    // Should render as bold (strong element)
    await expect(page.locator(`strong:has-text("${boldText}")`)).toBeVisible({
      timeout: 10000,
    });
  });
});
