# Lane A: Contract and Indexer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `contract/` package (Compact contract, deploy and flow-test scripts) and the `indexer/` service (TEE-side: attestation, provisioning, catalog, buckets, ledger watcher, dispatch engine) so lanes B and C have a real backend.

**Architecture:** One Compact contract holds prices, key commitments, buyer one-time keys, and escrowed coins. One Node process reads the contract's public ledger through the Midnight indexer, seals each provisioned content key to each new buyer key with a libsodium sealed box, and serves the same HTTP surface the earlier prototype's apps already speak. The process derives its provisioning keypair from the dstack KMS inside a Phala CVM, or from a dev seed outside one.

**Tech Stack:** Compact 0.31.1 (language 0.23), midnight-js 4.1.1, wallet-sdk 1.2.0, ledger-v8 8.1.0, compact-js 2.5.1, Node 22+, TypeScript 5.9, Fastify 5, libsodium-wrappers 0.7.15, @phala/dstack-sdk 0.5.8, vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-05-blindfold-design.md` (sections 5, 6, 7, 11)

## Global Constraints

- Node.js >= 22. npm workspaces at the repo root. TypeScript `strict: true`, ESM (`"type": "module"`).
- Compiler: `compact update 0.31.1`; `pragma language_version 0.23;`. Never `compact update` without a version.
- Pinned packages (exact): `@midnight-ntwrk/midnight-js-contracts` 4.1.1, `@midnight-ntwrk/midnight-js-indexer-public-data-provider` 4.1.1, `@midnight-ntwrk/midnight-js-http-client-proof-provider` 4.1.1, `@midnight-ntwrk/midnight-js-level-private-state-provider` 4.1.1, `@midnight-ntwrk/midnight-js-node-zk-config-provider` 4.1.1, `@midnight-ntwrk/midnight-js-network-id` 4.1.1, `@midnight-ntwrk/midnight-js-protocol` 4.1.1, `@midnight-ntwrk/midnight-js-types` 4.1.1, `@midnight-ntwrk/midnight-js-utils` 4.1.1, `@midnight-ntwrk/wallet-sdk` 1.2.0, `@midnight-ntwrk/wallet-sdk-address-format` 3.1.0, `@midnight-ntwrk/compact-runtime` 0.16.0, `@midnight-ntwrk/compact-js` 2.5.1, `@midnight-ntwrk/ledger-v8` 8.1.0, `@phala/dstack-sdk` 0.5.8, `libsodium-wrappers` 0.7.15.
- Every `package.json` in the workspace carries `"overrides": { "@midnight-ntwrk/onchain-runtime-v3": "3.0.0" }` (root too). After any install, `find node_modules -type d -path '*onchain-runtime-v3'` must print exactly one path.
- Local devnet images: `midnightntwrk/midnight-node:1.0.0`, `midnightntwrk/indexer-standalone:4.3.3`, `midnightntwrk/proof-server:8.1.0` (compose lives in `deploy/devnet/docker-compose.yml`, Lane D; until it lands, `spike/hello/docker-compose.yml` is identical).
- Docker Desktop CLI is at `~/.docker/bin`; every shell that runs docker or `npm run` scripts that call docker needs `export PATH="$HOME/.docker/bin:$HOME/.local/bin:$PATH"`.
- Devnet genesis seed (public, funded, has shielded NIGHT): `0000000000000000000000000000000000000000000000000000000000000001`.
- Native NIGHT token color for circuit arguments: 32 zero bytes. `1 NIGHT = 1_000_000 STAR`.
- Wire formats are fixed by spec section 6: dispatch blob = libsodium `crypto_box_seal(K_drop, ePub)` (80 bytes); blob key = `hex(blake2b-256(ek_pub ‖ index_be64))`; provisioning payload = JSON `{drop_id, price_star, k_drop, h_content, title}` sealed to the enclave pubkey; attest = `{quote_hex, provisioning_pubkey_hex}` with `report_data[0:32] = sha256(pubkey)`.
- Key commitment (R17): `kCommit[dropId] = sha256(K_drop ‖ h_content)`, where `h_content` is the 32-byte content hash decoded from its hex string, not the hex string itself. Computed off-chain by the creator app; the contract stores the 32 bytes as opaque.
- No secrets in git: `.midnight-state.json`, `.midnight-wallet-state/`, `midnight-level-db/`, `contracts/managed/`, `contract/build/` are ignored. Logs never print `k_drop`, seeds, or secret keys.
- Tests: vitest. Unit tests run without network. Devnet tests are tagged with `describe.skipIf(!process.env.DEVNET)` and run with `DEVNET=1`.
- Commit after every task with a conventional message.

---

## File structure

```
package.json                          root: workspaces ["contract", "indexer", "packages/*", "buyer", "creator"], overrides
tsconfig.base.json                    shared compiler options
contract/
  package.json                        name @blindfold/contract; exports ./contract -> build/blindfold/contract/index.js
  src/blindfold.compact               the contract (spec section 5)
  scripts/compile.sh                  compact compile src/blindfold.compact build/blindfold
  scripts/lib/network.ts              network config, state file, genesis seed (copied from spike/hello/src/network.ts)
  scripts/lib/wallet.ts               wallet facade construction (copied from spike/hello/src/wallet.ts)
  scripts/lib/wallet-state.ts         (copied from spike/hello/src/wallet-state.ts)
  scripts/lib/providers.ts            providers + compiled contract loader for scripts and tests
  scripts/deploy.ts                   deploy the contract, print and record the address
  scripts/fund.ts                     genesis -> any wallet (from spike, unchanged)
  scripts/ledger.ts                   print a deployed contract's ledger
  test/compile.test.ts                compiled artifacts exist and expose the three circuits
  test/flow.test.ts                   DEVNET=1: deploy, createDrop, purchase, withdraw, negatives
