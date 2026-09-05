// Print the ledger of a deployed blindfold contract. Usage: tsx scripts/ledger.ts [address]
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { resolveNetwork, getDeployment } from './lib/network';
import { loadContractModule } from './lib/providers';

const { network, config } = resolveNetwork();
setNetworkId(network);
const address = process.argv[2] ?? getDeployment(network)?.address;
if (!address) throw new Error('no address given and no deployment recorded');
const mod = await loadContractModule();
const pdp = indexerPublicDataProvider(config.indexer, config.indexerWS);
const state = await pdp.queryContractState(address);
if (!state) throw new Error(`no contract state at ${address}`);
const L = mod.ledger(state.data);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
console.log('drops', [...L.drops].map(([k, v]: [bigint, bigint]) => `${k}=${v} STAR`).join(', ') || '(none)');
console.log('kCommit', [...L.kCommit].map(([k, v]: [bigint, Uint8Array]) => `${k}=${hex(v)}`).join(', ') || '(none)');
console.log('purchaseCount', L.purchaseCount.toString());
for (const [k, v] of L.purchases) console.log(`purchases[${k}] = ${hex(v)} (drop ${L.purchaseDrop.lookup(k)})`);
for (const [k, v] of L.escrow) console.log(`escrow[${k}] = ${v.value} STAR @ mt_index ${v.mt_index}`);
process.exit(0);
