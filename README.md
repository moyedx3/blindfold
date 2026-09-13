# Blindfold

**Sell encrypted content for a private payment on Midnight. The chain enforces the deal, a TEE delivers the key, and nobody in the middle can read the content or tell who bought it.**

Built for the Midnight Korea Hackathon 2026. Everything below runs on Midnight **Preprod** with a real Intel TDX enclave on Phala Cloud.

| | |
|---|---|
| 🛒 Live demo (buyer) | <https://blindfold-psi.vercel.app/> |
| 🎨 Live demo (creator) | <https://blindfold-psi.vercel.app/creator/> |
| 🎬 Demo video | _(link in the submission form)_ |
| 📜 Contract (Preprod) | `84d80ed010cea433e242379f3e82927477b09d0268fcfcc36e69753279546a8f` |
| 🔐 TEE indexer | Phala Cloud CVM, Intel TDX — pinned values in [`deploy/networks.json`](deploy/networks.json) |
| 🧾 Submission text | [`docs/status.md`](docs/status.md) has the team's live checklist |

<details>
<summary><b>한국어 요약</b></summary>

- Blindfold는 암호화된 콘텐츠를 프라이빗 결제로 사고파는 Midnight DApp입니다.
- 크리에이터는 브라우저에서 파일을 암호화해 올리고, 구매자는 지갑에서 한 번 승인해 결제하면 잠시 뒤 브라우저에서 복호된 콘텐츠를 받습니다.
- 결제 조건(가격, 토큰 종류, 1회 판매)은 Compact 회로가 강제합니다. 구매는 컨트랙트가 발행한 shielded 토큰(bNIGHT)의 Zswap 지출이라 체인에는 콘텐츠 id와 일회용 키만 남고 지갑은 남지 않습니다.
- 콘텐츠 키는 Intel TDX 안의 인덱서만 다룹니다. 크리에이터 앱이 브라우저에서 attestation을 검증한 뒤에만 키를 봉인해 보냅니다.
- 심사용 바로가기는 아래 **For reviewers** 표를, Midnight 활용은 **How Midnight is used**를 보세요.

</details>

---

## What it does in 30 seconds

1. **Creator** encrypts a file in the browser, registers its price and a key commitment on-chain, verifies the enclave's TDX attestation, and seals the content key to that enclave.
2. **Buyer** moves public NIGHT into a private balance (fixed 5 / 10 / 50 NIGHT top-ups), then clicks Buy: one transaction spends the private balance *and* registers a fresh one-time public key.
3. **The enclave** sees the purchase in public chain state, seals the content key to that one-time key, and posts it publicly. The buyer opens the one seal that fits and decrypts locally.
4. **Creator** withdraws escrow by proving knowledge of a browser-only secret, then cashes out to public NIGHT.

What the chain sees: a content id, a one-time key, an amount. Not a wallet.
What the server sees: ciphertext and sealed keys. Not the content, not the buyer.

## For reviewers

| If you want to see… | Look here |
|---|---|
| The whole contract (5 circuits, 75 lines) | [`contract/src/blindfold.compact`](contract/src/blindfold.compact) |
| What is proven vs. disclosed (`witness`, `disclose()`) | `withdraw` and `purchase` in the contract; [`docs/superpowers/specs/2026-09-05-blindfold-design.md`](docs/superpowers/specs/2026-09-05-blindfold-design.md) §5 |
| The contract-minted shielded token (bNIGHT) and why | `wrap` / `unwrap` in the contract; [`docs/superpowers/specs/2026-09-12-lane-e-shielded-payment-token-design.md`](docs/superpowers/specs/2026-09-12-lane-e-shielded-payment-token-design.md) |
| Browser-side TDX attestation verification | [`creator/src/attestation.ts`](creator/src/attestation.ts), [`creator/src/qvl-verifier.ts`](creator/src/qvl-verifier.ts) |
| The enclave: reads public ledger, seals keys, posts publicly | [`indexer/src/watcher.ts`](indexer/src/watcher.ts), [`indexer/src/engine.ts`](indexer/src/engine.ts), [`indexer/src/provision.ts`](indexer/src/provision.ts) |
| Wallet integration (DApp Connector 4, in-wallet proving) | [`packages/midnight-web/src/wallet.ts`](packages/midnight-web/src/wallet.ts), [`packages/midnight-web/src/providers.ts`](packages/midnight-web/src/providers.ts) |
| Real-chain contract tests (12 cases, incl. wrong token / underpaid / resale refused) | [`contract/test/flow.test.ts`](contract/test/flow.test.ts) |
| Pinned deployment values (contract, CVM endpoint, RTMR3, image digest) | [`deploy/networks.json`](deploy/networks.json) |
| Verification record and what is still open | [`docs/deployment-verification-2026-09-12-bnight.md`](docs/deployment-verification-2026-09-12-bnight.md), [`docs/status.md`](docs/status.md) |
| Three-minute demo script | [`docs/demo-script.md`](docs/demo-script.md) |

