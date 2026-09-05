import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sodiumReady, keypairFromSeed, seal, sealOpen, sha256, blake2b256, toHex, fromHex, u64be, concat } from '../src/keys';

const vectors = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../docs/vectors.json'), 'utf8'));

beforeAll(sodiumReady);

describe('keys', () => {
  it('sha256 and blake2b256 match the shared vectors', () => {
    expect(toHex(sha256(fromHex(vectors.sha256.input_hex)))).toBe(vectors.sha256.output_hex);
    expect(toHex(blake2b256(fromHex(vectors.blake2b256.input_hex)))).toBe(vectors.blake2b256.output_hex);
  });
  it('u64be encodes big-endian 8 bytes', () => {
    expect(toHex(u64be(1n))).toBe(vectors.u64be.output_hex);
    expect(toHex(u64be(0x0102030405060708n))).toBe('0102030405060708');
  });
  it('keypairFromSeed is deterministic and uses the seed as the secret key', () => {
    const seed = fromHex(vectors.x25519.seed_hex);
    const a = keypairFromSeed(seed), b = keypairFromSeed(seed);
    expect(toHex(a.publicKey)).toBe(toHex(b.publicKey));
    expect(toHex(a.secretKey)).toBe(vectors.x25519.seed_hex);
    if (vectors.x25519.public_hex) expect(toHex(a.publicKey)).toBe(vectors.x25519.public_hex);
  });
  it('seal produces an 80-byte blob for a 32-byte message that only the recipient opens', () => {
    const kp = keypairFromSeed(fromHex('11'.repeat(32)));
    const other = keypairFromSeed(fromHex('22'.repeat(32)));
    const k = fromHex('ab'.repeat(32));
    const blob = seal(k, kp.publicKey);
    expect(blob.length).toBe(80);
    expect(toHex(sealOpen(blob, kp)!)).toBe(toHex(k));
    expect(sealOpen(blob, other)).toBeNull();
  });
  it('concat joins byte arrays', () => {
    expect(toHex(concat([fromHex('01'), fromHex('0203')]))).toBe('010203');
  });
});
