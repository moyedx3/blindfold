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
    port: Number(env.PORT ?? 8080),
    pollMs: Number(env.POLL_MS ?? 3000),
  };
}
