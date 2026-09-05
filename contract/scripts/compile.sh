#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$HOME/.compact/bin:$PATH"
want="0.31.1"
have="$(compact compile --version 2>/dev/null || true)"
if [ "$have" != "$want" ]; then
  echo "compact compiler $want required (have: '${have:-none}'). Run: compact update $want" >&2
  exit 1
fi
rm -rf build/blindfold
compact compile src/blindfold.compact build/blindfold
echo "compiled -> build/blindfold"
