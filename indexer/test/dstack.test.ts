import { describe, it, expect } from 'vitest';
import { connectTee, DevTee } from '../src/dstack';

const seedHex = '66'.repeat(32);
const fake = (reachable: boolean) => ({
  isReachable: async () => reachable,
  getKey: async () => ({ key: new Uint8Array(32).fill(1) }),
  getQuote: async () => ({ quote: 'aabb' }),
  info: async () => ({ tcb_info: { mrtd: 'cc'.repeat(48) } }),
});

describe('connectTee', () => {
  it('uses the real client when reachable and no dev seed is set', async () => {
    const tee = await connectTee({ client: fake(true) });
    expect(tee.isDev).toBe(false);
    expect((await tee.getKey('blindfold/provisioning')).length).toBe(32);
    expect(await tee.getQuote(new Uint8Array(64))).toBe('aabb');
  });
  it('refuses a dev seed when a real TEE is reachable', async () => {
    await expect(connectTee({ client: fake(true), devSeedHex: seedHex })).rejects.toThrow(/dev seed/);
  });
  it('falls back to DevTee when unreachable and a dev seed is set', async () => {
    const tee = await connectTee({ client: fake(false), devSeedHex: seedHex });
    expect(tee.isDev).toBe(true);
    expect(Buffer.from(await tee.getKey('x')).toString('hex')).toBe(seedHex);
    expect(await tee.getQuote(new Uint8Array(64))).toBe('dev');
  });
  it('fails when unreachable and no dev seed', async () => {
    await expect(connectTee({ client: fake(false) })).rejects.toThrow(/unreachable/);
  });
  it('DevTee rejects a non-32-byte seed', () => {
    expect(() => new DevTee('abcd')).toThrow(/64 hex/);
  });
  it('treats a throwing isReachable as unreachable', async () => {
    const throwing = { ...fake(false), isReachable: async () => { throw new Error('network down'); } };
    const tee = await connectTee({ client: throwing, devSeedHex: seedHex });
    expect(tee.isDev).toBe(true);
  });
  it('falls back to DevTee when the client constructor throws', async () => {
    const tee = await connectTee({ clientFactory: () => { throw new Error('no socket'); }, devSeedHex: seedHex });
    expect(tee.isDev).toBe(true);
  });
  it('fails when the client constructor throws and no dev seed is set', async () => {
    await expect(connectTee({ clientFactory: () => { throw new Error('no socket'); } })).rejects.toThrow(/unreachable/);
  });
});
