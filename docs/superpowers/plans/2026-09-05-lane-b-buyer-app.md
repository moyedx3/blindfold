# Lane B: Shared Wallet Package and Buyer App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/midnight-web` (wallet connection, midnight-js providers, contract client shared by both apps) and `buyer/`, the web app where a buyer connects a Midnight wallet, pays for a drop with shielded NIGHT, and decrypts the content.

**Architecture:** The buyer app is the earlier prototype's buyer app with its payment step replaced: instead of showing a payment request, it calls the contract's `purchase` circuit through the wallet with a fresh one-time key. Polling the indexer for the sealed key, trial-opening it, hashing and decrypting the content, and the recovery file are carried over unchanged. A fake wallet and a mock indexer let the whole flow run in a browser test with no chain.

**Tech Stack:** React 19, Vite 7, TypeScript 5.9, libsodium-wrappers 0.7.15, @midnight-ntwrk/dapp-connector-api 4.0.1, @midnight-ntwrk/midnight-js 4.1.1 (barrel), fetch-zk-config-provider / http-client-proof-provider / indexer-public-data-provider / level-private-state-provider 4.1.1, @midnight-ntwrk/ledger-v8 8.1.0, compact-js 2.5.1, compact-runtime 0.16.0, vitest 4, Playwright 1.61.

**Spec:** `docs/superpowers/specs/2026-09-05-blindfold-design.md` (sections 6, 8, 11)

## Global Constraints

- Node.js >= 22, npm workspaces, ESM, TypeScript `strict: true`.
- Pinned Midnight packages (exact): `@midnight-ntwrk/dapp-connector-api` 4.0.1, `@midnight-ntwrk/midnight-js` 4.1.1, `@midnight-ntwrk/midnight-js-fetch-zk-config-provider` 4.1.1, `@midnight-ntwrk/midnight-js-http-client-proof-provider` 4.1.1, `@midnight-ntwrk/midnight-js-indexer-public-data-provider` 4.1.1, `@midnight-ntwrk/midnight-js-level-private-state-provider` 4.1.1, `@midnight-ntwrk/midnight-js-network-id` 4.1.1, `@midnight-ntwrk/compact-js` 2.5.1, `@midnight-ntwrk/compact-runtime` 0.16.0, `@midnight-ntwrk/ledger-v8` 8.1.0, `@midnight-ntwrk/wallet-sdk-address-format` 3.1.0. Root `overrides` pins `@midnight-ntwrk/onchain-runtime-v3` to 3.0.0.
- Browser polyfills exactly as in the official `midnightntwrk/midnight-wallet-dapp`: `buffer`, `process`, `util`, `stream-browserify`, `events`, a `crypto` alias to a crypto-browserify shim, `vite-plugin-wasm`, `vite-plugin-static-copy`; `optimizeDeps.include` for `level` packages; `build.target: 'esnext'`.
- Compiled contract artifacts are served from `/contract/blindfold/` (copied from `contract/build/blindfold` at dev/build time). Lane A Task 1 must be merged (or run `npm run compile -w contract` from the spike contract) before building.
- Wire formats (spec section 6): `ePub` is a libsodium `crypto_box_keypair` public key; the purchase coin is `{ nonce: 32 random bytes, color: 32 zero bytes, value: price }`; the dispatch blob is 80 bytes and opens with `crypto_box_seal_open(blob, ePub, ePriv)`; content is `nonce(12) ‖ AES-256-GCM ‖ tag(16)` with `h_content = sha256(blob)`.
- Indexer HTTP surface: `GET /contract` `{network, contract_address}`, `GET /catalog` `[{drop_id, price_star, title, h_content}]`, `GET /dispatch` `string[]`, `GET /dispatch/:key`, `GET /bucket/:key`.
- `1 NIGHT = 1_000_000 STAR`. Prices display as NIGHT with up to 6 decimals.
- Never log or persist wallet keys. `e_priv` persists only in localStorage (24 h, opt-in) and the recovery file, as before.
- Tests: vitest for modules, Playwright for the smoke. Commit after every task.

---

## File structure

```
packages/midnight-web/
  package.json                 name @blindfold/midnight-web
  src/index.ts                 re-exports
  src/wallet.ts                listWallets, connectWallet, balances, explainWalletError
  src/providers.ts             buildProviders (Lace/1AM adapter + zk assets + proof provider)
  src/contract.ts              readLedger, nightCoin, connectContract -> BlindfoldClient
  src/fake.ts                  FakeConnectedWallet + FakeBlindfoldClient for tests and smoke runs
  src/crypto-shim.ts           copied from the official wallet-dapp
  src/polyfills.ts             copied from the official wallet-dapp
  test/wallet.test.ts, test/contract.test.ts
buyer/
  package.json, index.html, vite.config.ts, tsconfig.json, vitest.config.ts, playwright.config.ts
  src/main.tsx                 imports polyfills first, mounts App
  src/App.tsx                  catalog -> connect -> buy -> waiting -> unlocked; manual unlock
  src/api.ts                   HttpDropApi + fetchContract (+ MockDropApi in mockApi.ts)
  src/mockApi.ts               in-memory indexer used when VITE_FAKE_WALLET=1
  src/bytes.ts, seal.ts, content.ts, persist.ts, poller.ts, render.ts   carried over
  src/purchase.ts              Purchase type with txId, no deposit address
  src/buy.ts                   orchestrates keypair + contract purchase
  src/price.ts                 STAR -> NIGHT display
  src/styles.css               carried over
  test/*.test.ts, e2e/buy.spec.ts
```

---

### Task 1: `packages/midnight-web`: wallet connection

**Files:**
- Create: `packages/midnight-web/package.json`, `packages/midnight-web/tsconfig.json`, `packages/midnight-web/vitest.config.ts`, `packages/midnight-web/src/wallet.ts`, `packages/midnight-web/src/polyfills.ts`, `packages/midnight-web/src/crypto-shim.ts`, `packages/midnight-web/test/wallet.test.ts`

**Interfaces:**
- Produces:
  - `type WalletChoice = { key: string; name: string; apiVersion: string; api: InitialAPI }`
  - `listWallets(win?: { midnight?: Record<string, unknown> }): WalletChoice[]`
  - `type ConnectedWallet = { name: string; api: ConnectedAPI; networkId: string; indexerUri: string; indexerWsUri: string; proverServerUri?: string; shieldedAddress: string; coinPublicKey: string; encryptionPublicKey: string }`
  - `connectWallet(networkId: string, choice: WalletChoice): Promise<ConnectedWallet>`
  - `balances(w: ConnectedWallet): Promise<{ shieldedNight: bigint; unshieldedNight: bigint; dust: bigint; dustCap: bigint }>`
  - `explainWalletError(e: unknown): string`
  - `NATIVE_RAW = '0'.repeat(64)`

- [ ] **Step 1: Package files**

`packages/midnight-web/package.json`:

