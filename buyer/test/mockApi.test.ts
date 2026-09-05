import { it, expect } from 'vitest';
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
