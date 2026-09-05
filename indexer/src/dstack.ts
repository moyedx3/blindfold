import { DstackClient } from '@phala/dstack-sdk';
import { fromHex } from './keys';

export interface Tee {
  readonly isDev: boolean;
  getKey(path: string): Promise<Uint8Array>;
  getQuote(reportData: Uint8Array): Promise<string>;
  measurement(): Promise<string>;
}

export type DstackLike = {
  isReachable(): Promise<boolean>;
  getKey(path: string): Promise<{ key: Uint8Array }>;
  getQuote(reportData: Uint8Array): Promise<{ quote: string }>;
  info(): Promise<any>;
};

class DstackTee implements Tee {
  readonly isDev = false;
  constructor(private readonly c: DstackLike) {}
  async getKey(path: string): Promise<Uint8Array> {
    const { key } = await this.c.getKey(path);
    if (key.length !== 32) throw new Error(`dstack key is ${key.length} bytes, expected 32`);
    return new Uint8Array(key);
  }
  async getQuote(reportData: Uint8Array): Promise<string> {
    const { quote } = await this.c.getQuote(reportData);
    return quote.replace(/^0x/, '');
  }
  async measurement(): Promise<string> {
    const info = await this.c.info();
    const tcb = typeof info.tcb_info === 'string' ? JSON.parse(info.tcb_info) : info.tcb_info;
    return tcb?.mrtd ?? tcb?.rtmr3 ?? 'unknown';
  }
}

/** Outside a CVM: the seed comes from configuration and quotes are the literal "dev". */
export class DevTee implements Tee {
  readonly isDev = true;
  private readonly seed: Uint8Array;
  constructor(seedHex: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) throw new Error('DEV_SEED_HEX must be 64 hex chars');
    this.seed = fromHex(seedHex);
  }
  async getKey(): Promise<Uint8Array> { return new Uint8Array(this.seed); }
  async getQuote(): Promise<string> { return 'dev'; }
  async measurement(): Promise<string> { return 'dev'; }
}

export async function connectTee(opts: { endpoint?: string; devSeedHex?: string; client?: DstackLike; clientFactory?: (endpoint?: string) => DstackLike } = {}): Promise<Tee> {
  let client: DstackLike | null = opts.client ?? null;
  if (!client) {
    const factory = opts.clientFactory ?? ((endpoint?: string) => new DstackClient(endpoint) as unknown as DstackLike);
    try { client = factory(opts.endpoint); } catch { client = null; }
  }
  const reachable = client ? await client.isReachable().catch(() => false) : false;
  if (reachable && opts.devSeedHex) throw new Error('refusing to start: a dev seed is set but a real TEE is reachable');
  if (reachable && client) return new DstackTee(client);
  if (opts.devSeedHex) return new DevTee(opts.devSeedHex);
  throw new Error('dstack is unreachable and no DEV_SEED_HEX is set');
}
