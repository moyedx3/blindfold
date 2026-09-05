import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Bucket } from './bucket';
import { isValidKey } from './bucket';
import type { Catalog } from './catalog';
import type { LedgerReader } from './chain';
import type { Tee } from './dstack';
import { buildAttestResponse } from './attest';
import { sha256, toHex, type Keypair } from './keys';
import { openProvision, validateProvision, ProvisionError } from './provision';

export type ServerDeps = {
  tee: Tee; kp: Keypair; catalog: Catalog; content: Bucket; dispatch: Bucket; reader: LedgerReader;
  network: string; contractAddress: string;
};

const STATUS: Record<ProvisionError['code'], number> = {
  bad_seal: 400, bad_payload: 400, unknown_drop: 404, content_missing: 404, price_mismatch: 409, commit_mismatch: 409,
};

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ bodyLimit: 50 * 1024 * 1024, logger: false });
  app.register(cors, { origin: '*', methods: ['GET', 'PUT', 'POST', 'OPTIONS'] });
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.get('/health', async () => 'ok');
  app.get('/contract', async () => ({ network: deps.network, contract_address: deps.contractAddress }));
  app.get('/attest', async (_req, reply) => {
    try { return await buildAttestResponse(deps.tee, deps.kp); }
    catch (e) { reply.code(503); return { error: (e as Error).message }; }
  });
  app.get('/catalog', async () => deps.catalog.publicEntries());

  app.post('/provision', async (req, reply) => {
    const body = req.body as Buffer | undefined;
    if (!body || !Buffer.isBuffer(body)) { reply.code(400); return { error: 'expected application/octet-stream body' }; }
    try {
      const payload = openProvision(new Uint8Array(body), deps.kp);
      const cfg = await validateProvision(payload, await deps.reader.read(), deps.content);
      deps.catalog.upsert(cfg);
      return { ok: true, drop_id: payload.drop_id };
    } catch (e) {
      if (e instanceof ProvisionError) { reply.code(STATUS[e.code]); return { error: e.code, message: e.message }; }
      reply.code(500); return { error: 'internal' };
    }
  });

  app.get('/dispatch', async () => deps.dispatch.list());
  app.get<{ Params: { key: string } }>('/dispatch/:key', async (req, reply) => {
    const b = await deps.dispatch.get(req.params.key);
    if (!b) { reply.code(404); return { error: 'not found' }; }
    reply.type('application/octet-stream'); return Buffer.from(b);
  });

  app.get<{ Params: { key: string } }>('/bucket/:key', async (req, reply) => {
    const b = await deps.content.get(req.params.key);
    if (!b) { reply.code(404); return { error: 'not found' }; }
    reply.type('application/octet-stream'); return Buffer.from(b);
  });
  app.put<{ Params: { key: string } }>('/bucket/:key', async (req, reply) => {
    const body = req.body as Buffer | undefined;
    const key = req.params.key.toLowerCase();
    if (!body || !Buffer.isBuffer(body) || !isValidKey(key) || key.length !== 64) { reply.code(400); return { error: 'key must be sha256 hex and body octet-stream' }; }
    if (toHex(sha256(new Uint8Array(body))) !== key) { reply.code(400); return { error: 'body sha256 does not match key' }; }
    await deps.content.put(key, new Uint8Array(body));
    return { ok: true };
  });
  return app;
}
