import type { BlindfoldClient, LedgerView, TxRef } from './contract';
import type { ConnectedWallet } from './wallet';

export class FakeBlindfoldClient implements BlindfoldClient {
  readonly calls: Array<Record<string, unknown>> = [];
  private readonly view: LedgerView;
  constructor(seed: Partial<LedgerView> = {}, private readonly onPurchase?: (index: bigint, dropId: bigint, ePub: Uint8Array) => Promise<void> | void) {
    this.view = { drops: new Map(), dropOwner: new Map(), kCommit: new Map(), purchaseCount: 0n, purchases: new Map(), purchaseDrop: new Map(), escrow: new Map(), ...seed };
  }
  private tx(): TxRef { const n = Number(this.view.purchaseCount); return { txId: `fake-${n}-${Date.now()}`, blockHeight: n }; }
  async purchase(dropId: bigint, ePub: Uint8Array, price: bigint): Promise<TxRef> {
    this.calls.push({ method: 'purchase', dropId, price });
    const p = this.view.drops.get(dropId);
    if (p === undefined) throw new Error('unknown drop');
    if (price < p) throw new Error('underpaid');
    const i = this.view.purchaseCount;
    this.view.purchases.set(i, ePub); this.view.purchaseDrop.set(i, dropId); this.view.escrow.set(i, { value: price, mt_index: i });
    this.view.purchaseCount = i + 1n;
    await this.onPurchase?.(i, dropId, ePub);
    return this.tx();
  }
  async createDrop(dropId: bigint, price: bigint, commit: Uint8Array): Promise<TxRef> {
    this.calls.push({ method: 'createDrop', dropId, price });
    if (this.view.drops.has(dropId)) throw new Error('drop already exists');
    this.view.drops.set(dropId, price); this.view.kCommit.set(dropId, commit); this.view.dropOwner.set(dropId, new Uint8Array(32).fill(1));
    return this.tx();
  }
  async withdraw(idx: bigint): Promise<TxRef> {
    this.calls.push({ method: 'withdraw', idx });
    if (!this.view.escrow.has(idx)) throw new Error('nothing escrowed');
    this.view.escrow.delete(idx); return this.tx();
  }
  async ledger(): Promise<LedgerView> { return this.view; }
}

export function fakeConnectedWallet(): ConnectedWallet {
  const api: any = {
    getShieldedBalances: async () => ({ ['0'.repeat(64)]: 1_000_000_000n }),
    getUnshieldedBalances: async () => ({ ['0'.repeat(64)]: 1_000_000_000n }),
    getDustBalance: async () => ({ balance: 10n ** 18n, cap: 10n ** 19n }),
  };
  return { name: 'fake', api, networkId: 'undeployed', indexerUri: 'http://fake', indexerWsUri: 'ws://fake', shieldedAddress: 'mn_shield-addr_undeployed1fake', coinPublicKey: '00'.repeat(32), encryptionPublicKey: '00'.repeat(32) };
}
