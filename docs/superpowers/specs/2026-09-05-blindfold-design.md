# Blindfold design (phase 1)

Status: approved in conversation on 2026-09-05. Supersedes nothing; the spike in `spike/` is the evidence base.
Companion reading: `docs/guide.md` (context, resources, setup), `spike/NOTES.md` (verified versions and gotchas).

## 1. Goal

Rebuild Drop on Midnight for the Midnight Korea Hackathon 2026 (submission deadline 2026-09-28 00:00 KST).
Phase 1 delivers exactly Drop's feature set plus creator withdrawal:

- A creator lists a drop: encrypted content, a price in NIGHT, a title.
- A buyer pays with shielded NIGHT and, without an account, receives the content key and decrypts.
- Nobody learns which wallet bought what. The indexer operator cannot read the content because the
  content key only ever exists in plaintext inside an attested TEE.
- The creator withdraws the escrowed NIGHT.

Non-goals for phase 1: on-chain delivery of dispatch blobs, network-layer privacy (Tor), DRM, multiple
creators per drop, refunds.

## 2. Roles and trust

| Party | Holds | Trusts |
|---|---|---|
| Creator | content, `K_drop`, a Midnight wallet, a contract secret | the TEE measurement they verified, the contract code |
| Buyer | a Midnight wallet with shielded NIGHT, a per-purchase X25519 keypair | the contract code; the TEE only for content delivery |
| Indexer (TEE) | provisioning keypair (KMS-derived), every provisioned `K_drop`, dispatched blobs | the Midnight indexer it reads from |
| Contract | public ledger only | nothing |

Buyer anonymity comes from Zswap and does not depend on the TEE. Content confidentiality against the
indexer operator depends on the TEE. These are independent.

## 3. Architecture

```
creator app ──(1) createDrop(dropId, price, kCommit)──────────▶ contract (Midnight)
            ──(2) PUT /bucket/{h_content}  ciphertext ────────▶ indexer
            ──(3) GET /attest, verify quote ──────────────────▶ indexer
            ──(4) POST /provision  sealed{dropId, K_drop, …} ──▶ indexer (checks price + kCommit on-chain)

buyer app   ──(5) purchase(dropId, ePub, coin) via wallet ────▶ contract: assert price, escrow coin,
                                                                purchases[i] = ePub
indexer     ──(6) watcher reads purchases ────────────────────▶ seal(K_drop, ePub) -> /dispatch/{key}
buyer app   ──(7) GET /dispatch, trial-open with ePriv ───────▶ K_drop -> GET /bucket/{h_content} -> decrypt

creator app ──(8) withdraw(i) via wallet ─────────────────────▶ contract sends escrowed coin to creator
```

Three processes: the Midnight network services (node, Midnight indexer, proof server), the Blindfold
indexer (one Node process in a Phala CVM), and static web apps.

## 4. Repository layout

```
blindfold/
  package.json              npm workspaces: contract, indexer, buyer, creator
  contract/                 Compact source, compile script, tests; build output gitignored
    src/blindfold.compact
    scripts/compile.sh      compact compile src/blindfold.compact build/blindfold
    scripts/deploy.ts       deploy to a network from a funded wallet, prints the address
    test/flow.test.ts       local-devnet flow (deploy, createDrop, purchase, withdraw)
  indexer/                  Node/TypeScript service that runs inside the TEE
  buyer/                    Vite + React
  creator/                  Vite + React
  deploy/
    devnet/docker-compose.yml   node 1.0.0, indexer-standalone 4.3.3, proof-server 8.1.0
    cvm/docker-compose.yml      indexer image for Phala Cloud (dstack)
    README.md                   runbooks: local, Preprod, Phala
  docs/
  spike/                    throwaway; deleted once contract/ and indexer/ exist
```

Every `package.json` pins the compatibility-matrix versions (midnight-js 4.1.1, compact-runtime 0.16.0,
ledger-v8 8.1.0, compact-js 2.5.1, dapp-connector-api 4.0.1, wallet-sdk 1.2.0) and carries
`"overrides": {"@midnight-ntwrk/onchain-runtime-v3": "3.0.0"}`. Compiler: Compact 0.31.1, language 0.23.

## 5. Contract

`contract/src/blindfold.compact` is the spike contract plus a key commitment:

