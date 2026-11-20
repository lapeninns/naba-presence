---
name: verify-and-ship
description: Validate a NabaPresence change in the right test lane and hand it off for the final local-ci gate. Use when preparing a branch for review or diagnosing a failing gate.
---

# Verify and ship NabaPresence

1. Read the root `AGENTS.md` for the test policy and hard limits, then
   `docs/testing.md` for the affected test lanes. Work on the task branch, not
   `main`. Never read or print local env files or reuse a developer database
   for tests.
2. Install with `pnpm install --frozen-lockfile`. Use `pnpm check` while
   iterating, and `pnpm format:changed` if changed files need formatting.
3. Run the affected integration or browser test lanes as described in
   `AGENTS.md`. Preserve existing assertions and timeouts when failures
   indicate an actual regression. Record the failing test and exit status.
4. Before handoff run `pnpm verify`. Record its actual output and report any
   tests not exercised locally. Do not stand up production services to
   investigate a failure.
5. When the user asks to ship, switch GitHub to `lapeninns`, rebase on the
   latest `origin/main`, open one PR, and run the `naba-presence` local-ci
   profile once on that final head as specified in `AGENTS.md`. Do not deploy
   or merge as part of review handoff.
