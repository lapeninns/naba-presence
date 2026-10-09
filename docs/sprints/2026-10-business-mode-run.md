# Business mode and AI credits: integration run (2026-10-03)

> Historical record, archived during consolidation on 2026-10-09. The credits
> and business-mode work is now on `main` through PR #56 (merge `efceaf46`).
> Status statements, branch instructions and QA receipts below describe the
> original 2026-10-03 work; they are not current project rules or fresh QA evidence.

Scratch worktree: `platform/.scratch-integration`, branch `scratch/business-mode-integration`, off `main` (2dc4db12). Nothing pushed, nothing committed in the main checkout. This report is uncommitted.

## Branches merged
`feat/business-setup-flow` does not exist, so it was not merged. Merged, in order:

| Branch | Tip | Contents |
|---|---|---|
| feat/ai-credits-ui | 35ffc417 (now fa6943ae, see fixes) | Includes feat/ai-usage-ledger (d73bd540) and feat/ai-credit-reservation (cba37789) as ancestors. Migrations 0059_ai_credits and 0060_ai_credit_notifications. |
| feat/workspace-mode-schema | f2268ffd | Migration 0060_workspace_mode, home client, business-mode guards on clients and locations routes. Reported red only because of the 0059 gap, which the merge closes. |

Scratch commits: merge x2, a migration renumber, and two e2e test fixes.

## Conflicts
- Textual: none. Both merges were clean. `app/(dashboard)/settings/page.tsx` did NOT conflict.
- Semantic: both lanes claimed migration number 0060 (`0060_ai_credit_notifications.sql` and `0060_workspace_mode.sql`). Resolved in scratch only: renamed workspace mode to `0061_workspace_mode.sql`, including its `schema_migration` insert and `tests/workspace-mode-migration.test.ts`. Whoever lands second must renumber on the real branch. I did not change `feat/workspace-mode-schema`.
- Local DB note: the shared local Supabase already had `0076_post_publication_schedules` applied from another branch, and was at 0055. `db:migrate` applied 0056-0061 (local 127.0.0.1:54322 only; the harness refuses non-local hosts).

## Checks (scratch tip)
- `pnpm typecheck`: clean.
- `pnpm lint`: clean, no output.
- `pnpm test`: Test Files 253 passed | 73 skipped (326); Tests 2490 passed | 372 skipped (2862).
- `pnpm build` (webpack, required by integration): succeeded.
- `pnpm test:integration`:
  - run 1: 4 files / 5 tests failed (jobs-runner, leases x2, presence-resource-reconciliation, privacy-fulfilment). jobs-runner showed `checkpoints: 2` against expected 1, which is cross-test interference on the shared dev DB.
  - run 2: 1 test failed (vercel-cron-ticks presence-resources, 5000 ms timeout). 72 files passed, 371 tests passed.
  - isolated reruns: vercel-cron-ticks twice, 9/9 pass. The other four files plus `ai-credits-concurrency.test.ts` together, 5 files / 38 tests pass.
  - Verdict: a different test failed each full run and all pass in isolation. This is the known advisory-lock and shared-DB flakiness, not a regression. The new `ai-credits-concurrency` integration test passed in every run.
- `pnpm test:e2e` (port 3100 harness, workers 1):
  - run 1: 161 passed, 5 failed.
  - After fixes: 166 passed, 0 failed (4.6 min).
  - A first attempt to run playwright directly failed on the webServer env. It must go through `scripts/run-test-command.mjs e2e` (what `pnpm test:e2e` does).

## E2E failures and outcomes
1. `accessibility.spec.ts` "inbox, review detail, and reply editor" (4 variants: desktop and mobile, light and dark). This is a REAL lane regression from feat/ai-credits-ui. The reply composer now fetches `/api/ai/credits`. The spec did not stub it, the 401 sent the page to `/sign-in`, and the "Filters" button was never found. Fixed by stubbing `/api/ai/credits` in the spec. The fix is committed on the stage branch: `feat/ai-credits-ui` now points at fa6943ae (35ffc417 plus the one test commit). typecheck is clean on the branch worktree. I did not rerun the full suite on the branch alone. The scratch tip passed the full suite.
2. `foundation.spec.ts` "the health chip reports the agency" is PRE-EXISTING and not caused by any lane. The chip says "1 client needs attention", but the spec's regex only matches "needs action". It fails whenever the dev tenant has a delayed client. `lib/clients/health.ts` is untouched by the lanes. Fixed in scratch only (commit 4b8de2fd, regex now `needs? (?:action|attention)`). It is not on any stage branch. Apply it to main or the relevant branch if wanted.

