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
