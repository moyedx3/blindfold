// THROWAWAY: print the blindfold ledger (no wallet needed).
import * as path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
setNetworkId('undeployed');
const addr = process.argv[2] ?? 'bd0a78a0add841c04aa31454f9fe4140ef443322cffb7c96b7998bd267d610a6';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const B = await import(pathToFileURL(path.join(__dirname, '..', 'contracts', 'managed', 'blindfold', 'contract', 'index.js')).href);
const pdp = indexerPublicDataProvider('http://127.0.0.1:8088/api/v4/graphql', 'ws://127.0.0.1:8088/api/v4/graphql/ws');
const cs = await pdp.queryContractState(addr); const L = B.ledger(cs!.data); const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
console.log('purchaseCount', L.purchaseCount.toString());
for (const [k, v] of L.purchases) console.log(`purchases[${k}] = ${hex(v)}  (drop ${L.purchaseDrop.lookup(k)})`);
for (const [k, v] of L.escrow) console.log(`escrow[${k}] = ${v.value} STAR @ mt_index ${v.mt_index}`);
process.exit(0);
