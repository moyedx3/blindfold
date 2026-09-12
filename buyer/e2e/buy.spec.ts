import { test, expect } from '@playwright/test';

test('top up the private balance, then buy with the fake wallet and unlock', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Buy' })).toBeDisabled();       // browsing before connect
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText(/Private balance: 0/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Top up first' })).toBeDisabled();
  await page.getByRole('button', { name: 'Top up 5', exact: true }).click();
  await expect(page.getByText(/Private balance: 5/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Buy' }).click();
  await expect(page.getByText(/Unlocked/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/unlocked with a fake wallet/)).toBeVisible();
  expect(errors).toEqual([]);
});
