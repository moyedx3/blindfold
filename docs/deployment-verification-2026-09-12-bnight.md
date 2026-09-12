# bNIGHT: no shielded NIGHT on public networks — finding and devnet verification

2026-09-12, local Midnight devnet (`undeployed`) only. No public-network deployment is recorded here.

## Finding

Public Midnight networks (Preprod, mainnet) have no shielded NIGHT that a wallet can spend directly. The
Lane E design spec (`docs/superpowers/specs/2026-09-12-lane-e-shielded-payment-token-design.md`, section 1)
documents this with three quotes:

1. `docs.midnight.network/tokens/overview` (current): "NIGHT is always unshielded, as are tokens minted
   with `mintUnshieldedToken`."
2. Same page: "There is no mechanism to move a token between shielded and unshielded state, shielded and
   unshielded tokens are distinct token types, tracked in separate pools."
3. `guides/acquire-tokens`: "faucet은 shielded 주소와 DUST 주소를 거부합니다" — the Preprod faucet accepts
   only `mn_addr_preprod…` addresses.

Also observed 2026-09-12 (recorded in the spec, not re-verified in this session): Lace refuses to send
unshielded NIGHT to a shielded address, and the wallet SDK's shielded balancer answers `InsufficientFunds`
when asked to fund a shielded native output from a wallet holding only unshielded NIGHT. The Korean docs
mirror (`docs.midnightkorea.org/tokens/overview`) still says NIGHT can move between the two states; that is
a stale translation — the English source has been rewritten.

This meant `purchase`'s original design (a shielded coin whose color is `nativeToken()`) worked only on the
local devnet, where the dev genesis seeds shielded native coins. It cannot work on Preprod or mainnet.

## What changed

- `contract/src/blindfold.compact`: `purchase` now requires a coin whose color is `paymentToken()`
  (`tokenType(pad(32,"blindfold:bNIGHT"), kernel.self())`), not `nativeToken()`. Two new circuits:
  `wrap(amount)` accepts exactly 5, 10, or 50 NIGHT (5000000 / 10000000 / 50000000 STAR) of public NIGHT and
  mints the same amount of bNIGHT to the caller; `unwrap(coin, to)` takes a bNIGHT coin the contract holds
  and sends the same amount of public NIGHT to `to`. A `wrapNonce: Bytes<32>` ledger field evolves on every
  mint (each mint rehashes it with the previous value) and is the mint nonce source.
- `contract/scripts/lib/providers.ts` (Task 1): `paymentColorHex` / `paymentColor` / `paymentCoin` compute
  the deployment-specific bNIGHT color; `TOP_UP_DENOMINATIONS_STAR` lists the three allowed top-up amounts.
- `packages/midnight-web` (Task 2): wrap/unwrap/`privateBalance` client calls and the bNIGHT color.
- `buyer/` (Task 3): Private balance panel — Top up 5/10/50 — and Buy gated on the private balance.
- `creator/` (Task 4): Private balance panel and Cash out to public NIGHT. Neither app's UI uses the word
  "wrap".
- `indexer/test/e2e.devnet.test.ts` (Task 5, this change): the buyer now calls `wrap(5_000_000n)` before
  `purchase`, and pays with `paymentCoin(contractAddress, PRICE)` instead of the old `nightCoin(PRICE)` — the
  e2e no longer relies on the devnet genesis wallet's shielded NIGHT.
- `contract/test/compile.test.ts` (Task 5, this change): asserts compiled artifacts for `wrap` and `unwrap`
  in addition to `createDrop`, `purchase`, `withdraw`.
- Docs (Task 5, this change): `README.md`, `docs/demo-script.md`, `docs/demo-readiness.md`, `docs/guide.md`,
  `docs/status.md` describe `wrap`/`unwrap` and the Private-balance UI, and carry the spec's section 5
  presenter wording in place of the old "Zswap shields the buyer" framing.

## Devnet evidence (this session, 2026-09-12)

- Fresh contract deployed for this verification: `npm run deploy -w contract -- --network undeployed` →
  `CONTRACT_ADDRESS=ad34c3824b960bb9861bcfc8cf6859667f6cf58dd387d3e36d5e64e7f411b0e9`.
- Task 1 evidence, re-run this session: `cd contract && DEVNET=1 npx vitest run test/flow.test.ts` →
  **11 passed** — `createDrop` record and duplicate-reject, `wrap` denomination check and mint, `purchase`
  color check and underpay-reject and escrow, `withdraw` non-owner-reject and creator payout, `unwrap` color
  check and payout.
- Task 5 evidence, this session: `cd indexer && DEVNET=1 CONTRACT_ADDRESS=<address above> npx vitest run
  test/e2e.devnet.test.ts` → **2 passed** — the pure `nextDropId` helper case, and the full devnet flow
  (`provisions a drop, takes a purchase, and dispatches K_drop through the HTTP surface`): creator registers
  a drop, buyer `wrap`s 5 NIGHT then `purchase`s paying bNIGHT, the watcher dispatches the sealed key, and
  the buyer opens exactly one blob and recovers `K_drop`.
- Local demo path: `npm run demo:local` reached `Local stack is ready.`; `npm run demo:stop` stopped it
  cleanly afterward. That run only registers a demo drop — the seeder does not call `wrap` or `purchase` —
  so it is a sanity check that the compile/devnet/deploy/indexer/seed pipeline still works, not evidence for
  the wrap/purchase/unwrap path itself.
- `npm test -w contract` (no `DEVNET`): the compile test passes, now asserting artifacts for `createDrop`,
  `purchase`, `withdraw`, `wrap`, and `unwrap`; the devnet flow suite is skipped without `DEVNET=1` (covered
  separately above).

## Limits of this evidence

Nothing in this session ran against real Lace wallets: the devnet runs above use the headless wallet SDK
(`createWallet`/`GENESIS_SEED` from `contract/scripts/lib/wallet.ts` and `network.ts`, the same helper the
flow test and e2e test use), not a browser wallet, so top-up, purchase, and cash-out have not been exercised
through Lace's DApp connector.

## Preprod redeploy (Task 7, 2026-09-12, later the same day)

- Indexer image rebuilt from this branch by the `release-image` workflow (tag 0.2.0, run 34697267055):
  `ghcr.io/moyedx3/blindfold-indexer@sha256:db48405f1d8540125c87ad3e0609ccf47f6d3ca64cbd56675277fb775523d4bb`.
- bNIGHT contract deployed to Preprod: `02170eebb6cf0da25ff32f3ac7ec31b6a11fd866d148ffc797b2895c671eaab2`
  (`npm run ledger` read through the public indexer: no drops, purchaseCount 0). The previous contract
  `34e1bdbd…5d18` is abandoned.
- The existing CVM was updated to the new digest and contract (82 s). `npm run attest:inspect`: quote
  `UpToDate`, `report_data` bound to the provisioning key, RTMR3 `c99c9a18…1541` (changed with the image, as
  expected); the provisioning public key did not change (same app id). `deploy/networks.json` re-pinned;
  `npm run smoke:live` passed against it.
- Still not done: a real Lace top-up, purchase, and cash-out against this contract (status board E-2).
