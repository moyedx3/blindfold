// @vitest-environment node
//
// Forced to the node environment: jsdom's global realm gives `Uint8Array` a different
// identity than the one Node's `TextEncoder`/webcrypto return, so a jsdom-run `toEqual`
// on the round-tripped bytes fails even though the bytes are identical. This crypto-only
// module needs no DOM, so node avoids the cross-realm mismatch entirely.
import { describe, expect, it } from "vitest";
import { utf8Bytes } from "../src/bytes";
import { decryptContent, encryptContent } from "../src/content";

describe("content blob (I4) AES-256-GCM", () => {
  it("encrypt → decrypt round-trips with layout nonce(12) || ct || tag(16)", async () => {
    const plaintext = utf8Bytes("unlockable drop content");
    const enc = await encryptContent(plaintext);
    expect(enc.kDrop.length).toBe(32);
    expect(enc.blob.length).toBe(12 + plaintext.length + 16);
    const out = await decryptContent(enc.blob, enc.kDrop);
    expect(out).toEqual(plaintext);
  });

  it("wrong K_drop fails GCM authentication", async () => {
    const enc = await encryptContent(utf8Bytes("x"));
    const wrong = crypto.getRandomValues(new Uint8Array(32));
    await expect(decryptContent(enc.blob, wrong)).rejects.toBeTruthy();
  });
});
