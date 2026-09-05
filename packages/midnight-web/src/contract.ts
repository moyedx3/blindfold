import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import * as Blindfold from '@blindfold/contract/contract';

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

export async function readLedger(indexerUri: string, indexerWsUri: string, contractAddress: string, networkId: string): Promise<LedgerView> {
  applyNetworkId(networkId);
  const state = await indexerPublicDataProvider(indexerUri, indexerWsUri).queryContractState(contractAddress);
  if (!state) throw new Error(`no contract at ${contractAddress}`);
  return ledgerView(Blindfold.ledger(state.data));
}

type PS = { secret: Uint8Array };
const witnesses = { creatorSecret: (ctx: { privateState: PS }): [PS, Uint8Array] => [ctx.privateState, ctx.privateState.secret] };

export async function connectContract(providers: any, contractAddress: string, secret: Uint8Array, privateStateId: string, networkId: string, zkAssetsPath = '/contract/blindfold'): Promise<BlindfoldClient> {
  applyNetworkId(networkId);
  const compiled = CompiledContract.make<any>('blindfold', Blindfold.Contract).pipe(
    CompiledContract.withWitnesses(witnesses), CompiledContract.withCompiledFileAssets(zkAssetsPath),
  );
  const found: any = await findDeployedContract(providers, { compiledContract: compiled, contractAddress, privateStateId, initialPrivateState: { secret } });
  const ref = (tx: any): TxRef => ({ txId: tx.public.txId, blockHeight: Number(tx.public.blockHeight) });
  return {
    purchase: async (dropId, ePub, price) => ref(await found.callTx.purchase(dropId, ePub, nightCoin(price))),
    createDrop: async (dropId, price, commit) => ref(await found.callTx.createDrop(dropId, price, commit)),
    withdraw: async (idx) => ref(await found.callTx.withdraw(idx)),
    ledger: async () => {
      const s = await providers.publicDataProvider.queryContractState(contractAddress);
      if (!s) throw new Error(`no contract at ${contractAddress}`);
      return ledgerView(Blindfold.ledger(s.data));
    },
  };
}