```json
{
  "name": "@blindfold/midnight-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./polyfills": "./src/polyfills.ts", "./crypto-shim": "./src/crypto-shim.ts" },
  "scripts": { "test": "vitest run", "build": "tsc --noEmit" },
  "dependencies": {
    "@blindfold/contract": "*",
    "@midnight-ntwrk/compact-js": "2.5.1",
    "@midnight-ntwrk/compact-runtime": "0.16.0",
    "@midnight-ntwrk/dapp-connector-api": "4.0.1",
    "@midnight-ntwrk/ledger-v8": "8.1.0",
    "@midnight-ntwrk/midnight-js": "4.1.1",
    "@midnight-ntwrk/midnight-js-fetch-zk-config-provider": "4.1.1",
    "@midnight-ntwrk/midnight-js-http-client-proof-provider": "4.1.1",
    "@midnight-ntwrk/midnight-js-indexer-public-data-provider": "4.1.1",
    "@midnight-ntwrk/midnight-js-level-private-state-provider": "4.1.1",
    "@midnight-ntwrk/midnight-js-network-id": "4.1.1",
    "buffer": "^6.0.3",
    "crypto-browserify": "^3.12.0",
    "events": "^3.3.0",
    "level": "^10.0.0",
    "process": "^0.11.10",
    "stream-browserify": "^3.0.0",
    "util": "^0.12.5"
  },
  "devDependencies": { "typescript": "^5.9.3", "vitest": "^4.1.9", "jsdom": "^26.0.0" },
  "overrides": { "@midnight-ntwrk/onchain-runtime-v3": "3.0.0" }
}
```

`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "lib": ["ES2022", "DOM"], "module": "ESNext", "moduleResolution": "Bundler", "types": [] }, "include": ["src", "test"] }`
`vitest.config.ts`: `import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { environment: 'jsdom' } });`

Copy `src/polyfills.ts` and `src/crypto-shim.ts` verbatim from `spike/web/src/polyfills.ts` and `spike/web/src/lib/crypto-shim.ts` (they are the official wallet-dapp files).

- [ ] **Step 2: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { listWallets, explainWalletError, connectWallet } from '../src/wallet';

const fakeApi = (name: string) => ({ name, icon: 'data:,', apiVersion: '4.0.1', connect: async () => connected });
const connected = {
  getConfiguration: async () => ({ networkId: 'undeployed', indexerUri: 'http://i', indexerWsUri: 'ws://i', proverServerUri: 'http://localhost:6300' }),
  getShieldedAddresses: async () => ({ shieldedAddress: 'mn_shield-addr_undeployed1x', shieldedCoinPublicKey: 'aa', shieldedEncryptionPublicKey: 'bb' }),
  getShieldedBalances: async () => ({ ['0'.repeat(64)]: 5n }),
  getUnshieldedBalances: async () => ({ ['0'.repeat(64)]: 7n }),
  getDustBalance: async () => ({ balance: 1n, cap: 9n }),
};

describe('listWallets', () => {
  it('returns only injected objects that look like Initial APIs', () => {
    const win = { midnight: { mnLace: fakeApi('lace'), junk: { name: 1 }, oneam: fakeApi('1am') } };
    expect(listWallets(win).map((w) => w.name).sort()).toEqual(['1am', 'lace']);
  });
  it('returns [] without window.midnight', () => { expect(listWallets({})).toEqual([]); });
});

describe('connectWallet', () => {
  it('connects and reads configuration and addresses', async () => {
    const w = await connectWallet('undeployed', { key: 'mnLace', name: 'lace', apiVersion: '4.0.1', api: fakeApi('lace') as any });
    expect(w.networkId).toBe('undeployed');
    expect(w.indexerUri).toBe('http://i');
    expect(w.coinPublicKey).toBe('aa');
    expect(w.shieldedAddress).toContain('mn_shield');
  });
});

describe('explainWalletError', () => {
  it('maps known failures to hints', () => {
    expect(explainWalletError(new Error('connect ECONNREFUSED 127.0.0.1:6300'))).toMatch(/proof server/i);
    expect(explainWalletError(new Error('Not enough Dust'))).toMatch(/DUST/);
    expect(explainWalletError(new Error('Insufficient Funds'))).toMatch(/NIGHT|DUST/);
    expect(explainWalletError(new Error('user rejected'))).toMatch(/rejected/i);
    expect(explainWalletError('boom')).toBe('boom');
  });
});
```

- [ ] **Step 3: Run to verify failure** — `cd packages/midnight-web && npm install && npx vitest run` → FAIL, module missing.

- [ ] **Step 4: Implement `src/wallet.ts`**

```ts
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';

export const NATIVE_RAW = '0'.repeat(64);

export type WalletChoice = { key: string; name: string; apiVersion: string; api: InitialAPI };

export function listWallets(win: { midnight?: Record<string, unknown> } = globalThis as any): WalletChoice[] {
  const injected = win.midnight;
  if (!injected) return [];
  const out: WalletChoice[] = [];
  for (const [key, v] of Object.entries(injected)) {
    const c = v as any;
    if (c && typeof c === 'object' && typeof c.name === 'string' && typeof c.apiVersion === 'string' && typeof c.connect === 'function') {
      out.push({ key, name: c.name, apiVersion: c.apiVersion, api: c as InitialAPI });
    }
  }
  return out;
}

export type ConnectedWallet = {
  name: string; api: ConnectedAPI; networkId: string;
  indexerUri: string; indexerWsUri: string; proverServerUri?: string;
  shieldedAddress: string; coinPublicKey: string; encryptionPublicKey: string;
};

export async function connectWallet(networkId: string, choice: WalletChoice): Promise<ConnectedWallet> {
  const api = await choice.api.connect(networkId);
  const cfg = await api.getConfiguration();
  const sh = await api.getShieldedAddresses();
  return {
    name: choice.name, api, networkId: cfg.networkId,
    indexerUri: cfg.indexerUri, indexerWsUri: cfg.indexerWsUri, proverServerUri: (cfg as any).proverServerUri,
    shieldedAddress: sh.shieldedAddress, coinPublicKey: sh.shieldedCoinPublicKey, encryptionPublicKey: sh.shieldedEncryptionPublicKey,
  };
}

export async function balances(w: ConnectedWallet) {
  const [sh, un, dust] = await Promise.all([w.api.getShieldedBalances(), w.api.getUnshieldedBalances(), w.api.getDustBalance()]);
  return { shieldedNight: sh[NATIVE_RAW] ?? 0n, unshieldedNight: un[NATIVE_RAW] ?? 0n, dust: dust.balance, dustCap: dust.cap };
}

