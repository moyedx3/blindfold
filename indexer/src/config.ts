export type Config = {
  network: 'undeployed' | 'preview' | 'preprod';
  contractAddress: string;
  indexerUrl: string;
  indexerWsUrl: string;
  dstackEndpoint?: string;
  devSeedHex?: string;
  dataDir: string;
  port: number;
  pollMs: number;
};

const DEFAULTS: Record<Config['network'], { indexerUrl: string; indexerWsUrl: string }> = {
  undeployed: { indexerUrl: 'http://127.0.0.1:8088/api/v4/graphql', indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws' },
  preview: { indexerUrl: 'https://indexer.preview.midnight.network/api/v4/graphql', indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws' },
  preprod: { indexerUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql', indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws' },
};

function positiveIntEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} must be a positive integer, got ${raw}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const network = (env.NETWORK ?? 'undeployed') as Config['network'];
  if (!(network in DEFAULTS)) throw new Error(`NETWORK must be undeployed|preview|preprod, got ${network}`);
  const contractAddress = env.CONTRACT_ADDRESS?.trim();
  if (!contractAddress || !/^[0-9a-fA-F]{64}$/.test(contractAddress)) throw new Error('CONTRACT_ADDRESS must be 64 hex chars');
  return {
    network, contractAddress,
    indexerUrl: env.MIDNIGHT_INDEXER_URL ?? DEFAULTS[network].indexerUrl,
    indexerWsUrl: env.MIDNIGHT_INDEXER_WS_URL ?? DEFAULTS[network].indexerWsUrl,
    dstackEndpoint: env.DSTACK_ENDPOINT,
    devSeedHex: env.DEV_SEED_HEX,
    dataDir: env.DATA_DIR ?? './data',
    port: positiveIntEnv(env, 'PORT', 8080),
    pollMs: positiveIntEnv(env, 'POLL_MS', 3000),
  };
}
