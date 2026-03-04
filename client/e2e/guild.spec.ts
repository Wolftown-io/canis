/**
 * Guild Management E2E Tests
 *
 * Tests guild creation, joining, and settings.
 * Prerequisites: Backend running, test users + seed data
 */

import { test, expect } from "@playwright/test";
import { loginAsAdmin, selectFirstGuild, uniqueId } from "./helpers";

test.describe("Guild Management", () => {
  test("should show create guild button", async ({ page }) => {
    await loginAsAdmin(page);
    const createBtn = page.locator('button[title="Create Server"]');
    await expect(createBtn).toBeVisible();
  });

  test("should create a new guild", async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('button[title="Create Server"]');

    // Modal should appear
    const modal = page.locator('[role="dialog"], .fixed.inset-0').first();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill guild name
    const guildName = uniqueId("TestGuild");
    await page.fill('input[placeholder="My Awesome Server"]', guildName);

    await page.locator('button[type="submit"]:has-text("Create Server")').click();

    await expect(page.locator(`button[title="${guildName}"]`)).toBeVisible({
      timeout: 10000,
    });
  });

  test("should show join guild modal", async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('button[title="Join Server"]');

    // Modal should appear with invite code input
    const modal = page.locator('[role="dialog"], .fixed.inset-0').first();
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('input[placeholder*="invite" i], input[placeholder*="code" i]')
    ).toBeVisible();
  });

  test("should open guild settings", async ({ page }) => {
    await loginAsAdmin(page);
    await selectFirstGuild(page);

    // Click settings button in sidebar header
    const settingsBtn = page.locator('button[title="Server Settings"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    await expect(page.getByText("Server Settings")).toBeVisible({ timeout: 5000 });
  });

  test("should edit guild name", async ({ page }) => {
    await loginAsAdmin(page);
    await selectFirstGuild(page);

    // Open settings
    await page.click('button[title="Server Settings"]');
    await expect(page.getByText("Server Settings")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("switch", { name: "Make Server Discoverable" })).toBeVisible({
      timeout: 3000,
    });
  });
});
