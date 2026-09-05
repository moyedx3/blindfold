// THROWAWAY: fund a second wallet (e.g. Lace on the Undeployed network) from the devnet genesis wallet.
// Usage: npx tsx src/fund.ts <unshielded mn_addr_undeployed1...> [<shielded mn_shield-addr_undeployed1...>] [nightAmount]
// Sends `nightAmount` NIGHT unshielded (for DUST registration) and, if a shielded address is given, the same amount shielded.
import { WebSocket } from 'ws';
// @ts-expect-error polyfill
globalThis.WebSocket = WebSocket;
import { UnshieldedAddress, ShieldedAddress, MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import { resolveNetwork, GENESIS_SEED } from './network';
import { createWallet, persistWalletState } from './wallet';

const NATIVE = '0000000000000000000000000000000000000000000000000000000000000000';
const [unshieldedStr, shieldedStr, amountStr] = process.argv.slice(2);
if (!unshieldedStr) { console.error('usage: fund.ts <unshielded addr> [<shielded addr>] [NIGHT amount]'); process.exit(1); }
const night = BigInt(amountStr ?? '1000');
const star = night * 1_000_000n;

const { network, config } = resolveNetwork();
const ctx = await createWallet({ network, networkConfig: config, seed: GENESIS_SEED });
await ctx.wallet.waitForSyncedState();
await persistWalletState(network, ctx);

const outputs: any[] = [];
const unshielded = UnshieldedAddress.codec.decode(network as any, MidnightBech32m.parse(unshieldedStr));
outputs.push({ type: 'unshielded', outputs: [{ type: NATIVE, receiverAddress: unshielded, amount: star }] });
if (shieldedStr) {
  const shielded = ShieldedAddress.codec.decode(network as any, MidnightBech32m.parse(shieldedStr));
  outputs.push({ type: 'shielded', outputs: [{ type: NATIVE, receiverAddress: shielded, amount: star }] });
}
console.log(`sending ${night} NIGHT unshielded${shieldedStr ? ` + ${night} NIGHT shielded` : ''}...`);
const recipe = await ctx.wallet.transferTransaction(outputs,
  { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
  { ttl: new Date(Date.now() + 30 * 60 * 1000) });
const finalized = await ctx.wallet.finalizeRecipe(recipe as any);
const txId = await ctx.wallet.submitTransaction(finalized);
console.log('submitted tx', txId);
await persistWalletState(network, ctx);
await ctx.wallet.stop();
