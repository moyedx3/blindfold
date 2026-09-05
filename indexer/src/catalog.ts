export type DropConfig = { dropId: bigint; priceStar: bigint; kDrop: Uint8Array; hContent: string; title: string };
export type CatalogEntry = { drop_id: number; price_star: string; title: string; h_content: string };

/** In-memory only, on purpose: provisioned keys live inside the enclave process and nowhere else.
 *  After a restart creators re-provision (idempotent). */
export class Catalog {
  private readonly m = new Map<bigint, DropConfig>();
  upsert(cfg: DropConfig): void { this.m.set(cfg.dropId, { ...cfg, kDrop: new Uint8Array(cfg.kDrop) }); }
  get(dropId: bigint): DropConfig | undefined { return this.m.get(dropId); }
  has(dropId: bigint): boolean { return this.m.has(dropId); }
  publicEntries(): CatalogEntry[] {
    return [...this.m.values()]
      .sort((a, b) => (a.dropId < b.dropId ? -1 : a.dropId > b.dropId ? 1 : 0))
      .map((c) => ({ drop_id: Number(c.dropId), price_star: c.priceStar.toString(), title: c.title, h_content: c.hContent }));
  }
}
