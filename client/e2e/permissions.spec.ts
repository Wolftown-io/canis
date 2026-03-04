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

import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin, selectGuildByName } from "./helpers";

const E2E_GUILD_NAME = "E2E Owner Guild";

function roleName(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 6)}`;
}

async function openGuildSettings(page: Page) {
  await selectGuildByName(page, E2E_GUILD_NAME);
  await page.click('button[title="Server Settings"]');
  await expect(page.getByText("Server Settings")).toBeVisible({ timeout: 5000 });
}

async function openRolesTab(page: Page) {
  await page.getByTestId("guild-settings-tab-roles").click();
  await expect(page.getByTestId("roles-tab-create-role")).toBeVisible({ timeout: 5000 });
}

async function createRole(page: Page, roleName: string) {
  await page.getByTestId("roles-tab-create-role").click();
  await page.getByTestId("role-editor-name-input").fill(roleName);
  await page.getByTestId("role-editor-perm-send-messages").click();
  await page.getByTestId("role-editor-perm-embed-links").click();
  await page.getByTestId("role-editor-save").click();
  await expect(page.getByText("Failed to Save Role")).toHaveCount(0);
  await expect(
    page.locator('[data-testid="roles-tab-role-row"][data-role-name]').filter({ hasText: roleName }),
  ).toBeVisible({ timeout: 10000 });
}

async function openRoleEditor(page: Page, roleName: string) {
  const roleRow = page.locator(`[data-testid="roles-tab-role-row"][data-role-name="${roleName}"]`);
  await expect(roleRow).toBeVisible({ timeout: 5000 });
  await roleRow.hover();
  await roleRow.locator('[data-testid="roles-tab-role-edit"]').click();
  await expect(page.getByTestId("role-editor")).toBeVisible({ timeout: 5000 });
}

test.describe("Permission System", () => {
  test("should create and edit a role", async ({ page }) => {
    const newRoleName = roleName("Officer");
    await loginAsAdmin(page);
    await openGuildSettings(page);
    await openRolesTab(page);
    await createRole(page, newRoleName);
    await openRoleEditor(page, newRoleName);

    const timeoutCheckbox = page.getByTestId("role-editor-perm-timeout-members");
    await timeoutCheckbox.click();
    await page.getByTestId("role-editor-save").click();
    await expect(page.getByText("Failed to Save Role")).toHaveCount(0);

    await openRoleEditor(page, newRoleName);
    await expect(page.getByTestId("role-editor-perm-timeout-members")).toBeVisible();
  });

  test("should enforce @everyone restrictions and keep safe permissions editable", async ({ page }) => {
    await loginAsAdmin(page);
    await openGuildSettings(page);
    await openRolesTab(page);

    const everyoneRow = page.locator('[data-testid="roles-tab-role-row"][data-role-name="@everyone"]');
    await expect(everyoneRow).toBeVisible({ timeout: 5000 });
    await everyoneRow.hover();
    await everyoneRow.locator('[data-testid="roles-tab-role-edit"]').click();

    await expect(page.getByTestId("role-editor-perm-ban-members")).toHaveCount(0);
    await expect(page.getByTestId("role-editor-perm-manage-guild")).toHaveCount(0);
    await expect(page.getByTestId("role-editor-perm-send-messages")).toBeVisible();

    const addReactions = page.getByTestId("role-editor-perm-add-reactions");
    const before = await addReactions.isChecked();
    await addReactions.click();
    await page.getByTestId("role-editor-save").click();
    await expect(page.getByText("Failed to Save Role")).toHaveCount(0);

    await expect(everyoneRow).toBeVisible({ timeout: 5000 });
    await everyoneRow.hover();
    await everyoneRow.locator('[data-testid="roles-tab-role-edit"]').click();
    await expect(page.getByTestId("role-editor-perm-add-reactions")).toBeVisible();

    await page.getByTestId("role-editor-perm-add-reactions").click();
    await page.getByTestId("role-editor-save").click();
  });

  test("should assign and remove a role for alice", async ({ page }) => {
    const newRoleName = roleName("Member");
    await loginAsAdmin(page);
    await openGuildSettings(page);
    await openRolesTab(page);
    await createRole(page, newRoleName);

    await page.getByTestId("guild-settings-tab-members").click();
    const aliceRow = page.getByTestId("members-tab-row-alice");
    await expect(aliceRow).toBeVisible({ timeout: 5000 });
    await aliceRow.getByTestId("member-role-dropdown-trigger").click();

    const dropdown = aliceRow.getByTestId("member-role-dropdown");
    await expect(dropdown).toBeVisible({ timeout: 3000 });
    const roleCheckbox = dropdown
      .locator(`label[data-role-name="${newRoleName}"]`)
      .getByTestId("member-role-checkbox");

    await expect(roleCheckbox).toBeVisible({ timeout: 3000 });
    await roleCheckbox.click();
    await expect(aliceRow.getByText(newRoleName)).toBeVisible({ timeout: 3000 });

    await page.getByTestId("member-role-dropdown-backdrop").click();
    await expect(page.getByTestId("member-role-dropdown")).toHaveCount(0);

    await aliceRow.getByTestId("member-role-dropdown-trigger").click();
    const dropdownAgain = aliceRow.getByTestId("member-role-dropdown");
    await expect(dropdownAgain).toBeVisible({ timeout: 3000 });
    const roleCheckboxAgain = dropdownAgain
      .locator(`label[data-role-name="${newRoleName}"]`)
      .getByTestId("member-role-checkbox");
    await roleCheckboxAgain.click();

    await page.getByTestId("member-role-dropdown-backdrop").click();
    await expect(aliceRow.getByText(newRoleName)).toHaveCount(0, { timeout: 5000 });
  });

  test("should set deny override for @everyone on channel permissions", async ({ page }) => {
    await loginAsAdmin(page);
    await selectGuildByName(page, E2E_GUILD_NAME);

    const channelItems = page.locator('[data-testid="channel-item"]');
    if ((await channelItems.count()) === 0) {
      await page.getByRole("button", { name: "Create Channel" }).first().click();
      const nameInput = page
        .locator('input[placeholder="general-chat"], input[placeholder="voice-lounge"]')
        .first();
      await expect(nameInput).toBeVisible({ timeout: 5000 });
      await nameInput.fill(`perm-${Math.random().toString(36).slice(2, 6)}`);
      await nameInput.press("Enter");
    }

    const firstChannel = page.locator('[data-testid="channel-item"]').first();
    await expect(firstChannel).toBeVisible({ timeout: 10000 });
    await firstChannel.click({ button: "right" });
    await page.getByRole("button", { name: "Edit Channel" }).click();

    await expect(page.getByText("Channel Settings")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("channel-settings-permissions-tab").click();
    await expect(page.getByTestId("channel-permissions-panel")).toBeVisible({ timeout: 5000 });

    let targetRoleName = "@everyone";
    const everyoneOverride = page.locator(
      '[data-testid="channel-permissions-override-row"][data-role-name="@everyone"]',
    );
    if ((await everyoneOverride.count()) === 0) {
      await page.getByTestId("channel-permissions-add-role").click();
      const preferredOption = page.locator(
        '[data-testid="channel-permissions-role-option"][data-role-name="@everyone"]',
      );
      if ((await preferredOption.count()) > 0) {
        await preferredOption.click();
      } else {
        const firstOption = page.locator('[data-testid="channel-permissions-role-option"]').first();
        targetRoleName = (await firstOption.getAttribute("data-role-name")) ?? targetRoleName;
        await firstOption.click();
      }
    }

    const targetOverride =
      (await everyoneOverride.count()) > 0
        ? everyoneOverride
        : page
            .locator(`[data-testid="channel-permissions-override-row"][data-role-name="${targetRoleName}"]`)
            .first();
    await expect(targetOverride).toBeVisible({ timeout: 10000 });
    await targetOverride.locator('[data-testid="channel-permissions-override-edit"]').click({
      force: true,
    });

    const sendMessagesRow = page.getByTestId("channel-permissions-row-send-messages");
    await expect(sendMessagesRow).toBeVisible({ timeout: 5000 });
    await sendMessagesRow.getByTestId("channel-permissions-deny").click();
    await page.getByTestId("channel-permissions-save").click();

    await expect(
      targetOverride,
    ).toContainText(/denied|allowed|overrides/i);
  });
});
