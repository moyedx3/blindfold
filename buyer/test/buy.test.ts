import { describe, it, expect } from 'vitest';
import { FakeBlindfoldClient } from '@blindfold/midnight-web';
import { buyDrop } from '../src/buy';
import { MockDropApi } from '../src/mockApi';
import { DispatchPoller } from '../src/poller';
import { sodiumReady } from '../src/seal';

describe('buyDrop', () => {
  it('purchases with a fresh key and the exact price, then the poller unlocks', async () => {
    await sodiumReady();
    const api = new MockDropApi();
    const entry = { drop_id: 1, price_star: '1000000', title: 'cat', h_content: '' };
    const seeded = await api.seedDrop(entry, new TextEncoder().encode('hello'));
    const client = new FakeBlindfoldClient({ drops: new Map([[1n, 1_000_000n]]) }, (_i, dropId, ePub) => api.dispatchFor(ePub, Number(dropId)), { privateBalance: 1_000_000n });
    const purchase = await buyDrop({ client, contractAddress: api.contractAddress }, seeded);
    expect(purchase.txId).toMatch(/^fake-/);
    expect(client.calls[0]).toEqual({ method: 'purchase', dropId: 1n, price: 1_000_000n });
    const [unlock] = await new DispatchPoller(api).poll([purchase]);
    expect(new TextDecoder().decode(unlock.content)).toBe('hello');
  });
});