indexer/
  package.json                        name @blindfold/indexer
  src/config.ts                       env parsing
  src/keys.ts                         libsodium helpers: keypair from seed, seal/open, sha256, blake2b256, hex
  src/bucket.ts                       FsBucket with hex-key validation
  src/catalog.ts                      in-memory DropConfig store + public view
  src/engine.ts                       dispatch(index, dropId, ePub)
  src/chain.ts                        LedgerReader interface + MidnightLedgerReader
  src/provision.ts                    openProvision + validateProvision
  src/dstack.ts                       Tee interface: DstackTee | DevTee, connectTee()
  src/attest.ts                       buildAttestResponse
  src/watcher.ts                      poll loop + dispatched.json persistence
  src/server.ts                       Fastify app factory
  src/main.ts                         startup wiring
  test/*.test.ts                      one file per module
  Dockerfile
```

---

### Task 1: Monorepo root and contract package

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `contract/package.json`, `contract/tsconfig.json`, `contract/src/blindfold.compact`, `contract/scripts/compile.sh`, `contract/test/compile.test.ts`, `contract/vitest.config.ts`
- Modify: `.gitignore` (add `contract/build/`)

**Interfaces:**
- Produces: `@blindfold/contract/contract` (generated `Contract`, `ledger`, `Ledger`, `Witnesses<PS>`), `contract/build/blindfold/{zkir,keys,contract,compiler}` consumed by the indexer, buyer, creator, and deploy scripts.

- [ ] **Step 1: Root package.json and shared tsconfig**

```json
{
  "name": "blindfold",
  "private": true,
  "type": "module",
  "workspaces": ["contract", "indexer", "packages/*", "buyer", "creator"],
  "scripts": {
    "compile": "npm run compile -w contract",
    "test": "npm test --workspaces --if-present",
    "check:runtime-copies": "test \"$(find node_modules -type d -path '*@midnight-ntwrk/onchain-runtime-v3' | wc -l | tr -d ' ')\" = 1 && echo 'ok: one onchain-runtime copy'"
  },
  "engines": { "node": ">=22" },
  "overrides": { "@midnight-ntwrk/onchain-runtime-v3": "3.0.0" }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 2: Contract package.json, tsconfig, compile script**

`contract/package.json`:

```json
{
  "name": "@blindfold/contract",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./contract": "./build/blindfold/contract/index.js"
  },
  "scripts": {
    "compile": "bash scripts/compile.sh",
    "deploy": "tsx scripts/deploy.ts",
    "fund": "tsx scripts/fund.ts",
    "ledger": "tsx scripts/ledger.ts",
    "test": "vitest run",
    "test:devnet": "DEVNET=1 vitest run test/flow.test.ts"
  },
  "dependencies": {
    "@midnight-ntwrk/compact-runtime": "0.16.0",
    "@midnight-ntwrk/midnight-js-contracts": "4.1.1",
    "@midnight-ntwrk/midnight-js-http-client-proof-provider": "4.1.1",
    "@midnight-ntwrk/midnight-js-indexer-public-data-provider": "4.1.1",
    "@midnight-ntwrk/midnight-js-level-private-state-provider": "4.1.1",
    "@midnight-ntwrk/midnight-js-network-id": "4.1.1",
    "@midnight-ntwrk/midnight-js-node-zk-config-provider": "4.1.1",
    "@midnight-ntwrk/midnight-js-protocol": "4.1.1",
    "@midnight-ntwrk/midnight-js-types": "4.1.1",
    "@midnight-ntwrk/midnight-js-utils": "4.1.1",
    "@midnight-ntwrk/wallet-sdk": "1.2.0",
    "@midnight-ntwrk/wallet-sdk-address-format": "3.1.0",
    "@scure/base": "^2.0.0",
    "@scure/bip39": "2.2.0",
    "rxjs": "^7.8.2",
    "ws": "^8.21.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.18.1",
    "tsx": "^4.23.1",
    "typescript": "^5.9.3",
    "vitest": "^4.1.9"
  },
  "overrides": { "@midnight-ntwrk/onchain-runtime-v3": "3.0.0" }
}
```

`contract/tsconfig.json`: `{ "extends": "../tsconfig.base.json", "include": ["scripts", "test"] }`

`contract/scripts/compile.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$HOME/.compact/bin:$PATH"
want="0.31.1"
have="$(compact compile --version 2>/dev/null || true)"
if [ "$have" != "$want" ]; then
  echo "compact compiler $want required (have: '${have:-none}'). Run: compact update $want" >&2
  exit 1
fi
rm -rf build/blindfold
compact compile src/blindfold.compact build/blindfold
echo "compiled -> build/blindfold"
```

`contract/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 600_000, hookTimeout: 600_000 } });
```

- [ ] **Step 3: Write the failing compile test**

`contract/test/compile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

describe('contract compiles', () => {
  it('produces artifacts for createDrop, purchase, withdraw', () => {
    execFileSync('bash', ['scripts/compile.sh'], { cwd: root, stdio: 'inherit' });
    for (const c of ['createDrop', 'purchase', 'withdraw']) {
      expect(existsSync(resolve(root, `build/blindfold/keys/${c}.prover`))).toBe(true);
      expect(existsSync(resolve(root, `build/blindfold/zkir/${c}.zkir`))).toBe(true);
    }
    const dts = readFileSync(resolve(root, 'build/blindfold/contract/index.d.ts'), 'utf8');
    expect(dts).toContain('kCommit');
    expect(dts).toContain('purchase(context');
    const js = readFileSync(resolve(root, 'build/blindfold/contract/index.js'), 'utf8');
    expect(js).toContain("checkRuntimeVersion('0.16.0')");
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd contract && npm install && npx vitest run test/compile.test.ts`
Expected: FAIL (no `src/blindfold.compact` yet: "no such file").

- [ ] **Step 5: Write the contract**

`contract/src/blindfold.compact`:

```
// Blindfold payment gate: a buyer pays shielded NIGHT and registers a one-time key in one
// transaction; the creator registers drops and withdraws escrowed coins.
pragma language_version 0.23;
import CompactStandardLibrary;

export ledger drops: Map<Uint<64>, Uint<128>>;               // dropId -> price in STAR
export ledger dropOwner: Map<Uint<64>, Bytes<32>>;           // dropId -> creator dapp pubkey
export ledger kCommit: Map<Uint<64>, Bytes<32>>;             // dropId -> sha256(K_drop), set by the creator app
export ledger purchaseCount: Counter;
export ledger purchases: Map<Uint<64>, Bytes<32>>;           // index -> buyer one-time X25519 pubkey
export ledger purchaseDrop: Map<Uint<64>, Uint<64>>;         // index -> dropId
export ledger escrow: Map<Uint<64>, QualifiedShieldedCoinInfo>; // index -> contract-held coin

witness creatorSecret(): Bytes<32>;

circuit creatorPk(sk: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "blindfold:creator:"), sk]);
}

export circuit createDrop(dropId: Uint<64>, price: Uint<128>, commit: Bytes<32>): [] {
  assert(!drops.member(disclose(dropId)), "drop already exists");
  assert(price > 0, "price must be positive");
  drops.insert(disclose(dropId), disclose(price));
  kCommit.insert(disclose(dropId), disclose(commit));
  dropOwner.insert(disclose(dropId), disclose(creatorPk(creatorSecret())));
}

export circuit purchase(dropId: Uint<64>, ePub: Bytes<32>, coin: ShieldedCoinInfo): [] {
  assert(drops.member(disclose(dropId)), "unknown drop");
  assert(coin.color == nativeToken(), "must pay in NIGHT");
  assert(coin.value >= drops.lookup(disclose(dropId)), "underpaid");
  receiveShielded(disclose(coin));
  const idx = purchaseCount.read();
  purchases.insert(idx, disclose(ePub));
  purchaseDrop.insert(idx, disclose(dropId));
  escrow.insertCoin(idx, disclose(coin), right<ZswapCoinPublicKey, ContractAddress>(kernel.self()));
  purchaseCount.increment(1);
}

export circuit withdraw(idx: Uint<64>): [] {
  assert(escrow.member(disclose(idx)), "nothing escrowed");
  const dropId = purchaseDrop.lookup(disclose(idx));
  assert(dropOwner.lookup(dropId) == creatorPk(creatorSecret()), "not the creator");
  const coin = escrow.lookup(disclose(idx));
  sendShielded(coin, left<ZswapCoinPublicKey, ContractAddress>(ownPublicKey()), coin.value);
  escrow.remove(disclose(idx));
}
```

If the compiler rejects `price > 0` on a `Uint<128>`, replace it with `assert(price != 0, "price must be positive");`. Both forms must be tried with the real compiler; keep whichever compiles.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd contract && npx vitest run test/compile.test.ts`
Expected: PASS, "Compiling 3 circuits" in the output.

- [ ] **Step 7: Ignore build output and commit**

Append `contract/build/` to `.gitignore`.

```bash
git add package.json tsconfig.base.json .gitignore contract
git commit -m "feat(contract): blindfold.compact with key commitment; compile script and test"
```

---

### Task 2: Contract scripts: shared libs, deploy, fund, ledger

**Files:**
- Create: `contract/scripts/lib/network.ts`, `contract/scripts/lib/wallet.ts`, `contract/scripts/lib/wallet-state.ts` (copied verbatim from `spike/hello/src/`), `contract/scripts/lib/providers.ts`, `contract/scripts/deploy.ts`, `contract/scripts/fund.ts` (copied from `spike/hello/src/fund.ts`), `contract/scripts/ledger.ts`

**Interfaces:**
- Consumes: `@blindfold/contract/contract` from Task 1.
- Produces: `buildProviders(walletCtx, networkConfig): Providers`, `loadCompiledContract(secret: Uint8Array)`, `deployBlindfold(providers, secret): Promise<string>` (contract address), `readLedgerSnapshot(indexerUrl, indexerWsUrl, address)`. The flow test (Task 3) and Lane D's runbook use these.

- [ ] **Step 1: Copy the wallet helpers from the spike**

```bash
mkdir -p contract/scripts/lib
cp spike/hello/src/network.ts spike/hello/src/wallet.ts spike/hello/src/wallet-state.ts contract/scripts/lib/
cp spike/hello/src/fund.ts contract/scripts/fund.ts
sed -i '' "s#from './network'#from './lib/network'#; s#from './wallet'#from './lib/wallet'#" contract/scripts/fund.ts
```

- [ ] **Step 2: Write `contract/scripts/lib/providers.ts`**

```ts
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { NetworkConfig } from './network';
import type { WalletContext } from './wallet';

export const BUILD_DIR = path.resolve(import.meta.dirname, '..', '..', 'build', 'blindfold');
export const NATIVE_COLOR = new Uint8Array(32);

export type PrivateState = { secret: Uint8Array };

export const witnesses = {
  creatorSecret: (ctx: { privateState: PrivateState }): [PrivateState, Uint8Array] => [ctx.privateState, ctx.privateState.secret],
};

export async function loadContractModule() {
  return import(pathToFileURL(path.join(BUILD_DIR, 'contract', 'index.js')).href);
}

export async function loadCompiledContract() {
  const mod = await loadContractModule();
  return CompiledContract.make('blindfold', mod.Contract).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(BUILD_DIR),
  );
}

export function buildProviders(walletCtx: WalletContext, config: NetworkConfig, storeName = 'blindfold-scripts') {
  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };
  const zkConfigProvider = new NodeZkConfigProvider(BUILD_DIR);
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: storeName,
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      privateStoragePasswordProvider: () => process.env.PRIVATE_STATE_PASSWORD ?? 'Local-Devnet-Development-Placeholder-1',
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

export function nightCoin(value: bigint) {
  return { nonce: crypto.getRandomValues(new Uint8Array(32)), color: NATIVE_COLOR, value };
}
```

- [ ] **Step 3: Write `contract/scripts/deploy.ts`**

```ts
// Deploy blindfold to the active network (undeployed by default; --network preview|preprod).
// Prints the contract address and records it in .midnight-state.json under deployments.
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
// @ts-expect-error polyfill for wallet sync
globalThis.WebSocket = WebSocket;
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, recordDeployment } from './lib/network';
import { createWallet, persistWalletState } from './lib/wallet';
import { buildProviders, loadCompiledContract } from './lib/providers';

const { network, config } = resolveNetwork();
const wallet = getOrCreateWallet(network);
const notice = formatWalletBackupNotice(wallet, network);
if (notice) console.log(notice);

const ctx = await createWallet({ network, networkConfig: config, seed: wallet.seed });
console.log('syncing wallet…');
await ctx.wallet.waitForSyncedState();
await persistWalletState(network, ctx);

const providers = buildProviders(ctx, config);
const compiledContract = await loadCompiledContract();
console.log(`deploying blindfold to ${network}…`);
const deployed: any = await deployContract(providers, {
  compiledContract: compiledContract as any,
  args: [],
  privateStateId: `blindfold-deployer-${Date.now()}`,
  initialPrivateState: { secret: randomBytes(32) },
});
const address = deployed.deployTxData.public.contractAddress as string;
recordDeployment(network, address, ctx.unshieldedKeystore.getBech32Address().toString());
console.log(`CONTRACT_ADDRESS=${address}`);
await persistWalletState(network, ctx);
await ctx.wallet.stop();
```

- [ ] **Step 4: Write `contract/scripts/ledger.ts`**

```ts
// Print the ledger of a deployed blindfold contract. Usage: tsx scripts/ledger.ts [address]
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { resolveNetwork, getDeployment } from './lib/network';
import { loadContractModule } from './lib/providers';

const { network, config } = resolveNetwork();
setNetworkId(network);
const address = process.argv[2] ?? getDeployment(network)?.address;
if (!address) throw new Error('no address given and no deployment recorded');
const mod = await loadContractModule();
const pdp = indexerPublicDataProvider(config.indexer, config.indexerWS);
const state = await pdp.queryContractState(address);
if (!state) throw new Error(`no contract state at ${address}`);
const L = mod.ledger(state.data);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
console.log('drops', [...L.drops].map(([k, v]: [bigint, bigint]) => `${k}=${v} STAR`).join(', ') || '(none)');
console.log('kCommit', [...L.kCommit].map(([k, v]: [bigint, Uint8Array]) => `${k}=${hex(v)}`).join(', ') || '(none)');
console.log('purchaseCount', L.purchaseCount.toString());
for (const [k, v] of L.purchases) console.log(`purchases[${k}] = ${hex(v)} (drop ${L.purchaseDrop.lookup(k)})`);
for (const [k, v] of L.escrow) console.log(`escrow[${k}] = ${v.value} STAR @ mt_index ${v.mt_index}`);
process.exit(0);
```

- [ ] **Step 5: Type-check and try the deploy on the devnet**

Run (devnet up, see spike/NOTES.md):
```bash
cd contract && npx tsc --noEmit && DEVNET=1 npm run deploy
```
Expected: `CONTRACT_ADDRESS=<64 hex>` printed, then `npm run ledger` prints `drops (none)` and `purchaseCount 0`.

- [ ] **Step 6: Commit**

```bash
git add contract/scripts
git commit -m "feat(contract): deploy, fund, and ledger scripts with shared wallet helpers"
```

---

### Task 3: Contract flow test on the devnet

**Files:**
- Create: `contract/test/flow.test.ts`

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces: the executable specification of the contract that lanes B and C mock against.

- [ ] **Step 1: Write the failing devnet test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import { WebSocket } from 'ws';
// @ts-expect-error polyfill
globalThis.WebSocket = WebSocket;
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { resolveNetwork, GENESIS_SEED } from '../scripts/lib/network';
import { createWallet, persistWalletState, type WalletContext } from '../scripts/lib/wallet';
import { buildProviders, loadCompiledContract, loadContractModule, nightCoin } from '../scripts/lib/providers';

const NATIVE = '0'.repeat(64);
const PRICE = 1_000_000n;
const shieldedNight = (s: any): bigint => s.shielded.balances[NATIVE] ?? 0n;

describe.skipIf(!process.env.DEVNET)('blindfold contract flow (local devnet)', () => {
  const { network, config } = resolveNetwork();
  let ctx: WalletContext;
  let providers: ReturnType<typeof buildProviders>;
  let mod: any;
  let compiled: any;
  let address: string;
  const creatorSecret = randomBytes(32);
  const kDrop = randomBytes(32);
  const commit = createHash('sha256').update(kDrop).digest();

  beforeAll(async () => {
    ctx = await createWallet({ network, networkConfig: config, seed: GENESIS_SEED });
    await ctx.wallet.waitForSyncedState();
    await persistWalletState(network, ctx);
    providers = buildProviders(ctx, config, 'blindfold-flow-test');
    mod = await loadContractModule();
    compiled = await loadCompiledContract();
    const deployed: any = await deployContract(providers, {
      compiledContract: compiled, args: [], privateStateId: `flow-creator-${Date.now()}`,
      initialPrivateState: { secret: creatorSecret },
    });
    address = deployed.deployTxData.public.contractAddress;
  });
  afterAll(async () => { await persistWalletState(network, ctx); await ctx.wallet.stop(); });

  async function ledger() {
    const cs = await providers.publicDataProvider.queryContractState(address);
    return mod.ledger(cs!.data);
  }
  async function asCreator() {
    return findDeployedContract(providers, { compiledContract: compiled, contractAddress: address,
      privateStateId: `flow-creator-${address}`, initialPrivateState: { secret: creatorSecret } }) as any;
  }
  async function asStranger() {
    return findDeployedContract(providers, { compiledContract: compiled, contractAddress: address,
      privateStateId: `flow-stranger-${address}`, initialPrivateState: { secret: randomBytes(32) } }) as any;
  }

  it('createDrop records price, commitment, and owner', async () => {
    const c = await asCreator();
    await c.callTx.createDrop(1n, PRICE, commit);
    const L = await ledger();
    expect(L.drops.lookup(1n)).toBe(PRICE);
    expect(Buffer.from(L.kCommit.lookup(1n)).equals(commit)).toBe(true);
    expect(L.dropOwner.member(1n)).toBe(true);
  });

  it('createDrop rejects a duplicate id', async () => {
    const c = await asCreator();
    await expect(c.callTx.createDrop(1n, PRICE, commit)).rejects.toThrow(/drop already exists/);
  });

  it('purchase escrows the coin and records the one-time key', async () => {
    const before = shieldedNight(await ctx.wallet.waitForSyncedState());
    const buyer = await asStranger();
    const ePub = randomBytes(32);
    await buyer.callTx.purchase(1n, ePub, nightCoin(PRICE));
    const after = shieldedNight(await ctx.wallet.waitForSyncedState());
    expect(before - after).toBe(PRICE);
    const L = await ledger();
    expect(L.purchaseCount).toBe(1n);
    expect(Buffer.from(L.purchases.lookup(0n)).equals(ePub)).toBe(true);
    expect(L.purchaseDrop.lookup(0n)).toBe(1n);
    expect(L.escrow.lookup(0n).value).toBe(PRICE);
  });

  it('purchase rejects an underpaid coin', async () => {
    const buyer = await asStranger();
    await expect(buyer.callTx.purchase(1n, randomBytes(32), nightCoin(PRICE - 1n))).rejects.toThrow(/underpaid/);
  });

  it('withdraw by a non-owner is rejected', async () => {
    const s = await asStranger();
    await expect(s.callTx.withdraw(0n)).rejects.toThrow(/not the creator/);
  });

  it('withdraw by the creator returns the escrowed NIGHT', async () => {
    const before = shieldedNight(await ctx.wallet.waitForSyncedState());
    const c = await asCreator();
    await c.callTx.withdraw(0n);
    const after = shieldedNight(await ctx.wallet.waitForSyncedState());
    expect(after - before).toBe(PRICE);
    expect((await ledger()).escrow.member(0n)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it against the devnet**

Run: `cd contract && DEVNET=1 npx vitest run test/flow.test.ts`
Expected: 6 passing in roughly 3 minutes (each circuit call proves in 15 to 40 s). The assert messages surface from the local circuit execution before proving; if the rejection text differs (for example the runtime wraps it), loosen the regexes to `/exists|underpaid|creator/` and note the exact text in `spike/NOTES.md`.

- [ ] **Step 3: Commit**

```bash
git add contract/test/flow.test.ts
git commit -m "test(contract): devnet flow test incl. duplicate, underpaid, and non-owner rejections"
```

---

### Task 4: Indexer package and `keys.ts`

**Files:**
- Create: `indexer/package.json`, `indexer/tsconfig.json`, `indexer/vitest.config.ts`, `indexer/src/keys.ts`, `indexer/test/keys.test.ts`, `docs/vectors.json`

**Interfaces:**
- Produces:
  - `sodiumReady(): Promise<void>`
  - `keypairFromSeed(seed: Uint8Array): Keypair` where `Keypair = { publicKey: Uint8Array; secretKey: Uint8Array }` (the seed is the X25519 secret key, public = `crypto_scalarmult_base(seed)`)
  - `seal(message, recipientPub): Uint8Array`, `sealOpen(blob, kp): Uint8Array | null`
  - `sha256(bytes): Uint8Array`, `blake2b256(bytes): Uint8Array`, `toHex`, `fromHex`, `concat`, `u64be(n: bigint): Uint8Array`

- [ ] **Step 1: Package files**

`indexer/package.json`:

```json
{
  "name": "@blindfold/indexer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts",
    "build": "tsc --noEmit",
    "test": "vitest run",
    "test:devnet": "DEVNET=1 vitest run"
  },
  "dependencies": {
    "@blindfold/contract": "*",
    "@fastify/cors": "^10.0.0",
    "@midnight-ntwrk/compact-runtime": "0.16.0",
    "@midnight-ntwrk/midnight-js-indexer-public-data-provider": "4.1.1",
    "@midnight-ntwrk/midnight-js-network-id": "4.1.1",
    "@midnight-ntwrk/midnight-js-protocol": "4.1.1",
    "@phala/dstack-sdk": "0.5.8",
    "fastify": "^5.0.0",
    "libsodium-wrappers": "0.7.15",
    "tsx": "^4.23.1",
    "ws": "^8.21.1"
  },
  "devDependencies": {
    "@types/libsodium-wrappers": "^0.7.14",
    "@types/node": "^22.0.0",
    "@types/ws": "^8.18.1",
    "typescript": "^5.9.3",
    "vitest": "^4.1.9"
  },
  "overrides": { "@midnight-ntwrk/onchain-runtime-v3": "3.0.0" }
}
```

`indexer/tsconfig.json`: `{ "extends": "../tsconfig.base.json", "include": ["src", "test"] }`
`indexer/vitest.config.ts`: `import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { testTimeout: 120_000 } });`

- [ ] **Step 2: Shared vectors file**

`docs/vectors.json` (both apps and the indexer assert against these):

```json
{
  "sha256": { "input_hex": "", "output_hex": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
  "blake2b256": { "input_hex": "616263", "output_hex": "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319" },
  "u64be": { "value": "1", "output_hex": "0000000000000001" },
  "x25519": { "seed_hex": "0000000000000000000000000000000000000000000000000000000000000001",
              "public_hex": "" }
}
```

Fill `x25519.public_hex` in Step 5 from the implementation's own output and keep it fixed afterwards (it becomes the regression value both apps check).

- [ ] **Step 3: Write the failing tests**

`indexer/test/keys.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sodiumReady, keypairFromSeed, seal, sealOpen, sha256, blake2b256, toHex, fromHex, u64be, concat } from '../src/keys';

const vectors = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../docs/vectors.json'), 'utf8'));

beforeAll(sodiumReady);

describe('keys', () => {
  it('sha256 and blake2b256 match the shared vectors', () => {
    expect(toHex(sha256(fromHex(vectors.sha256.input_hex)))).toBe(vectors.sha256.output_hex);
    expect(toHex(blake2b256(fromHex(vectors.blake2b256.input_hex)))).toBe(vectors.blake2b256.output_hex);
  });
  it('u64be encodes big-endian 8 bytes', () => {
    expect(toHex(u64be(1n))).toBe(vectors.u64be.output_hex);
    expect(toHex(u64be(0x0102030405060708n))).toBe('0102030405060708');
  });
  it('keypairFromSeed is deterministic and uses the seed as the secret key', () => {
    const seed = fromHex(vectors.x25519.seed_hex);
    const a = keypairFromSeed(seed), b = keypairFromSeed(seed);
    expect(toHex(a.publicKey)).toBe(toHex(b.publicKey));
    expect(toHex(a.secretKey)).toBe(vectors.x25519.seed_hex);
    if (vectors.x25519.public_hex) expect(toHex(a.publicKey)).toBe(vectors.x25519.public_hex);
  });
  it('seal produces an 80-byte blob for a 32-byte message that only the recipient opens', () => {
    const kp = keypairFromSeed(fromHex('11'.repeat(32)));
    const other = keypairFromSeed(fromHex('22'.repeat(32)));
    const k = fromHex('ab'.repeat(32));
    const blob = seal(k, kp.publicKey);
    expect(blob.length).toBe(80);
    expect(toHex(sealOpen(blob, kp)!)).toBe(toHex(k));
    expect(sealOpen(blob, other)).toBeNull();
  });
  it('concat joins byte arrays', () => {
    expect(toHex(concat([fromHex('01'), fromHex('0203')]))).toBe('010203');
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `cd indexer && npm install && npx vitest run test/keys.test.ts`
Expected: FAIL, cannot find module `../src/keys`.

- [ ] **Step 5: Implement `indexer/src/keys.ts`**

```ts
import sodium from 'libsodium-wrappers';
import { createHash } from 'node:crypto';

export type Keypair = { publicKey: Uint8Array; secretKey: Uint8Array };

let ready: Promise<void> | null = null;
export function sodiumReady(): Promise<void> { return (ready ??= sodium.ready); }

/** The 32-byte seed IS the X25519 secret key; the public key is scalarmult_base(seed).
 *  Deterministic, so a creator who provisioned stays reachable across restarts. */
