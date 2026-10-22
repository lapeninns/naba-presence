# Cleanup decisions, 21-22 October 2026

What this change removed, kept, consolidated and replaced, and why. Evidence
for each item is in the audit packages (NP1-NP8, see
[AUDIT_REPORT.md](AUDIT_REPORT.md)) and the implementation handoffs (C1-C8b,
in `~/.multica/claude-team/outputs/naba-presence-test-ci-modernization-20261021/reports/`
on the owner's Mac). Nothing was removed while it was the only protection of
a security, tenant-isolation, billing or data-loss behaviour.

## Removed

| Item                                                                                                                                                                                                                                                                      | Why                                                                                                                                  | Consumers checked                                                                                 | Replaced by                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/nightly.yml`                                                                                                                                                                                                                                           | Failed 27 of 27 runs; its CI half duplicated push runs                                                                               | `release-verify-local` and `toolchain-parity` tests (updated)                                     | the gate's required `audit` step; Dependabot alerts                                                                       |
| `.github/workflows/readiness-probe.yml`                                                                                                                                                                                                                                   | Every run skipped (never configured); would bill at least a minute every 5 minutes once configured                                   | runbook and observability docs (updated)                                                          | `pnpm ops:readiness` scheduled outside Actions; promotion now probes production itself                                    |
| `.github/workflows/claude-review.yml`                                                                                                                                                                                                                                     | A pull-request run reads the repository's only secret from the head's copy of the workflow; had not completed since the budget block | docs (updated)                                                                                    | reviews by a separate MultiCA reviewer account. Owner: delete `CLAUDE_CODE_OAUTH_TOKEN`                                   |
| Dependency review job in `ci.yml`                                                                                                                                                                                                                                         | The dependency-graph compare API answers 403 on this private repository, so `CI result` could never pass                             | `aggregate-results.mjs` and its test (updated)                                                    | gate `audit` step, Dependabot alerts; restore if the repository goes public or gets Code Security                         |
| `ci.yml`'s 13 restated jobs                                                                                                                                                                                                                                               | A second definition of the gate that had drifted (migration base, test-count guard, audit, browser)                                  | `ci-aggregate` and `release-verify-local` tests (rewritten)                                       | one Gate job that runs `scripts/release/verify-local.mjs`                                                                 |
| `pnpm verify:full`                                                                                                                                                                                                                                                        | Ran integration against whatever database `.env` named, with no migrate step                                                         | README, runbook, ci.md (updated); the extended docs check enforces it                             | `pnpm test:integration` (isolated by default) and `pnpm verify:release`                                                   |
| 16 `.gitleaksignore` entries                                                                                                                                                                                                                                              | Fingerprints of commits not in origin's history                                                                                      | full-history gitleaks after removal: no leaks; with the file removed: exactly the 7 kept findings | —                                                                                                                         |
| Dead exports and their tests (C5): `lodgingChanges` and helpers, `serializeMenus`, `menuIssues`, `restoreRemoval`, `menuStructureSummary`, `healthFilterMatches`, `isOnActiveKey`, `parseRange`, `requireGooglePlaceActionType`, `operationalEmailMode`, `menuChangeRows` | No production caller (`rg -nw` finds only the definition and its test)                                                               | typecheck green                                                                                   | assertions on the live functions                                                                                          |
| Dead components (C6): `components/locations/danger-zone-dialog.tsx`, `components/ui/outcome-summary.tsx`                                                                                                                                                                  | No production importer                                                                                                               | typecheck green                                                                                   | the live deletion and outcome paths' existing tests                                                                       |
| Trivial tests (C6): `harness.smoke.test.tsx`, `listings-board-entry.test.tsx`                                                                                                                                                                                             | Would pass for almost any implementation                                                                                             | —                                                                                                 | 323 component files exercise the same setup; the real board is tested elsewhere                                           |
| Source slices (C5) in `retention-cycle` and `privacy-withdrawal-retry`                                                                                                                                                                                                    | Text slices of production code already proved behaviourally                                                                          | ledger DATA-02 repointed                                                                          | `retention-purge` and `privacy-fulfilment` integration cases                                                              |
| Fixed sleeps (C1, C4)                                                                                                                                                                                                                                                     | About 165 s per integration run of pure waiting; e2e sleeps                                                                          | —                                                                                                 | bounded test-only knobs (pause cache, Google timeouts, scheduler first delay), stub latches, database-clock window checks |

The text-only migration tests (NP1-011, NP2-001) are replaced by C2's
catalogue assertions only where C2's handoff names what replaces each
assertion; see BEFORE_AFTER.md for the final state.

## Kept, deliberately

| Item                                                                            | Why                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codeql.yml`                                                                    | Costs nothing while Actions is blocked; works again if the repository goes public or gets Code Security. Its `actions` analysis is covered meanwhile by the gate's `workflow-lint` step |
| Mac self-hosted lane (`scripts/ci/runner-setup.sh`, hooks, Plan's lane switch)  | The only way the required check can run under the budget block; now safe to switch on (C7's scoped cleanup) once the owner decides on agent branches running there                      |
| `tests/agentic/`, `tests/visual/` tools, `tests/perf/` lab, `pnpm audit:mobile` | Exploratory or quiet-machine tools, outside the gate by design; their logic is unit-tested                                                                                              |
| Mocked route tests in `tests/server/`                                           | Complementary to integration (injected failures, validation order), not duplicates (NP1-015)                                                                                            |
| `tests/integration/**` (all 163 files)                                          | The only real-boundary protection for isolation, billing and data loss                                                                                                                  |
| `.design-sync/`, `prompt-exports/`                                              | Owner-held design-sync and planning material; nothing in the gate reads them (outside Prettier's scope)                                                                                 |
| `scripts/load/**`, `scripts/competitor-places-report.mjs`                       | Operational tools outside the test and CI scope; flagged for the owner (NP7-006/007)                                                                                                    |
| `scripts/cleanup-harness-data.mjs`                                              | Still useful to repair a dev database after an old-style run; now shares the guard and needs `NABA_ALLOW_DEV_DB=1` for 54322                                                            |

## Consolidated

- **The gate:** `ci.yml` and `verify-local.mjs` → one definition
  (`GATE_STEPS`), run locally and in CI.
- **Route-security scanners (C5):** four reimplementations of route discovery
  → `tests/helpers/route-scanner.ts`, which strips comments, reads each
  handler's own `route()` call and reports any method export it cannot read.
- **The local-database guard (C1):** three drifted copies →
  `scripts/test-database.mjs`.
- **The docs-only rule:** `ci.yml`, the pre-push hook and the Vercel step now
  share one rule (with the docs tests read counted as code), pinned by a
  test.
- **Duplicate tests (C5, C6):** `back-target`/`breadcrumb-trail`,
  `listing-comparison-health` → `clients-health`, `hours-metadata-recovery`
  → `hours-freshness`, six `bulk-template-pending-*` files → one.
- **Pure-logic tests (C6):** 34 files moved from the jsdom project to
  `tests/lib/` (unit project).

## Added safeguards

- Integration and e2e can no longer seed or delete tenants in the developer's
  database (port 54322 refused unless `NABA_ALLOW_DEV_DB=1`).
- Whole-schema comparison in the upgrade check (it compared only the last
  262,144 characters of a 497,304-byte dump).
- New gate steps: format ratchet, design ratchet, first-load JS ceilings,
  workflow lint.
- Post-promotion production probe, pending receipts, dry-run-first rollback
  with migration refusal (C8, C8b).
- Cross-tenant GET sweep, support-impersonation boundary tests, runner-hook
  tests (C7); two-person approval parking (C5); Google-write form tests
  (C6); RLS catalogue and route-auth surface (C2).

## Risks and their safeguards

| Risk                                                                                                                | Safeguard                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Running steps concurrently overloads a shared machine                                                               | CPU budget of 75% of the cores, strict critical-path order, `--cpus`, `--serial`                                                                  |
| A test-only knob reaches production                                                                                 | Each knob only shortens a delay, is bounded, and is ignored on Vercel; unit tests prove the production defaults                                   |
| Hosted CI's restructured workflow has not run on GitHub                                                             | Static validation (actionlint, zizmor) and the same script running locally; the first hosted or Mac-lane run should be watched                    |
| `pnpm test:integration` now needs PostgreSQL 17 locally                                                             | `NABA_TEST_DB=existing` escape hatch, still refusing the dev database                                                                             |
| Managers are granted any location id (`grantsFor`), so five routes answer 200 instead of 404 for a foreign location | Row-level security still hides the data; the sweep pins the five routes and fails when the product fix lands. Product follow-up, not changed here |
