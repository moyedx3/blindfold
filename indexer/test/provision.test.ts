import { describe, it, expect, beforeAll } from 'vitest';
import { MemoryBucket } from '../src/bucket';
import { keypairFromSeed, sodiumReady, sha256, toHex, fromHex } from '../src/keys';
import { openProvision, validateProvision, sealProvision, ProvisionError, type ProvisionPayload } from '../src/provision';
import type { LedgerSnapshot } from '../src/chain';

beforeAll(sodiumReady);
const kp = keypairFromSeed(fromHex('33'.repeat(32)));
const kDrop = fromHex('44'.repeat(32));
const hContent = 'ab'.repeat(32);
const payload: ProvisionPayload = { drop_id: 1, price_star: '1000000', k_drop: toHex(kDrop), h_content: hContent, title: 'cat' };
const ledger = (over: Partial<LedgerSnapshot> = {}): LedgerSnapshot => ({
  drops: new Map([[1n, 1_000_000n]]), kCommit: new Map([[1n, sha256(kDrop)]]),
  purchaseCount: 0n, purchases: new Map(), purchaseDrop: new Map(), ...over,
});
async function contentBucket() { const b = new MemoryBucket(); await b.put(hContent, new Uint8Array(40)); return b; }
const codeOf = (e: unknown) => (e as ProvisionError).code;

describe('openProvision', () => {
  it('opens a payload sealed to the enclave key', () => {
    expect(openProvision(sealProvision(payload, kp.publicKey), kp)).toEqual(payload);
  });
  it('rejects a payload sealed to another key', () => {
    const other = keypairFromSeed(fromHex('55'.repeat(32)));
    expect(() => openProvision(sealProvision(payload, other.publicKey), kp)).toThrow(ProvisionError);
    try { openProvision(sealProvision(payload, other.publicKey), kp); } catch (e) { expect(codeOf(e)).toBe('bad_seal'); }
  });
  it('rejects malformed JSON and bad fields', () => {
    const bad = sealProvision({ ...payload, k_drop: 'zz' }, kp.publicKey);
    try { openProvision(bad, kp); expect.unreachable(); } catch (e) { expect(codeOf(e)).toBe('bad_payload'); }
  });
});

describe('validateProvision', () => {
  it('accepts a matching drop and returns the config', async () => {
    const cfg = await validateProvision(payload, ledger(), await contentBucket());
    expect(cfg).toEqual({ dropId: 1n, priceStar: 1_000_000n, kDrop, hContent, title: 'cat' });
  });
  it('rejects an unknown drop', async () => {
    await expect(validateProvision(payload, ledger({ drops: new Map() }), await contentBucket())).rejects.toMatchObject({ code: 'unknown_drop' });
  });
  it('rejects a price mismatch', async () => {
    await expect(validateProvision(payload, ledger({ drops: new Map([[1n, 2n]]) }), await contentBucket())).rejects.toMatchObject({ code: 'price_mismatch' });
  });
  it('rejects a commitment mismatch', async () => {
    await expect(validateProvision(payload, ledger({ kCommit: new Map([[1n, new Uint8Array(32)]]) }), await contentBucket())).rejects.toMatchObject({ code: 'commit_mismatch' });
  });
  it('rejects when the content blob is not uploaded', async () => {
    await expect(validateProvision(payload, ledger(), new MemoryBucket())).rejects.toMatchObject({ code: 'content_missing' });
  });
});