export function keypairFromSeed(seed: Uint8Array): Keypair {
  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  return { publicKey: sodium.crypto_scalarmult_base(seed), secretKey: new Uint8Array(seed) };
}

export function seal(message: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  return sodium.crypto_box_seal(message, recipientPub);
}

export function sealOpen(blob: Uint8Array, kp: Keypair): Uint8Array | null {
  try { return sodium.crypto_box_seal_open(blob, kp.publicKey, kp.secretKey); } catch { return null; }
}

export function sha256(bytes: Uint8Array): Uint8Array { return new Uint8Array(createHash('sha256').update(bytes).digest()); }
export function blake2b256(bytes: Uint8Array): Uint8Array { return sodium.crypto_generichash(32, bytes); }

export function toHex(b: Uint8Array): string { return Buffer.from(b).toString('hex'); }
export function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error('invalid hex');
  return new Uint8Array(Buffer.from(h, 'hex'));
}
export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function u64be(n: bigint): Uint8Array {
  const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, n); return out;
}
```

Then run the test once, copy the printed public key for seed `00…01` into `docs/vectors.json` `x25519.public_hex` (add a temporary `console.log(toHex(a.publicKey))` if needed, then remove it).

- [ ] **Step 6: Run to verify pass**

Run: `cd indexer && npx vitest run test/keys.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add indexer docs/vectors.json
git commit -m "feat(indexer): package scaffold and libsodium key helpers with shared vectors"
```

---

### Task 5: `bucket.ts`

**Files:**
- Create: `indexer/src/bucket.ts`, `indexer/test/bucket.test.ts`

**Interfaces:**
- Produces: `interface Bucket { put(key, bytes): Promise<void>; get(key): Promise<Uint8Array | null>; list(): Promise<string[]>; has(key): Promise<boolean> }`, `class FsBucket implements Bucket` (`new FsBucket(dir)`), `class MemoryBucket implements Bucket` (tests), `isValidKey(key): boolean` (1..128 hex chars).

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsBucket, MemoryBucket, isValidKey } from '../src/bucket';

for (const [name, make] of [
  ['FsBucket', () => new FsBucket(join(mkdtempSync(join(tmpdir(), 'bf-bucket-')), 'bucket'))],
  ['MemoryBucket', () => new MemoryBucket()],
] as const) {
  describe(name, () => {
    it('put/get/list/has roundtrip', async () => {
      const b = make();
      await b.put('deadbeef', new Uint8Array([1, 2, 3]));
      expect(Array.from((await b.get('deadbeef'))!)).toEqual([1, 2, 3]);
      expect(await b.get('cafe')).toBeNull();
      expect(await b.has('deadbeef')).toBe(true);
      expect(await b.list()).toEqual(['deadbeef']);
    });
    it('rejects non-hex and traversal keys', async () => {
      const b = make();
      for (const bad of ['../escape', '..', 'a/b', 'k1.txt', '/etc/passwd', '', 'g'.repeat(4), 'a'.repeat(129)]) {
        await expect(b.put(bad, new Uint8Array(1))).rejects.toThrow(/invalid bucket key/);
        expect(await b.get(bad)).toBeNull();
      }
    });
  });
}

it('FsBucket never writes outside its dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bf-trav-'));
  const b = new FsBucket(join(root, 'bucket'));
  await expect(b.put('../escape', new Uint8Array(1))).rejects.toThrow();
  expect(existsSync(join(root, 'escape'))).toBe(false);
});

it('isValidKey', () => {
  expect(isValidKey('00ff')).toBe(true);
  expect(isValidKey('00FF')).toBe(true);
  expect(isValidKey('zz')).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/bucket.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `indexer/src/bucket.ts`**

```ts
import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