## How it works

```text
creator browser ── encrypted content ──────────────▶ public store (served by the indexer)
       │
       ├── createDrop(price, key commitment) ───────▶ Midnight contract (Compact)
       └── verify TDX quote, seal content key ─────▶ TEE indexer (Intel TDX)

buyer wallet ─── wrap: public NIGHT → bNIGHT ─────▶ Midnight contract
buyer wallet ─── purchase(id, one-time key, bNIGHT coin) ▶ Midnight contract (escrow + key on ledger)
TEE indexer ──── reads public ledger ─────────────▶ seals key to the one-time key, posts it publicly
buyer browser ── opens its seal, decrypts locally

creator wallet ─ withdraw(idx) [proves the secret] ▶ unwrap: bNIGHT → public NIGHT
```

- **Content** is encrypted once (AES-256-GCM) and left in a public store. Only the key is protected.
- **The content key** travels twice: sealed to the enclave's public key (after attestation), then sealed by the enclave to the buyer's one-time key and posted publicly. The buyer cannot compute the name of its seal, so it fetches all of them and trial-opens. The server never learns who took what.
- **Payment** never touches the enclave. It sits in contract escrow until the creator withdraws.

## How Midnight is used

| Midnight feature | Where | Why it matters here |
|---|---|---|
| **Compact circuits + `witness` + `disclose()`** | `createDrop`, `wrap`, `purchase`, `withdraw`, `unwrap` | Price, token type and one-sale rule are enforced in-circuit. The creator secret is a `witness`; `withdraw` proves `dropOwner == H(secret)` without revealing it. Everything public is an explicit `disclose()` — the compiler rejects anything else. |
| **Zswap shielded spend** (`receiveShielded` / `sendShielded`) | `purchase`, escrow, `withdraw` | The buyer's coin is spent shielded: no wallet address or wallet key is a contract argument. |
| **Contract-minted shielded token** (`mintShieldedToken`, `tokenType(…, kernel.self())`) | `wrap` | Public networks have no shielded NIGHT, so the contract mints **bNIGHT** 1:1 against public NIGHT in fixed 5/10/50 denominations. Its token type is bound to the contract address. |
| **`receiveUnshielded` / `sendUnshielded`** | `wrap`, `unwrap` | The bridge between public NIGHT and the private balance. |
| **Public ledger via Midnight indexer GraphQL** | `indexer/src/chain.ts` | The enclave reads `purchases`, `purchaseDrop`, `kCommit` with no wallet, no seed, no viewing rights. |
| **DApp Connector API 4.0.1 + in-wallet proving** | `packages/midnight-web` | `connect`, `balanceUnsealedTransaction`, `submitTransaction`, `getShieldedBalances`; 1AM proves inside the wallet via `getProvingProvider`, Lace uses a local proof server. |
| **DUST** | every transaction | Fees. Sponsorship is decided per transaction by the wallet; keep DUST in both demo wallets. |

Versions: Compact 0.31.1 (language 0.23), midnight-js 4.1.1, DApp Connector API 4.0.1.

## Privacy model, honestly

| Hidden | Public | You trust |
|---|---|---|
| Buyer's wallet (the purchase is a Zswap spend of bNIGHT) | Top-up transactions (address + 5/10/50 amount) | Midnight cryptography |
| Creator's secret (witness; only its hash is on-chain) | Content id, price, key commitment, one-time key, escrow value | Compact circuit + this contract's code |
| Which purchase belongs to whom (fresh one-time key each time) | Creator's cash-out address and amount | Our app code |
| Content key and plaintext (enclave only) | Ciphertext and sealed keys | Intel TDX, dstack, our indexer code |

