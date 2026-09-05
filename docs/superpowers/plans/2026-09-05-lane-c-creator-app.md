# Lane C: Creator App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `creator/`, the web app where a creator encrypts content, registers the drop on the contract with a key commitment, verifies the indexer's TEE attestation, seals the content key to it, and later withdraws escrowed NIGHT.

**Architecture:** The earlier prototype's creator app is carried over for encryption, attestation verification (Intel DCAP chain, pinned measurement, `report_data` binding), and sealed-box provisioning. Two things are new: a wallet step that calls `createDrop(dropId, price, sha256(K_drop ‖ h_content))` before provisioning, and a withdraw view that calls `withdraw(i)` for escrowed purchases of the creator's drops. The creator's contract secret (the `creatorSecret` witness) is generated once and kept in local storage with export and import.

**Tech Stack:** React 19, Vite 7, TypeScript 5.9, libsodium-wrappers 0.7.15, @phala/dcap-qvl ^0.5.2, ky 2, zod 4, `@blindfold/midnight-web` (Lane B Task 1 and 2), vitest 4, Playwright 1.61.

**Spec:** `docs/superpowers/specs/2026-09-05-blindfold-design.md` (sections 6, 9, 11)

## Global Constraints

- Node.js >= 22, npm workspaces, ESM, TypeScript `strict: true`. Same Vite polyfill setup as the buyer app (Lane B Task 3 Step 2), same pinned Midnight packages through `@blindfold/midnight-web`, root `overrides` pins `@midnight-ntwrk/onchain-runtime-v3` to 3.0.0.
- Compiled contract artifacts served from `/contract/blindfold/` (copied from `contract/build/blindfold`). Lane A Task 1 must be merged, or compile the spike contract.
- Wire formats (spec section 6): I4 content blob `nonce(12) ‖ AES-256-GCM ‖ tag(16)`, `h_content = sha256(blob)`, `PUT /bucket/{h_content}` (server verifies the hash, 50 MB max). I5 provisioning JSON `{drop_id, price_star, k_drop(hex), h_content, title}` sealed with `crypto_box_seal` to the enclave pubkey, `POST /provision` body `application/octet-stream`; responses 200 / 400 bad seal or payload / 404 drop not on-chain or content missing / 409 price or commitment mismatch. I6 `GET /attest` `{quote_hex, provisioning_pubkey_hex}`; verify with `@phala/dcap-qvl`, TCB `UpToDate`, RTMR3 (TD reports) equals the pinned measurement, `report_data[0:32] = sha256(pubkey)`. `GET /contract` `{network, contract_address}`.
- Contract: `createDrop(dropId: bigint, price: bigint /* STAR */, commit: Uint8Array /* sha256(K_drop ‖ h_content) */)`, `withdraw(idx: bigint)`. `1 NIGHT = 1_000_000 STAR`; prices are entered in NIGHT with up to 6 decimals and must be > 0.
- The dev indexer answers `quote_hex: "dev"`; the app must offer an explicit "dev mode: skip attestation" switch (default off) for the local devnet, and refuse to provision on `quote_hex === "dev"` unless that switch is on.
- Never log or persist wallet keys or `K_drop` beyond the in-memory flow. The creator secret is stored under localStorage key `blindfold-creator-secret` as hex, and its export file has version `blindfold-creator-secret-1`.
- `openSession` must set the midnight-js network id from `GET /contract` before building providers (Lane B ruling B12).
- Tests: vitest (jsdom) for modules, Playwright for the smoke. Commit after every task.

---

## File structure

```
creator/
  package.json, index.html, vite.config.ts, tsconfig.json, vitest.config.ts, playwright.config.ts
  scripts/copy-artifacts.mjs     same as buyer
  src/main.tsx                   polyfills first, mounts App
  src/App.tsx                    provision flow + withdraw view
  src/bytes.ts, content.ts, attestation.ts, qvl-verifier.ts   carried over unchanged
  src/api.ts                     fetchContract, fetchAttestation, fetchCatalog, uploadContentBlob, postProvision
  src/price.ts                   priceNightToStar
  src/provision.ts               buildProvisionPayload (I5), sealProvisionPayload
  src/secret.ts                  creator secret: load/create/export/import
  src/drops.ts                   local list of drops this creator registered
  src/chain.ts                   commitFor, suggestDropId, registerDrop, escrowForDrops
  src/session.ts                 openSession (real or fake)
  src/styles.css                 carried over
  test/*.test.ts, e2e/provision.spec.ts
```

---

### Task 1: Scaffold and carried-over modules

**Files:**
- Create: `creator/package.json`, `creator/index.html`, `creator/tsconfig.json`, `creator/vite.config.ts`, `creator/vitest.config.ts`, `creator/scripts/copy-artifacts.mjs`, `creator/src/main.tsx`, `creator/src/bytes.ts`, `creator/src/content.ts`, `creator/src/attestation.ts`, `creator/src/qvl-verifier.ts`, `creator/src/styles.css`, `creator/src/api.ts`, `creator/src/price.ts`, `creator/src/provision.ts`, tests `creator/test/{content,attestation,api,price,provision}.test.ts`

