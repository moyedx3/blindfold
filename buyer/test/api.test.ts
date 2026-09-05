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

  it('fetches dispatch listings and bytes on the 200 path', async () => {
    const dispatchBytes = new Uint8Array([1, 2, 3, 4]);
    const contentBytes = new Uint8Array([9, 8, 7]);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/dispatch')) return new Response(JSON.stringify(['k1', 'k2']));
      if (url.endsWith('/dispatch/k1')) return new Response(dispatchBytes);
      if (url.endsWith('/bucket/deadbeef')) return new Response(contentBytes);
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = new HttpDropApi('http://x/');
    expect(await api.listDispatch()).toEqual(['k1', 'k2']);
    expect(new Uint8Array(await api.getDispatch('k1'))).toEqual(dispatchBytes);
    expect(new Uint8Array(await api.getContent('deadbeef'))).toEqual(contentBytes);
  });

  it('wraps a network-level fetch failure with a VITE_INDEXER_URL hint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const api = new HttpDropApi('http://unreachable/');
    await expect(api.fetchContract()).rejects.toThrow(/indexer unreachable at http:\/\/unreachable\/.*VITE_INDEXER_URL/);
  });
});
