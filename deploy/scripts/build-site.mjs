// Build one static site that hosts both apps: the buyer at / and the creator at /creator/.
// Values that the apps bake in at build time come from deploy/networks.json (preprod) unless
// overridden in the environment. Output: ./site (gitignored). Deploy with: npx vercel deploy site --prod
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const networks = JSON.parse(readFileSync(resolve(root, 'deploy', 'networks.json'), 'utf8'));
const preprod = networks.preprod ?? {};
const env = {
  ...process.env,
  VITE_INDEXER_URL: process.env.VITE_INDEXER_URL ?? preprod.indexer_url,
  VITE_EXPECTED_MEASUREMENT_HEX: process.env.VITE_EXPECTED_MEASUREMENT_HEX ?? preprod.measurement_rtmr3,
  VITE_PCCS_URL: process.env.VITE_PCCS_URL ?? 'https://pccs.phala.network',
  VITE_CREATOR_URL: process.env.VITE_CREATOR_URL ?? '/creator/',
  VITE_BUYER_URL: process.env.VITE_BUYER_URL ?? '/',
};
for (const key of ['VITE_INDEXER_URL', 'VITE_EXPECTED_MEASUREMENT_HEX']) {
  if (!env[key]) throw new Error(`${key} is not set and deploy/networks.json has no preprod value for it`);
}
console.log(`indexer ${env.VITE_INDEXER_URL}\nRTMR3   ${env.VITE_EXPECTED_MEASUREMENT_HEX}\nPCCS    ${env.VITE_PCCS_URL}`);

const run = (cmd) => execSync(cmd, { cwd: root, env, stdio: 'inherit' });
run('npm run build -w buyer');
run('npm run build -w creator -- --base=/creator/');

const site = resolve(root, 'site');
rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
cpSync(resolve(root, 'buyer', 'dist'), site, { recursive: true });
cpSync(resolve(root, 'creator', 'dist'), resolve(site, 'creator'), { recursive: true });
console.log(`site assembled at ${site} (buyer at /, creator at /creator/)`);
