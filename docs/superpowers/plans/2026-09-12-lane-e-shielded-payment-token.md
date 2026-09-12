# Lane E: bNIGHT shielded payment token — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a buyer who holds only public NIGHT make an anonymous purchase by moving NIGHT into a contract-minted shielded token (bNIGHT) in fixed denominations, and let the creator cash that token back out to public NIGHT.

**Architecture:** The Compact contract gains `wrap` (public NIGHT in, bNIGHT out to the caller's shielded key, 5/10/50 NIGHT only) and `unwrap` (bNIGHT in, public NIGHT out to a given address); `purchase` now requires a bNIGHT coin. The shared `@blindfold/midnight-web` client exposes `wrap`, `unwrap`, `privateBalance`, and `paymentTokenColor`; both apps show one **Private balance** panel. The indexer is untouched; its image is rebuilt only because the compiled artifacts change.

**Tech Stack:** Compact 0.31.1 (language 0.23), midnight-js 4.1.1, ledger-v8 8.1.0 (`rawTokenType`), `@midnight-ntwrk/wallet-sdk-address-format` 3.1.0, React 19 + Vite 8, vitest, Playwright, Phala CLI.

**Spec:** `docs/superpowers/specs/2026-09-12-lane-e-shielded-payment-token-design.md`

## Global Constraints

- Work on branch `lane-e`. Never commit to `main`; never push `main` from this lane.
- Pinned versions stay: Compact 0.31.1, midnight-js 4.1.1, ledger-v8 8.1.0, compact-runtime 0.16.0, one copy of `@midnight-ntwrk/onchain-runtime-v3` 3.0.0 (`npm run check:runtime-copies` must print `ok`).
- No references to other chains in tracked text. No seeds, mnemonics, wallet addresses of real people, `.midnight-state.json`, wallet state, or `.env` files committed.
- Denominations are exactly 5 000 000, 10 000 000, 50 000 000 STAR (5, 10, 50 NIGHT), enforced in the circuit and mirrored in `TOP_UP_DENOMINATIONS_STAR`.
- The domain separator is `pad(32, "blindfold:bNIGHT")` in Compact and the same 32 bytes (UTF-8 `blindfold:bNIGHT`, zero-padded to 32) in TypeScript. Token name in code/docs: `bNIGHT`; UI label: **Private balance**. The word "wrap" never appears in UI copy.
- Top up and Buy are separate actions. Buy is disabled (label `Top up first`) when `privateBalance < price`; there is no automatic wrap-then-buy.
- Ports: buyer dev 5173 / smoke 5174; creator dev 5175 / smoke 5176. Fake mode stays gated by `import.meta.env.DEV && VITE_FAKE_WALLET === '1'`.
- Every devnet command names the network: `--network undeployed` (the state file's active network is `preprod` on this machine).
- Before every commit: the touched workspace's `npm test`; before pushing: root `npm test`, `npm run build -w indexer -w packages/midnight-web -w buyer -w creator`, `npm run qa:secrets`.

## File structure

| File | Responsibility |
|---|---|
| `contract/src/blindfold.compact` | `wrap`, `unwrap`, bNIGHT color check in `purchase`, `wrapNonce` ledger cell |
| `contract/scripts/lib/providers.ts` | headless helpers: `PAYMENT_DOMAIN`, `paymentColor(contractAddress)`, `paymentCoin(contractAddress, value)`, `TOP_UP_DENOMINATIONS_STAR` |
| `contract/test/flow.test.ts` | devnet flow: wrap → purchase → withdraw → unwrap, plus refusals |
| `packages/midnight-web/src/contract.ts` | browser client: `paymentTokenColor`, `paymentCoin`, `wrap`, `unwrap`, `privateBalance` |
| `packages/midnight-web/src/wallet.ts` | `unshieldedAddress(w)`, `balances(w)` gains `unshieldedNight` in the return the apps use |
| `packages/midnight-web/src/providers.ts` | circuit id union gains `wrap` and `unwrap` |
| `packages/midnight-web/src/fake.ts` | fake client with an in-memory private balance |
| `packages/midnight-web/test/contract.test.ts`, `test/fake.test.ts` | unit tests for the above |
| `buyer/src/privateBalance.ts` | pure helpers: `canBuy`, `smallestTopUpCovering`, `formatNight` reuse |
| `buyer/src/App.tsx`, `buyer/src/session.ts` | Private balance panel, Buy gating, Cash out |
| `buyer/e2e/buy.spec.ts` | smoke: Top up first → Top up 5 → Buy → unlock |
| `creator/src/App.tsx`, `creator/src/session.ts` | Private balance panel with Cash out |
| `creator/e2e/cashout.spec.ts` | smoke: cash out a seeded private balance |
| `indexer/test/e2e.devnet.test.ts` | buyer wraps before purchasing |
| `docs/*`, `README.md` | wording and demo script |
| `deploy/*` | redeploy, re-pin (Task 7) |

---

### Task 1: Contract circuits and devnet flow test

**Files:**
- Modify: `contract/src/blindfold.compact`
- Modify: `contract/scripts/lib/providers.ts:11-14,61-63`
- Modify: `contract/test/flow.test.ts`

**Interfaces:**
- Produces (Compact): `export circuit wrap(amount: Uint<64>): []`, `export circuit unwrap(coin: ShieldedCoinInfo, to: UserAddress): []`, `purchase` unchanged in signature but requires `coin.color == tokenType(pad(32, "blindfold:bNIGHT"), kernel.self())`, new ledger cell `wrapNonce: Bytes<32>`.
- Produces (TS, `contract/scripts/lib/providers.ts`): `PAYMENT_DOMAIN: Uint8Array` (32 bytes), `TOP_UP_DENOMINATIONS_STAR: readonly bigint[]`, `paymentColor(contractAddress: string): Uint8Array` (32 bytes), `paymentColorHex(contractAddress: string): string`, `paymentCoin(contractAddress: string, value: bigint): { nonce: Uint8Array; color: Uint8Array; value: bigint }`.

- [ ] **Step 1: Write the failing devnet tests**

Replace `contract/test/flow.test.ts` with:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import { WebSocket } from 'ws';
// @ts-expect-error polyfill
globalThis.WebSocket = WebSocket;
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { resolveNetwork, GENESIS_SEED } from '../scripts/lib/network';
import { createWallet, persistWalletState, type WalletContext } from '../scripts/lib/wallet';
import {
  buildProviders, loadCompiledContract, loadContractModule, nightCoin,
  paymentCoin, paymentColorHex, TOP_UP_DENOMINATIONS_STAR,
} from '../scripts/lib/providers';

const NATIVE = '0'.repeat(64);
const PRICE = 1_000_000n;            // 1 NIGHT
const TOP_UP = TOP_UP_DENOMINATIONS_STAR[0]; // 5 NIGHT
const unshieldedNight = (s: any): bigint => s.unshielded.balances[NATIVE] ?? 0n;
const privateNight = (s: any, color: string): bigint => s.shielded.balances[color] ?? 0n;

describe.skipIf(!process.env.DEVNET)('blindfold contract flow (local devnet)', () => {
  const { network, config } = resolveNetwork({ argv: ['node', 'flow', '--network', 'undeployed'] });
  let ctx: WalletContext;
  let providers: ReturnType<typeof buildProviders>;
  let mod: any;
  let compiled: any;
  let address: string;
  let color: string;
  const creatorSecret = randomBytes(32);
  const kDrop = randomBytes(32);
  const hContent = Buffer.alloc(32, 0xcd);
  const commit = createHash('sha256').update(Buffer.concat([kDrop, hContent])).digest();

  beforeAll(async () => {
    ctx = await createWallet({ network, networkConfig: config, seed: GENESIS_SEED });
    await ctx.wallet.waitForSyncedState();
    providers = buildProviders(ctx, config, 'blindfold-flow-test');
    mod = await loadContractModule();
    compiled = await loadCompiledContract();
    const deployed: any = await deployContract(providers, {
      compiledContract: compiled, args: [], privateStateId: `flow-creator-${Date.now()}`,
      initialPrivateState: { secret: creatorSecret },
    });
    address = deployed.deployTxData.public.contractAddress;
    color = paymentColorHex(address);
  }, 180_000);
  afterAll(async () => { await ctx.wallet.stop(); });

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

  it('wrap refuses an amount that is not 5, 10, or 50 NIGHT', async () => {
    const buyer = await asStranger();
    await expect(buyer.callTx.wrap(7_000_000n)).rejects.toThrow(/top up 5, 10, or 50 NIGHT/);
  });

  it('wrap moves public NIGHT into the contract and mints the same amount of bNIGHT to the caller', async () => {
    const before = await ctx.wallet.waitForSyncedState();
    const buyer = await asStranger();
    await buyer.callTx.wrap(TOP_UP);
    const after = await ctx.wallet.waitForSyncedState();
    expect(privateNight(after, color) - privateNight(before, color)).toBe(TOP_UP);
    // fees are DUST, so the public NIGHT delta is exactly the top-up
    expect(unshieldedNight(before) - unshieldedNight(after)).toBe(TOP_UP);
  });

  it('purchase refuses a native-colored coin', async () => {
    const buyer = await asStranger();
    await expect(buyer.callTx.purchase(1n, randomBytes(32), nightCoin(PRICE))).rejects.toThrow(/must pay in bNIGHT/);
  });

  it('purchase escrows a bNIGHT coin and records the one-time key', async () => {
    const before = privateNight(await ctx.wallet.waitForSyncedState(), color);
    const buyer = await asStranger();
    const ePub = randomBytes(32);
    await buyer.callTx.purchase(1n, ePub, paymentCoin(address, PRICE));
    const after = privateNight(await ctx.wallet.waitForSyncedState(), color);
    expect(before - after).toBe(PRICE);
    const L = await ledger();
    expect(L.purchaseCount).toBe(1n);
    expect(Buffer.from(L.purchases.lookup(0n)).equals(ePub)).toBe(true);
    expect(L.purchaseDrop.lookup(0n)).toBe(1n);
    expect(L.escrow.lookup(0n).value).toBe(PRICE);
  });

  it('purchase rejects an underpaid coin', async () => {
    const buyer = await asStranger();
    await expect(buyer.callTx.purchase(1n, randomBytes(32), paymentCoin(address, PRICE - 1n))).rejects.toThrow(/underpaid/);
  });

  it('withdraw by a non-owner is rejected', async () => {
    const s = await asStranger();
    await expect(s.callTx.withdraw(0n)).rejects.toThrow(/not the creator/);
  });

  it('withdraw by the creator returns the escrowed bNIGHT', async () => {
    const before = privateNight(await ctx.wallet.waitForSyncedState(), color);
    const c = await asCreator();
    await c.callTx.withdraw(0n);
    const after = privateNight(await ctx.wallet.waitForSyncedState(), color);
    expect(after - before).toBe(PRICE);
    expect((await ledger()).escrow.member(0n)).toBe(false);
  });

  // The wallet's own public address as the 32-byte UserAddress the circuit expects.
  function ownUserAddress() {
    const bech32 = String(ctx.unshieldedKeystore.getBech32Address());
    return { bytes: new Uint8Array(UnshieldedAddress.codec.decode(network, MidnightBech32m.parse(bech32)).data) };
  }

  it('unwrap refuses a coin of another color', async () => {
    const c = await asCreator();
    await expect(c.callTx.unwrap(nightCoin(PRICE), ownUserAddress())).rejects.toThrow(/not bNIGHT/);
  });

  it('unwrap returns public NIGHT for bNIGHT', async () => {
    const before = await ctx.wallet.waitForSyncedState();
    const c = await asCreator();
    await c.callTx.unwrap(paymentCoin(address, PRICE), ownUserAddress());
    const after = await ctx.wallet.waitForSyncedState();
    expect(privateNight(before, color) - privateNight(after, color)).toBe(PRICE);
    expect(unshieldedNight(after) - unshieldedNight(before)).toBe(PRICE);
  });
});
```

`ownUserAddress()` decodes the bech32m string that `deploy.ts` already prints via `getBech32Address().toString()`; `UnshieldedAddress.data` is a 32-byte Buffer (see `node_modules/@midnight-ntwrk/wallet-sdk-address-format/dist/index.d.ts`).

- [ ] **Step 2: Run the tests to verify they fail**

Start the devnet if it is down: `docker compose -f deploy/devnet/docker-compose.yml up -d --wait` (Docker CLI is at `~/.docker/bin`).

Run: `cd contract && DEVNET=1 npx vitest run test/flow.test.ts`
Expected: FAIL. The wrap tests fail with `callTx.wrap is not a function`; `paymentCoin` is not exported.

- [ ] **Step 3: Add the headless helpers**

In `contract/scripts/lib/providers.ts` add after `NATIVE_COLOR`:

```ts
import { rawTokenType } from '@midnight-ntwrk/ledger-v8';

// Must equal the Compact side: pad(32, "blindfold:bNIGHT").
export const PAYMENT_DOMAIN: Uint8Array = (() => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode('blindfold:bNIGHT'));
  return out;
})();
export const TOP_UP_DENOMINATIONS_STAR: readonly bigint[] = [5_000_000n, 10_000_000n, 50_000_000n];

