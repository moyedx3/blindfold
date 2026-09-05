# Blindfold

Unlockable content with private payments on Midnight (second iteration of the team's earlier prototype, internal name "Drop"). Target: Midnight Korea
Hackathon 2026, submission deadline 2026-09-28 00:00 KST.

Read first: `docs/guide.md` (what, why, status, resources, setup), then `spike/NOTES.md` (versions, gotchas, run logs).
Design: `docs/superpowers/specs/2026-09-05-blindfold-design.md`. Work is split into four lane plans under
`docs/superpowers/plans/` (A contract+indexer, B shared wallet package+buyer, C creator, D deploy+demo);
execute a plan task by task with the executing-plans or subagent-driven-development skill.

Rules:
- Never commit seeds, wallet secrets, wallet addresses, `.midnight-state.json`, or wallet state.
- Pin Midnight packages to the compatibility matrix (docs/guide.md section 6) and keep the
  `@midnight-ntwrk/onchain-runtime-v3` npm override. Compiler is `compact update 0.31.1`, not latest.
- Compile Compact with the real compiler before claiming a contract change works.
- `spike/` is throwaway. Do not extend it; build the real structure and carry findings into the docs.
- Docker Desktop CLI is at `~/.docker/bin`; add it to PATH in shell commands.
- Midnight docs index for agents: https://docs.midnightkorea.org/llms.txt (pages fetchable as `<path>.md`).
