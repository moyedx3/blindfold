// THROWAWAY probe: print token types, wallet state shape, and shielded address for the genesis wallet.
import { WebSocket } from 'ws';
// @ts-expect-error polyfill
globalThis.WebSocket = WebSocket;
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { resolveNetwork, GENESIS_SEED } from './network';
import { createWallet, persistWalletState } from './wallet';

const { network, config } = resolveNetwork();
console.log('nativeToken   =', JSON.stringify(ledger.nativeToken()));
console.log('shieldedToken =', JSON.stringify(ledger.shieldedToken()));
console.log('unshieldedTok =', JSON.stringify(ledger.unshieldedToken()));
console.log('feeToken      =', JSON.stringify(ledger.feeToken()));
try { console.log('createShieldedCoinInfo(native.raw) =', JSON.stringify(ledger.createShieldedCoinInfo(ledger.nativeToken().raw, 5n), (_k, v) => typeof v === 'bigint' ? v.toString() : v)); } catch (e) { console.log('createShieldedCoinInfo(native.raw) threw:', (e as Error).message); }
try { console.log('createShieldedCoinInfo(shielded.raw) =', JSON.stringify(ledger.createShieldedCoinInfo(ledger.shieldedToken().raw, 5n), (_k, v) => typeof v === 'bigint' ? v.toString() : v)); } catch (e) { console.log('createShieldedCoinInfo(shielded.raw) threw:', (e as Error).message); }

const ctx = await createWallet({ network, networkConfig: config, seed: GENESIS_SEED });
const state = await ctx.wallet.waitForSyncedState();
await persistWalletState(network, ctx);
console.log('state keys        =', Object.keys(state));
console.log('state.shielded keys =', Object.keys(state.shielded as any));
console.log('shielded balances =', JSON.stringify((state.shielded as any).balances, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
console.log('unshielded balances =', JSON.stringify((state.unshielded as any).balances, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
console.log('shielded address? =', String((state.shielded as any).address ?? '(none)'));
console.log('coinPublicKey     =', ctx.shieldedSecretKeys.coinPublicKey);
console.log('encryptionPublicKey =', ctx.shieldedSecretKeys.encryptionPublicKey);
console.log('facade.shielded keys =', Object.keys((ctx.wallet as any).shielded ?? {}));
console.log('dust balance      =', state.dust.balance(new Date()).toString());
await ctx.wallet.stop();
