import { describe, it, expect } from 'vitest';
import { applyNetworkId, getNetworkId, ledgerView, nightCoin } from '../src/contract';
import { FakeBlindfoldClient } from '../src/fake';

describe('applyNetworkId', () => {
  it('sets midnight-js\'s global network id, readable back via getNetworkId', () => {
    applyNetworkId('undeployed');
    expect(getNetworkId()).toBe('undeployed');
    applyNetworkId('preview');
    expect(getNetworkId()).toBe('preview');
  });
});

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
    const c = new FakeBlindfoldClient({ drops: new Map([[1n, 5n]]) }, undefined, { privateBalance: 5n });
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

import { paymentTokenColor, paymentCoin, TOP_UP_DENOMINATIONS_STAR, PAYMENT_DOMAIN } from '../src/contract';

describe('bNIGHT helpers', () => {
  const a = 'ab'.repeat(32);
  const b = 'cd'.repeat(32);
  it('domain separator is blindfold:bNIGHT zero-padded to 32 bytes', () => {
    expect(PAYMENT_DOMAIN.length).toBe(32);
    expect(new TextDecoder().decode(PAYMENT_DOMAIN.subarray(0, 16))).toBe('blindfold:bNIGHT');
    expect([...PAYMENT_DOMAIN.subarray(16)].every((x) => x === 0)).toBe(true);
  });
  it('color is 64 hex, deterministic, and bound to the contract address', () => {
    expect(paymentTokenColor(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(paymentTokenColor(a)).toBe(paymentTokenColor(a));
    expect(paymentTokenColor(a)).not.toBe(paymentTokenColor(b));
    expect(paymentTokenColor(a)).not.toBe('0'.repeat(64));
  });
  it('paymentCoin carries that color and a fresh nonce', () => {
    const c1 = paymentCoin(a, 5n); const c2 = paymentCoin(a, 5n);
    expect(Buffer.from(c1.color).toString('hex')).toBe(paymentTokenColor(a));
    expect(Buffer.from(c1.nonce).equals(Buffer.from(c2.nonce))).toBe(false);
    expect(c1.value).toBe(5n);
  });
  it('denominations are 5, 10, 50 NIGHT', () => {
    expect(TOP_UP_DENOMINATIONS_STAR).toEqual([5_000_000n, 10_000_000n, 50_000_000n]);
  });
});
