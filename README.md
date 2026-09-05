# Blindfold

Sell content that unlocks with a private payment, with nobody in the middle able to read it.
Built on [Midnight](https://midnight.network) for the Midnight Korea Hackathon 2026.

A creator encrypts content in the browser and hands the key only to an attested TEE. A buyer pays with
shielded NIGHT through a Compact contract that enforces the price and records the buyer's one-time public
key atomically. The TEE seals the content key to that one-time key and publishes it. Nobody learns who bought.

Status (2026-09-06): the contract, the TEE-side indexer, and the buyer app (with the shared wallet package) are merged, with devnet end-to-end tests and a real Lace purchase on the local devnet. The Lane C creator app implementation is complete on the `lane-c` branch, including browser encryption, on-chain registration, attestation gating, sealed provisioning, and escrow withdrawal UX; its real Lace creator-to-buyer run is the final validation before merge. Deployment and submission packaging remain in Lane D. See [`docs/guide.md`](docs/guide.md) for status, setup, and the per-lane plans.
