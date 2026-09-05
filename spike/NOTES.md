# Blindfold spike notes (throwaway code, keep the findings)

Started 2026-09-05. Everything under `spike/` is disposable; only what is written here
and proven by a run carries into the real repo.

## Toolchain that actually works together (local devnet)

| Component | Version | Note |
|---|---|---|
| Compact devtool `compact` | 0.5.2 | installed to `~/.local/bin` |
| Compact compiler | **0.31.1** | `compact update 0.31.1`. The default `compact update` installs 0.34.0, which targets runtime 0.19 / ledger 9 and does NOT match midnight-js 4.1.1. |
| Language version | 0.23 | `pragma language_version 0.23;` |
| compact-runtime | 0.16.0 | |
| midnight-js | 4.1.1 | |
| ledger-v8 | 8.1.0 | |
| onchain-runtime-v3 | **3.0.0 pinned via npm `overrides`** | see gotcha 1 |
| proof-server image | 8.1.0 | `midnightntwrk/proof-server:8.1.0` |
| node image | 1.0.0 | `midnightntwrk/midnight-node:1.0.0` |
| indexer image | 4.3.3 | `midnightntwrk/indexer-standalone:4.3.3` |
| Node.js | 26 | template says >=22 |

## Gotchas found

1. **Two copies of `@midnight-ntwrk/onchain-runtime-v3` break every circuit call** with
   `Error: expected instance of StateValue` (thrown from `new ChargedState` inside
   `mergeUnsubmittedCallTxData`). Cause: compact-runtime@0.16.0 depends on `^3.0.0` and npm
   resolves 3.1.1 at top level, while midnight-js-protocol@4.1.1 pins 3.0.0 as a nested copy.
   Two WASM instances -> class identity check fails. Even the untouched `create-mn-app`
   hello-world template fails this way as of 2026-09-05. Fix in package.json:
   ```json
   "overrides": { "@midnight-ntwrk/onchain-runtime-v3": "3.0.0" }
   ```
   then `rm -rf node_modules package-lock.json && npm install` and confirm exactly one copy:
   `find node_modules -type d -path '*onchain-runtime-v3'`.
2. Docker Desktop's CLI and credential helper live in `~/.docker/bin`; put that on PATH
   (or symlink `docker` and `docker-credential-desktop` into `~/.local/bin`) or `docker compose pull`
   fails with `docker-credential-desktop: executable file not found`.
3. `createShieldedCoinInfo(type, value)` from the ledger returns `{type, nonce, value}` with hex
   strings, but the compiled circuit wants `{nonce: Uint8Array, color: Uint8Array, value: bigint}`.
   Build the circuit argument by hand: `nonce = randomBytes(32)`, `color = 32 zero bytes` for NIGHT.
4. Native NIGHT token type raw is 32 zero bytes, for both shielded and unshielded
   (`ledger.nativeToken().raw === ledger.shieldedToken().raw === "00"*32`).
5. The local devnet genesis wallet (seed `00..01`) already holds shielded NIGHT
   (250,000,000,000,000 STAR), so no shielding step is needed for the CLI spike.
   Public testnets give unshielded tNIGHT from the faucet; shielding is a separate transfer there.

## Runs

- 2026-09-05 run 1: deploy OK in 22s; `createDrop` failed with gotcha 1. Fixed by the override.
- 2026-09-05 run 2 (after override): full pass in 85 s on local devnet, genesis wallet as both creator and buyer.
  - deploy 19 s -> contract `bd0a78a0…d610a6`
  - `createDrop(1, 1_000_000)` block 63; ledger `drops = {1: 1000000}`, `dropOwner = {1: hash(creatorSecret)}`
  - `purchase(1, ePub, {nonce, color=0x00*32, value=1_000_000})` block 67; wallet shielded NIGHT fell by exactly 1,000,000 STAR;
    ledger `purchases = {0: ePub}`, `purchaseDrop = {0: 1}`, `escrow = {0: coin with mt_index 28}`
  - `withdraw(0)` block 71; shielded NIGHT back to the starting amount; `escrow = {}`
  - Answers: Q1 (contract enforces price + records ePub + takes shielded NIGHT) YES; Q2 (creator withdraws escrowed coin,
    Merkle index handled by `Map.insertCoin` + `sendShielded`) YES; Q3 (watcher reads `purchases` via
    `publicDataProvider.queryContractState` + generated `ledger()` decoder, iterable Map) YES.
  - Still open: browser wallet (Lace) path from a *separate* buyer wallet, and the privacy check on a public explorer.