const hexToBytes = (h: string) => new Uint8Array((h.replace(/^0x/, '').match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));

/** Hex color of the bNIGHT minted by the contract at `contractAddress` (ledger `tokenType(domainSep, contract)`). */
export function paymentColorHex(contractAddress: string): string {
  return rawTokenType(PAYMENT_DOMAIN, contractAddress).replace(/^0x/, '').toLowerCase();
}
export function paymentColor(contractAddress: string): Uint8Array {
  return hexToBytes(paymentColorHex(contractAddress));
}
/** A fresh bNIGHT coin description for `purchase` / `unwrap`; the wallet funds it from the caller's bNIGHT. */
export function paymentCoin(contractAddress: string, value: bigint) {
  return { nonce: crypto.getRandomValues(new Uint8Array(32)), color: paymentColor(contractAddress), value };
}
```

If `rawTokenType` is not exported by `@midnight-ntwrk/ledger-v8` under that name, run `grep -n "rawTokenType\|function tokenType" node_modules/@midnight-ntwrk/ledger-v8/ledger-v8.d.ts` and use the exported name (the signature is `(domain_sep: Uint8Array, contract: string) => string`).

- [ ] **Step 4: Write the contract**

Replace `contract/src/blindfold.compact` with:

```compact
// Blindfold payment gate. Public NIGHT enters through `wrap` and becomes bNIGHT, a shielded token
// this contract mints; a buyer pays bNIGHT and registers a one-time key in one transaction; the
// creator registers drops, withdraws escrowed bNIGHT, and cashes it out through `unwrap`.
pragma language_version 0.23;
import CompactStandardLibrary;

