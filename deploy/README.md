# Deploy and run Blindfold

This is the operational source of truth for the local demo, Preprod contract, and Phala CVM. Commands
assume the repository root unless they begin with `cd`.

## Local devnet

Prerequisites:

- Docker Desktop running
- Node.js 22 or newer
- Compact 0.31.1 (`compact update 0.31.1`)
- `export PATH="$HOME/.docker/bin:$HOME/.local/bin:$PATH"`

Install and validate once:

```bash
npm install
npm run check:runtime-copies
npm run qa:demo
```

Start a clean, seeded stack:

```bash
npm run devnet:down        # optional: stop a previous devnet; the local chain restarts from genesis
npm run demo:local
```

`demo:local` performs five fail-fast stages: compile, compose startup, contract deployment, Blindfold
indexer startup, then encrypted demo-drop registration and provisioning. It records the ephemeral local
contract address in `.local/networks.json`. Sensitive recovery material is written with mode `0600` under the
gitignored `.local/` directory and is never printed.

Start the apps in separate terminals:

```bash
VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev -w buyer
VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev -w creator
```

| Service | URL/port |
|---|---|
| Buyer | <http://127.0.0.1:5173> |
| Creator | <http://127.0.0.1:5175> |
| Blindfold indexer | <http://127.0.0.1:8080> |
| Midnight indexer GraphQL | <http://127.0.0.1:8088/api/v4/graphql> |
| Midnight node | `127.0.0.1:9944` |
| Proof server | <http://127.0.0.1:6300> |

The browser-only smoke suites use ports 5174 (buyer) and 5176 (creator), so they do not collide with the
development servers.

### Lace on the local network

1. In Lace, choose Midnight network **Undeployed** and proof server **Local**
   (`http://127.0.0.1:6300`).
2. Fund the wallet from the devnet genesis wallet:

   ```bash
   npm run fund -w contract -- <mn_addr…> <mn_shield-addr…> 1000 --network undeployed
   ```

3. Generate tDUST in Lace and wait for a non-zero DUST balance.
4. Use separate creator and buyer wallets for the clearest privacy demo.
5. In the creator app only, explicitly enable the local-dev attestation bypass. The local indexer returns
   `quote_hex: "dev"`; a public deployment must never use that switch.

### Restart recovery

Content and dispatch blobs persist in `.local/indexers/<contract>/`, but the enclave key catalog is
deliberately in memory. After restarting the Blindfold indexer, restore the seeded drop with:

```bash
npm run demo:recover
```

This command validates that the recovery bundle belongs to the running contract, restores the encrypted
blob, and seals the key to the current local provisioning key. It refuses real TEE endpoints.

### Stop and reset

```bash
npm run demo:stop                # validates the recorded process before stopping it
npm run devnet:down               # removes the containers; the local chain has no volume, so it restarts from genesis
npm run devnet:reset              # same, plus any compose-managed volumes; the contract must be redeployed either way
```

## Preprod contract

The tracked `null` values in `deploy/networks.json` are deliberate. Replace them only with outputs you
have personally verified; never fabricate a deployment address, CVM URL, measurement, or image digest.

Prepare the deployment wallet without attempting a transaction:

```bash
npm run wallet:prepare -w contract -- --network preprod
```

The command generates a 24-word recovery phrase once, stores it in gitignored `contract/.midnight-state.json`,
and prints the Preprod faucet address. Back up the phrase outside the repository. Fund that address at
<https://midnight-tmnight-preprod.nethermind.dev/>, import the phrase into Lace on Preprod, register NIGHT
for DUST generation, and wait for a positive DUST balance. Do this at least one day before the demo.

Deploy and verify:

```bash
npm run deploy -w contract -- --network preprod
npm run ledger -w contract -- <printed-contract-address> --network preprod
```

Record the printed 64-hex address as `preprod.contract_address` in `deploy/networks.json`. Confirm the
deployment independently in <https://preprod.midnightexplorer.com/>.

The ledger script currently treats its first positional argument as the contract address. Passing
`--network` first is interpreted as an address and fails hex validation. Supply the address first as above.

For the completed local devnet verification, its limitations, and remaining public-network tests, see
[`docs/deployment-verification-2026-09-11.md`](../docs/deployment-verification-2026-09-11.md).

## Build and publish the indexer image

The Phala CVM must use an immutable image digest. A tag is useful for publishing but is not a trust pin.

