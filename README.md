# Blindfold

Sell content that unlocks with a private payment, with nobody in the middle able to read it.
Built on [Midnight](https://midnight.network) for the Midnight Korea Hackathon 2026.

Blindfold combines a Compact contract, shielded NIGHT, browser-side encryption, and an attested TEE:

1. A creator encrypts content in the browser, registers its price and key commitment on-chain, and seals
   the content key to the TEE only after verifying its attestation.
2. A buyer pays through the contract with shielded NIGHT and supplies a fresh one-time public key in the
   same transaction.
3. The TEE observes the purchase and seals the content key to that one-time key. The buyer opens it and
   decrypts the content locally.

The contract enforces payment; Zswap protects the buyer's payment identity; the TEE keeps the content key
from the service operator.

## Status

As of 2026-09-11, commit `f060804e8b06024dfbbe14708a38de1b873efdc7` (on
`fix/creator-recovery`, including Lanes A/B/C/D) has passed CI, local Midnight devnet deployment,
six real-chain contract tests, and the indexer purchase-to-key-delivery E2E test. The local services and
seeded demo drop were restored after a shutdown. These results do not establish public-network or real-TEE
readiness, and do not mean this branch has been merged into `main`.

A complete creator-to-buyer Lace run, public Preprod deployment, Phala CVM verification, and mainnet
readiness checks remain TODO. See the [deployment verification record and TODOs](docs/deployment-verification-2026-09-11.md).
No placeholder in `deploy/networks.json` should be presented as a live deployment.

## How Midnight is used

- [`contract/src/blindfold.compact`](contract/src/blindfold.compact) implements `createDrop`, `purchase`,
  and `withdraw`. `purchase` receives shielded NIGHT, enforces the price, escrows the coin, and records the
  buyer's disclosed one-time encryption key atomically. `withdraw` returns escrow to the creator after a
  secret-witness authorization check.
- The buyer and creator connect through DApp Connector v4 and Midnight.js providers. Lace is the verified
  demo wallet; another compatible connector can be discovered through the same interface but must be
  tested before it is claimed as supported.
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
