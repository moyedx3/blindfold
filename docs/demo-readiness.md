# Demo readiness and prototype boundaries

## Accurate claim

Blindfold is designed as a real-chain, real-TEE prototype demo. The final claim becomes fully evidenced
only after the Preprod contract, Phala CVM, and real-wallet flow are completed and their values are recorded
in `deploy/networks.json`. Until then, describe those parts as implemented but awaiting public deployment.

Public Midnight networks have no shielded NIGHT, so the contract mints its own shielded token (bNIGHT)
against public NIGHT in fixed 5/10/50 NIGHT denominations. State the privacy claim precisely: "The buyer
moves public NIGHT into a private balance in fixed denominations; the purchase spends that private
balance, so the chain sees a drop id and a one-time key, not a wallet. The content key is delivered by an
attested TEE." The top-up transaction is public by construction; the anonymity set of a purchase is
everyone who topped up the same denomination and has not spent it in a linkable way.

## Already evidenced

Latest run: [2026-09-10/11 local devnet verification](deployment-verification-2026-09-11.md),
at commit `f060804e8b06024dfbbe14708a38de1b873efdc7`. This run used headless wallet SDK
transactions and dev attestation; the real Lace purchase below is earlier evidence, not a new browser
wallet test performed during this run. Public testnet and mainnet readiness remain unverified.

- Compact enforces the price, escrows shielded NIGHT, records the buyer's one-time key, and permits only
  the authorized creator to withdraw.
- A real Lace purchase completed on the local Midnight devnet without exposing wallet keys in the public
  contract arguments.
- The indexer validates provisioning against contract price, key commitment, and uploaded ciphertext.
- The indexer dispatches an 80-byte sealed key blob that the buyer can open and use to decrypt content.
- Creator and buyer fake-wallet browser smoke tests cover their UI orchestration. They run against the Vite
  dev server, so they do not prove that a production build excludes the fake-wallet and dev-attestation paths;
  those gates are `import.meta.env.DEV` checks in code, not something the test suite exercises.

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

- The creator downloads an encrypted drop recovery file before sending the registration transaction.
  Keep that file and the original creator secret backup separately. The recovery file includes the
  encrypted content and content key protected with HKDF/AES-GCM using the creator secret.
- After a provisioning failure or indexer restart, connect to the original network and contract,
  import the original creator secret if needed, and use **Restore an existing drop**. Recovery checks
  the on-chain price and key commitment, verifies the current attestation, and re-provisions without
  registering the drop again. A failed registration itself cannot be recovered this way.
- Recovery files are available only for drops created after this feature was added. Previously lost
  content keys cannot be reconstructed. If the automatic download was blocked, use **Download latest
  recovery file** before leaving the page.
- Dev attestation bypass is enforced only on the undeployed network with a loopback indexer URL.

- Keep two funded, DUST-ready wallets and verify them the day before.
- Keep the pinned image digest, CVM endpoint, contract address, and RTMR3 together in `deploy/networks.json`.
- Run `npm run smoke:live` before recording or presenting.
- Keep the local devnet demo ready as a fallback, but label its attestation as dev mode.
- If the indexer restarts, re-provision before accepting purchases.
- Stop paid CVMs after testing or the presentation.

## Presenter-safe wording

> The buyer moves public NIGHT into a private balance in fixed denominations; the purchase spends that
> private balance, so the chain sees a drop id and a one-time key, not a wallet. The content key is
> delivered by an attested TEE. The creator encrypts and verifies attestation in the browser, while the
> buyer decrypts locally. It is a working privacy prototype, with measurement rotation, key
> re-provisioning, service availability, and wallet compatibility still handled as explicit operational
> constraints rather than production guarantees.