```bash
npm run compile -w contract
docker build -f indexer/Dockerfile -t ghcr.io/moyedx3/blindfold-indexer:0.1.0 .
docker push ghcr.io/moyedx3/blindfold-indexer:0.1.0
docker pull ghcr.io/moyedx3/blindfold-indexer:0.1.0
docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/moyedx3/blindfold-indexer:0.1.0
```

The same build runs in GitHub Actions on `linux/amd64` (what Phala's TDX hosts run), which is the preferred
route from an Apple Silicon laptop: Actions → **release-image** → Run workflow, or

```bash
gh workflow run release-image.yml --ref main -f tag=0.1.0
gh run watch   # the job summary prints IMAGE=ghcr.io/...@sha256:<digest>
```

Make the GHCR package public so the CVM can pull it without registry credentials. Put the resulting
`ghcr.io/...@sha256:...` value in `deploy/cvm/.env` and record the same digest in
`deploy/networks.json`. Never place a GHCR token in the compose file or repository.

## One-URL static site (Vercel)

`npm run site:build` assembles `site/` with the buyer at `/` and the creator at `/creator/`, baking the
Preprod values from `deploy/networks.json` (indexer URL, RTMR3) and `VITE_PCCS_URL=https://pccs.phala.network`
into the bundles. Deploy it as a static site (the Vercel build image has no Compact compiler, so build locally):

```bash
npm run site:build
npm run site:deploy      # copies site/ outside the git checkout, then `vercel deploy --prod`
# first time only: cd site && npx vercel link --yes --project blindfold
```

Deploy from the copy, not from inside the checkout: the Vercel CLI attaches the local git commit author
to a deployment made inside a repository, and Vercel blocks it when that author is not a team member
(the deployment sits at "UNKNOWN" in `vercel ls`; the API says "commit author doesn't have permission").

Production: <https://blindfold-psi.vercel.app/> and <https://blindfold-psi.vercel.app/creator/>. After any CVM
re-pin, rebuild and redeploy the site: the RTMR3 is compiled into the creator bundle.

## Phala CVM

Install/authenticate with the current Phala CLI:

```bash
npm install -g phala
phala login
cd deploy/cvm
cp .env.example .env
```

Fill `.env` with the digest-pinned `IMAGE` and verified Preprod `CONTRACT_ADDRESS`, then validate and deploy:

```bash
docker compose config >/dev/null
# First deployment: run from the repository root. A `name`/`id` in deploy/cvm/phala.toml makes
# the CLI look up an existing CVM and fail with "CVM not found" when there is none yet.
cd ../..
phala deploy -n blindfold-indexer -c deploy/cvm/docker-compose.yml -e deploy/cvm/.env \
  -t tdx.small --kms phala --no-public-logs --wait
# Later updates (new env, new digest): from deploy/cvm, where phala.toml carries the CVM id.
cd deploy/cvm && phala deploy -c docker-compose.yml -e .env --wait
phala ps --cvm-id <id>                          # container state; `phala logs` is off (public_logs=false)
phala cvms attestation --cvm-id <id> --json > /tmp/blindfold-attestation.json
```

Deployed 2026-09-12: CVM `ba917fac-0e75-45d5-8572-870b22c51cd7`, app id `94ef50c5…0429`, endpoint
`https://94ef50c5719468f34cdb06e000e8f3ee415f0429-8080.dstack-pha-prod5.phala.network`, about $0.06/h.

The env file now carries nothing required (image and contract are literal in the compose). If the GHCR
package is private, add registry credentials to that ignored `.env` so dstack can pull the image; they
travel as encrypted environment variables, never in the compose file:

```bash
DSTACK_DOCKER_USERNAME=<github-username>
DSTACK_DOCKER_PASSWORD=<personal-access-token with read:packages>
DSTACK_DOCKER_REGISTRY=ghcr.io
```

Do not pass `--no-public-tcbinfo`: keep the TCB info public so `attest:inspect` results can be
cross-checked from the Phala dashboard. Logs stay private (`phala.toml` already sets `public_logs = false`).

Note on the pin: Phala documents RTMR3 as covering the compose hash **and** the app id, instance id,
and key provider. dstack measures the compose *text*, so `deploy/cvm/docker-compose.yml` writes the image
digest and the contract address literally instead of reading them from the env file: observed on
2026-09-13, changing the image through `${IMAGE}` left RTMR3 unchanged, while changing the literal
compose changed it (`3509154d…` → `147a17b3…`). With the literal compose, a pinned RTMR3 therefore
identifies exactly this image and this contract on this CVM instance. After any compose change:
redeploy, re-run `attest:inspect`, re-pin `measurement_rtmr3`, re-run `smoke:live`, and rebuild the
site. The provisioning public key stays the same across updates of one CVM (same app id), so creators
do not need to re-provision; recreating the CVM changes both.

Use `phala cvms get blindfold-indexer --json` to obtain the public HTTPS endpoint. From the repository root,
cryptographically inspect the indexer's own quote and key binding:

```bash
npm run attest:inspect -- https://<cvm-endpoint>
```

Record the printed 96-hex `RTMR3`, endpoint, and image digest in `deploy/networks.json`.

This first inspection is trust-on-first-use: the RTMR3 you pin comes from the quote you are inspecting, so it
proves that a genuine TDX enclave with that measurement is answering, not that the measurement belongs to the
reviewed image. Close that gap before publishing the pin by rebuilding the image from the tagged commit and
checking that its digest matches the one the CVM reports.

Configure the creator with:

```bash
VITE_INDEXER_URL=https://<cvm-endpoint> \
VITE_EXPECTED_MEASUREMENT_HEX=<96-hex-rtmr3> \
VITE_PCCS_URL=https://pccs.phala.network \
npm run dev -w creator
```

The creator verifies the quote inside the browser, which fetches Intel collateral from a PCCS. Intel's
own PCS sends no CORS headers, so a browser cannot use it; Phala's PCCS does (and is `@phala/dcap-qvl`'s
default). Wallets: 1AM proves inside the wallet and sponsors DUST, so on Preprod it needs neither a
local proof server nor DUST registration (verified 2026-09-13 for the buyer top-up); Lace on Preprod was
blocked by its own sync never completing, so it remains the local-devnet wallet.

