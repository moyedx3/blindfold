import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
// rawTokenType comes from the midnight-js-protocol barrel, which re-exports ledger-v8 under a
// stable subpath; the contract workspace does not depend on @midnight-ntwrk/ledger-v8 directly.
import { rawTokenType } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { NetworkConfig } from './network';
import type { WalletContext } from './wallet';

export const BUILD_DIR = path.resolve(import.meta.dirname, '..', '..', 'build', 'blindfold');
export const NATIVE_COLOR = new Uint8Array(32);

// Must equal the Compact side: pad(32, "blindfold:bNIGHT").
export const PAYMENT_DOMAIN: Uint8Array = (() => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode('blindfold:bNIGHT'));
  return out;
})();
export const TOP_UP_DENOMINATIONS_STAR: readonly bigint[] = [5_000_000n, 10_000_000n, 50_000_000n];

const hexToBytes = (h: string) => new Uint8Array((h.replace(/^0x/, '').match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));

/** Hex color of the bNIGHT minted by the contract at `contractAddress` (ledger `tokenType(domainSep, contract)`). */
export function paymentColorHex(contractAddress: string): string {
  return rawTokenType(PAYMENT_DOMAIN, contractAddress).replace(/^0x/, '').toLowerCase();
}
export function paymentColor(contractAddress: string): Uint8Array {
  return hexToBytes(paymentColorHex(contractAddress));
}
/** A fresh bNIGHT coin description for `purchase` / `unwrap`; the wallet funds it from the caller's bNIGHT. */
export function paymentCoin(contractAddress: string, value: bigint) {
  return { nonce: crypto.getRandomValues(new Uint8Array(32)), color: paymentColor(contractAddress), value };
}

export type PrivateState = { secret: Uint8Array };

export const witnesses = {
  creatorSecret: (ctx: { privateState: PrivateState }): [PrivateState, Uint8Array] => [ctx.privateState, ctx.privateState.secret],
};

export async function loadContractModule() {
  return import(pathToFileURL(path.join(BUILD_DIR, 'contract', 'index.js')).href);
}

export async function loadCompiledContract() {
  const mod = await loadContractModule();
  return CompiledContract.make<any>('blindfold', mod.Contract).pipe(
    CompiledContract.withWitnesses(witnesses as any),
    CompiledContract.withCompiledFileAssets(BUILD_DIR),
  );
}

export function buildProviders(walletCtx: WalletContext, config: NetworkConfig, storeName = 'blindfold-scripts') {
  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      // A circuit that calls receiveUnshielded (wrap) is balanced with an unshielded input spending
      // the caller's NIGHT UTXO, and the node rejects an unshielded offer whose inputs are unsigned
      // (Malformed(InputsSignaturesLengthMismatch)). midnight-js-contracts offers no signing hook —
      // it goes straight from balanceTx to submitTx — so sign here. No-op when there are no
      // unshielded inputs, which is every other circuit.
      const signed = await walletCtx.wallet.signRecipe(recipe, (data: Uint8Array) =>
        walletCtx.unshieldedKeystore.signData(data),
      );
      return walletCtx.wallet.finalizeRecipe(signed);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };
  const zkConfigProvider = new NodeZkConfigProvider(BUILD_DIR);
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: storeName,
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      privateStoragePasswordProvider: () => process.env.PRIVATE_STATE_PASSWORD ?? 'Local-Devnet-Development-Placeholder-1',
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

export function nightCoin(value: bigint) {
  return { nonce: crypto.getRandomValues(new Uint8Array(32)), color: NATIVE_COLOR, value };
}
