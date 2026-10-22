# Before and after, 21-22 October 2026

Before: `50df9739` (main). After: `0372232f` (branch
`chore/test-ci-modernization`). All gate figures are `pnpm verify:release`
runs on the owner's Mac (Apple M-series, 18 cores, 64 GiB, Node 24.18.0,
PostgreSQL 17.11), each with its own throwaway clusters, receipts kept in the
integrator's scratch folder. The Mac was shared with two other repositories'
suites all night, so every run's load average is given; the controlled A/B
below repeats the old gate on a quiet machine.

## Gate runs

| Run                                                     | Commit         | Gate                          | Load (1-min median / max) | Wall                   | Result                                                                          |
| ------------------------------------------------------- | -------------- | ----------------------------- | ------------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| Baseline                                                | `50df9739`     | old, serial                   | 44 / 116                  | **105.6 min**          | failed: integration 3, e2e 1 (timing under load)                                |
| Historical receipts (5 promotions, 2026-10-10 to 10-19) | various        | old, serial                   | not recorded              | 54, 56, 74, 71, 71 min | as recorded                                                                     |
| Branch run 1                                            | `e8c936d3`     | concurrent, no CPU budget yet | 39 / 69                   | 37.2 min               | failed: 4 component tests timed out (fixed: CPU budget, 15 s component timeout) |
| Branch run 2                                            | `2274c414`     | concurrent                    | 9 / 31                    | 14.6 min               | failed: 1 e2e test (fixed: wait for every paced read)                           |
| **Final**                                               | **`0372232f`** | **concurrent**                | **18 / 75**               | **17.6 min**           | **passed, every step**                                                          |
| A/B: old gate, quiet machine                            | `50df9739`     | old, serial                   | see below                 | see below              | see below                                                                       |

Per step (seconds):

| Step                                            | Baseline `50df9739`                                            | Final `0372232f`                                               | Change                                                                      |
| ----------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| frozen-install                                  | 5.7                                                            | 4.5                                                            |                                                                             |
| typecheck                                       | 23.9                                                           | 62.8                                                           | runs beside the build now (CPU budget)                                      |
| lint                                            | 28.7                                                           | 111.1                                                          | runs beside the build now                                                   |
| unit (+ components)                             | 432.5 (619 files, 164 integration files collected and skipped) | 306.2 (618 files, none skipped but the gated live OpenAI test) | parallel unit files; integration no longer collected                        |
| format, design, bundle-budget, workflow-lint    | —                                                              | 2.9, 1.5, 0.3, 0.2                                             | new checks                                                                  |
| build                                           | 73.1                                                           | 208.3                                                          | shares the CPU with unit, typecheck and lint                                |
| migrations (policy, fresh, upgrade, concurrent) | 9.5                                                            | 9.2                                                            | the upgrade check now compares the whole 497 KB schema, not its last 262 KB |
| integration                                     | 2,947.9 (1,409 passed, 3 failed)                               | 736.6 (1,568 passed)                                           | 4 shards, fixed sleeps removed, +156 tests                                  |
| e2e                                             | 2,800.4 (751 passed, 1 failed)                                 | 678.3 (593 passed)                                             | width tripling removed, shared and isolated suites side by side             |
| audit, secret-scan                              | 12.1                                                           | 3.9                                                            |                                                                             |
| **sum of step times**                           | **105.6 min**                                                  | **35.4 min**                                                   |                                                                             |
| **wall**                                        | **105.6 min**                                                  | **17.6 min**                                                   | steps overlap                                                               |

The critical path is now build → integration (12.3 min) beside e2e
(11.3 min). Faster still is possible with more shards or a quieter machine;
the budget (`--cpus`) and shard count are flags.

## Inventory

