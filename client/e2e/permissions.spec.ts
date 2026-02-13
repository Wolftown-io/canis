/**
 * Permission System E2E Tests
 *
 * Tests the Permission System UI workflows:
 * 1. Role Management - Owner can create/edit roles
 * 2. Security Constraints - @everyone cannot have dangerous permissions
 * 3. Member Role Assignment - Assign roles to members via UI
 * 4. Channel Permission Overrides - Set Allow/Deny overrides per channel
 *
 * Prerequisites: Backend running with seed data (admin, alice, bob)
 */

import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers";

// Helper: Open Guild Settings Modal
async function openGuildSettings(page: import("@playwright/test").Page) {
  await page.click('[data-testid="guild-header"]');
  await page.click('[data-testid="settings-trigger"]');
  await expect(page.getByText("Server Settings")).toBeVisible({ timeout: 5000 });
}

// Helper: Navigate to a specific tab in guild settings
async function navigateToTab(page: import("@playwright/test").Page, tabName: "Invites" | "Members" | "Roles") {
  await page.click(`button:has-text("${tabName}")`);
}

// Helper: Open channel settings via context menu
async function openChannelSettings(page: import("@playwright/test").Page, channelName: string) {
  const channel = page.locator(`[data-testid="channel-item"]:has-text("${channelName}")`);
  await channel.click({ button: "right" });
  await page.click('text=Edit Channel');
  await expect(page.getByText("Channel Settings")).toBeVisible({ timeout: 5000 });
}