export function explainWalletError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/6300|proof server|ECONNREFUSED/i.test(m)) return `Proof server unreachable. Lace needs the local proof server on port 6300 (docker run -p 6300:6300 midnightntwrk/proof-server:8.1.0). (${m})`;
  if (/dust/i.test(m)) return `Not enough DUST to pay the fee. Register NIGHT for DUST generation in the wallet and wait a few minutes. (${m})`;
  if (/insufficient/i.test(m)) return `Insufficient funds: you need shielded NIGHT for the price plus DUST for the fee. (${m})`;
  if (/reject|denied|cancel/i.test(m)) return `The wallet rejected the request. (${m})`;
  return m;
}
```

- [ ] **Step 5: Run to verify pass.** **Step 6: Commit** — `git add packages/midnight-web && git commit -m "feat(midnight-web): wallet discovery, connection, balances, error hints"`

---

### Task 2: `packages/midnight-web`: providers and contract client

**Files:**
- Create: `packages/midnight-web/src/providers.ts`, `packages/midnight-web/src/contract.ts`, `packages/midnight-web/src/fake.ts`, `packages/midnight-web/src/index.ts`, `packages/midnight-web/test/contract.test.ts`

**Interfaces:**
- Produces:
  - `buildProviders(w: ConnectedWallet, opts: { zkAssetsUrl: string; storeName: string; proofServerFallback?: string }): Promise<BlindfoldProviders>`
  - `type LedgerView = { drops: Map<bigint, bigint>; dropOwner: Map<bigint, Uint8Array>; kCommit: Map<bigint, Uint8Array>; purchaseCount: bigint; purchases: Map<bigint, Uint8Array>; purchaseDrop: Map<bigint, bigint>; escrow: Map<bigint, { value: bigint; mt_index: bigint }> }`
  - `ledgerView(L: any): LedgerView` (pure), `readLedger(indexerUri, indexerWsUri, contractAddress, networkId): Promise<LedgerView>`
  - `nightCoin(value: bigint): { nonce: Uint8Array; color: Uint8Array; value: bigint }`
  - `type TxRef = { txId: string; blockHeight: number }`
  - `interface BlindfoldClient { purchase(dropId: bigint, ePub: Uint8Array, price: bigint): Promise<TxRef>; createDrop(dropId: bigint, price: bigint, commit: Uint8Array): Promise<TxRef>; withdraw(idx: bigint): Promise<TxRef>; ledger(): Promise<LedgerView> }`
  - `connectContract(providers, contractAddress: string, secret: Uint8Array, privateStateId: string): Promise<BlindfoldClient>`
  - `class FakeBlindfoldClient implements BlindfoldClient` (records calls; `purchase` resolves with `{ txId: 'fake-<n>', blockHeight: n }` and appends to an internal ledger view) and `fakeConnectedWallet(): ConnectedWallet`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { ledgerView, nightCoin } from '../src/contract';
import { FakeBlindfoldClient } from '../src/fake';

const iter = <K, V>(e: [K, V][]) => ({ [Symbol.iterator]: () => e[Symbol.iterator]() });

describe('ledgerView', () => {
  it('converts the generated ledger object into plain Maps', () => {
    const L = {
      drops: iter([[1n, 5n]]), dropOwner: iter([[1n, new Uint8Array(32)]]), kCommit: iter([[1n, new Uint8Array(32)]]),
      purchaseCount: 1n, purchases: iter([[0n, new Uint8Array(32).fill(4)]]), purchaseDrop: iter([[0n, 1n]]),
      escrow: iter([[0n, { nonce: new Uint8Array(32), color: new Uint8Array(32), value: 5n, mt_index: 9n }]]),
    };
    const v = ledgerView(L);
    expect(v.drops.get(1n)).toBe(5n);
    expect(v.escrow.get(0n)).toEqual({ value: 5n, mt_index: 9n });
    expect(v.purchases.get(0n)![0]).toBe(4);
  });
});

describe('nightCoin', () => {
  it('has a random 32-byte nonce, zero color, and the value', () => {
    const a = nightCoin(7n), b = nightCoin(7n);
    expect(a.nonce.length).toBe(32);
    expect(a.color.every((x) => x === 0)).toBe(true);
    expect(a.value).toBe(7n);
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
  });
});

describe('FakeBlindfoldClient', () => {
  it('records purchases into its ledger view', async () => {
    const c = new FakeBlindfoldClient({ drops: new Map([[1n, 5n]]) });
    const ePub = new Uint8Array(32).fill(1);
    const tx = await c.purchase(1n, ePub, 5n);
    expect(tx.txId).toMatch(/^fake-/);
    const v = await c.ledger();
    expect(v.purchaseCount).toBe(1n);
    expect(v.purchases.get(0n)).toEqual(ePub);
    expect(c.calls).toEqual([{ method: 'purchase', dropId: 1n, price: 5n }]);
  });
  it('rejects underpaid and unknown drops like the contract', async () => {
    const c = new FakeBlindfoldClient({ drops: new Map([[1n, 5n]]) });
    await expect(c.purchase(1n, new Uint8Array(32), 4n)).rejects.toThrow(/underpaid/);
    await expect(c.purchase(2n, new Uint8Array(32), 5n)).rejects.toThrow(/unknown drop/);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `src/providers.ts`** (the official wallet-dapp adapter, trimmed)

```ts
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { Transaction, type Binding, type Proof, type SignatureEnabled } from '@midnight-ntwrk/ledger-v8';
import type { ConnectedWallet } from './wallet';

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array((h.replace(/^0x/, '').match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));

export type BlindfoldProviders = any; // MidnightProviders<'createDrop' | 'purchase' | 'withdraw'>

