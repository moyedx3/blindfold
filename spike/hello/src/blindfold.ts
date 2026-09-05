// THROWAWAY spike: deploy blindfold.compact on the local devnet and run
// createDrop -> purchase (shielded NIGHT) -> read purchases -> withdraw,
// all from the genesis wallet via the wallet SDK (no browser yet).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
// @ts-expect-error polyfill
globalThis.WebSocket = WebSocket;

import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { resolveNetwork, GENESIS_SEED } from './network';
import { createWallet, persistWalletState } from './wallet';

const NATIVE = '0000000000000000000000000000000000000000000000000000000000000000';
const PRICE = 1_000_000n; // 1 NIGHT in STAR
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? hex(x) : x));
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const { network, config } = resolveNetwork();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'blindfold');
const Blindfold = await import(pathToFileURL(path.join(zkConfigPath, 'contract', 'index.js')).href);

type PS = { secret: Uint8Array };
const witnesses = {
  creatorSecret: (ctx: { privateState: PS }): [PS, Uint8Array] => [ctx.privateState, ctx.privateState.secret],
};
const compiledContract = CompiledContract.make('blindfold', Blindfold.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

const walletCtx = await createWallet({ network, networkConfig: config, seed: GENESIS_SEED });
const synced = await walletCtx.wallet.waitForSyncedState();
await persistWalletState(network, walletCtx);
const shieldedNight = (s: any) => (s.shielded.balances[NATIVE] ?? 0n) as bigint;
log('shielded NIGHT (STAR) before:', shieldedNight(synced).toString(), 'dust:', synced.dust.balance(new Date()).toString());

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
const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
const providers = {
  privateStateProvider: levelPrivateStateProvider({
    privateStateStoreName: 'blindfold-spike-state',
    accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
    privateStoragePasswordProvider: () => 'Local-Devnet-Development-Placeholder-1',
  }),
  publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
  zkConfigProvider,
  proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
  walletProvider,
  midnightProvider: walletProvider,
};

const creatorSecret = randomBytes(32);
log('deploying blindfold...');
const deployed: any = await deployContract(providers, {
  compiledContract: compiledContract as any,
  args: [],
  privateStateId: 'blindfoldSpike-' + Date.now(),
  initialPrivateState: { secret: creatorSecret },
});
const addr = deployed.deployTxData.public.contractAddress as string;
log('deployed at', addr);

async function readLedger() {
  const cs = await providers.publicDataProvider.queryContractState(addr);
  return Blindfold.ledger(cs!.data);
}

// 1) creator registers drop 1 at PRICE
log('createDrop(1, PRICE)...');
const tx1 = await deployed.callTx.createDrop(1n, PRICE);
log('createDrop tx', tx1.public.txId, 'block', tx1.public.blockHeight);
let L = await readLedger();
log('drops:', json([...L.drops]), 'owner:', json([...L.dropOwner]));

// 2) buyer purchases with a fresh one-time key and a shielded NIGHT coin
const ePub = randomBytes(32);
const coin = { nonce: randomBytes(32), color: Buffer.from(NATIVE, 'hex'), value: PRICE };
log('purchase(1, ePub, coin) ePub=', hex(ePub));
const tx2 = await deployed.callTx.purchase(1n, ePub, coin);
log('purchase tx', tx2.public.txId, 'block', tx2.public.blockHeight);
const afterBuy = await walletCtx.wallet.waitForSyncedState();
log('shielded NIGHT after purchase:', shieldedNight(afterBuy).toString());
L = await readLedger();
log('purchaseCount:', L.purchaseCount.toString());
log('purchases:', json([...L.purchases]));
log('purchaseDrop:', json([...L.purchaseDrop]));
log('escrow:', json([...L.escrow]));
const found = [...L.purchases].some(([, v]: [bigint, Uint8Array]) => hex(v) === hex(ePub));
log(found ? 'OK: ePub found in ledger purchases map' : 'FAIL: ePub not found');

// 3) creator withdraws the escrowed coin to their own shielded wallet
log('withdraw(0)...');
const tx3 = await deployed.callTx.withdraw(0n);
log('withdraw tx', tx3.public.txId, 'block', tx3.public.blockHeight);
const afterWithdraw = await walletCtx.wallet.waitForSyncedState();
log('shielded NIGHT after withdraw:', shieldedNight(afterWithdraw).toString());
L = await readLedger();
log('escrow after withdraw:', json([...L.escrow]));

await persistWalletState(network, walletCtx);
await walletCtx.wallet.stop();
log('DONE');