## Per-branch changes (from lane results, abridged)
- feat/ai-usage-ledger: usage written by detached `recordAiUsageDetached` in its own transaction so later errors cannot roll it back or fail Generate/Verify. The draft id is allocated up front. `AiOutputError` (502) carries usage when a 200 response is unparseable. Unique partial index on (organisation_id, kind, request_id) with `on conflict do nothing`. Verify route request id gets a `:verification` suffix. All 7 findings fixed. Timeouts before any response are unrecorded (waived). No test for the `AiOutputError` path.
- feat/ai-credit-reservation: settle locks the organisation row. Release also updates reaped rows. Settle and release retry 3 times and log the reservation id on failure. Added COPY for 402 `ai_credits_exhausted` and 429 `ai_token_backstop`. Waived: reaper leaves null tokens (accepted by spec). No unit test for the new error copy.
- feat/ai-credits-ui: the evaluator counts only settled credits, so incidents stop flapping. The composer handles 402 (out-of-credits wording, no Retry, `runGenerate` early return). Notification kind widening moved to the new `0060_ai_credit_notifications.sql`. One known gap: a settled row later flipped to released could still lower usage. Plus the e2e stub above.
- feat/workspace-mode-schema: DELETE unassign returns 409 `home_client_required` for the home client and now calls `requireClientAccess`. POST assign returns 409 in business mode for a non-home target. Waived: a DB-level constraint tying business orgs to a home client. `scripts/load/common.mjs` can create such orgs. Suggest a follow-up migration.

## Open items and skipped
- Migration number collision (0060 x2) must be resolved on the real branches. Scratch uses 0061 for workspace mode.
- No `feat/business-setup-flow` branch was found, so none was tested.
- Not run: any staging or prod checks, deploys, pushes. Integration full-suite run was repeated twice, then flaky files were diagnosed in isolation as instructed.
- Not added: a test for `AiOutputError`, error-copy unit tests, and a DB-level home-client invariant.

## Dev tenant restore
After E2E, `pnpm db:migrate` was re-run (a no-op on the second pass, 62 versions recorded) and `pnpm db:runtime-role` recreated `naba_test_runtime` ("Runtime login role ready"). The earlier NOTICE about role membership already being granted is benign. The scratch worktree and its `.next` build remain at `platform/.scratch-integration` for inspection. Port 3100 is free.

## Lane B rerun

Scratch worktree `platform/.scratch-lane-b` (detached at feat/business-setup-flow 8ebaef66, removed afterwards). Local Supabase only (127.0.0.1:54322). No pushes, no secrets read.

Results at the final tip e7b137c5:
- `pnpm typecheck`: clean. `pnpm lint`: clean.
- `pnpm test`: 257 files passed, 74 skipped; 2556 tests passed, 376 skipped.
- `pnpm build` (webpack): succeeded, twice (before and after the fix).
- `pnpm test:integration` (run once): 74 files / 376 tests passed, 422 s. No flaky failures this time, so no isolation reruns.
- `pnpm test:e2e`: first run 165 passed, 19 failed. After the fix: 184 passed, 0 failed (4.9 min).

Migration note: the local DB already had the OLD 0061 recorded as applied (from the earlier scratch), so `db:migrate` skipped the revised one (column default 'agency', triggers, share notice). To exercise the revised file I removed the old 0061 effects from the local DB only (dropped `client_one_home`, `client.is_home`, `organisation.workspace_mode`, deleted the `schema_migration` row), then ran `pnpm db:migrate`, which applied the revised 0061 cleanly. Result: all 40 local orgs end up in business mode (the local bootstrap org has one active client). The migration's triggers were applied but are not exercised by any test.

E2E failures (19) and causes, all in specs and one copy string, none in the migration or API:
1. 14 business-mode specs (page scans, wizard steps, client redirects): the spec read the mode through the `request` fixture, a separate cookie jar, so the page's first navigation was an anonymous load. With no session the server renders agency wording and skips the business redirects (hence "Client setup", "Your agency's name", /clients not redirecting). Real sessions always have a cookie, so this is a harness artifact. Fixed by reading `/api/session` through `page.request` (new helper `tests/e2e/helpers/workspace-mode.ts`), and by polling the pathname in the redirect test, since a streamed page redirects after the load event.
2. One REAL copy leak: the inbox queue tabs' screen-reader note said "for the current client scope" in business mode (`components/inbox/queue-tabs.tsx`). Now mode-aware, with a unit test.
3. 4 legacy specs (`foundation` health chip and mobile nav, `routing` direct URLs and sidebar history) assumed an agency tenant. The local bootstrap org has one client, so the 0061 backfill makes it a business. They now follow the tenant's mode (business: no Clients item, business health-chip labels, Listings stands in for Clients). This also covers the pre-existing "needs attention" regex miss from the earlier run.

Fix committed on feat/business-setup-flow as e7b137c5 (ref moved with `update-ref` from 8ebaef66; the main checkout has uncommitted changes on that branch, so its `git status` will show those files as reverse diffs until it is re-synced). Files: queue-tabs.tsx, tests/components/queue-tabs.test.tsx, tests/e2e/{business-mode,foundation,routing}.spec.ts, tests/e2e/helpers/workspace-mode.ts.

Not covered: the earlier lane note about `scripts/load/common.mjs` creating orgs and the DB triggers' behaviour on write paths; no prettier pass on e2e specs (several untouched specs already fail `prettier --check`).

Dev tenant restore: `pnpm db:migrate` (no-op, 0061 recorded) and `pnpm db:runtime-role` ("Runtime login role ready: naba_test_runtime") run from the main checkout afterwards. Port 3100 free.
