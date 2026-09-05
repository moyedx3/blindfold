// THROWAWAY spike wiring for the blindfold contract in the browser.
import { CompiledContract, type ProvableCircuitId } from '@midnight-ntwrk/compact-js';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js/types';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import * as Blindfold from '../contract/index';

export type PS = { secret: Uint8Array };
export type BlindfoldContract = Blindfold.Contract<PS>;
export type BlindfoldCircuits = ProvableCircuitId<BlindfoldContract>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BlindfoldProviders = MidnightProviders<BlindfoldCircuits, any, any>;

// The buyer never calls a circuit that uses the witness, but the contract declares one,
// so every party supplies an implementation. A buyer's "secret" is just unused randomness.
export const witnesses = {
  creatorSecret: (ctx: WitnessContext<Blindfold.Ledger, PS>): [PS, Uint8Array] => [ctx.privateState, ctx.privateState.secret],
};

export const CompiledBlindfold = CompiledContract.make<BlindfoldContract>('blindfold', Blindfold.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets('./contract/compiled/blindfold'),
);

export const ledger = Blindfold.ledger;