**Interfaces:**
- Produces:
  - `priceNightToStar(input: string): bigint` (throws on > 6 decimals, negative, zero)
  - `type ProvisionPayload = { drop_id: number; price_star: string; k_drop: string; h_content: string; title: string }`
  - `buildProvisionPayload(args: { dropId: number; priceStar: bigint; kDrop: Uint8Array; hContent: string; title: string }): ProvisionPayload`
  - `sealProvisionPayload(payload, enclavePubkey: Uint8Array): Promise<Uint8Array>`
  - `fetchContract(indexerUrl): Promise<{ network: string; contract_address: string }>`, `fetchAttestation`, `fetchCatalog`, `uploadContentBlob(indexerUrl, hContent, blob)`, `postProvision(indexerUrl, sealed)`; `IndexerApiError` with `stage` and `status?: number`.

- [ ] **Step 1: Copy the unchanged prototype files**

From the earlier prototype's creator app: `bytes.ts`, `content.ts`, `attestation.ts`, `qvl-verifier.ts`, `styles.css`, and tests `content.test.ts`, `attestation.test.ts` (rename the env var reads in `attestation.ts` and `qvl-verifier.ts` from `VITE_DROP_QVL_MODULE_URL` / `VITE_DROP_PCCS_URL` to `VITE_QVL_MODULE_URL` / `VITE_PCCS_URL`; rename `window.dropQuoteVerifier` to `window.blindfoldQuoteVerifier`).

- [ ] **Step 2: Package and configs**

`creator/package.json`:

```json
{
  "name": "@blindfold/creator",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "predev": "node scripts/copy-artifacts.mjs",
    "dev": "vite --host 127.0.0.1 --port 5174",
    "prebuild": "node scripts/copy-artifacts.mjs",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@blindfold/midnight-web": "*",
    "@phala/dcap-qvl": "^0.5.2",
    "ky": "^2.0.2",
    "libsodium-wrappers": "0.7.15",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^4.4.3"
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
    "vite-plugin-wasm": "^3.5.0",
    "vitest": "^4.1.9"
  },
  "overrides": { "@midnight-ntwrk/onchain-runtime-v3": "3.0.0" }
}
```

`creator/scripts/copy-artifacts.mjs`, `creator/vite.config.ts`, `creator/tsconfig.json`, `creator/vitest.config.ts`, `creator/index.html` (title "Blindfold Creator"), `creator/src/main.tsx`: identical to the buyer's files in Lane B Task 3 Step 2 with `buyer` replaced by `creator`. Add `creator/public/contract/` to `.gitignore`.

- [ ] **Step 3: Failing tests for the changed modules**

`creator/test/price.test.ts`:

```ts
import { it, expect } from 'vitest';
import { priceNightToStar } from '../src/price';
it('converts NIGHT strings to STAR', () => {
  expect(priceNightToStar('1')).toBe(1_000_000n);
  expect(priceNightToStar('0.5')).toBe(500_000n);
  expect(priceNightToStar('0.000001')).toBe(1n);
  expect(() => priceNightToStar('0')).toThrow(/positive/);
  expect(() => priceNightToStar('1.1234567')).toThrow(/6 decimals/);
  expect(() => priceNightToStar('abc')).toThrow();
});
```

`creator/test/provision.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import sodium from 'libsodium-wrappers';
import { buildProvisionPayload, sealProvisionPayload } from '../src/provision';

describe('provision payload', () => {
  it('builds the I5 JSON with hex key and decimal price', () => {
    const p = buildProvisionPayload({ dropId: 3, priceStar: 1_500_000n, kDrop: new Uint8Array(32).fill(0xab), hContent: 'cd'.repeat(32), title: 'cat' });
    expect(p).toEqual({ drop_id: 3, price_star: '1500000', k_drop: 'ab'.repeat(32), h_content: 'cd'.repeat(32), title: 'cat' });
  });
  it('rejects a non-32-byte key and a bad hash', () => {
    expect(() => buildProvisionPayload({ dropId: 1, priceStar: 1n, kDrop: new Uint8Array(31), hContent: 'cd'.repeat(32), title: 't' })).toThrow(/32 bytes/);
    expect(() => buildProvisionPayload({ dropId: 1, priceStar: 1n, kDrop: new Uint8Array(32), hContent: 'zz', title: 't' })).toThrow(/sha256/);
  });
  it('seals to the enclave key so only that key opens it', async () => {
    await sodium.ready;
    const enclave = sodium.crypto_box_keypair();
    const p = buildProvisionPayload({ dropId: 1, priceStar: 1n, kDrop: new Uint8Array(32), hContent: 'cd'.repeat(32), title: 't' });
    const sealed = await sealProvisionPayload(p, enclave.publicKey);
    const opened = sodium.crypto_box_seal_open(sealed, enclave.publicKey, enclave.privateKey);
    expect(JSON.parse(new TextDecoder().decode(opened))).toEqual(p);
  });
});
```

