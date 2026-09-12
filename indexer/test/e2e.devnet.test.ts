// Proves the whole indexer against a live devnet: buyer wallet purchase -> watcher dispatch ->
// HTTP surface, in-process (no listening port; server.inject drives the HTTP layer).
// Controller ruling R13 replaces the brief's manual Step 7 with this automated flow.
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sodium from 'libsodium-wrappers';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { resolveNetwork, GENESIS_SEED } from '../../contract/scripts/lib/network';
import { createWallet, type WalletContext } from '../../contract/scripts/lib/wallet';
import { buildProviders, loadCompiledContract, paymentCoin } from '../../contract/scripts/lib/providers';

import { buildServer } from '../src/server';
import { Catalog } from '../src/catalog';
import { FsBucket } from '../src/bucket';
import { DevTee } from '../src/dstack';
import { MidnightLedgerReader } from '../src/chain';
import { Engine } from '../src/engine';
import { Watcher, DispatchedStore } from '../src/watcher';
import { keypairFromSeed, sodiumReady, sha256, fromHex, toHex, concat } from '../src/keys';
import { sealProvision } from '../src/provision';

const PRICE = 1_000_000n;
const INDEXER_SEED_HEX = '42'.repeat(32);

/** Pure helper used by the flow below: pick a drop id unused on this (possibly shared) devnet ledger. */
export function nextDropId(drops: Map<bigint, bigint>): bigint {
  let max = 0n;
  for (const id of drops.keys()) if (id > max) max = id;
  return max + 1n;
}

describe('nextDropId (no devnet required)', () => {
  it('is 1 for an empty ledger and max+1 otherwise', () => {
    expect(nextDropId(new Map())).toBe(1n);
    expect(nextDropId(new Map([[1n, 10n], [5n, 20n], [3n, 30n]]))).toBe(6n);
  });
});