export ledger drops: Map<Uint<64>, Uint<128>>;               // dropId -> price in STAR (1 bNIGHT = 1 NIGHT)
export ledger dropOwner: Map<Uint<64>, Bytes<32>>;           // dropId -> creator dapp pubkey
export ledger kCommit: Map<Uint<64>, Bytes<32>>;             // dropId -> sha256(K_drop || h_content), set by the creator app
export ledger purchaseCount: Counter;
export ledger purchases: Map<Uint<64>, Bytes<32>>;           // index -> buyer one-time X25519 pubkey
export ledger purchaseDrop: Map<Uint<64>, Uint<64>>;         // index -> dropId
export ledger escrow: Map<Uint<64>, QualifiedShieldedCoinInfo>; // index -> contract-held coin
export ledger wrapNonce: Bytes<32>;                          // evolves on every mint; keeps coin nonces unique

witness creatorSecret(): Bytes<32>;

circuit creatorPk(sk: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "blindfold:creator:"), sk]);
}

circuit paymentDomain(): Bytes<32> { return pad(32, "blindfold:bNIGHT"); }
circuit paymentToken(): Bytes<32> { return tokenType(paymentDomain(), kernel.self()); }

export circuit createDrop(dropId: Uint<64>, price: Uint<128>, commit: Bytes<32>): [] {
  assert(!drops.member(disclose(dropId)), "drop already exists");
  assert(price > 0, "price must be positive");
  drops.insert(disclose(dropId), disclose(price));
  kCommit.insert(disclose(dropId), disclose(commit));
  dropOwner.insert(disclose(dropId), disclose(creatorPk(creatorSecret())));
}

// Public NIGHT in, the same amount of bNIGHT out to the caller's shielded key. Fixed denominations
// keep top-up amounts from fingerprinting a buyer.
export circuit wrap(amount: Uint<64>): [] {
  const a = disclose(amount);
  assert(a == 5000000 || a == 10000000 || a == 50000000, "top up 5, 10, or 50 NIGHT");
  receiveUnshielded(nativeToken(), a as Uint<128>);
  const nonce = persistentHash<Vector<2, Bytes<32>>>([wrapNonce, pad(32, "blindfold:wrap:")]);
  wrapNonce = nonce;
  mintShieldedToken(paymentDomain(), a, nonce, left<ZswapCoinPublicKey, ContractAddress>(ownPublicKey()));
}

