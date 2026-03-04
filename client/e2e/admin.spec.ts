/**
 * Admin Dashboard E2E Tests
 *
 * Tests admin panel access, navigation, and basic functionality.
 * Prerequisites: Backend running, admin user created (admin/admin123)
 */

import { test, expect } from "@playwright/test";
import { loginAsAdmin, loginAsAlice, navigateToAdmin } from "./helpers";

test.describe("Admin Dashboard", () => {
  test("should access admin dashboard", async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToAdmin(page);
  });

  test("should display admin panels", async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToAdmin(page);
    await expect(page.getByRole("button", { name: "Users", exact: true })).toBeVisible({
      timeout: 5000,
    });
  });

  test("should show users panel", async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToAdmin(page);

    const usersBtn = page.getByRole("button", { name: "Users", exact: true });
    await expect(usersBtn).toBeVisible({ timeout: 3000 });
    await usersBtn.click();
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible({
      timeout: 5000,
    });
  });

  test("should show guilds panel", async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToAdmin(page);

    const guildsBtn = page.getByRole("button", { name: "Guilds", exact: true });
    await expect(guildsBtn).toBeVisible({ timeout: 3000 });
    await guildsBtn.click();
    await expect(page.getByRole("heading", { name: "Guilds" })).toBeVisible({
      timeout: 5000,
    });
  });

  test("should show audit log panel", async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToAdmin(page);

    const auditBtn = page.getByRole("button", { name: "Audit Log", exact: true });
    await expect(auditBtn).toBeVisible({ timeout: 3000 });
    await auditBtn.click();
    await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible({
      timeout: 5000,
    });
  });

  test("should block non-admin access", async ({ page }) => {
    await loginAsAlice(page);
    await page.goto("/admin");

    // Non-admin should be redirected away or shown a forbidden message
    await expect(async () => {
      const isOnAdmin = page.url().includes("/admin");
      const hasForbidden = await page
        .locator('text=Forbidden')
        .or(page.locator('text=Access Denied'))
        .or(page.locator('text=not authorized'))
        .isVisible();
      expect(!isOnAdmin || hasForbidden).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });
});
