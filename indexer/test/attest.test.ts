import { describe, it, expect, beforeAll } from 'vitest';
import { buildAttestResponse, reportDataForPubkey } from '../src/attest';
import { DevTee } from '../src/dstack';
import { keypairFromSeed, sha256, sodiumReady, toHex, fromHex } from '../src/keys';

beforeAll(sodiumReady);

describe('attest', () => {
  it('report_data is sha256(pubkey) zero-padded to 64 bytes', () => {
    const kp = keypairFromSeed(fromHex('77'.repeat(32)));
    const rd = reportDataForPubkey(kp.publicKey);
    expect(rd.length).toBe(64);
    expect(toHex(rd.subarray(0, 32))).toBe(toHex(sha256(kp.publicKey)));
    expect(rd.subarray(32).every((b) => b === 0)).toBe(true);
  });
  it('response carries the pubkey and the quote for that report_data', async () => {
    const kp = keypairFromSeed(fromHex('77'.repeat(32)));
    const seen: Uint8Array[] = [];
    const tee = { isDev: false, getKey: async () => new Uint8Array(32), measurement: async () => 'm',
      getQuote: async (rd: Uint8Array) => { seen.push(rd); return 'q1'; } };
    const r = await buildAttestResponse(tee, kp);
    expect(r).toEqual({ quote_hex: 'q1', provisioning_pubkey_hex: toHex(kp.publicKey) });
    expect(toHex(seen[0])).toBe(toHex(reportDataForPubkey(kp.publicKey)));
  });
  it('DevTee yields quote "dev"', async () => {
    const kp = keypairFromSeed(fromHex('77'.repeat(32)));
    expect((await buildAttestResponse(new DevTee('77'.repeat(32)), kp)).quote_hex).toBe('dev');
  });
});
