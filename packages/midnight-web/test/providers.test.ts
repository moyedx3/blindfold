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