| Metric                                          | Before                                                                                                   | After                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Test files (`tests/**`, static count)           | 831                                                                                                      | 836                                                                                                                |
| Static test cases (`it`/`test` call sites)      | 7,689                                                                                                    | 8,052                                                                                                              |
| Executed tests in the gate                      | 8,121 unit/component + 1,409 integration + 752 e2e                                                       | 8,427 unit/component + 1,568 integration + 593 e2e                                                                 |
| Playwright tests                                | 752 (291 from 61 journeys tripled across widths)                                                         | 593 (each journey once, one layout check per width)                                                                |
| Skipped tests in the gate                       | 1,413 collected-and-skipped integration tests in `pnpm test`, 5 conditional e2e skips                    | 1 (the gated live OpenAI test); skips now fail the receipt                                                         |
| Known flaky or load-failing tests               | lease tests (advisory lock), deep-reconcile and jobs-runner timing, 1 e2e, several heavy component files | none in the final run; root causes fixed (owned clusters, latches, injected clocks, measured timeouts, CPU budget) |
| Fixed sleeps in tests                           | ~165 s per integration run; 9 `waitForTimeout`, 37 `networkidle` in e2e                                  | none                                                                                                               |
| Workflows / job definitions                     | 5 / 14                                                                                                   | 2 / 5 (`ci.yml`: Plan, Gate, Secret scan, `CI result`; dormant `codeql.yml`)                                       |
| Workflow YAML lines                             | 754 (`ci.yml` 476)                                                                                       | 340 (`ci.yml` 300)                                                                                                 |
| Definitions of the gate                         | 2 (`ci.yml` jobs, `verify-local.mjs`), drifted                                                           | 1                                                                                                                  |
| package.json scripts                            | 34                                                                                                       | 37 (`format:check`, `format:changed`, `lint:workflows`, `release:rollback` added; `verify:full` removed)           |
| Dependencies / devDependencies                  | 25 / 22                                                                                                  | 25 / 22 (none added or removed)                                                                                    |
| Hosted CI wall per PR (before the budget block) | 7.0 min median, 33 billed min (n=39)                                                                     | not measurable: Actions still blocked; one job now                                                                 |

## Coverage and confidence

Closed gaps (each test shown failing against a deliberately broken database,
build or hook before it was accepted):

- **P0** every tenant table has forced row-level security and the exact
  tenant policy, the runtime role's privilege matrix, no TRUNCATE
  (`tests/integration/rls-catalogue.test.ts`, 78 tables).
- **P0** the 23 public and 18 cron handlers are pinned
  (`tests/route-auth-surface.test.ts`), and the shared route scanner closes
  six blind spots in the authorisation, entitlement, MFA and max-duration
  contracts.
- **P1** cross-tenant reads by id across 53 session GET routes (75 cases);
  support impersonation at the real boundary; the Pub/Sub replay route;
  report-share revocation by another organisation; daily AI credits per
  organisation; home-client guards; the operator pause and support-revoke
  CLIs executed; two-person approval parking for hours and menus; 99
  behavioural tests for the onboarding and profile forms that write to
  Google; the self-hosted runner hooks (37 cases).
- **Schema invariants** of the migrated database (39 catalogue assertions)
  replace 15 text-only migration tests that could not fail after merge; two
  of those had already drifted from the schema.
- **Release**: production must serve the promoted SHA (recorded in the
  receipt), and a dry-run-first rollback refuses to cross migrations.

Fewer browser tests give equal protection: every removed width variant's
assertions still run at 1280 px, and each screen keeps a layout check
(including axe and overflow) at 375 and 768 px; the mapping of every removed
title is in C4's handoff.

## Removed technical debt

Two drifting gate definitions; three workflows that could not run or leaked
a secret; a dependency-review job that could never pass; `verify:full`;
fixed sleeps; source-text tests of frozen migrations; dead exports and
components kept alive by their tests; three copies of the database guard;
four route-discovery reimplementations; 16 stale gitleaks fingerprints; a
schema comparison that saw half the schema; a harness that could delete the
developer's tenant.

## Remaining risks and follow-ups

| Item                                                                       | Owner       | Note                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted CI                                                                  | owner       | Actions budget, or a public repository (which also restores dependency review and code scanning). The rewritten `ci.yml` is statically validated (actionlint, zizmor) but has not run on GitHub |
| Mac self-hosted lane                                                       | owner       | safe to switch on after `runner-setup.sh verify`; decide whether agent PR branches may run there                                                                                                |
| `CLAUDE_CODE_OAUTH_TOKEN` secret                                           | owner       | delete (its workflow is gone)                                                                                                                                                                   |
| Dependabot                                                                 | owner       | security updates are off; npm updates fail with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` since 2026-10-09 (cause not found in the repository)                                                      |
| Managers granted any location id (`lib/server/permissions.ts` `grantsFor`) | engineering | five routes answer 200 instead of 404 for another tenant's location id; row-level security still hides the data; the cross-tenant sweep pins it                                                 |
| Rollback drill                                                             | owner       | `release:rollback` is tested with mocked runners only; drill on staging (ledger OPS-09)                                                                                                         |
| `retention_cycle_org` has no row-level security by design                  | security    | ids, statuses and counts across organisations readable inside any tenant context; no tenant content                                                                                             |
| Browser journeys still missing                                             | engineering | real password sign-in and MFA (NP6-G01/G02); post schedules and photo upload component tests; width loops in `gbp-management-tabs`, `google-onboarding`, `verification-workspace`               |
| Formatting                                                                 | engineering | about 775 older files are not Prettier-formatted; the ratchet formats each one when it is next touched                                                                                          |
