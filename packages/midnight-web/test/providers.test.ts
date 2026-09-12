import { describe, it, expect, vi } from 'vitest';
import { withPostBlockUpdate } from '../src/providers';

describe('withPostBlockUpdate', () => {
  it('runs postBlockUpdate on the zswap chain state and preserves the rest of the tuple', async () => {
    const postBlockUpdate = vi.fn((_now: Date) => 'updated');
    const raw = {
      other: 'kept',
      queryZSwapAndContractState: async (..._args: any[]) => [{ postBlockUpdate }, 'c', 'p'],
    };
    const wrapped = withPostBlockUpdate(raw);
    expect(wrapped.other).toBe('kept');
    const result = await wrapped.queryZSwapAndContractState('addr');
    expect(result).toEqual(['updated', 'c', 'p']);
    expect(postBlockUpdate).toHaveBeenCalledTimes(1);
    expect(postBlockUpdate.mock.calls[0][0]).toBeInstanceOf(Date);
  });

  it('passes a null result through unchanged', async () => {
    const raw = { queryZSwapAndContractState: async (..._args: any[]) => null };
    const wrapped = withPostBlockUpdate(raw);
    expect(await wrapped.queryZSwapAndContractState('addr')).toBeNull();
  });
});

import { chooseProofServer } from '../src/providers';
describe('chooseProofServer', () => {
  it('prefers the app override, then the wallet prover, then the fallback', () => {
    expect(chooseProofServer('https://lace-prover.example', { proofServerUrl: 'http://127.0.0.1:6300' })).toBe('http://127.0.0.1:6300');
    expect(chooseProofServer('https://lace-prover.example', {})).toBe('https://lace-prover.example');
    expect(chooseProofServer(undefined, { proofServerFallback: 'http://localhost:6300' })).toBe('http://localhost:6300');
    expect(chooseProofServer(undefined, { proofServerUrl: '' })).toBe('http://localhost:6300');
  });
});
