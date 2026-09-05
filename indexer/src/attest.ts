import type { Tee } from './dstack';
import { sha256, toHex, type Keypair } from './keys';

export type AttestResponse = { quote_hex: string; provisioning_pubkey_hex: string };

/** TDX report_data slot is 64 bytes: sha256(pubkey) then zero padding. The creator checks the first 32. */
export function reportDataForPubkey(pub: Uint8Array): Uint8Array {
  const out = new Uint8Array(64); out.set(sha256(pub), 0); return out;
}

export async function buildAttestResponse(tee: Pick<Tee, 'getQuote'>, kp: Keypair): Promise<AttestResponse> {
  return { quote_hex: await tee.getQuote(reportDataForPubkey(kp.publicKey)), provisioning_pubkey_hex: toHex(kp.publicKey) };
}