`creator/test/api.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchContract, fetchCatalog, postProvision, IndexerApiError } from '../src/api';

describe('creator api', () => {
  it('parses /contract and /catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = String(input.url ?? input);
      if (url.endsWith('/contract')) return new Response(JSON.stringify({ network: 'undeployed', contract_address: 'ab'.repeat(32) }), { headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/catalog')) return new Response(JSON.stringify([{ drop_id: 1, price_star: '5', title: 't', h_content: 'cd'.repeat(32) }]), { headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ error: 'commit_mismatch' }), { status: 409, headers: { 'content-type': 'application/json' } });
    }));
    expect((await fetchContract('http://x')).contract_address).toBe('ab'.repeat(32));
    expect((await fetchCatalog('http://x'))[0].price_star).toBe('5');
    await expect(postProvision('http://x', new Uint8Array(3))).rejects.toMatchObject({ stage: 'provision', status: 409 });
    await postProvision('http://x', new Uint8Array(3)).catch((e) => expect(e).toBeInstanceOf(IndexerApiError));
  });
});
```

- [ ] **Step 4: Run to verify failure** — `cd creator && npm install && npx vitest run` → FAIL on the three new files (carried-over tests pass).

- [ ] **Step 5: Implement `price.ts`, `provision.ts`, `api.ts`**

`creator/src/price.ts`:

```ts
const STAR_PER_NIGHT = 1_000_000n;
export function priceNightToStar(input: string): bigint {
  const t = input.trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(t)) throw new Error('price must be a NIGHT amount with at most 6 decimals');
  const [whole, frac = ''] = t.split('.');
  const star = BigInt(whole) * STAR_PER_NIGHT + BigInt((frac + '000000').slice(0, 6));
  if (star <= 0n) throw new Error('price must be positive');
  return star;
}
```

`creator/src/provision.ts`:

```ts
import sodium from 'libsodium-wrappers';
import { toHex, utf8Bytes } from './bytes';
import { parseSha256Hex } from './content';

export type ProvisionPayload = { drop_id: number; price_star: string; k_drop: string; h_content: string; title: string };

export function buildProvisionPayload(a: { dropId: number; priceStar: bigint; kDrop: Uint8Array; hContent: string; title: string }): ProvisionPayload {
  if (!Number.isSafeInteger(a.dropId) || a.dropId < 0) throw new Error('drop_id must be a non-negative safe integer');
  if (a.priceStar <= 0n) throw new Error('price_star must be positive');
  if (a.kDrop.length !== 32) throw new Error('k_drop must be 32 bytes');
  return { drop_id: a.dropId, price_star: a.priceStar.toString(), k_drop: toHex(a.kDrop), h_content: parseSha256Hex(a.hContent), title: a.title.trim().slice(0, 200) };
}

export async function sealProvisionPayload(payload: ProvisionPayload, enclavePubkey: Uint8Array): Promise<Uint8Array> {
  if (enclavePubkey.length !== 32) throw new Error('enclave public key must be 32 bytes');
  await sodium.ready;
  return sodium.crypto_box_seal(utf8Bytes(JSON.stringify(payload)), enclavePubkey);
}
```

`creator/src/api.ts`: take the prototype's file and make these changes: the `CatalogEntrySchema` becomes `{ drop_id, price_star: z.string().regex(/^\d+$/), h_content, title }` (no deposit address); add

```ts
const ContractInfoSchema = z.object({ network: z.string().min(1), contract_address: z.string().regex(SHA256_HEX_PATTERN) });
export type ContractInfo = z.infer<typeof ContractInfoSchema>;
export async function fetchContract(indexerUrl: string): Promise<ContractInfo> {
  return fetchParsedJson('contract', joinUrl(indexerUrl, '/contract'), ContractInfoSchema);
}
```

change `postProvision(indexerUrl, sealed)` to post to `/provision` with no query parameter, add `readonly status?: number` to `IndexerApiError` filled from `HTTPError.response.status`, and add `'contract'` to `ApiStage`.

- [ ] **Step 6: Run to verify pass** — `npx vitest run` → all PASS.

- [ ] **Step 7: Commit** — `git add creator .gitignore && git commit -m "feat(creator): scaffold with carried-over encryption and attestation; new payload, price, api"`

---

### Task 2: Creator secret and local drop list

**Files:**
- Create: `creator/src/secret.ts`, `creator/src/drops.ts`, `creator/test/secret.test.ts`, `creator/test/drops.test.ts`

**Interfaces:**
- Produces:
  - `loadOrCreateSecret(storage?: Storage): Uint8Array` (32 bytes, hex in localStorage `blindfold-creator-secret`)
  - `exportSecretFile(secret): string` (JSON `{ v: 'blindfold-creator-secret-1', secret_hex }`), `importSecretFile(json: string, storage?): Uint8Array`
  - `rememberDrop(d: { dropId: number; title: string; priceStar: string; contractAddress: string; hContent: string }, storage?)`, `listDrops(contractAddress, storage?)` (localStorage key `blindfold-creator-drops`)

