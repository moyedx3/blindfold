import { test, expect } from '@playwright/test';

test('buy with the fake wallet and unlock', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText(/Shielded NIGHT:/)).toBeVisible();
  await page.getByRole('button', { name: 'Buy' }).click();
  await expect(page.getByText(/Unlocked/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/unlocked with a fake wallet/)).toBeVisible();
  expect(errors).toEqual([]);
});