export interface Bucket {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  has(key: string): Promise<boolean>;
  list(): Promise<string[]>;
}

/** Keys are hash hex. Anything else is refused so a key can never address a path outside the dir. */
export function isValidKey(key: string): boolean {
  return key.length > 0 && key.length <= 128 && /^[0-9a-fA-F]+$/.test(key);
}

function assertKey(key: string): void {
  if (!isValidKey(key)) throw new Error('invalid bucket key');
}

export class FsBucket implements Bucket {
  private ready: Promise<void>;
  constructor(private readonly dir: string) { this.ready = mkdir(dir, { recursive: true }).then(() => undefined); }
  async put(key: string, bytes: Uint8Array): Promise<void> {
    assertKey(key); await this.ready;
    await writeFile(join(this.dir, key.toLowerCase()), bytes);
  }
  async get(key: string): Promise<Uint8Array | null> {
    if (!isValidKey(key)) return null; await this.ready;
    try { return new Uint8Array(await readFile(join(this.dir, key.toLowerCase()))); }
    catch (e: any) { if (e?.code === 'ENOENT') return null; throw e; }
  }
  async has(key: string): Promise<boolean> {
    if (!isValidKey(key)) return false; await this.ready;
    try { await access(join(this.dir, key.toLowerCase())); return true; } catch { return false; }
  }
  async list(): Promise<string[]> { await this.ready; return (await readdir(this.dir)).sort(); }
}

export class MemoryBucket implements Bucket {
  private readonly m = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array): Promise<void> { assertKey(key); this.m.set(key.toLowerCase(), new Uint8Array(bytes)); }
  async get(key: string): Promise<Uint8Array | null> { return isValidKey(key) ? (this.m.get(key.toLowerCase()) ?? null) : null; }
  async has(key: string): Promise<boolean> { return isValidKey(key) && this.m.has(key.toLowerCase()); }
  async list(): Promise<string[]> { return [...this.m.keys()].sort(); }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run test/bucket.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add indexer/src/bucket.ts indexer/test/bucket.test.ts && git commit -m "feat(indexer): hash-addressed buckets with key validation"`

---

### Task 6: `catalog.ts`

**Files:**
- Create: `indexer/src/catalog.ts`, `indexer/test/catalog.test.ts`

**Interfaces:**
- Produces:
  - `type DropConfig = { dropId: bigint; priceStar: bigint; kDrop: Uint8Array; hContent: string; title: string }`
  - `type CatalogEntry = { drop_id: number; price_star: string; title: string; h_content: string }`
  - `class Catalog { upsert(cfg): void; get(dropId: bigint): DropConfig | undefined; has(dropId): boolean; publicEntries(): CatalogEntry[] }`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { Catalog, type DropConfig } from '../src/catalog';

const cfg = (dropId: bigint, title = 't'): DropConfig => ({ dropId, priceStar: 1_000_000n, kDrop: new Uint8Array(32).fill(7), hContent: 'ab'.repeat(32), title });

describe('Catalog', () => {
  it('stores and returns configs; public view has no key', () => {
    const c = new Catalog();
    c.upsert(cfg(1n, 'one'));
    expect(c.has(1n)).toBe(true);
    expect(c.get(1n)!.title).toBe('one');
    const pub = c.publicEntries();
    expect(pub).toEqual([{ drop_id: 1, price_star: '1000000', title: 'one', h_content: 'ab'.repeat(32) }]);
    expect(JSON.stringify(pub)).not.toContain('kDrop');
  });
  it('upsert overwrites (re-provisioning is idempotent)', () => {
    const c = new Catalog();
    c.upsert(cfg(1n, 'a')); c.upsert(cfg(1n, 'b'));
    expect(c.get(1n)!.title).toBe('b');
    expect(c.publicEntries()).toHaveLength(1);
  });
  it('public entries are sorted by drop id', () => {
    const c = new Catalog(); c.upsert(cfg(5n)); c.upsert(cfg(2n));
    expect(c.publicEntries().map((e) => e.drop_id)).toEqual([2, 5]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL, module missing.

- [ ] **Step 3: Implement `indexer/src/catalog.ts`**

```ts
export type DropConfig = { dropId: bigint; priceStar: bigint; kDrop: Uint8Array; hContent: string; title: string };
export type CatalogEntry = { drop_id: number; price_star: string; title: string; h_content: string };

/** In-memory only, on purpose: provisioned keys live inside the enclave process and nowhere else.
 *  After a restart creators re-provision (idempotent). */
export class Catalog {
  private readonly m = new Map<bigint, DropConfig>();
  upsert(cfg: DropConfig): void { this.m.set(cfg.dropId, { ...cfg, kDrop: new Uint8Array(cfg.kDrop) }); }
  get(dropId: bigint): DropConfig | undefined { return this.m.get(dropId); }
  has(dropId: bigint): boolean { return this.m.has(dropId); }
  publicEntries(): CatalogEntry[] {
    return [...this.m.values()]
      .sort((a, b) => (a.dropId < b.dropId ? -1 : a.dropId > b.dropId ? 1 : 0))
      .map((c) => ({ drop_id: Number(c.dropId), price_star: c.priceStar.toString(), title: c.title, h_content: c.hContent }));
  }
}
```

- [ ] **Step 4: Run to verify pass.** **Step 5: Commit** — `git commit -m "feat(indexer): in-memory catalog with secret-free public view"`

---

### Task 7: `engine.ts` (dispatch)

**Files:**
- Create: `indexer/src/engine.ts`, `indexer/test/engine.test.ts`

**Interfaces:**
- Consumes: `Catalog`, `Bucket`, keys helpers.
- Produces: `dispatchKey(ekPub: Uint8Array, index: bigint): string`, `class Engine { constructor(catalog: Catalog, dispatch: Bucket); async dispatch(index: bigint, dropId: bigint, ePub: Uint8Array): Promise<{ key: string } | { skipped: 'unprovisioned' }> }`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers';
import { Catalog } from '../src/catalog';
import { MemoryBucket } from '../src/bucket';
import { Engine, dispatchKey } from '../src/engine';
import { sodiumReady, blake2b256, concat, u64be, toHex } from '../src/keys';

beforeAll(sodiumReady);

describe('Engine.dispatch', () => {
  it('seals K_drop to ePub as an 80-byte blob the buyer opens, keyed by blake2b(ek_pub||index)', async () => {
    const catalog = new Catalog();
    const kDrop = new Uint8Array(32).fill(9);
    catalog.upsert({ dropId: 1n, priceStar: 5n, kDrop, hContent: 'aa'.repeat(32), title: 't' });
    const bucket = new MemoryBucket();
    const engine = new Engine(catalog, bucket);
    const buyer = sodium.crypto_box_keypair();
    const res = await engine.dispatch(0n, 1n, buyer.publicKey);
    expect('key' in res).toBe(true);
    const blob = (await bucket.get((res as any).key))!;
    expect(blob.length).toBe(80);
    expect(toHex(sodium.crypto_box_seal_open(blob, buyer.publicKey, buyer.privateKey))).toBe(toHex(kDrop));
    expect((res as any).key).toBe(dispatchKey(blob.subarray(0, 32), 0n));
    expect((res as any).key).toBe(toHex(blake2b256(concat([blob.subarray(0, 32), u64be(0n)]))));
  });
  it('skips drops that are not provisioned', async () => {
    const engine = new Engine(new Catalog(), new MemoryBucket());
    expect(await engine.dispatch(0n, 42n, new Uint8Array(32))).toEqual({ skipped: 'unprovisioned' });
  });
  it('rejects an ePub that is not 32 bytes', async () => {
    const catalog = new Catalog();
    catalog.upsert({ dropId: 1n, priceStar: 5n, kDrop: new Uint8Array(32), hContent: 'aa'.repeat(32), title: 't' });
    await expect(new Engine(catalog, new MemoryBucket()).dispatch(0n, 1n, new Uint8Array(31))).rejects.toThrow(/ePub/);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `indexer/src/engine.ts`**

```ts
import type { Bucket } from './bucket';
import type { Catalog } from './catalog';
import { blake2b256, concat, seal, toHex, u64be } from './keys';

export const DISPATCH_BLOB_LEN = 80;

/** Bucket key for a dispatch blob: blake2b-256(ek_pub || index_be64). The buyer cannot compute it
 *  (ek_pub is the sealer's ephemeral key), so it lists and trial-opens. */
export function dispatchKey(ekPub: Uint8Array, index: bigint): string {
  return toHex(blake2b256(concat([ekPub, u64be(index)])));
}

export class Engine {
  constructor(private readonly catalog: Catalog, private readonly dispatchBucket: Bucket) {}

