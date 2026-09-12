# Blindfold: team guide

> For humans and for coding agents. Read this first, then `docs/status.md` (what is done, what is verified,
> what is left, with owners) and `deploy/README.md`.
> `spike/NOTES.md` is historical evidence from the 2026-09-05 feasibility spike.
> Last verified: 2026-09-12.

## 한 줄 요약 (KR)

Blindfold는 잠긴 콘텐츠를 프라이버시 결제로 여는 "눈 가린 우체부"다. 크리에이터가 콘텐츠를 암호화해 올리고,
구매자가 공개 NIGHT를 5·10·50 단위로 Private balance(bNIGHT, 컨트랙트가 `wrap`으로 발행)에 채운 뒤 그 Private
balance로 Compact 컨트랙트에 결제하면, 콘텐츠 키를 쥔 TEE 인덱서가 구매자의 일회용 키로 키를 봉인해 전달한다.
팀이 이전에 만든 프로토타입(내부 이름 Drop)의 설계를 Midnight 위에 다시 만든 것이다.
Midnight Korea Hackathon 2026 제출용이며, 마감은 **2026-09-28 00:00 KST**.
2026-09-05에 로컬 devnet에서 핵심 스파이크를 통과했다: 컨트랙트가 가격을 강제하고 구매자의 일회용 키를
원자적으로 기록하며, Lace 지갑에서 shielded NIGHT로 결제가 되고, 크리에이터가 에스크로된 코인을 회수한다.
**현황 (2026-09-12):** Lane A~D가 모두 main에 머지됐다. 크리에이터 앱(`creator/`), 배포 런북과 원클릭 로컬
데모(`deploy/`), CI, 크리에이터 복구 파일까지 포함이며, 142개 단위 테스트, 두 앱의 브라우저 smoke, 실제 체인 contract
flow, 인덱서 E2E, 재시작 후 재-provision을 2026-09-12에 로컬 devnet에서 다시 확인했다. 남은 것은 전부 **외부 릴리스
단계**다: Preprod 컨트랙트 배포, Phala CVM 배포와 실제 TDX quote 검증(RTMR3 핀), 실제 Lace 지갑으로 Creator → Buyer →
withdraw 전체 흐름, 데모 영상. 무엇을 이어서 할지는 바로 아래 섹션 0을 보라.
아래는 영어로 이어진다. 에이전트는 이 문서와 `spike/NOTES.md`를 먼저 읽는다.

## 0. Start here: what is done, what to pick up

Last updated 2026-09-12. Lanes A, B, C, and D are all on `main`, merged in order on 2026-09-12 after a
whole-branch review (the review fixes are the `fix/pre-merge-review` merge). What remains is release work
against public infrastructure, listed under Open.

### Done (merged to main)

| Lane | What landed | Proof it works |
|---|---|---|
| **A** `contract/` + `indexer/` | Compact contract (`createDrop` / `purchase` / `withdraw`, content-bound key commitment), deploy/fund/ledger scripts, the TEE indexer (attestation, provisioning checked against the chain, ledger watcher, dispatch, HTTP surface, Dockerfile). | 1 compile check, 62 indexer unit tests, an 11-case contract flow test on the devnet, an end-to-end devnet test (purchase → sealed blob opens to the key), a test against Phala's dstack simulator. |
| **B** `packages/midnight-web/` + `buyer/` | Shared wallet package (DApp-connector discovery, official Lace adapter as midnight-js providers, `BlindfoldClient` over the compiled contract, fakes for tests) and the buyer app (connect → catalog → buy in one shielded tx → poll → trial-open → decrypt, recovery file, manual unlock, 24 h local persistence). | 21 + 27 unit tests, a Playwright smoke through a fake connector and mock indexer, and a real Lace purchase on the local devnet that unlocked in about 20 s. |
| **C** `creator/` | Creator web app: browser-side encryption, ciphertext upload, on-chain registration with the key commitment, attestation gate (`@phala/dcap-qvl`, RTMR3 pin, `report_data` binding), sealed provisioning, creator-secret export/import, encrypted drop recovery file and re-provision, escrow listing and withdraw. | 31 unit tests and a Playwright smoke through the fake connector (including re-provision after the enclave key changes). The real Lace creator flow has not been run yet. |
| **D** `deploy/` + CI + docs | `deploy/devnet` compose, one-shot `npm run demo:local` (compile, devnet, deploy, indexer, seed, recovery bundle), `demo:recover`, Preprod and Phala CVM runbooks, `attest:inspect` / `smoke:live` quote verification in Node, `qa:secrets` lint, GitHub Actions CI, submission README, demo script and readiness notes. | `demo:local`, restart + `demo:recover`, the 11-case contract devnet flow, the indexer devnet E2E, both browser smokes, and CI green; all re-run on 2026-09-12. |

