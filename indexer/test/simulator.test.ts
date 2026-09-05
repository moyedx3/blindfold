import { describe, it, expect } from 'vitest';
import { connectTee } from '../src/dstack';
import { reportDataForPubkey } from '../src/attest';

describe.skipIf(!process.env.DSTACK_SIMULATOR_ENDPOINT)('dstack simulator', () => {
  it('derives a stable key and returns a quote', async () => {
    const tee = await connectTee({ endpoint: process.env.DSTACK_SIMULATOR_ENDPOINT });
    expect(tee.isDev).toBe(false);
    const a = await tee.getKey('blindfold/provisioning'); const b = await tee.getKey('blindfold/provisioning');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const q = await tee.getQuote(reportDataForPubkey(new Uint8Array(32)));
    expect(q.length).toBeGreaterThan(100);
  });
});
