import type { Attestation } from "./api";
import { fromHex, sha256 } from "./bytes";
import { verifyQuote, type VerifiedQuote } from "./qvl-verifier";

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export async function validateVerifiedQuote(
  attestation: Attestation,
  verified: VerifiedQuote,
  expectedMeasurement: string,
): Promise<Uint8Array> {
  if (verified.status !== "UpToDate") {
    throw new Error(`attestation: TCB status is ${verified.status || "unknown"}`);
  }
  if (!/^[0-9a-fA-F]{96}$/.test(expectedMeasurement)) {
    throw new Error("attestation: expected RTMR3 measurement must be 48-byte hex");
  }

  const pubkey = fromHex(attestation.provisioning_pubkey_hex);
  if (!sameBytes(verified.rtmr3, fromHex(expectedMeasurement))) {
    throw new Error("attestation: TEE measurement does not match the expected RTMR3");
  }

  const binding = await sha256(pubkey);
  if (!sameBytes(verified.reportData.slice(0, 32), binding)) {
    throw new Error("attestation: quote report_data is not bound to the provisioning key");
  }
  return pubkey;
}

export async function verifyAttestationOrThrow(
  attestation: Attestation,
  expectedMeasurement: string,
): Promise<Uint8Array> {
  if (attestation.quote_hex === "dev") {
    throw new Error("attestation: dev quotes must be handled by the explicit local-dev switch");
  }
  const verified = await verifyQuote(attestation.quote_hex);
  return validateVerifiedQuote(attestation, verified, expectedMeasurement);
}
