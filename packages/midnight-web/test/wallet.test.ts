import { describe, it, expect } from 'vitest';
import { listWallets, explainWalletError, connectWallet, balances } from '../src/wallet';

const fakeApi = (name: string) => ({ name, icon: 'data:,', apiVersion: '4.0.1', connect: async () => connected });
const connected = {
  getConfiguration: async () => ({ networkId: 'undeployed', indexerUri: 'http://i', indexerWsUri: 'ws://i', proverServerUri: 'http://localhost:6300' }),
  getShieldedAddresses: async () => ({ shieldedAddress: 'mn_shield-addr_undeployed1x', shieldedCoinPublicKey: 'aa', shieldedEncryptionPublicKey: 'bb' }),
  getShieldedBalances: async () => ({ ['0'.repeat(64)]: 5n }),
  getUnshieldedBalances: async () => ({ ['0'.repeat(64)]: 7n }),
  getDustBalance: async () => ({ balance: 1n, cap: 9n }),
};

describe('listWallets', () => {
  it('returns only injected objects that look like Initial APIs', () => {
    const win = { midnight: { mnLace: fakeApi('lace'), junk: { name: 1 }, oneam: fakeApi('1am') } };
    expect(listWallets(win).map((w) => w.name).sort()).toEqual(['1am', 'lace']);
  });
  it('returns [] without window.midnight', () => { expect(listWallets({})).toEqual([]); });
});

describe('connectWallet', () => {
  it('connects and reads configuration and addresses', async () => {
    const w = await connectWallet('undeployed', { key: 'mnLace', name: 'lace', apiVersion: '4.0.1', api: fakeApi('lace') as any });
    expect(w.networkId).toBe('undeployed');
    expect(w.indexerUri).toBe('http://i');
    expect(w.coinPublicKey).toBe('aa');
    expect(w.shieldedAddress).toContain('mn_shield');
  });
});

describe('balances', () => {
  it('reads shielded/unshielded NIGHT and DUST from the connected wallet', async () => {
    const w = await connectWallet('undeployed', { key: 'mnLace', name: 'lace', apiVersion: '4.0.1', api: fakeApi('lace') as any });
    expect(await balances(w)).toEqual({ shieldedNight: 5n, unshieldedNight: 7n, dust: 1n, dustCap: 9n });
  });

  it('defaults NIGHT balances to 0n when the balance records are empty', async () => {
    const emptyConnected = { ...connected, getShieldedBalances: async () => ({}), getUnshieldedBalances: async () => ({}) };
    const emptyApi = { name: 'lace', icon: 'data:,', apiVersion: '4.0.1', connect: async () => emptyConnected };
    const w = await connectWallet('undeployed', { key: 'mnLace', name: 'lace', apiVersion: '4.0.1', api: emptyApi as any });
    const b = await balances(w);
    expect(b.shieldedNight).toBe(0n);
    expect(b.unshieldedNight).toBe(0n);
  });
});

describe('explainWalletError', () => {
  it('maps known failures to hints', () => {
    expect(explainWalletError(new Error('connect ECONNREFUSED 127.0.0.1:6300'))).toMatch(/proof server/i);
    expect(explainWalletError(new Error('Not enough Dust'))).toMatch(/DUST/);
    expect(explainWalletError(new Error('Insufficient Funds'))).toMatch(/NIGHT|DUST/);
    expect(explainWalletError(new Error('user rejected'))).toMatch(/rejected/i);
    expect(explainWalletError('boom')).toBe('boom');
  });
});

describe('connectWallet against a Lace proxy that shuts down after approval', () => {
  it('reconnects once when the first proxy reports shutdown', async () => {
    const live = {
      getConfiguration: async () => ({ networkId: 'preprod', indexerUri: 'http://i', indexerWsUri: 'ws://i' }),
      getShieldedAddresses: async () => ({ shieldedAddress: 'mn_shield-addr_preprod1x', shieldedCoinPublicKey: '11'.repeat(32), shieldedEncryptionPublicKey: '22'.repeat(32) }),
    };
    const dead = { getConfiguration: async () => { throw new Error("Remote API with channel 'midnight-wallet' was shutdown: object can no longer be used."); } };
    let calls = 0;
    const choice = { key: 'mnLace', name: 'Lace', apiVersion: '4.0.1', api: { connect: async () => (calls++ === 0 ? dead : live) } } as any;
    const w = await connectWallet('preprod', choice);
    expect(calls).toBe(2);
    expect(w.networkId).toBe('preprod');
    expect(w.coinPublicKey).toBe('11'.repeat(32));
  });

  it('reconnects on a later call too, e.g. when the signing popup killed the proxy', async () => {
    let shutdownOnce = true;
    const api = {
      getConfiguration: async () => ({ networkId: 'preprod', indexerUri: 'http://i', indexerWsUri: 'ws://i' }),
      getShieldedAddresses: async () => ({ shieldedAddress: 'a', shieldedCoinPublicKey: '11'.repeat(32), shieldedEncryptionPublicKey: '22'.repeat(32) }),
      submitTransaction: async (hex: string) => {
        if (shutdownOnce) { shutdownOnce = false; throw new Error("Remote API with channel 'midnight-wallet' was shutdown: object can no longer be used."); }
        return `submitted:${hex}`;
      },
    };
    let connects = 0;
    const choice = { key: 'mnLace', name: 'Lace', apiVersion: '4.0.1', api: { connect: async () => { connects++; return api; } } } as any;
    const w = await connectWallet('preprod', choice);
    expect(await w.api.submitTransaction('abcd')).toBe('submitted:abcd');
    expect(connects).toBe(2);
  });

  it('does not mask other connect errors', async () => {
    const choice = { key: 'mnLace', name: 'Lace', apiVersion: '4.0.1', api: { connect: async () => ({ getConfiguration: async () => { throw new Error('user rejected'); } }) } } as any;
    await expect(connectWallet('preprod', choice)).rejects.toThrow(/user rejected/);
  });
});
