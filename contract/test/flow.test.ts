import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import { WebSocket } from 'ws';
// @ts-expect-error polyfill
globalThis.WebSocket = WebSocket;
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { resolveNetwork, GENESIS_SEED } from '../scripts/lib/network';
import { createWallet, persistWalletState, type WalletContext } from '../scripts/lib/wallet';
import { buildProviders, loadCompiledContract, loadContractModule, nightCoin } from '../scripts/lib/providers';

const NATIVE = '0'.repeat(64);
const PRICE = 1_000_000n;
const shieldedNight = (s: any): bigint => s.shielded.balances[NATIVE] ?? 0n;

describe.skipIf(!process.env.DEVNET)('blindfold contract flow (local devnet)', () => {
  const { network, config } = resolveNetwork();
  let ctx: WalletContext;
  let providers: ReturnType<typeof buildProviders>;
  let mod: any;
  let compiled: any;
  let address: string;
  const creatorSecret = randomBytes(32);
  const kDrop = randomBytes(32);
  const hContent = Buffer.alloc(32, 0xcd);
  const commit = createHash('sha256').update(Buffer.concat([kDrop, hContent])).digest();

  beforeAll(async () => {
    ctx = await createWallet({ network, networkConfig: config, seed: GENESIS_SEED });
    await ctx.wallet.waitForSyncedState();
    await persistWalletState(network, ctx);
    providers = buildProviders(ctx, config, 'blindfold-flow-test');
    mod = await loadContractModule();
    compiled = await loadCompiledContract();
    const deployed: any = await deployContract(providers, {
      compiledContract: compiled, args: [], privateStateId: `flow-creator-${Date.now()}`,
      initialPrivateState: { secret: creatorSecret },
    });
    address = deployed.deployTxData.public.contractAddress;
  });
  afterAll(async () => { await persistWalletState(network, ctx); await ctx.wallet.stop(); });

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

  it('purchase escrows the coin and records the one-time key', async () => {
    const before = shieldedNight(await ctx.wallet.waitForSyncedState());
    const buyer = await asStranger();
    const ePub = randomBytes(32);
    await buyer.callTx.purchase(1n, ePub, nightCoin(PRICE));
    const after = shieldedNight(await ctx.wallet.waitForSyncedState());
    expect(before - after).toBe(PRICE);
    const L = await ledger();
    expect(L.purchaseCount).toBe(1n);
    expect(Buffer.from(L.purchases.lookup(0n)).equals(ePub)).toBe(true);
    expect(L.purchaseDrop.lookup(0n)).toBe(1n);
    expect(L.escrow.lookup(0n).value).toBe(PRICE);
  });

  it('purchase rejects an underpaid coin', async () => {
    const buyer = await asStranger();
    await expect(buyer.callTx.purchase(1n, randomBytes(32), nightCoin(PRICE - 1n))).rejects.toThrow(/underpaid/);
  });

  it('withdraw by a non-owner is rejected', async () => {
    const s = await asStranger();
    await expect(s.callTx.withdraw(0n)).rejects.toThrow(/not the creator/);
  });

  it('withdraw by the creator returns the escrowed NIGHT', async () => {
    const before = shieldedNight(await ctx.wallet.waitForSyncedState());
    const c = await asCreator();
    await c.callTx.withdraw(0n);
    const after = shieldedNight(await ctx.wallet.waitForSyncedState());
    expect(after - before).toBe(PRICE);
    expect((await ledger()).escrow.member(0n)).toBe(false);
  });
});
