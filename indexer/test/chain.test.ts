import { describe, it, expect } from 'vitest';
import { snapshotFromLedger, StaticLedgerReader, MidnightLedgerReader, ContractNotFound } from '../src/chain';

function fakeLedger() {
  const map = <K, V>(entries: [K, V][]) => ({ [Symbol.iterator]: () => entries[Symbol.iterator]() });
  return {
    drops: map<bigint, bigint>([[1n, 5n]]),
    kCommit: map<bigint, Uint8Array>([[1n, new Uint8Array(32).fill(1)]]),
    purchaseCount: 2n,
    purchases: map<bigint, Uint8Array>([[0n, new Uint8Array(32).fill(2)], [1n, new Uint8Array(32).fill(3)]]),
    purchaseDrop: map<bigint, bigint>([[0n, 1n], [1n, 1n]]),
  };
}

describe('snapshotFromLedger', () => {
  it('converts generated ledger maps to plain Maps', () => {
    const s = snapshotFromLedger(fakeLedger());
    expect(s.drops.get(1n)).toBe(5n);
    expect(s.purchaseCount).toBe(2n);
    expect(s.purchases.get(1n)![0]).toBe(3);
    expect(s.purchaseDrop.get(0n)).toBe(1n);
  });
});

describe('StaticLedgerReader', () => {
  it('returns what it was given and can be updated', async () => {
    const r = new StaticLedgerReader(snapshotFromLedger(fakeLedger()));
    expect((await r.read()).purchaseCount).toBe(2n);
    r.set({ ...(await r.read()), purchaseCount: 3n });
    expect((await r.read()).purchaseCount).toBe(3n);
  });
});

describe.skipIf(!process.env.DEVNET)('MidnightLedgerReader (devnet)', () => {
  it('throws ContractNotFound for a random address', async () => {
    const r = new MidnightLedgerReader({ indexerUrl: 'http://127.0.0.1:8088/api/v4/graphql', indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws', contractAddress: 'ab'.repeat(32), networkId: 'undeployed' });
    await expect(r.read()).rejects.toBeInstanceOf(ContractNotFound);
  });
  it.skipIf(!process.env.CONTRACT_ADDRESS)('reads a deployed contract when CONTRACT_ADDRESS is set', async () => {
    const address = process.env.CONTRACT_ADDRESS!;
    const r = new MidnightLedgerReader({ indexerUrl: 'http://127.0.0.1:8088/api/v4/graphql', indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws', contractAddress: address, networkId: 'undeployed' });
    const s = await r.read();
    expect(typeof s.purchaseCount).toBe('bigint');
  });
});
