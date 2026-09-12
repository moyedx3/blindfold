# Lane D: Deploy, Docs, and Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Blindfold runnable by a judge in ten minutes on a local devnet, deployed for the demo on Preprod with the indexer inside a Phala CVM, and packaged for the hackathon submission (README, demo flow, video, checklist).

**Architecture:** One compose file runs the Midnight devnet; one script compiles, deploys the contract, starts the indexer in dev mode, and seeds a demo drop without any browser. Preprod uses the same scripts with a faucet-funded wallet. The CVM runs the indexer image from Lane A with the dstack socket mounted; its measurement is captured once and pinned in the creator app's environment.

**Tech Stack:** Docker Compose v2, Midnight node 1.0.0 / indexer-standalone 4.3.3 / proof-server 8.1.0, Phala Cloud CLI (`npx phala`), GitHub Container Registry, bash, tsx.

**Spec:** `docs/superpowers/specs/2026-09-05-blindfold-design.md` (sections 10, 12, 13)

> **Implementation note (2026-09-08):** Lane D is implemented on `lane-d`, based on `origin/lane-c`, and
> locally verified. The implementation intentionally corrects several stale snippets below: creator ports
> are 5175/5176; ephemeral local addresses go to gitignored `.local/networks.json`; creator recovery material
> is mode-0600 instead of printed; clean-wallet deployment registers and waits for DUST; Phala uses the
> current `phala login` / `phala deploy -n ... -c ... -e .env -t tdx.small --wait` interface; images are
> pinned by digest; and live smoke verifies QVL status, RTMR3, and report-data key binding. Treat the checked-in
> implementation and `deploy/README.md` as authoritative where they differ from the original task sketches.
> `spike/` is retained until Lane C and Lane D have merged in order.

## Global Constraints

- Everything in Lane A's Global Constraints applies (versions, PATH for Docker Desktop, genesis seed, override).
- Images (exact): `midnightntwrk/midnight-node:1.0.0`, `midnightntwrk/indexer-standalone:4.3.3`, `midnightntwrk/proof-server:8.1.0`. Never a `latest` tag.
- Ports: node 9944, Midnight indexer 8088, proof server 6300 (Lace hardcodes 6300 for Undeployed), Blindfold indexer 8080, buyer 5173, creator 5174.
- Public endpoints: Preprod node `https://rpc.preprod.midnight.network`, indexer `https://indexer.preprod.midnight.network/api/v4/graphql` (ws: `wss://…/api/v4/graphql/ws`), faucet `https://midnight-tmnight-preprod.nethermind.dev/`, explorer `https://preprod.midnightexplorer.com/`.
- Secrets never enter git: `.midnight-state.json` (wallet seeds), `DEV_SEED_HEX` only in local env files, Phala API tokens only in the shell. Preprod deployment wallets are created from a mnemonic kept by the owner outside the repo.
- Submission requirements (hackathon page): public GitHub repo with a README, "how to run or a demo flow", optional demo video, and a section on how Midnight is used. Judges clone, compile, and check the README matches.
- Deadline: 2026-09-28 00:00 KST. Fund demo wallets by 2026-09-24 so DUST has accrued.

---

## File structure

```
deploy/
  README.md                       runbooks: local, Preprod, Phala CVM, troubleshooting
  devnet/docker-compose.yml       Midnight local devnet (node, indexer, proof server)
  networks.json                   contract addresses per network (committed; no secrets)
  scripts/demo-local.sh           compile -> devnet up -> deploy -> indexer -> seed drop -> print URLs
  scripts/seed-demo.ts            registers a demo drop on-chain and provisions it (no browser)
  scripts/wait-http.sh            poll a URL until 200
  cvm/docker-compose.yml          indexer service for Phala Cloud
  cvm/phala.toml                  CLI defaults for the CVM
.github/workflows/ci.yml          install, compile, unit tests, type-checks
README.md                         submission README
docs/demo-script.md               the 3-minute demo, step by step
```

---

### Task 1: Devnet compose and local runbook

**Files:**
- Create: `deploy/devnet/docker-compose.yml`, `deploy/scripts/wait-http.sh`, `deploy/README.md` (local section)
- Modify: root `package.json` scripts

- [ ] **Step 1: Compose file**