export circuit purchase(dropId: Uint<64>, ePub: Bytes<32>, coin: ShieldedCoinInfo): [] {
  assert(drops.member(disclose(dropId)), "unknown drop");
  assert(coin.color == paymentToken(), "must pay in bNIGHT");
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

// bNIGHT in (kept by the contract forever: there is no burn), the same amount of public NIGHT out.
export circuit unwrap(coin: ShieldedCoinInfo, to: UserAddress): [] {
  assert(coin.color == paymentToken(), "not bNIGHT");
  receiveShielded(disclose(coin));
  sendUnshielded(nativeToken(), coin.value, right<ContractAddress, UserAddress>(disclose(to)));
}
```

Compile: `npm run compile -w contract`. Expected: `Compiling 5 circuits:` and `compiled -> build/blindfold`. If the compiler rejects `a as Uint<128>`, write `(a as Uint<128>)`; if it rejects assigning `wrapNonce = nonce`, use `wrapNonce.write(nonce)` (Cell API for this language version) and read with `wrapNonce.read()`. If `||` is rejected, replace the assert with three nested `if` checks that each `assert(false, …)` otherwise.

- [ ] **Step 5: Run the devnet tests to verify they pass**

Run: `cd contract && DEVNET=1 npx vitest run test/flow.test.ts`
Expected: 11 passed. If `wrap` fails with an unshielded balancing error from the headless wallet, read `node_modules/@midnight-ntwrk/midnight-js-contracts/dist/index.mjs` around `unshielded` and report BLOCKED with the exact error; do not work around it in the contract.

- [ ] **Step 6: Commit**

```bash
git add contract/src/blindfold.compact contract/scripts/lib/providers.ts contract/test/flow.test.ts
git commit -m "feat(contract): wrap/unwrap bNIGHT, purchase requires the contract's shielded token"
```

---

### Task 2: Shared client API (`@blindfold/midnight-web`)

**Files:**
- Modify: `packages/midnight-web/src/contract.ts`
- Modify: `packages/midnight-web/src/wallet.ts`
- Modify: `packages/midnight-web/src/providers.ts:11,26`
- Modify: `packages/midnight-web/src/fake.ts`
- Modify: `packages/midnight-web/package.json` (add `"@midnight-ntwrk/wallet-sdk-address-format": "3.1.0"` to dependencies; run `npm install` at the root afterwards and confirm `npm run check:runtime-copies` still prints `ok`)
- Test: `packages/midnight-web/test/contract.test.ts`, `packages/midnight-web/test/fake.test.ts`

**Interfaces:**
- Consumes: Task 1's circuit names `wrap`, `unwrap` and the compiled artifacts.
- Produces:
  - `export const PAYMENT_DOMAIN: Uint8Array`, `export const TOP_UP_DENOMINATIONS_STAR: readonly bigint[]`
  - `export function paymentTokenColor(contractAddress: string): string` (64 lowercase hex)
  - `export function paymentCoin(contractAddress: string, value: bigint): { nonce: Uint8Array; color: Uint8Array; value: bigint }`
  - `interface BlindfoldClient` gains `wrap(amountStar: bigint): Promise<TxRef>`, `unwrap(valueStar: bigint, toUnshieldedAddress: string): Promise<TxRef>`, `privateBalance(): Promise<bigint>`, `paymentTokenColor(): string`
  - `connectContract(providers, contractAddress, secret, privateStateId, networkId, zkAssetsPath?, wallet?: ConnectedWallet)`: `privateBalance()` needs `wallet`; without it the method throws `Error('privateBalance needs the connected wallet')`.
  - `export async function unshieldedAddress(w: ConnectedWallet): Promise<string>` in `wallet.ts` (bech32m from `getUnshieldedAddress()`)
  - `balances(w)` unchanged shape plus nothing new (private balance comes from the client).
  - `FakeBlindfoldClient` constructor gains `options?: { privateBalance?: bigint }` as a third parameter; `wrap/unwrap/privateBalance/paymentTokenColor` implemented in memory; `purchase` throws `Error('insufficient private balance')` when balance < price and deducts otherwise; `withdraw` adds the escrowed value to the private balance.

- [ ] **Step 1: Write the failing unit tests**

`packages/midnight-web/test/contract.test.ts` — append:

```ts
import { paymentTokenColor, paymentCoin, TOP_UP_DENOMINATIONS_STAR, PAYMENT_DOMAIN } from '../src/contract';

describe('bNIGHT helpers', () => {
  const a = 'ab'.repeat(32);
  const b = 'cd'.repeat(32);
  it('domain separator is blindfold:bNIGHT zero-padded to 32 bytes', () => {
    expect(PAYMENT_DOMAIN.length).toBe(32);
    expect(new TextDecoder().decode(PAYMENT_DOMAIN.subarray(0, 16))).toBe('blindfold:bNIGHT');
    expect([...PAYMENT_DOMAIN.subarray(16)].every((x) => x === 0)).toBe(true);
  });
  it('color is 64 hex, deterministic, and bound to the contract address', () => {
    expect(paymentTokenColor(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(paymentTokenColor(a)).toBe(paymentTokenColor(a));
    expect(paymentTokenColor(a)).not.toBe(paymentTokenColor(b));
    expect(paymentTokenColor(a)).not.toBe('0'.repeat(64));
  });
  it('paymentCoin carries that color and a fresh nonce', () => {
    const c1 = paymentCoin(a, 5n); const c2 = paymentCoin(a, 5n);
    expect(Buffer.from(c1.color).toString('hex')).toBe(paymentTokenColor(a));
    expect(Buffer.from(c1.nonce).equals(Buffer.from(c2.nonce))).toBe(false);
    expect(c1.value).toBe(5n);
  });
  it('denominations are 5, 10, 50 NIGHT', () => {
    expect(TOP_UP_DENOMINATIONS_STAR).toEqual([5_000_000n, 10_000_000n, 50_000_000n]);
  });
});
```

New `packages/midnight-web/test/fake.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FakeBlindfoldClient } from '../src/fake';

describe('FakeBlindfoldClient private balance', () => {
  it('starts at zero, wrap adds, purchase deducts, withdraw credits, unwrap deducts', async () => {
    const c = new FakeBlindfoldClient({ drops: new Map([[1n, 1_000_000n]]) });
    expect(await c.privateBalance()).toBe(0n);
    await expect(c.purchase(1n, new Uint8Array(32), 1_000_000n)).rejects.toThrow(/insufficient private balance/);
    await c.wrap(5_000_000n);
    expect(await c.privateBalance()).toBe(5_000_000n);
    await c.purchase(1n, new Uint8Array(32), 1_000_000n);
    expect(await c.privateBalance()).toBe(4_000_000n);
    await c.withdraw(0n);
    expect(await c.privateBalance()).toBe(5_000_000n);
    await c.unwrap(5_000_000n, 'mn_addr_undeployed1fake');
    expect(await c.privateBalance()).toBe(0n);
  });
  it('wrap refuses non-denominations and unwrap refuses more than the balance', async () => {
    const c = new FakeBlindfoldClient();
    await expect(c.wrap(7_000_000n)).rejects.toThrow(/top up 5, 10, or 50 NIGHT/);
    await expect(c.unwrap(1n, 'mn_addr_undeployed1fake')).rejects.toThrow(/insufficient private balance/);
  });
  it('can be seeded with a private balance and reports a color', () => {
    const c = new FakeBlindfoldClient({}, undefined, { privateBalance: 3_000_000n });
    expect(c.paymentTokenColor()).toMatch(/^[0-9a-f]{64}$/);
    return expect(c.privateBalance()).resolves.toBe(3_000_000n);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w packages/midnight-web`
Expected: FAIL (missing exports and methods).

- [ ] **Step 3: Implement**

`packages/midnight-web/src/contract.ts` — replace the `nightCoin` helper and the client with:

```ts
import { rawTokenType } from '@midnight-ntwrk/ledger-v8';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import type { ConnectedWallet } from './wallet';

export const PAYMENT_DOMAIN: Uint8Array = (() => { const out = new Uint8Array(32); out.set(new TextEncoder().encode('blindfold:bNIGHT')); return out; })();
export const TOP_UP_DENOMINATIONS_STAR: readonly bigint[] = [5_000_000n, 10_000_000n, 50_000_000n];
const hexToBytes = (h: string) => new Uint8Array((h.replace(/^0x/, '').match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));

export function paymentTokenColor(contractAddress: string): string {
  return rawTokenType(PAYMENT_DOMAIN, contractAddress).replace(/^0x/, '').toLowerCase();
}
export function paymentCoin(contractAddress: string, value: bigint) {
  return { nonce: crypto.getRandomValues(new Uint8Array(32)), color: hexToBytes(paymentTokenColor(contractAddress)), value };
}
/** Kept for tests that need a native-colored coin (the contract must refuse it). */
export function nightCoin(value: bigint) {
  return { nonce: crypto.getRandomValues(new Uint8Array(32)), color: new Uint8Array(32), value };
}

export interface BlindfoldClient {
  purchase(dropId: bigint, ePub: Uint8Array, price: bigint): Promise<TxRef>;
  createDrop(dropId: bigint, price: bigint, commit: Uint8Array): Promise<TxRef>;
  withdraw(idx: bigint): Promise<TxRef>;
  wrap(amountStar: bigint): Promise<TxRef>;
  unwrap(valueStar: bigint, toUnshieldedAddress: string): Promise<TxRef>;
  privateBalance(): Promise<bigint>;
  paymentTokenColor(): string;
  ledger(): Promise<LedgerView>;
}

function userAddressBytes(networkId: string, bech32: string): Uint8Array {
  return new Uint8Array(UnshieldedAddress.codec.decode(networkId, MidnightBech32m.parse(bech32)).data);
}

export async function connectContract(providers: any, contractAddress: string, secret: Uint8Array, privateStateId: string, networkId: string, zkAssetsPath = '/contract/blindfold', wallet?: ConnectedWallet): Promise<BlindfoldClient> {
  applyNetworkId(networkId);
  const compiled = CompiledContract.make<any>('blindfold', Blindfold.Contract).pipe(
    CompiledContract.withWitnesses(witnesses), CompiledContract.withCompiledFileAssets(zkAssetsPath),
  );
  const found: any = await findDeployedContract(providers, { compiledContract: compiled, contractAddress, privateStateId, initialPrivateState: { secret } });
  const ref = (tx: any): TxRef => ({ txId: tx.public.txId, blockHeight: Number(tx.public.blockHeight) });
  const color = paymentTokenColor(contractAddress);
  return {
    purchase: async (dropId, ePub, price) => ref(await found.callTx.purchase(dropId, ePub, paymentCoin(contractAddress, price))),
    createDrop: async (dropId, price, commit) => ref(await found.callTx.createDrop(dropId, price, commit)),
    withdraw: async (idx) => ref(await found.callTx.withdraw(idx)),
    wrap: async (amountStar) => {
      if (!TOP_UP_DENOMINATIONS_STAR.includes(amountStar)) throw new Error('top up 5, 10, or 50 NIGHT');
      return ref(await found.callTx.wrap(amountStar));
    },
    unwrap: async (valueStar, to) => ref(await found.callTx.unwrap(paymentCoin(contractAddress, valueStar), { bytes: userAddressBytes(networkId, to) })),
    privateBalance: async () => {
      if (!wallet) throw new Error('privateBalance needs the connected wallet');
      return (await wallet.api.getShieldedBalances())[color] ?? 0n;
    },
    paymentTokenColor: () => color,
    ledger: async () => {
      const s = await providers.publicDataProvider.queryContractState(contractAddress);
      if (!s) throw new Error(`no contract at ${contractAddress}`);
      return ledgerView(Blindfold.ledger(s.data));
    },
  };
}
```

Keep `applyNetworkId`, `LedgerView`, `TxRef`, `ledgerView`, `readLedger`, and `witnesses` exactly as they are. If the connector's `getShieldedBalances()` keys carry a `0x` prefix, normalize with `.replace(/^0x/, '').toLowerCase()` when looking up `color`.

`packages/midnight-web/src/wallet.ts` — add:

```ts
export async function unshieldedAddress(w: ConnectedWallet): Promise<string> {
  return (await w.api.getUnshieldedAddress()).unshieldedAddress;
}
```

and change the insufficient-funds line in `explainWalletError` to:

```ts
  if (/insufficient/i.test(m)) return `Not enough private balance. Top up 5, 10, or 50 NIGHT and keep some DUST for the fee. (${m})`;
```

`packages/midnight-web/src/providers.ts` — line 11 comment and line 26 generic become `'createDrop' | 'purchase' | 'withdraw' | 'wrap' | 'unwrap'`.

`packages/midnight-web/src/fake.ts` — `FakeBlindfoldClient`:

```ts
export class FakeBlindfoldClient implements BlindfoldClient {
  readonly calls: Array<Record<string, unknown>> = [];
  private readonly view: LedgerView;
  private balance: bigint;
  constructor(seed: Partial<LedgerView> = {}, private readonly onPurchase?: (index: bigint, dropId: bigint, ePub: Uint8Array) => Promise<void> | void, options: { privateBalance?: bigint } = {}) {
    this.view = { drops: new Map(), dropOwner: new Map(), kCommit: new Map(), purchaseCount: 0n, purchases: new Map(), purchaseDrop: new Map(), escrow: new Map(), ...seed };
    this.balance = options.privateBalance ?? 0n;
  }
  private tx(): TxRef { const n = Number(this.view.purchaseCount); return { txId: `fake-${n}-${Date.now()}`, blockHeight: n }; }
  paymentTokenColor(): string { return 'b1'.repeat(32); }
  async privateBalance(): Promise<bigint> { return this.balance; }
  async wrap(amountStar: bigint): Promise<TxRef> {
    this.calls.push({ method: 'wrap', amountStar });
    if (![5_000_000n, 10_000_000n, 50_000_000n].includes(amountStar)) throw new Error('top up 5, 10, or 50 NIGHT');
    this.balance += amountStar; return this.tx();
  }
  async unwrap(valueStar: bigint, to: string): Promise<TxRef> {
    this.calls.push({ method: 'unwrap', valueStar, to });
    if (valueStar > this.balance) throw new Error('insufficient private balance');
    this.balance -= valueStar; return this.tx();
  }
  async purchase(dropId: bigint, ePub: Uint8Array, price: bigint): Promise<TxRef> {
    this.calls.push({ method: 'purchase', dropId, price });
    const p = this.view.drops.get(dropId);
    if (p === undefined) throw new Error('unknown drop');
    if (price < p) throw new Error('underpaid');
    if (price > this.balance) throw new Error('insufficient private balance');
    this.balance -= price;
    const i = this.view.purchaseCount;
    this.view.purchases.set(i, ePub); this.view.purchaseDrop.set(i, dropId); this.view.escrow.set(i, { value: price, mt_index: i });
    this.view.purchaseCount = i + 1n;
    await this.onPurchase?.(i, dropId, ePub);
    return this.tx();
  }
  async createDrop(dropId: bigint, price: bigint, commit: Uint8Array): Promise<TxRef> { /* unchanged */ }
  async withdraw(idx: bigint): Promise<TxRef> {
    this.calls.push({ method: 'withdraw', idx });
    const coin = this.view.escrow.get(idx);
    if (!coin) throw new Error('nothing escrowed');
    this.view.escrow.delete(idx); this.balance += coin.value; return this.tx();
  }
  async ledger(): Promise<LedgerView> { /* unchanged */ }
}
```

(Keep the existing bodies of `createDrop` and `ledger`.) In `fakeConnectedWallet()` and `installFakeConnector()` add `getUnshieldedAddress: async () => ({ unshieldedAddress: 'mn_addr_undeployed1fake' })` to both api objects.

- [ ] **Step 4: Run tests, typecheck, build**

Run: `npm test -w packages/midnight-web && npm run build -w packages/midnight-web`
Expected: all tests pass (existing 14 + 7 new), `tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add packages/midnight-web package.json package-lock.json
git commit -m "feat(midnight-web): wrap, unwrap, privateBalance, and the bNIGHT color on the client"
```

---

### Task 3: Buyer app — Private balance panel and Buy gating

**Files:**
- Create: `buyer/src/privateBalance.ts`
- Create: `buyer/test/privateBalance.test.ts`
- Modify: `buyer/src/session.ts:25-27` (pass `wallet` to `connectContract`)
- Modify: `buyer/src/App.tsx` (balance line, panel, Buy gating)
- Modify: `buyer/e2e/buy.spec.ts`

**Interfaces:**
- Consumes: `BlindfoldClient.wrap/unwrap/privateBalance`, `TOP_UP_DENOMINATIONS_STAR`, `unshieldedAddress(w)`, `formatNight` from `buyer/src/price.ts`.
- Produces: `canBuy(balance: bigint, price: bigint): boolean`, `smallestTopUpCovering(priceStar: bigint, balanceStar: bigint): bigint | null` (smallest denomination `d` with `balance + d >= price`, `null` if even 50 does not cover).

- [ ] **Step 1: Failing unit tests**

`buyer/test/privateBalance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canBuy, smallestTopUpCovering } from '../src/privateBalance';

describe('private balance helpers', () => {
  it('canBuy compares balance to price', () => {
    expect(canBuy(1_000_000n, 1_000_000n)).toBe(true);
    expect(canBuy(999_999n, 1_000_000n)).toBe(false);
  });
  it('suggests the smallest denomination that covers the shortfall', () => {
    expect(smallestTopUpCovering(1_000_000n, 0n)).toBe(5_000_000n);
    expect(smallestTopUpCovering(7_000_000n, 0n)).toBe(10_000_000n);
    expect(smallestTopUpCovering(7_000_000n, 4_000_000n)).toBe(5_000_000n);
    expect(smallestTopUpCovering(60_000_000n, 0n)).toBeNull();
  });
});
```

Run: `npm test -w buyer` → FAIL (module missing).

- [ ] **Step 2: Implement the helpers**

`buyer/src/privateBalance.ts`:

```ts
import { TOP_UP_DENOMINATIONS_STAR } from '@blindfold/midnight-web';

export function canBuy(balanceStar: bigint, priceStar: bigint): boolean {
  return balanceStar >= priceStar;
}

/** Smallest of 5/10/50 NIGHT that brings `balance` to at least `price`, or null if none does. */
export function smallestTopUpCovering(priceStar: bigint, balanceStar: bigint): bigint | null {
  for (const d of TOP_UP_DENOMINATIONS_STAR) if (balanceStar + d >= priceStar) return d;
  return null;
}
```

Run: `npm test -w buyer` → PASS.

- [ ] **Step 3: Wire the session and the App**

`buyer/src/session.ts` line 26: pass the wallet as the 7th argument:

```ts
  const client = await connectContract(providers, info.contract_address, crypto.getRandomValues(new Uint8Array(32)), `blindfold-buyer-${info.contract_address.slice(0, 8)}`, info.network, `${window.location.origin}/contract/blindfold`, wallet);
```

Add `import { unshieldedAddress } from '@blindfold/midnight-web';` to `App.tsx` and `import { canBuy, smallestTopUpCovering } from './privateBalance';` and `import { TOP_UP_DENOMINATIONS_STAR } from '@blindfold/midnight-web';`.

State: replace `bal` with `const [bal, setBal] = useState<{ publicNight: bigint; privateNight: bigint; dust: bigint } | null>(null);` and add `const [topping, setTopping] = useState(false);`.

A `refreshBalances` callback used after connect, top-up, cash-out, and purchase:

```ts
  const refreshBalances = useCallback(async (s: Session) => {
    const [b, priv] = await Promise.all([balances(s.wallet), s.client.privateBalance()]);
    setBal({ publicNight: b.unshieldedNight, privateNight: priv, dust: b.dust });
  }, []);
```

`connect` calls `await refreshBalances(s)` instead of the old `balances` line.

Top up and cash out:

```ts
  const topUp = useCallback(async (amountStar: bigint) => {
    if (!session || busy || topping) return;
    setTopping(true); setError('');
    try {
      await session.client.wrap(amountStar);
      // The wallet learns about the new coin a few seconds after the block; poll up to 2 min.
      const target = (bal?.privateNight ?? 0n) + amountStar;
      for (let i = 0; i < 40; i += 1) {
        await refreshBalances(session);
        if ((await session.client.privateBalance()) >= target) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (e) { setError(explainWalletError(e)); }
    finally { setTopping(false); }
  }, [session, busy, topping, bal, refreshBalances]);

  const cashOut = useCallback(async () => {
    if (!session || busy || topping || !bal || bal.privateNight === 0n) return;
    setTopping(true); setError('');
    try {
      await session.client.unwrap(bal.privateNight, await unshieldedAddress(session.wallet));
      await refreshBalances(session);
    } catch (e) { setError(explainWalletError(e)); }
    finally { setTopping(false); }
  }, [session, busy, topping, bal, refreshBalances]);
```

`buy` ends its `finally` with `if (session) void refreshBalances(session);`.

JSX: replace the balance note and the catalog section with:

```tsx
        {session && bal ? <p className="note">Public NIGHT: {formatNight(bal.publicNight)} · Private balance: {formatNight(bal.privateNight)}{topping ? ' (updating…)' : ''} · DUST: {bal.dust.toString()}</p> : null}
        {session && !purchase ? (
          <section className="panel"><div className="panel-head"><h2>Private balance</h2><button onClick={() => void cashOut()} disabled={busy || topping || !bal || bal.privateNight === 0n}>Cash out</button></div>
            <div className="actions">{TOP_UP_DENOMINATIONS_STAR.map((d) => <button key={d.toString()} className="primary" disabled={busy || topping} onClick={() => void topUp(d)}>{topping ? 'proving…' : `Top up ${formatNight(d)}`}</button>)}</div>
            <p className="note">Purchases spend this balance, not your public NIGHT. Top up enough for several purchases; topping up right before you buy links the two transactions.</p>
          </section>) : null}
        {!purchase ? (
          <section className="panel"><div className="panel-head"><h2>Catalog</h2><button onClick={() => void loadCatalog()}>Refresh</button></div>
            <label className="remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep on this device for 24h (on by default; uncheck to keep the key only in this tab)</label>
            {catalog.length === 0 ? <p className="note">No drops yet.</p> :
              <ul className="drops">{catalog.map((d) => {
                const price = BigInt(d.price_star);
                const affordable = Boolean(session && bal && canBuy(bal.privateNight, price));
                return <li key={d.drop_id}><div><strong>{d.title}</strong><span className="price">{formatNight(d.price_star)} NIGHT</span></div>
                  <button className="primary" disabled={busy || topping || !session || !affordable} onClick={() => void buy(d)}>{busy ? 'proving…' : affordable || !session ? 'Buy' : 'Top up first'}</button></li>; })}</ul>}
            <p className="note">{!session ? 'Connect a wallet above to buy. Browsing is free.' : 'Buying sends one shielded transaction from your private balance; proving takes 20 to 60 seconds.'}</p>
          </section>) : null}
```

If a drop shows `Top up first`, the suggested amount is shown in the note under the catalog: append to that note `{session && bal && catalog.some((d) => !canBuy(bal.privateNight, BigInt(d.price_star))) ? ` Top up ${formatNight(smallestTopUpCovering(BigInt(catalog[0].price_star), bal.privateNight) ?? 50_000_000n)} NIGHT to buy the first drop.` : ''}`.

Fake mode: nothing special; the fake client starts at 0, `Top up 5` sets it to 5 at once.

- [ ] **Step 4: Update the smoke**

`buyer/e2e/buy.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('top up the private balance, then buy with the fake wallet and unlock', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Buy' })).toBeDisabled();       // browsing before connect
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText(/Private balance: 0/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Top up first' })).toBeDisabled();
  await page.getByRole('button', { name: 'Top up 5' }).click();
  await expect(page.getByText(/Private balance: 5/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Buy' }).click();
  await expect(page.getByText(/Unlocked/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/unlocked with a fake wallet/)).toBeVisible();
  expect(errors).toEqual([]);
});
```

- [ ] **Step 5: Run everything for the buyer**

Run: `npm test -w buyer && npm run build -w buyer && npm run test:e2e -w buyer`
Expected: unit tests pass (25 + 2), build clean, smoke 1 passed.

- [ ] **Step 6: Commit**

```bash
git add buyer/src/privateBalance.ts buyer/test/privateBalance.test.ts buyer/src/session.ts buyer/src/App.tsx buyer/e2e/buy.spec.ts
git commit -m "feat(buyer): private balance panel with fixed top-ups; Buy waits for the private balance"
```

---

### Task 4: Creator app — Private balance and Cash out

**Files:**
- Modify: `creator/src/session.ts:26-33,49-56`
- Modify: `creator/src/App.tsx` (balance line, panel after "Escrowed purchases")
- Create: `creator/e2e/cashout.spec.ts`

**Interfaces:**
- Consumes: `BlindfoldClient.privateBalance/unwrap`, `unshieldedAddress(w)`, `formatNight` (already in `App.tsx`).

- [ ] **Step 1: Session**

In `openSession`, pass `wallet` as the 7th argument of `connectContract` (after the zk assets path `${window.location.origin}/contract/blindfold`). In FAKE mode seed the fake client with a private balance so the panel has something to cash out: `new FakeBlindfoldClient({}, undefined, { privateBalance: 3_000_000n })`.

- [ ] **Step 2: Failing smoke**

`creator/e2e/cashout.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("cash out the private balance to public NIGHT", async ({ page }) => {
  await page.route("**/mock/contract", (route) => route.fulfill({ json: { network: "undeployed", contract_address: "ab".repeat(32) } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText(/Private balance: 3/)).toBeVisible();
  await page.getByRole("button", { name: /Cash out to public NIGHT/ }).click();
  await expect(page.getByText(/Cashed out 3 NIGHT/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Private balance: 0/)).toBeVisible();
});
```

Run: `npm run test:e2e -w creator` → the new spec FAILS (no panel).

- [ ] **Step 3: App**

`creator/src/App.tsx`: add state `const [privateNight, setPrivateNight] = useState<bigint | null>(null);` and

```ts
  const refreshPrivateBalance = useCallback(async () => {
    if (!session) return;
    setPrivateNight(await session.client.privateBalance());
  }, [session]);
  useEffect(() => { void refreshPrivateBalance(); }, [refreshPrivateBalance]);

  async function cashOut(): Promise<void> {
    if (!session || privateNight === null || privateNight === 0n) return;
    setMessage("");
    try {
      const amount = privateNight;
      const tx = await session.client.unwrap(amount, await unshieldedAddress(session.wallet));
      await refreshPrivateBalance();
      setMessage(`Cashed out ${formatNight(amount)} NIGHT to your public balance (tx ${tx.txId}).`);
    } catch (error) {
      setMessage(explainWalletError(error));
    }
  }
```

`withdraw()` calls `await refreshPrivateBalance()` after `refreshEscrow()`. Import `unshieldedAddress` from `@blindfold/midnight-web/wallet`.

The connected note becomes: `Connected to {session.network} · contract {…} · Private balance: {privateNight === null ? '…' : formatNight(privateNight)}`.

After the "Escrowed purchases" section add:

```tsx
          <section className="panel">
            <div className="panel-head"><h2>Private balance</h2><button onClick={() => void refreshPrivateBalance()} disabled={!session}>Refresh</button></div>
            <p className="note">Withdrawn purchases arrive here as bNIGHT, the shielded token this contract mints. Cash out sends the whole balance to your public NIGHT address.</p>
            <button className="primary" disabled={!session || running || privateNight === null || privateNight === 0n} onClick={() => void cashOut()}>Cash out to public NIGHT</button>
          </section>
```

- [ ] **Step 4: Run**

Run: `npm test -w creator && npm run build -w creator && npm run test:e2e -w creator`
Expected: unit tests unchanged (31 + skipped live), build clean, both specs pass.

- [ ] **Step 5: Commit**

```bash
git add creator/src/session.ts creator/src/App.tsx creator/e2e/cashout.spec.ts
git commit -m "feat(creator): private balance panel with cash out to public NIGHT"
```

---

### Task 5: Indexer e2e, local demo path, and docs

**Files:**
- Modify: `indexer/test/e2e.devnet.test.ts:121-129`
- Modify: `docs/demo-script.md`, `docs/demo-readiness.md`, `README.md`, `docs/guide.md`, `docs/status.md`
- Create: `docs/deployment-verification-2026-09-12-bnight.md`

- [ ] **Step 1: Indexer e2e wraps before it buys**

Around line 121 of `indexer/test/e2e.devnet.test.ts`, before `buyer.callTx.purchase(...)`, add `await buyer.callTx.wrap(5_000_000n);` and change the purchase call to `buyer.callTx.purchase(dropId, ePub.publicKey, paymentCoin(address, PRICE))`, importing `paymentCoin` from `../../contract/scripts/lib/providers` (the deployed contract address variable in that file is the one passed to `MidnightLedgerReader`; use its name). Run with the devnet up and the local indexer NOT on 8080:

`cd indexer && DEVNET=1 CONTRACT_ADDRESS=<address printed by 'npm run deploy -w contract -- --network undeployed'> npx vitest run test/e2e.devnet.test.ts`
Expected: 2 passed.

- [ ] **Step 2: Local demo still works end to end**

Run: `npm run demo:local` then `npm run demo:stop`. Expected: `Local stack is ready.` (the seeder only registers; nothing else changes).

- [ ] **Step 3: Docs**

- `docs/demo-script.md`: buyer scene becomes: connect → show `Public NIGHT 10 · Private balance 0` → `Top up 10` (say: "fixed denominations, so the amount does not identify me") → switch to the creator scene → back to the buyer → `Buy` (one approval, spends the private balance) → unlock. Creator scene ends with `Withdraw` → `Cash out to public NIGHT`. The boundaries paragraph replaces "Zswap for buyer payment privacy" with the spec's section 5 wording.
- `README.md` "How Midnight is used" bullets: describe `wrap`/`unwrap` and that NIGHT is unshielded on public networks (one sentence each). Status paragraph: note the contract redeploy is pending (Task 7 updates it).
- `docs/demo-readiness.md`: "Accurate claim" and "Presenter-safe wording" use the spec's section 5 text.
- `docs/guide.md`: section 1's flow diagram line `purchase(dropId, e_pub, coin{value >= price, color = NIGHT})` becomes `color = bNIGHT (minted by wrap)`; add a "Lane E" row to the lane tables (`Merged …` after Task 7; until then `On lane-e`).
- `docs/status.md`: add `### E-1. bNIGHT (Lane E)` block above the current E with checkboxes for Tasks 1–7; rename the current "E" to "E-2. 공개 환경에서 A 반복" and add the top-up and cash-out steps to A and E-2.
- `docs/deployment-verification-2026-09-12-bnight.md`: record the finding (no shielded NIGHT on public networks, with the three quotes from the spec), what changed, and the devnet evidence from Tasks 1 and 5 (test names and counts).

Run: `npm run qa:secrets && true` → `0`.

- [ ] **Step 4: Commit**

```bash
git add indexer/test/e2e.devnet.test.ts docs README.md
git commit -m "docs+test: bNIGHT top-up in the demo script and the indexer e2e; record the shielded-NIGHT finding"
```

---

### Task 6: Whole-branch verification

- [ ] **Step 1:** From the repo root: `npm run check:runtime-copies && npm run compile -w contract && npm test && npm run build -w indexer -w packages/midnight-web -w buyer -w creator && npx tsc -p deploy/tsconfig.json && npm run qa:secrets && npm run test:e2e -w buyer && npm run test:e2e -w creator`. Expected: everything green.
- [ ] **Step 2:** Devnet: `cd contract && DEVNET=1 npx vitest run test/flow.test.ts` (11 passed) and the indexer e2e from Task 5 Step 1 (2 passed).
- [ ] **Step 3:** Push the branch: `git push -u origin lane-e`; confirm the CI run is green (`gh run list --branch lane-e --limit 1`).

---

### Task 7: Redeploy to Preprod and re-pin the CVM (run by the maintainer; needs Phala login and the funded deploy wallet)

- [ ] **Step 1: Rebuild the indexer image from `lane-e`**: `gh workflow run release-image.yml --ref lane-e -f tag=0.2.0`, `gh run watch`, copy the printed `IMAGE=ghcr.io/moyedx3/blindfold-indexer@sha256:…`.
- [ ] **Step 2: Deploy the contract**: `npm run deploy -w contract -- --network preprod` (the wallet state is cached; expect a few minutes) → `CONTRACT_ADDRESS=…`; verify with `npm run ledger -w contract -- <address> --network preprod` (empty ledger).
- [ ] **Step 3: Update the CVM**: edit `deploy/cvm/.env` (`IMAGE` digest, `CONTRACT_ADDRESS`), then `cd deploy/cvm && npx phala deploy -c docker-compose.yml -e .env --wait`.
- [ ] **Step 4: Re-pin**: `npm run attest:inspect -- https://94ef50c5719468f34cdb06e000e8f3ee415f0429-8080.dstack-pha-prod5.phala.network` → write the printed RTMR3, the new digest, and the contract address into `deploy/networks.json` → `npm run smoke:live` passes → commit `deploy/networks.json` and the status/README updates: `git commit -m "deploy: bNIGHT contract on Preprod; CVM re-pinned"`.
- [ ] **Step 5: Merge**: use `superpowers:finishing-a-development-branch` (merge `lane-e` into `main`, push).
- [ ] **Step 6 (manual, two Lace wallets on Preprod):** buyer `Top up 10`; creator register + provision against the CVM (`VITE_INDEXER_URL=<cvm> VITE_EXPECTED_MEASUREMENT_HEX=<rtmr3>`); buyer `Buy` → unlock; creator `Withdraw` → `Cash out`. Record the result in the verification note from Task 5.
