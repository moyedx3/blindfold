#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: wait-http.sh <url> [seconds]" >&2
  exit 2
fi

url="$1"
seconds="${2:-120}"
if ! [[ "$seconds" =~ ^[1-9][0-9]*$ ]]; then
  echo "seconds must be a positive integer" >&2
  exit 2
fi

for ((attempt = 1; attempt <= seconds; attempt += 1)); do
  if curl --fail --silent --show-error --max-time 3 "$url" >/dev/null 2>&1; then
    echo "ready: $url"
    exit 0
  fi
  sleep 1
done

echo "timeout after ${seconds}s waiting for $url" >&2
exit 1
