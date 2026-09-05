import type { BlindfoldClient } from '@blindfold/midnight-web';
import type { CatalogEntry, DropApi } from './api';
import { createPurchase, type Purchase } from './purchase';
import { sodiumReady } from './seal';

export async function buyDrop(deps: { api: DropApi; client: BlindfoldClient; contractAddress: string }, entry: CatalogEntry): Promise<Purchase> {
  await sodiumReady();
  const purchase = await createPurchase(entry, deps.contractAddress);
  const tx = await deps.client.purchase(BigInt(entry.drop_id), purchase.ePub, BigInt(entry.price_star));
  return { ...purchase, txId: tx.txId };
}
