# Demo readiness and prototype boundaries

## Accurate claim

Blindfold is designed as a real-chain, real-TEE prototype demo. The final claim becomes fully evidenced
only after the Preprod contract, Phala CVM, and real-wallet flow are completed and their values are recorded
in `deploy/networks.json`. Until then, describe those parts as implemented but awaiting public deployment.

## Already evidenced

- Compact enforces the price, escrows shielded NIGHT, records the buyer's one-time key, and permits only
  the authorized creator to withdraw.
- A real Lace purchase completed on the local Midnight devnet without exposing wallet keys in the public
  contract arguments.
- The indexer validates provisioning against contract price, key commitment, and uploaded ciphertext.
- The indexer dispatches an 80-byte sealed key blob that the buyer can open and use to decrypt content.
- Creator and buyer fake-wallet browser smoke tests cover their UI orchestration without production-only
  shortcuts leaking into a production build.

## Release evidence still required

- Real Lace creator → buyer → unlock → creator withdrawal using the merged Lane C app.
- Preprod contract address verified through both the Midnight indexer and explorer.
- Public Phala HTTPS endpoint with a genuine TDX quote.
- QVL result `UpToDate`, pinned RTMR3 match, and `report_data = sha256(provisioning_pubkey)`.
- Re-provision test after CVM restart/redeploy.
- Demo video recorded from the verified release.

## Intentional prototype limits

- The catalog of provisioned content keys is in enclave memory. Restarting or changing the deployment
  requires creators to re-provision; encrypted content and dispatch bookkeeping can persist on the volume.
- An image or compose change may change RTMR3 and the derived provisioning key. Measurement publication
  and re-provisioning are a manual release procedure.
- The public Midnight indexer, RPC, proof server, Phala gateway, and Intel collateral service are external
  availability dependencies.
- The local indexer returns `quote_hex: "dev"`. The creator accepts it only behind an explicit local-dev
  switch; it is not evidence of TEE execution.
- Lace is the wallet proven against the local devnet. Do not claim another wallet as supported before an
  end-to-end purchase succeeds with it.
- Shielded settlement does not hide IP addresses or browser/network metadata.
- Once content is decrypted, Blindfold cannot prevent a legitimate buyer from copying it; it is not DRM.

## Demo-day recovery

- Keep two funded, DUST-ready wallets and verify them the day before.
- Keep the pinned image digest, CVM endpoint, contract address, and RTMR3 together in `deploy/networks.json`.
- Run `npm run smoke:live` before recording or presenting.
- Keep the local devnet demo ready as a fallback, but label its attestation as dev mode.
- If the indexer restarts, re-provision before accepting purchases.
- Stop paid CVMs after testing or the presentation.

## Presenter-safe wording

> Blindfold demonstrates contract-enforced shielded payment and content-key delivery through an attested
> TEE. The creator encrypts and verifies attestation in the browser, while the buyer decrypts locally. It is
> a working privacy prototype, with measurement rotation, key re-provisioning, service availability, and
> wallet compatibility still handled as explicit operational constraints rather than production guarantees.
