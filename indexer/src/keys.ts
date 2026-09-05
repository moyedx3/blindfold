import sodium from 'libsodium-wrappers';
import { createHash } from 'node:crypto';

export type Keypair = { publicKey: Uint8Array; secretKey: Uint8Array };

let ready: Promise<void> | null = null;
export function sodiumReady(): Promise<void> { return (ready ??= sodium.ready); }

/** The 32-byte seed IS the X25519 secret key; the public key is scalarmult_base(seed).
 *  Deterministic, so a creator who provisioned stays reachable across restarts. */
export function keypairFromSeed(seed: Uint8Array): Keypair {
  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  return { publicKey: sodium.crypto_scalarmult_base(seed), secretKey: new Uint8Array(seed) };
}

export function seal(message: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  return sodium.crypto_box_seal(message, recipientPub);
}

export function sealOpen(blob: Uint8Array, kp: Keypair): Uint8Array | null {
  try { return sodium.crypto_box_seal_open(blob, kp.publicKey, kp.secretKey); } catch { return null; }
}

export function sha256(bytes: Uint8Array): Uint8Array { return new Uint8Array(createHash('sha256').update(bytes).digest()); }
export function blake2b256(bytes: Uint8Array): Uint8Array { return sodium.crypto_generichash(32, bytes); }

export function toHex(b: Uint8Array): string { return Buffer.from(b).toString('hex'); }
export function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error('invalid hex');
  return new Uint8Array(Buffer.from(h, 'hex'));
}
export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function u64be(n: bigint): Uint8Array {
  const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, n); return out;
}
