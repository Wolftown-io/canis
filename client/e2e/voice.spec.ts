/**
 * Voice Channel E2E Tests
 *
 * Tests voice channel join/leave and controls.
 * Prerequisites: Backend running with WebRTC support, test users + seed data
 *
 * All tests are marked fixme: WebRTC requires media device access
 * unavailable in headless Chromium. Run with --headed to execute.
 */

import { test, expect } from "@playwright/test";
import { loginAsAdmin, selectFirstGuild } from "./helpers";

test.describe("Voice", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await selectFirstGuild(page);
  });

  test.fixme("should join voice channel", async ({ page }) => {
    const voiceChannel = page.locator(
      'aside [role="button"]:has-text("Voice"), aside [role="button"]:has-text("voice")'
    ).first();
    await expect(voiceChannel).toBeVisible({ timeout: 5000 });
    await voiceChannel.click();

    const disconnectBtn = page.locator('button[title="Disconnect"]');
    await expect(disconnectBtn).toBeVisible({ timeout: 10000 });
  });

  test.fixme("should show voice controls", async ({ page }) => {
    const voiceChannel = page.locator(
      'aside [role="button"]:has-text("Voice"), aside [role="button"]:has-text("voice")'
    ).first();
    await expect(voiceChannel).toBeVisible({ timeout: 5000 });
    await voiceChannel.click();

    const muteBtn = page.locator('button[title*="Mute" i]');
    const deafenBtn = page.locator('button[title*="Deafen" i]');
    await expect(muteBtn).toBeVisible({ timeout: 10000 });
    await expect(deafenBtn).toBeVisible();
  });

  test.fixme("should toggle mute", async ({ page }) => {
    const voiceChannel = page.locator(
      'aside [role="button"]:has-text("Voice"), aside [role="button"]:has-text("voice")'
    ).first();
    await expect(voiceChannel).toBeVisible({ timeout: 5000 });
    await voiceChannel.click();

    const muteBtn = page.locator('button[title*="Mute" i]');
    await expect(muteBtn).toBeVisible({ timeout: 10000 });
    await muteBtn.click();
    // After toggling, button should still be visible (muted state)
    await expect(muteBtn).toBeVisible();
    await muteBtn.click();
    await expect(muteBtn).toBeVisible();
  });

  test.fixme("should disconnect from voice", async ({ page }) => {
    const voiceChannel = page.locator(
      'aside [role="button"]:has-text("Voice"), aside [role="button"]:has-text("voice")'
    ).first();
    await expect(voiceChannel).toBeVisible({ timeout: 5000 });
    await voiceChannel.click();

    const disconnectBtn = page.locator('button[title="Disconnect"]');
    await expect(disconnectBtn).toBeVisible({ timeout: 10000 });
    await disconnectBtn.click();
    await expect(disconnectBtn).toBeHidden({ timeout: 5000 });
  });
});