Run all of it with section 7b. `npm test` at the root runs every workspace's unit tests.

### Open: release steps (need owner credentials or funded wallets)

| Step | What to do | Where it is written down |
|---|---|---|
| Real Lace creator flow | Two funded Lace wallets on the local devnet: the creator registers and provisions in `creator/`, the buyer purchases and decrypts in `buyer/`, the creator withdraws. Record the result in a dated verification record. | `docs/deployment-verification-2026-09-11.md`, TODO 1 |
| Preprod contract | Fund a deploy wallet (faucet tNIGHT, shield, wait for DUST), deploy with `--network preprod`, confirm through the Midnight indexer and the explorer, record the address in `deploy/networks.json`. | `deploy/README.md`, "Preprod contract" |
| Phala CVM | Build and push the digest-pinned indexer image, `phala deploy`, `npm run attest:inspect -- <endpoint>`, pin RTMR3 and the digest in `deploy/networks.json`, then `npm run smoke:live`. Every image rebuild changes RTMR3: re-pin and re-provision. Nothing has run on real TDX hardware yet; the browser verifier has only been exercised with unit fixtures. | `deploy/README.md`, "Phala CVM"; verification record, TODO 3 |
| Demo video and final README pass | Record from the verified release. Keep the README status paragraph and `deploy/networks.json` truthful; a `null` there means not deployed. | `docs/demo-script.md`, `docs/demo-readiness.md` |

Fund the demo wallets by 2026-09-24 so DUST has accrued before the 2026-09-28 deadline.

### How to pick up a lane

1. Do not work on `main`. Start a purpose-named branch from it (`git switch -c <topic> main`); the lane
   branches are merged and remain only as history.
2. Set up once: section 6. Confirm the baseline is green before changing anything:
   `npm install && npm run check:runtime-copies && npm run compile -w contract && npm test`.
3. Read the plan's **Global Constraints**, then execute it task by task. An agent should use
   `superpowers:subagent-driven-development` (fresh implementer per task, a review after each task,
   a whole-branch review at the end); a human can follow the same plan by hand. Every task ends with
   tests green and a commit.
4. When the final review is clean and every suite passes on the merged tree, merge to `main`, push,
   and update the status rows in this file and the line in `README.md`.

Things Lanes A and B learned that the C and D plan texts predate. Follow these over the plan where they differ:

- **Vite 8, not 7.** The buyer runs on Vite 8; copy `buyer/vite.config.ts`, `buyer/scripts/copy-artifacts.mjs`,
  `buyer/tsconfig.json`, and the way `buyer/src/main.tsx` imports the polyfills first, instead of retyping them.
- **`connectContract(providers, address, secret, privateStateId, networkId)`** sets the midnight-js network id
  itself; the network id comes from `GET /contract`. Calling `setNetworkId` beforehand is harmless but not
  required.
- **Fake mode is dev-only.** Gate it as the buyer does (`import.meta.env.DEV && VITE_FAKE_WALLET === '1'`) and
  use `installFakeConnector()` from the shared package for the Playwright smoke, so a stray env var can never
  short-circuit a production build.
