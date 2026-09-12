import type { BlindfoldClient, LedgerView, TxRef } from './contract';
import type { ConnectedWallet } from './wallet';

export class FakeBlindfoldClient implements BlindfoldClient {
  readonly calls: Array<Record<string, unknown>> = [];
  private readonly view: LedgerView;
  private balance: bigint;
  constructor(seed: Partial<LedgerView> = {}, private readonly onPurchase?: (index: bigint, dropId: bigint, ePub: Uint8Array) => Promise<void> | void, options: { privateBalance?: bigint } = {}) {
    this.view = { drops: new Map(), dropOwner: new Map(), kCommit: new Map(), purchaseCount: 0n, purchases: new Map(), purchaseDrop: new Map(), escrow: new Map(), ...seed };
    this.balance = options.privateBalance ?? 0n;
  }
  private tx(): TxRef { const n = Number(this.view.purchaseCount); return { txId: `fake-${n}-${Date.now()}`, blockHeight: n }; }
  paymentTokenColor(): string { return 'b1'.repeat(32); }
  async privateBalance(): Promise<bigint> { return this.balance; }
  async wrap(amountStar: bigint): Promise<TxRef> {
    this.calls.push({ method: 'wrap', amountStar });
    if (![5_000_000n, 10_000_000n, 50_000_000n].includes(amountStar)) throw new Error('top up 5, 10, or 50 NIGHT');
    this.balance += amountStar; return this.tx();
  }
  async unwrap(valueStar: bigint, to: string): Promise<TxRef> {
    this.calls.push({ method: 'unwrap', valueStar, to });
    if (valueStar > this.balance) throw new Error('insufficient private balance');
    this.balance -= valueStar; return this.tx();
  }
  async purchase(dropId: bigint, ePub: Uint8Array, price: bigint): Promise<TxRef> {
    this.calls.push({ method: 'purchase', dropId, price });
    const p = this.view.drops.get(dropId);
    if (p === undefined) throw new Error('unknown drop');
    if (price < p) throw new Error('underpaid');
    if (price > this.balance) throw new Error('insufficient private balance');
    this.balance -= price;
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
    const coin = this.view.escrow.get(idx);
    if (!coin) throw new Error('nothing escrowed');
    this.view.escrow.delete(idx); this.balance += coin.value; return this.tx();
  }
  async ledger(): Promise<LedgerView> {
    return {
      drops: new Map(this.view.drops), dropOwner: new Map(this.view.dropOwner), kCommit: new Map(this.view.kCommit),
      purchaseCount: this.view.purchaseCount, purchases: new Map(this.view.purchases), purchaseDrop: new Map(this.view.purchaseDrop),
      escrow: new Map(this.view.escrow),
    };
  }
}

export function fakeConnectedWallet(): ConnectedWallet {
  const api: any = {
    getShieldedBalances: async () => ({ ['0'.repeat(64)]: 1_000_000_000n }),
    getUnshieldedBalances: async () => ({ ['0'.repeat(64)]: 1_000_000_000n }),
    getDustBalance: async () => ({ balance: 10n ** 18n, cap: 10n ** 19n }),
    getUnshieldedAddress: async () => ({ unshieldedAddress: 'mn_addr_undeployed1fake' }),
  };
  return { name: 'fake', api, networkId: 'undeployed', indexerUri: 'http://fake', indexerWsUri: 'ws://fake', shieldedAddress: 'mn_shield-addr_undeployed1fake', coinPublicKey: '00'.repeat(32), encryptionPublicKey: '00'.repeat(32) };
}

/**
 * Injects a `window.midnight.fake` connector so the app's real `listWallets()` /
 * `connectWallet()` path (dapp-connector-api shape) can pick up a fake wallet in the browser,
 * instead of the app special-casing FAKE mode around a hand-built `ConnectedWallet`. Lets the
 * fake-wallet dev/test flow exercise the same wallet-discovery and wallet-connect code a real
 * wallet extension would go through.
 */
export function installFakeConnector(win: { midnight?: Record<string, unknown> } = globalThis as any): void {
  const fakeConnectedApi = {
    getConfiguration: async () => ({ networkId: 'undeployed', indexerUri: 'http://fake', indexerWsUri: 'ws://fake' }),
    getShieldedAddresses: async () => ({ shieldedAddress: 'mn_shield-addr_undeployed1fake', shieldedCoinPublicKey: '00'.repeat(32), shieldedEncryptionPublicKey: '00'.repeat(32) }),
    getShieldedBalances: async () => ({ ['0'.repeat(64)]: 1_000_000_000n }),
    getUnshieldedBalances: async () => ({ ['0'.repeat(64)]: 1_000_000_000n }),
    getDustBalance: async () => ({ balance: 10n ** 18n, cap: 10n ** 19n }),
    getUnshieldedAddress: async () => ({ unshieldedAddress: 'mn_addr_undeployed1fake' }),
    getConnectionStatus: async () => ({ status: 'connected' }),
  };
  win.midnight = {
    ...win.midnight,
    fake: { name: 'Fake wallet (no chain)', icon: 'data:,', apiVersion: '4.0.1', rdns: 'dev.blindfold.fake', connect: async () => fakeConnectedApi },
  };
}
