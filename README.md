# Blindfold

Sell content that unlocks with a private payment, with nobody in the middle able to read it.
Built on [Midnight](https://midnight.network) for the Midnight Korea Hackathon 2026.

Blindfold combines a Compact contract, a private balance (bNIGHT), browser-side encryption, and an
attested TEE:

1. A creator encrypts content in the browser, registers its price and key commitment on-chain, and seals
   the content key to the TEE only after verifying its attestation.
2. A buyer tops up public NIGHT into a private balance in fixed 5/10/50 NIGHT denominations (public
   Midnight networks have no shielded NIGHT to spend directly), then pays by spending that private balance
   through the contract and supplying a fresh one-time public key in the same transaction.
3. The TEE observes the purchase and seals the content key to that one-time key. The buyer opens it and
   decrypts the content locally.

The contract enforces payment; the purchase is a zswap spend of the private balance, so the chain sees a
drop id and a one-time key, not a wallet — the top-up itself is public. The TEE keeps the content key from
the service operator.

## Status

As of 2026-09-12, `main` contains the contract, the TEE indexer, the shared wallet package, the buyer app,
the creator app, the deployment tooling, and CI. At the merge the suite passed locally: 142 unit tests, both
fake-wallet browser smokes, local Midnight devnet deployment, eleven real-chain contract tests (including bNIGHT wrap, purchase, and unwrap), the indexer
purchase-to-key-delivery E2E test, and an indexer restart followed by re-provisioning from the recovery
bundle. Later the same day the contract was deployed to Preprod and the indexer went live in a Phala
CVM: a genuine TDX quote verifies as `UpToDate`, its `report_data` is bound to the provisioning key, and
`npm run smoke:live` passes against the values in `deploy/networks.json`. A complete creator-to-buyer run
with real Lace wallets on Preprod is still to be done. Since that Preprod deployment, `purchase` was changed
to require the contract's own bNIGHT instead of shielded NIGHT (public Midnight networks have none); the
bNIGHT contract's redeploy to Preprod and CVM re-pin is Lane E Task 7, still pending, so until it lands the
Preprod/CVM values recorded above and in `deploy/networks.json` describe the previous, pre-bNIGHT contract.
The team's live checklist of what is done, verified, and still open is [`docs/status.md`](docs/status.md).

A complete creator-to-buyer Lace run on Preprod, the demo video, and mainnet readiness checks remain
TODO. See the [deployment verification record and TODOs](docs/deployment-verification-2026-09-11.md).
No placeholder in `deploy/networks.json` should be presented as a live deployment.

## How Midnight is used

- [`contract/src/blindfold.compact`](contract/src/blindfold.compact) implements `createDrop`, `purchase`,
  `withdraw`, `wrap`, and `unwrap`. `purchase` receives bNIGHT (the contract's own shielded token), enforces
  the price, escrows the coin, and records the buyer's disclosed one-time encryption key atomically.
  `withdraw` returns escrow to the creator after a secret-witness authorization check.
- The buyer and creator connect through DApp Connector v4 and Midnight.js providers. Lace is the verified
  demo wallet; another compatible connector can be discovered through the same interface but must be
  tested before it is claimed as supported.
- Public Midnight networks have no shielded NIGHT to spend directly, so `wrap` mints bNIGHT against public
  NIGHT the caller sends, in fixed 5/10/50 NIGHT denominations. `unwrap` converts bNIGHT the contract holds
  back into public NIGHT for the caller.
- The indexer reads the contract's public ledger from Midnight indexer GraphQL. What appears publicly is
  the contract call, drop ID, one-time key, paid value, and normal Zswap/DUST transaction data—not a wallet
  address or wallet public key.
- The commitment is `sha256(K_drop || sha256(ciphertext blob))`, binding the provisioned key to the exact
  encrypted content registered by the creator.

## Run locally

Prerequisites: Docker Desktop, Node.js 22+, and Compact 0.31.1.

```bash
export PATH="$HOME/.docker/bin:$HOME/.local/bin:$PATH"
npm install
compact update 0.31.1
npm run demo:local
```

The command compiles the contract, starts the pinned local Midnight stack, deploys the contract, starts
the Blindfold indexer in explicit dev mode, and registers and provisions one encrypted demo drop.

Then start the apps:

```bash
VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev -w buyer
VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev -w creator
```

Buyer: <http://127.0.0.1:5173> · Creator: <http://127.0.0.1:5175>

For Lace, select Midnight network **Undeployed**, use the local proof server at
`http://127.0.0.1:6300`, fund the wallet with `npm run fund -w contract -- <unshielded> <shielded> 1000`,
and generate tDUST. The creator must intentionally enable its local-dev attestation bypass. This is
allowed only on `undeployed` with a loopback indexer URL, including when serving a production build
locally; public networks reject the dev quote even if the switch is enabled.

Full local, Preprod, Phala, recovery, and troubleshooting instructions are in
[`deploy/README.md`](deploy/README.md).

## Verification

```bash
npm run qa:demo
npm run test:e2e -w buyer
npm run test:e2e -w creator
```

The full devnet contract/indexer tests require the local stack and are documented in the deploy runbook.
The public TEE smoke test is `npm run smoke:live` after verified Preprod values are recorded.

## Architecture

```text
creator browser -- encrypted content --> indexer bucket
       |                                  |
       +-- createDrop(price, commit) ---->+ Midnight contract
       +-- verify TDX + sealed K_drop --->+ TEE indexer

buyer wallet ---- shielded purchase + one-time key ----> Midnight contract
buyer browser <--- sealed K_drop ----------------------- TEE indexer
buyer browser ---- decrypt ciphertext locally
```

## Repository map

| Path | Purpose |
|---|---|
| `contract/` | Compact contract and deploy/fund/ledger scripts |
| `indexer/` | TEE key provisioning, ledger watcher, catalog, content and dispatch APIs |
| `packages/midnight-web/` | Shared wallet and contract client integration |
| `buyer/` | Purchase, recovery, polling, and content unlock app |
| `creator/` | Encryption, attestation, registration, provisioning, and withdrawal app |
| `deploy/` | Local devnet, Preprod/Phala runbooks, smoke checks, and demo automation |
| `docs/` | Design, team guide, implementation plans, and presentation script |

## Security and scope

Blindfold protects buyer payment identity at the chain layer and keeps plaintext/key material away from
the indexer operator. It does not hide network metadata, stop a legitimate buyer from copying plaintext,
or provide production-grade availability. The enclave catalog is intentionally in memory; restarting or
changing a deployment requires creators to re-provision their drops. See
[`docs/demo-readiness.md`](docs/demo-readiness.md) for the exact prototype boundaries.

## More documentation

- [`docs/guide.md`](docs/guide.md) — status, architecture, setup, and known Midnight gotchas
- [`deploy/README.md`](deploy/README.md) — local and public deployment operations
- [`docs/demo-script.md`](docs/demo-script.md) — three-minute presentation flow
- [`docs/superpowers/specs/2026-09-05-blindfold-design.md`](docs/superpowers/specs/2026-09-05-blindfold-design.md) — approved design