- **Ports.** Buyer dev server 5173, buyer Playwright smoke 5174. Lane D's port table still says "creator 5174":
  use **5175 for the creator dev server and 5176 for its smoke**, and fix the table in Lane D Task 1.
- **Key commitment** on-chain is `sha256(K_drop ‖ h_content)`, where `h_content = sha256(content blob)`.
  Compute it exactly that way (the plans already do) or the indexer answers 409 on `POST /provision`.
- **The dev indexer answers `quote_hex: "dev"`** on `GET /attest`. The creator app must refuse to provision
  against it unless the explicit "dev mode: skip attestation" switch is on.
- **The devnet compose file** for Lane D lives at `deploy/devnet/docker-compose.yml`. Its service images
  remain pinned to node 1.0.0, indexer 4.3.3, and proof server 8.1.0.
- **Creator ports are 5175/5176.** Buyer uses 5173/5174; do not copy the stale 5174 creator port from the
  original Lane D plan.
- **Public deployment metadata must be verified, not guessed.** `deploy/networks.json` keeps `null`
  placeholders until the Preprod contract, Phala endpoint, image digest, and RTMR3 are actually checked.

### Before you push

- `npm test`, `npm run check:runtime-copies`, and the type-checks
  (`npm run build -w indexer -w packages/midnight-web -w buyer`, plus your own package) pass on your branch.
- No seeds, wallet secrets, wallet addresses, `.midnight-state.json`, or wallet state in the diff (section 9).
- This file's status rows and the `README.md` status line still say the truth.

## 1. What this is

Blindfold sells unlockable content with a private payment and a key handoff that nobody in the middle can read:

1. The creator encrypts content in the browser with a fresh key `K_drop`, uploads only the ciphertext,
   registers the drop on a Compact contract (price plus a commitment to `K_drop`), and seals `K_drop` to
   an indexer running inside a TEE (Intel TDX on Phala Cloud) after verifying its attestation.
2. The buyer tops up public NIGHT into a private balance in fixed 5/10/50 NIGHT denominations (`wrap`;
   public Midnight networks have no shielded NIGHT to spend directly), then pays by spending that private
   balance (bNIGHT) through the contract's `purchase` circuit and passes a fresh one-time public key
   `e_pub`. The circuit enforces the price and records `e_pub` on the public ledger atomically with the
   payment.
3. The indexer watches the ledger, seals `K_drop` to each new `e_pub` (libsodium sealed box), and
   publishes the blob. The buyer trial-opens blobs with `e_priv`, recovers `K_drop`, decrypts the content.

**Why a contract.** The buyer must tell the indexer "I paid for drop X, answer to this key" without
revealing who they are and without a pre-registration the server could correlate with the payment. A
circuit argument written to the ledger does exactly that, and the contract, not a server, decides whether
the payment was sufficient.

**Why a TEE anyway.** The ledger is public, so `K_drop` cannot live on-chain. Somebody off-chain has to
hold it and answer purchases. The TEE is what stops that somebody's operator from reading the content.
The purchase is a zswap spend of the private balance, so buyer anonymity does not depend on the TEE; its
anonymity set is everyone who topped up the same denomination and has not spent it in a linkable way
(the top-up itself is public). Content confidentiality does depend on the TEE.

This is the second iteration of a design the team prototyped earlier (internal name "Drop"); the TEE
provisioning, dispatch-blob, and content-encryption code carries over from it.

## 2. Status

