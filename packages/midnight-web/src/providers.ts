import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { Transaction, type Binding, type Proof, type SignatureEnabled } from '@midnight-ntwrk/ledger-v8';
import type { ConnectedWallet } from './wallet';

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array((h.replace(/^0x/, '').match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));

export type BlindfoldProviders = any; // MidnightProviders<'createDrop' | 'purchase' | 'withdraw' | 'wrap' | 'unwrap'>

export function withPostBlockUpdate<P extends { queryZSwapAndContractState: (...a: any[]) => Promise<any> }>(raw: P): P {
  return {
    ...raw,
    async queryZSwapAndContractState(...args: any[]) {
      const result = await raw.queryZSwapAndContractState(...args);
      if (!result) return result;
      const [zswapChainState, contractState, ledgerParameters] = result;
      return [zswapChainState.postBlockUpdate(new Date()), contractState, ledgerParameters];
    },
  } as P;
}

export async function buildProviders(w: ConnectedWallet, opts: { zkAssetsUrl: string; storeName: string; proofServerFallback?: string }): Promise<BlindfoldProviders> {
  const zkConfigProvider = new FetchZkConfigProvider<'createDrop' | 'purchase' | 'withdraw' | 'wrap' | 'unwrap'>(opts.zkAssetsUrl, fetch.bind(globalThis));
  const proofServer = w.proverServerUri ?? opts.proofServerFallback ?? 'http://localhost:6300';
  const proofProvider = httpClientProofProvider(proofServer, zkConfigProvider);
  const walletProvider = {
    getCoinPublicKey: () => w.coinPublicKey,
    getEncryptionPublicKey: () => w.encryptionPublicKey,
    async balanceTx(tx: any) {
      const result = await w.api.balanceUnsealedTransaction(toHex(tx.serialize()));
      return Transaction.deserialize('signature', 'proof', 'binding', fromHex(result.tx)) as Transaction<SignatureEnabled, Proof, Binding>;
    },
  };
  const midnightProvider = {
    async submitTx(tx: any): Promise<string> {
      await w.api.submitTransaction(toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
  };
  return {
    privateStateProvider: levelPrivateStateProvider({ privateStateStoreName: opts.storeName, accountId: w.shieldedAddress, privateStoragePasswordProvider: () => 'blindfold-browser-private-state-1' }),
    publicDataProvider: withPostBlockUpdate(indexerPublicDataProvider(w.indexerUri, w.indexerWsUri)),
    zkConfigProvider, proofProvider, walletProvider, midnightProvider,
  };
}
