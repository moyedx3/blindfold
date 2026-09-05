import { describe, it, expect } from 'vitest';
import { Catalog, type DropConfig } from '../src/catalog';

const cfg = (dropId: bigint, title = 't'): DropConfig => ({ dropId, priceStar: 1_000_000n, kDrop: new Uint8Array(32).fill(7), hContent: 'ab'.repeat(32), title });

describe('Catalog', () => {
  it('stores and returns configs; public view has no key', () => {
    const c = new Catalog();
    c.upsert(cfg(1n, 'one'));
    expect(c.has(1n)).toBe(true);
    expect(c.get(1n)!.title).toBe('one');
    const pub = c.publicEntries();
    expect(pub).toEqual([{ drop_id: 1, price_star: '1000000', title: 'one', h_content: 'ab'.repeat(32) }]);
    expect(JSON.stringify(pub)).not.toContain('kDrop');
  });
  it('upsert overwrites (re-provisioning is idempotent)', () => {
    const c = new Catalog();
    c.upsert(cfg(1n, 'a')); c.upsert(cfg(1n, 'b'));
    expect(c.get(1n)!.title).toBe('b');
    expect(c.publicEntries()).toHaveLength(1);
  });
  it('public entries are sorted by drop id', () => {
    const c = new Catalog(); c.upsert(cfg(5n)); c.upsert(cfg(2n));
    expect(c.publicEntries().map((e) => e.drop_id)).toEqual([2, 5]);
  });
});
