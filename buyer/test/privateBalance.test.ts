import { describe, it, expect } from 'vitest';
import { canBuy, smallestTopUpCovering } from '../src/privateBalance';

describe('private balance helpers', () => {
  it('canBuy compares balance to price', () => {
    expect(canBuy(1_000_000n, 1_000_000n)).toBe(true);
    expect(canBuy(999_999n, 1_000_000n)).toBe(false);
  });
  it('suggests the smallest denomination that covers the shortfall', () => {
    expect(smallestTopUpCovering(1_000_000n, 0n)).toBe(5_000_000n);
    expect(smallestTopUpCovering(7_000_000n, 0n)).toBe(10_000_000n);
    expect(smallestTopUpCovering(7_000_000n, 4_000_000n)).toBe(5_000_000n);
    expect(smallestTopUpCovering(60_000_000n, 0n)).toBeNull();
  });
});
