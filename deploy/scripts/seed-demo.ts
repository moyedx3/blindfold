import { createHash, randomBytes, webcrypto } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { WebSocket } from "ws";

// midnight-js expects a WebSocket implementation in Node.
// @ts-expect-error Node's WebSocket global is intentionally replaced.
globalThis.WebSocket = WebSocket;

import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { resolveNetwork, getDeployment, getOrCreateWallet } from "../../contract/scripts/lib/network";
import { createWallet, persistWalletState } from "../../contract/scripts/lib/wallet";
import {
  buildProviders,
  loadCompiledContract,
  loadContractModule,
} from "../../contract/scripts/lib/providers";
import { sealProvision, type ProvisionPayload } from "../../indexer/src/provision";

type Options = {
  indexer: string;
  file?: string;
  title: string;
  priceNight: string;
  bundleOut?: string;
};

type RecoveryBundle = {
  version: 1;
  network: string;
  contract_address: string;
  indexer_url: string;
  drop_id: number;
  price_star: string;
  title: string;
  creator_secret_hex: string;
  k_drop_hex: string;
  h_content: string;
  content_blob_hex: string;
};

function parseArgs(argv: string[]): Options {
  const out: Options = {
    indexer: "http://127.0.0.1:8080",
    title: "Blindfold demo drop",
    priceNight: "1",
  };
  const values = new Set(["--indexer", "--file", "--title", "--price-night", "--bundle-out"]);
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!values.has(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`);
    i += 1;
    if (key === "--indexer") out.indexer = value;
    if (key === "--file") out.file = value;
    if (key === "--title") out.title = value;
    if (key === "--price-night") out.priceNight = value;
    if (key === "--bundle-out") out.bundleOut = value;
  }
  out.indexer = out.indexer.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(out.indexer)) throw new Error("--indexer must be an http(s) URL");
  if (!out.title.trim() || out.title.trim().length > 200) throw new Error("title must be 1-200 characters");
  return out;
}

function priceNightToStar(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) {
    throw new Error("--price-night must be positive with at most 6 decimals");
  }
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  if (result <= 0n) throw new Error("--price-night must be positive");
  return result;
}

function saveRecoveryBundle(path: string, bundle: RecoveryBundle): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const temp = `${absolute}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, absolute);
}

async function checkedFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
}

const opts = parseArgs(process.argv.slice(2));
const repoRoot = resolve(import.meta.dirname, "..", "..");
const contractDir = resolve(repoRoot, "contract");
// Pin the network explicitly: the state file's active network follows the last public-network
// wallet that was prepared, and this seeder must never touch a public network.
const { network, config } = resolveNetwork({ cwd: contractDir, argv: ["node", "seed-demo", "--network", "undeployed"] });
if (network !== "undeployed") {
  throw new Error("seed-demo is local-only; use the creator app for public networks");
}
const deployment = getDeployment(network, { cwd: contractDir });
if (!deployment) throw new Error("no local deployment recorded; run npm run demo:local first");

const priceStar = priceNightToStar(opts.priceNight);
const plaintext = opts.file
  ? new Uint8Array(readFileSync(resolve(opts.file)))
  : new TextEncoder().encode(
      "Hello from Blindfold. You paid with shielded NIGHT and nobody in the middle learned who bought.",
    );
if (plaintext.length === 0) throw new Error("demo content must not be empty");

const kDrop = randomBytes(32);
const nonce = randomBytes(12);
const aesKey = await webcrypto.subtle.importKey("raw", kDrop, "AES-GCM", false, ["encrypt"]);
const ciphertext = new Uint8Array(
  await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext),
);
const contentBlob = Buffer.concat([nonce, ciphertext]);
const hContent = createHash("sha256").update(contentBlob).digest("hex");
const commitment = createHash("sha256")
  .update(Buffer.concat([kDrop, Buffer.from(hContent, "hex")]))
  .digest();
const configuredSecret = process.env.CREATOR_SECRET_HEX;
if (configuredSecret && !/^[0-9a-fA-F]{64}$/.test(configuredSecret)) {
  throw new Error("CREATOR_SECRET_HEX must be exactly 64 hexadecimal characters");
}
const creatorSecret = configuredSecret
  ? Buffer.from(configuredSecret, "hex")
  : randomBytes(32);