Copy `spike/hello/docker-compose.yml` to `deploy/devnet/docker-compose.yml` and change `name: hello-devnet` to `name: blindfold-devnet` and the three `container_name` values to `blindfold-node`, `blindfold-indexer`, `blindfold-proof-server`. Keep every comment; they document real version traps.

- [ ] **Step 2: Root scripts**

Add to the root `package.json` `scripts`:

```json
"devnet:up": "docker compose -f deploy/devnet/docker-compose.yml up -d --wait",
"devnet:down": "docker compose -f deploy/devnet/docker-compose.yml down",
"devnet:reset": "docker compose -f deploy/devnet/docker-compose.yml down -v",
"demo:local": "bash deploy/scripts/demo-local.sh"
```

`deploy/scripts/wait-http.sh`:

```bash
#!/usr/bin/env bash
# usage: wait-http.sh <url> [seconds]
url="$1"; secs="${2:-120}"
for i in $(seq 1 "$secs"); do
  if curl -sf "$url" >/dev/null 2>&1; then echo "ready: $url"; exit 0; fi
  sleep 1
done
echo "timeout waiting for $url" >&2; exit 1
```

- [ ] **Step 3: Verify**

Run:
```bash
export PATH="$HOME/.docker/bin:$HOME/.local/bin:$PATH"
docker compose -f deploy/devnet/docker-compose.yml config >/dev/null && echo "compose ok"
npm run devnet:up
bash deploy/scripts/wait-http.sh http://127.0.0.1:6300/health 60
curl -s -H 'content-type: application/json' -d '{"id":1,"jsonrpc":"2.0","method":"system_chain","params":[]}' http://127.0.0.1:9944
```
Expected: `compose ok`; three containers healthy; `/health` returns `{"status":"ok",…}`; the node answers with a chain name.

- [ ] **Step 4: Local runbook** in `deploy/README.md`:

```markdown
# Deploy and run

## Local devnet (10 minutes)

Prerequisites: Docker Desktop running, Node 22+, Compact 0.31.1 (`compact update 0.31.1`),
`export PATH="$HOME/.docker/bin:$HOME/.local/bin:$PATH"`.

1. `npm install && npm run check:runtime-copies`
2. `npm run demo:local`   — compiles the contract, starts the devnet, deploys the contract, starts the
   indexer in dev mode on :8080, registers and provisions a demo drop, and prints the URLs and env.
3. Buyer without a wallet: `cd buyer && VITE_FAKE_WALLET=1 npm run dev` (fake wallet, mock indexer).
4. Buyer with Lace on the devnet: install Lace, Settings > Midnight > network Undeployed, proof server
   Local; fund it with `npm run fund -w contract -- <mn_addr…> <mn_shield-addr…> 1000`; press
   "Generate tDUST" in Lace; then `cd buyer && VITE_INDEXER_URL=http://localhost:8080 npm run dev`.
5. Creator: `cd creator && VITE_INDEXER_URL=http://localhost:8080 npm run dev`, connect Lace, tick
   "dev mode" (the local indexer has no TEE), register a drop.