  async dispatch(index: bigint, dropId: bigint, ePub: Uint8Array): Promise<{ key: string } | { skipped: 'unprovisioned' }> {
    if (ePub.length !== 32) throw new Error('ePub must be 32 bytes');
    const cfg = this.catalog.get(dropId);
    if (!cfg) return { skipped: 'unprovisioned' };
    const blob = seal(cfg.kDrop, ePub);
    if (blob.length !== DISPATCH_BLOB_LEN) throw new Error(`dispatch blob is ${blob.length} bytes, expected ${DISPATCH_BLOB_LEN}`);
    const key = dispatchKey(blob.subarray(0, 32), index);
    await this.dispatchBucket.put(key, blob);
    return { key };
  }
}
```

- [ ] **Step 4: Run to verify pass.** **Step 5: Commit** — `git commit -m "feat(indexer): dispatch engine seals K_drop to buyer keys"`

---

### Task 8: `chain.ts` (ledger reader)

**Files:**
- Create: `indexer/src/chain.ts`, `indexer/test/chain.test.ts`

**Interfaces:**
- Consumes: `@blindfold/contract/contract` `ledger()`.
- Produces:
  - `type LedgerSnapshot = { drops: Map<bigint, bigint>; kCommit: Map<bigint, Uint8Array>; purchaseCount: bigint; purchases: Map<bigint, Uint8Array>; purchaseDrop: Map<bigint, bigint> }`
  - `interface LedgerReader { read(): Promise<LedgerSnapshot> }`
  - `class MidnightLedgerReader implements LedgerReader` (`new MidnightLedgerReader({ indexerUrl, indexerWsUrl, contractAddress, networkId })`), throws `ContractNotFound` when the address has no state.
  - `class StaticLedgerReader implements LedgerReader` (`new StaticLedgerReader(snapshot)`, with `set(snapshot)`) for tests.
  - `snapshotFromLedger(L: any): LedgerSnapshot` (pure; converts the generated iterable maps).

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { snapshotFromLedger, StaticLedgerReader, MidnightLedgerReader, ContractNotFound } from '../src/chain';

function fakeLedger() {
  const map = <K, V>(entries: [K, V][]) => ({ [Symbol.iterator]: () => entries[Symbol.iterator]() });
  return {
    drops: map<bigint, bigint>([[1n, 5n]]),
    kCommit: map<bigint, Uint8Array>([[1n, new Uint8Array(32).fill(1)]]),
    purchaseCount: 2n,
    purchases: map<bigint, Uint8Array>([[0n, new Uint8Array(32).fill(2)], [1n, new Uint8Array(32).fill(3)]]),
    purchaseDrop: map<bigint, bigint>([[0n, 1n], [1n, 1n]]),
  };
}

describe('snapshotFromLedger', () => {
  it('converts generated ledger maps to plain Maps', () => {
    const s = snapshotFromLedger(fakeLedger());
    expect(s.drops.get(1n)).toBe(5n);
    expect(s.purchaseCount).toBe(2n);
    expect(s.purchases.get(1n)![0]).toBe(3);
    expect(s.purchaseDrop.get(0n)).toBe(1n);
  });
});

describe('StaticLedgerReader', () => {
  it('returns what it was given and can be updated', async () => {
    const r = new StaticLedgerReader(snapshotFromLedger(fakeLedger()));
    expect((await r.read()).purchaseCount).toBe(2n);
    r.set({ ...(await r.read()), purchaseCount: 3n });
    expect((await r.read()).purchaseCount).toBe(3n);
  });
});

describe.skipIf(!process.env.DEVNET)('MidnightLedgerReader (devnet)', () => {
  it('throws ContractNotFound for a random address', async () => {
    const r = new MidnightLedgerReader({ indexerUrl: 'http://127.0.0.1:8088/api/v4/graphql', indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws', contractAddress: 'ab'.repeat(32), networkId: 'undeployed' });
    await expect(r.read()).rejects.toBeInstanceOf(ContractNotFound);
  });
  it('reads a deployed contract when CONTRACT_ADDRESS is set', async () => {
    const address = process.env.CONTRACT_ADDRESS;
    if (!address) return;
    const r = new MidnightLedgerReader({ indexerUrl: 'http://127.0.0.1:8088/api/v4/graphql', indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws', contractAddress: address, networkId: 'undeployed' });
    const s = await r.read();
    expect(typeof s.purchaseCount).toBe('bigint');
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `indexer/src/chain.ts`**

```ts
import { WebSocket } from 'ws';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { ledger as decodeLedger } from '@blindfold/contract/contract';

if (typeof globalThis.WebSocket === 'undefined') (globalThis as any).WebSocket = WebSocket;

export type LedgerSnapshot = {
  drops: Map<bigint, bigint>;
  kCommit: Map<bigint, Uint8Array>;
  purchaseCount: bigint;
  purchases: Map<bigint, Uint8Array>;
  purchaseDrop: Map<bigint, bigint>;
};

export interface LedgerReader { read(): Promise<LedgerSnapshot> }

export class ContractNotFound extends Error {
  constructor(address: string) { super(`no contract state at ${address}`); this.name = 'ContractNotFound'; }
}

export function snapshotFromLedger(L: any): LedgerSnapshot {
  return {
    drops: new Map<bigint, bigint>([...L.drops]),
    kCommit: new Map<bigint, Uint8Array>([...L.kCommit]),
    purchaseCount: BigInt(L.purchaseCount),
    purchases: new Map<bigint, Uint8Array>([...L.purchases]),
    purchaseDrop: new Map<bigint, bigint>([...L.purchaseDrop]),
  };
}

export class StaticLedgerReader implements LedgerReader {
  constructor(private snapshot: LedgerSnapshot) {}
  set(s: LedgerSnapshot): void { this.snapshot = s; }
  async read(): Promise<LedgerSnapshot> { return this.snapshot; }
}

export type MidnightLedgerReaderOptions = { indexerUrl: string; indexerWsUrl: string; contractAddress: string; networkId: string };

export class MidnightLedgerReader implements LedgerReader {
  private readonly pdp;
  constructor(private readonly opts: MidnightLedgerReaderOptions) {
    setNetworkId(opts.networkId as any);
    this.pdp = indexerPublicDataProvider(opts.indexerUrl, opts.indexerWsUrl);
  }
  async read(): Promise<LedgerSnapshot> {
    const state = await this.pdp.queryContractState(this.opts.contractAddress);
    if (!state) throw new ContractNotFound(this.opts.contractAddress);
    return snapshotFromLedger(decodeLedger(state.data));
  }
}
```

- [ ] **Step 4: Run to verify pass** — unit tests pass without DEVNET; with `DEVNET=1 CONTRACT_ADDRESS=<from Task 2>` both devnet tests pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(indexer): ledger reader over the Midnight indexer with a static fake"`

---

### Task 9: `provision.ts`

**Files:**
- Create: `indexer/src/provision.ts`, `indexer/test/provision.test.ts`

**Interfaces:**
- Consumes: `Keypair`, `sealOpen`, `sha256`, `LedgerSnapshot`, `Bucket`, `DropConfig`.
- Produces:
  - `type ProvisionPayload = { drop_id: number; price_star: string; k_drop: string; h_content: string; title: string }`
  - `class ProvisionError extends Error { code: 'bad_seal' | 'bad_payload' | 'unknown_drop' | 'price_mismatch' | 'commit_mismatch' | 'content_missing' }`
  - `openProvision(sealed: Uint8Array, kp: Keypair): ProvisionPayload`
  - `validateProvision(p: ProvisionPayload, ledger: LedgerSnapshot, content: Bucket): Promise<DropConfig>`
  - `sealProvision(payload: ProvisionPayload, enclavePub: Uint8Array): Uint8Array` (creator-side twin, used by tests and Lane C vectors)

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { MemoryBucket } from '../src/bucket';
import { keypairFromSeed, sodiumReady, sha256, toHex, fromHex } from '../src/keys';
import { openProvision, validateProvision, sealProvision, ProvisionError, type ProvisionPayload } from '../src/provision';
import type { LedgerSnapshot } from '../src/chain';

beforeAll(sodiumReady);
const kp = keypairFromSeed(fromHex('33'.repeat(32)));
const kDrop = fromHex('44'.repeat(32));
const hContent = 'ab'.repeat(32);
const payload: ProvisionPayload = { drop_id: 1, price_star: '1000000', k_drop: toHex(kDrop), h_content: hContent, title: 'cat' };
const ledger = (over: Partial<LedgerSnapshot> = {}): LedgerSnapshot => ({
  drops: new Map([[1n, 1_000_000n]]), kCommit: new Map([[1n, sha256(kDrop)]]),
  purchaseCount: 0n, purchases: new Map(), purchaseDrop: new Map(), ...over,
});
async function contentBucket() { const b = new MemoryBucket(); await b.put(hContent, new Uint8Array(40)); return b; }
const codeOf = (e: unknown) => (e as ProvisionError).code;

describe('openProvision', () => {
  it('opens a payload sealed to the enclave key', () => {
    expect(openProvision(sealProvision(payload, kp.publicKey), kp)).toEqual(payload);
  });
  it('rejects a payload sealed to another key', () => {
    const other = keypairFromSeed(fromHex('55'.repeat(32)));
    expect(() => openProvision(sealProvision(payload, other.publicKey), kp)).toThrow(ProvisionError);
    try { openProvision(sealProvision(payload, other.publicKey), kp); } catch (e) { expect(codeOf(e)).toBe('bad_seal'); }
  });
  it('rejects malformed JSON and bad fields', () => {
    const bad = sealProvision({ ...payload, k_drop: 'zz' }, kp.publicKey);
    try { openProvision(bad, kp); expect.unreachable(); } catch (e) { expect(codeOf(e)).toBe('bad_payload'); }
  });
});

