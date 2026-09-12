// Top up this wallet's private balance: wrap 5, 10, or 50 NIGHT into bNIGHT on the active network.
// Usage: npm run wrap -w contract -- <NIGHT amount> --network <id>   (CONTRACT_ADDRESS env or the recorded deployment)
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
// @ts-expect-error polyfill for wallet sync
globalThis.WebSocket = WebSocket;
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { resolveNetwork, loadState, getDeployment, GENESIS_SEED } from './lib/network';
import { createWallet, persistWalletState } from './lib/wallet';
import { buildProviders, loadCompiledContract, paymentColorHex, TOP_UP_DENOMINATIONS_STAR } from './lib/providers';

const { network, config } = resolveNetwork();
const night = BigInt(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? '5');
const star = night * 1_000_000n;
if (!TOP_UP_DENOMINATIONS_STAR.includes(star)) throw new Error('amount must be 5, 10, or 50 NIGHT');
const seed = network === 'undeployed' ? GENESIS_SEED : loadState()?.wallets?.[network]?.seed;
if (!seed) throw new Error(`no ${network} wallet in the state file; run wallet:prepare first`);
const dep = getDeployment(network) as any;
const address: string | undefined = process.env.CONTRACT_ADDRESS ?? dep?.contractAddress ?? dep?.address;
if (!address) throw new Error('set CONTRACT_ADDRESS');
const color = paymentColorHex(address);

const ctx = await createWallet({ network, networkConfig: config, seed });
const before: any = await ctx.wallet.waitForSyncedState();
console.log(`before: public ${before.unshielded.balances['0'.repeat(64)] ?? 0n} STAR, private ${before.shielded.balances[color] ?? 0n} STAR, dust ${before.dust.balance(new Date())}`);
const providers = buildProviders(ctx, config, 'blindfold-wrap');
const compiled = await loadCompiledContract();
const c: any = await findDeployedContract(providers, { compiledContract: compiled, contractAddress: address, privateStateId: `wrap-${address.slice(0, 8)}`, initialPrivateState: { secret: randomBytes(32) } });
console.log(`wrapping ${night} NIGHT on ${network} at ${address.slice(0, 12)}…`);
const tx = await c.callTx.wrap(star);
console.log(`tx ${tx.public.txId} in block ${tx.public.blockHeight}`);
const after: any = await ctx.wallet.waitForSyncedState();
console.log(`after:  public ${after.unshielded.balances['0'.repeat(64)] ?? 0n} STAR, private ${after.shielded.balances[color] ?? 0n} STAR`);
await persistWalletState(network, ctx);
await ctx.wallet.stop();
