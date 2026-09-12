import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const src = resolve(import.meta.dirname, '../../contract/build/blindfold');
const dst = resolve(import.meta.dirname, '../public/contract/blindfold');
if (!existsSync(src)) { console.error('contract not compiled: run `npm run compile -w contract`'); process.exit(1); }
mkdirSync(dst, { recursive: true });
for (const d of ['zkir', 'keys', 'compiler']) cpSync(`${src}/${d}`, `${dst}/${d}`, { recursive: true });
console.log('copied contract artifacts to public/contract/blindfold');
