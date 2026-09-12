import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

describe('contract compiles', () => {
  it('produces artifacts for createDrop, purchase, withdraw, wrap, unwrap', () => {
    execFileSync('bash', ['scripts/compile.sh'], { cwd: root, stdio: 'inherit' });
    for (const c of ['createDrop', 'purchase', 'withdraw', 'wrap', 'unwrap']) {
      expect(existsSync(resolve(root, `build/blindfold/keys/${c}.prover`))).toBe(true);
      expect(existsSync(resolve(root, `build/blindfold/zkir/${c}.zkir`))).toBe(true);
    }
    const dts = readFileSync(resolve(root, 'build/blindfold/contract/index.d.ts'), 'utf8');
    expect(dts).toContain('kCommit');
    expect(dts).toContain('purchase(context');
    const js = readFileSync(resolve(root, 'build/blindfold/contract/index.js'), 'utf8');
    expect(js).toContain("checkRuntimeVersion('0.16.0')");
  });
});
