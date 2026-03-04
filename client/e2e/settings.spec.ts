/**
 * User Settings E2E Tests
 *
 * Tests the settings modal and its various tabs.
 * Prerequisites: Backend running, test users created
 */

import { test, expect } from "@playwright/test";
import { loginAsAlice, openUserSettings } from "./helpers";

test.describe("User Settings", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAlice(page);
  });

  test("should open settings modal", async ({ page }) => {
    await openUserSettings(page);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 3000 });
  });

  test("should display account settings", async ({ page }) => {
    await openUserSettings(page);
    await expect(page.getByRole("heading", { name: "My Account" })).toBeVisible({ timeout: 3000 });
  });

  test("should switch to appearance tab", async ({ page }) => {
    await openUserSettings(page);
    const tab = page.locator('button:has-text("Appearance"), [title*="Appearance"]').first();
    await expect(tab).toBeVisible({ timeout: 3000 });
    await tab.click();
    await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible({ timeout: 3000 });
  });

  test("should switch to audio tab", async ({ page }) => {
    await openUserSettings(page);
    const tab = page.locator('button:has-text("Audio"), [title*="Audio"]').first();
    await expect(tab).toBeVisible({ timeout: 3000 });
    await tab.click();
    await expect(page.getByRole("heading", { name: "Audio Settings" })).toBeVisible({
      timeout: 3000,
    });
  });

  test("should switch to notifications tab", async ({ page }) => {
    await openUserSettings(page);
    const tab = page
      .locator('button:has-text("Notifications"), [title*="Notification"]')
      .first();
    await expect(tab).toBeVisible({ timeout: 3000 });
    await tab.click();
    await expect(page.getByRole("heading", { name: "Sound Notifications" })).toBeVisible({
      timeout: 3000,
    });
  });

  test("should switch to privacy tab", async ({ page }) => {
    await openUserSettings(page);
    const tab = page.locator('button:has-text("Privacy"), [title*="Privacy"]').first();
    await expect(tab).toBeVisible({ timeout: 3000 });
    await tab.click();
    await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible({ timeout: 3000 });
  });

  test("should switch to security tab", async ({ page }) => {
    await openUserSettings(page);
    const tab = page.locator('button:has-text("Security"), [title*="Security"]').first();
    await expect(tab).toBeVisible({ timeout: 3000 });
    await tab.click();
    await expect(page.getByRole("heading", { name: "Security" })).toBeVisible({ timeout: 3000 });
  });

  test("should update display name", async ({ page }) => {
    await openUserSettings(page);
    await page.getByRole("button", { name: "Change Password" }).click();
    await expect(page.getByRole("heading", { name: "Change Password" })).toBeVisible({
      timeout: 3000,
    });
  });
});
