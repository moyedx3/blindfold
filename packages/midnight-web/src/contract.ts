import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { rawTokenType } from '@midnight-ntwrk/ledger-v8';
import { CompactTypeBytes, CompactTypeVector, persistentHash } from '@midnight-ntwrk/compact-runtime';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as Blindfold from '@blindfold/contract/contract';
import type { ConnectedWallet } from './wallet';

export { getNetworkId, setNetworkId };

/**
 * Sets midnight-js's process-global network id. Both `connectContract` and `readLedger` call
 * this before touching any wallet/contract/indexer provider — none of those work until
 * `setNetworkId` has run at least once (they throw "Network ID has not been configured").
 * Exported standalone so it's easy to unit-test without stubbing the rest of midnight-js.
 */
export function applyNetworkId(networkId: string): void {
  setNetworkId(networkId as any);
}

export type LedgerView = {
  drops: Map<bigint, bigint>; dropOwner: Map<bigint, Uint8Array>; kCommit: Map<bigint, Uint8Array>;
  purchaseCount: bigint; purchases: Map<bigint, Uint8Array>; purchaseDrop: Map<bigint, bigint>;
  escrow: Map<bigint, { value: bigint; mt_index: bigint }>;
};
export type TxRef = { txId: string; blockHeight: number };
export interface BlindfoldClient {
  purchase(dropId: bigint, ePub: Uint8Array, price: bigint): Promise<TxRef>;
  createDrop(dropId: bigint, price: bigint, commit: Uint8Array): Promise<TxRef>;
  withdraw(idx: bigint): Promise<TxRef>;
  wrap(amountStar: bigint): Promise<TxRef>;
  unwrap(valueStar: bigint, toUnshieldedAddress: string): Promise<TxRef>;
  privateBalance(): Promise<bigint>;
  paymentTokenColor(): string;
  ledger(): Promise<LedgerView>;
}

export function ledgerView(L: any): LedgerView {
  return {
    drops: new Map([...L.drops]), dropOwner: new Map([...L.dropOwner]), kCommit: new Map([...L.kCommit]),
    purchaseCount: BigInt(L.purchaseCount), purchases: new Map([...L.purchases]), purchaseDrop: new Map([...L.purchaseDrop]),
    escrow: new Map([...L.escrow].map(([k, v]: [bigint, any]) => [k, { value: BigInt(v.value), mt_index: BigInt(v.mt_index) }])),
  };
}

export function nightCoin(value: bigint) {
  return { nonce: crypto.getRandomValues(new Uint8Array(32)), color: new Uint8Array(32), value };
}

// Must equal the Compact side: pad(32, "blindfold:bNIGHT").
export const PAYMENT_DOMAIN: Uint8Array = (() => { const out = new Uint8Array(32); out.set(new TextEncoder().encode('blindfold:bNIGHT')); return out; })();
export const TOP_UP_DENOMINATIONS_STAR: readonly bigint[] = [5_000_000n, 10_000_000n, 50_000_000n];
const hexToBytes = (h: string) => new Uint8Array((h.replace(/^0x/, '').match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));

/** Hex color of the bNIGHT minted by the contract at `contractAddress` (ledger `tokenType(domainSep, contract)`). */
const CREATOR_DOMAIN: Uint8Array = (() => { const out = new Uint8Array(32); out.set(new TextEncoder().encode('blindfold:creator:')); return out; })();
const CREATOR_PK_TYPE = new CompactTypeVector(2, new CompactTypeBytes(32));

/** Mirrors the contract's `creatorPk(sk)`: persistentHash([pad(32, "blindfold:creator:"), sk]). */
export function creatorPk(secret: Uint8Array): Uint8Array {
  if (secret.length !== 32) throw new Error('creator secret must be 32 bytes');
  return persistentHash(CREATOR_PK_TYPE, [CREATOR_DOMAIN, secret]);
}

/** Drop ids whose on-chain `dropOwner` is the key derived from `secret` — the creator's drops on any device. */
export function ownedDropIds(view: LedgerView, secret: Uint8Array): bigint[] {
  const pk = creatorPk(secret);
  const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
  return [...view.dropOwner].filter(([, owner]) => same(owner, pk)).map(([id]) => id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function paymentTokenColor(contractAddress: string): string {
  return rawTokenType(PAYMENT_DOMAIN, contractAddress).replace(/^0x/, '').toLowerCase();
}
/** A fresh bNIGHT coin description for `purchase` / `unwrap`; the wallet funds it from the caller's bNIGHT. */
export function paymentCoin(contractAddress: string, value: bigint) {
  return { nonce: crypto.getRandomValues(new Uint8Array(32)), color: hexToBytes(paymentTokenColor(contractAddress)), value };
}

function userAddressBytes(networkId: string, bech32: string): Uint8Array {
  return new Uint8Array(UnshieldedAddress.codec.decode(networkId, MidnightBech32m.parse(bech32)).data);
}

export async function readLedger(indexerUri: string, indexerWsUri: string, contractAddress: string, networkId: string): Promise<LedgerView> {
  applyNetworkId(networkId);
  const state = await indexerPublicDataProvider(indexerUri, indexerWsUri).queryContractState(contractAddress);
  if (!state) throw new Error(`no contract at ${contractAddress}`);
  return ledgerView(Blindfold.ledger(state.data));
}

type PS = { secret: Uint8Array };
const witnesses = { creatorSecret: (ctx: { privateState: PS }): [PS, Uint8Array] => [ctx.privateState, ctx.privateState.secret] };

export async function connectContract(providers: any, contractAddress: string, secret: Uint8Array, privateStateId: string, networkId: string, zkAssetsPath = '/contract/blindfold', wallet?: ConnectedWallet): Promise<BlindfoldClient> {
  applyNetworkId(networkId);
  const compiled = CompiledContract.make<any>('blindfold', Blindfold.Contract).pipe(
    CompiledContract.withWitnesses(witnesses), CompiledContract.withCompiledFileAssets(zkAssetsPath),
  );
  const found: any = await findDeployedContract(providers, { compiledContract: compiled, contractAddress, privateStateId, initialPrivateState: { secret } });
  const ref = (tx: any): TxRef => ({ txId: tx.public.txId, blockHeight: Number(tx.public.blockHeight) });
  const color = paymentTokenColor(contractAddress);
  return {
    purchase: async (dropId, ePub, price) => ref(await found.callTx.purchase(dropId, ePub, paymentCoin(contractAddress, price))),
    createDrop: async (dropId, price, commit) => ref(await found.callTx.createDrop(dropId, price, commit)),
    withdraw: async (idx) => ref(await found.callTx.withdraw(idx)),
    wrap: async (amountStar) => {
      if (!TOP_UP_DENOMINATIONS_STAR.includes(amountStar)) throw new Error('top up 5, 10, or 50 NIGHT');
      return ref(await found.callTx.wrap(amountStar));
    },
    unwrap: async (valueStar, to) => ref(await found.callTx.unwrap(paymentCoin(contractAddress, valueStar), { bytes: userAddressBytes(networkId, to) })),
    privateBalance: async () => {
      if (!wallet) throw new Error('privateBalance needs the connected wallet');
      return (await wallet.api.getShieldedBalances())[color] ?? 0n;
    },
    paymentTokenColor: () => color,
    ledger: async () => {
      const s = await providers.publicDataProvider.queryContractState(contractAddress);
      if (!s) throw new Error(`no contract at ${contractAddress}`);
      return ledgerView(Blindfold.ledger(s.data));
    },
  };
}
