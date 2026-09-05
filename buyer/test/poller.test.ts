import { describe, it, expect, vi } from 'vitest';
import { MockDropApi } from '../src/mockApi';
import { DispatchPoller } from '../src/poller';
import { createPurchase } from '../src/purchase';
import { sodiumReady, generateEphemeralKeypair } from '../src/seal';

describe('DispatchPoller against MockDropApi', () => {
  it('unlocks a purchase once its blob is dispatched', async () => {
    await sodiumReady();
    const api = new MockDropApi();
    const entry = await api.seedDrop({ drop_id: 9, price_star: '10', title: 'x', h_content: '' }, new TextEncoder().encode('the plaintext'));
    const purchase = await createPurchase(entry, api.contractAddress);
    const poller = new DispatchPoller(api);

    expect(await poller.poll([purchase])).toEqual([]);

    await api.dispatchFor(purchase.ePub, entry.drop_id);
    const unlocked = await poller.poll([purchase]);

    expect(unlocked).toHaveLength(1);
    expect(new TextDecoder().decode(unlocked[0].content)).toBe('the plaintext');
  });

  it('skips blobs sealed to someone else', async () => {
    await sodiumReady();
    const api = new MockDropApi();
    const entry = await api.seedDrop({ drop_id: 10, price_star: '10', title: 'x', h_content: '' }, new TextEncoder().encode('not for you'));
    const purchase = await createPurchase(entry, api.contractAddress);
    const stranger = await generateEphemeralKeypair();
    await api.dispatchFor(stranger.ePub, entry.drop_id);

    const getDispatchSpy = vi.spyOn(api, 'getDispatch');
    const poller = new DispatchPoller(api);

    expect(await poller.poll([purchase])).toEqual([]);
    expect(getDispatchSpy).toHaveBeenCalledTimes(1);

    expect(await poller.poll([purchase])).toEqual([]);
    expect(getDispatchSpy).toHaveBeenCalledTimes(1); // not refetched on the second pass
  });
});
