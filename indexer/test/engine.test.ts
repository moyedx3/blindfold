import { describe, it, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers';
import { Catalog } from '../src/catalog';
import { MemoryBucket } from '../src/bucket';
import { Engine, dispatchKey } from '../src/engine';
import { sodiumReady, blake2b256, concat, u64be, toHex } from '../src/keys';

beforeAll(sodiumReady);

describe('Engine.dispatch', () => {
  it('seals K_drop to ePub as an 80-byte blob the buyer opens, keyed by blake2b(ek_pub||index)', async () => {
    const catalog = new Catalog();
    const kDrop = new Uint8Array(32).fill(9);
    catalog.upsert({ dropId: 1n, priceStar: 5n, kDrop, hContent: 'aa'.repeat(32), title: 't' });
    const bucket = new MemoryBucket();
    const engine = new Engine(catalog, bucket);
    const buyer = sodium.crypto_box_keypair();
    const res = await engine.dispatch(0n, 1n, buyer.publicKey);
    expect('key' in res).toBe(true);
    const blob = (await bucket.get((res as any).key))!;
    expect(blob.length).toBe(80);
    expect(toHex(sodium.crypto_box_seal_open(blob, buyer.publicKey, buyer.privateKey))).toBe(toHex(kDrop));
    expect((res as any).key).toBe(dispatchKey(blob.subarray(0, 32), 0n));
    expect((res as any).key).toBe(toHex(blake2b256(concat([blob.subarray(0, 32), u64be(0n)]))));
  });
  it('skips drops that are not provisioned', async () => {
    const engine = new Engine(new Catalog(), new MemoryBucket());
    expect(await engine.dispatch(0n, 42n, new Uint8Array(32))).toEqual({ skipped: 'unprovisioned' });
  });
  it('rejects an ePub that is not 32 bytes', async () => {
    const catalog = new Catalog();
    catalog.upsert({ dropId: 1n, priceStar: 5n, kDrop: new Uint8Array(32), hContent: 'aa'.repeat(32), title: 't' });
    await expect(new Engine(catalog, new MemoryBucket()).dispatch(0n, 1n, new Uint8Array(31))).rejects.toThrow(/ePub/);
  });
});
