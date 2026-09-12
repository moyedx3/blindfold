import { expect, test } from "@playwright/test";
import sodium from "libsodium-wrappers";

test("provision flow reaches the provision step and posts a sealed payload", async ({ page }) => {
  await sodium.ready;
  const enclave = sodium.crypto_box_keypair();
  let sealed: Buffer | null = null;

  await page.route("**/mock/contract", (route) => route.fulfill({
    json: { network: "undeployed", contract_address: "ab".repeat(32) },
  }));
  await page.route("**/mock/bucket/*", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/mock/attest", (route) => route.fulfill({
    json: { quote_hex: "dev", provisioning_pubkey_hex: Buffer.from(enclave.publicKey).toString("hex") },
  }));
  await page.route("**/mock/provision", (route) => {
    sealed = route.request().postDataBuffer();
    return route.fulfill({ json: { ok: true, drop_id: 1 } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByLabel(/dev mode/).check();
  await page.getByRole("button", { name: /Encrypt \+ Register \+ Provision/ }).click();
  await expect(page.getByText(/Drop 1 is live/)).toBeVisible({ timeout: 30_000 });

  expect(sealed).not.toBeNull();
  const opened = sodium.crypto_box_seal_open(new Uint8Array(sealed!), enclave.publicKey, enclave.privateKey);
  const payload = JSON.parse(new TextDecoder().decode(opened)) as { drop_id: number; k_drop: string; price_star: string };
  expect(payload.drop_id).toBe(1);
  expect(payload.k_drop).toMatch(/^[0-9a-f]{64}$/);
  expect(payload.price_star).toBe("1000000");
});
