import sodium from 'libsodium-wrappers';
import { it, expect } from 'vitest';
import vectors from '../../docs/vectors.json';
import { concatBytes, fromHex, sha256Hex, toHex } from '../src/bytes';
import { MockDropApi } from '../src/mockApi';
import { sodiumReady, generateEphemeralKeypair, trySealOpen } from '../src/seal';

it('mock indexer seeds drops and dispatches sealed keys', async () => {
  await sodiumReady();
  const api = new MockDropApi();
  const entry = await api.seedDrop({ drop_id: 2, price_star: '5', title: 'x', h_content: '' }, new Uint8Array([1]));
  expect((await api.fetchCatalog())[0].h_content).toBe(entry.h_content);
  expect((await api.fetchContract()).contract_address).toBe('ff'.repeat(32));
  const kp = await generateEphemeralKeypair();
  await api.dispatchFor(kp.ePub, 2);
  const [key] = await api.listDispatch();
  expect(trySealOpen(await api.getDispatch(key), kp.ePub, kp.ePriv)!.length).toBe(32);
});

it('derives the dispatch key as blake2b256(ek_pub || u64be(index)), matching the shared vectors', async () => {
  // docs/vectors.json's u64be vector encodes index 1 as big-endian 8 bytes — use it (rather than
  // hand-rolling the byte order) to pin down what MockDropApi's second dispatch (index 1) key
  // must be, given the ephemeral pubkey prefix (`ek_pub`) libsodium's crypto_box_seal embeds in
  // the first 32 bytes of the blob it produced.
  await sodiumReady();
  const api = new MockDropApi();
  const entry = await api.seedDrop({ drop_id: 3, price_star: '5', title: 'x', h_content: '' }, new Uint8Array([9]));
  const ePub = new Uint8Array(32).fill(7);
  await api.dispatchFor(ePub, entry.drop_id); // index 0
  await api.dispatchFor(ePub, entry.drop_id); // index 1

  const keys = await api.listDispatch();
  expect(keys).toHaveLength(2);
  const secondKey = keys[1];
  const blob = await api.getDispatch(secondKey);
  const ekPub = blob.subarray(0, 32);
  const idxBytes = fromHex(vectors.u64be.output_hex); // u64be(1) per the shared vector
  expect(vectors.u64be.value).toBe('1');

  const expected = toHex(sodium.crypto_generichash(32, concatBytes([ekPub, idxBytes])));
  expect(secondKey).toBe(expected);
});

it('sha256Hex/fromHex agree with the shared sha256 vector', async () => {
  const input = fromHex(vectors.sha256.input_hex);
  expect(await sha256Hex(input)).toBe(vectors.sha256.output_hex);
});
