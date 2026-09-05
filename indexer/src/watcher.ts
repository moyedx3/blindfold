import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LedgerReader } from './chain';
import type { Engine } from './engine';

export type DispatchedState = { dispatched: Record<string, string>; pending: string[] };

export class DispatchedStore {
  constructor(private readonly file: string) {}
  async load(): Promise<DispatchedState> {
    try { return JSON.parse(await readFile(this.file, 'utf8')); }
    catch (e: any) { if (e?.code === 'ENOENT') return { dispatched: {}, pending: [] }; throw e; }
  }
  async save(s: DispatchedState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(s));
    await rename(tmp, this.file);
  }
}

export class Watcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private state: DispatchedState | null = null;
  private readonly log: (m: string) => void;
  constructor(private readonly deps: { reader: LedgerReader; engine: Engine; store: DispatchedStore; log?: (m: string) => void }) {
    this.log = deps.log ?? (() => {});
  }

  async tick(): Promise<{ dispatched: number; pending: number }> {
    this.state ??= await this.deps.store.load();
    const snap = await this.deps.reader.read();
    const todo = new Set<bigint>(this.state.pending.map(BigInt));
    for (let i = 0n; i < snap.purchaseCount; i++) if (!(i.toString() in this.state.dispatched)) todo.add(i);
    let dispatched = 0; const pending: string[] = [];
    for (const i of [...todo].sort((a, b) => (a < b ? -1 : 1))) {
      const ePub = snap.purchases.get(i); const dropId = snap.purchaseDrop.get(i);
      if (!ePub || dropId === undefined) { pending.push(i.toString()); continue; }
      const res = await this.deps.engine.dispatch(i, dropId, ePub);
      if ('key' in res) { this.state.dispatched[i.toString()] = res.key; dispatched++; this.log(`dispatched purchase ${i} (drop ${dropId}) -> ${res.key.slice(0, 12)}…`); }
      else { pending.push(i.toString()); this.log(`purchase ${i} waits for drop ${dropId} to be provisioned`); }
    }
    this.state.pending = pending;
    await this.deps.store.save(this.state);
    return { dispatched, pending: pending.length };
  }

  start(pollMs: number): void {
    const loop = async () => {
      if (this.running) return; this.running = true;
      try { await this.tick(); this.timer = setTimeout(loop, pollMs); }
      catch (e) { this.log(`watcher error: ${(e as Error).message}; retrying in 30s`); this.timer = setTimeout(loop, 30_000); }
      finally { this.running = false; }
    };
    void loop();
  }
  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
