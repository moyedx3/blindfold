#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"
cd "$repo_root"

npm run check:runtime-copies
npm run compile -w contract
npm test
npm run build -w indexer -w packages/midnight-web -w buyer -w creator
npx tsc -p deploy/tsconfig.json
npm run qa:secrets
docker compose -f deploy/devnet/docker-compose.yml config >/dev/null
echo "demo QA passed"