describe('validateProvision', () => {
  it('accepts a matching drop and returns the config', async () => {
    const cfg = await validateProvision(payload, ledger(), await contentBucket());
    expect(cfg).toEqual({ dropId: 1n, priceStar: 1_000_000n, kDrop, hContent, title: 'cat' });
  });
  it('rejects an unknown drop', async () => {
    await validateProvision(payload, ledger({ drops: new Map() }), await contentBucket()).catch((e) => expect(codeOf(e)).toBe('unknown_drop'));
  });
  it('rejects a price mismatch', async () => {
    await validateProvision(payload, ledger({ drops: new Map([[1n, 2n]]) }), await contentBucket()).catch((e) => expect(codeOf(e)).toBe('price_mismatch'));
  });
  it('rejects a commitment mismatch', async () => {
    await validateProvision(payload, ledger({ kCommit: new Map([[1n, new Uint8Array(32)]]) }), await contentBucket()).catch((e) => expect(codeOf(e)).toBe('commit_mismatch'));
  });
  it('rejects when the content blob is not uploaded', async () => {
    await validateProvision(payload, ledger(), new MemoryBucket()).catch((e) => expect(codeOf(e)).toBe('content_missing'));
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `indexer/src/provision.ts`**

```ts
import type { Bucket } from './bucket';
import type { LedgerSnapshot } from './chain';
import type { DropConfig } from './catalog';
import { fromHex, seal, sealOpen, sha256, toHex, type Keypair } from './keys';

export type ProvisionPayload = { drop_id: number; price_star: string; k_drop: string; h_content: string; title: string };
export type ProvisionErrorCode = 'bad_seal' | 'bad_payload' | 'unknown_drop' | 'price_mismatch' | 'commit_mismatch' | 'content_missing';

export class ProvisionError extends Error {
  constructor(readonly code: ProvisionErrorCode, message: string) { super(message); this.name = 'ProvisionError'; }
}

export function sealProvision(payload: ProvisionPayload, enclavePub: Uint8Array): Uint8Array {
  return seal(new TextEncoder().encode(JSON.stringify(payload)), enclavePub);
}

export function openProvision(sealed: Uint8Array, kp: Keypair): ProvisionPayload {
  const plain = sealOpen(sealed, kp);
  if (!plain) throw new ProvisionError('bad_seal', 'sealed payload does not open with the enclave key');
  let p: any;
  try { p = JSON.parse(new TextDecoder().decode(plain)); } catch { throw new ProvisionError('bad_payload', 'payload is not JSON'); }
  finally { plain.fill(0); }
  const ok = p && Number.isSafeInteger(p.drop_id) && p.drop_id >= 0
    && typeof p.price_star === 'string' && /^\d+$/.test(p.price_star)
    && typeof p.k_drop === 'string' && /^[0-9a-fA-F]{64}$/.test(p.k_drop)
    && typeof p.h_content === 'string' && /^[0-9a-fA-F]{64}$/.test(p.h_content)
    && typeof p.title === 'string' && p.title.length <= 200;
  if (!ok) throw new ProvisionError('bad_payload', 'payload fields are invalid');
  return { drop_id: p.drop_id, price_star: p.price_star, k_drop: p.k_drop.toLowerCase(), h_content: p.h_content.toLowerCase(), title: p.title };
}

export async function validateProvision(p: ProvisionPayload, ledger: LedgerSnapshot, content: Bucket): Promise<DropConfig> {
  const dropId = BigInt(p.drop_id);
  const price = ledger.drops.get(dropId);
  if (price === undefined) throw new ProvisionError('unknown_drop', `drop ${p.drop_id} is not on-chain`);
  if (price !== BigInt(p.price_star)) throw new ProvisionError('price_mismatch', `on-chain price ${price} != ${p.price_star}`);
  const kDrop = fromHex(p.k_drop);
  const commit = ledger.kCommit.get(dropId);
  if (!commit || toHex(commit) !== toHex(sha256(kDrop))) throw new ProvisionError('commit_mismatch', 'sha256(k_drop) does not match the on-chain commitment');
  if (!(await content.has(p.h_content))) throw new ProvisionError('content_missing', `content ${p.h_content} not uploaded`);
  return { dropId, priceStar: price, kDrop, hContent: p.h_content, title: p.title };
}
```

- [ ] **Step 4: Run to verify pass.** **Step 5: Commit** — `git commit -m "feat(indexer): provisioning open + on-chain validation (price, key commitment, content)"`

---

### Task 10: `dstack.ts` and `attest.ts`

**Files:**
- Create: `indexer/src/dstack.ts`, `indexer/src/attest.ts`, `indexer/test/dstack.test.ts`, `indexer/test/attest.test.ts`

**Interfaces:**
- Produces:
  - `interface Tee { readonly isDev: boolean; getKey(path: string): Promise<Uint8Array>; getQuote(reportData: Uint8Array): Promise<string>; measurement(): Promise<string> }`
  - `connectTee(opts: { endpoint?: string; devSeedHex?: string; client?: DstackLike }): Promise<Tee>` where `DstackLike = { isReachable(): Promise<boolean>; getKey(path: string): Promise<{ key: Uint8Array }>; getQuote(rd: Uint8Array): Promise<{ quote: string }>; info(): Promise<any> }`
  - `class DevTee implements Tee`
  - `reportDataForPubkey(pub: Uint8Array): Uint8Array` (64 bytes: sha256(pub) then zeros)
  - `buildAttestResponse(tee: Tee, kp: Keypair): Promise<{ quote_hex: string; provisioning_pubkey_hex: string }>`

- [ ] **Step 1: Failing tests**

`indexer/test/dstack.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { connectTee, DevTee } from '../src/dstack';

const seedHex = '66'.repeat(32);
const fake = (reachable: boolean) => ({
  isReachable: async () => reachable,
  getKey: async () => ({ key: new Uint8Array(32).fill(1) }),
  getQuote: async () => ({ quote: 'aabb' }),
  info: async () => ({ tcb_info: { mrtd: 'cc'.repeat(48) } }),
});

describe('connectTee', () => {
  it('uses the real client when reachable and no dev seed is set', async () => {
    const tee = await connectTee({ client: fake(true) });
    expect(tee.isDev).toBe(false);
    expect((await tee.getKey('blindfold/provisioning')).length).toBe(32);
    expect(await tee.getQuote(new Uint8Array(64))).toBe('aabb');
  });
  it('refuses a dev seed when a real TEE is reachable', async () => {
    await expect(connectTee({ client: fake(true), devSeedHex: seedHex })).rejects.toThrow(/dev seed/);
  });
  it('falls back to DevTee when unreachable and a dev seed is set', async () => {
    const tee = await connectTee({ client: fake(false), devSeedHex: seedHex });
    expect(tee.isDev).toBe(true);
    expect(Buffer.from(await tee.getKey('x')).toString('hex')).toBe(seedHex);
    expect(await tee.getQuote(new Uint8Array(64))).toBe('dev');
  });
  it('fails when unreachable and no dev seed', async () => {
    await expect(connectTee({ client: fake(false) })).rejects.toThrow(/unreachable/);
  });
  it('DevTee rejects a non-32-byte seed', () => {
    expect(() => new DevTee('abcd')).toThrow(/64 hex/);
  });
});
```

`indexer/test/attest.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { buildAttestResponse, reportDataForPubkey } from '../src/attest';
import { DevTee } from '../src/dstack';
import { keypairFromSeed, sha256, sodiumReady, toHex, fromHex } from '../src/keys';

beforeAll(sodiumReady);

describe('attest', () => {
  it('report_data is sha256(pubkey) zero-padded to 64 bytes', () => {
    const kp = keypairFromSeed(fromHex('77'.repeat(32)));
    const rd = reportDataForPubkey(kp.publicKey);
    expect(rd.length).toBe(64);
    expect(toHex(rd.subarray(0, 32))).toBe(toHex(sha256(kp.publicKey)));
    expect(rd.subarray(32).every((b) => b === 0)).toBe(true);
  });
  it('response carries the pubkey and the quote for that report_data', async () => {
    const kp = keypairFromSeed(fromHex('77'.repeat(32)));
    const seen: Uint8Array[] = [];
    const tee = { isDev: false, getKey: async () => new Uint8Array(32), measurement: async () => 'm',
      getQuote: async (rd: Uint8Array) => { seen.push(rd); return 'q1'; } };
    const r = await buildAttestResponse(tee, kp);
    expect(r).toEqual({ quote_hex: 'q1', provisioning_pubkey_hex: toHex(kp.publicKey) });
    expect(toHex(seen[0])).toBe(toHex(reportDataForPubkey(kp.publicKey)));
  });
  it('DevTee yields quote "dev"', async () => {
    const kp = keypairFromSeed(fromHex('77'.repeat(32)));
    expect((await buildAttestResponse(new DevTee('77'.repeat(32)), kp)).quote_hex).toBe('dev');
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `indexer/src/dstack.ts`**

```ts
import { DstackClient } from '@phala/dstack-sdk';
import { fromHex } from './keys';

export interface Tee {
  readonly isDev: boolean;
  getKey(path: string): Promise<Uint8Array>;
  getQuote(reportData: Uint8Array): Promise<string>;
  measurement(): Promise<string>;
}

export type DstackLike = {
  isReachable(): Promise<boolean>;
  getKey(path: string): Promise<{ key: Uint8Array }>;
  getQuote(reportData: Uint8Array): Promise<{ quote: string }>;
  info(): Promise<any>;
};

class DstackTee implements Tee {
  readonly isDev = false;
  constructor(private readonly c: DstackLike) {}
  async getKey(path: string): Promise<Uint8Array> {
    const { key } = await this.c.getKey(path);
    if (key.length !== 32) throw new Error(`dstack key is ${key.length} bytes, expected 32`);
    return new Uint8Array(key);
  }
  async getQuote(reportData: Uint8Array): Promise<string> {
    const { quote } = await this.c.getQuote(reportData);
    return quote.replace(/^0x/, '');
  }
  async measurement(): Promise<string> {
    const info = await this.c.info();
    const tcb = typeof info.tcb_info === 'string' ? JSON.parse(info.tcb_info) : info.tcb_info;
    return tcb?.mrtd ?? tcb?.rtmr3 ?? 'unknown';
  }
}

/** Outside a CVM: the seed comes from configuration and quotes are the literal "dev". */
export class DevTee implements Tee {
  readonly isDev = true;
  private readonly seed: Uint8Array;
  constructor(seedHex: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) throw new Error('DEV_SEED_HEX must be 64 hex chars');
    this.seed = fromHex(seedHex);
  }
  async getKey(): Promise<Uint8Array> { return new Uint8Array(this.seed); }
  async getQuote(): Promise<string> { return 'dev'; }
  async measurement(): Promise<string> { return 'dev'; }
}

export async function connectTee(opts: { endpoint?: string; devSeedHex?: string; client?: DstackLike } = {}): Promise<Tee> {
  const client: DstackLike = opts.client ?? (new DstackClient(opts.endpoint) as unknown as DstackLike);
  const reachable = await client.isReachable().catch(() => false);
  if (reachable && opts.devSeedHex) throw new Error('refusing to start: a dev seed is set but a real TEE is reachable');
  if (reachable) return new DstackTee(client);
  if (opts.devSeedHex) return new DevTee(opts.devSeedHex);
  throw new Error('dstack is unreachable and no DEV_SEED_HEX is set');
}
```

`indexer/src/attest.ts`:

```ts
import type { Tee } from './dstack';
import { sha256, toHex, type Keypair } from './keys';

export type AttestResponse = { quote_hex: string; provisioning_pubkey_hex: string };

/** TDX report_data slot is 64 bytes: sha256(pubkey) then zero padding. The creator checks the first 32. */
export function reportDataForPubkey(pub: Uint8Array): Uint8Array {
  const out = new Uint8Array(64); out.set(sha256(pub), 0); return out;
}

export async function buildAttestResponse(tee: Pick<Tee, 'getQuote'>, kp: Keypair): Promise<AttestResponse> {
  return { quote_hex: await tee.getQuote(reportDataForPubkey(kp.publicKey)), provisioning_pubkey_hex: toHex(kp.publicKey) };
}
```

- [ ] **Step 4: Run to verify pass.** **Step 5: Commit** — `git commit -m "feat(indexer): dstack TEE wrapper with dev fallback and attestation response"`

---

### Task 11: `watcher.ts`

**Files:**
- Create: `indexer/src/watcher.ts`, `indexer/test/watcher.test.ts`

**Interfaces:**
- Consumes: `LedgerReader`, `Engine`, `Catalog`.
- Produces:
  - `type DispatchedState = { dispatched: Record<string, string>; pending: string[] }` (keys are decimal purchase indexes)
  - `class DispatchedStore { constructor(file: string); load(): Promise<DispatchedState>; save(s): Promise<void> }`
  - `class Watcher { constructor(deps: { reader: LedgerReader; engine: Engine; store: DispatchedStore; log?: (m: string) => void }); tick(): Promise<{ dispatched: number; pending: number }>; start(pollMs: number): void; stop(): void }`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Catalog } from '../src/catalog';
import { MemoryBucket } from '../src/bucket';
import { Engine } from '../src/engine';
import { StaticLedgerReader, type LedgerSnapshot } from '../src/chain';
import { DispatchedStore, Watcher } from '../src/watcher';
import { sodiumReady } from '../src/keys';

beforeAll(sodiumReady);
const ePub = (n: number) => new Uint8Array(32).fill(n);
const snap = (purchases: [bigint, bigint][]): LedgerSnapshot => ({
  drops: new Map([[1n, 5n], [2n, 5n]]), kCommit: new Map(),
  purchaseCount: BigInt(purchases.length),
  purchases: new Map(purchases.map(([i], n) => [i, ePub(n + 1)])),
  purchaseDrop: new Map(purchases),
});
function setup() {
  const catalog = new Catalog();
  catalog.upsert({ dropId: 1n, priceStar: 5n, kDrop: new Uint8Array(32), hContent: 'aa'.repeat(32), title: 't' });
  const bucket = new MemoryBucket();
  const store = new DispatchedStore(join(mkdtempSync(join(tmpdir(), 'bf-w-')), 'dispatched.json'));
  return { catalog, bucket, store, engine: new Engine(catalog, bucket) };
}

describe('Watcher', () => {
  it('dispatches new purchases once and persists progress', async () => {
    const { bucket, store, engine } = setup();
    const reader = new StaticLedgerReader(snap([[0n, 1n], [1n, 1n]]));
    const w = new Watcher({ reader, engine, store });
    expect(await w.tick()).toEqual({ dispatched: 2, pending: 0 });
    expect((await bucket.list()).length).toBe(2);
    expect(await w.tick()).toEqual({ dispatched: 0, pending: 0 });
    const state = await store.load();
    expect(Object.keys(state.dispatched).sort()).toEqual(['0', '1']);
  });
  it('resumes from the store after a restart', async () => {
    const { bucket, store, engine } = setup();
    const reader = new StaticLedgerReader(snap([[0n, 1n]]));
    await new Watcher({ reader, engine, store }).tick();
    reader.set(snap([[0n, 1n], [1n, 1n]]));
    expect(await new Watcher({ reader, engine, store }).tick()).toEqual({ dispatched: 1, pending: 0 });
    expect((await bucket.list()).length).toBe(2);
  });
  it('keeps unprovisioned purchases pending and dispatches them once provisioned', async () => {
    const { catalog, store, engine } = setup();
    const reader = new StaticLedgerReader(snap([[0n, 2n]]));
    const w = new Watcher({ reader, engine, store });
    expect(await w.tick()).toEqual({ dispatched: 0, pending: 1 });
    catalog.upsert({ dropId: 2n, priceStar: 5n, kDrop: new Uint8Array(32).fill(3), hContent: 'bb'.repeat(32), title: 'u' });
    expect(await w.tick()).toEqual({ dispatched: 1, pending: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `indexer/src/watcher.ts`**

```ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LedgerReader } from './chain';
import type { Engine } from './engine';

export type DispatchedState = { dispatched: Record<string, string>; pending: string[] };

export class DispatchedStore {
  constructor(private readonly file: string) {}
  async load(): Promise<DispatchedState> {
    try { return JSON.parse(await readFile(this.file, 'utf8')); }
    catch (e: any) { if (e?.code === 'ENOENT') return { dispatched: {}, pending: [] }; throw e; }
  }
  async save(s: DispatchedState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(s));
    await rename(tmp, this.file);
  }
}

export class Watcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private state: DispatchedState | null = null;
  private readonly log: (m: string) => void;
  constructor(private readonly deps: { reader: LedgerReader; engine: Engine; store: DispatchedStore; log?: (m: string) => void }) {
    this.log = deps.log ?? (() => {});
  }

  async tick(): Promise<{ dispatched: number; pending: number }> {
    this.state ??= await this.deps.store.load();
    const snap = await this.deps.reader.read();
    const todo = new Set<bigint>(this.state.pending.map(BigInt));
    for (let i = 0n; i < snap.purchaseCount; i++) if (!(i.toString() in this.state.dispatched)) todo.add(i);
    let dispatched = 0; const pending: string[] = [];
    for (const i of [...todo].sort((a, b) => (a < b ? -1 : 1))) {
      const ePub = snap.purchases.get(i); const dropId = snap.purchaseDrop.get(i);
      if (!ePub || dropId === undefined) { pending.push(i.toString()); continue; }
      const res = await this.deps.engine.dispatch(i, dropId, ePub);
      if ('key' in res) { this.state.dispatched[i.toString()] = res.key; dispatched++; this.log(`dispatched purchase ${i} (drop ${dropId}) -> ${res.key.slice(0, 12)}…`); }
      else { pending.push(i.toString()); this.log(`purchase ${i} waits for drop ${dropId} to be provisioned`); }
    }
    this.state.pending = pending;
    await this.deps.store.save(this.state);
    return { dispatched, pending: pending.length };
  }

  start(pollMs: number): void {
    const loop = async () => {
      if (this.running) return; this.running = true;
      try { await this.tick(); this.timer = setTimeout(loop, pollMs); }
      catch (e) { this.log(`watcher error: ${(e as Error).message}; retrying in 30s`); this.timer = setTimeout(loop, 30_000); }
      finally { this.running = false; }
    };
    void loop();
  }
  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
```

- [ ] **Step 4: Run to verify pass.** **Step 5: Commit** — `git commit -m "feat(indexer): ledger watcher with persisted progress and pending purchases"`

---

### Task 12: `config.ts`, `server.ts`, `main.ts`

**Files:**
- Create: `indexer/src/config.ts`, `indexer/src/server.ts`, `indexer/src/main.ts`, `indexer/test/server.test.ts`, `indexer/.env.example`

**Interfaces:**
- Produces: HTTP surface per spec section 6 and 7. `buildServer(deps: ServerDeps): FastifyInstance` where `ServerDeps = { tee: Tee; kp: Keypair; catalog: Catalog; content: Bucket; dispatch: Bucket; reader: LedgerReader; network: string; contractAddress: string }`.

- [ ] **Step 1: Failing server tests**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { Catalog } from '../src/catalog';
import { MemoryBucket } from '../src/bucket';
import { DevTee } from '../src/dstack';
import { StaticLedgerReader } from '../src/chain';
import { keypairFromSeed, sodiumReady, sha256, fromHex, toHex } from '../src/keys';
import { sealProvision } from '../src/provision';

beforeAll(sodiumReady);
const seed = '88'.repeat(32);
const kDrop = fromHex('99'.repeat(32));
const content = new Uint8Array(64).fill(1);
const hContent = toHex(sha256(content));

function app() {
  const kp = keypairFromSeed(fromHex(seed));
  const reader = new StaticLedgerReader({ drops: new Map([[1n, 10n]]), kCommit: new Map([[1n, sha256(kDrop)]]), purchaseCount: 0n, purchases: new Map(), purchaseDrop: new Map() });
  const deps = { tee: new DevTee(seed), kp, catalog: new Catalog(), content: new MemoryBucket(), dispatch: new MemoryBucket(), reader, network: 'undeployed', contractAddress: 'ab'.repeat(32) };
  return { server: buildServer(deps), deps, kp };
}

describe('server', () => {
  it('GET /health, /contract, /attest', async () => {
    const { server, kp } = app();
    expect((await server.inject({ method: 'GET', url: '/health' })).body).toBe('ok');
    expect((await server.inject({ method: 'GET', url: '/contract' })).json()).toEqual({ network: 'undeployed', contract_address: 'ab'.repeat(32) });
    const a = (await server.inject({ method: 'GET', url: '/attest' })).json();
    expect(a).toEqual({ quote_hex: 'dev', provisioning_pubkey_hex: toHex(kp.publicKey) });
  });
  it('PUT /bucket verifies the hash; GET returns bytes; bad keys 400/404', async () => {
    const { server } = app();
    expect((await server.inject({ method: 'PUT', url: `/bucket/${hContent}`, payload: Buffer.from(content), headers: { 'content-type': 'application/octet-stream' } })).statusCode).toBe(200);
    expect((await server.inject({ method: 'PUT', url: `/bucket/${'00'.repeat(32)}`, payload: Buffer.from(content), headers: { 'content-type': 'application/octet-stream' } })).statusCode).toBe(400);
    const r = await server.inject({ method: 'GET', url: `/bucket/${hContent}` });
    expect(r.statusCode).toBe(200); expect(r.rawPayload.equals(Buffer.from(content))).toBe(true);
    expect((await server.inject({ method: 'GET', url: '/bucket/zz' })).statusCode).toBe(404);
  });
  it('POST /provision validates and publishes to the catalog', async () => {
    const { server, kp } = app();
    await server.inject({ method: 'PUT', url: `/bucket/${hContent}`, payload: Buffer.from(content), headers: { 'content-type': 'application/octet-stream' } });
    const payload = { drop_id: 1, price_star: '10', k_drop: toHex(kDrop), h_content: hContent, title: 'cat' };
    const ok = await server.inject({ method: 'POST', url: '/provision', payload: Buffer.from(sealProvision(payload, kp.publicKey)), headers: { 'content-type': 'application/octet-stream' } });
    expect(ok.statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/catalog' })).json()).toEqual([{ drop_id: 1, price_star: '10', title: 'cat', h_content: hContent }]);
    const wrongPrice = await server.inject({ method: 'POST', url: '/provision', payload: Buffer.from(sealProvision({ ...payload, price_star: '11' }, kp.publicKey)), headers: { 'content-type': 'application/octet-stream' } });
    expect(wrongPrice.statusCode).toBe(409);
    const unknown = await server.inject({ method: 'POST', url: '/provision', payload: Buffer.from(sealProvision({ ...payload, drop_id: 7 }, kp.publicKey)), headers: { 'content-type': 'application/octet-stream' } });
    expect(unknown.statusCode).toBe(404);
    const garbage = await server.inject({ method: 'POST', url: '/provision', payload: Buffer.from([1, 2, 3]), headers: { 'content-type': 'application/octet-stream' } });
    expect(garbage.statusCode).toBe(400);
  });
  it('GET /dispatch lists keys and serves blobs', async () => {
    const { server, deps } = app();
    await deps.dispatch.put('aa'.repeat(32), new Uint8Array(80));
    expect((await server.inject({ method: 'GET', url: '/dispatch' })).json()).toEqual(['aa'.repeat(32)]);
    expect((await server.inject({ method: 'GET', url: `/dispatch/${'aa'.repeat(32)}` })).rawPayload.length).toBe(80);
    expect((await server.inject({ method: 'GET', url: `/dispatch/${'bb'.repeat(32)}` })).statusCode).toBe(404);
  });
  it('sets CORS headers', async () => {
    const { server } = app();
    const r = await server.inject({ method: 'OPTIONS', url: '/catalog', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' } });
    expect(r.headers['access-control-allow-origin']).toBe('*');
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `indexer/src/config.ts`**

```ts
export type Config = {
  network: 'undeployed' | 'preview' | 'preprod';
  contractAddress: string;
  indexerUrl: string;
  indexerWsUrl: string;
  dstackEndpoint?: string;
  devSeedHex?: string;
  dataDir: string;
  port: number;
  pollMs: number;
};

const DEFAULTS: Record<Config['network'], { indexerUrl: string; indexerWsUrl: string }> = {
  undeployed: { indexerUrl: 'http://127.0.0.1:8088/api/v4/graphql', indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws' },
  preview: { indexerUrl: 'https://indexer.preview.midnight.network/api/v4/graphql', indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws' },
  preprod: { indexerUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql', indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws' },
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const network = (env.NETWORK ?? 'undeployed') as Config['network'];
  if (!(network in DEFAULTS)) throw new Error(`NETWORK must be undeployed|preview|preprod, got ${network}`);
  const contractAddress = env.CONTRACT_ADDRESS?.trim();
  if (!contractAddress || !/^[0-9a-fA-F]{64}$/.test(contractAddress)) throw new Error('CONTRACT_ADDRESS must be 64 hex chars');
  return {
    network, contractAddress,
    indexerUrl: env.MIDNIGHT_INDEXER_URL ?? DEFAULTS[network].indexerUrl,
    indexerWsUrl: env.MIDNIGHT_INDEXER_WS_URL ?? DEFAULTS[network].indexerWsUrl,
    dstackEndpoint: env.DSTACK_ENDPOINT,
    devSeedHex: env.DEV_SEED_HEX,
    dataDir: env.DATA_DIR ?? './data',
    port: Number(env.PORT ?? 8080),
    pollMs: Number(env.POLL_MS ?? 3000),
  };
}
```

`indexer/.env.example`:

```
NETWORK=undeployed
CONTRACT_ADDRESS=
# local only; never set inside a CVM
DEV_SEED_HEX=1111111111111111111111111111111111111111111111111111111111111111
DATA_DIR=./data
PORT=8080
POLL_MS=3000
```

- [ ] **Step 4: Implement `indexer/src/server.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Bucket } from './bucket';
import { isValidKey } from './bucket';
import type { Catalog } from './catalog';
import type { LedgerReader } from './chain';
import type { Tee } from './dstack';
import { buildAttestResponse } from './attest';
import { sha256, toHex, type Keypair } from './keys';
import { openProvision, validateProvision, ProvisionError } from './provision';

export type ServerDeps = {
  tee: Tee; kp: Keypair; catalog: Catalog; content: Bucket; dispatch: Bucket; reader: LedgerReader;
  network: string; contractAddress: string;
};

const STATUS: Record<ProvisionError['code'], number> = {
  bad_seal: 400, bad_payload: 400, unknown_drop: 404, content_missing: 404, price_mismatch: 409, commit_mismatch: 409,
};

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ bodyLimit: 50 * 1024 * 1024, logger: false });
  app.register(cors, { origin: '*', methods: ['GET', 'PUT', 'POST', 'OPTIONS'] });
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.get('/health', async () => 'ok');
  app.get('/contract', async () => ({ network: deps.network, contract_address: deps.contractAddress }));
  app.get('/attest', async (_req, reply) => {
    try { return await buildAttestResponse(deps.tee, deps.kp); }
    catch (e) { reply.code(503); return { error: (e as Error).message }; }
  });
  app.get('/catalog', async () => deps.catalog.publicEntries());

  app.post('/provision', async (req, reply) => {
    const body = req.body as Buffer | undefined;
    if (!body || !Buffer.isBuffer(body)) { reply.code(400); return { error: 'expected application/octet-stream body' }; }
    try {
      const payload = openProvision(new Uint8Array(body), deps.kp);
      const cfg = await validateProvision(payload, await deps.reader.read(), deps.content);
      deps.catalog.upsert(cfg);
      return { ok: true, drop_id: payload.drop_id };
    } catch (e) {
      if (e instanceof ProvisionError) { reply.code(STATUS[e.code]); return { error: e.code, message: e.message }; }
      reply.code(500); return { error: 'internal' };
    }
  });

  app.get('/dispatch', async () => deps.dispatch.list());
  app.get<{ Params: { key: string } }>('/dispatch/:key', async (req, reply) => {
    const b = await deps.dispatch.get(req.params.key);
    if (!b) { reply.code(404); return { error: 'not found' }; }
    reply.type('application/octet-stream'); return Buffer.from(b);
  });

  app.get<{ Params: { key: string } }>('/bucket/:key', async (req, reply) => {
    const b = await deps.content.get(req.params.key);
    if (!b) { reply.code(404); return { error: 'not found' }; }
    reply.type('application/octet-stream'); return Buffer.from(b);
  });
  app.put<{ Params: { key: string } }>('/bucket/:key', async (req, reply) => {
    const body = req.body as Buffer | undefined;
    const key = req.params.key.toLowerCase();
    if (!body || !Buffer.isBuffer(body) || !isValidKey(key) || key.length !== 64) { reply.code(400); return { error: 'key must be sha256 hex and body octet-stream' }; }
    if (toHex(sha256(new Uint8Array(body))) !== key) { reply.code(400); return { error: 'body sha256 does not match key' }; }
    await deps.content.put(key, new Uint8Array(body));
    return { ok: true };
  });
  return app;
}
```

- [ ] **Step 5: Implement `indexer/src/main.ts`**

```ts
import { join } from 'node:path';
import { loadConfig } from './config';
import { connectTee } from './dstack';
import { keypairFromSeed, sodiumReady, toHex } from './keys';
import { FsBucket } from './bucket';
import { Catalog } from './catalog';
import { MidnightLedgerReader } from './chain';
import { Engine } from './engine';
import { DispatchedStore, Watcher } from './watcher';
import { buildServer } from './server';

