import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';

export const NATIVE_RAW = '0'.repeat(64);

export type WalletChoice = { key: string; name: string; apiVersion: string; api: InitialAPI };

export function listWallets(win: { midnight?: Record<string, unknown> } = globalThis as any): WalletChoice[] {
  const injected = win.midnight;
  if (!injected) return [];
  const out: WalletChoice[] = [];
  for (const [key, v] of Object.entries(injected)) {
    const c = v as any;
    if (c && typeof c === 'object' && typeof c.name === 'string' && typeof c.apiVersion === 'string' && typeof c.connect === 'function') {
      out.push({ key, name: c.name, apiVersion: c.apiVersion, api: c as InitialAPI });
    }
  }
  return out;
}

export type ConnectedWallet = {
  name: string; api: ConnectedAPI; networkId: string;
  indexerUri: string; indexerWsUri: string; proverServerUri?: string;
  shieldedAddress: string; coinPublicKey: string; encryptionPublicKey: string;
};

export async function connectWallet(networkId: string, choice: WalletChoice): Promise<ConnectedWallet> {
  const api = await choice.api.connect(networkId);
  const cfg = await api.getConfiguration();
  const sh = await api.getShieldedAddresses();
  return {
    name: choice.name, api, networkId: cfg.networkId,
    indexerUri: cfg.indexerUri, indexerWsUri: cfg.indexerWsUri, proverServerUri: (cfg as any).proverServerUri,
    shieldedAddress: sh.shieldedAddress, coinPublicKey: sh.shieldedCoinPublicKey, encryptionPublicKey: sh.shieldedEncryptionPublicKey,
  };
}

export async function balances(w: ConnectedWallet) {
  const [sh, un, dust] = await Promise.all([w.api.getShieldedBalances(), w.api.getUnshieldedBalances(), w.api.getDustBalance()]);
  return { shieldedNight: sh[NATIVE_RAW] ?? 0n, unshieldedNight: un[NATIVE_RAW] ?? 0n, dust: dust.balance, dustCap: dust.cap };
}

export function explainWalletError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/6300|proof server|ECONNREFUSED/i.test(m)) return `Proof server unreachable. Lace needs the local proof server on port 6300 (docker run -p 6300:6300 midnightntwrk/proof-server:8.1.0). (${m})`;
  if (/dust/i.test(m)) return `Not enough DUST to pay the fee. Register NIGHT for DUST generation in the wallet and wait a few minutes. (${m})`;
  if (/insufficient/i.test(m)) return `Insufficient funds: you need shielded NIGHT for the price plus DUST for the fee. (${m})`;
  if (/reject|denied|cancel/i.test(m)) return `The wallet rejected the request. (${m})`;
  return m;
}
