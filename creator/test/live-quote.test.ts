import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateVerifiedQuote } from "../src/attestation";
import { verifyQuote } from "../src/qvl-verifier";

type Fixture = { quote_hex: string; provisioning_pubkey_hex: string; rtmr3: string };
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "test", "fixtures", "phala-attest-2026-09-12.json"), "utf8"),
) as Fixture;

// A real TDX 1.5 quote captured from the Phala CVM. Verification fetches Intel
// collateral over the network and the TCB verdict can change when Intel publishes
// advisories, so this runs only on request: LIVE_QVL=1 npx vitest run test/live-quote.test.ts
describe.skipIf(!process.env.LIVE_QVL)("real Phala TDX quote (2026-09-12)", () => {
  it("passes the browser verifier and binds to the pinned RTMR3 and provisioning key", async () => {
    const verified = await verifyQuote(fixture.quote_hex);
    expect(verified.status).toBe("UpToDate");
    expect(Buffer.from(verified.rtmr3).toString("hex")).toBe(fixture.rtmr3);
    const pubkey = await validateVerifiedQuote(
      { quote_hex: fixture.quote_hex, provisioning_pubkey_hex: fixture.provisioning_pubkey_hex },
      verified,
      fixture.rtmr3,
    );
    expect(Buffer.from(pubkey).toString("hex")).toBe(fixture.provisioning_pubkey_hex);
  });
});