Reset everything: `npm run devnet:reset` (drops the chain; redeploy afterwards).
```

- [ ] **Step 5: Commit** — `git add deploy package.json && git commit -m "deploy: local devnet compose, root scripts, local runbook"`

---

### Task 2: One-shot local demo script and headless seeding

**Files:**
- Create: `deploy/scripts/demo-local.sh`, `deploy/scripts/seed-demo.ts`, `deploy/networks.json`

**Interfaces:**
- Consumes: `contract/scripts/lib/*` and `contract/scripts/deploy.ts` (Lane A Task 2), indexer `sealProvision` (Lane A Task 9), indexer HTTP (Lane A Task 12).
- Produces: `deploy/networks.json` `{ "undeployed": { "contract_address": "…" }, "preprod": { "contract_address": "…", "indexer_url": "…" } }` read by the runbooks; a running local stack with one provisioned drop.

- [ ] **Step 1: `deploy/scripts/seed-demo.ts`**

```ts
// Register and provision a demo drop with no browser: creator secret from env or random,
// content from a file or a default text. Usage:
//   tsx deploy/scripts/seed-demo.ts --indexer http://localhost:8080 [--file path] [--title "…"] [--price-night 1]
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { WebSocket } from 'ws';
// @ts-expect-error polyfill
globalThis.WebSocket = WebSocket;
import sodium from 'libsodium-wrappers';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { resolveNetwork, getOrCreateWallet, getDeployment } from '../../contract/scripts/lib/network';
import { createWallet, persistWalletState } from '../../contract/scripts/lib/wallet';
import { buildProviders, loadCompiledContract, loadContractModule } from '../../contract/scripts/lib/providers';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const indexer = arg('--indexer', 'http://localhost:8080')!;
const title = arg('--title', 'Blindfold demo drop')!;
const priceStar = BigInt(Math.round(Number(arg('--price-night', '1')) * 1_000_000));
const plaintext = arg('--file') ? new Uint8Array(readFileSync(arg('--file')!)) : new TextEncoder().encode('Hello from Blindfold. You paid with shielded NIGHT and nobody knows it was you.');

await sodium.ready;
const { network, config } = resolveNetwork();
const address = getDeployment(network)?.address; if (!address) throw new Error('deploy the contract first');
const secret = process.env.CREATOR_SECRET_HEX ? Buffer.from(process.env.CREATOR_SECRET_HEX, 'hex') : randomBytes(32);

// 1) encrypt (same layout as the creator app: nonce(12) || AES-256-GCM || tag(16))
const kDrop = randomBytes(32), nonce = randomBytes(12);
const key = await webcrypto.subtle.importKey('raw', kDrop, 'AES-GCM', false, ['encrypt']);
const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, plaintext));
const blob = Buffer.concat([nonce, Buffer.from(ct)]);
const hContent = createHash('sha256').update(blob).digest('hex');
const up = await fetch(`${indexer}/bucket/${hContent}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: blob });
if (!up.ok) throw new Error(`upload failed ${up.status}`);

// 2) createDrop on-chain
const w = await createWallet({ network, networkConfig: config, seed: getOrCreateWallet(network).seed });
await w.wallet.waitForSyncedState(); await persistWalletState(network, w);
const providers = buildProviders(w, config, 'blindfold-seed');
const mod = await loadContractModule();
const found: any = await findDeployedContract(providers, { compiledContract: await loadCompiledContract(), contractAddress: address, privateStateId: `seed-${address.slice(0, 8)}`, initialPrivateState: { secret } });
const view = mod.ledger((await providers.publicDataProvider.queryContractState(address))!.data);
let dropId = 1n; for (const [k] of view.drops) if (k >= dropId) dropId = k + 1n;
const commit = createHash('sha256').update(Buffer.concat([kDrop, Buffer.from(hContent, 'hex')])).digest();
const tx = await found.callTx.createDrop(dropId, priceStar, new Uint8Array(commit));
console.log(`createDrop(${dropId}) tx ${tx.public.txId}`);

// 3) attest (dev quote accepted here; this script is for local demos and trusted operators) + provision
const att = await (await fetch(`${indexer}/attest`)).json();
const enclavePub = Buffer.from(att.provisioning_pubkey_hex, 'hex');
const payload = { drop_id: Number(dropId), price_star: priceStar.toString(), k_drop: kDrop.toString('hex'), h_content: hContent, title };
const sealed = sodium.crypto_box_seal(new TextEncoder().encode(JSON.stringify(payload)), enclavePub);
const pr = await fetch(`${indexer}/provision`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: sealed });
console.log(`provision -> ${pr.status} ${await pr.text()}`);
console.log(`CREATOR_SECRET_HEX=${secret.toString('hex')}  (keep to withdraw drop ${dropId})`);
await w.wallet.stop(); process.exit(pr.ok ? 0 : 1);
```

Add `libsodium-wrappers` to the root `devDependencies` so the script resolves it.

- [ ] **Step 2: `deploy/scripts/demo-local.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.docker/bin:$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/../.."
DEV_SEED_HEX="${DEV_SEED_HEX:-1111111111111111111111111111111111111111111111111111111111111111}"
DATA_DIR="${DATA_DIR:-$PWD/.local/indexer-data}"

echo "== 1/5 compile contract"; npm run compile -w contract
echo "== 2/5 devnet up";        npm run devnet:up
bash deploy/scripts/wait-http.sh http://127.0.0.1:6300/health 120
echo "== 3/5 deploy contract";  (cd contract && npm run deploy) | tee /tmp/blindfold-deploy.log
ADDR=$(grep -o 'CONTRACT_ADDRESS=[0-9a-f]*' /tmp/blindfold-deploy.log | cut -d= -f2)
node -e "const f='deploy/networks.json';const fs=require('fs');const j=fs.existsSync(f)?JSON.parse(fs.readFileSync(f)):{};j.undeployed={contract_address:'$ADDR'};fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
echo "== 4/5 indexer (dev mode) on :8080"
mkdir -p "$DATA_DIR"
( cd indexer && NETWORK=undeployed CONTRACT_ADDRESS="$ADDR" DEV_SEED_HEX="$DEV_SEED_HEX" DATA_DIR="$DATA_DIR" PORT=8080 npm start > "$DATA_DIR/indexer.log" 2>&1 & echo $! > "$DATA_DIR/indexer.pid" )
bash deploy/scripts/wait-http.sh http://127.0.0.1:8080/health 60
echo "== 5/5 seed a demo drop"; npx tsx deploy/scripts/seed-demo.ts --indexer http://127.0.0.1:8080
cat <<EOF

Local stack is up.
  contract  $ADDR (deploy/networks.json)
  indexer   http://127.0.0.1:8080   (log: $DATA_DIR/indexer.log, stop: kill \$(cat $DATA_DIR/indexer.pid))
  buyer     cd buyer   && VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev   -> http://127.0.0.1:5173
  creator   cd creator && VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev   -> http://127.0.0.1:5174
EOF
```

- [ ] **Step 3: Verify end to end**

Run `npm run demo:local` from a clean state (`npm run devnet:reset` first). Expected: five stages print, `provision -> 200`, and `curl -s localhost:8080/catalog` lists the demo drop. Then buy it with Lace in the buyer app; the indexer log prints `dispatched purchase 0`. Time the whole script and write the number into `deploy/README.md`.

- [ ] **Step 4: Commit** — `git add deploy package.json && git commit -m "deploy: one-shot local demo script with headless drop seeding"`

---

### Task 3: Preprod deployment and runbook

**Files:**
- Modify: `deploy/networks.json` (preprod entry), `deploy/README.md` (Preprod section)

- [ ] **Step 1: Fund a deployment wallet**

```bash
cd contract && npm run deploy -- --network preprod
```
The first run generates a 24-word mnemonic (printed once, stored in the gitignored `.midnight-state.json`) and waits for tNIGHT. Paste the printed `mn_addr_preprod1…` into the Preprod faucet, wait for the balance, then the script registers NIGHT for DUST and waits for DUST (this can take from minutes to hours on a fresh wallet; leave it running). The owner backs up the mnemonic outside the repo.

- [ ] **Step 2: Record the address and the indexer config**

Add to `deploy/networks.json`:

```json
"preprod": {
  "contract_address": "<printed address>",
  "midnight_indexer_url": "https://indexer.preprod.midnight.network/api/v4/graphql",
  "midnight_indexer_ws_url": "wss://indexer.preprod.midnight.network/api/v4/graphql/ws"
}
```

Verify: `cd contract && npm run ledger -- --network preprod` prints `purchaseCount 0`, and the explorer shows the deployment transaction.

- [ ] **Step 3: Preprod runbook** in `deploy/README.md`:

```markdown
## Preprod (demo network)

Contract: see `deploy/networks.json`. Deployed once by the owner with `npm run deploy -w contract -- --network preprod`.

Wallet preparation for everyone who will demo (do this at least one day ahead):
1. Lace on Preprod: request tNIGHT at the faucet with the `mn_addr_preprod1…` address (1000 tNIGHT per request).
2. Press "Generate tDUST"; wait until the DUST tank shows a balance.
3. Move NIGHT to the shielded side (Lace: send to your own shielded address) so purchases can be paid shielded.

Indexer: runs in the Phala CVM (next section). Apps: `VITE_INDEXER_URL=https://<cvm-host>` for both apps;
creator also needs `VITE_EXPECTED_MEASUREMENT_HEX` (the CVM's RTMR3 recorded below).
```

- [ ] **Step 4: Commit** — `git add deploy && git commit -m "deploy: preprod contract address and wallet runbook"`

---

### Task 4: Phala CVM deployment

**Files:**
- Create: `deploy/cvm/docker-compose.yml`, `deploy/cvm/phala.toml`
- Modify: `deploy/README.md` (Phala section), `deploy/networks.json` (`preprod.indexer_url`, `preprod.measurement_rtmr3`)

- [ ] **Step 1: Build and push the indexer image**

```bash
npm run compile -w contract
docker build -f indexer/Dockerfile -t ghcr.io/moyedx3/blindfold-indexer:0.1.0 .
echo "$GHCR_TOKEN" | docker login ghcr.io -u moyedx3 --password-stdin
docker push ghcr.io/moyedx3/blindfold-indexer:0.1.0
```
Make the package public in the GitHub UI (Packages → blindfold-indexer → visibility) so the CVM can pull it without credentials.

- [ ] **Step 2: Compose for the CVM**

`deploy/cvm/docker-compose.yml`:

```yaml
services:
  indexer:
    image: ghcr.io/moyedx3/blindfold-indexer:0.1.0
    ports: ["8080:8080"]
    environment:
      NETWORK: preprod
      CONTRACT_ADDRESS: ${CONTRACT_ADDRESS}
      DATA_DIR: /data
      PORT: "8080"
      POLL_MS: "5000"
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock
      - indexer-data:/data
    restart: unless-stopped
volumes:
  indexer-data: {}
```

`deploy/cvm/phala.toml`:

```toml
name = "blindfold-indexer"
compose = "docker-compose.yml"
vcpu = 2
memory = 2048
disk = 20
```

- [ ] **Step 3: Deploy**

```bash
npx phala auth login                     # paste the API token from the Phala Cloud dashboard
cd deploy/cvm && CONTRACT_ADDRESS=$(node -p "require('../networks.json').preprod.contract_address") npx phala deploy -e CONTRACT_ADDRESS
npx phala cvms ls                         # note the app id and the public URL
npx phala logs --cvm-id <id> | tail -20   # expect "tee: dstack", "provisioning pubkey …", "listening on :8080"
```
Verify from outside: `curl -s https://<cvm-url>/attest | head -c 200` returns a long `quote_hex` (not `dev`) and `curl -s https://<cvm-url>/contract` returns the Preprod address.

- [ ] **Step 4: Capture the measurement and pin it**

```bash
npx phala cvms attestation --cvm-id <id> --json > /tmp/attestation.json
node -e "const a=require('/tmp/attestation.json');console.log(JSON.stringify(a).match(/rtmr3[^,]*/)?.[0])"
```
Record the RTMR3 value in `deploy/networks.json` as `preprod.measurement_rtmr3` and the URL as `preprod.indexer_url`. The creator app is started with `VITE_EXPECTED_MEASUREMENT_HEX=<rtmr3>`; verify end to end by registering a drop from the creator app against the CVM (attestation must pass with dev mode off), buying it from the buyer app on Preprod, and withdrawing.

Note for the README: a new image build changes the measurement; after every redeploy, update the pin and ask creators to re-provision (the indexer's catalog is in memory by design).

- [ ] **Step 5: Phala runbook** in `deploy/README.md` (the commands above, plus how to redeploy: rebuild image with a new tag, `npx phala deploy` again, re-pin, re-provision).

- [ ] **Step 6: Commit** — `git add deploy && git commit -m "deploy: Phala CVM compose, deploy runbook, pinned measurement"`

---

### Task 5: CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Workflow**

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Install Compact 0.31.1
        run: |
          curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
          echo "$HOME/.local/bin" >> $GITHUB_PATH
          "$HOME/.local/bin/compact" update 0.31.1
      - run: npm ci
      - run: npm run check:runtime-copies
      - run: npm run compile -w contract
      - run: npm test --workspaces --if-present
      - run: npm run build -w indexer && npm run build -w packages/midnight-web && npm run build -w buyer && npm run build -w creator
```

