import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

const ADDR = 'ab'.repeat(32);
const base = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ CONTRACT_ADDRESS: ADDR, ...over });

describe('loadConfig', () => {
  it('defaults for undeployed', () => {
    const cfg = loadConfig(base());
    expect(cfg).toEqual({
      network: 'undeployed',
      contractAddress: ADDR,
      indexerUrl: 'http://127.0.0.1:8088/api/v4/graphql',
      indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
      dstackEndpoint: undefined,
      devSeedHex: undefined,
      dataDir: './data',
      port: 8080,
      pollMs: 3000,
    });
  });

  it('preprod endpoints', () => {
    const cfg = loadConfig(base({ NETWORK: 'preprod' }));
    expect(cfg.network).toBe('preprod');
    expect(cfg.indexerUrl).toBe('https://indexer.preprod.midnight.network/api/v4/graphql');
    expect(cfg.indexerWsUrl).toBe('wss://indexer.preprod.midnight.network/api/v4/graphql/ws');
  });

  it('missing CONTRACT_ADDRESS throws', () => {
    expect(() => loadConfig({})).toThrow(/CONTRACT_ADDRESS/);
  });

  it('malformed CONTRACT_ADDRESS throws', () => {
    expect(() => loadConfig({ CONTRACT_ADDRESS: 'zz' })).toThrow(/CONTRACT_ADDRESS/);
  });

  it('unknown NETWORK throws', () => {
    expect(() => loadConfig(base({ NETWORK: 'mainnet' }))).toThrow(/NETWORK/);
  });

  it('POLL_MS=abc throws', () => {
    expect(() => loadConfig(base({ POLL_MS: 'abc' }))).toThrow(/POLL_MS/);
  });

  it('POLL_MS=0 throws', () => {
    expect(() => loadConfig(base({ POLL_MS: '0' }))).toThrow(/POLL_MS/);
  });

  it('PORT=-1 throws', () => {
    expect(() => loadConfig(base({ PORT: '-1' }))).toThrow(/PORT/);
  });
});
