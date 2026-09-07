# Three-minute Blindfold demo

Prepare both wallets, DUST balances, the deployed stack, catalog, explorer tab, and `npm run smoke:live`
evidence before recording. Use separate creator and buyer browser profiles.

## 0:00–0:20 — problem and proof status

“Blindfold sells encrypted content for a private payment. The contract enforces payment, Midnight shields
the buyer, and an attested TEE hands over a key it cannot expose to its operator.” Briefly show the green
CI/live-smoke result and the pinned contract, endpoint, image digest, and RTMR3.

## 0:20–1:00 — creator

1. Connect the creator Lace wallet.
2. Select a small image or text file and set the price to 1 NIGHT.
3. Submit and narrate the four visible stages: browser encryption, on-chain registration, TDX attestation
   verified against RTMR3, and sealed key provisioning.
4. Show that the public catalog contains metadata and a ciphertext hash, not `K_drop` or plaintext.

## 1:00–2:00 — buyer

1. Switch to the separate buyer profile and connect its Lace wallet.
2. Buy the new drop and approve the single shielded transaction.
3. While polling, show the explorer/ledger: drop ID, one-time public key, and value are disclosed; a wallet
   address and wallet public key are not contract arguments.
4. Let the buyer trial-open the dispatched blobs and show the decrypted content.

## 2:00–2:30 — creator withdrawal

Return to the creator profile, refresh escrow, withdraw the purchase, and show the shielded balance change.
State that the contract—not the TEE—enforced the amount and creator authorization.

## 2:30–3:00 — boundaries

Summarize the split of trust: Zswap for buyer payment privacy, Compact for payment enforcement, TDX for
content-key confidentiality. State the limits plainly: network metadata is outside scope, decrypted content
can be copied, and redeployments require a new measurement pin and re-provisioning.
