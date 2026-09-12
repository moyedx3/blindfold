import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import { WebSocket } from 'ws';
// @ts-expect-error polyfill
globalThis.WebSocket = WebSocket;
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { resolveNetwork, GENESIS_SEED } from '../scripts/lib/network';
import { createWallet, type WalletContext } from '../scripts/lib/wallet';
import {
  buildProviders, loadCompiledContract, loadContractModule, nightCoin,
  paymentCoin, paymentColorHex, TOP_UP_DENOMINATIONS_STAR,
} from '../scripts/lib/providers';

const NATIVE = '0'.repeat(64);
const PRICE = 1_000_000n;            // 1 NIGHT
const TOP_UP = TOP_UP_DENOMINATIONS_STAR[0]; // 5 NIGHT
const unshieldedNight = (s: any): bigint => s.unshielded.balances[NATIVE] ?? 0n;
const privateNight = (s: any, color: string): bigint => s.shielded.balances[color] ?? 0n;

describe.skipIf(!process.env.DEVNET)('blindfold contract flow (local devnet)', () => {
  const { network, config } = resolveNetwork({ argv: ['node', 'flow', '--network', 'undeployed'] });
  let ctx: WalletContext;
  let providers: ReturnType<typeof buildProviders>;
  let mod: any;
  let compiled: any;
  let address: string;
  let color: string;
  const creatorSecret = randomBytes(32);
  const kDrop = randomBytes(32);
  const hContent = Buffer.alloc(32, 0xcd);
  const commit = createHash('sha256').update(Buffer.concat([kDrop, hContent])).digest();

  beforeAll(async () => {
    ctx = await createWallet({ network, networkConfig: config, seed: GENESIS_SEED });
    await ctx.wallet.waitForSyncedState();
    providers = buildProviders(ctx, config, 'blindfold-flow-test');
    mod = await loadContractModule();
    compiled = await loadCompiledContract();
    const deployed: any = await deployContract(providers, {
      compiledContract: compiled, args: [], privateStateId: `flow-creator-${Date.now()}`,
      initialPrivateState: { secret: creatorSecret },
    });
    address = deployed.deployTxData.public.contractAddress;
    color = paymentColorHex(address);
  }, 180_000);
  afterAll(async () => { await ctx.wallet.stop(); });

  async function ledger() {
    const cs = await providers.publicDataProvider.queryContractState(address);
    return mod.ledger(cs!.data);
  }
  async function asCreator() {
    return findDeployedContract(providers, { compiledContract: compiled, contractAddress: address,
      privateStateId: `flow-creator-${address}`, initialPrivateState: { secret: creatorSecret } }) as any;
  }
  async function asStranger() {
    return findDeployedContract(providers, { compiledContract: compiled, contractAddress: address,
      privateStateId: `flow-stranger-${address}`, initialPrivateState: { secret: randomBytes(32) } }) as any;
  }

  it('createDrop records price, commitment, and owner', async () => {
    const c = await asCreator();
    await c.callTx.createDrop(1n, PRICE, commit);
    const L = await ledger();
    expect(L.drops.lookup(1n)).toBe(PRICE);
    expect(Buffer.from(L.kCommit.lookup(1n)).equals(commit)).toBe(true);
    expect(L.dropOwner.member(1n)).toBe(true);
  });

  it('createDrop rejects a duplicate id', async () => {
    const c = await asCreator();
    await expect(c.callTx.createDrop(1n, PRICE, commit)).rejects.toThrow(/drop already exists/);
  });

  it('wrap refuses an amount that is not 5, 10, or 50 NIGHT', async () => {
    const buyer = await asStranger();
    await expect(buyer.callTx.wrap(7_000_000n)).rejects.toThrow(/top up 5, 10, or 50 NIGHT/);
  });

  it('wrap moves public NIGHT into the contract and mints the same amount of bNIGHT to the caller', async () => {
    const before = await ctx.wallet.waitForSyncedState();
    const buyer = await asStranger();
    await buyer.callTx.wrap(TOP_UP);
    const after = await ctx.wallet.waitForSyncedState();
    expect(privateNight(after, color) - privateNight(before, color)).toBe(TOP_UP);
    // fees are DUST, so the public NIGHT delta is exactly the top-up
    expect(unshieldedNight(before) - unshieldedNight(after)).toBe(TOP_UP);
  });

  it('purchase refuses a native-colored coin', async () => {
    const buyer = await asStranger();
    await expect(buyer.callTx.purchase(1n, randomBytes(32), nightCoin(PRICE))).rejects.toThrow(/must pay in bNIGHT/);
  });

  it('purchase rejects an underpaid coin', async () => {
    const buyer = await asStranger();
    await expect(buyer.callTx.purchase(1n, randomBytes(32), paymentCoin(address, PRICE - 1n))).rejects.toThrow(/underpaid/);
  });

  it('purchase escrows a bNIGHT coin and records the one-time key', async () => {
    const before = privateNight(await ctx.wallet.waitForSyncedState(), color);
    const buyer = await asStranger();
    const ePub = randomBytes(32);
    await buyer.callTx.purchase(1n, ePub, paymentCoin(address, PRICE));
    const after = privateNight(await ctx.wallet.waitForSyncedState(), color);
    expect(before - after).toBe(PRICE);
    const L = await ledger();
    expect(L.purchaseCount).toBe(1n);
    expect(Buffer.from(L.purchases.lookup(0n)).equals(ePub)).toBe(true);
    expect(L.purchaseDrop.lookup(0n)).toBe(1n);
    expect(L.escrow.lookup(0n).value).toBe(PRICE);
  });

  it('purchase refuses a second sale of the same content', async () => {
    const buyer = await asStranger();
    await expect(buyer.callTx.purchase(1n, randomBytes(32), paymentCoin(address, PRICE))).rejects.toThrow(/already sold/);
  });

  it('withdraw by a non-owner is rejected', async () => {
    const s = await asStranger();
    await expect(s.callTx.withdraw(0n)).rejects.toThrow(/not the creator/);
  });

  it('withdraw by the creator returns the escrowed bNIGHT', async () => {
    const before = privateNight(await ctx.wallet.waitForSyncedState(), color);
    const c = await asCreator();
    await c.callTx.withdraw(0n);
    const after = privateNight(await ctx.wallet.waitForSyncedState(), color);
    expect(after - before).toBe(PRICE);
    expect((await ledger()).escrow.member(0n)).toBe(false);
  });

  // The wallet's own public address as the 32-byte UserAddress the circuit expects.
  function ownUserAddress() {
    const bech32 = String(ctx.unshieldedKeystore.getBech32Address());
    return { bytes: new Uint8Array(UnshieldedAddress.codec.decode(network, MidnightBech32m.parse(bech32)).data) };
  }

  it('unwrap refuses a coin of another color', async () => {
    const c = await asCreator();
    await expect(c.callTx.unwrap(nightCoin(PRICE), ownUserAddress())).rejects.toThrow(/not bNIGHT/);
  });

  it('unwrap returns public NIGHT for bNIGHT', async () => {
    const before = await ctx.wallet.waitForSyncedState();
    const c = await asCreator();
    await c.callTx.unwrap(paymentCoin(address, PRICE), ownUserAddress());
    const after = await ctx.wallet.waitForSyncedState();
    expect(privateNight(before, color) - privateNight(after, color)).toBe(PRICE);
    expect(unshieldedNight(after) - unshieldedNight(before)).toBe(PRICE);
  });
});
