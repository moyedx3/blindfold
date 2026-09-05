import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

export interface Bucket {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  has(key: string): Promise<boolean>;
  list(): Promise<string[]>;
}

/** Keys are hash hex. Anything else is refused so a key can never address a path outside the dir. */
export function isValidKey(key: string): boolean {
  return key.length > 0 && key.length <= 128 && /^[0-9a-fA-F]+$/.test(key);
}

function assertKey(key: string): void {
  if (!isValidKey(key)) throw new Error('invalid bucket key');
}

export class FsBucket implements Bucket {
  private ready: Promise<void>;
  constructor(private readonly dir: string) { this.ready = mkdir(dir, { recursive: true }).then(() => undefined); }
  async put(key: string, bytes: Uint8Array): Promise<void> {
    assertKey(key); await this.ready;
    await writeFile(join(this.dir, key.toLowerCase()), bytes);
  }
  async get(key: string): Promise<Uint8Array | null> {
    if (!isValidKey(key)) return null; await this.ready;
    try { return new Uint8Array(await readFile(join(this.dir, key.toLowerCase()))); }
    catch (e: any) { if (e?.code === 'ENOENT') return null; throw e; }
  }
  async has(key: string): Promise<boolean> {
    if (!isValidKey(key)) return false; await this.ready;
    try { await access(join(this.dir, key.toLowerCase())); return true; } catch { return false; }
  }
  async list(): Promise<string[]> { await this.ready; return (await readdir(this.dir)).sort(); }
}

export class MemoryBucket implements Bucket {
  private readonly m = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array): Promise<void> { assertKey(key); this.m.set(key.toLowerCase(), new Uint8Array(bytes)); }
  async get(key: string): Promise<Uint8Array | null> { return isValidKey(key) ? (this.m.get(key.toLowerCase()) ?? null) : null; }
  async has(key: string): Promise<boolean> { return isValidKey(key) && this.m.has(key.toLowerCase()); }
  async list(): Promise<string[]> { return [...this.m.keys()].sort(); }
}
