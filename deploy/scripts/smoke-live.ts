import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { verifyAttestation } from "./attestation";

const ContractSchema = z.object({
  network: z.literal("preprod"),
  contract_address: z.string().regex(/^[0-9a-fA-F]{64}$/),
});
const AttestationSchema = z.object({
  quote_hex: z.string().min(2),
  provisioning_pubkey_hex: z.string().regex(/^[0-9a-fA-F]{64}$/),
});
const CatalogSchema = z.array(
  z.object({
    drop_id: z.number().int().nonnegative(),
    price_star: z.string().regex(/^\d+$/),
    title: z.string().max(200),
    h_content: z.string().regex(/^[0-9a-fA-F]{64}$/),
  }),
);

type NetworkConfig = {
  contract_address: string | null;
  indexer_url: string | null;
  measurement_rtmr3: string | null;
  image_digest?: string | null;
};

async function responseText(baseUrl: string, path: string): Promise<string> {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.text();
}

async function responseJson(baseUrl: string, path: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

const repoRoot = resolve(import.meta.dirname, "..", "..");
const networks = JSON.parse(readFileSync(resolve(repoRoot, "deploy", "networks.json"), "utf8")) as {
  preprod: NetworkConfig;
};
const configured = networks.preprod;
const baseUrl = (process.env.BLINDFOLD_INDEXER_URL ?? configured.indexer_url)?.replace(/\/+$/, "");
const expectedContract = (process.env.CONTRACT_ADDRESS ?? configured.contract_address)?.toLowerCase();
const expectedRtmr3 = (process.env.EXPECTED_RTMR3 ?? configured.measurement_rtmr3)?.toLowerCase();
if (!baseUrl || !expectedContract || !expectedRtmr3) {
  throw new Error(
    "set preprod indexer_url, contract_address, and measurement_rtmr3 in deploy/networks.json " +
      "or BLINDFOLD_INDEXER_URL, CONTRACT_ADDRESS, and EXPECTED_RTMR3 in the environment",
  );
}
if (!/^https:\/\//.test(baseUrl)) throw new Error("live indexer URL must use HTTPS");

const health = await responseText(baseUrl, "/health");
if (health.trim() !== "ok") throw new Error(`/health returned unexpected body: ${health.slice(0, 80)}`);
const contract = ContractSchema.parse(await responseJson(baseUrl, "/contract"));
if (contract.contract_address.toLowerCase() !== expectedContract) {
  throw new Error("/contract does not match the pinned Preprod contract address");
}
const catalog = CatalogSchema.parse(await responseJson(baseUrl, "/catalog"));
const attestation = AttestationSchema.parse(await responseJson(baseUrl, "/attest"));
if (attestation.quote_hex === "dev") throw new Error("live smoke refuses a dev attestation quote");

const verified = await verifyAttestation({
  quoteHex: attestation.quote_hex,
  provisioningPubkeyHex: attestation.provisioning_pubkey_hex,
  expectedRtmr3,
  pccsUrl: process.env.PCCS_URL,
});

const evidence = {
  checked_at: new Date().toISOString(),
  network: contract.network,
  indexer_origin: new URL(baseUrl).origin,
  contract_address: contract.contract_address,
  catalog_entries: catalog.length,
  attestation: {
    status: verified.status,
    rtmr3: verified.rtmr3,
    provisioning_pubkey_sha256_prefix: createHash("sha256")
      .update(Buffer.from(attestation.provisioning_pubkey_hex, "hex"))
      .digest("hex")
      .slice(0, 16),
    report_data_binding: "ok",
  },
  image_digest: configured.image_digest ?? null,
};

const evidenceDir = resolve(repoRoot, "deploy", "evidence");
mkdirSync(evidenceDir, { recursive: true });
const evidencePath = resolve(evidenceDir, "smoke-live.json");
const tempPath = `${evidencePath}.tmp-${process.pid}`;
writeFileSync(tempPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
renameSync(tempPath, evidencePath);
console.log(`live smoke passed; redacted evidence: ${evidencePath}`);
