import type { BlindfoldClient } from '@blindfold/midnight-web';
import type { CatalogEntry } from './api';
import { createPurchase, type Purchase } from './purchase';
import { sodiumReady } from './seal';

/**
 * Step 1 of a purchase: mint a fresh one-time keypair for this drop. No wallet/chain call yet —
 * the caller can persist the result (it already carries `ePriv`, the only copy of the key that
 * will ever unlock this purchase) before submitting the transaction. See C2.
 */
export async function createPurchaseFor(entry: CatalogEntry, contractAddress: string): Promise<Purchase> {
  await sodiumReady();
  return createPurchase(entry, contractAddress);
}

/** Step 2: submit the purchase to the contract. Returns the same purchase with `txId` set. */
export async function submitPurchase(client: BlindfoldClient, purchase: Purchase): Promise<Purchase> {
  const tx = await client.purchase(BigInt(purchase.dropId), purchase.ePub, BigInt(purchase.priceStar));
  return { ...purchase, txId: tx.txId };
}

/**
 * Composition of the two steps above. `App.tsx` no longer uses this directly (it needs to
 * persist the purchase between `createPurchaseFor` and `submitPurchase` — see C2) but it's kept
 * for callers, and tests, that just want "purchase this drop" as one call.
 */
export async function buyDrop(deps: { client: BlindfoldClient; contractAddress: string }, entry: CatalogEntry): Promise<Purchase> {
  const purchase = await createPurchaseFor(entry, deps.contractAddress);
  return submitPurchase(deps.client, purchase);
}
