# Lane E: bNIGHT, the shielded payment token — design

> 한 줄 요약: Preprod와 메인넷에는 shielded NIGHT가 없다. 컨트랙트가 공개 NIGHT를 5·10·50 단위로
> 받아 같은 양의 shielded 토큰(bNIGHT)을 발행하고, 구매는 bNIGHT의 zswap 지출로, 크리에이터는
> withdraw 후 unwrap으로 공개 NIGHT를 돌려받는다. UI에서는 "wrap"이라는 말 대신 **Private balance**
> 하나로 보여준다. Top up과 Buy는 별개 동작이다.

Status: approved in conversation on 2026-09-12; implementation on branch `lane-e`.

## 1. Why

The contract's `purchase` requires a shielded coin whose color is `nativeToken()`. That worked on the local
devnet only because the dev genesis seeds shielded native coins. On public networks it cannot work:

- `docs.midnight.network/tokens/overview` (current): "NIGHT is always unshielded, as are tokens minted with
  `mintUnshieldedToken`." and "There is no mechanism to move a token between shielded and unshielded
  state, shielded and unshielded tokens are distinct token types, tracked in separate pools."
- The Preprod faucet accepts only `mn_addr_preprod…` addresses ("faucet은 shielded 주소와 DUST 주소를
  거부합니다", `guides/acquire-tokens`).
- Observed 2026-09-12: Lace refuses to send unshielded NIGHT to a shielded address, and the wallet SDK's
  shielded balancer reports `InsufficientFunds` when asked to fund a shielded native output from a wallet
  that holds only unshielded NIGHT. The ledger types `{tag:'shielded'}` and `{tag:'unshielded'}` are
  distinct token types.
- The Korean translation (`docs.midnightkorea.org/tokens/overview`) still says NIGHT can move between the
  two states; that sentence is from an older revision and the English source has been rewritten.

So Blindfold must issue its own shielded token. This is the same shape as "shield, then spend" in
shield-then-spend and is the only design that also holds on mainnet.

## 2. Goals and non-goals

Goals

- A buyer who holds only public NIGHT can make a purchase whose transaction carries no wallet address.
- The buyer never sees the word "wrap"; the concept is one **Private balance**.
- Top-ups are fixed denominations (5, 10, 50 NIGHT) so amounts do not fingerprint a buyer.
- The creator gets public NIGHT back with one extra click.
- The local devnet demo takes exactly the same path as Preprod (no genesis-only shortcut).
- The indexer is untouched.

Non-goals

- Naming or metadata for bNIGHT inside Lace (it shows as a shielded token by color).
- Any token standard or transferability of bNIGHT between users outside Blindfold.
- Hiding the top-up transaction (it is public by construction).
- Partial unwrap of a single coin from the UI (cash-out takes the wallet's coins as they are).

## 3. Token model

- **Name**: `bNIGHT` in code and docs; **Private balance** in both UIs.
- **Token type**: `tokenType(pad(32, "blindfold:bNIGHT"), kernel.self())`, so the color is bound to the
  contract address. Every deployment mints its own token; a bNIGHT from another deployment is refused.
- **Backing invariant**: public NIGHT held by the contract == bNIGHT in circulation. `wrap` is the only
  increase, `unwrap` the only decrease. bNIGHT returned by `unwrap` stays inside the contract's shielded
  state forever (there is no burn primitive; a coin the contract never sends is equivalent).
- **Denominations**: `wrap` accepts exactly 5, 10, or 50 NIGHT (5 000 000, 10 000 000, 50 000 000 STAR),
  enforced in the circuit, not only in the UI. `unwrap` accepts any value.
- **Price unit**: drops are still priced in STAR; 1 bNIGHT == 1 NIGHT, so the UI keeps saying NIGHT.

## 4. Contract

`contract/src/blindfold.compact`, language 0.23, Compact 0.31.1. Existing circuits stay as they are except
the color check in `purchase`.

```compact
export ledger wrapCount: Counter;                             // nonce source for mints

circuit paymentDomain(): Bytes<32> { return pad(32, "blindfold:bNIGHT"); }
circuit paymentToken(): Bytes<32> { return tokenType(paymentDomain(), kernel.self()); }

// Public NIGHT in, the same amount of bNIGHT out, to the caller's shielded key.
export circuit wrap(amount: Uint<64>): [] {
  const a = disclose(amount);
  assert(a == 5000000 || a == 10000000 || a == 50000000, "top up 5, 10, or 50 NIGHT");
  receiveUnshielded(nativeToken(), a as Uint<128>);
  const nonce = persistentHash<Vector<2, Bytes<32>>>([
    pad(32, "blindfold:wrap:"),
    persistentHash<Uint<64>>(wrapCount.read()),
  ]);
  mintShieldedToken(paymentDomain(), a, nonce, left<ZswapCoinPublicKey, ContractAddress>(ownPublicKey()));
  wrapCount.increment(1);
}

export circuit purchase(dropId: Uint<64>, ePub: Bytes<32>, coin: ShieldedCoinInfo): [] {
  assert(drops.member(disclose(dropId)), "unknown drop");
  assert(coin.color == paymentToken(), "must pay in bNIGHT");   // was nativeToken()
  // unchanged from here
}

// bNIGHT in (kept by the contract), the same amount of public NIGHT out to `to`.
export circuit unwrap(coin: ShieldedCoinInfo, to: UserAddress): [] {
  assert(coin.color == paymentToken(), "not bNIGHT");
  receiveShielded(disclose(coin));
  sendUnshielded(nativeToken(), coin.value, right<ContractAddress, UserAddress>(disclose(to)));
}
```

Notes

- `mintShieldedToken(…, left(ownPublicKey()))` delivers the coin to the caller the same way `withdraw`'s
  `sendShielded(…, left(ownPublicKey()), …)` already does; the caller's wallet sees it because midnight-js
  builds the encrypted note for the transaction's own keys. Verified by the existing withdraw test.
- If `persistentHash<Uint<64>>` does not type-check in 0.23, the nonce falls back to hashing the counter
  as a padded byte string; the requirement is only uniqueness per mint within this contract.
- `receiveUnshielded` requires the transaction to carry an unshielded transfer of `a` STAR to the contract.
  The wallet's unshielded balancer supplies it from the caller's NIGHT UTXOs (the DApp connector balances
  unshielded imbalances; midnight-js-contracts exposes unshielded balances). This is the one integration
  the current code has never exercised, so it is the first task of the plan (devnet, headless wallet, then
  Lace).
- The received bNIGHT in `unwrap` is not inserted into any ledger map; it is intentionally unreachable.

Tests (`contract/test/flow.test.ts`, devnet): wrap 5 → purchase at price 1 → withdraw → unwrap; wrap with
7 NIGHT refused; purchase with a native-colored coin refused ("must pay in bNIGHT"); unwrap with a coin
of another color refused; backing invariant checked by reading the contract's unshielded balance before
and after (equal to outstanding bNIGHT).

## 5. Privacy properties (state these, nothing more)

- The top-up transaction is public: the buyer's unshielded address and the denomination are on chain.
- The purchase is a zswap spend of bNIGHT: no wallet address or wallet public key is a contract argument;
  what is disclosed is the drop id, the one-time X25519 key, and the coin value/color.
- The anonymity set of a purchase is everyone who topped up the same denomination and has not spent it
  in a linkable way. A top-up equal to one price immediately followed by a purchase links the two by amount
  and time; the UI says so and the demo script tops up 10 NIGHT before the creator scene, then buys later.
- `unwrap` reveals the recipient's public address and amount. Creators are public in this design.
- Network metadata (IP, browser) is out of scope, as before.

Presenter wording (replaces "Zswap shields the buyer"): "The buyer moves public NIGHT into a private balance
in fixed denominations; the purchase spends that private balance, so the chain sees a drop id and a one-time
key, not a wallet. The content key is delivered by an attested TEE."

## 6. Shared package `packages/midnight-web`

`BlindfoldClient` gains:

- `paymentTokenColor(): string` — hex color of bNIGHT for this contract, computed locally from the contract
  address and `pad(32, "blindfold:bNIGHT")` with the compact-runtime `tokenType` helper (no chain call).
- `privateBalance(): Promise<bigint>` — the wallet's shielded balance for that color, via
  `getShieldedBalances()`.
- `wrap(amountStar: bigint): Promise<{ txId: string }>` — calls `wrap`; amount must be one of
  `TOP_UP_DENOMINATIONS_STAR = [5_000_000n, 10_000_000n, 50_000_000n]` (exported).
- `unwrap(valueStar: bigint, toUnshieldedAddress: string): Promise<{ txId: string }>` — decodes the bech32m
  `mn_addr…` to 32 bytes with `UnshieldedAddress.codec.decode`, builds the `UserAddress`, calls `unwrap`.
  The client picks the caller's bNIGHT coins to cover `valueStar` the same way `purchase` picks its coin.
- `purchase` builds its coin with the bNIGHT color instead of the native color.

`FakeBlindfoldClient` mirrors all of it with an in-memory private balance so both smokes run without a
chain. `balances()` in `wallet.ts` returns `unshieldedNight`, `privateNight` (by the color passed in), and
DUST; `explainWalletError` maps "insufficient" to "Top up your private balance (5, 10, or 50 NIGHT) and make
sure you have DUST for the fee."

## 7. Buyer app `buyer/`

- Balance line after connect: `Public NIGHT 998 · Private balance 10 · DUST 3.2`.
- **Private balance** panel (above the catalog): three buttons `Top up 5`, `Top up 10`, `Top up 50` and a
  `Cash out` button. One line of copy under the buttons: "Top up enough for several purchases. Topping up
  right before you buy links the two transactions." Top up = one `wrap` call, one Lace approval, proving
  20 to 60 s, then the balance line shows "updating…" until `privateBalance()` reflects it (poll every 3 s,
  give up after 2 min with a message to press Refresh).
- **Buy** uses the private balance only. If `privateBalance() >= price` the button is `Buy` and behaves as
  today. Otherwise the button reads `Top up first` and is disabled; pressing nothing else happens. Top up
  and Buy are separate actions by decision: no automatic wrap-then-buy chain.
- `Cash out` prompts for nothing: it unwraps the whole private balance to the connected wallet's unshielded
  address. (Partial cash-out is out of scope.)
- While a top-up or cash-out is proving, Buy is disabled; errors go through `explainWalletError`.
- Fake mode: the fake connector starts with private balance 0; `Top up 5` sets it to 5 immediately. The
  Playwright smoke becomes: connect → `Top up first` shown → `Top up 5` → `Buy` → poll → unlock.

## 8. Creator app `creator/`

- Same balance line. Registration flow unchanged.
- **Private balance** panel below "Escrowed purchases": balance plus `Cash out to public NIGHT`; no top-up
  buttons. `Withdraw` still moves the escrowed bNIGHT coin to the creator's shielded key; the panel then
  shows it, and `Cash out` unwraps to the connected wallet's unshielded address (auto-filled, no address
  input).
- Playwright smoke gains: withdraw (fake) → private balance shows the amount → cash out → balance 0.

## 9. Indexer

No code change. The compiled contract artifacts change (new circuits, new ledger field), so the indexer
image must be rebuilt (the Dockerfile copies `contract/build`), which changes the image digest and,
after redeploy, RTMR3.

## 10. Scripts and docs

- `contract/test/flow.test.ts`, `indexer/test/e2e.devnet.test.ts`, `deploy/scripts/seed-demo.ts`: the
  buyer side calls `wrap(5 NIGHT)` first, then `purchase`; the genesis wallet's shielded NIGHT is no longer
  used anywhere.
- `docs/demo-script.md`: buyer scene starts with 10 public NIGHT → `Top up 10` (narrate denominations and
  why) → creator scene → buyer `Buy` → unlock → creator `Withdraw` → `Cash out`.
- `README.md`, `docs/demo-readiness.md`, `docs/guide.md`, `docs/status.md`: replace the "Zswap shields the
  buyer" sentences with section 5's wording; record the finding in a dated verification note.

## 11. Deployment and migration

1. Compile; run the devnet flow test and e2e; run both smokes.
2. Rebuild and push the indexer image with the `release-image` workflow; note the new digest.
3. `npm run deploy -w contract -- --network preprod` → new contract address; the current Preprod contract
   (`34e1bdbd…5d18`) is abandoned (Compact contracts are not upgradable).
4. Update `deploy/cvm/.env` (IMAGE digest, CONTRACT_ADDRESS); `phala deploy` from `deploy/cvm`; run
   `attest:inspect`; re-pin RTMR3 and the digest in `deploy/networks.json`; `smoke:live`.
5. Real-wallet run on Preprod (the former "step E" of the status board): buyer top-up, creator register and
   provision, buyer purchase and decrypt, creator withdraw and cash out.

## 12. Risks

- `receiveUnshielded` through the Lace DApp connector is unexercised. Mitigation: Task 1 proves it with the
  headless wallet on devnet before any UI work; if the connector cannot balance an unshielded transfer to a
  contract, the fallback is a two-step top-up (wallet sends NIGHT to the contract's unshielded address,
  contract mints against its balance) which changes the circuit, not the UX.
- `persistentHash` typing for the counter nonce (see section 4 note).
- Lace shows bNIGHT as an unnamed shielded token; users may not recognize it in the wallet. The apps are
  the intended view; the docs say so.
- Re-pinning after redeploy is a manual step; forgetting it fails `smoke:live`, which is the intended guard.

## 13. Out of scope

Buyer-to-buyer transfer of bNIGHT, partial cash-out, Lace token metadata, 1AM wallet, mainnet.