test.describe("Permission System", () => {
  test.describe("Role Management (Owner Flow)", () => {
    test("should create a new role with permissions", async ({ page }) => {
      await loginAsAdmin(page);

      await openGuildSettings(page);
      await navigateToTab(page, "Roles");

      await page.click('button:has-text("New Role")');
      await page.fill('input[placeholder="Enter role name..."]', "E2E Test Officer");

      const colorButtons = page.locator('button[title="No color"]').locator("..").locator("button");
      await colorButtons.nth(1).click();

      await page.click('text=Manage Messages');
      await page.click('text=Kick Members');
      await page.click('button:has-text("Create Role")');

      await expect(page.getByText("E2E Test Officer")).toBeVisible({ timeout: 5000 });
      await expect(page.getByText("2 permissions")).toBeVisible();
    });

    test("should edit an existing role", async ({ page }) => {
      await loginAsAdmin(page);

      await openGuildSettings(page);
      await navigateToTab(page, "Roles");
      await expect(page.getByText("Roles")).toBeVisible();

      const roleRow = page.locator('div:has-text("E2E Test Officer")').first();
      await roleRow.hover();
      await roleRow.locator('button[title="Edit role"]').click();

      await expect(page.getByText("Edit Role:")).toBeVisible();

      const timeoutCheckbox = page.locator('label:has-text("Timeout Members") input[type="checkbox"]');
      await timeoutCheckbox.click();

      await page.click('button:has-text("Save Changes")');

      await expect(page.getByText("E2E Test Officer")).toBeVisible();
      await expect(page.getByText("3 permissions")).toBeVisible();
    });
  });

  test.describe("@everyone Security Constraints", () => {
    test("should not display dangerous permissions for @everyone role", async ({ page }) => {
      await loginAsAdmin(page);

      await openGuildSettings(page);
      await navigateToTab(page, "Roles");

      const everyoneRow = page.locator('div:has-text("@everyone")').first();
      await everyoneRow.hover();
      await everyoneRow.locator('button[title="Edit role"]').click();

      await expect(page.getByText("Edit Role: @everyone")).toBeVisible();

      await expect(page.locator('label:has-text("Ban Members")')).toBeHidden();
      await expect(page.locator('label:has-text("Manage Server")')).toBeHidden();
      await expect(page.locator('label:has-text("Manage Roles")')).toBeHidden();
      await expect(page.locator('label:has-text("Kick Members")')).toBeHidden();
      await expect(page.locator('label:has-text("Manage Messages")')).toBeHidden();

      await expect(page.locator('label:has-text("Send Messages")')).toBeVisible();
      await expect(page.locator('label:has-text("Embed Links")')).toBeVisible();
      await expect(page.locator('label:has-text("Create Invite")')).toBeVisible();
    });

    test("should allow modifying safe permissions for @everyone", async ({ page }) => {
      await loginAsAdmin(page);

      await openGuildSettings(page);
      await navigateToTab(page, "Roles");

      const everyoneRow = page.locator('div:has-text("@everyone")').first();
      await everyoneRow.hover();
      await everyoneRow.locator('button[title="Edit role"]').click();

      const reactionsCheckbox = page.locator('label:has-text("Add Reactions") input[type="checkbox"]');
      const wasChecked = await reactionsCheckbox.isChecked();
      await reactionsCheckbox.click();

      await page.click('button:has-text("Save Changes")');

      await everyoneRow.hover();
      await everyoneRow.locator('button[title="Edit role"]').click();

      const newChecked = await page.locator('label:has-text("Add Reactions") input[type="checkbox"]').isChecked();
      expect(newChecked).not.toBe(wasChecked);

      // Revert for test idempotency
      await page.locator('label:has-text("Add Reactions") input[type="checkbox"]').click();
      await page.click('button:has-text("Save Changes")');
    });
  });

  test.describe("Member Role Assignment", () => {
    test("should assign a role to a member via the UI", async ({ page }) => {
      await loginAsAdmin(page);

      await openGuildSettings(page);
      await navigateToTab(page, "Members");

      await expect(page.getByText("members")).toBeVisible({ timeout: 5000 });

      const aliceRow = page.locator('div:has-text("alice")').first();
      await aliceRow.locator('button:has-text("Manage")').click();

      await expect(page.getByText("Assign Role")).toBeVisible();

      const roleCheckbox = page.locator('label:has-text("E2E Test Officer") input[type="checkbox"]');
      const wasAssigned = await roleCheckbox.isChecked();

      if (!wasAssigned) {
        await roleCheckbox.click();
        await expect(aliceRow.locator('span:has-text("E2E Test Officer")')).toBeVisible({ timeout: 3000 });
      } else {
        await roleCheckbox.click();
        await expect(aliceRow.locator('span:has-text("E2E Test Officer")')).toBeHidden({ timeout: 3000 });
      }
    });

    test("should show role badges on members", async ({ page }) => {
      await loginAsAdmin(page);

      await openGuildSettings(page);
      await navigateToTab(page, "Members");

      const aliceRow = page.locator('div:has-text("alice")').first();

      const hasRoles = await aliceRow.locator("span").filter({ hasText: /(no roles)/ }).count();
      const hasBadges = await aliceRow.locator('span[style*="background-color"]').count();

      expect(hasRoles > 0 || hasBadges > 0).toBe(true);
    });
  });

  test.describe("Channel Permission Overrides", () => {
    test("should add a role override to a channel", async ({ page }) => {
      await loginAsAdmin(page);

      await expect(page.locator('[data-testid="channel-item"]').first()).toBeVisible({ timeout: 10000 });

      const firstChannel = page.locator('[data-testid="channel-item"]').first();
      await firstChannel.click({ button: "right" });
      await page.click('text=Edit Channel');

      await expect(page.getByText("Channel Settings")).toBeVisible({ timeout: 5000 });
      await page.click('button:has-text("Permissions")');

      await page.click('button:has-text("Add Role")');

      const roleOption = page.locator('button:has-text("@everyone")');
      if (await roleOption.isVisible()) {
        await roleOption.click();
      } else {
        const anyRole = page.locator('[style*="background-color: var(--color-surface-layer2)"] button').first();
        await anyRole.click();
      }

      await expect(page.getByText("permissions")).toBeVisible({ timeout: 5000 });

      const sendMessagesRow = page.locator('div:has-text("Send Messages")').first();
      await sendMessagesRow.locator('label:has-text("Deny") input[type="radio"]').click();

      await page.click('button:has-text("Save")');

      await expect(page.locator('text=-1 denied')).toBeVisible({ timeout: 3000 });
    });

    test("should set Allow/Deny/Inherit for channel permissions", async ({ page }) => {
      await loginAsAdmin(page);

      await expect(page.locator('[data-testid="channel-item"]').first()).toBeVisible({ timeout: 10000 });

      const firstChannel = page.locator('[data-testid="channel-item"]').first();
      await firstChannel.click({ button: "right" });
      await page.click('text=Edit Channel');

      await page.click('button:has-text("Permissions")');

      const editButton = page.locator('button:has([class*="Settings"])').first();

      if (await editButton.isVisible()) {
        await editButton.click();
      } else {
        await page.click('button:has-text("Add Role")');
        const everyoneOption = page.locator('button:has-text("@everyone")');
        if (await everyoneOption.isVisible()) {
          await everyoneOption.click();
        }
      }

      const embedLinksRow = page.locator('div:has-text("Embed Links")').first();

      await embedLinksRow.locator('label:has-text("Allow") input[type="radio"]').click();
      expect(await embedLinksRow.locator('label:has-text("Allow") input[type="radio"]').isChecked()).toBe(true);

      await embedLinksRow.locator('label:has-text("Inherit") input[type="radio"]').click();
      expect(await embedLinksRow.locator('label:has-text("Inherit") input[type="radio"]').isChecked()).toBe(true);

      await embedLinksRow.locator('label:has-text("Deny") input[type="radio"]').click();
      expect(await embedLinksRow.locator('label:has-text("Deny") input[type="radio"]').isChecked()).toBe(true);

      await page.click('button:has-text("Save")');
    });

    test("should delete a channel override", async ({ page }) => {
      await loginAsAdmin(page);

      await expect(page.locator('[data-testid="channel-item"]').first()).toBeVisible({ timeout: 10000 });

      const firstChannel = page.locator('[data-testid="channel-item"]').first();
      await firstChannel.click({ button: "right" });
      await page.click('text=Edit Channel');

      await page.click('button:has-text("Permissions")');

      const deleteButton = page.locator('button:has([class*="Trash2"])').first();

      if (await deleteButton.isVisible()) {
        const overrideCountBefore = await page.locator('[style*="background-color: var(--color-surface-layer1)"]').count();

        await deleteButton.click();

        // Verify override was removed
        await expect(async () => {
          const overrideCountAfter = await page.locator('[style*="background-color: var(--color-surface-layer1)"]').count();
          const noOverridesMessage = page.locator('text=No permission overrides');
          expect(overrideCountAfter < overrideCountBefore || await noOverridesMessage.isVisible()).toBe(true);
        }).toPass({ timeout: 3000 });
      }
    });
  });
});
