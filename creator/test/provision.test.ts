// @vitest-environment node
// libsodium rejects Uint8Array values created by jsdom's separate realm.
import { describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers";
import { buildProvisionPayload, sealProvisionPayload } from "../src/provision";

describe("provision payload", () => {
  it("builds the I5 JSON with hex key and decimal price", () => {
    const payload = buildProvisionPayload({
      dropId: 3,
      priceStar: 1_500_000n,
      kDrop: new Uint8Array(32).fill(0xab),
      hContent: "cd".repeat(32),
      title: "cat",
    });
    expect(payload).toEqual({
      drop_id: 3,
      price_star: "1500000",
      k_drop: "ab".repeat(32),
      h_content: "cd".repeat(32),
      title: "cat",
    });
  });

  it("rejects a non-32-byte key and a bad hash", () => {
    expect(() => buildProvisionPayload({ dropId: 1, priceStar: 1n, kDrop: new Uint8Array(31), hContent: "cd".repeat(32), title: "t" })).toThrow(/32 bytes/);
    expect(() => buildProvisionPayload({ dropId: 1, priceStar: 1n, kDrop: new Uint8Array(32), hContent: "zz", title: "t" })).toThrow(/sha256/);
  });

  it("seals to the enclave key so only that key opens it", async () => {
    await sodium.ready;
    const enclave = sodium.crypto_box_keypair();
    const payload = buildProvisionPayload({ dropId: 1, priceStar: 1n, kDrop: new Uint8Array(32), hContent: "cd".repeat(32), title: "t" });
    const sealed = await sealProvisionPayload(payload, enclave.publicKey);
    const opened = sodium.crypto_box_seal_open(sealed, enclave.publicKey, enclave.privateKey);
    expect(JSON.parse(new TextDecoder().decode(opened))).toEqual(payload);
  });
});
