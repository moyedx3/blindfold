// Deploy blindfold to the active network (undeployed by default; --network preview|preprod).
// A clean wallet must first register its NIGHT UTXOs and accrue DUST. This script performs that
// setup with bounded waits so a fresh local devnet works and public-network failures are actionable.
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

// @ts-expect-error polyfill for wallet sync
globalThis.WebSocket = WebSocket;

import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, recordDeployment } from './lib/network';
import { createWallet, persistWalletState, unshieldedToken } from './lib/wallet';
import { buildProviders, loadCompiledContract } from './lib/providers';

const DUST_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const DEPLOY_ATTEMPTS = 20;
const DEPLOY_RETRY_MS = 5_000;

const { network, config } = resolveNetwork();
const wallet = getOrCreateWallet(network);
const notice = formatWalletBackupNotice(wallet, network);
if (notice) console.log(notice);

async function waitForProofServer(): Promise<void> {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      await fetch(config.proofServer, { signal: AbortSignal.timeout(3_000) });
      return;
    } catch (error: any) {
      const code = error?.cause?.code ?? error?.code ?? '';
      if (!['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)) return;
    }
    if (attempt < 60) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`proof server did not become reachable at ${config.proofServer}`);
}

function isDustShortage(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message} ${(error as any).cause ?? ''}` : String(error);
  return text.includes('Not enough Dust') || text.includes('Insufficient Funds') || text.includes('could not balance dust');
}

const ctx = await createWallet({ network, networkConfig: config, seed: wallet.seed });
try {
  console.log('syncing wallet…');
  const initialState = await ctx.wallet.waitForSyncedState();
  await persistWalletState(network, ctx);

  const walletAddress = ctx.unshieldedKeystore.getBech32Address().toString();
  const nightBalance = initialState.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`wallet ${walletAddress} has ${nightBalance} unshielded STAR`);
  if (nightBalance === 0n) {
    const hint = network === 'undeployed'
      ? 'reset the local devnet and check that the dev preset funded the genesis wallet'
      : `fund the address at ${config.faucet ?? 'the network faucet'} and rerun this command`;
    throw new Error(`deployment wallet has no unshielded NIGHT; ${hint}`);
  }

  const unregistered = initialState.unshielded.availableCoins.filter(
    (coin: any) => !coin.meta?.registeredForDustGeneration,
  );
  if (unregistered.length > 0) {
    console.log(`registering ${unregistered.length} NIGHT UTXO(s) for DUST generation…`);
    const recipe = await ctx.wallet.registerNightUtxosForDustGeneration(
      unregistered,
      ctx.unshieldedKeystore.getPublicKey(),
      (payload) => ctx.unshieldedKeystore.signData(payload),
    );
    const finalized = await ctx.wallet.finalizeRecipe(recipe);
    await ctx.wallet.submitTransaction(finalized);
  }

  if (initialState.dust.balance(new Date()) === 0n) {
    console.log('waiting for DUST…');
    try {
      await Rx.firstValueFrom(
        ctx.wallet.state().pipe(
          Rx.throttleTime(5_000),
          Rx.filter((state) => state.isSynced && state.dust.balance(new Date()) > 0n),
          Rx.timeout({ first: DUST_WAIT_TIMEOUT_MS }),
        ),
      );
    } catch {
      throw new Error(`DUST did not accrue within ${DUST_WAIT_TIMEOUT_MS / 60_000} minutes`);
    }
  }
  console.log('DUST ready');

  await waitForProofServer();
  const providers = buildProviders(ctx, config);
  const compiledContract = await loadCompiledContract();

  // Wallet DUST is projected from time while transaction balancing uses the next block timestamp.
  // One block of headroom handles the usual fresh-registration race; bounded retries cover outliers.
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  console.log(`deploying blindfold to ${network}…`);
  let deployed: any;
  for (let attempt = 1; attempt <= DEPLOY_ATTEMPTS; attempt += 1) {
    try {
      deployed = await deployContract(providers, {
        compiledContract: compiledContract as any,
        args: [],
        privateStateId: `blindfold-deployer-${Date.now()}`,
        initialPrivateState: { secret: randomBytes(32) },
      });
      break;
    } catch (error) {
      if (!isDustShortage(error) || attempt === DEPLOY_ATTEMPTS) throw error;
      const state = await ctx.wallet.waitForSyncedState();
      console.log(
        `DUST balance ${state.dust.balance(new Date()).toLocaleString()}; ` +
          `retrying deployment (${attempt}/${DEPLOY_ATTEMPTS})…`,
      );
      await new Promise((resolve) => setTimeout(resolve, DEPLOY_RETRY_MS));
    }
  }
  if (!deployed) throw new Error('deployment exhausted its retry budget');

  const address = deployed.deployTxData.public.contractAddress as string;
  recordDeployment(network, address, walletAddress);
  console.log(`CONTRACT_ADDRESS=${address}`);
  await persistWalletState(network, ctx);
} finally {
  await ctx.wallet.stop();
}