- [ ] **Step 1: Failing tests**

```ts
// creator/test/secret.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadOrCreateSecret, exportSecretFile, importSecretFile } from '../src/secret';

beforeEach(() => localStorage.clear());
describe('creator secret', () => {
  it('creates once and reuses', () => {
    const a = loadOrCreateSecret(); const b = loadOrCreateSecret();
    expect(a.length).toBe(32); expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
  it('export/import round-trips and replaces the stored secret', () => {
    const a = loadOrCreateSecret();
    const file = exportSecretFile(a);
    localStorage.clear();
    const b = importSecretFile(file);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    expect(Buffer.from(loadOrCreateSecret()).equals(Buffer.from(a))).toBe(true);
    expect(JSON.parse(file).v).toBe('blindfold-creator-secret-1');
  });
  it('rejects a foreign file', () => { expect(() => importSecretFile('{"v":"x"}')).toThrow(/not a blindfold/); });
});
```

```ts
// creator/test/drops.test.ts
import { it, expect, beforeEach } from 'vitest';
import { rememberDrop, listDrops } from '../src/drops';
beforeEach(() => localStorage.clear());
it('remembers drops per contract, newest first, de-duplicated by id', () => {
  const c = 'ab'.repeat(32);
  rememberDrop({ dropId: 1, title: 'a', priceStar: '5', contractAddress: c, hContent: 'cd'.repeat(32) });
  rememberDrop({ dropId: 2, title: 'b', priceStar: '6', contractAddress: c, hContent: 'ef'.repeat(32) });
  rememberDrop({ dropId: 1, title: 'a2', priceStar: '5', contractAddress: c, hContent: 'cd'.repeat(32) });
  expect(listDrops(c).map((d) => [d.dropId, d.title])).toEqual([[1, 'a2'], [2, 'b']]);
  expect(listDrops('00'.repeat(32))).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`creator/src/secret.ts`:

```ts
import { fromHex, toHex } from './bytes';
const KEY = 'blindfold-creator-secret';
const store = (s?: Storage) => s ?? localStorage;

export function loadOrCreateSecret(storage?: Storage): Uint8Array {
  const s = store(storage);
  const existing = s.getItem(KEY);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return fromHex(existing);
  const secret = crypto.getRandomValues(new Uint8Array(32));
  s.setItem(KEY, toHex(secret));
  return secret;
}
export function exportSecretFile(secret: Uint8Array): string {
  return JSON.stringify({ v: 'blindfold-creator-secret-1', secret_hex: toHex(secret) }, null, 2);
}
export function importSecretFile(json: string, storage?: Storage): Uint8Array {
  const o = JSON.parse(json) as { v?: string; secret_hex?: string };
  if (o.v !== 'blindfold-creator-secret-1' || !o.secret_hex || !/^[0-9a-f]{64}$/.test(o.secret_hex)) throw new Error('not a blindfold creator secret file');
  store(storage).setItem(KEY, o.secret_hex);
  return fromHex(o.secret_hex);
}
```

`creator/src/drops.ts`:

```ts
export type RememberedDrop = { dropId: number; title: string; priceStar: string; contractAddress: string; hContent: string; createdAt?: number };
const KEY = 'blindfold-creator-drops';
const read = (s: Storage): RememberedDrop[] => { try { return JSON.parse(s.getItem(KEY) ?? '[]'); } catch { return []; } };
export function rememberDrop(d: RememberedDrop, storage: Storage = localStorage): void {
  const rest = read(storage).filter((x) => !(x.contractAddress === d.contractAddress && x.dropId === d.dropId));
  storage.setItem(KEY, JSON.stringify([...rest, { ...d, createdAt: d.createdAt ?? Date.now() }]));
}
export function listDrops(contractAddress: string, storage: Storage = localStorage): RememberedDrop[] {
  return read(storage).filter((x) => x.contractAddress === contractAddress).sort((a, b) => a.dropId - b.dropId);
}
```

- [ ] **Step 4: Run to verify pass.** **Step 5: Commit** — `git commit -m "feat(creator): contract secret persistence and local drop list"`

---

### Task 3: Contract operations

**Files:**
- Create: `creator/src/chain.ts`, `creator/test/chain.test.ts`

**Interfaces:**
- Consumes: `BlindfoldClient`, `LedgerView` from `@blindfold/midnight-web`; `sha256`, `fromHex` from `bytes.ts`.
- Produces:
  - `commitFor(kDrop: Uint8Array, hContent: string): Promise<Uint8Array>` (`sha256(concat([kDrop, fromHex(hContent)]))`)
  - `suggestDropId(view: LedgerView): number` (`max(drops.keys) + 1`, or 1)
  - `registerDrop(client, args: { dropId: number; priceStar: bigint; kDrop: Uint8Array; hContent: string }): Promise<TxRef>`
  - `escrowForDrops(view: LedgerView, dropIds: number[]): Array<{ index: bigint; dropId: bigint; valueStar: bigint }>`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { FakeBlindfoldClient } from '@blindfold/midnight-web';
import { commitFor, suggestDropId, registerDrop, escrowForDrops } from '../src/chain';
import { sha256, fromHex } from '../src/bytes';

const concatBytes = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; };

describe('creator chain ops', () => {
  it('commitFor is sha256(K_drop || h_content)', async () => {
    const k = new Uint8Array(32).fill(1);
    const hContent = 'cd'.repeat(32);
    expect(Buffer.from(await commitFor(k, hContent)).equals(Buffer.from(await sha256(concatBytes(k, fromHex(hContent)))))).toBe(true);
  });
  it('suggestDropId is max+1 or 1', async () => {
    const c = new FakeBlindfoldClient({ drops: new Map([[4n, 1n], [9n, 1n]]) });
    expect(suggestDropId(await c.ledger())).toBe(10);
    expect(suggestDropId(await new FakeBlindfoldClient().ledger())).toBe(1);
  });
  it('registerDrop calls createDrop with the commitment', async () => {
    const c = new FakeBlindfoldClient();
    const k = new Uint8Array(32).fill(2);
    const hContent = 'ab'.repeat(32);
    await registerDrop(c, { dropId: 7, priceStar: 5n, kDrop: k, hContent });
    expect(c.calls).toEqual([{ method: 'createDrop', dropId: 7n, price: 5n }]);
    const v = await c.ledger();
    expect(Buffer.from(v.kCommit.get(7n)!).equals(Buffer.from(await sha256(concatBytes(k, fromHex(hContent)))))).toBe(true);
  });
  it('escrowForDrops lists only the given drops', async () => {
    const c = new FakeBlindfoldClient({ drops: new Map([[1n, 5n], [2n, 5n]]) });
    await c.purchase(1n, new Uint8Array(32), 5n); await c.purchase(2n, new Uint8Array(32), 6n);
    expect(escrowForDrops(await c.ledger(), [2])).toEqual([{ index: 1n, dropId: 2n, valueStar: 6n }]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `creator/src/chain.ts`**

```ts
import type { BlindfoldClient, LedgerView, TxRef } from '@blindfold/midnight-web';
import { sha256, fromHex } from './bytes';

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** commit = sha256(K_drop ‖ h_content); binds the commitment to the content, not just the key (R17). */
export function commitFor(kDrop: Uint8Array, hContent: string): Promise<Uint8Array> {
  return sha256(concat([kDrop, fromHex(hContent)]));
}