The anonymity set of one purchase is everyone who topped up the same denomination. The TEE moves trust; it does not remove it. See [Limits](#limits).

## Try it on Preprod

1. Install the **1AM** wallet, switch it to Preprod, and get tNIGHT from the faucet (<https://midnight-tmnight-preprod.nethermind.dev>, unshielded address). Generate DUST in the wallet; some transactions cannot be sponsored and need your own DUST.
2. **Creator** (<https://blindfold-psi.vercel.app/creator/>): connect, pick a small file, set a price in NIGHT, click *Encrypt + Register + Provision*. Watch the four stages, including the browser-side attestation check. Keep the recovery file it downloads.
3. **Buyer** (<https://blindfold-psi.vercel.app/>): connect a second wallet, *Top up 5*, then *Buy*. After the transaction lands the sealed key arrives and the content opens in the browser.
4. **Creator**: *Refresh* sales, *Withdraw*, then *Cash out to public NIGHT*.

Lace works on the local devnet with a local proof server. On Preprod its sync did not finish during our tests, so the live loop was verified with 1AM.

## Run locally

Prerequisites: Docker Desktop, Node.js 22+, and Compact 0.31.1.

```bash
export PATH="$HOME/.docker/bin:$HOME/.local/bin:$PATH"
npm install
compact update 0.31.1
npm run demo:local
```

The command compiles the contract, starts the pinned local Midnight stack, deploys the contract, starts the Blindfold indexer in explicit dev mode, and registers and provisions one encrypted demo drop.

Then start the apps:

```bash
VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev -w buyer
VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev -w creator
```

Buyer: <http://127.0.0.1:5173> · Creator: <http://127.0.0.1:5175>

For Lace, select Midnight network **Undeployed**, use the local proof server at `http://127.0.0.1:6300`, fund the wallet with `npm run fund -w contract -- <unshielded> <shielded> 1000 --network undeployed`, and generate tDUST. The creator must intentionally enable its local-dev attestation bypass. This is allowed only on `undeployed` with a loopback indexer URL; public networks reject the dev quote even if the switch is enabled.

Full local, Preprod, Phala, recovery, and troubleshooting instructions are in [`deploy/README.md`](deploy/README.md).

## Verify it yourself

```bash
npm run qa:demo                 # compile, unit tests, all builds, secret scan (needs Docker for a compose check)
npm run test:e2e -w buyer       # Playwright smoke (fake wallet)
npm run test:e2e -w creator
npm run smoke:live              # hits the live CVM + Preprod values in deploy/networks.json
npm run attest:inspect -- https://94ef50c5719468f34cdb06e000e8f3ee415f0429-8080.dstack-pha-prod5.phala.network
```

`attest:inspect` prints the enclave's TDX quote status (expected `UpToDate`), its RTMR3, and the `report_data` binding to the provisioning key. Compare the RTMR3 with `measurement_rtmr3` in `deploy/networks.json`; the same value is compiled into the creator app. The real-chain contract tests (`contract/test/flow.test.ts`) and the indexer purchase-to-key E2E need the local devnet; see the deploy runbook.

## Status (2026-09-13)

- Contract deployed on Preprod; indexer running in a Phala Cloud CVM with a genuine TDX quote (`UpToDate`) and its RTMR3 pinned in the apps. The CVM compose pins the image digest and contract address literally, so the RTMR3 pin covers both.
- Full loop verified on Preprod with 1AM wallets: top-up, register with browser-side attestation, purchase, unlock, withdraw, cash out.
- Suite: 140+ unit tests, 12 real-chain contract cases, indexer E2E, `smoke:live`.
- The team's checklist of what is done, verified, and open: [`docs/status.md`](docs/status.md).

## Limits

- Top-ups are public; a purchase hides among everyone who topped up the same denomination.
- The TEE is a trust assumption (Intel, dstack, our code). There is no reproducible build yet.
- Redeploying the enclave changes RTMR3; creators re-provision from their recovery file (the key catalog is intentionally in memory).
- No refund or re-delivery flow if key delivery fails after payment. Each content sells once (a scope decision, not a design limit).
- Decrypted content can be copied; network metadata and finality depth are out of scope.

## Repository map

| Path | Purpose |
|---|---|
| `contract/` | Compact contract and deploy/fund/ledger/wrap scripts |
| `indexer/` | TEE key provisioning, ledger watcher, catalog, content and dispatch APIs |
| `packages/midnight-web/` | Shared wallet and contract client integration |
| `buyer/` | Top-up, purchase, polling, and content unlock app |
| `creator/` | Encryption, attestation, registration, provisioning, withdrawal, cash-out app |
| `deploy/` | Local devnet, Preprod/Phala runbooks, smoke checks, demo automation, site build |
| `docs/` | Design specs, team guide, status board, demo script |

## More documentation

- [`docs/guide.md`](docs/guide.md) — architecture, setup, known Midnight gotchas
- [`deploy/README.md`](deploy/README.md) — local and public deployment operations
- [`docs/demo-script.md`](docs/demo-script.md) — three-minute presentation flow
- [`docs/demo-readiness.md`](docs/demo-readiness.md) — exact prototype boundaries
- [`docs/superpowers/specs/2026-09-05-blindfold-design.md`](docs/superpowers/specs/2026-09-05-blindfold-design.md) — approved design
- [`docs/superpowers/specs/2026-09-12-lane-e-shielded-payment-token-design.md`](docs/superpowers/specs/2026-09-12-lane-e-shielded-payment-token-design.md) — bNIGHT design
