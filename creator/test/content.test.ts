// @vitest-environment node
// Web Crypto and TextEncoder values must share Node's Uint8Array realm.
import { expect, it } from "vitest";
import { decryptContent, encryptContent, parseSha256Hex } from "../src/content";

it("encrypts and decrypts the I4 content blob", async () => {
  const plaintext = new TextEncoder().encode("hello creator");
  const encrypted = await encryptContent(plaintext);
  expect(encrypted.blob.length).toBeGreaterThan(28);
  expect(parseSha256Hex(encrypted.hContent)).toHaveLength(32);
  expect(await decryptContent(encrypted.blob, encrypted.kDrop)).toEqual(plaintext);
});