- [ ] **Step 2: Verify** — push a branch; the workflow is green (devnet tests are skipped without `DEVNET`, Playwright is not run in CI to keep it under five minutes).

- [ ] **Step 3: Commit** — `git commit -m "ci: install compact, compile, unit tests, builds"`

---

### Task 6: Submission README, demo script, cleanup

**Files:**
- Modify: `README.md`
- Create: `docs/demo-script.md`
- Delete: `spike/` (after Lanes A to C have landed and `docs/guide.md` section 7 is rewritten to point at `deploy/README.md`)

- [ ] **Step 1: README structure** (the judges read this first; keep every claim true and testable)

```markdown
# Blindfold

One-line: sell content that unlocks with a private payment, with nobody in the middle able to read it.

## What it does (60 seconds)
- creator encrypts in the browser, registers the drop on a Compact contract (price + key commitment),
  seals the content key to an attested TEE
- buyer pays shielded NIGHT through the contract's `purchase` circuit with a one-time key
- the TEE seals the content key to that one-time key; the buyer decrypts; nobody learns who bought

## How Midnight is used
- Compact contract `contract/src/blindfold.compact`: `createDrop`, `purchase` (shielded NIGHT via
  `receiveShielded`, `Map.insertCoin` escrow), `withdraw` (`sendShielded` to the caller); explicit
  `disclose()` of exactly the fields that must be public; a witness for creator authorization
- Zswap shielded payments; DApp Connector v4 (Lace, 1AM); midnight-js providers; Midnight indexer
  GraphQL for the public ledger; local proof server; Preprod deployment
- what a purchase reveals on-chain and what it does not (link to docs/guide.md section 4)

## Run it in 10 minutes (local devnet)      -> deploy/README.md steps 1-5, copied here verbatim
## Demo on Preprod                          -> addresses from deploy/networks.json, wallet prep
## Architecture                             -> diagram from docs/guide.md section 4
## Repository map
## Team
```

