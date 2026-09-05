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
});
