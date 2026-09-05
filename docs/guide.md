# Blindfold: team guide

> For humans and for coding agents. Read this first, then `spike/NOTES.md`.
> Last verified: 2026-09-05.

## 한 줄 요약 (KR)

Blindfold는 잠긴 콘텐츠를 프라이버시 결제로 여는 "눈 가린 우체부"다. 크리에이터가 콘텐츠를 암호화해 올리고,
구매자가 shielded NIGHT로 Compact 컨트랙트에 결제하면, 콘텐츠 키를 쥔 TEE 인덱서가 구매자의 일회용 키로 키를
봉인해 전달한다. 팀이 이전에 만든 프로토타입(내부 이름 Drop)의 설계를 Midnight 위에 다시 만든 것이다.
Midnight Korea Hackathon 2026 제출용이며, 마감은 **2026-09-28 00:00 KST**.
2026-09-05에 로컬 devnet에서 핵심 스파이크를 통과했다: 컨트랙트가 가격을 강제하고 구매자의 일회용 키를
원자적으로 기록하며, Lace 지갑에서 shielded NIGHT로 결제가 되고, 크리에이터가 에스크로된 코인을 회수한다.
아래는 영어로 이어진다. 에이전트는 이 문서와 `spike/NOTES.md`를 먼저 읽는다.

## 1. What this is

Blindfold sells unlockable content with a private payment and a key handoff that nobody in the middle can read:

1. The creator encrypts content in the browser with a fresh key `K_drop`, uploads only the ciphertext,
   registers the drop on a Compact contract (price plus a commitment to `K_drop`), and seals `K_drop` to
   an indexer running inside a TEE (Intel TDX on Phala Cloud) after verifying its attestation.
2. The buyer pays shielded NIGHT through the contract's `purchase` circuit and passes a fresh one-time
   public key `e_pub`. The circuit enforces the price and records `e_pub` on the public ledger atomically
   with the payment.
3. The indexer watches the ledger, seals `K_drop` to each new `e_pub` (libsodium sealed box), and
   publishes the blob. The buyer trial-opens blobs with `e_priv`, recovers `K_drop`, decrypts the content.

**Why a contract.** The buyer must tell the indexer "I paid for drop X, answer to this key" without
revealing who they are and without a pre-registration the server could correlate with the payment. A
circuit argument written to the ledger does exactly that, and the contract, not a server, decides whether
the payment was sufficient.

**Why a TEE anyway.** The ledger is public, so `K_drop` cannot live on-chain. Somebody off-chain has to
hold it and answer purchases. The TEE is what stops that somebody's operator from reading the content.
Buyer anonymity comes from Zswap and does not depend on the TEE; content confidentiality does.

This is the second iteration of a design the team prototyped earlier (internal name "Drop"); the TEE
provisioning, dispatch-blob, and content-encryption code carries over from it.

## 2. Status

| Item | State |
|---|---|
| Feasibility spike (local devnet) | **Passed 2026-09-05.** See section 5. |
| Real repo structure, contract, apps | Not started. Next step is the design (spec) then an implementation plan. |
| Hackathon registration | Registration opened 2026-09-01: https://luma.com/2pnv2fwk |
| Submission | Public GitHub repo with README, "how to run / demo flow", optional video, and a section on how Midnight is used. Judges clone, compile, and check that the README matches. Preview/Preprod testnet or local devnet are all allowed. |

## 3. Resources to check, in order

External:

1. Hackathon page: https://www.hackathon.midnightkorea.org/ (dates, deliverables, Discord)
2. Midnight docs, full index for agents: https://docs.midnightkorea.org/llms.txt
   (each page is also fetchable as markdown at `https://docs.midnightkorea.org/<path>.md`). Pages that mattered:
   - `compact/standard-library/exports` (coin ops: `receiveShielded`, `sendShielded`, `ownPublicKey`, `nativeToken`)
   - `compact/data-types/ledger-adt` (`Map.insertCoin`, `Counter`, `List`)
   - `compact/reference/explicit-disclosure` (why every ledger write of an argument needs `disclose()`)
   - `tokens/shielded-token` (fresh vs committed coins, the "sendShielded to a non-caller does not notify them" caveat)
   - `guides/deploy-and-operate` (providers pipeline, `publicDataProvider.queryContractState`)
   - `guides/networks-and-environments`, `guides/acquire-tokens` (endpoints, faucet, DUST registration)
   - `sdks/community/wallets/community-wallets-overview` (Lace needs a local proof server; 1AM proves in-browser)
   - `relnotes/support-matrix` (**pin versions from here, nothing else**)
   - `how-to/fix-version-mismatches`
