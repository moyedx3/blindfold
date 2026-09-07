import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sealProvision, type ProvisionPayload } from "../../indexer/src/provision";

type RecoveryBundle = {
  version: 1;
  contract_address: string;
  indexer_url: string;
  drop_id: number;
  price_star: string;
  title: string;
  k_drop_hex: string;
  h_content: string;
  content_blob_hex: string;
};

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const repoRoot = resolve(import.meta.dirname, "..", "..");
const bundlePath = resolve(option("--bundle") ?? resolve(repoRoot, ".local", "demo-drop-latest.json"));
const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as RecoveryBundle;
if (bundle.version !== 1) throw new Error("unsupported recovery bundle version");

const indexer = (option("--indexer") ?? bundle.indexer_url).replace(/\/+$/, "");
const contractResponse = await fetch(`${indexer}/contract`, { signal: AbortSignal.timeout(10_000) });
if (!contractResponse.ok) throw new Error(`contract check failed: HTTP ${contractResponse.status}`);
const contract = (await contractResponse.json()) as { contract_address?: string };
if (contract.contract_address !== bundle.contract_address) {
  throw new Error("recovery bundle belongs to a different contract deployment");
}

const contentBlob = Buffer.from(bundle.content_blob_hex, "hex");
const upload = await fetch(`${indexer}/bucket/${bundle.h_content}`, {
  method: "PUT",
  headers: { "content-type": "application/octet-stream" },
  body: contentBlob,
  signal: AbortSignal.timeout(30_000),
});
if (!upload.ok) throw new Error(`content restore failed: HTTP ${upload.status}`);

const attestResponse = await fetch(`${indexer}/attest`, { signal: AbortSignal.timeout(10_000) });
if (!attestResponse.ok) throw new Error(`attestation failed: HTTP ${attestResponse.status}`);
const attest = (await attestResponse.json()) as { quote_hex?: string; provisioning_pubkey_hex?: string };
if (attest.quote_hex !== "dev") throw new Error("demo recovery is local-only and refuses a real TEE");
if (!attest.provisioning_pubkey_hex || !/^[0-9a-fA-F]{64}$/.test(attest.provisioning_pubkey_hex)) {
  throw new Error("attestation response has an invalid provisioning public key");
}

const payload: ProvisionPayload = {
  drop_id: bundle.drop_id,
  price_star: bundle.price_star,
  k_drop: bundle.k_drop_hex,
  h_content: bundle.h_content,
  title: bundle.title,
};
const sealed = sealProvision(payload, Buffer.from(attest.provisioning_pubkey_hex, "hex"));
const response = await fetch(`${indexer}/provision`, {
  method: "POST",
  headers: { "content-type": "application/octet-stream" },
  body: Buffer.from(sealed),
  signal: AbortSignal.timeout(30_000),
});
const body = await response.text();
if (!response.ok) throw new Error(`re-provision failed: HTTP ${response.status} ${body}`);
console.log(`re-provisioned drop ${bundle.drop_id} from ${bundlePath}`);
