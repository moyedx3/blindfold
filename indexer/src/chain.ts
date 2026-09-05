import { WebSocket } from 'ws';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { ledger as decodeLedger } from '@blindfold/contract/contract';

if (typeof globalThis.WebSocket === 'undefined') (globalThis as any).WebSocket = WebSocket;

export type LedgerSnapshot = {
  drops: Map<bigint, bigint>;
  kCommit: Map<bigint, Uint8Array>;
  purchaseCount: bigint;
  purchases: Map<bigint, Uint8Array>;
  purchaseDrop: Map<bigint, bigint>;
};

export interface LedgerReader { read(): Promise<LedgerSnapshot> }

export class ContractNotFound extends Error {
  constructor(address: string) { super(`no contract state at ${address}`); this.name = 'ContractNotFound'; }
}

export function snapshotFromLedger(L: any): LedgerSnapshot {
  return {
    drops: new Map<bigint, bigint>([...L.drops]),
    kCommit: new Map<bigint, Uint8Array>([...L.kCommit]),
    purchaseCount: BigInt(L.purchaseCount),
    purchases: new Map<bigint, Uint8Array>([...L.purchases]),
    purchaseDrop: new Map<bigint, bigint>([...L.purchaseDrop]),
  };
}

export class StaticLedgerReader implements LedgerReader {
  constructor(private snapshot: LedgerSnapshot) {}
  set(s: LedgerSnapshot): void { this.snapshot = s; }
  async read(): Promise<LedgerSnapshot> { return this.snapshot; }
}

export type MidnightLedgerReaderOptions = { indexerUrl: string; indexerWsUrl: string; contractAddress: string; networkId: string };

export class MidnightLedgerReader implements LedgerReader {
  private readonly pdp;
  constructor(private readonly opts: MidnightLedgerReaderOptions) {
    setNetworkId(opts.networkId as any);
    this.pdp = indexerPublicDataProvider(opts.indexerUrl, opts.indexerWsUrl);
  }
  async read(): Promise<LedgerSnapshot> {
    const state = await this.pdp.queryContractState(this.opts.contractAddress);
    if (!state) throw new ContractNotFound(this.opts.contractAddress);
    return snapshotFromLedger(decodeLedger(state.data));
  }
}