3. Official browser wallet example (the Lace wiring we copied): https://github.com/midnightntwrk/midnight-wallet-dapp
4. Scaffolder: `npx create-mn-app` (hello-world, bboard, leaderboard templates)
5. Midnight Expert, a Claude Code plugin that checks Compact against the real compiler:
   `curl -fsSL https://midnightntwrk.expert/install.sh | bash` (optional; the real compiler is the source of truth)
6. Explorers for the public testnets: https://preprod.midnightexplorer.com/ , https://preview.midnightexplorer.com/

Internal:

- `spike/NOTES.md`: versions that work together, every gotcha hit, and the run logs.
- `spike/hello/contracts/blindfold.compact`: the spike contract (throwaway, but the shape is right).
- `spike/hello/src/blindfold.ts`: end-to-end CLI flow. `spike/web/src/App.tsx`: the browser buyer flow.
- The earlier prototype's design docs live in a private repo (not on GitHub). Ask the owner. Do not copy its git history; it contains real keys.

## 4. Architecture (target)

Design choices:

| Need | Mechanism |
|---|---|
| Buyer tells the indexer where to send the key, anonymously | Circuit `purchase(dropId, ePub, coin)`; `ePub` is `disclose()`d into a ledger `Map<Uint<64>, Bytes<32>>` |
| Buyer stays anonymous | Zswap shielded NIGHT; the coin is `receiveShielded` into the contract |
| Indexer learns about payments without holding any creator key | It reads the public `purchases` map through the Midnight indexer GraphQL |
| Wallet UX | DApp Connector v4 (`window.midnight.*`), `findDeployedContract(...).callTx.purchase(...)` |

Flow:

```
creator app   createDrop(dropId, price) on the contract          (wallet tx)
              encrypt content with K_drop, upload ciphertext     (carried over)
              verify TEE attestation, seal {dropId, K_drop, h_content} to the enclave   (carried over)

buyer app     fresh X25519 keypair (e_pub, e_priv)
              purchase(dropId, e_pub, coin{value >= price, color = NIGHT})   via Lace / 1AM
                -> contract: assert price, receiveShielded, purchases[i] = e_pub, escrow[i] = coin

indexer(TEE)  watch purchases map -> for each new e_pub: crypto_box_seal(K_drop, e_pub) -> publish blob
buyer app     poll blobs, trial-open with e_priv, sha256 check, AES-GCM decrypt      (carried over)

creator       withdraw(i): contract sends the escrowed coin to the creator's own shielded key
```

Contract ledger (spike version): `drops`, `dropOwner`, `purchaseCount`, `purchases`, `purchaseDrop`, `escrow`.
Creator authorization is a secret witness hashed into `dropOwner` (never use `ownPublicKey()` for auth;
the docs say it is prover-claimed, not signer-bound).

What a purchase reveals on-chain (verified on the local indexer): contract address, circuit name,
the disclosed arguments (`dropId`, one-time `ePub`, coin value), Zswap nullifier/commitments, a DUST spend.
No wallet address, no wallet public key.

## 5. Spike results (2026-09-05, local devnet)

| Step | Result |
|---|---|
| Deploy `blindfold.compact` | 19 s |
| `createDrop(1, 1,000,000 STAR)` | ledger `drops = {1: 1000000}` |
| CLI `purchase` from the genesis wallet | shielded NIGHT down by exactly the price; `purchases[0] = ePub`; coin escrowed with a Merkle index |
| `withdraw(0)` by the creator | shielded NIGHT fully restored; escrow empty |
| Browser `purchase` through **Lace** from a separate wallet | 37 s, block 513, `purchases[1] = ePub`; tx exposes no wallet keys |

Whole CLI run: 85 s. Answers: contract-enforced shielded payment works; creator withdrawal of
contract-held coins works (`Map.insertCoin` + `sendShielded`); a Node process reads the map with the
compiled contract's `ledger()` decoder.

## 6. Environment setup

Works on macOS arm64. Linux should be the same. Windows only via WSL2.

