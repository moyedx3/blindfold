#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$HOME/.docker/bin:$HOME/.local/bin:$PATH"
cd "$repo_root"

for command_name in docker node npm compact curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing prerequisite: $command_name" >&2
    exit 1
  fi
done

local_dir="$repo_root/.local"
pid_file="$local_dir/indexer.pid"
mkdir -p "$local_dir"

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/blindfold-demo.XXXXXX")"
indexer_pid=""
cleanup() {
  exit_code=$?
  rm -rf "$temporary_dir"
  if [[ "$exit_code" -ne 0 && -n "$indexer_pid" ]]; then
    kill "$indexer_pid" 2>/dev/null || true
    rm -f "$pid_file"
  fi
  exit "$exit_code"
}
trap cleanup EXIT

echo "== 1/5 compile contract"
npm run compile -w contract

echo "== 2/5 start local Midnight devnet"
npm run devnet:up
bash deploy/scripts/wait-http.sh http://127.0.0.1:6300/health 120

echo "== 3/5 deploy contract"
npm run deploy -w contract | tee "$temporary_dir/deploy.log"
contract_address="$(sed -n 's/^CONTRACT_ADDRESS=\([0-9a-fA-F]\{64\}\)$/\1/p' "$temporary_dir/deploy.log" | tail -1)"
if [[ -z "$contract_address" ]]; then
  echo "deployment did not print a valid CONTRACT_ADDRESS" >&2
  exit 1
fi
npx tsx deploy/scripts/record-network.ts undeployed "$contract_address"

echo "== 4/5 start Blindfold indexer in local dev mode"
bash deploy/scripts/stop-indexer.sh
if curl --silent --max-time 2 http://127.0.0.1:8080/health >/dev/null 2>&1; then
  echo "something already answers on 127.0.0.1:8080, so the health check below would pass against the wrong indexer." >&2
  echo "Stop it first (npm run demo:stop, or: lsof -nP -iTCP:8080 -sTCP:LISTEN)." >&2
  exit 1
fi
data_dir="$local_dir/indexers/$contract_address"
mkdir -p "$data_dir"
DEV_SEED_HEX="${DEV_SEED_HEX:-1111111111111111111111111111111111111111111111111111111111111111}" \
  NETWORK=undeployed \
  CONTRACT_ADDRESS="$contract_address" \
  DATA_DIR="$data_dir" \
  PORT=8080 \
  node --import tsx indexer/src/main.ts >"$data_dir/indexer.log" 2>&1 &
indexer_pid=$!
printf '%s\n' "$indexer_pid" > "$pid_file"
if ! bash deploy/scripts/wait-http.sh http://127.0.0.1:8080/health 60; then
  tail -80 "$data_dir/indexer.log" >&2 || true
  exit 1
fi

echo "== 5/5 register and provision a demo drop"
bundle_path="$local_dir/demo-drop-$contract_address.json"
npx tsx deploy/scripts/seed-demo.ts \
  --indexer http://127.0.0.1:8080 \
  --bundle-out "$bundle_path"
ln -sfn "$(basename "$bundle_path")" "$local_dir/demo-drop-latest.json"

catalog="$(curl --fail --silent --show-error http://127.0.0.1:8080/catalog)"
if [[ "$catalog" != *'"drop_id"'* ]]; then
  echo "catalog did not contain the seeded drop: $catalog" >&2
  exit 1
fi

cat <<EOF

Local stack is ready.
  contract  $contract_address
  indexer   http://127.0.0.1:8080
  catalog   http://127.0.0.1:8080/catalog
  log       $data_dir/indexer.log
  recovery  $bundle_path (mode 0600; never commit)
  buyer     VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev -w buyer
  creator   VITE_INDEXER_URL=http://127.0.0.1:8080 npm run dev -w creator

Stop the Blindfold indexer with: npm run demo:stop
Stop the Midnight devnet with: npm run devnet:down
EOF
