import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsBucket, MemoryBucket, isValidKey } from '../src/bucket';

for (const [name, make] of [
  ['FsBucket', () => new FsBucket(join(mkdtempSync(join(tmpdir(), 'bf-bucket-')), 'bucket'))],
  ['MemoryBucket', () => new MemoryBucket()],
] as const) {
  describe(name, () => {
    it('put/get/list/has roundtrip', async () => {
      const b = make();
      await b.put('deadbeef', new Uint8Array([1, 2, 3]));
      expect(Array.from((await b.get('deadbeef'))!)).toEqual([1, 2, 3]);
      expect(await b.get('cafe')).toBeNull();
      expect(await b.has('deadbeef')).toBe(true);
      expect(await b.list()).toEqual(['deadbeef']);
    });
    it('rejects non-hex and traversal keys', async () => {
      const b = make();
      for (const bad of ['../escape', '..', 'a/b', 'k1.txt', '/etc/passwd', '', 'g'.repeat(4), 'a'.repeat(129)]) {
        await expect(b.put(bad, new Uint8Array(1))).rejects.toThrow(/invalid bucket key/);
        expect(await b.get(bad)).toBeNull();
      }
    });
  });
}

it('FsBucket never writes outside its dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bf-trav-'));
  const b = new FsBucket(join(root, 'bucket'));
  await expect(b.put('../escape', new Uint8Array(1))).rejects.toThrow();
  expect(existsSync(join(root, 'escape'))).toBe(false);
});

it('isValidKey', () => {
  expect(isValidKey('00ff')).toBe(true);
  expect(isValidKey('00FF')).toBe(true);
  expect(isValidKey('zz')).toBe(false);
});
