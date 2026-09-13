#!/bin/bash
# Re-pin the live CVM after a restart or redeploy: read its current RTMR3 and image digest,
# write them into deploy/networks.json, run the live smoke test, then rebuild and redeploy the site.
# Usage: npm run cvm:repin [-- preprod] [--no-site]
# Every CVM start yields a new RTMR3 (observed 2026-09-13), so run this after `phala cvms start`,
# then ask creators to re-provision from their recovery files (the key catalog is in memory).
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.docker/bin:$PATH"
cd "$(dirname "$0")/../.."
NET=preprod; SITE=1
for a in "$@"; do case "$a" in --no-site) SITE=0;; *) NET="$a";; esac; done
E=$(python3 -c "import json,sys;print(json.load(open('deploy/networks.json'))[sys.argv[1]]['indexer_url'])" "$NET")
OLD=$(python3 -c "import json,sys;print(json.load(open('deploy/networks.json'))[sys.argv[1]]['measurement_rtmr3'])" "$NET")
echo "endpoint: $E"
for i in $(seq 1 30); do curl -s -m 10 "$E/health" | grep -q ok && break; echo "  waiting for /health…"; sleep 10; done
OUT=$(npm run -s attest:inspect -- "$E")
echo "$OUT"
NEW=$(echo "$OUT" | grep -oE 'RTMR3=[0-9a-f]+' | cut -d= -f2)
[ -n "$NEW" ] || { echo "could not read RTMR3"; exit 1; }
if [ "$NEW" = "$OLD" ]; then echo "RTMR3 unchanged ($NEW); nothing to re-pin"; else
  python3 - "$NET" "$NEW" <<'PY'
import json, sys
p = 'deploy/networks.json'; d = json.load(open(p)); d[sys.argv[1]]['measurement_rtmr3'] = sys.argv[2]
json.dump(d, open(p, 'w'), indent=2); open(p, 'a').write('\n'); print(f"networks.json: measurement_rtmr3 -> {sys.argv[2][:12]}…")
PY
fi
npm run -s smoke:live
if [ "$SITE" = 1 ]; then npm run -s site:build && npm run -s site:deploy; fi
echo "re-pin done: RTMR3 $NEW"
echo "next: commit deploy/networks.json, and creators re-provision from their recovery files"
