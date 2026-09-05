import { it, expect } from 'vitest';
import { formatNight } from '../src/price';
it('formats STAR as NIGHT', () => {
  expect(formatNight('1000000')).toBe('1');
  expect(formatNight('1500000')).toBe('1.5');
  expect(formatNight(1n)).toBe('0.000001');
  expect(formatNight('0')).toBe('0');
});
