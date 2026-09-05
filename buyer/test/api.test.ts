import { describe, it, expect, vi } from 'vitest';
import { HttpDropApi } from '../src/api';

describe('HttpDropApi', () => {
  it('fetches contract info and catalog', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/contract')) return new Response(JSON.stringify({ network: 'undeployed', contract_address: 'ab'.repeat(32) }));
      if (url.endsWith('/catalog')) return new Response(JSON.stringify([{ drop_id: 1, price_star: '5', title: 't', h_content: 'cd'.repeat(32) }]));
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = new HttpDropApi('http://x/');
    expect((await api.fetchContract()).contract_address).toBe('ab'.repeat(32));
    expect((await api.fetchCatalog())[0].price_star).toBe('5');
    await expect(api.getContent('zz')).rejects.toThrow(/404/);
  });
});