- [ ] **Step 2: `docs/demo-script.md`** (3 minutes, two browsers side by side)

```markdown
1. (creator, 40 s) Connect Lace. Pick an image. Price 1 NIGHT. Submit. Point at the four steps:
   encrypt, register on contract (wallet popup), attestation verified against the pinned measurement,
   sealed provisioning. Show the catalog entry appear.
2. (buyer, 60 s) Different wallet. Connect. Buy. Wallet popup: one shielded transaction. Wait.
   Show the explorer: the transaction has no wallet address, only the contract call. The key arrives,
   the image renders.
3. (creator, 30 s) Refresh escrow. Withdraw. Show the shielded balance increase in Lace.
4. (30 s) What stays private and why: buyer anonymity from Zswap, content confidentiality from the TEE,
   payment enforcement from the contract. What does not: network layer, DRM.
```

Record the video with this script once the Preprod stack is up; upload unlisted; link from the README.

- [ ] **Step 3: Submission checklist** (append to `README.md` bottom as a comment or to `docs/guide.md`)

- [ ] repo public (`gh repo edit moyedx3/blindfold --visibility public --accept-visibility-change-consequences`) only after a final secret scan: `git grep -nE 'mn_addr1|mn_shield-addr1|SEED_HEX=|mnemonic' -- . ':!deploy/README.md' ':!docs/**'` prints nothing sensitive, and `git log -p | grep -c 'MIDNIGHT_WALLET_MNEMONIC='` is 0
- [ ] `npm run demo:local` works on a fresh clone (test on a second machine or a fresh directory)
- [ ] README "How Midnight is used" matches the code (judges compare)
- [ ] Preprod contract address, CVM URL, and measurement in `deploy/networks.json`
- [ ] demo video link
- [ ] `spike/` deleted; `docs/guide.md` updated
- [ ] submission form filled before 2026-09-27 evening KST (one day of margin)

- [ ] **Step 4: Commit** — `git commit -m "docs: submission README, demo script, checklist; remove spike"`

---

## Self-review

- Spec coverage: section 10 local (Tasks 1, 2), Preprod (Task 3), Phala CVM with measurement publication (Task 4), judges' 10-minute path (Task 2 and 6), section 12 lane D deliverables (all tasks), section 13 spike deletion (Task 6). CI (Task 5) is an addition that keeps the four lanes integrated.
- Placeholders: the angle-bracket values in Tasks 3 and 4 (`<printed address>`, `<id>`, `<cvm-url>`, `<rtmr3>`) are runtime outputs the executor copies from the previous command's output, not unwritten content.
- Type consistency: `seed-demo.ts` uses `buildProviders(walletCtx, config, storeName)`, `loadCompiledContract()`, `loadContractModule()` exactly as defined in Lane A Task 2, and the provisioning JSON field names from Lane A Task 9; the indexer env names match Lane A Task 12's `loadConfig`.
