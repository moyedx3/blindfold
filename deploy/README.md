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
npm run devnet:reset       # optional: destroys only the local Blindfold devnet volumes
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
   npm run fund -w contract -- <mn_addr…> <mn_shield-addr…> 1000
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
npm run devnet:down               # preserves chain volumes
npm run devnet:reset              # removes local chain volumes; the contract must be redeployed
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
npm run ledger -w contract -- --network preprod
```

Record the printed 64-hex address as `preprod.contract_address` in `deploy/networks.json`. Confirm the
deployment independently in <https://preprod.midnightexplorer.com/>.

## Build and publish the indexer image

The Phala CVM must use an immutable image digest. A tag is useful for publishing but is not a trust pin.

```bash
npm run compile -w contract
docker build -f indexer/Dockerfile -t ghcr.io/moyedx3/blindfold-indexer:0.1.0 .
docker push ghcr.io/moyedx3/blindfold-indexer:0.1.0
docker pull ghcr.io/moyedx3/blindfold-indexer:0.1.0
docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/moyedx3/blindfold-indexer:0.1.0
```

Make the GHCR package public so the CVM can pull it without registry credentials. Put the resulting
`ghcr.io/...@sha256:...` value in `deploy/cvm/.env` and record the same digest in
`deploy/networks.json`. Never place a GHCR token in the compose file or repository.

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
phala deploy -n blindfold-indexer -c docker-compose.yml -e .env -t tdx.small --kms phala --wait
phala link
phala ps
phala logs
phala cvms attestation --json > /tmp/blindfold-attestation.json
```

Use `phala cvms get blindfold-indexer --json` to obtain the public HTTPS endpoint. From the repository root,
cryptographically inspect the indexer's own quote and key binding:

```bash
npm run attest:inspect -- https://<cvm-endpoint>
```

Record the printed 96-hex `RTMR3`, endpoint, and image digest in `deploy/networks.json`. Configure the
creator with:

```bash
VITE_INDEXER_URL=https://<cvm-endpoint> \
VITE_EXPECTED_MEASUREMENT_HEX=<96-hex-rtmr3> \
npm run dev -w creator
```

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
