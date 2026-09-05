// THROWAWAY: fund a second wallet (e.g. Lace) from the devnet genesis wallet.
// Usage: npx tsx src/fund.ts <unshielded addr> [<shielded addr>] [NIGHT amount]
// Accepts addresses encoded for any network (e.g. mainnet `mn_addr1…`) and re-encodes them for the
// active network: the key bytes are network-independent, only the bech32m network segment differs.
import { WebSocket } from 'ws';
// @ts-expect-error polyfill
globalThis.WebSocket = WebSocket;
import { UnshieldedAddress, ShieldedAddress, MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import { bech32m } from '@scure/base';
import { resolveNetwork, GENESIS_SEED } from './lib/network';
import { createWallet, persistWalletState } from './lib/wallet';

const NATIVE = '0000000000000000000000000000000000000000000000000000000000000000';
const [unshieldedStr, shieldedStr, amountStr] = process.argv.slice(2);
if (!unshieldedStr) { console.error('usage: fund.ts <unshielded addr> [<shielded addr>] [NIGHT amount]'); process.exit(1); }
const night = BigInt(amountStr ?? '1000');
const star = night * 1_000_000n;
const { network, config } = resolveNetwork();

function reencode(addr: string): MidnightBech32m {
  // MidnightBech32m.parse uses the default 90-char bech32m limit, which rejects shielded
  // addresses (~124 chars). Decode with a generous limit, then rebuild for the active network.
  const { prefix, words } = bech32m.decode(addr as `${string}1${string}`, 1023);
  const data = Buffer.from(bech32m.fromWords(words));
  const m = /^mn_([a-z-]+?)(?:_([a-z0-9-]+))?$/.exec(prefix);
  if (!m) throw new Error(`unrecognised prefix ${prefix}`);
  const [, type, net] = m;
  const local = new MidnightBech32m(type, network, data);
  console.log(`  ${type}: network ${net ?? 'mainnet'} -> ${network} (${data.length} bytes): ${local.toString()}`);
  return local;
}

const ctx = await createWallet({ network, networkConfig: config, seed: GENESIS_SEED });
await ctx.wallet.waitForSyncedState();
await persistWalletState(network, ctx);

const outputs: any[] = [];
const unshielded = UnshieldedAddress.codec.decode(network, reencode(unshieldedStr));
outputs.push({ type: 'unshielded', outputs: [{ type: NATIVE, receiverAddress: unshielded, amount: star }] });
if (shieldedStr) {
  const shielded = ShieldedAddress.codec.decode(network, reencode(shieldedStr));
  outputs.push({ type: 'shielded', outputs: [{ type: NATIVE, receiverAddress: shielded, amount: star }] });
}
console.log(`sending ${night} NIGHT unshielded${shieldedStr ? ` + ${night} NIGHT shielded` : ''}...`);
const recipe = await ctx.wallet.transferTransaction(outputs,
  { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
  { ttl: new Date(Date.now() + 30 * 60 * 1000) });
// Unshielded inputs must be signed by the unshielded keystore (chain error 192 = signature count mismatch otherwise).
const signed = await ctx.wallet.signRecipe(recipe as any, (data: Uint8Array) => ctx.unshieldedKeystore.signData(data));
const finalized = await ctx.wallet.finalizeRecipe(signed as any);
const txId = await ctx.wallet.submitTransaction(finalized);
console.log('submitted tx', txId);
await persistWalletState(network, ctx);
await ctx.wallet.stop();
console.log('DONE');
