import sodium from 'libsodium-wrappers';
import type { CatalogEntry, ContractInfo, DropApi } from './api';
import { concatBytes, toHex } from './bytes';
import { encryptContent } from './content';
import { sealTo } from './seal';

/** In-process stand-in for the indexer. Used by tests and by the app when VITE_FAKE_WALLET=1. */
export class MockDropApi implements DropApi {
  readonly contractAddress = 'ff'.repeat(32);
  private readonly drops = new Map<number, { entry: CatalogEntry; kDrop: Uint8Array }>();
  private readonly content = new Map<string, Uint8Array>();
  private readonly dispatch = new Map<string, Uint8Array>();
  private counter = 0;

  async seedDrop(entry: CatalogEntry, plaintext: Uint8Array): Promise<CatalogEntry> {
    const enc = await encryptContent(plaintext);
    const full = { ...entry, h_content: enc.hContent };
    this.drops.set(entry.drop_id, { entry: full, kDrop: enc.kDrop });
    this.content.set(enc.hContent, enc.blob);
    return full;
  }
  async dispatchFor(ePub: Uint8Array, dropId: number): Promise<void> {
    const d = this.drops.get(dropId); if (!d) throw new Error('unknown drop');
    const blob = sealTo(d.kDrop, ePub);
    const idx = new Uint8Array(8); new DataView(idx.buffer).setBigUint64(0, BigInt(this.counter++));
    this.dispatch.set(toHex(sodium.crypto_generichash(32, concatBytes([blob.subarray(0, 32), idx]))), blob);
  }
  async fetchContract(): Promise<ContractInfo> { return { network: 'undeployed', contract_address: this.contractAddress }; }
  async fetchCatalog(): Promise<CatalogEntry[]> { return [...this.drops.values()].map((d) => d.entry); }
  async listDispatch(): Promise<string[]> { return [...this.dispatch.keys()]; }
  async getDispatch(key: string): Promise<Uint8Array> { const b = this.dispatch.get(key); if (!b) throw new Error('404'); return b; }
  async getContent(h: string): Promise<Uint8Array> { const b = this.content.get(h); if (!b) throw new Error('404'); return b; }

  /**
   * Test-only: overwrite the stored content bytes for `hContent` without changing the map key,
   * so a later `getContent(hContent)` returns bytes that no longer hash to `hContent`. Used to
   * exercise the poller's "content hash mismatch" guard (poller.ts).
   */
  corruptContent(hContent: string): void {
    const existing = this.content.get(hContent);
    if (!existing) throw new Error(`no content stored for ${hContent}`);
    const corrupted = new Uint8Array(existing);
    corrupted[0] ^= 0xff;
    this.content.set(hContent, corrupted);
  }
}
