import { describe, it, expect } from 'vitest';
import { FakeBlindfoldClient } from '../src/fake';

describe('FakeBlindfoldClient private balance', () => {
  it('starts at zero, wrap adds, purchase deducts, withdraw credits, unwrap deducts', async () => {
    const c = new FakeBlindfoldClient({ drops: new Map([[1n, 1_000_000n]]) });
    expect(await c.privateBalance()).toBe(0n);
    await expect(c.purchase(1n, new Uint8Array(32), 1_000_000n)).rejects.toThrow(/insufficient private balance/);
    await c.wrap(5_000_000n);
    expect(await c.privateBalance()).toBe(5_000_000n);
    await c.purchase(1n, new Uint8Array(32), 1_000_000n);
    expect(await c.privateBalance()).toBe(4_000_000n);
    await c.withdraw(0n);
    expect(await c.privateBalance()).toBe(5_000_000n);
    await c.unwrap(5_000_000n, 'mn_addr_undeployed1fake');
    expect(await c.privateBalance()).toBe(0n);
  });
  it('wrap refuses non-denominations and unwrap refuses more than the balance', async () => {
    const c = new FakeBlindfoldClient();
    await expect(c.wrap(7_000_000n)).rejects.toThrow(/top up 5, 10, or 50 NIGHT/);
    await expect(c.unwrap(1n, 'mn_addr_undeployed1fake')).rejects.toThrow(/insufficient private balance/);
  });
  it('can be seeded with a private balance and reports a color', () => {
    const c = new FakeBlindfoldClient({}, undefined, { privateBalance: 3_000_000n });
    expect(c.paymentTokenColor()).toMatch(/^[0-9a-f]{64}$/);
    return expect(c.privateBalance()).resolves.toBe(3_000_000n);
  });
});
