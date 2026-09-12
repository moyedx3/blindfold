#!/usr/bin/env bash
# Deploy ./site (built by `npm run site:build`) to the linked Vercel project.
# The copy step matters: deploying from inside this git checkout makes the Vercel CLI attach the local
# commit author, and Vercel then blocks the deployment ("commit author doesn't have permission…") because
# that author is not a team member. A copy outside the repository carries no git metadata.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
src="$repo_root/site"
[[ -d "$src/.vercel" ]] || { echo "site/.vercel is missing: run 'cd site && npx vercel link --yes --project blindfold' once" >&2; exit 1; }
tmp="$(mktemp -d "${TMPDIR:-/tmp}/blindfold-site.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
rsync -a "$src/" "$tmp/"
cd "$tmp"
npx vercel deploy --prod --yes --archive=tgz < /dev/null
