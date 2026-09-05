import { describe, it, expect } from 'vitest';
import { ledgerView, nightCoin } from '../src/contract';
import { FakeBlindfoldClient } from '../src/fake';

const iter = <K, V>(e: [K, V][]) => ({ [Symbol.iterator]: () => e[Symbol.iterator]() });

describe('ledgerView', () => {
  it('converts the generated ledger object into plain Maps', () => {
    const L = {
      drops: iter([[1n, 5n]]), dropOwner: iter([[1n, new Uint8Array(32)]]), kCommit: iter([[1n, new Uint8Array(32)]]),
      purchaseCount: 1n, purchases: iter([[0n, new Uint8Array(32).fill(4)]]), purchaseDrop: iter([[0n, 1n]]),
      escrow: iter([[0n, { nonce: new Uint8Array(32), color: new Uint8Array(32), value: 5n, mt_index: 9n }]]),
    };
    const v = ledgerView(L);
    expect(v.drops.get(1n)).toBe(5n);
    expect(v.escrow.get(0n)).toEqual({ value: 5n, mt_index: 9n });
    expect(v.purchases.get(0n)![0]).toBe(4);
  });
});

describe('nightCoin', () => {
  it('has a random 32-byte nonce, zero color, and the value', () => {
    const a = nightCoin(7n), b = nightCoin(7n);
    expect(a.nonce.length).toBe(32);
    expect(a.color.every((x) => x === 0)).toBe(true);
    expect(a.value).toBe(7n);
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
  });
});

describe('FakeBlindfoldClient', () => {
  it('records purchases into its ledger view', async () => {
    const c = new FakeBlindfoldClient({ drops: new Map([[1n, 5n]]) });
    const ePub = new Uint8Array(32).fill(1);
    const tx = await c.purchase(1n, ePub, 5n);
    expect(tx.txId).toMatch(/^fake-/);
    const v = await c.ledger();
    expect(v.purchaseCount).toBe(1n);
    expect(v.purchases.get(0n)).toEqual(ePub);
    expect(c.calls).toEqual([{ method: 'purchase', dropId: 1n, price: 5n }]);
  });
  it('rejects underpaid and unknown drops like the contract', async () => {
    const c = new FakeBlindfoldClient({ drops: new Map([[1n, 5n]]) });
    await expect(c.purchase(1n, new Uint8Array(32), 4n)).rejects.toThrow(/underpaid/);
    await expect(c.purchase(2n, new Uint8Array(32), 5n)).rejects.toThrow(/unknown drop/);
  });
  it('returns a fresh copy from ledger() so callers cannot mutate its state', async () => {
    const c = new FakeBlindfoldClient({ drops: new Map([[1n, 5n]]) });
    const v = await c.ledger();
    v.drops.set(99n, 1n);
    const v2 = await c.ledger();
    expect(v2.drops.has(99n)).toBe(false);
  });
});
