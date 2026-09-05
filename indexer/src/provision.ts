import type { Bucket } from './bucket';
import type { LedgerSnapshot } from './chain';
import type { DropConfig } from './catalog';
import { concat, fromHex, seal, sealOpen, sha256, toHex, type Keypair } from './keys';

export type ProvisionPayload = { drop_id: number; price_star: string; k_drop: string; h_content: string; title: string };
export type ProvisionErrorCode = 'bad_seal' | 'bad_payload' | 'unknown_drop' | 'price_mismatch' | 'commit_mismatch' | 'content_missing';

export class ProvisionError extends Error {
  constructor(readonly code: ProvisionErrorCode, message: string) { super(message); this.name = 'ProvisionError'; }
}

export function sealProvision(payload: ProvisionPayload, enclavePub: Uint8Array): Uint8Array {
  return seal(new TextEncoder().encode(JSON.stringify(payload)), enclavePub);
}

export function openProvision(sealed: Uint8Array, kp: Keypair): ProvisionPayload {
  const plain = sealOpen(sealed, kp);
  if (!plain) throw new ProvisionError('bad_seal', 'sealed payload does not open with the enclave key');
  let p: any;
  try { p = JSON.parse(new TextDecoder().decode(plain)); } catch { throw new ProvisionError('bad_payload', 'payload is not JSON'); }
  finally { plain.fill(0); }
  const ok = p && Number.isSafeInteger(p.drop_id) && p.drop_id >= 0
    && typeof p.price_star === 'string' && /^\d+$/.test(p.price_star)
    && typeof p.k_drop === 'string' && /^[0-9a-fA-F]{64}$/.test(p.k_drop)
    && typeof p.h_content === 'string' && /^[0-9a-fA-F]{64}$/.test(p.h_content)
    && typeof p.title === 'string' && p.title.length <= 200;
  if (!ok) throw new ProvisionError('bad_payload', 'payload fields are invalid');
  return { drop_id: p.drop_id, price_star: p.price_star, k_drop: p.k_drop.toLowerCase(), h_content: p.h_content.toLowerCase(), title: p.title };
}

/** commit = sha256(K_drop ‖ h_content_bytes), where h_content_bytes is the 32-byte content hash
 *  decoded from the hex string p.h_content (R17: the commitment binds the content, not just the key). */
export async function validateProvision(p: ProvisionPayload, ledger: LedgerSnapshot, content: Bucket): Promise<DropConfig> {
  const dropId = BigInt(p.drop_id);
  const price = ledger.drops.get(dropId);
  if (price === undefined) throw new ProvisionError('unknown_drop', `drop ${p.drop_id} is not on-chain`);
  if (price !== BigInt(p.price_star)) throw new ProvisionError('price_mismatch', `on-chain price ${price} != ${p.price_star}`);
  const kDrop = fromHex(p.k_drop);
  const commit = ledger.kCommit.get(dropId);
  const expected = sha256(concat([kDrop, fromHex(p.h_content)]));
  if (!commit || toHex(commit) !== toHex(expected)) throw new ProvisionError('commit_mismatch', 'sha256(k_drop || h_content) does not match the on-chain commitment');
  if (!(await content.has(p.h_content))) throw new ProvisionError('content_missing', `content ${p.h_content} not uploaded`);
  return { dropId, priceStar: price, kDrop, hContent: p.h_content, title: p.title };
}
