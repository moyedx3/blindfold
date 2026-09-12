// Prepare a demo wallet without Lace's UI: create (or load) a wallet in its own state directory,
// print its public address for the faucet, register its NIGHT for DUST generation, and wait until
// DUST accrues. Import the printed 24 words into Lace afterwards; the wallet is then ready to sign.
//
// Usage (run in a normal terminal so the recovery phrase stays out of chat logs):
//   npx tsx contract/scripts/register-dust.ts --network preprod --dir .local/wallets/creator
// Run once to get the address, fund it at the faucet, then run again to register and wait for DUST.
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
// @ts-expect-error polyfill for wallet sync
globalThis.WebSocket = WebSocket;
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { formatWalletBackupNotice, getOrCreateWallet, resolveNetwork } from './lib/network';
import { createWallet, persistWalletState } from './lib/wallet';

const DUST_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const argv = process.argv.slice(2);
const dirIndex = argv.indexOf('--dir');
const dir = path.resolve(dirIndex >= 0 ? argv[dirIndex + 1] : process.cwd());
fs.mkdirSync(dir, { recursive: true });

const { network, config } = resolveNetwork();
if (network === 'undeployed') throw new Error('register-dust is for preview/preprod; the local devnet uses its genesis wallet');
const credentials = getOrCreateWallet(network, { cwd: dir });
const notice = formatWalletBackupNotice(credentials, network);
if (notice) console.log(notice);

const ctx = await createWallet({ network, networkConfig: config, seed: credentials.seed, cwd: dir });
try {
  console.log('syncing wallet…');
  const state: any = await ctx.wallet.waitForSyncedState();
  await persistWalletState(network, ctx, dir);
  const address = ctx.unshieldedKeystore.getBech32Address().toString();
  const night = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`NETWORK=${network}`);
  console.log(`WALLET_ADDRESS=${address}`);
  console.log(`STATE_DIR=${dir}`);
  console.log(`public NIGHT: ${night} STAR, DUST: ${state.dust.balance(new Date())} SPECK`);
  if (night === 0n) {
    console.log(`No NIGHT yet. Fund WALLET_ADDRESS at ${config.faucet ?? 'the network faucet'}, wait a few minutes, then run this command again.`);
    process.exit(2);
  }
  const unregistered = state.unshielded.availableCoins.filter((coin: any) => !coin.meta?.registeredForDustGeneration);
  if (unregistered.length > 0) {
    console.log(`registering ${unregistered.length} NIGHT UTXO(s) for DUST generation…`);
    const recipe = await ctx.wallet.registerNightUtxosForDustGeneration(
      unregistered, ctx.unshieldedKeystore.getPublicKey(), (payload) => ctx.unshieldedKeystore.signData(payload),
    );
    const finalized = await ctx.wallet.finalizeRecipe(recipe);
    await ctx.wallet.submitTransaction(finalized);
  } else {
    console.log('all NIGHT UTXOs are already registered for DUST generation');
  }
  if (state.dust.balance(new Date()) === 0n) {
    console.log('waiting for DUST (up to 5 minutes)…');
    await Rx.firstValueFrom(ctx.wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s: any) => s.isSynced && s.dust.balance(new Date()) > 0n),
      Rx.timeout({ first: DUST_WAIT_TIMEOUT_MS }),
    ));
  }
  const final: any = await ctx.wallet.waitForSyncedState();
  console.log(`DUST ready: ${final.dust.balance(new Date())} SPECK. Import the recovery phrase into Lace (${network}) to use this wallet in the browser.`);
  await persistWalletState(network, ctx, dir);
} finally {
  await ctx.wallet.stop();
}