await sodiumReady();
const cfg = loadConfig();
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

const tee = await connectTee({ endpoint: cfg.dstackEndpoint, devSeedHex: cfg.devSeedHex });
log(`tee: ${tee.isDev ? 'DEV (no attestation)' : 'dstack'}`);
const kp = keypairFromSeed(await tee.getKey('blindfold/provisioning'));
log(`provisioning pubkey ${toHex(kp.publicKey)}`);

const reader = new MidnightLedgerReader({ indexerUrl: cfg.indexerUrl, indexerWsUrl: cfg.indexerWsUrl, contractAddress: cfg.contractAddress, networkId: cfg.network });
const first = await reader.read(); // fails fast if the address has no state
log(`contract ${cfg.contractAddress} on ${cfg.network}: ${first.drops.size} drops, ${first.purchaseCount} purchases`);

const catalog = new Catalog();
const content = new FsBucket(join(cfg.dataDir, 'content'));
const dispatch = new FsBucket(join(cfg.dataDir, 'dispatch'));
const engine = new Engine(catalog, dispatch);
const watcher = new Watcher({ reader, engine, store: new DispatchedStore(join(cfg.dataDir, 'dispatched.json')), log });

const server = buildServer({ tee, kp, catalog, content, dispatch, reader, network: cfg.network, contractAddress: cfg.contractAddress });
await server.listen({ port: cfg.port, host: '0.0.0.0' });
log(`listening on :${cfg.port}`);
watcher.start(cfg.pollMs);

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { watcher.stop(); await server.close(); process.exit(0); });
```

- [ ] **Step 6: Run the server tests and type-check**

Run: `cd indexer && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 7: Run against the devnet end to end**

