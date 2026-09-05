// THROWAWAY: non-interactive storeMessage call on the deployed hello-world to isolate env vs contract issues.
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
// @ts-expect-error polyfill
globalThis.WebSocket = WebSocket;
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { resolveNetwork, GENESIS_SEED, getDeployment } from './network';
import { createWallet, persistWalletState } from './wallet';
const { network, config } = resolveNetwork();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zk = path.resolve(__dirname, '..', 'contracts', 'managed', 'hello-world');
const Hello = await import(pathToFileURL(path.join(zk, 'contract', 'index.js')).href);
const compiled = CompiledContract.make('hello-world', Hello.Contract).pipe(CompiledContract.withVacantWitnesses, CompiledContract.withCompiledFileAssets(zk));
const w = await createWallet({ network, networkConfig: config, seed: GENESIS_SEED });
await w.wallet.waitForSyncedState(); await persistWalletState(network, w);
const wp = { getCoinPublicKey: () => w.shieldedSecretKeys.coinPublicKey, getEncryptionPublicKey: () => w.shieldedSecretKeys.encryptionPublicKey,
  async balanceTx(tx: any, ttl?: Date) { const r = await w.wallet.balanceUnboundTransaction(tx, { shieldedSecretKeys: w.shieldedSecretKeys, dustSecretKey: w.dustSecretKey }, { ttl: ttl ?? new Date(Date.now() + 1800000) }); return w.wallet.finalizeRecipe(r); },
  submitTx: (tx: any) => w.wallet.submitTransaction(tx) as any };
const zkp = new NodeZkConfigProvider(zk);
const providers = { privateStateProvider: levelPrivateStateProvider({ privateStateStoreName: 'hello-world-state', accountId: w.unshieldedKeystore.getBech32Address().toString(), privateStoragePasswordProvider: () => 'Local-Devnet-Development-Placeholder-1' }),
  publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS), zkConfigProvider: zkp, proofProvider: httpClientProofProvider(config.proofServer, zkp), walletProvider: wp, midnightProvider: wp };
const dep = getDeployment(network)!;
const d: any = await findDeployedContract(providers, { compiledContract: compiled as any, contractAddress: dep.address, privateStateId: 'helloWorldPrivateState', initialPrivateState: {} });
console.log('calling storeMessage...');
const tx = await d.callTx.storeMessage('spike-check');
console.log('OK storeMessage tx', tx.public.txId);
await w.wallet.stop();