export function suggestDropId(view: LedgerView): number {
  let max = 0n; for (const id of view.drops.keys()) if (id > max) max = id;
  return Number(max + 1n);
}

export async function registerDrop(client: BlindfoldClient, a: { dropId: number; priceStar: bigint; kDrop: Uint8Array; hContent: string }): Promise<TxRef> {
  return client.createDrop(BigInt(a.dropId), a.priceStar, await commitFor(a.kDrop, a.hContent));
}

export function escrowForDrops(view: LedgerView, dropIds: number[]): Array<{ index: bigint; dropId: bigint; valueStar: bigint }> {
  const mine = new Set(dropIds.map(BigInt));
  const out: Array<{ index: bigint; dropId: bigint; valueStar: bigint }> = [];
  for (const [index, coin] of view.escrow) {
    const dropId = view.purchaseDrop.get(index);
    if (dropId !== undefined && mine.has(dropId)) out.push({ index, dropId, valueStar: coin.value });
  }
  return out.sort((a, b) => (a.index < b.index ? -1 : 1));
}
```

- [ ] **Step 4: Run to verify pass.** **Step 5: Commit** — `git commit -m "feat(creator): drop registration and escrow listing over the contract client"`

---

### Task 4: Session and `App.tsx`

**Files:**
- Create: `creator/src/session.ts`, `creator/src/App.tsx`
- Env: `VITE_INDEXER_URL` (default `http://localhost:8080`), `VITE_EXPECTED_MEASUREMENT_HEX` (pinned RTMR3), `VITE_FAKE_WALLET` (`1` → `FakeBlindfoldClient`, no chain), `VITE_PROOF_SERVER_URL`.

**Interfaces:**
- Produces: `openSession(indexerUrl, choice): Promise<{ wallet: ConnectedWallet; client: BlindfoldClient; contractAddress: string; network: string }>`; the App's provision flow: encrypt → upload → createDrop → attest → provision, and the withdraw view.

- [ ] **Step 1: `creator/src/session.ts`**

