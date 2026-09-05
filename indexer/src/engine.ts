import type { Bucket } from './bucket';
import type { Catalog } from './catalog';
import { blake2b256, concat, seal, toHex, u64be } from './keys';

export const DISPATCH_BLOB_LEN = 80;

/** Bucket key for a dispatch blob: blake2b-256(ek_pub || index_be64). The buyer cannot compute it
 *  (ek_pub is the sealer's ephemeral key), so it lists and trial-opens. */
export function dispatchKey(ekPub: Uint8Array, index: bigint): string {
  return toHex(blake2b256(concat([ekPub, u64be(index)])));
}

export class Engine {
  constructor(private readonly catalog: Catalog, private readonly dispatchBucket: Bucket) {}

  async dispatch(index: bigint, dropId: bigint, ePub: Uint8Array): Promise<{ key: string } | { skipped: 'unprovisioned' }> {
    if (ePub.length !== 32) throw new Error('ePub must be 32 bytes');
    const cfg = this.catalog.get(dropId);
    if (!cfg) return { skipped: 'unprovisioned' };
    const blob = seal(cfg.kDrop, ePub);
    if (blob.length !== DISPATCH_BLOB_LEN) throw new Error(`dispatch blob is ${blob.length} bytes, expected ${DISPATCH_BLOB_LEN}`);
    const key = dispatchKey(blob.subarray(0, 32), index);
    await this.dispatchBucket.put(key, blob);
    return { key };
  }
}