With the devnet up and a contract deployed (Task 2's `CONTRACT_ADDRESS`):

```bash
cd indexer && NETWORK=undeployed CONTRACT_ADDRESS=<addr> DEV_SEED_HEX=$(printf '11%.0s' $(seq 32)) DATA_DIR=/tmp/bf-data npm start
```
In another shell: `curl -s localhost:8080/attest` returns `{"quote_hex":"dev","provisioning_pubkey_hex":"…"}`; run the contract flow test's purchase (or `contract/test/flow.test.ts`) and watch the log print `dispatched purchase 0 …` within one poll after a drop is provisioned through `POST /provision` (use the Task 9 `sealProvision` helper in a small script or wait for Lane C).

- [ ] **Step 8: Commit**

```bash
git add indexer
git commit -m "feat(indexer): HTTP server, config, and main wiring"
```

---

### Task 13: Dockerfile and dstack simulator check

**Files:**
- Create: `indexer/Dockerfile`, `indexer/.dockerignore`, `indexer/test/simulator.test.ts`

- [ ] **Step 1: Dockerfile**

```dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY contract/package.json contract/package.json
COPY indexer/package.json indexer/package.json
RUN npm ci --workspace contract --workspace indexer --include-workspace-root
COPY contract/build contract/build
COPY indexer indexer
RUN cd indexer && npx tsc --noEmit

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
VOLUME ["/data"]
EXPOSE 8080
CMD ["npx", "tsx", "indexer/src/main.ts"]
```

Build from the repo root (the compose file in Lane D does this): `docker build -f indexer/Dockerfile -t blindfold-indexer .` after `npm run compile`. `.dockerignore`: `node_modules`, `data`, `*.log`.

- [ ] **Step 2: Simulator test (skipped unless `DSTACK_SIMULATOR_ENDPOINT` is set)**

```ts
import { describe, it, expect } from 'vitest';
import { connectTee } from '../src/dstack';
import { reportDataForPubkey } from '../src/attest';

describe.skipIf(!process.env.DSTACK_SIMULATOR_ENDPOINT)('dstack simulator', () => {
  it('derives a stable key and returns a quote', async () => {
    const tee = await connectTee({ endpoint: process.env.DSTACK_SIMULATOR_ENDPOINT });
    expect(tee.isDev).toBe(false);
    const a = await tee.getKey('blindfold/provisioning'); const b = await tee.getKey('blindfold/provisioning');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const q = await tee.getQuote(reportDataForPubkey(new Uint8Array(32)));
    expect(q.length).toBeGreaterThan(100);
  });
});
```

Run: `npx phala simulator start` (port 8090) then `DSTACK_SIMULATOR_ENDPOINT=http://localhost:8090 npx vitest run test/simulator.test.ts`. Expected: PASS. Record the exact endpoint form that worked in `spike/NOTES.md` (the SDK also reads `DSTACK_SIMULATOR_ENDPOINT` itself).

- [ ] **Step 3: Commit** — `git commit -m "build(indexer): Dockerfile and dstack simulator test"`

---

## Self-review

- Spec coverage: section 5 (Task 1, 3), section 6 I2 (Task 7), I3 (Task 6, 12), I4 (Task 12 bucket PUT with hash check), I5 (Task 9, 12), I6 (Task 10, 12), `GET /contract` (Task 12), section 7 modules (Tasks 4 to 12, one each; `main.ts` startup order in Task 12 Step 5), section 10 Dockerfile (Task 13), section 11 contract flow and negatives (Task 3), indexer unit tests (Tasks 4 to 12), simulator integration (Task 13), vectors (Task 4).
- Placeholders: none. Every code step is complete.
- Type consistency: `Keypair`, `LedgerSnapshot`, `DropConfig`, `ProvisionPayload`, `Tee`, `Bucket` names match across Tasks 4 to 12; `dispatchKey(ekPub, index)` matches the spec's `blake2b256(ek_pub ‖ index_be64)`; `buildAttestResponse` returns exactly `{ quote_hex, provisioning_pubkey_hex }` as the creator app expects.
