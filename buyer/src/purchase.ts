import type { CatalogEntry } from './api';
import { fromHex, toHex } from './bytes';
import { generateEphemeralKeypair } from './seal';

export type Purchase = {
  id: string; dropId: number; title: string; priceStar: string; hContent: string;
  ePub: Uint8Array; ePriv: Uint8Array; createdAt: number; txId?: string; contractAddress?: string;
};

export async function createPurchase(entry: CatalogEntry, contractAddress: string, now: number = Date.now()): Promise<Purchase> {
  const { ePub, ePriv } = await generateEphemeralKeypair();
  return { id: toHex(crypto.getRandomValues(new Uint8Array(8))), dropId: entry.drop_id, title: entry.title, priceStar: entry.price_star, hContent: entry.h_content, ePub, ePriv, createdAt: now, contractAddress };
}

export type RecoveryFile = {
  v: 'blindfold-recovery-1'; drop_id: number; title: string; price_star: string; h_content: string;
  e_pub: string; e_priv: string; created_at: number; tx_id?: string; contract_address?: string;
};

export function toRecoveryFile(p: Purchase): RecoveryFile {
  return { v: 'blindfold-recovery-1', drop_id: p.dropId, title: p.title, price_star: p.priceStar, h_content: p.hContent, e_pub: toHex(p.ePub), e_priv: toHex(p.ePriv), created_at: p.createdAt, tx_id: p.txId, contract_address: p.contractAddress };
}

export function fromRecoveryFile(json: string): Purchase {
  const o = JSON.parse(json) as Partial<RecoveryFile>;
  if (o.v !== 'blindfold-recovery-1' || !o.e_priv || !o.e_pub || !o.h_content || o.drop_id === undefined) throw new Error('not a valid blindfold recovery file');
  return { id: toHex(crypto.getRandomValues(new Uint8Array(8))), dropId: o.drop_id, title: o.title ?? `Drop ${o.drop_id}`, priceStar: o.price_star ?? '0', hContent: o.h_content, ePub: fromHex(o.e_pub), ePriv: fromHex(o.e_priv), createdAt: o.created_at ?? Date.now(), txId: o.tx_id, contractAddress: o.contract_address };
}
