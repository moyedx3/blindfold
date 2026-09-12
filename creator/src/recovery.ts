import { bytesToArrayBuffer, fromHex, sha256Hex, toHex, utf8Bytes, concatBytes } from './bytes';
import { buildProvisionPayload, type ProvisionPayload } from './provision';

export type Recovery = { network: string; contractAddress: string; payload: ProvisionPayload; blobHex: string };
const VERSION = 'blindfold-drop-recovery-1';

async function recoveryKey(secret: Uint8Array): Promise<CryptoKey> {
  if (secret.length !== 32) throw new Error('recovery requires the original creator secret');
  const material = await crypto.subtle.importKey('raw', bytesToArrayBuffer(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bytesToArrayBuffer(utf8Bytes(VERSION)), info: bytesToArrayBuffer(utf8Bytes('content recovery')) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function exportRecovery(recovery: Recovery, secret: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytesToArrayBuffer(utf8Bytes(VERSION)) }, await recoveryKey(secret), bytesToArrayBuffer(utf8Bytes(JSON.stringify(recovery))));
  return JSON.stringify({ version: VERSION, iv: toHex(iv), ciphertext: toHex(new Uint8Array(encrypted)) });
}

export async function importRecovery(text: string, secret: Uint8Array, network: string, contractAddress: string): Promise<Recovery> {
  const envelope = JSON.parse(text);
  if (envelope?.version !== VERSION || typeof envelope.iv !== 'string' || !/^[a-f0-9]{24}$/.test(envelope.iv) || typeof envelope.ciphertext !== 'string') throw new Error('invalid recovery file');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytesToArrayBuffer(fromHex(envelope.iv)), additionalData: bytesToArrayBuffer(utf8Bytes(VERSION)) }, await recoveryKey(secret), bytesToArrayBuffer(fromHex(envelope.ciphertext)));
  const value = JSON.parse(new TextDecoder().decode(plain));
  if (value.network !== network || value.contractAddress !== contractAddress) throw new Error('recovery belongs to another network or contract');
  const p = value.payload;
  if (!p || typeof p.title !== 'string' || typeof p.price_star !== 'string' || !/^[1-9][0-9]*$/.test(p.price_star) || typeof value.blobHex !== 'string') throw new Error('invalid recovery payload');
  const payload = buildProvisionPayload({ dropId: p.drop_id, priceStar: BigInt(p.price_star), kDrop: fromHex(p.k_drop), hContent: p.h_content, title: p.title });
  const blob = fromHex(value.blobHex);
  if (blob.length < 28 || blob.length > 50 * 1024 * 1024 || await sha256Hex(blob) !== payload.h_content) throw new Error('recovery ciphertext hash mismatch');
  return { network, contractAddress, payload, blobHex: value.blobHex };
}

// Check the existing commitment before sending a key; recovery never registers a drop again.
export async function verifyRecoveryDrop(recovery: Recovery, ledger: { drops: Map<bigint, bigint>; kCommit: Map<bigint, Uint8Array> }): Promise<void> {
  const p = recovery.payload;
  const id = BigInt(p.drop_id);
  const expected = await sha256Hex(concatBytes([fromHex(p.k_drop), fromHex(p.h_content)]));
  const actual = ledger.kCommit.get(id);
  if (ledger.drops.get(id) !== BigInt(p.price_star) || !actual || toHex(actual) !== expected) throw new Error('recovery does not match an existing on-chain drop');
}

export function allowsDevAttestation(network: string, endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return network === 'undeployed' && ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