Then run the pinned live check:

```bash
npm run smoke:live
```

The smoke test requires HTTPS, verifies the Preprod contract address, performs Intel DCAP quote
verification, requires `UpToDate`, checks RTMR3, and checks that quote `report_data` binds
`sha256(provisioning_pubkey)`. It writes only redacted evidence under `deploy/evidence/`.

### Measurement rotation and recovery

Any image or compose change can change RTMR3 and the measurement-derived provisioning key. For every
release:

1. Build and publish a new immutable image digest.
2. Deploy the changed compose.
3. Inspect the new quote and verify its key binding.
4. Update the public endpoint, digest, and RTMR3 together.
5. Update the creator configuration.
6. Ask creators to re-provision every active drop.
7. Run `npm run smoke:live` and the creator → buyer → withdraw flow.

The CVM volume retains encrypted content and dispatch state, but the in-memory key catalog intentionally
does not survive restart. Do not persist plaintext `K_drop` outside the measured workload as a shortcut.

### Billing and rollback

Stop the paid CVM when it is not needed:

```bash
phala cvms stop blindfold-indexer
```

Rollback means redeploying the previously recorded digest and compose, re-verifying its resulting RTMR3,
republishing the pin, and re-provisioning. A prior digest does not guarantee the prior RTMR3 if the compose
or environment changed.

## Final release checks

- `npm run qa:demo`
- `npm run test:e2e -w buyer && npm run test:e2e -w creator`
- `npm run demo:local` from a clean clone or second machine
- Real Lace creator → buyer → unlock → withdraw on the chosen network
- `npm run smoke:live` against the CVM
- No tracked seeds, mnemonics, addresses belonging to personal wallets, `.env`, or recovery bundles
- `deploy/networks.json` contains verified public values rather than `null`
- Demo video follows `docs/demo-script.md`

## Troubleshooting

| Symptom | Check |
|---|---|
| Local compose exits during startup | `docker compose -f deploy/devnet/docker-compose.yml logs`; reset volumes and confirm Docker has enough memory |
| Proof generation hangs/fails | Confirm proof server 8.1.0 and Lace proof-server URL `http://127.0.0.1:6300` |
| Indexer answers 409 on provision | Recompute `sha256(K_drop || h_content_bytes)` and verify price/content match the chain |
| Catalog empty after restart | Expected: re-provision from the creator or run `npm run demo:recover` for the local seeded drop |
| CVM cannot reach dstack | Confirm `/var/run/dstack.sock` is mounted and `DSTACK_ENDPOINT` matches it |
| CVM cannot pull image | Use a public GHCR package and a digest that exists |
| Creator rejects attestation | Re-run `attest:inspect`; compare RTMR3, TCB status, and the current compose/image release |
| Live smoke cannot fetch collateral | Check outbound access or set `PCCS_URL` to a trusted collateral service |
