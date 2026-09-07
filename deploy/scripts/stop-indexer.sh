#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
pid_file="$repo_root/.local/indexer.pid"
if [[ ! -f "$pid_file" ]]; then
  echo "Blindfold indexer is not recorded as running"
  exit 0
fi

indexer_pid="$(tr -dc '0-9' < "$pid_file")"
if [[ -z "$indexer_pid" || "$indexer_pid" -le 1 ]]; then
  echo "refusing invalid PID in $pid_file" >&2
  exit 1
fi
if ! kill -0 "$indexer_pid" 2>/dev/null; then
  rm -f "$pid_file"
  echo "removed stale Blindfold indexer PID file"
  exit 0
fi

indexer_command="$(ps -p "$indexer_pid" -o command= 2>/dev/null || true)"
if [[ "$indexer_command" != *"indexer/src/main.ts"* ]]; then
  echo "refusing to stop PID $indexer_pid because it is not the Blindfold indexer" >&2
  exit 1
fi

kill "$indexer_pid"
for _ in {1..20}; do
  kill -0 "$indexer_pid" 2>/dev/null || break
  sleep 0.25
done
if kill -0 "$indexer_pid" 2>/dev/null; then
  echo "Blindfold indexer did not stop cleanly (PID $indexer_pid)" >&2
  exit 1
fi
rm -f "$pid_file"
echo "stopped Blindfold indexer (PID $indexer_pid)"
