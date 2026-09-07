import { verifyAttestation } from "./attestation";

const baseUrl = process.argv[2]?.replace(/\/+$/, "");
if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
  throw new Error("usage: npm run attest:inspect -- https://<cvm-endpoint>");
}

const response = await fetch(`${baseUrl}/attest`, { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`/attest returned HTTP ${response.status}`);
const body = (await response.json()) as { quote_hex?: unknown; provisioning_pubkey_hex?: unknown };
if (typeof body.quote_hex !== "string" || body.quote_hex === "dev") {
  throw new Error("endpoint did not return a real TDX quote");
}
if (typeof body.provisioning_pubkey_hex !== "string") {
  throw new Error("endpoint did not return a provisioning public key");
}

const verified = await verifyAttestation({
  quoteHex: body.quote_hex,
  provisioningPubkeyHex: body.provisioning_pubkey_hex,
  pccsUrl: process.env.PCCS_URL,
});
console.log(`verified TDX quote: ${verified.status}`);
console.log(`RTMR3=${verified.rtmr3}`);
console.log("report_data binding: sha256(provisioning_pubkey) ok");