```ts
import { buildProviders, connectContract, connectWallet, fakeConnectedWallet, FakeBlindfoldClient, listWallets, setNetworkId, type BlindfoldClient, type ConnectedWallet, type WalletChoice } from '@blindfold/midnight-web';
import { fetchContract } from './api';
import { loadOrCreateSecret } from './secret';

export type Session = { wallet: ConnectedWallet; client: BlindfoldClient; contractAddress: string; network: string };
export const FAKE = import.meta.env.VITE_FAKE_WALLET === '1';
export function availableWallets(): WalletChoice[] { return FAKE ? [{ key: 'fake', name: 'Fake wallet (no chain)', apiVersion: '0', api: {} as any }] : listWallets(); }

export async function openSession(indexerUrl: string, choice: WalletChoice): Promise<Session> {
  const info = await fetchContract(indexerUrl);
  setNetworkId(info.network);
  const secret = loadOrCreateSecret();
  if (FAKE) return { wallet: fakeConnectedWallet(), client: new FakeBlindfoldClient(), contractAddress: info.contract_address, network: info.network };
  const wallet = await connectWallet(info.network, choice);
  if (wallet.networkId !== info.network) throw new Error(`wallet is on ${wallet.networkId}, the contract lives on ${info.network}. Switch the wallet network.`);
  const providers = await buildProviders(wallet, { zkAssetsUrl: `${window.location.origin}/contract/blindfold`, storeName: 'blindfold-creator', proofServerFallback: import.meta.env.VITE_PROOF_SERVER_URL ?? 'http://localhost:6300' });
  const client = await connectContract(providers, info.contract_address, secret, `blindfold-creator-${info.contract_address.slice(0, 8)}`, info.network);
  return { wallet, client, contractAddress: info.contract_address, network: info.network };
}
```

- [ ] **Step 2: `creator/src/App.tsx`**

Keep the prototype's layout (toolbar, panels, `Step` component, `runStage`, `errorMessage`). The state and submit logic become:

```tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { explainWalletError, type WalletChoice } from '@blindfold/midnight-web';
import { fetchAttestation, postProvision, uploadContentBlob } from './api';
import { verifyAttestationOrThrow } from './attestation';
import { utf8Bytes } from './bytes';
import { escrowForDrops, registerDrop, suggestDropId } from './chain';
import { encryptContent } from './content';
import { listDrops, rememberDrop } from './drops';
import { priceNightToStar } from './price';
import { buildProvisionPayload, sealProvisionPayload } from './provision';
import { exportSecretFile, importSecretFile, loadOrCreateSecret } from './secret';
import { availableWallets, openSession, type Session } from './session';
import './styles.css';

type StepState = 'idle' | 'running' | 'done' | 'error';
type Steps = { encrypt: StepState; register: StepState; attest: StepState; provision: StepState };
const idle: Steps = { encrypt: 'idle', register: 'idle', attest: 'idle', provision: 'idle' };
const indexerUrl = import.meta.env.VITE_INDEXER_URL ?? 'http://localhost:8080';
const defaultMeasurement = import.meta.env.VITE_EXPECTED_MEASUREMENT_HEX ?? '';
const formatNight = (star: bigint) => { const w = star / 1_000_000n, f = star % 1_000_000n; return f === 0n ? `${w}` : `${w}.${f.toString().padStart(6, '0').replace(/0+$/, '')}`; };

export function App() {
  const wallets = useMemo(availableWallets, []);
  const [session, setSession] = useState<Session | null>(null);
  const [title, setTitle] = useState('Private demo drop');
  const [dropId, setDropId] = useState('1');
  const [priceNight, setPriceNight] = useState('1');
  const [expectedMeasurement, setExpectedMeasurement] = useState(defaultMeasurement);
  const [devMode, setDevMode] = useState(false);
  const [textContent, setTextContent] = useState('Hello from a locally encrypted drop.');
  const [file, setFile] = useState<File | null>(null);
  const [steps, setSteps] = useState<Steps>(idle);
  const [message, setMessage] = useState('');
  const [escrow, setEscrow] = useState<Array<{ index: bigint; dropId: bigint; valueStar: bigint }>>([]);
  const inFlight = useRef(false);
  const running = Object.values(steps).some((s) => s === 'running');

  const connect = useCallback(async (choice: WalletChoice) => {
    setMessage('');
    try { const s = await openSession(indexerUrl, choice); setSession(s); setDropId(String(suggestDropId(await s.client.ledger()))); }
    catch (e) { setMessage(explainWalletError(e)); }
  }, []);

  const refreshEscrow = useCallback(async () => {
    if (!session) return;
    const view = await session.client.ledger();
    setEscrow(escrowForDrops(view, listDrops(session.contractAddress).map((d) => d.dropId)));
  }, [session]);
  useEffect(() => { void refreshEscrow(); }, [refreshEscrow]);

  async function submit() {
    if (!session || inFlight.current) return;
    inFlight.current = true; setMessage(''); setSteps(idle);
    try {
      const id = Number(dropId); if (!Number.isSafeInteger(id) || id < 0) throw new Error('validation: drop id must be a non-negative integer');
      const priceStar = priceNightToStar(priceNight);
      setSteps({ ...idle, encrypt: 'running' });
      const plaintext = file ? new Uint8Array(await file.arrayBuffer()) : utf8Bytes(textContent);
      const enc = await encryptContent(plaintext);
      await uploadContentBlob(indexerUrl, enc.hContent, enc.blob);
      setSteps({ ...idle, encrypt: 'done', register: 'running' });
      const tx = await registerDrop(session.client, { dropId: id, priceStar, kDrop: enc.kDrop, hContent: enc.hContent });
      rememberDrop({ dropId: id, title, priceStar: priceStar.toString(), contractAddress: session.contractAddress, hContent: enc.hContent });
      setSteps({ ...idle, encrypt: 'done', register: 'done', attest: 'running' });
      const attestation = await fetchAttestation(indexerUrl);
      let enclavePubkey: Uint8Array;
      if (attestation.quote_hex === 'dev') {
        if (!devMode) throw new Error('attest: the indexer runs without a TEE (quote "dev"). Enable "dev mode" only on a local devnet.');
        enclavePubkey = Uint8Array.from(Buffer.from(attestation.provisioning_pubkey_hex, 'hex'));
      } else {
        enclavePubkey = await verifyAttestationOrThrow(attestation, expectedMeasurement);
      }
      setSteps({ ...idle, encrypt: 'done', register: 'done', attest: 'done', provision: 'running' });
      const payload = buildProvisionPayload({ dropId: id, priceStar, kDrop: enc.kDrop, hContent: enc.hContent, title });
      await postProvision(indexerUrl, await sealProvisionPayload(payload, enclavePubkey));
      setSteps({ encrypt: 'done', register: 'done', attest: 'done', provision: 'done' });
      setMessage(`Drop ${id} is live (tx ${tx.txId}). Buyers can purchase it now.`);
      setDropId(String(id + 1));
    } catch (e) {
      setSteps((p) => { const k = (Object.keys(p) as (keyof Steps)[]).find((s) => p[s] === 'running'); return k ? { ...p, [k]: 'error' } : p; });
      setMessage(explainWalletError(e));
    } finally { inFlight.current = false; }
  }

  async function withdraw(index: bigint) {
    if (!session) return; setMessage('');
    try { const tx = await session.client.withdraw(index); setMessage(`Withdrew purchase ${index} (tx ${tx.txId}).`); await refreshEscrow(); }
    catch (e) { setMessage(explainWalletError(e)); }
  }

  const exportSecret = () => { const blob = new Blob([exportSecretFile(loadOrCreateSecret())], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'blindfold-creator-secret.json'; a.click(); URL.revokeObjectURL(a.href); };
  const importSecret = async (f: File) => { try { importSecretFile(await f.text()); setMessage('Creator secret imported. Reconnect the wallet.'); setSession(null); } catch (e) { setMessage(String(e)); } };

  return (
    <main className="shell">
      <section className="toolbar"><div className="title-block"><p className="eyebrow">Blindfold</p><h1>Creator</h1></div>
        <button className="primary" disabled={!session || running || !title.trim() || !(file || textContent.trim())} onClick={() => void submit()}>Encrypt + Register + Provision</button></section>
      <section className="grid">
        <div className="panel"><h2>Wallet</h2>
          {session ? <p className="note">{session.wallet.name} on {session.network} · contract {session.contractAddress.slice(0, 10)}…</p> :
            wallets.length === 0 ? <p className="note">No Midnight wallet found. Install Lace or 1AM and reload.</p> :
            wallets.map((w) => <button key={w.key} onClick={() => void connect(w)}>Connect {w.name}</button>)}
          <div className="pair"><button onClick={exportSecret}>Export creator secret</button>
            <label className="field">Import secret<input type="file" accept="application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSecret(f); }} /></label></div>
          <p className="note">The creator secret authorizes withdrawals. Losing it means losing access to escrowed NIGHT.</p>
        </div>
        <div className="panel"><h2>Indexer trust</h2>
          <label className="field">Expected measurement (RTMR3 hex)<input value={expectedMeasurement} onChange={(e) => setExpectedMeasurement(e.target.value)} /></label>
          <label className="remember"><input type="checkbox" checked={devMode} onChange={(e) => setDevMode(e.target.checked)} /> dev mode: accept an indexer without a TEE (local devnet only)</label>
        </div>
        <div className="panel"><h2>Drop</h2>
          <div className="pair"><label className="field">Drop ID<input value={dropId} onChange={(e) => setDropId(e.target.value)} inputMode="numeric" /></label>
            <label className="field">Price (NIGHT)<input value={priceNight} onChange={(e) => setPriceNight(e.target.value)} inputMode="decimal" /></label></div>
          <label className="field">Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        </div>
        <div className="panel wide"><h2>Content</h2>
          <div className="pair"><label className="field">File<input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
            <label className="field">Text fallback<textarea value={textContent} onChange={(e) => setTextContent(e.target.value)} rows={4} disabled={Boolean(file)} /></label></div>
        </div>
        <div className="panel wide"><h2>Status</h2>
          <div className="steps"><Step label="Encrypt + upload" state={steps.encrypt} /><Step label="Register on contract" state={steps.register} /><Step label="Verify TEE attestation" state={steps.attest} /><Step label="Seal + provision" state={steps.provision} /></div>
          {message ? <p className="message" role="status">{message}</p> : null}
        </div>
        <div className="panel wide"><h2>Escrowed purchases (my drops)</h2>
          <button onClick={() => void refreshEscrow()}>Refresh</button>
          {escrow.length === 0 ? <p className="note">Nothing to withdraw.</p> :
            <ul className="drops">{escrow.map((e) => <li key={e.index.toString()}><span>purchase {e.index.toString()} · drop {e.dropId.toString()} · {formatNight(e.valueStar)} NIGHT</span><button onClick={() => void withdraw(e.index)}>Withdraw</button></li>)}</ul>}
        </div>
      </section>
    </main>
  );
}

function Step({ label, state }: { label: string; state: StepState }) {
  return <div className={`step ${state}`} aria-label={`${label}: ${state}`}><span aria-hidden="true" />{label}</div>;
}
```

