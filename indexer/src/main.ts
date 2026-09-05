import { join } from 'node:path';
import { loadConfig } from './config';
import { connectTee } from './dstack';
import { keypairFromSeed, sodiumReady, toHex } from './keys';
import { FsBucket } from './bucket';
import { Catalog } from './catalog';
import { MidnightLedgerReader } from './chain';
import { Engine } from './engine';
import { DispatchedStore, Watcher } from './watcher';
import { buildServer } from './server';

await sodiumReady();
const cfg = loadConfig();
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

const tee = await connectTee({ endpoint: cfg.dstackEndpoint, devSeedHex: cfg.devSeedHex });
log(`tee: ${tee.isDev ? 'DEV (no attestation)' : 'dstack'}`);
const kp = keypairFromSeed(await tee.getKey('blindfold/provisioning'));
log(`provisioning pubkey ${toHex(kp.publicKey)}`);

const reader = new MidnightLedgerReader({ indexerUrl: cfg.indexerUrl, indexerWsUrl: cfg.indexerWsUrl, contractAddress: cfg.contractAddress, networkId: cfg.network });
const first = await reader.read(); // fails fast if the address has no state
log(`contract ${cfg.contractAddress} on ${cfg.network}: ${first.drops.size} drops, ${first.purchaseCount} purchases`);

const catalog = new Catalog();
const content = new FsBucket(join(cfg.dataDir, 'content'));
const dispatch = new FsBucket(join(cfg.dataDir, 'dispatch'));
const engine = new Engine(catalog, dispatch);
const watcher = new Watcher({ reader, engine, store: new DispatchedStore(join(cfg.dataDir, 'dispatched.json')), log });

const server = buildServer({ tee, kp, catalog, content, dispatch, reader, network: cfg.network, contractAddress: cfg.contractAddress });
await server.listen({ port: cfg.port, host: '0.0.0.0' });
log(`listening on :${cfg.port}`);
watcher.start(cfg.pollMs);

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { watcher.stop(); await server.close(); process.exit(0); });