```
pragma language_version 0.23;
import CompactStandardLibrary;

export ledger drops: Map<Uint<64>, Uint<128>>;               // dropId -> price in STAR
export ledger dropOwner: Map<Uint<64>, Bytes<32>>;           // dropId -> creator dapp pubkey
export ledger kCommit: Map<Uint<64>, Bytes<32>>;             // dropId -> sha256(K_drop || h_content)
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

Notes:
- `commit` is computed off-chain by the creator app as `sha256(K_drop ‖ h_content)` (the content hash as
  32 raw bytes, not its hex string) and stored as-is. The contract never sees `K_drop`. The indexer
  refuses a provisioning whose `sha256(k_drop ‖ h_content)` differs from the on-chain value, so only the
  holder of `K_drop` for the drop's own content can provision it, without any wallet signature.
- `ownPublicKey()` is used only as the withdraw recipient, never for authorization (it is prover-claimed).
  Authorization is the `creatorSecret` witness hashed into `dropOwner`.
- Every caller must supply a `creatorSecret` witness implementation; the buyer app supplies random bytes
  that are never used.
- One contract instance per deployment (per network). Its address is published by the indexer.
- What a purchase reveals on-chain: contract address, circuit name, `dropId`, `ePub`, coin value,
  Zswap nullifier/commitments, a DUST spend. Verified on the local indexer during the spike.

## 6. Wire formats (interfaces)

Interfaces are numbered I1 to I6; ported code comments reference these numbers.

**I1 purchase call (buyer → contract).** Circuit arguments: `dropId: bigint`, `ePub: Uint8Array(32)`
(libsodium `crypto_box_keypair` public key, fresh per purchase), `coin = { nonce: random 32 bytes,
color: 32 zero bytes (NIGHT), value: price }`. The wallet balances the shielded input.

**I2 dispatch blob (indexer → buyer).** `crypto_box_seal(K_drop, ePub)` = `ek_pub(32) ‖ ciphertext+MAC(48)`
= 80 bytes. Store key: `hex(blake2b-256(ek_pub ‖ index_be64))` where `index` is
the purchase index as 8 big-endian bytes. The buyer cannot compute the key (needs `ek_pub`), so it lists
and trial-opens. `GET /dispatch` returns the list of keys (JSON array of hex strings),
`GET /dispatch/:key` returns the 80 bytes.

**I3 catalog.** Public entry (`GET /catalog`, JSON array):
`{ "drop_id": 1, "price_star": "1000000", "title": "cat photo", "h_content": "<sha256 hex>" }`.
Internal drop config (enclave memory only): `{ price_star, k_drop(32 bytes), h_content, title }`.
`GET /contract` returns `{ "network": "preprod", "contract_address": "<64 hex>" }`.

**I4 content blob (creator → buyer via bucket).** `nonce(12) ‖ AES-256-GCM
ciphertext ‖ tag(16)`, no AAD, `h_content = sha256(blob)` hex, `PUT /bucket/{h_content}` (the server
verifies the hash), `GET /bucket/{h_content}`. Size limit 50 MB.

**I5 provisioning (creator → indexer).** JSON `{ "drop_id": 1, "price_star": "1000000",
"k_drop": "<64 hex>", "h_content": "<64 hex>", "title": "cat photo" }` sealed with libsodium
`crypto_box_seal` to the enclave provisioning public key; `POST /provision` with the raw sealed bytes.
The indexer: opens the box; checks `drops[drop_id]` exists on-chain with price `== price_star` and
`kCommit[drop_id] == sha256(k_drop ‖ h_content)` (h_content hex-decoded to 32 raw bytes); checks the
content blob for `h_content` exists in the bucket;
stores the config (overwrite allowed, idempotent). Errors: 400 bad seal or JSON, 404 drop not on-chain
or content missing, 409 price or commitment mismatch.

**I6 attestation (indexer → creator).** `GET /attest` → `{ "quote_hex": "...",
"provisioning_pubkey_hex": "<64 hex>" }`, where the TDX quote's `report_data[0:32] = sha256(pubkey)`.
The creator app verifies with `@phala/dcap-qvl` (Intel chain, TCB `UpToDate`), checks the pinned
measurement, checks the binding, and only then obtains the pubkey
(`creator/src/attestation.ts`, carried over from the earlier prototype unchanged).

## 7. Indexer

Node 22, TypeScript, one process, HTTP via Fastify, CORS open for the two app origins.

Modules:

- `config.ts`: env `NETWORK` (undeployed | preview | preprod), `CONTRACT_ADDRESS`, `MIDNIGHT_INDEXER_URL`,
  `MIDNIGHT_INDEXER_WS_URL`, `DSTACK_ENDPOINT` (default `/var/run/dstack.sock`), `DEV_SEED_HEX`
  (64 hex; dev only), `DATA_DIR`, `PORT` (8080), `POLL_MS` (3000), `MEASUREMENT_PIN` (documentation only).
- `dstack.ts`: wraps `@phala/dstack-sdk` `DstackClient`: `getKey('blindfold/provisioning')`, `getQuote(reportData)`,
  `info()`. If the socket is unreachable and `DEV_SEED_HEX` is set, use the dev seed and a fake quote
  (`quote_hex = "dev"`); if the socket is reachable and `DEV_SEED_HEX` is set, refuse to start.
- `keys.ts`: provisioning keypair from the 32-byte seed with libsodium `crypto_scalarmult_base`
  (the seed is the X25519 secret key, matching Drop's `from_secret_key`); `sha256`, `blake2b256` helpers.
- `chain.ts`: midnight-js `indexerPublicDataProvider`, `queryContractState`, compiled contract
  `ledger()` decoder; `readLedger()` returns `{ drops, kCommit, purchaseCount, purchases, purchaseDrop }`
  as plain data.
- `catalog.ts`: in-memory `Map<dropId, DropConfig>`; public view for `/catalog`.
- `bucket.ts`: two disk-backed stores under `DATA_DIR/content` and `DATA_DIR/dispatch`; keys validated
  as 64-hex (no path traversal).
- `engine.ts`: `dispatch(index, dropId, ePub)`: lookup config, `crypto_box_seal(k_drop, ePub)`,
  key `blake2b256(ek_pub ‖ index_be64)`, write blob, record index. Pure except for the two stores.
- `watcher.ts`: every `POLL_MS`, `readLedger()`, for each `index in [lastDone+1, purchaseCount)`:
  if the drop is provisioned, dispatch; else log "unprovisioned drop, skipping" and remember the index
  as pending so a later provisioning dispatches it. Persists `DATA_DIR/dispatched.json`
  (`{ index: key }`) and reloads it at startup. Errors from the Midnight indexer back off to 30 s.
- `server.ts`: routes `GET /health`, `GET /contract`, `GET /attest`, `POST /provision`, `GET /catalog`,
  `GET /dispatch`, `GET /dispatch/:key`, `GET /bucket/:key`, `PUT /bucket/:key`.
- `main.ts`: startup order: config, dstack or dev seed, keypair, chain connection (fail fast if the
  contract address has no state), server, watcher.

Logging never prints `k_drop`, the seed, or the secret key. Provisioned configs live only in memory:
after a redeploy creators re-provision (idempotent per drop; the creator app says so).

## 8. Buyer app

Port of the earlier prototype's buyer app minus its payment-request and QR modules. Kept: `seal.ts`, `poller.ts`,
`content.ts`, `persist.ts`, `purchase.ts` (fields: `dropId, title, priceStar, hContent, ePub, ePriv,
txId?`), `api.ts` (+ `fetchContract()`), the XP-themed UI.

New:
- `wallet.ts`: detect `window.midnight.*` APIs (Lace, 1AM, others via feature detection), connect on the
  network from `GET /contract`, build midnight-js providers as in the official wallet-dapp
  (`balanceUnsealedTransaction`, `submitTransaction`). Proofs: `getProvingProvider()` when the wallet
  implements it, else `httpClientProofProvider(config.proverServerUri)`.
- `contract.ts`: compiled contract wrapper (`CompiledContract.withWitnesses` with a random unused
  secret, `withCompiledFileAssets('/contract/blindfold')`), `buy(dropId, ePub, price)` →
  `findDeployedContract(...).callTx.purchase(dropId, ePub, coin)`; returns the tx identifier.
- Flow: Catalog → Buy → (wallet popup) → "paid, waiting for key" → unlock. The poller starts right
  after the purchase transaction is accepted. The recovery file gains `tx_id` and `contract_address`.
- Errors surfaced with hints: no wallet, wrong network, no DUST ("register NIGHT for DUST and wait"),
  proof server unreachable ("Lace needs the local proof server on port 6300").

The compiled contract artifacts (`zkir/`, `keys/`, `contract/`) are copied into `buyer/public/contract/blindfold/`
at build time from `contract/build/`.

## 9. Creator app

Port of the earlier prototype's creator app. Kept unchanged: `content.ts` (AES-256-GCM, `h_content`), `attestation.ts`
and `qvl-verifier.ts` (three-step quote verification), `price.ts` (NIGHT → STAR).

Changed:
- `provision.ts`: payload per I5 (`drop_id`, `price_star`, `k_drop`, `h_content`, `title`).
- New `wallet.ts` / `contract.ts` (shared code with the buyer app via a small `packages/midnight-web`
  workspace if convenient, otherwise duplicated): `createDrop(dropId, price, commit)` and `withdraw(idx)`
  with the real `creatorSecret` witness.
- `secret.ts`: the creator's 32-byte contract secret, generated once, stored in localStorage, export and
  import as a file (same UX as the buyer's recovery file, same warning).
- Flow: pick file → encrypt (K_drop, h_content, commit = sha256(K_drop ‖ h_content)) → upload ciphertext →
  connect wallet → `createDrop` → verify attestation → seal + `POST /provision` → done.
  Drop id: the app picks `max(existing) + 1` from the ledger and lets the user override.
- Withdraw view: reads the ledger, lists escrow entries whose drop the creator owns, `withdraw(i)` per
  entry, shows the wallet's shielded balance before and after.

## 10. Deploy and operations

- Local: `deploy/devnet/docker-compose.yml` (the create-mn-app compose, images pinned) plus
  `npx phala simulator start` for dstack; `contract/scripts/deploy.ts --network undeployed` from the
  genesis seed; indexer with `DEV_SEED_HEX`; apps on Vite. Fund extra wallets with the spike's `fund.ts`
  (moved to `contract/scripts/fund.ts`).
- Preprod: deploy the contract once from a faucet-funded wallet; record the address in
  `deploy/README.md`; indexer on Phala Cloud from `deploy/cvm/docker-compose.yml` (node:22 image,
  `/var/run/dstack.sock` mounted, `DATA_DIR` on a volume); publish the CVM's measurement for the
  creator app's pin. Fund creator and buyer demo wallets at least one day ahead (DUST).
- Judges: README top section "run it in 10 minutes" using the local devnet, plus the Preprod addresses.

## 11. Testing

- Contract: `contract/test/flow.test.ts` on the local devnet (the spike script turned into a vitest
  with a 5-minute timeout): deploy, createDrop, purchase from a second funded wallet, watcher-style ledger
  read, withdraw, plus negative cases: underpaid purchase rejected, withdraw by a non-owner rejected,
  duplicate `createDrop` rejected.
- Indexer: vitest unit tests with an in-memory bucket and a fake `readLedger()`: dispatch idempotence,
  blob key format, provisioning rejects (bad seal, price mismatch, commitment mismatch, missing content),
  watcher resumes from `dispatched.json`, dev-seed refusal when dstack is reachable. One integration test
  against the local devnet and the dstack simulator.
- Apps: unit tests carried over from the earlier prototype (seal, content, persist, price, provision,
  attestation); a Playwright smoke per app against the local stack with a mocked wallet connector.
- Cross-implementation vectors: the 80-byte dispatch blob opens with the buyer's libsodium; the sealed
  provisioning payload opens in the indexer; `blake2b256` and `sha256` vectors shared between apps and
  indexer in `docs/vectors.json`.

## 12. Work split and order

Four lanes, two weeks (2026-09-08 to 2026-09-22), then polish and submission by 2026-09-26.

| Lane | Owner skill | Deliverables |
|---|---|---|
| A. Contract + indexer | TypeScript, crypto | contract package, indexer with watcher, deploy scripts, tests |
| B. Buyer app | React | wallet connect, purchase, unlock flow, smoke test |
| C. Creator app | React | encrypt, createDrop, attestation, provision, withdraw view |
| D. Deploy + docs + demo | ops | devnet compose, Phala CVM, Preprod deployment, README, video |

Order inside lane A: contract package and flow test first (day 1-2, mostly moving the spike), then the
indexer core (attest, provision, catalog, bucket, engine) which lanes B and C can mock from I2-I6, then
the watcher, then the Phala run. Lanes B and C start from the mocked API on day 1.

## 13. Open items (decide during implementation, not blocking)

- Whether `title` should be a plaintext query parameter as in Drop instead of inside the sealed payload
  (no security difference; the sealed variant is simpler).
- 1AM behavior with a `getProvingProvider` that needs `zkConfigProvider.asKeyMaterialProvider()`; if it
  misbehaves, phase 1 supports Lace only and documents 1AM as untested.
- Whether to delete `spike/` before submission or keep it as history. Default: delete, the guide keeps
  the findings.
