import { beforeEach, describe, expect, it } from "vitest";
import { sha256, toHex } from "../src/bytes";
import { validateVerifiedQuote } from "../src/attestation";

const measurement = "ab".repeat(48);
const attestation = { quote_hex: "11", provisioning_pubkey_hex: "cd".repeat(32) };

describe("attestation policy", () => {
  beforeEach(() => {
    // Keep the test independent from the browser-only custom verifier hook.
    delete window.blindfoldQuoteVerifier;
  });

  it("requires UpToDate, the pinned RTMR3, and the key binding", async () => {
    const pubkey = new Uint8Array(32).fill(0xcd);
    const digest = await sha256(pubkey);
    const reportData = new Uint8Array(64);
    reportData.set(digest);
    await expect(validateVerifiedQuote(attestation, { status: "UpToDate", reportData, rtmr3: Uint8Array.from(Buffer.from(measurement, "hex")), raw: {} }, measurement)).resolves.toEqual(pubkey);
  });

  it("rejects a measurement mismatch", async () => {
    const reportData = await sha256(new Uint8Array(32).fill(0xcd));
    await expect(validateVerifiedQuote(attestation, { status: "UpToDate", reportData, rtmr3: new Uint8Array(48), raw: {} }, measurement)).rejects.toThrow(/measurement/);
  });

  it("rejects a non-current TCB", async () => {
    await expect(validateVerifiedQuote(attestation, { status: "OutOfDate", reportData: new Uint8Array(32), rtmr3: new Uint8Array(48), raw: {} }, measurement)).rejects.toThrow(/TCB/);
  });
});
