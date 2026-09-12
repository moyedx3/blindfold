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

// Lace tears down the remote proxy returned by connect() whenever its own window closes (the
// authorization tab after approval, and possibly a signing popup later): every call on the old object
// then fails with "Remote API with channel 'midnight-wallet' was shutdown: object can no longer be
// used". The authorization itself sticks, so a fresh connect() returns a live proxy without prompting.
// `resilientConnectedApi` hides this: any call that hits the shutdown error reconnects once and retries.
export const isProxyShutdown = (e: unknown) => /shutdown|no longer be used/i.test(e instanceof Error ? e.message : String(e));

export function resilientConnectedApi(initial: InitialAPI, networkId: string, first: ConnectedAPI): ConnectedAPI {
  let current = first;
  return new Proxy(first, {
    get(_target, prop) {
      const value = (current as any)[prop];
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        try {
          return await (current as any)[prop](...args);
        } catch (e) {
          if (!isProxyShutdown(e)) throw e;
          current = await initial.connect(networkId);
          return await (current as any)[prop](...args);
        }
      };
    },
  }) as ConnectedAPI;
}

// connect() itself can reject with the same shutdown error on the 'midnight-authenticator' channel when
// Lace closes its authorization window right after the user approves. The approval is stored, so a
// retry resolves without prompting again.
async function connectWithRetry(initial: InitialAPI, networkId: string, attempts = 3): Promise<ConnectedAPI> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await initial.connect(networkId);
    } catch (e) {
      if (!isProxyShutdown(e)) throw e;
      lastError = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastError;
}

export async function connectWallet(networkId: string, choice: WalletChoice): Promise<ConnectedWallet> {
  const api = resilientConnectedApi(choice.api, networkId, await connectWithRetry(choice.api, networkId));
  const cfg = await api.getConfiguration();
  const sh = await api.getShieldedAddresses();
  return {
    name: choice.name, api, networkId: cfg.networkId,
    indexerUri: cfg.indexerUri, indexerWsUri: cfg.indexerWsUri, proverServerUri: cfg.proverServerUri,
    shieldedAddress: sh.shieldedAddress, coinPublicKey: sh.shieldedCoinPublicKey, encryptionPublicKey: sh.shieldedEncryptionPublicKey,
  };
}

export async function balances(w: ConnectedWallet) {
  const [sh, un, dust] = await Promise.all([w.api.getShieldedBalances(), w.api.getUnshieldedBalances(), w.api.getDustBalance()]);
  return { shieldedNight: sh[NATIVE_RAW] ?? 0n, unshieldedNight: un[NATIVE_RAW] ?? 0n, dust: dust.balance, dustCap: dust.cap };
}

export async function unshieldedAddress(w: ConnectedWallet): Promise<string> {
  return (await w.api.getUnshieldedAddress()).unshieldedAddress;
}

export function explainWalletError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/6300|proof server|ECONNREFUSED/i.test(m)) return `Proof server unreachable. Lace needs the local proof server on port 6300 (docker run -p 6300:6300 midnightntwrk/proof-server:8.1.0). (${m})`;
  if (/dust/i.test(m)) return `Not enough DUST to pay the fee. Register NIGHT for DUST generation in the wallet and wait a few minutes. (${m})`;
  if (/insufficient/i.test(m)) return `Not enough private balance. Top up 5, 10, or 50 NIGHT and keep some DUST for the fee. (${m})`;
  if (/reject|denied|cancel/i.test(m)) return `The wallet rejected the request. (${m})`;
  return m;
}
