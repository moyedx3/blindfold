// Deploy blindfold to the active network (undeployed by default; --network preview|preprod).
// Prints the contract address and records it in .midnight-state.json under deployments.
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
// @ts-expect-error polyfill for wallet sync
globalThis.WebSocket = WebSocket;
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, recordDeployment } from './lib/network';
import { createWallet, persistWalletState } from './lib/wallet';
import { buildProviders, loadCompiledContract } from './lib/providers';

const { network, config } = resolveNetwork();
const wallet = getOrCreateWallet(network);
const notice = formatWalletBackupNotice(wallet, network);
if (notice) console.log(notice);

const ctx = await createWallet({ network, networkConfig: config, seed: wallet.seed });
console.log('syncing wallet…');
await ctx.wallet.waitForSyncedState();
await persistWalletState(network, ctx);

const providers = buildProviders(ctx, config);
const compiledContract = await loadCompiledContract();
console.log(`deploying blindfold to ${network}…`);
const deployed: any = await deployContract(providers, {
  compiledContract: compiledContract as any,
  args: [],
  privateStateId: `blindfold-deployer-${Date.now()}`,
  initialPrivateState: { secret: randomBytes(32) },
});
const address = deployed.deployTxData.public.contractAddress as string;
recordDeployment(network, address, ctx.unshieldedKeystore.getBech32Address().toString());
console.log(`CONTRACT_ADDRESS=${address}`);
await persistWalletState(network, ctx);
await ctx.wallet.stop();