| Item | State |
|---|---|
| Feasibility spike (local devnet) | **Passed 2026-09-05.** See section 5. |
| Lane A: `contract/` + `indexer/` | **Merged to main 2026-09-05.** Compact contract (createDrop / purchase / withdraw with a content-bound key commitment), deploy/fund/ledger scripts, devnet flow test (6 cases); indexer with attestation, provisioning validation against the chain, watcher, dispatch, HTTP surface, Dockerfile; 62 unit tests, a devnet end-to-end test (real purchase → dispatched blob opens to the key), and a test against Phala's dstack simulator. Plan: `docs/superpowers/plans/2026-09-05-lane-a-contract-indexer.md`. |
| Lane B: `packages/midnight-web` + `buyer/` | **Merged to main 2026-09-05.** Shared wallet package (DApp-connector discovery and connection, the official Lace adapter as midnight-js providers, `BlindfoldClient` over the compiled contract, fakes) and the buyer app (connect → catalog → buy with one shielded transaction → poll → trial-open → decrypt; recovery file; manual unlock; 24 h local persistence on by default; error hints). 14 + 25 unit tests, a Playwright smoke through a fake connector and mock indexer, and a real Lace purchase on the devnet that unlocked in ~20 s. Plan: `docs/superpowers/plans/2026-09-05-lane-b-buyer-app.md`. |
| Lane C: `creator/` | **Merged to `main` 2026-09-12.** Browser encryption, upload, contract registration, attestation gate, sealed provisioning, creator-secret persistence with overwrite protection, encrypted drop recovery, escrow listing, and withdraw UX. Unit tests and the fake-wallet Playwright smoke pass; the real Lace creator flow remains. Plan: `docs/superpowers/plans/2026-09-05-lane-c-creator-app.md`. |
| Lane D: deploy, README, demo | **Merged to `main` 2026-09-12.** Local compose/seeder/recovery, Preprod and Phala runbooks, digest/RTMR3 verification, CI, README, readiness notes, and demo script; re-verified on the local devnet on 2026-09-12. Preprod, Phala, live-wallet, and video steps remain external release checks. `spike/` is history only. |
| Lane E: bNIGHT shielded payment token | **On `lane-e`.** Public Midnight networks have no shielded NIGHT, so the contract mints its own (`wrap`/`unwrap`) against public NIGHT in fixed 5/10/50 NIGHT denominations; buyer/creator apps show it as one Private balance. Tasks 1–4 (contract, shared client, buyer app, creator app) and Task 5 (indexer e2e, local demo, docs) are done on the branch. Plan: `docs/superpowers/plans/2026-09-12-lane-e-shielded-payment-token.md`. `Merged to main` after Task 7 (Preprod redeploy and CVM re-pin). |
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
| Buyer stays anonymous | Zswap spend of the private balance (bNIGHT, minted from public NIGHT by `wrap`); the coin is `receiveShielded` into the contract |
| Indexer learns about payments without holding any creator key | It reads the public `purchases` map through the Midnight indexer GraphQL |
| Wallet UX | DApp Connector v4 (`window.midnight.*`), `findDeployedContract(...).callTx.purchase(...)` |

Flow:

```
creator app   createDrop(dropId, price, commit) on the contract  (wallet tx)
              encrypt content with K_drop, upload ciphertext     (carried over)
              verify TEE attestation, seal {dropId, K_drop, h_content} to the enclave   (carried over)

buyer app     fresh X25519 keypair (e_pub, e_priv)
              purchase(dropId, e_pub, coin{value >= price, color = bNIGHT (minted by wrap)})   via Lace / 1AM
                -> contract: assert price, receiveShielded, purchases[i] = e_pub, escrow[i] = coin

indexer(TEE)  watch purchases map -> for each new e_pub: crypto_box_seal(K_drop, e_pub) -> publish blob
buyer app     poll blobs, trial-open with e_priv, sha256 check, AES-GCM decrypt      (carried over)

creator       withdraw(i): contract sends the escrowed coin to the creator's own shielded key
```

`commit` is `sha256(K_drop ‖ h_content)`, computed off-chain by the creator app; the contract stores it
as opaque bytes and never sees `K_drop`.

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

## 7. Running Blindfold locally

```bash
export PATH="$HOME/.docker/bin:$HOME/.local/bin:$PATH"
npm install
compact update 0.31.1
npm run qa:demo
npm run demo:local

# separate terminals
VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev -w buyer
VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev -w creator
```

