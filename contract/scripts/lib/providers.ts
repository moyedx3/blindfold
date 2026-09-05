import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { NetworkConfig } from './network';
import type { WalletContext } from './wallet';

export const BUILD_DIR = path.resolve(import.meta.dirname, '..', '..', 'build', 'blindfold');
export const NATIVE_COLOR = new Uint8Array(32);

export type PrivateState = { secret: Uint8Array };

export const witnesses = {
  creatorSecret: (ctx: { privateState: PrivateState }): [PrivateState, Uint8Array] => [ctx.privateState, ctx.privateState.secret],
};

export async function loadContractModule() {
  return import(pathToFileURL(path.join(BUILD_DIR, 'contract', 'index.js')).href);
}

export async function loadCompiledContract() {
  const mod = await loadContractModule();
  return CompiledContract.make('blindfold', mod.Contract).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(BUILD_DIR),
  );
}

export function buildProviders(walletCtx: WalletContext, config: NetworkConfig, storeName = 'blindfold-scripts') {
  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };
  const zkConfigProvider = new NodeZkConfigProvider(BUILD_DIR);
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: storeName,
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      privateStoragePasswordProvider: () => process.env.PRIVATE_STATE_PASSWORD ?? 'Local-Devnet-Development-Placeholder-1',
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

export function nightCoin(value: bigint) {
  return { nonce: crypto.getRandomValues(new Uint8Array(32)), color: NATIVE_COLOR, value };
}
