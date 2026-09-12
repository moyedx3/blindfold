# Three-minute Blindfold demo

Prepare both wallets, DUST balances, the deployed stack, catalog, explorer tab, and `npm run smoke:live`
evidence before recording. Use separate creator and buyer browser profiles.

## 0:00–0:15 — problem and proof status

“Blindfold sells encrypted content for a private payment. The buyer moves public NIGHT into a private
balance in fixed denominations; the purchase spends that private balance, so the chain sees a drop id and
a one-time key, not a wallet. The content key is delivered by an attested TEE that cannot expose it to its
operator.” Briefly show the green CI/live-smoke result and the pinned contract, endpoint, image digest, and
RTMR3.

## 0:15–0:35 — buyer top-up

1. Connect the buyer Lace wallet and show its Private balance panel: `Public NIGHT 10 · Private balance 0`.
2. Click `Top up 10` and narrate: "fixed denominations, so the amount does not identify me."

## 0:35–1:15 — creator

1. Switch to the separate creator profile and connect its Lace wallet.
2. Select a small image or text file and set the price to 1 NIGHT.
3. Submit and narrate the four visible stages: browser encryption, on-chain registration, TDX attestation
   verified against RTMR3, and sealed key provisioning.
4. Show that the public catalog contains metadata and a ciphertext hash, not `K_drop` or plaintext.

## 1:15–2:15 — buyer purchase

1. Switch back to the buyer profile.
2. Click `Buy`: one approval, spending the private balance topped up earlier.
3. While polling, show the explorer/ledger: drop ID, one-time public key, and value are disclosed; a wallet
   address and wallet public key are not contract arguments.
4. Let the buyer trial-open the dispatched blobs and show the decrypted content.

## 2:15–2:45 — creator withdrawal and cash out

Return to the creator profile, refresh escrow, click `Withdraw`, then click `Cash out to public NIGHT` and
show the public balance change. State that the contract—not the TEE—enforced the amount and creator
authorization.

## 2:45–3:00 — boundaries

Summarize the split of trust: "The buyer moves public NIGHT into a private balance in fixed denominations;
the purchase spends that private balance, so the chain sees a drop id and a one-time key, not a wallet. The
content key is delivered by an attested TEE." Compact enforces payment; TDX keeps the content key
confidential. State the limits plainly: network metadata is outside scope, decrypted content can be copied,
and redeployments require a new measurement pin and re-provisioning.