Lace for the local devnet: install the Lace extension (Chrome), create a wallet, Settings > Midnight >
network **Undeployed**, proof server **Local (http://localhost:6300)**. Fund it from the genesis wallet:

```bash
npm run fund -w contract -- <mn_addr…> <mn_shield-addr…> 1000 --network undeployed
```

then press **Generate tDUST** in Lace and wait a few minutes. Addresses shown as `mn_addr1…` (no network
segment) mean Lace is still on Mainnet.

The local demo writes a mode-0600 recovery bundle under `.local/`. After restarting only the Blindfold
indexer, `npm run demo:recover` restores the seeded encrypted content and re-provisions the in-memory key.
It refuses real TEE endpoints. See `deploy/README.md` for shutdown, reset, Preprod, Phala, and troubleshooting.

## 7b. Manual integration and devnet tests

```bash
export PATH="$HOME/.docker/bin:$HOME/.local/bin:$PATH"
npm install && npm run check:runtime-copies          # exactly one onchain-runtime copy
npm run compile -w contract                          # Compact 0.31.1 -> contract/build/blindfold
npm test -w indexer                                  # 62 unit tests (devnet/simulator cases skip)
docker compose -f deploy/devnet/docker-compose.yml up -d --wait
npm run deploy -w contract -- --network undeployed    # prints CONTRACT_ADDRESS=...
DEVNET=1 npm run test:devnet -w contract              # 11-case contract flow test (~90 s)
cd indexer && NETWORK=undeployed CONTRACT_ADDRESS=<addr> DEV_SEED_HEX=<64 hex> DATA_DIR=../.local/manual-indexer npm start
DEVNET=1 CONTRACT_ADDRESS=<addr> npx vitest run test/e2e.devnet.test.ts
cd ..
docker build -f indexer/Dockerfile -t blindfold-indexer .                  # from the repo root
```

Buyer app against that indexer: `cd buyer && VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev` → http://127.0.0.1:5173
(Lace on Undeployed with the local proof server). Without a wallet or chain: `VITE_FAKE_WALLET=1 npm run dev`
(dev builds only). Tests: `npm test -w buyer`, `npm test -w packages/midnight-web`, `cd buyer && npm run test:e2e`
(the smoke starts its own fake-wallet server on 5174).
Creator app: `VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev -w creator` → http://127.0.0.1:5175;
its Playwright smoke uses 5176. The local creator flow requires the explicit dev-attestation switch.
Both apps set the midnight-js network id at session open from `GET /contract` and pass it to `connectContract`.

Indexer HTTP surface (spec section 6): `GET /health`, `GET /contract`, `GET /attest`, `POST /provision`
(sealed payload, `application/octet-stream`), `GET /catalog`, `GET /dispatch`, `GET /dispatch/:key`,
`GET /bucket/:key`, `PUT /bucket/:key` (key must equal `sha256(body)`). Bodies must be sent with
`Content-Type: application/octet-stream` or Fastify answers 415.

The key commitment stored on-chain is `sha256(K_drop ‖ h_content_bytes)`; the creator app (Lane C) and the
demo seeder (Lane D) compute it exactly that way.

## 8. Gotchas (details in spike/NOTES.md)

1. Duplicate `onchain-runtime-v3` breaks all circuit calls (see section 6).
2. `compact update` without a version installs a compiler that does not match midnight-js 4.1.1.
3. The circuit wants `{nonce: Uint8Array, color: Uint8Array, value: bigint}`; NIGHT's color is 32 zero bytes.
4. `tx.public.txId` is a 34-byte identifier; query the indexer with `transactions(offset:{identifier})`, not `hash`.
5. The SDK's `MidnightBech32m.parse` rejects shielded addresses (over the 90-char bech32m limit); decode with `@scure/base` and a larger limit.
6. Spending unshielded NIGHT from a script needs `wallet.signRecipe(recipe, keystore.signData)` before `finalizeRecipe`, or the node answers custom error 192.
7. Lace needs the local proof server on port 6300; 1AM proves in-browser. Public testnets: faucet gives unshielded tNIGHT, shielding is a separate transfer, DUST takes time on a fresh wallet. Fund demo wallets a day early.
8. `sendShielded` to a key other than the caller's does not notify the recipient. Hence escrow in the contract and creator-initiated `withdraw`.
9. The enclave catalog is intentionally in-memory. Content and dispatch files persist, but every indexer
   restart or measurement-changing redeploy requires creator re-provisioning before new purchases can unlock.
10. An image tag is not a trust pin. Phala deployment records the immutable image digest and verified RTMR3;
    changing the image, compose, or relevant environment may rotate both RTMR3 and the provisioning key.
11. Never claim a public deployment while `deploy/networks.json` contains `null` placeholders. Run
    `npm run attest:inspect` to discover and verify a quote, then `npm run smoke:live` against independently pinned values.

## 9. Repo rules

- **No secrets in git, ever.** `.midnight-state.json` and wallet state are ignored. Never paste a seed, a wallet secret, or a Lace address (a devnet address is also that wallet's mainnet address) into a tracked file.
- This repo is a fresh start. Do not import history from the previous private repo.
- `spike/` is throwaway. Findings move to `spike/NOTES.md` and this guide; code is rewritten in the real structure.
- Pin every Midnight package to the matrix; bump only as a deliberate, tested change.
- When a Compact contract changes, compile it with the real compiler before claiming anything about it.

## 10. Design and per-lane plans

- Spec (approved 2026-09-05): `docs/superpowers/specs/2026-09-05-blindfold-design.md`
- Plans, one per lane, each self-contained with TDD steps and exact code. Pick your lane, read its
  Global Constraints, then execute task by task (an agent should use the `superpowers:executing-plans`
  or `superpowers:subagent-driven-development` skill):

| Lane | Plan | Builds | Status |
|---|---|---|---|
| A | `docs/superpowers/plans/2026-09-05-lane-a-contract-indexer.md` | `contract/` (Compact, deploy/flow scripts) and `indexer/` (TEE service, watcher, HTTP) | Merged 2026-09-05 |
| B | `docs/superpowers/plans/2026-09-05-lane-b-buyer-app.md` | `packages/midnight-web/` (wallet + contract client, shared) and `buyer/` | Merged 2026-09-05 |
| C | `docs/superpowers/plans/2026-09-05-lane-c-creator-app.md` | `creator/` | Merged to `main` 2026-09-12; real Lace creator flow pending |
| D | `docs/superpowers/plans/2026-09-05-lane-d-deploy-demo.md` | devnet/Preprod/Phala runbooks, one-shot local demo, CI, submission README | Merged to `main` 2026-09-12; external release checks remain |
| E | `docs/superpowers/plans/2026-09-12-lane-e-shielded-payment-token.md` | bNIGHT: contract `wrap`/`unwrap`, shared client, buyer/creator Private balance panels, indexer e2e, docs | On `lane-e`; `Merged to main` after Task 7 (Preprod redeploy, CVM re-pin) |

Cross-lane contracts are the wire formats in spec section 6 and the interfaces listed at the top of each
task. The fakes Lane C's plan relies on exist and are exported from `@blindfold/midnight-web`
(`FakeBlindfoldClient`, `fakeConnectedWallet`, `installFakeConnector`); the buyer's in-process indexer
stand-in is `buyer/src/mockApi.ts`.

## 11. Resolved implementation decisions

- The TEE indexer and Midnight ledger watcher are TypeScript in one deployable image.
- Lace is the verified demo wallet. DApp Connector discovery remains generic, but 1AM is not claimed until tested.
- Local devnet is the reproducible judge path; Preprod plus Phala CVM is the submission/demo target.
- The 80-byte sealed dispatch blobs stay in the HTTP bucket for this submission.
- The creator app registers drops directly and initiates escrow withdrawal itself.
- Public TEE identity is a tuple of digest-pinned image/compose configuration and verified RTMR3. A rotation
  requires republishing the pin and re-provisioning active drops.