```bash
# Docker Desktop (GUI install). Its CLI lives in ~/.docker/bin:
export PATH="$HOME/.docker/bin:$HOME/.local/bin:$PATH"

# Compact toolchain. Do NOT accept the latest compiler.
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.31.1          # matrix version; `compact update` alone installs 0.34 which targets ledger 9
compact compile --version      # 0.31.1
compact compile --runtime-version   # 0.16.0

# Node 22+ (26 works)
```

Package versions that work together (all from the compatibility matrix): midnight-js 4.1.1,
compact-runtime 0.16.0, ledger-v8 8.1.0, compact-js 2.5.1, dapp-connector-api 4.0.1, wallet-sdk 1.2.0,
proof-server image 8.1.0, node image 1.0.0, indexer-standalone 4.3.3. Every package.json must carry:

```json
"overrides": { "@midnight-ntwrk/onchain-runtime-v3": "3.0.0" }
```

Without it npm installs two copies of the on-chain runtime WASM and **every circuit call fails** with
`expected instance of StateValue`. Verify with `find node_modules -type d -path '*onchain-runtime-v3'` (one hit).

## 7. Running the spike

```bash
cd spike/hello
npm install                      # override already in package.json
npm run setup                    # docker compose up (node, indexer, proof server) + compile + deploy hello-world
compact compile contracts/blindfold.compact contracts/managed/blindfold
npx tsx src/blindfold.ts         # deploy + createDrop + purchase + withdraw, ~85 s
npx tsx src/read.ts <contract>   # print the ledger of a deployed contract

# browser buyer
cp -R contracts/managed/blindfold ../web/src/contract/compiled/blindfold
cd ../web && npm install && npm run dev      # http://localhost:5173
```

Lace for the local devnet: install the Lace extension (Chrome), create a wallet, Settings > Midnight >
network **Undeployed**, proof server **Local (http://localhost:6300)**. Fund it from the genesis wallet:

```bash
cd spike/hello && npx tsx src/fund.ts <mn_addr…> <mn_shield-addr…> 1000   # accepts mainnet-encoded addresses
```

then press **Generate tDUST** in Lace and wait a few minutes. Addresses shown as `mn_addr1…` (no network
segment) mean Lace is still on Mainnet.

## 8. Gotchas (details in spike/NOTES.md)

1. Duplicate `onchain-runtime-v3` breaks all circuit calls (see section 6).
2. `compact update` without a version installs a compiler that does not match midnight-js 4.1.1.
3. The circuit wants `{nonce: Uint8Array, color: Uint8Array, value: bigint}`; NIGHT's color is 32 zero bytes.
4. `tx.public.txId` is a 34-byte identifier; query the indexer with `transactions(offset:{identifier})`, not `hash`.
5. The SDK's `MidnightBech32m.parse` rejects shielded addresses (over the 90-char bech32m limit); decode with `@scure/base` and a larger limit.
6. Spending unshielded NIGHT from a script needs `wallet.signRecipe(recipe, keystore.signData)` before `finalizeRecipe`, or the node answers custom error 192.
7. Lace needs the local proof server on port 6300; 1AM proves in-browser. Public testnets: faucet gives unshielded tNIGHT, shielding is a separate transfer, DUST takes time on a fresh wallet. Fund demo wallets a day early.
8. `sendShielded` to a key other than the caller's does not notify the recipient. Hence escrow in the contract and creator-initiated `withdraw`.

## 9. Repo rules

- **No secrets in git, ever.** `.midnight-state.json` and wallet state are ignored. Never paste a seed, a private key, or a Lace address (a devnet address is also that wallet's mainnet address) into a tracked file.
- This repo is a fresh start. Do not import history from the previous private repo.
- `spike/` is throwaway. Findings move to `spike/NOTES.md` and this guide; code is rewritten in the real structure.
- Pin every Midnight package to the matrix; bump only as a deliberate, tested change.
- When a Compact contract changes, compile it with the real compiler before claiming anything about it.

## 10. Open decisions for the design

- Indexer shape: keep the Rust TEE service (attestation, provisioning, catalog, buckets, dispatch engine) and add a small TypeScript watcher next to it that reads the `purchases` map with midnight-js, or port the engine to TypeScript.
- Wallets to support at the demo: Lace (judges, local proof server) and 1AM (audience, in-browser proving).
- Demo network: build on local devnet, deploy to Preprod for the submission.
- Dispatch blobs: keep the HTTP bucket, or post the 80-byte sealed blob on-chain through a `deliver` circuit.
- Creator withdraw UX, and whether the creator app registers drops directly or the enclave does it.