export async function buildProviders(w: ConnectedWallet, opts: { zkAssetsUrl: string; storeName: string; proofServerFallback?: string }): Promise<BlindfoldProviders> {
  const zkConfigProvider = new FetchZkConfigProvider<'createDrop' | 'purchase' | 'withdraw'>(opts.zkAssetsUrl, fetch.bind(globalThis));
  const proofServer = w.proverServerUri ?? opts.proofServerFallback ?? 'http://localhost:6300';
  const proofProvider = httpClientProofProvider(proofServer, zkConfigProvider);
  const walletProvider = {
    getCoinPublicKey: () => w.coinPublicKey,
    getEncryptionPublicKey: () => w.encryptionPublicKey,
    async balanceTx(tx: any) {
      const result = await w.api.balanceUnsealedTransaction(toHex(tx.serialize()));
      return Transaction.deserialize('signature', 'proof', 'binding', fromHex(result.tx)) as Transaction<SignatureEnabled, Proof, Binding>;
    },
  };
  const midnightProvider = {
    async submitTx(tx: any): Promise<string> {
      await w.api.submitTransaction(toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
  };
  return {
    privateStateProvider: levelPrivateStateProvider({ privateStateStoreName: opts.storeName, accountId: w.shieldedAddress, privateStoragePasswordProvider: () => 'blindfold-browser-private-state-1' }),
    publicDataProvider: indexerPublicDataProvider(w.indexerUri, w.indexerWsUri),
    zkConfigProvider, proofProvider, walletProvider, midnightProvider,
  };
}
```

- [ ] **Step 4: Implement `src/contract.ts`**

```ts
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import * as Blindfold from '@blindfold/contract/contract';

export type LedgerView = {
  drops: Map<bigint, bigint>; dropOwner: Map<bigint, Uint8Array>; kCommit: Map<bigint, Uint8Array>;
  purchaseCount: bigint; purchases: Map<bigint, Uint8Array>; purchaseDrop: Map<bigint, bigint>;
  escrow: Map<bigint, { value: bigint; mt_index: bigint }>;
};
export type TxRef = { txId: string; blockHeight: number };
export interface BlindfoldClient {
  purchase(dropId: bigint, ePub: Uint8Array, price: bigint): Promise<TxRef>;
  createDrop(dropId: bigint, price: bigint, commit: Uint8Array): Promise<TxRef>;
  withdraw(idx: bigint): Promise<TxRef>;
  ledger(): Promise<LedgerView>;
}

export function ledgerView(L: any): LedgerView {
  return {
    drops: new Map([...L.drops]), dropOwner: new Map([...L.dropOwner]), kCommit: new Map([...L.kCommit]),
    purchaseCount: BigInt(L.purchaseCount), purchases: new Map([...L.purchases]), purchaseDrop: new Map([...L.purchaseDrop]),
    escrow: new Map([...L.escrow].map(([k, v]: [bigint, any]) => [k, { value: BigInt(v.value), mt_index: BigInt(v.mt_index) }])),
  };
}

export function nightCoin(value: bigint) {
  return { nonce: crypto.getRandomValues(new Uint8Array(32)), color: new Uint8Array(32), value };
}

export async function readLedger(indexerUri: string, indexerWsUri: string, contractAddress: string, networkId: string): Promise<LedgerView> {
  setNetworkId(networkId as any);
  const state = await indexerPublicDataProvider(indexerUri, indexerWsUri).queryContractState(contractAddress);
  if (!state) throw new Error(`no contract at ${contractAddress}`);
  return ledgerView(Blindfold.ledger(state.data));
}

type PS = { secret: Uint8Array };
const witnesses = { creatorSecret: (ctx: { privateState: PS }): [PS, Uint8Array] => [ctx.privateState, ctx.privateState.secret] };

export async function connectContract(providers: any, contractAddress: string, secret: Uint8Array, privateStateId: string, zkAssetsPath = '/contract/blindfold'): Promise<BlindfoldClient> {
  const compiled = CompiledContract.make<any>('blindfold', Blindfold.Contract).pipe(
    CompiledContract.withWitnesses(witnesses), CompiledContract.withCompiledFileAssets(zkAssetsPath),
  );
  const found: any = await findDeployedContract(providers, { compiledContract: compiled, contractAddress, privateStateId, initialPrivateState: { secret } });
  const ref = (tx: any): TxRef => ({ txId: tx.public.txId, blockHeight: Number(tx.public.blockHeight) });
  return {
    purchase: async (dropId, ePub, price) => ref(await found.callTx.purchase(dropId, ePub, nightCoin(price))),
    createDrop: async (dropId, price, commit) => ref(await found.callTx.createDrop(dropId, price, commit)),
    withdraw: async (idx) => ref(await found.callTx.withdraw(idx)),
    ledger: async () => { const s = await providers.publicDataProvider.queryContractState(contractAddress); return ledgerView(Blindfold.ledger(s.data)); },
  };
}
```

`src/fake.ts`:

```ts
import type { BlindfoldClient, LedgerView, TxRef } from './contract';
import type { ConnectedWallet } from './wallet';

export class FakeBlindfoldClient implements BlindfoldClient {
  readonly calls: Array<Record<string, unknown>> = [];
  private readonly view: LedgerView;
  constructor(seed: Partial<LedgerView> = {}, private readonly onPurchase?: (index: bigint, dropId: bigint, ePub: Uint8Array) => Promise<void> | void) {
    this.view = { drops: new Map(), dropOwner: new Map(), kCommit: new Map(), purchaseCount: 0n, purchases: new Map(), purchaseDrop: new Map(), escrow: new Map(), ...seed };
  }
  private tx(): TxRef { const n = Number(this.view.purchaseCount); return { txId: `fake-${n}-${Date.now()}`, blockHeight: n }; }
  async purchase(dropId: bigint, ePub: Uint8Array, price: bigint): Promise<TxRef> {
    this.calls.push({ method: 'purchase', dropId, price });
    const p = this.view.drops.get(dropId);
    if (p === undefined) throw new Error('unknown drop');
    if (price < p) throw new Error('underpaid');
    const i = this.view.purchaseCount;
    this.view.purchases.set(i, ePub); this.view.purchaseDrop.set(i, dropId); this.view.escrow.set(i, { value: price, mt_index: i });
    this.view.purchaseCount = i + 1n;
    await this.onPurchase?.(i, dropId, ePub);
    return this.tx();
  }
  async createDrop(dropId: bigint, price: bigint, commit: Uint8Array): Promise<TxRef> {
    this.calls.push({ method: 'createDrop', dropId, price });
    if (this.view.drops.has(dropId)) throw new Error('drop already exists');
    this.view.drops.set(dropId, price); this.view.kCommit.set(dropId, commit); this.view.dropOwner.set(dropId, new Uint8Array(32).fill(1));
    return this.tx();
  }
  async withdraw(idx: bigint): Promise<TxRef> {
    this.calls.push({ method: 'withdraw', idx });
    if (!this.view.escrow.has(idx)) throw new Error('nothing escrowed');
    this.view.escrow.delete(idx); return this.tx();
  }
  async ledger(): Promise<LedgerView> { return this.view; }
}

export function fakeConnectedWallet(): ConnectedWallet {
  const api: any = {
    getShieldedBalances: async () => ({ ['0'.repeat(64)]: 1_000_000_000n }),
    getUnshieldedBalances: async () => ({ ['0'.repeat(64)]: 1_000_000_000n }),
    getDustBalance: async () => ({ balance: 10n ** 18n, cap: 10n ** 19n }),
  };
  return { name: 'fake', api, networkId: 'undeployed', indexerUri: 'http://fake', indexerWsUri: 'ws://fake', shieldedAddress: 'mn_shield-addr_undeployed1fake', coinPublicKey: '00'.repeat(32), encryptionPublicKey: '00'.repeat(32) };
}
```

`src/index.ts`: `export * from './wallet'; export * from './providers'; export * from './contract'; export * from './fake';`

- [ ] **Step 5: Run to verify pass; type-check** — `npx vitest run && npx tsc --noEmit`. If `@blindfold/contract/contract` cannot resolve, run `npm run compile -w contract` first.

- [ ] **Step 6: Commit** — `git commit -m "feat(midnight-web): providers, contract client, and fakes"`

---

### Task 3: Buyer app scaffold and carried-over modules

**Files:**
- Create: `buyer/package.json`, `buyer/index.html`, `buyer/tsconfig.json`, `buyer/vite.config.ts`, `buyer/vitest.config.ts`, `buyer/src/main.tsx`, `buyer/src/bytes.ts`, `buyer/src/seal.ts`, `buyer/src/content.ts`, `buyer/src/persist.ts`, `buyer/src/poller.ts`, `buyer/src/render.ts`, `buyer/src/styles.css`, `buyer/src/purchase.ts`, `buyer/src/price.ts`, `buyer/src/api.ts`, tests `buyer/test/{seal,content,persist,poller,purchase,price,api}.test.ts`

**Interfaces:**
- Produces:
  - `type Purchase = { id: string; dropId: number; title: string; priceStar: string; hContent: string; ePub: Uint8Array; ePriv: Uint8Array; createdAt: number; txId?: string; contractAddress?: string }`
  - `createPurchase(entry: CatalogEntry, contractAddress: string): Promise<Purchase>`, `toRecoveryFile`, `fromRecoveryFile` (format version `"blindfold-recovery-1"`)
  - `type CatalogEntry = { drop_id: number; price_star: string; title: string; h_content: string }`, `type ContractInfo = { network: string; contract_address: string }`
  - `interface DropApi { fetchContract(): Promise<ContractInfo>; fetchCatalog(): Promise<CatalogEntry[]>; listDispatch(): Promise<string[]>; getDispatch(key): Promise<Uint8Array>; getContent(hContent): Promise<Uint8Array> }`, `class HttpDropApi implements DropApi`
  - `formatNight(star: string | bigint): string` (`'1000000'` → `'1'`, `'1500000'` → `'1.5'`)

- [ ] **Step 1: Copy the unchanged prototype modules**

From the earlier prototype's buyer app (ask the owner for the files if you lack the private repo): `bytes.ts`, `seal.ts`, `content.ts`, `persist.ts` (change `KEY` to `'blindfold-buyer-active-purchase'`), `poller.ts`, `render.ts`, `styles.css`, and their tests (`seal.test.ts`, `content.test.ts`, `persist.test.ts`, `poller.test.ts`). They contain no chain-specific code. Update the comment in `poller.ts` to say the key is `blake2b(ek_pub || index)`.

- [ ] **Step 2: package.json, index.html, configs**

`buyer/package.json`:

```json
{
  "name": "@blindfold/buyer",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "predev": "node scripts/copy-artifacts.mjs",
    "dev": "vite --host 127.0.0.1 --port 5173",
    "prebuild": "node scripts/copy-artifacts.mjs",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@blindfold/midnight-web": "*",
    "libsodium-wrappers": "0.7.15",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.61.0",
    "@types/libsodium-wrappers": "^0.7.14",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^5.1.0",
    "jsdom": "^26.0.0",
    "typescript": "^5.9.3",
    "vite": "^7.1.12",
    "vite-plugin-static-copy": "^3.1.4",
    "vite-plugin-wasm": "^3.5.0",
    "vitest": "^4.1.9"
  },
  "overrides": { "@midnight-ntwrk/onchain-runtime-v3": "3.0.0" }
}
```

`buyer/scripts/copy-artifacts.mjs`:

```js
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const src = resolve(import.meta.dirname, '../../contract/build/blindfold');
const dst = resolve(import.meta.dirname, '../public/contract/blindfold');
if (!existsSync(src)) { console.error('contract not compiled: run `npm run compile -w contract`'); process.exit(1); }
mkdirSync(dst, { recursive: true });
for (const d of ['zkir', 'keys', 'compiler']) cpSync(`${src}/${d}`, `${dst}/${d}`, { recursive: true });
console.log('copied contract artifacts to public/contract/blindfold');
```

Add `buyer/public/contract/` to `.gitignore`.

`buyer/vite.config.ts` (from the official wallet-dapp, adapted):

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { fileURLToPath } from 'node:url';

const shim = fileURLToPath(new URL('../packages/midnight-web/src/crypto-shim.ts', import.meta.url));
export default defineConfig({
  define: { global: 'globalThis' },
  resolve: { alias: { process: 'process/browser', buffer: 'buffer', util: 'util', crypto: shim, stream: 'stream-browserify', events: 'events' } },
  plugins: [react(), wasm()],
  optimizeDeps: { include: ['level', 'browser-level', 'abstract-level', 'level-supports', 'level-transcoder'], esbuildOptions: { target: 'esnext' } },
  build: { target: 'esnext' },
  worker: { format: 'es' },
  assetsInclude: ['**/*.wasm'],
  server: { fs: { allow: ['..'] } },
});
```

`buyer/index.html`:

```html
<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Blindfold</title></head>
<body><div id="root"></div>
<script>if (typeof globalThis.process === 'undefined') globalThis.process = { env: {} }; if (typeof globalThis.global === 'undefined') globalThis.global = globalThis;</script>
<script type="module" src="/src/main.tsx"></script></body></html>
```

`buyer/src/main.tsx`:

```tsx
import '@blindfold/midnight-web/polyfills';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
```

`buyer/tsconfig.json`: `{ "extends": "../tsconfig.base.json", "compilerOptions": { "lib": ["ES2022", "DOM", "DOM.Iterable"], "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx", "types": ["vite/client"] }, "include": ["src", "test", "scripts"] }`
`buyer/vitest.config.ts`: `import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { environment: 'jsdom', include: ['test/**/*.test.ts'] } });`

- [ ] **Step 3: Failing tests for the changed modules**

`buyer/test/purchase.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createPurchase, toRecoveryFile, fromRecoveryFile } from '../src/purchase';

const entry = { drop_id: 3, price_star: '1500000', title: 'cat', h_content: 'ab'.repeat(32) };

describe('purchase', () => {
  it('createPurchase makes a fresh keypair and carries the contract address', async () => {
    const a = await createPurchase(entry, 'cc'.repeat(32));
    const b = await createPurchase(entry, 'cc'.repeat(32));
    expect(a.ePub.length).toBe(32); expect(a.ePriv.length).toBe(32);
    expect(Buffer.from(a.ePub).equals(Buffer.from(b.ePub))).toBe(false);
    expect(a.contractAddress).toBe('cc'.repeat(32));
    expect(a.priceStar).toBe('1500000');
  });
  it('recovery file round-trips including txId', async () => {
    const p = { ...(await createPurchase(entry, 'cc'.repeat(32))), txId: 'tx1' };
    const back = fromRecoveryFile(JSON.stringify(toRecoveryFile(p)));
    expect(back.dropId).toBe(3); expect(back.txId).toBe('tx1'); expect(back.hContent).toBe(entry.h_content);
    expect(Buffer.from(back.ePriv).equals(Buffer.from(p.ePriv))).toBe(true);
    expect(toRecoveryFile(p).v).toBe('blindfold-recovery-1');
  });
  it('rejects a foreign recovery file', () => {
    expect(() => fromRecoveryFile(JSON.stringify({ v: 'other' }))).toThrow(/not a valid/);
  });
});
```

`buyer/test/price.test.ts`:

```ts
import { it, expect } from 'vitest';
import { formatNight } from '../src/price';
it('formats STAR as NIGHT', () => {
  expect(formatNight('1000000')).toBe('1');
  expect(formatNight('1500000')).toBe('1.5');
  expect(formatNight(1n)).toBe('0.000001');
  expect(formatNight('0')).toBe('0');
});
```

`buyer/test/api.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { HttpDropApi } from '../src/api';

describe('HttpDropApi', () => {
  it('fetches contract info and catalog', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/contract')) return new Response(JSON.stringify({ network: 'undeployed', contract_address: 'ab'.repeat(32) }));
      if (url.endsWith('/catalog')) return new Response(JSON.stringify([{ drop_id: 1, price_star: '5', title: 't', h_content: 'cd'.repeat(32) }]));
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = new HttpDropApi('http://x/');
    expect((await api.fetchContract()).contract_address).toBe('ab'.repeat(32));
    expect((await api.fetchCatalog())[0].price_star).toBe('5');
    await expect(api.getContent('zz')).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 4: Run to verify failure.**

- [ ] **Step 5: Implement `purchase.ts`, `price.ts`, `api.ts`**

`buyer/src/purchase.ts`:

```ts
import type { CatalogEntry } from './api';
import { fromHex, toHex } from './bytes';
import { generateEphemeralKeypair } from './seal';

export type Purchase = {
  id: string; dropId: number; title: string; priceStar: string; hContent: string;
  ePub: Uint8Array; ePriv: Uint8Array; createdAt: number; txId?: string; contractAddress?: string;
};

export async function createPurchase(entry: CatalogEntry, contractAddress: string, now: number = Date.now()): Promise<Purchase> {
  const { ePub, ePriv } = await generateEphemeralKeypair();
  return { id: toHex(crypto.getRandomValues(new Uint8Array(8))), dropId: entry.drop_id, title: entry.title, priceStar: entry.price_star, hContent: entry.h_content, ePub, ePriv, createdAt: now, contractAddress };
}

export type RecoveryFile = {
  v: 'blindfold-recovery-1'; drop_id: number; title: string; price_star: string; h_content: string;
  e_pub: string; e_priv: string; created_at: number; tx_id?: string; contract_address?: string;
};

export function toRecoveryFile(p: Purchase): RecoveryFile {
  return { v: 'blindfold-recovery-1', drop_id: p.dropId, title: p.title, price_star: p.priceStar, h_content: p.hContent, e_pub: toHex(p.ePub), e_priv: toHex(p.ePriv), created_at: p.createdAt, tx_id: p.txId, contract_address: p.contractAddress };
}

export function fromRecoveryFile(json: string): Purchase {
  const o = JSON.parse(json) as Partial<RecoveryFile>;
  if (o.v !== 'blindfold-recovery-1' || !o.e_priv || !o.e_pub || !o.h_content || o.drop_id === undefined) throw new Error('not a valid blindfold recovery file');
  return { id: toHex(crypto.getRandomValues(new Uint8Array(8))), dropId: o.drop_id, title: o.title ?? `Drop ${o.drop_id}`, priceStar: o.price_star ?? '0', hContent: o.h_content, ePub: fromHex(o.e_pub), ePriv: fromHex(o.e_priv), createdAt: o.created_at ?? Date.now(), txId: o.tx_id, contractAddress: o.contract_address };
}
```

`buyer/src/price.ts`:

```ts
const STAR_PER_NIGHT = 1_000_000n;
export function formatNight(star: string | bigint): string {
  const v = typeof star === 'bigint' ? star : BigInt(star);
  const whole = v / STAR_PER_NIGHT, frac = v % STAR_PER_NIGHT;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
}
```

`buyer/src/api.ts`:

```ts
export type CatalogEntry = { drop_id: number; price_star: string; title: string; h_content: string };
export type ContractInfo = { network: string; contract_address: string };

export interface DropApi {
  fetchContract(): Promise<ContractInfo>;
  fetchCatalog(): Promise<CatalogEntry[]>;
  listDispatch(): Promise<string[]>;
  getDispatch(key: string): Promise<Uint8Array>;
  getContent(hContent: string): Promise<Uint8Array>;
}

export function joinUrl(base: string, path: string): string { return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`; }

export class HttpDropApi implements DropApi {
  constructor(private readonly indexerUrl: string) {}
  private async json<T>(path: string): Promise<T> {
    const res = await fetch(joinUrl(this.indexerUrl, path));
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return (await res.json()) as T;
  }
  private async bytes(path: string): Promise<Uint8Array> {
    const res = await fetch(joinUrl(this.indexerUrl, path));
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  fetchContract() { return this.json<ContractInfo>('/contract'); }
  fetchCatalog() { return this.json<CatalogEntry[]>('/catalog'); }
  listDispatch() { return this.json<string[]>('/dispatch'); }
  getDispatch(key: string) { return this.bytes(`/dispatch/${key}`); }
  getContent(hContent: string) { return this.bytes(`/bucket/${hContent}`); }
}
```

- [ ] **Step 6: Run all buyer tests** — `cd buyer && npm install && npx vitest run` → PASS (carried-over tests plus the three new files).

- [ ] **Step 7: Commit** — `git add buyer .gitignore && git commit -m "feat(buyer): app scaffold with carried-over crypto, polling, and persistence modules"`

---

### Task 4: `buy.ts` and the mock indexer

**Files:**
- Create: `buyer/src/buy.ts`, `buyer/src/mockApi.ts`, `buyer/test/buy.test.ts`, `buyer/test/mockApi.test.ts`

**Interfaces:**
- Produces:
  - `buyDrop(deps: { api: DropApi; client: BlindfoldClient; contractAddress: string }, entry: CatalogEntry): Promise<Purchase>` (keypair, `client.purchase(BigInt(drop_id), ePub, BigInt(price_star))`, returns the Purchase with `txId`)
  - `class MockDropApi implements DropApi` with `seedDrop(entry, plaintext): Promise<void>` and `dispatchFor(ePub: Uint8Array, dropId: number): Promise<void>` (seals the drop's K_drop to `ePub` and lists the blob), `contractAddress = 'ff'.repeat(32)`.

- [ ] **Step 1: Failing tests**

`buyer/test/buy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FakeBlindfoldClient } from '@blindfold/midnight-web';
import { buyDrop } from '../src/buy';
import { MockDropApi } from '../src/mockApi';
import { DispatchPoller } from '../src/poller';
import { sodiumReady } from '../src/seal';

describe('buyDrop', () => {
  it('purchases with a fresh key and the exact price, then the poller unlocks', async () => {
    await sodiumReady();
    const api = new MockDropApi();
    const entry = { drop_id: 1, price_star: '1000000', title: 'cat', h_content: '' };
    const seeded = await api.seedDrop(entry, new TextEncoder().encode('hello'));
    const client = new FakeBlindfoldClient({ drops: new Map([[1n, 1_000_000n]]) }, (_i, dropId, ePub) => api.dispatchFor(ePub, Number(dropId)));
    const purchase = await buyDrop({ api, client, contractAddress: api.contractAddress }, seeded);
    expect(purchase.txId).toMatch(/^fake-/);
    expect(client.calls[0]).toEqual({ method: 'purchase', dropId: 1n, price: 1_000_000n });
    const [unlock] = await new DispatchPoller(api).poll([purchase]);
    expect(new TextDecoder().decode(unlock.content)).toBe('hello');
  });
});
```

`buyer/test/mockApi.test.ts`:

```ts
import { it, expect } from 'vitest';
import { MockDropApi } from '../src/mockApi';
import { sodiumReady, generateEphemeralKeypair, trySealOpen } from '../src/seal';

it('mock indexer seeds drops and dispatches sealed keys', async () => {
  await sodiumReady();
  const api = new MockDropApi();
  const entry = await api.seedDrop({ drop_id: 2, price_star: '5', title: 'x', h_content: '' }, new Uint8Array([1]));
  expect((await api.fetchCatalog())[0].h_content).toBe(entry.h_content);
  expect((await api.fetchContract()).contract_address).toBe('ff'.repeat(32));
  const kp = await generateEphemeralKeypair();
  await api.dispatchFor(kp.ePub, 2);
  const [key] = await api.listDispatch();
  expect(trySealOpen(await api.getDispatch(key), kp.ePub, kp.ePriv)!.length).toBe(32);
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`buyer/src/buy.ts`:

```ts
import type { BlindfoldClient } from '@blindfold/midnight-web';
import type { CatalogEntry, DropApi } from './api';
import { createPurchase, type Purchase } from './purchase';
import { sodiumReady } from './seal';

export async function buyDrop(deps: { api: DropApi; client: BlindfoldClient; contractAddress: string }, entry: CatalogEntry): Promise<Purchase> {
  await sodiumReady();
  const purchase = await createPurchase(entry, deps.contractAddress);
  const tx = await deps.client.purchase(BigInt(entry.drop_id), purchase.ePub, BigInt(entry.price_star));
  return { ...purchase, txId: tx.txId };
}
```

`buyer/src/mockApi.ts`:

```ts
import sodium from 'libsodium-wrappers';
import type { CatalogEntry, ContractInfo, DropApi } from './api';
import { concatBytes, sha256Hex, toHex } from './bytes';
import { encryptContent } from './content';
import { sealTo } from './seal';

/** In-memory stand-in for the indexer. Used by tests and by the app when VITE_FAKE_WALLET=1. */
export class MockDropApi implements DropApi {
  readonly contractAddress = 'ff'.repeat(32);
  private readonly drops = new Map<number, { entry: CatalogEntry; kDrop: Uint8Array }>();
  private readonly content = new Map<string, Uint8Array>();
  private readonly dispatch = new Map<string, Uint8Array>();
  private counter = 0;

  async seedDrop(entry: CatalogEntry, plaintext: Uint8Array): Promise<CatalogEntry> {
    const enc = await encryptContent(plaintext);
    const full = { ...entry, h_content: enc.hContent };
    this.drops.set(entry.drop_id, { entry: full, kDrop: enc.kDrop });
    this.content.set(enc.hContent, enc.blob);
    return full;
  }
  async dispatchFor(ePub: Uint8Array, dropId: number): Promise<void> {
    const d = this.drops.get(dropId); if (!d) throw new Error('unknown drop');
    const blob = sealTo(d.kDrop, ePub);
    const idx = new Uint8Array(8); new DataView(idx.buffer).setBigUint64(0, BigInt(this.counter++));
    this.dispatch.set(toHex(sodium.crypto_generichash(32, concatBytes([blob.subarray(0, 32), idx]))), blob);
  }
  async fetchContract(): Promise<ContractInfo> { return { network: 'undeployed', contract_address: this.contractAddress }; }
  async fetchCatalog(): Promise<CatalogEntry[]> { return [...this.drops.values()].map((d) => d.entry); }
  async listDispatch(): Promise<string[]> { return [...this.dispatch.keys()]; }
  async getDispatch(key: string): Promise<Uint8Array> { const b = this.dispatch.get(key); if (!b) throw new Error('404'); return b; }
  async getContent(h: string): Promise<Uint8Array> { const b = this.content.get(h); if (!b) throw new Error('404'); return b; }
}
```

- [ ] **Step 4: Run to verify pass.** **Step 5: Commit** — `git commit -m "feat(buyer): buyDrop orchestration and in-memory mock indexer"`

---

### Task 5: `App.tsx`

**Files:**
- Create: `buyer/src/App.tsx`, `buyer/src/session.ts`
- Env: `VITE_INDEXER_URL` (default `http://localhost:8080`), `VITE_FAKE_WALLET` (`1` → mock api + fake client, no chain), `VITE_PROOF_SERVER_URL` (default `http://localhost:6300`).

**Interfaces:**
- Consumes: `listWallets`, `connectWallet`, `balances`, `explainWalletError`, `buildProviders`, `connectContract`, `FakeBlindfoldClient`, `fakeConnectedWallet` from `@blindfold/midnight-web`; `buyDrop`, `DispatchPoller`, persistence, render helpers.
- Produces: `session.ts` exporting `type Session = { wallet: ConnectedWallet; client: BlindfoldClient; contractAddress: string; network: string }` and `openSession(api: DropApi, choice?: WalletChoice): Promise<Session>` (real or fake per env).

- [ ] **Step 1: `buyer/src/session.ts`**

```ts
import { balances, buildProviders, connectContract, connectWallet, fakeConnectedWallet, FakeBlindfoldClient, listWallets, type BlindfoldClient, type ConnectedWallet, type WalletChoice } from '@blindfold/midnight-web';
import type { DropApi } from './api';
import { MockDropApi } from './mockApi';

export type Session = { wallet: ConnectedWallet; client: BlindfoldClient; contractAddress: string; network: string };
export const FAKE = import.meta.env.VITE_FAKE_WALLET === '1';

export function availableWallets(): WalletChoice[] { return FAKE ? [{ key: 'fake', name: 'Fake wallet (no chain)', apiVersion: '0', api: {} as any }] : listWallets(); }

export async function openSession(api: DropApi, choice: WalletChoice): Promise<Session> {
  const info = await api.fetchContract();
  if (FAKE) {
    const mock = api as MockDropApi;
    const client = new FakeBlindfoldClient({ drops: new Map((await api.fetchCatalog()).map((e) => [BigInt(e.drop_id), BigInt(e.price_star)])) },
      (_i, dropId, ePub) => mock.dispatchFor(ePub, Number(dropId)));
    return { wallet: fakeConnectedWallet(), client, contractAddress: info.contract_address, network: info.network };
  }
  const wallet = await connectWallet(info.network, choice);
  if (wallet.networkId !== info.network) throw new Error(`wallet is on ${wallet.networkId}, the drop contract lives on ${info.network}. Switch the wallet network.`);
  const providers = await buildProviders(wallet, { zkAssetsUrl: `${window.location.origin}/contract/blindfold`, storeName: 'blindfold-buyer', proofServerFallback: import.meta.env.VITE_PROOF_SERVER_URL ?? 'http://localhost:6300' });
  const client = await connectContract(providers, info.contract_address, crypto.getRandomValues(new Uint8Array(32)), `blindfold-buyer-${info.contract_address.slice(0, 8)}`);
  return { wallet, client, contractAddress: info.contract_address, network: info.network };
}

export { balances };
```

- [ ] **Step 2: `buyer/src/App.tsx`**

Keep the prototype's XP window chrome, `Unlocked`, `ManualUnlock`, `Clock`, and `triggerDownload` exactly as they were (the only rename is the recovery-file text). Replace the catalog/pay sections with this logic:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { explainWalletError, type WalletChoice } from '@blindfold/midnight-web';
import type { CatalogEntry, DropApi } from './api';
import { HttpDropApi } from './api';
import { buyDrop } from './buy';
import { MockDropApi } from './mockApi';
import { clearPurchase, loadPurchase, savePurchase } from './persist';
import { DispatchPoller, type UnlockResult } from './poller';
import { formatNight } from './price';
import { toRecoveryFile, type Purchase } from './purchase';
import { sodiumReady } from './seal';
import { availableWallets, balances, openSession, FAKE, type Session } from './session';
// Unlocked, ManualUnlock, Clock, triggerDownload: carried over unchanged from the prototype.

const POLL_MS = 3000;
const indexerUrl = import.meta.env.VITE_INDEXER_URL ?? 'http://localhost:8080';

async function makeApi(): Promise<DropApi> {
  if (!FAKE) return new HttpDropApi(indexerUrl);
  const mock = new MockDropApi();
  await mock.seedDrop({ drop_id: 1, price_star: '1000000', title: 'Demo drop (fake wallet)', h_content: '' }, new TextEncoder().encode('Hello from Blindfold. This content was unlocked with a fake wallet.'));
  return mock;
}

export function App() {
  const [api, setApi] = useState<DropApi | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [bal, setBal] = useState<{ shieldedNight: bigint; dust: bigint } | null>(null);
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlock, setUnlock] = useState<UnlockResult | null>(null);
  const [error, setError] = useState('');
  const [remember, setRemember] = useState(true);
  const pollerRef = useRef<DispatchPoller | null>(null);
  const wallets = useMemo(availableWallets, []);

  useEffect(() => { void makeApi().then(setApi); }, []);
  const loadCatalog = useCallback(async () => { if (!api) return; try { setCatalog(await api.fetchCatalog()); } catch (e) { setError(String(e)); } }, [api]);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => { const resumed = loadPurchase(); if (resumed) setPurchase(resumed); }, []);

  useEffect(() => {
    if (!api || !purchase || unlock) return;
    pollerRef.current ??= new DispatchPoller(api);
    let alive = true;
    const tick = async () => {
      try { await sodiumReady(); const r = await pollerRef.current!.poll([purchase]); if (alive && r.length) { setUnlock(r[0]); clearPurchase(); } }
      catch (e) { if (alive) setError(e instanceof Error ? e.message : String(e)); }
    };
    void tick(); const id = setInterval(() => void tick(), POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [api, purchase, unlock]);

  const connect = useCallback(async (choice: WalletChoice) => {
    if (!api) return; setBusy(true); setError('');
    try { const s = await openSession(api, choice); setSession(s); const b = await balances(s.wallet); setBal({ shieldedNight: b.shieldedNight, dust: b.dust }); }
    catch (e) { setError(explainWalletError(e)); } finally { setBusy(false); }
  }, [api]);

  const buy = useCallback(async (entry: CatalogEntry) => {
    if (!api || !session) return; setBusy(true); setError(''); setUnlock(null); pollerRef.current = null;
    try { const p = await buyDrop({ api, client: session.client, contractAddress: session.contractAddress }, entry); setPurchase(p); if (remember) savePurchase(p); }
    catch (e) { setError(explainWalletError(e)); } finally { setBusy(false); }
  }, [api, session, remember]);

  const reset = useCallback(() => { setPurchase(null); setUnlock(null); pollerRef.current = null; clearPurchase(); }, []);
  const downloadRecovery = useCallback(() => { if (!purchase) return; triggerDownload(new Blob([JSON.stringify(toRecoveryFile(purchase), null, 2)], { type: 'application/json' }), `blindfold-recovery-${purchase.dropId}-${purchase.id}.json`); }, [purchase]);

  return (
    <main className="shell"><div className="xp-window">
      <div className="title-bar"><div className="wintitle"><span className="winicon">🕶️</span><h1>Blindfold</h1></div>
        <div className="modes">{session ? <span className="on">{session.wallet.name} · {session.network}</span> : <span>not connected</span>}</div></div>
      <div className="window-body">
        {error ? <p className="error">{error}</p> : null}
        {!session ? (
          <section className="panel"><div className="panel-head"><h2>Connect a Midnight wallet</h2></div>
            {wallets.length === 0 ? <p className="note">No Midnight wallet found. Install Lace or 1AM and reload.</p> :
              <ul className="drops">{wallets.map((w) => <li key={w.key}><strong>{w.name}</strong><button className="primary" disabled={busy} onClick={() => void connect(w)}>Connect</button></li>)}</ul>}
          </section>) : null}
        {session && bal ? <p className="note">Shielded NIGHT: {formatNight(bal.shieldedNight)} · DUST: {bal.dust.toString()}</p> : null}
        {session && !purchase ? (
          <section className="panel"><div className="panel-head"><h2>Catalog</h2><button onClick={() => void loadCatalog()}>Refresh</button></div>
            {catalog.length === 0 ? <p className="note">No drops yet.</p> :
              <ul className="drops">{catalog.map((d) => <li key={d.drop_id}><div><strong>{d.title}</strong><span className="price">{formatNight(d.price_star)} NIGHT</span></div>
                <button className="primary" disabled={busy} onClick={() => void buy(d)}>{busy ? 'proving…' : 'Buy'}</button></li>)}</ul>}
            <p className="note">Buying sends one shielded transaction from your wallet; proving takes 20 to 60 seconds.</p>
          </section>) : null}
        {purchase && !unlock ? (
          <section className="panel"><div className="panel-head"><h2>Paid for “{purchase.title}”</h2><button onClick={reset}>Cancel</button></div>
            <p>Transaction {purchase.txId ?? '(pending)'} accepted. Waiting for the sealed key…</p>
            <div className="warn">⚠ Don’t close this tab until it unlocks: the one-time key lives here. Save a recovery file to be safe.</div>
            <label className="remember"><input type="checkbox" checked={remember} onChange={(e) => { setRemember(e.target.checked); if (e.target.checked && purchase) savePurchase(purchase); if (!e.target.checked) clearPurchase(); }} /> Keep on this device for 24h</label>
            <div className="actions"><button onClick={downloadRecovery}>Download recovery file</button></div>
          </section>) : null}
        {unlock ? <Unlocked result={unlock} onDone={reset} /> : null}
        {api ? <ManualUnlock api={api} /> : null}
      </div></div>
      <div className="taskbar"><button className="start" type="button">start</button><Clock /></div>
    </main>
  );
}
```

- [ ] **Step 3: Type-check and run the fake flow in a browser**

Run: `cd buyer && npx tsc --noEmit && VITE_FAKE_WALLET=1 npm run dev`, open `http://127.0.0.1:5173`, connect the fake wallet, buy the demo drop, watch it unlock within one poll.
Expected: content text shown, "Unlocked" panel, no console errors.

- [ ] **Step 4: Run against the devnet with Lace** (Lane A indexer running, a provisioned drop from Lane C or a scripted provisioning): `npm run dev` without the fake flag, connect Lace on Undeployed, buy, wait roughly 40 s, see the unlock. Record timings in `spike/NOTES.md`.

- [ ] **Step 5: Commit** — `git commit -m "feat(buyer): wallet connect, contract purchase, and unlock flow"`

---

### Task 6: Playwright smoke (fake wallet)

**Files:**
- Create: `buyer/playwright.config.ts`, `buyer/e2e/buy.spec.ts`

- [ ] **Step 1: Config**

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true },
  webServer: { command: 'VITE_FAKE_WALLET=1 npx vite --host 127.0.0.1 --port 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
```

- [ ] **Step 2: Test**

```ts
import { test, expect } from '@playwright/test';

test('buy with the fake wallet and unlock', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText(/Shielded NIGHT:/)).toBeVisible();
  await page.getByRole('button', { name: 'Buy' }).click();
  await expect(page.getByText(/Unlocked/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/unlocked with a fake wallet/)).toBeVisible();
  expect(errors).toEqual([]);
});
```

- [ ] **Step 3: Run** — `cd buyer && npx playwright install chromium && npm run test:e2e` → 1 passed.

- [ ] **Step 4: Commit** — `git commit -m "test(buyer): playwright smoke of the fake-wallet purchase flow"`

---

## Self-review

- Spec coverage: section 8 (wallet connect Task 1, providers and contract call Task 2, kept modules Task 3, purchase flow Task 4 and 5, recovery file with `tx_id` and `contract_address` Task 3, error hints Task 1 and 5, artifacts served from `/contract/blindfold` Task 3), section 6 I1/I2/I3/I4 (Tasks 2, 3, 4), section 11 app unit tests (Tasks 1 to 4) and Playwright smoke with a mocked wallet (Task 6). Wallet mismatch network check is in `openSession`.
- Placeholders: none.
- Type consistency: `Purchase.priceStar` (string STAR) used by `buyDrop` as `BigInt(entry.price_star)`; `BlindfoldClient.purchase(dropId: bigint, ePub, price: bigint)` matches `FakeBlindfoldClient` and `connectContract`; `MockDropApi.dispatchFor(ePub, dropId: number)` matches its use in `session.ts` and tests; `CatalogEntry` field names match the indexer's `publicEntries()` in Lane A Task 6.
