import { expect, test } from "@playwright/test";

test("cash out the private balance to public NIGHT", async ({ page }) => {
  await page.route("**/mock/contract", (route) => route.fulfill({ json: { network: "undeployed", contract_address: "ab".repeat(32) } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText(/Private balance: 3/)).toBeVisible();
  await page.getByRole("button", { name: /Cash out to public NIGHT/ }).click();
  await expect(page.getByText(/Cashed out 3 NIGHT/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Private balance: 0/)).toBeVisible();
});
