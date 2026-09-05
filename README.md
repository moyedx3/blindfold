# Blindfold

Sell content that unlocks with a private payment, with nobody in the middle able to read it.
Built on [Midnight](https://midnight.network) for the Midnight Korea Hackathon 2026.

A creator encrypts content in the browser and hands the key only to an attested TEE. A buyer pays with
shielded NIGHT through a Compact contract that enforces the price and records the buyer's one-time public
key atomically. The TEE seals the content key to that one-time key and publishes it. Nobody learns who bought.

Status (2026-09-05): the contract and the TEE-side indexer are merged with devnet end-to-end tests; the buyer app, creator app, and deployment lanes are next. See [`docs/guide.md`](docs/guide.md) for status, setup, and the per-lane plans.
