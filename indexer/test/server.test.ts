import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { Catalog } from '../src/catalog';
import { MemoryBucket } from '../src/bucket';
import { DevTee } from '../src/dstack';
import { StaticLedgerReader } from '../src/chain';
import { keypairFromSeed, sodiumReady, sha256, fromHex, toHex, concat } from '../src/keys';
import { sealProvision } from '../src/provision';

beforeAll(sodiumReady);
const seed = '88'.repeat(32);
const kDrop = fromHex('99'.repeat(32));
const content = new Uint8Array(64).fill(1);
const hContent = toHex(sha256(content));

function app() {
  const kp = keypairFromSeed(fromHex(seed));
  const reader = new StaticLedgerReader({ drops: new Map([[1n, 10n]]), kCommit: new Map([[1n, sha256(concat([kDrop, fromHex(hContent)]))]]), purchaseCount: 0n, purchases: new Map(), purchaseDrop: new Map() });
  const deps = { tee: new DevTee(seed), kp, catalog: new Catalog(), content: new MemoryBucket(), dispatch: new MemoryBucket(), reader, network: 'undeployed', contractAddress: 'ab'.repeat(32) };
  return { server: buildServer(deps), deps, kp };
}

describe('server', () => {
  it('GET /health, /contract, /attest', async () => {
    const { server, kp } = app();
    expect((await server.inject({ method: 'GET', url: '/health' })).body).toBe('ok');
    expect((await server.inject({ method: 'GET', url: '/contract' })).json()).toEqual({ network: 'undeployed', contract_address: 'ab'.repeat(32) });
    const a = (await server.inject({ method: 'GET', url: '/attest' })).json();
    expect(a).toEqual({ quote_hex: 'dev', provisioning_pubkey_hex: toHex(kp.publicKey) });
  });
  it('PUT /bucket verifies the hash; GET returns bytes; bad keys 400/404', async () => {
    const { server } = app();
    expect((await server.inject({ method: 'PUT', url: `/bucket/${hContent}`, payload: Buffer.from(content), headers: { 'content-type': 'application/octet-stream' } })).statusCode).toBe(200);
    expect((await server.inject({ method: 'PUT', url: `/bucket/${'00'.repeat(32)}`, payload: Buffer.from(content), headers: { 'content-type': 'application/octet-stream' } })).statusCode).toBe(400);
    const r = await server.inject({ method: 'GET', url: `/bucket/${hContent}` });
    expect(r.statusCode).toBe(200); expect(r.rawPayload.equals(Buffer.from(content))).toBe(true);
    expect((await server.inject({ method: 'GET', url: '/bucket/zz' })).statusCode).toBe(404);
  });
  it('POST /provision validates and publishes to the catalog', async () => {
    const { server, kp } = app();
    await server.inject({ method: 'PUT', url: `/bucket/${hContent}`, payload: Buffer.from(content), headers: { 'content-type': 'application/octet-stream' } });
    const payload = { drop_id: 1, price_star: '10', k_drop: toHex(kDrop), h_content: hContent, title: 'cat' };
    const ok = await server.inject({ method: 'POST', url: '/provision', payload: Buffer.from(sealProvision(payload, kp.publicKey)), headers: { 'content-type': 'application/octet-stream' } });
    expect(ok.statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/catalog' })).json()).toEqual([{ drop_id: 1, price_star: '10', title: 'cat', h_content: hContent }]);
    const wrongPrice = await server.inject({ method: 'POST', url: '/provision', payload: Buffer.from(sealProvision({ ...payload, price_star: '11' }, kp.publicKey)), headers: { 'content-type': 'application/octet-stream' } });
    expect(wrongPrice.statusCode).toBe(409);
    const unknown = await server.inject({ method: 'POST', url: '/provision', payload: Buffer.from(sealProvision({ ...payload, drop_id: 7 }, kp.publicKey)), headers: { 'content-type': 'application/octet-stream' } });
    expect(unknown.statusCode).toBe(404);
    const garbage = await server.inject({ method: 'POST', url: '/provision', payload: Buffer.from([1, 2, 3]), headers: { 'content-type': 'application/octet-stream' } });
    expect(garbage.statusCode).toBe(400);
  });
  it('GET /dispatch lists keys and serves blobs', async () => {
    const { server, deps } = app();
    await deps.dispatch.put('aa'.repeat(32), new Uint8Array(80));
    expect((await server.inject({ method: 'GET', url: '/dispatch' })).json()).toEqual(['aa'.repeat(32)]);
    expect((await server.inject({ method: 'GET', url: `/dispatch/${'aa'.repeat(32)}` })).rawPayload.length).toBe(80);
    expect((await server.inject({ method: 'GET', url: `/dispatch/${'bb'.repeat(32)}` })).statusCode).toBe(404);
  });
  it('sets CORS headers', async () => {
    const { server } = app();
    const r = await server.inject({ method: 'OPTIONS', url: '/catalog', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' } });
    expect(r.headers['access-control-allow-origin']).toBe('*');
  });
});
