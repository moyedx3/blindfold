export type CatalogEntry = { drop_id: number; price_star: string; title: string; h_content: string };
export type ContractInfo = { network: string; contract_address: string };

export interface DropApi {
  fetchContract(): Promise<ContractInfo>;
  fetchCatalog(): Promise<CatalogEntry[]>;
  listDispatch(): Promise<string[]>;
  getDispatch(key: string): Promise<Uint8Array>;
  getContent(hContent: string): Promise<Uint8Array>;
}

export function joinUrl(base: string, path: string): string { return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`; }

export class HttpDropApi implements DropApi {
  constructor(private readonly indexerUrl: string) {}
  private async fetchOrThrow(path: string): Promise<Response> {
    try {
      return await fetch(joinUrl(this.indexerUrl, path));
    } catch {
      throw new Error(`indexer unreachable at ${this.indexerUrl} (set VITE_INDEXER_URL)`);
    }
  }
  private async json<T>(path: string): Promise<T> {
    const res = await this.fetchOrThrow(path);
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return (await res.json()) as T;
  }
  private async bytes(path: string): Promise<Uint8Array> {
    const res = await this.fetchOrThrow(path);
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  fetchContract() { return this.json<ContractInfo>('/contract'); }
  fetchCatalog() { return this.json<CatalogEntry[]>('/catalog'); }
  listDispatch() { return this.json<string[]>('/dispatch'); }
  getDispatch(key: string) { return this.bytes(`/dispatch/${key}`); }
  getContent(hContent: string) { return this.bytes(`/bucket/${hContent}`); }
}