describe.skipIf(!process.env.DEVNET || !process.env.CONTRACT_ADDRESS)('indexer e2e (devnet)', () => {
  it(
    'provisions a drop, takes a purchase, and dispatches K_drop through the HTTP surface',
    async () => {
      await sodiumReady();
      const contractAddress = process.env.CONTRACT_ADDRESS!;
      const tmpDir = await mkdtemp(join(tmpdir(), 'blindfold-e2e-'));
      const { config } = resolveNetwork({ argv: ['x', 'y', '--network', 'undeployed'] });

      const catalog = new Catalog();
      const contentBucket = new FsBucket(join(tmpDir, 'content'));
      const dispatchBucket = new FsBucket(join(tmpDir, 'dispatch'));
      const reader = new MidnightLedgerReader({
        indexerUrl: config.indexer,
        indexerWsUrl: config.indexerWS,
        contractAddress,
        networkId: 'undeployed',
      });
      const server = buildServer({
        tee: new DevTee(INDEXER_SEED_HEX),
        kp: keypairFromSeed(fromHex(INDEXER_SEED_HEX)),
        catalog,
        content: contentBucket,
        dispatch: dispatchBucket,
        reader,
        network: 'undeployed',
        contractAddress,
      });
      const watcher = new Watcher({ reader, engine: new Engine(catalog, dispatchBucket), store: new DispatchedStore(join(tmpDir, 'dispatched.json')) });

      let ctx: WalletContext | undefined;
      try {
        ctx = await createWallet({ network: 'undeployed', networkConfig: config, seed: GENESIS_SEED });
        await ctx.wallet.waitForSyncedState();

        const providers = buildProviders(ctx, config, 'blindfold-e2e-test');
        const compiled = await loadCompiledContract();

        // Step 2: creator registers a fresh drop on-chain.
        const creator = (await findDeployedContract(providers, {
          compiledContract: compiled,
          contractAddress,
          privateStateId: `e2e-creator-${Date.now()}`,
          initialPrivateState: { secret: randomBytes(32) },
        })) as any;

        const snap = await reader.read();
        const dropId = nextDropId(snap.drops);
        const kDrop = randomBytes(32);

        // Step 3: content blob lands in the bucket via HTTP.
        const contentBlob = randomBytes(64);
        const hContent = toHex(sha256(contentBlob));
        const putRes = await server.inject({
          method: 'PUT',
          url: `/bucket/${hContent}`,
          payload: Buffer.from(contentBlob),
          headers: { 'content-type': 'application/octet-stream' },
        });
        expect(putRes.statusCode).toBe(200);

        // createDrop commits to K_drop and the content hash together (R17): sha256(K_drop || h_content).
        await creator.callTx.createDrop(dropId, PRICE, sha256(concat([kDrop, fromHex(hContent)])));

        // Step 4: attest, seal, provision, confirm the catalog.
        const attest = (await server.inject({ method: 'GET', url: '/attest' })).json() as { provisioning_pubkey_hex: string };
        const provisionPayload = { drop_id: Number(dropId), price_star: PRICE.toString(), k_drop: toHex(kDrop), h_content: hContent, title: 'e2e drop' };
        const sealed = sealProvision(provisionPayload, fromHex(attest.provisioning_pubkey_hex));
        const provisionRes = await server.inject({
          method: 'POST',
          url: '/provision',
          payload: Buffer.from(sealed),
          headers: { 'content-type': 'application/octet-stream' },
        });
        expect(provisionRes.statusCode).toBe(200);

        const catalogEntries = (await server.inject({ method: 'GET', url: '/catalog' })).json();
        expect(catalogEntries).toContainEqual({ drop_id: Number(dropId), price_star: PRICE.toString(), title: 'e2e drop', h_content: hContent });

        // Step 5: a buyer (same wallet, distinct private state) purchases the drop.
        const buyer = (await findDeployedContract(providers, {
          compiledContract: compiled,
          contractAddress,
          privateStateId: `e2e-buyer-${Date.now()}`,
          initialPrivateState: { secret: randomBytes(32) },
        })) as any;
        const ePub = sodium.crypto_box_keypair();
        await buyer.callTx.wrap(5_000_000n);
        await buyer.callTx.purchase(dropId, ePub.publicKey, paymentCoin(contractAddress, PRICE));

        // Step 6: the watcher dispatches once the indexer catches up with the node.
        let dispatchedThisTick = 0;
        for (let attempt = 0; attempt < 20 && dispatchedThisTick < 1; attempt++) {
          const res = await watcher.tick();
          dispatchedThisTick = res.dispatched;
          if (dispatchedThisTick < 1) await new Promise((r) => setTimeout(r, 3000));
        }
        expect(dispatchedThisTick).toBeGreaterThanOrEqual(1);

        // The buyer cannot compute its own dispatch key, so it lists every blob and trial-opens each
        // one; on a shared devnet ledger other purchases' blobs may also be listed, so only exactly
        // one is expected to open under this buyer's keypair.
        const keys = (await server.inject({ method: 'GET', url: '/dispatch' })).json() as string[];
        expect(keys.length).toBeGreaterThanOrEqual(1);
        let openedCount = 0;
        let openedKey: string | null = null;
        let openedKDrop: Uint8Array | null = null;
        for (const k of keys) {
          const blobRes = await server.inject({ method: 'GET', url: `/dispatch/${k}` });
          if (blobRes.statusCode !== 200) continue;
          try {
            const opened = sodium.crypto_box_seal_open(blobRes.rawPayload, ePub.publicKey, ePub.privateKey);
            if (opened) { openedCount++; openedKey = k; openedKDrop = opened; }
          } catch { /* not ours; keep trying */ }
        }
        expect(openedCount).toBe(1);
        expect(toHex(openedKDrop!)).toBe(toHex(kDrop));

        console.log(`e2e: drop_id=${dropId} dispatch_key=${openedKey}`);
      } finally {
        // Step 7: stop the wallet.
        if (ctx) await ctx.wallet.stop();
        await server.close();
        await rm(tmpDir, { recursive: true, force: true });
      }
    },
    600_000,
  );
});
