import { test, expect } from '@playwright/test';

test('login and send message flow', async ({ page }) => {
  // 1. Login
  await page.goto('/login');
  await page.fill('input[type="text"]', 'alice');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');

  // 2. Verify Dashboard
  await expect(page.locator('aside')).toBeVisible(); // Sidebar should be visible
  
  // 3. Select Channel (assuming default channel exists or created)
  // Note: In a real test, we'd mock the backend or seed data. 
  // For now, we assume the user lands on a default channel or clicks one.
  // Let's assume the first channel in the list is clickable.
  const firstChannel = page.locator('[data-testid="channel-item"]').first();
  if (await firstChannel.count() > 0) {
      await firstChannel.click();
  }

  // 4. Send Message
  const testMessage = `E2E Test Message ${Date.now()}`;
  await page.fill('input[placeholder*="Message #"]', testMessage);
  await page.press('input[placeholder*="Message #"]', 'Enter');

  // 5. Verify Message appears
  await expect(page.getByText(testMessage)).toBeVisible();
});
