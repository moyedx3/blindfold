import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WalletChoice } from '@blindfold/midnight-web';
import { MockDropApi } from '../src/mockApi';

// `FAKE` in session.ts is a module-level const computed from import.meta.env at load time, so
// each test that needs a specific FAKE value stubs the env first and re-imports the module fresh.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('openSession (FAKE mode)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FAKE_WALLET', '1');
  });

  it('sets midnight-js\'s network id from the mock indexer\'s /contract, and uses the real connectWallet path', async () => {
    vi.resetModules();
    const { installFakeConnector, getNetworkId, listWallets } = await import('@blindfold/midnight-web');
    const { openSession } = await import('../src/session');

    installFakeConnector();
    const [choice] = listWallets();
    expect(choice.name).toBe('Fake wallet (no chain)');

    const api = new MockDropApi();
    await api.seedDrop({ drop_id: 1, price_star: '1000000', title: 'demo', h_content: '' }, new TextEncoder().encode('hi'));

    const session = await openSession(api, choice);

    // MockDropApi.fetchContract() reports network: 'undeployed' — confirm setNetworkId ran with it.
    expect(getNetworkId()).toBe('undeployed');
    expect(session.network).toBe('undeployed');
    expect(session.contractAddress).toBe(api.contractAddress);
    // Went through the real connectWallet() path (not the old fakeConnectedWallet() shortcut):
    // the wallet's name comes from the injected connector, not a hardcoded 'fake'.
    expect(session.wallet.name).toBe('Fake wallet (no chain)');
  });
});

describe('openSession (real path)', () => {
  it('rejects a wallet on a different network than the drop contract, before touching providers/contract', async () => {
    vi.resetModules();
    // buildProviders/connectContract must never be reached on a network mismatch — override them
    // to throw loudly if they ever are, while keeping everything else (connectWallet, etc.) real.
    vi.doMock('@blindfold/midnight-web', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@blindfold/midnight-web')>();
      return {
        ...actual,
        buildProviders: vi.fn(async () => { throw new Error('buildProviders should not run on a network mismatch'); }),
        connectContract: vi.fn(async () => { throw new Error('connectContract should not run on a network mismatch'); }),
      };
    });
    const { openSession } = await import('../src/session');

    const api = new MockDropApi(); // fetchContract() reports network: 'undeployed'
    const mismatchedWalletApi = {
      name: 'lace', icon: 'data:,', apiVersion: '4.0.1',
      connect: async () => ({
        getConfiguration: async () => ({ networkId: 'preview', indexerUri: 'http://i', indexerWsUri: 'ws://i' }),
        getShieldedAddresses: async () => ({ shieldedAddress: 'mn_shield-addr_preview1x', shieldedCoinPublicKey: 'aa', shieldedEncryptionPublicKey: 'bb' }),
      }),
    };
    const choice: WalletChoice = { key: 'lace', name: 'lace', apiVersion: '4.0.1', api: mismatchedWalletApi as any };

    await expect(openSession(api, choice)).rejects.toThrow(/wallet is on preview.*undeployed/s);
    vi.doUnmock('@blindfold/midnight-web');
  });
});
