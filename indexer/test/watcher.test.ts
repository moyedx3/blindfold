import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Catalog } from '../src/catalog';
import { MemoryBucket } from '../src/bucket';
import { Engine } from '../src/engine';
import { StaticLedgerReader, type LedgerSnapshot } from '../src/chain';
import { DispatchedStore, Watcher } from '../src/watcher';
import { sodiumReady } from '../src/keys';

beforeAll(sodiumReady);
const ePub = (n: number) => new Uint8Array(32).fill(n);
const snap = (purchases: [bigint, bigint][]): LedgerSnapshot => ({
  drops: new Map([[1n, 5n], [2n, 5n]]), kCommit: new Map(),
  purchaseCount: BigInt(purchases.length),
  purchases: new Map(purchases.map(([i], n) => [i, ePub(n + 1)])),
  purchaseDrop: new Map(purchases),
});
function setup() {
  const catalog = new Catalog();
  catalog.upsert({ dropId: 1n, priceStar: 5n, kDrop: new Uint8Array(32), hContent: 'aa'.repeat(32), title: 't' });
  const bucket = new MemoryBucket();
  const store = new DispatchedStore(join(mkdtempSync(join(tmpdir(), 'bf-w-')), 'dispatched.json'));
  return { catalog, bucket, store, engine: new Engine(catalog, bucket) };
}

describe('Watcher', () => {
  it('dispatches new purchases once and persists progress', async () => {
    const { bucket, store, engine } = setup();
    const reader = new StaticLedgerReader(snap([[0n, 1n], [1n, 1n]]));
    const w = new Watcher({ reader, engine, store });
    expect(await w.tick()).toEqual({ dispatched: 2, pending: 0 });
    expect((await bucket.list()).length).toBe(2);
    expect(await w.tick()).toEqual({ dispatched: 0, pending: 0 });
    const state = await store.load();
    expect(Object.keys(state.dispatched).sort()).toEqual(['0', '1']);
  });
  it('resumes from the store after a restart', async () => {
    const { bucket, store, engine } = setup();
    const reader = new StaticLedgerReader(snap([[0n, 1n]]));
    await new Watcher({ reader, engine, store }).tick();
    reader.set(snap([[0n, 1n], [1n, 1n]]));
    expect(await new Watcher({ reader, engine, store }).tick()).toEqual({ dispatched: 1, pending: 0 });
    expect((await bucket.list()).length).toBe(2);
  });
  it('keeps unprovisioned purchases pending and dispatches them once provisioned', async () => {
    const { catalog, store, engine } = setup();
    const reader = new StaticLedgerReader(snap([[0n, 2n]]));
    const w = new Watcher({ reader, engine, store });
    expect(await w.tick()).toEqual({ dispatched: 0, pending: 1 });
    catalog.upsert({ dropId: 2n, priceStar: 5n, kDrop: new Uint8Array(32).fill(3), hContent: 'bb'.repeat(32), title: 'u' });
    expect(await w.tick()).toEqual({ dispatched: 1, pending: 0 });
  });
  it('start/stop halts polling even with a tick in flight', async () => {
    const { store, engine } = setup();
    const inner = new StaticLedgerReader(snap([[0n, 1n]]));
    let reads = 0;
    const reader = { read: async () => { reads++; return inner.read(); } };
    const w = new Watcher({ reader, engine, store });
    w.start(10);
    await new Promise((r) => setTimeout(r, 60));
    w.stop();
    const readsAtStop = reads;
    expect(readsAtStop).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 60));
    expect(reads).toBeLessThanOrEqual(readsAtStop + 1);
    expect(() => w.stop()).not.toThrow();
  });
  it('a failing dispatch does not lose earlier progress', async () => {
    const { catalog, bucket, store } = setup();
    const reader = new StaticLedgerReader(snap([[0n, 1n], [1n, 1n]]));
    const failingEngine = { dispatch: async (i: bigint) => { if (i === 1n) throw new Error('boom'); return { key: 'k' + i }; } } as any;
    await new Watcher({ reader, engine: failingEngine, store }).tick();
    const state = await store.load();
    expect(state.dispatched['0']).toBe('k0');
    expect(state.dispatched['1']).toBeUndefined();

    const fixedEngine = new Engine(catalog, bucket);
    expect(await new Watcher({ reader, engine: fixedEngine, store }).tick()).toEqual({ dispatched: 1, pending: 0 });
    const state2 = await store.load();
    expect(state2.dispatched['1']).toBeDefined();
  });
  it('a stale pending entry for an already-dispatched index is not re-dispatched', async () => {
    const { store } = setup();
    await store.save({ dispatched: { '0': 'k0' }, pending: ['0'], failures: {} });
    const calls: bigint[] = [];
    const countingEngine = { dispatch: async (i: bigint) => { calls.push(i); return { key: 'should-not-happen' }; } } as any;
    const reader = new StaticLedgerReader(snap([[0n, 1n]]));
    const w = new Watcher({ reader, engine: countingEngine, store });
    expect(await w.tick()).toEqual({ dispatched: 0, pending: 0 });
    expect(calls).toEqual([]);
    const state = await store.load();
    expect(state.dispatched['0']).toBe('k0');
    expect(state.pending).toEqual([]);
  });
  it('a purchase that always fails is poisoned after 3 failures and then skipped', async () => {
    const { store } = setup();
    const reader = new StaticLedgerReader(snap([[0n, 1n]]));
    const calls: bigint[] = [];
    const alwaysFailingEngine = { dispatch: async (i: bigint) => { calls.push(i); throw new Error('boom'); } } as any;
    for (let n = 0; n < 3; n++) {
      await new Watcher({ reader, engine: alwaysFailingEngine, store }).tick();
    }
    expect(calls).toEqual([0n, 0n, 0n]);
    const state = await store.load();
    expect(state.failures['0']).toBe(3);

    calls.length = 0;
    const result = await new Watcher({ reader, engine: alwaysFailingEngine, store }).tick();
    expect(calls).toEqual([]);
    expect(result).toEqual({ dispatched: 0, pending: 0 });
    const state2 = await store.load();
    expect(state2.failures['0']).toBe(3);
  });
});
