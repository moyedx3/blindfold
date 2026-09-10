import { expect, it } from 'vitest';
import { allowsDevAttestation, exportRecovery, importRecovery, verifyRecoveryDrop, type Recovery } from '../src/recovery';
import { encryptContent, decryptContent } from '../src/content';
import { buildProvisionPayload } from '../src/provision';
import { concatBytes, fromHex, sha256, toHex, utf8Bytes } from '../src/bytes';

async function fixture() {
  const content = await encryptContent(utf8Bytes('recoverable content'));
  const saved: Recovery = { network: 'preprod', contractAddress: 'ab'.repeat(32), payload: buildProvisionPayload({ dropId: 1, priceStar: 42n, kDrop: content.kDrop, hContent: content.hContent, title: 'test' }), blobHex: toHex(content.blob) };
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return { saved, secret, file: await exportRecovery(saved, secret) };
}

it('restores the original content key after serializing, without exposing it in the file', async () => {
  const { saved, secret, file } = await fixture();
  expect(file).not.toContain(saved.payload.k_drop);
  const restored = await importRecovery(file, secret, saved.network, saved.contractAddress);
  expect(restored).toEqual(saved);
  const plain = await decryptContent(fromHex(restored.blobHex), fromHex(restored.payload.k_drop));
  expect(new TextDecoder().decode(plain)).toBe('recoverable content');
});

it('rejects another creator secret and tampered encrypted data', async () => {
  const { saved, file, secret } = await fixture();
  await expect(importRecovery(file, new Uint8Array(32), saved.network, saved.contractAddress)).rejects.toThrow();
  const envelope = JSON.parse(file);
  envelope.ciphertext = (envelope.ciphertext.startsWith('00') ? '01' : '00') + envelope.ciphertext.slice(2);
  await expect(importRecovery(JSON.stringify(envelope), secret, saved.network, saved.contractAddress)).rejects.toThrow();
});

it('rejects another contract or network before recovery', async () => {
  const { saved, secret, file } = await fixture();
  await expect(importRecovery(file, secret, 'preview', saved.contractAddress)).rejects.toThrow(/another network or contract/);
  await expect(importRecovery(file, secret, saved.network, 'cd'.repeat(32))).rejects.toThrow(/another network or contract/);
});

it('rejects corrupted content even in an authenticated backup', async () => {
  const { saved, secret } = await fixture();
  saved.blobHex = '00'.repeat(40);
  await expect(importRecovery(await exportRecovery(saved, secret), secret, saved.network, saved.contractAddress)).rejects.toThrow(/hash mismatch/);
});

it('requires the existing price and content-bound key commitment', async () => {
  const { saved } = await fixture();
  const commitment = await sha256(concatBytes([fromHex(saved.payload.k_drop), fromHex(saved.payload.h_content)]));
  const ledger = { drops: new Map([[1n, 42n]]), kCommit: new Map([[1n, commitment]]) };
  await expect(verifyRecoveryDrop(saved, ledger)).resolves.toBeUndefined();
  ledger.drops.set(1n, 43n);
  await expect(verifyRecoveryDrop(saved, ledger)).rejects.toThrow(/existing on-chain drop/);
  ledger.drops.set(1n, 42n);
  ledger.kCommit.set(1n, new Uint8Array(32));
  await expect(verifyRecoveryDrop(saved, ledger)).rejects.toThrow();
  await expect(verifyRecoveryDrop(saved, { drops: new Map(), kCommit: new Map() })).rejects.toThrow();
});

it('allows dev attestation only for undeployed and exact loopback hosts', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) expect(allowsDevAttestation('undeployed', `http://${host}:8080`)).toBe(true);
  for (const network of ['preprod', 'preview', 'mainnet']) expect(allowsDevAttestation(network, 'http://localhost:8080')).toBe(false);
  for (const url of ['https://example.com', 'http://localhost.example.com', 'http://localhost@evil.com', 'file://localhost/a', 'invalid']) expect(allowsDevAttestation('undeployed', url)).toBe(false);
});
