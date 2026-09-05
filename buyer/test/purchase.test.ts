import { describe, it, expect } from 'vitest';
import { createPurchase, toRecoveryFile, fromRecoveryFile } from '../src/purchase';

const entry = { drop_id: 3, price_star: '1500000', title: 'cat', h_content: 'ab'.repeat(32) };

describe('purchase', () => {
  it('createPurchase makes a fresh keypair and carries the contract address', async () => {
    const a = await createPurchase(entry, 'cc'.repeat(32));
    const b = await createPurchase(entry, 'cc'.repeat(32));
    expect(a.ePub.length).toBe(32); expect(a.ePriv.length).toBe(32);
    expect(Buffer.from(a.ePub).equals(Buffer.from(b.ePub))).toBe(false);
    expect(a.contractAddress).toBe('cc'.repeat(32));
    expect(a.priceStar).toBe('1500000');
  });
  it('recovery file round-trips including txId', async () => {
    const p = { ...(await createPurchase(entry, 'cc'.repeat(32))), txId: 'tx1' };
    const back = fromRecoveryFile(JSON.stringify(toRecoveryFile(p)));
    expect(back.dropId).toBe(3); expect(back.txId).toBe('tx1'); expect(back.hContent).toBe(entry.h_content);
    expect(Buffer.from(back.ePriv).equals(Buffer.from(p.ePriv))).toBe(true);
    expect(toRecoveryFile(p).v).toBe('blindfold-recovery-1');
  });
  it('rejects a foreign recovery file', () => {
    expect(() => fromRecoveryFile(JSON.stringify({ v: 'other' }))).toThrow(/not a valid/);
  });
});