- [ ] **Step 3: Type-check and run the fake flow**

Run: `cd creator && npx tsc --noEmit && VITE_FAKE_WALLET=1 npm run dev` with the Lane A indexer running in dev mode (`DEV_SEED_HEX` set) and its `CONTRACT_ADDRESS` pointing at a devnet contract. In the fake flow the `createDrop` is fake, so `/provision` answers 404 `unknown_drop`: expected. Confirm the steps render and the error text is the indexer's message.

- [ ] **Step 4: Run the real flow on the devnet with Lace**: connect Lace (Undeployed), dev mode on, submit. Expected: four green steps, "Drop N is live", and the indexer log shows the catalog entry; then the buyer app (Lane B) can purchase it and the escrow list shows the purchase; Withdraw returns the NIGHT to Lace.

- [ ] **Step 5: Commit** — `git commit -m "feat(creator): register-on-contract, attestation gate, provisioning, and withdraw view"`

---

### Task 5: Playwright smoke (fake wallet, mocked indexer)

**Files:**
- Create: `creator/playwright.config.ts`, `creator/e2e/provision.spec.ts`

- [ ] **Step 1: Config** — same as the buyer's (Lane B Task 6) with port 5174 and `VITE_FAKE_WALLET=1 VITE_INDEXER_URL=http://127.0.0.1:5174/mock`.

- [ ] **Step 2: Test** (routes the indexer calls to in-page mocks)

```ts
import { test, expect } from '@playwright/test';
import sodium from 'libsodium-wrappers';

test('provision flow reaches the provision step and posts a sealed payload', async ({ page }) => {
  await sodium.ready;
  const enclave = sodium.crypto_box_keypair();
  let sealed: Buffer | null = null;
  await page.route('**/mock/contract', (r) => r.fulfill({ json: { network: 'undeployed', contract_address: 'ab'.repeat(32) } }));
  await page.route('**/mock/bucket/*', (r) => r.fulfill({ json: { ok: true } }));
  await page.route('**/mock/attest', (r) => r.fulfill({ json: { quote_hex: 'dev', provisioning_pubkey_hex: Buffer.from(enclave.publicKey).toString('hex') } }));
  await page.route('**/mock/provision', (r) => { sealed = r.request().postDataBuffer(); r.fulfill({ json: { ok: true, drop_id: 1 } }); });
  await page.goto('/');
  await page.getByRole('button', { name: /Connect Fake/ }).click();
  await page.getByLabel(/dev mode/).check();
  await page.getByRole('button', { name: /Encrypt \+ Register \+ Provision/ }).click();
  await expect(page.getByText(/is live/)).toBeVisible({ timeout: 30_000 });
  const opened = sodium.crypto_box_seal_open(new Uint8Array(sealed!), enclave.publicKey, enclave.privateKey);
  const payload = JSON.parse(new TextDecoder().decode(opened));
  expect(payload.drop_id).toBe(1);
  expect(payload.k_drop).toMatch(/^[0-9a-f]{64}$/);
  expect(payload.price_star).toBe('1000000');
});
```

- [ ] **Step 3: Run** — `npx playwright install chromium && npm run test:e2e` → 1 passed. **Step 4: Commit** — `git commit -m "test(creator): playwright smoke of the provisioning flow"`

---

## Self-review

- Spec coverage: section 9 (kept modules Task 1; payload Task 1; wallet and contract calls Tasks 3, 4; secret persistence with export/import Task 2; flow order encrypt → upload → createDrop → attest → provision Task 4; drop id suggestion Task 3; withdraw view Task 4), section 6 I4/I5/I6 (Tasks 1, 4), section 11 (unit tests Tasks 1 to 3, Playwright Task 5). The dev-mode attestation switch is an addition required by the dev indexer's `"dev"` quote (Lane A Task 10) and is documented in the constraints.
- Placeholders: none.
- Type consistency: `registerDrop` calls `client.createDrop(bigint, bigint, Uint8Array)` matching Lane B's `BlindfoldClient`; `escrowForDrops` reads `view.escrow` entries `{ value, mt_index }` as produced by `ledgerView`; `buildProvisionPayload` output matches Lane A's `ProvisionPayload` field names and formats; `IndexerApiError.status` is set from the HTTP status so 409/404 are distinguishable.