const credentials = getOrCreateWallet(network, { cwd: contractDir });
const wallet = await createWallet({
  network,
  networkConfig: config,
  seed: credentials.seed,
  cwd: contractDir,
});

try {
  await wallet.wallet.waitForSyncedState();
  await persistWalletState(network, wallet, contractDir);
  const providers = buildProviders(wallet, config, `blindfold-demo-${deployment.address.slice(0, 8)}`);
  const contractModule = await loadContractModule();
  const compiledContract = await loadCompiledContract();
  const state = await providers.publicDataProvider.queryContractState(deployment.address);
  if (!state) throw new Error(`contract ${deployment.address} was not found by the Midnight indexer`);
  const view = contractModule.ledger(state.data);

  let nextDropId = 1n;
  for (const [dropId] of view.drops as Iterable<[bigint, bigint]>) {
    if (dropId >= nextDropId) nextDropId = dropId + 1n;
  }
  if (nextDropId > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("next drop id exceeds JavaScript safe integer range");
  const dropId = Number(nextDropId);
  const bundlePath = opts.bundleOut ?? resolve(repoRoot, ".local", `demo-drop-${deployment.address}.json`);

  // Persist recovery material before the transaction so a successful createDrop
  // can always be re-provisioned after an indexer restart.
  saveRecoveryBundle(bundlePath, {
    version: 1,
    network,
    contract_address: deployment.address,
    indexer_url: opts.indexer,
    drop_id: dropId,
    price_star: priceStar.toString(),
    title: opts.title.trim(),
    creator_secret_hex: creatorSecret.toString("hex"),
    k_drop_hex: kDrop.toString("hex"),
    h_content: hContent,
    content_blob_hex: contentBlob.toString("hex"),
  });

  const contentUpload = await checkedFetch(`${opts.indexer}/bucket/${hContent}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: contentBlob,
  });
  if (!contentUpload.ok) throw new Error(`content upload failed: HTTP ${contentUpload.status}`);

  const connected = (await findDeployedContract(providers, {
    compiledContract,
    contractAddress: deployment.address,
    privateStateId: `demo-creator-${deployment.address}-${dropId}`,
    initialPrivateState: { secret: new Uint8Array(creatorSecret) },
  })) as any;
  const tx = await connected.callTx.createDrop(nextDropId, priceStar, new Uint8Array(commitment));
  console.log(`createDrop(${dropId}) tx ${tx.public.txId}`);

  const attestationResponse = await checkedFetch(`${opts.indexer}/attest`);
  if (!attestationResponse.ok) throw new Error(`attestation failed: HTTP ${attestationResponse.status}`);
  const attestation = (await attestationResponse.json()) as Record<string, unknown>;
  if (attestation.quote_hex !== "dev") {
    throw new Error("seed-demo refuses non-dev attestation; use the creator app for a real TEE");
  }
  if (
    typeof attestation.provisioning_pubkey_hex !== "string" ||
    !/^[0-9a-fA-F]{64}$/.test(attestation.provisioning_pubkey_hex)
  ) {
    throw new Error("attestation response has an invalid provisioning public key");
  }

  const payload: ProvisionPayload = {
    drop_id: dropId,
    price_star: priceStar.toString(),
    k_drop: kDrop.toString("hex"),
    h_content: hContent,
    title: opts.title.trim(),
  };
  const sealed = sealProvision(payload, Buffer.from(attestation.provisioning_pubkey_hex, "hex"));
  const provision = await checkedFetch(`${opts.indexer}/provision`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: Buffer.from(sealed),
  });
  const provisionBody = await provision.text();
  if (!provision.ok) throw new Error(`provision failed: HTTP ${provision.status} ${provisionBody}`);

  console.log(`provisioned drop ${dropId}; recovery bundle: ${bundlePath}`);
  await persistWalletState(network, wallet, contractDir);
} finally {
  creatorSecret.fill(0);
  kDrop.fill(0);
  await wallet.wallet.stop();
}
