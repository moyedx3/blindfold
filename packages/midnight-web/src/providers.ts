import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { CostModel, Transaction, type Binding, type Proof, type SignatureEnabled } from '@midnight-ntwrk/ledger-v8';
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

export type ProvingChoice = { kind: 'http'; url: string } | { kind: 'wallet' };

/**
 * Who proves the DApp's circuit calls.
 * 1. An explicit `proofServerUrl` (the app's VITE_PROOF_SERVER_URL) always wins: the local proof server
 *    is the path verified with Lace on the devnet.
 * 2. Otherwise, if the wallet implements `getProvingProvider` (the DApp Connector's current API; 1AM
 *    proves in the wallet and needs no proof server), delegate proving to the wallet.
 * 3. Otherwise the wallet's deprecated `proverServerUri`, then the local default.
 */
export function chooseProving(wallet: { proverServerUri?: string; hasWalletProving: boolean }, opts: { proofServerUrl?: string; proofServerFallback?: string }): ProvingChoice {
  if (opts.proofServerUrl) return { kind: 'http', url: opts.proofServerUrl };
  if (wallet.hasWalletProving) return { kind: 'wallet' };
  return { kind: 'http', url: wallet.proverServerUri || opts.proofServerFallback || 'http://localhost:6300' };
}

export async function buildProviders(w: ConnectedWallet, opts: { zkAssetsUrl: string; storeName: string; proofServerUrl?: string; proofServerFallback?: string }): Promise<BlindfoldProviders> {
  const zkConfigProvider = new FetchZkConfigProvider<'createDrop' | 'purchase' | 'withdraw' | 'wrap' | 'unwrap'>(opts.zkAssetsUrl, fetch.bind(globalThis));
  const choice = chooseProving({ proverServerUri: w.proverServerUri, hasWalletProving: typeof (w.api as any).getProvingProvider === 'function' }, opts);
  let proofProvider: any;
  if (choice.kind === 'wallet') {
    console.info('[blindfold] proving: delegated to the wallet (getProvingProvider)');
    const provingProvider = await (w.api as any).getProvingProvider(zkConfigProvider);
    // Call the ledger's prove() directly with the initial cost model; midnight-js's createProofProvider
    // wrapper does not pass the cost model the way wallet provers expect.
    proofProvider = { proveTx: async (unprovenTx: any) => unprovenTx.prove(provingProvider, CostModel.initialCostModel()) };
  } else {
    console.info(`[blindfold] proving: proof server ${choice.url}`);
    proofProvider = httpClientProofProvider(choice.url, zkConfigProvider);
  }
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
