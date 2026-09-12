import { createHash } from "node:crypto";
import * as qvl from "@phala/dcap-qvl";

export type VerifiedAttestation = {
  rtmr3: string;
  reportData: Uint8Array;
  status: string;
  advisories: string[];
};

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export async function verifyAttestation(args: {
  quoteHex: string;
  provisioningPubkeyHex: string;
  expectedRtmr3?: string;
  pccsUrl?: string;
}): Promise<VerifiedAttestation> {
  const quoteHex = args.quoteHex.replace(/^0x/i, "");
  const pubkeyHex = args.provisioningPubkeyHex.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-fA-F]+$/.test(quoteHex) || quoteHex.length % 2 !== 0) {
    throw new Error("quote_hex is not valid even-length hexadecimal");
  }
  if (!/^[0-9a-f]{64}$/.test(pubkeyHex)) {
    throw new Error("provisioning_pubkey_hex must be 32-byte hexadecimal");
  }

  const verified = await qvl.getCollateralAndVerify(Buffer.from(quoteHex, "hex"), args.pccsUrl);
  if (verified.status !== "UpToDate") {
    const advisories = verified.advisory_ids.length ? ` (${verified.advisory_ids.join(", ")})` : "";
    throw new Error(`TDX quote status is ${verified.status}${advisories}`);
  }

  let rtmr3: Uint8Array;
  let reportData: Uint8Array;
  if (verified.report.type === "td10") {
    const report = verified.report.asTd10();
    if (!report) throw new Error("QVL returned an empty TDX 1.0 report");
    rtmr3 = report.rtMr3;
    reportData = report.reportData;
  } else if (verified.report.type === "td15") {
    const report = verified.report.asTd15();
    if (!report) throw new Error("QVL returned an empty TDX 1.5 report");
    rtmr3 = report.base.rtMr3;
    reportData = report.base.reportData;
  } else {
    throw new Error(`expected a TDX quote, received ${verified.report.type}`);
  }

  const pubkeyHash = createHash("sha256").update(Buffer.from(pubkeyHex, "hex")).digest();
  if (!Buffer.from(reportData.subarray(0, 32)).equals(pubkeyHash)) {
    throw new Error("quote report_data is not bound to sha256(provisioning_pubkey)");
  }

  const measurement = toHex(rtmr3);
  if (args.expectedRtmr3) {
    const expected = args.expectedRtmr3.replace(/^0x/i, "").toLowerCase();
    if (!/^[0-9a-f]{96}$/.test(expected)) throw new Error("expected RTMR3 must be 48-byte hexadecimal");
    if (measurement !== expected) throw new Error("verified quote RTMR3 does not match the pinned measurement");
  }

  return {
    rtmr3: measurement,
    reportData: new Uint8Array(reportData),
    status: verified.status,
    advisories: [...verified.advisory_ids],
  };
}
