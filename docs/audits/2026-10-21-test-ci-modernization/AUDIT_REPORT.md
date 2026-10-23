# Testing and CI/CD audit, 21 October 2026

Commit audited: `50df9739` (main). Read-only audit in eight packages, NP1 to
NP8, one per Claude account (claude1 to claude8) through MultiCA (parent
issue AMA-194, packages AMA-195 to AMA-202), integrated by the primary
session. Full package reports, with every finding's evidence, consumers and
commands: `~/.multica/claude-team/outputs/naba-presence-test-ci-modernization-20261021/reports/NP*.{md,json}`
on the owner's Mac (outside the repository). This file is the synthesis; the
decisions taken from it are in [CLEANUP_DECISIONS.md](CLEANUP_DECISIONS.md)
and the measurements in [BEFORE_AFTER.md](BEFORE_AFTER.md).

## 1. Repository overview

NabaPresence is a single Next.js 16.3.8 app (App Router, React 19.3, webpack
standalone build, Node 24, pnpm 10.34.5) for managing Google Business
Profiles: reviews inbox, AI reply drafts with credit accounting, listing
edits written to Google, approvals, billing (Stripe), scheduled sync jobs,
notifications and retention. PostgreSQL 17 (Supabase in production) with
forced row-level security per organisation and a non-superuser runtime role.

| Item                                  | At `50df9739`                                                                                       | Source             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------ |
| Route files / handlers                | 162 / 249 methods; 24 `auth: "public"`, 18 `auth: "cron"` declarations, the rest session            | NP8, NP3           |
| Migrations                            | 149 SQL files, append-only (`scripts/ci/migration-policy.mjs`)                                      | NP8                |
| Vercel crons / scheduler ticks        | 9 / 9                                                                                               | NP8                |
| Test files                            | 831: components 324, root unit 247, integration 163, server 47, e2e 39, agentic 9, visual 1, perf 1 | integrator, static |
| Static test cases                     | about 7,700 (`it`/`test` call sites; Playwright lists 752 because widths multiply)                  | integrator, NP6    |
| Workflows / jobs                      | 5 / 14 (`ci.yml` 9 jobs, nightly 2, CodeQL 1, Claude review 1, readiness probe 1)                   | integrator         |
| package.json scripts / deps / devDeps | 34 / 25 / 22                                                                                        | NP7                |

## 2. How changes were actually gated

- **Hosted CI has not completed a job since 2026-10-03.** Every hosted job
  is annotated "The job was not started because an Actions budget is
  preventing further use". No self-hosted runner is registered and no
  repository variable is set, so the Mac lane designed in `ci.yml` never
  ran. 178 PRs were merged past a failing required `CI result` through the
  admin bypass (NP4-012), #248 among them.
- **The real gate is local**: `pnpm verify:release`
  (`scripts/release/verify-local.mjs`), a fresh worktree and throwaway
  PostgreSQL 17, writing the receipt `release:promote` requires. Across five
  promotions it took 54, 56, 74, 71 and 71 minutes; integration
  (2,058-2,295 s) and e2e (1,020-1,831 s) were about 93% of it, run one
  after the other (NP4). The newest receipt on main before this audit
  (`d4684442`, 19 October) failed its unit and e2e steps.
- **Two definitions of the same gate.** `ci.yml` (13 parallel jobs) and
  `verify-local.mjs` (13 serial steps) had drifted: migration base (hosted
  compared main with itself on push), the "tests actually ran" guard (local
  only), `pnpm audit` (local only, nightly hosted), browser (system Chrome
  locally, bundled Chromium hosted), retries (0 locally, 1 hosted) (NP4-004).
- **Dead or harmful automation.** `nightly.yml` failed 27 of 27 runs (the
  first nine were real critical advisories ignored for nine days; the rest
  the budget). `readiness-probe.yml` skipped all 46 runs and would bill at
  least a minute every five minutes if configured. `claude-review.yml` let a
  pull-request run read the repository's only secret from the head's copy of
  the workflow (NP3-005). Dependency review and code scanning answer 403 on
  this private repository, so `CI result` could not pass even with budget
  (NP4-001/002, verified with the dependency-graph compare API).

## 3. Test inventory and quality

| Layer                             | Files               | Verdict               | Key findings                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit, root (`tests/*.test.ts`)    | 247                 | mostly KEEP           | 15 text-only migration tests assert DDL that the append-only policy freezes (cannot fail after merge; one is already wrong); dead exports pinned only by their tests; four reimplementations of route discovery with blind spots; real-clock assertions; serial execution never needed (NP2) |
| Server (`tests/server`)           | 47                  | KEEP                  | mocked route tests are complementary to integration, not duplicates (NP1-015)                                                                                                                                                                                                                |
| Components (`tests/components`)   | 324                 | KEEP                  | behaviour-led, no snapshots, no skips; two dead components with tests; a few trivial or class-pinning tests; Google-write onboarding and profile forms untested at this layer (NP5)                                                                                                          |
| Integration (`tests/integration`) | 163                 | KEEP, IMPROVE         | the only real-boundary protection for isolation, billing and data loss; defaults to the shared dev database; at least 165 s of fixed sleeps; lease flakes from a database-global `fleet_lease` row; collected and skipped by every `pnpm test` (NP1)                                         |
| E2E (`tests/e2e`)                 | 39 specs, 752 tests | IMPROVE               | 291 tests from 61 journeys repeated at three widths; one-worker serial run; gate used system Chrome; skips passed the gate; deletes the dev tenant when pointed at it (NP6)                                                                                                                  |
| Agentic, visual, perf             | 9 + 1 + 1           | KEEP outside the gate | exploratory or on-demand tools; the first-load JS budget script could gate in seconds but nothing ran it (NP6-008)                                                                                                                                                                           |

Determinism problems found: real-clock limits in `jobs-tick-plan` and
`google-transport`, reliance on nothing listening on port 9, fake timers and
env stubs not restored, order dependence in `jobs-migration` (NP2-014); the
27 s wait and other `waitForTimeout`/`networkidle` waits in e2e (NP6-006);
the advisory-lock flakes (NP1-002).

## 4. Coverage of critical behaviour

Protection is strong and mostly at the real boundary: 134 of 163
integration files drive the real standalone server over HTTP against real
PostgreSQL through the runtime role, and 160 of 162 route files are reached
by an integration or e2e test (NP8). The gaps are narrow:

| Priority | Gap                                                                                                                                           | Found by                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| P0       | No check that every tenant table has row-level security enabled and forced with a policy (the only catalogue check covered 4 tables)          | NP1-G01, NP2-G01, NP3-G01, NP8-G01 |
| P0       | Nothing pins which handlers are reachable without a session (23 public, 18 cron)                                                              | NP3-G02, NP8-G02                   |
| P1       | `POST /api/webhooks/google/pubsub/replay` untested at every layer                                                                             | NP1-G02, NP8-G03                   |
| P1       | Session GET routes never proven not to return another tenant's object by id                                                                   | NP3-G03                            |
| P1       | Support impersonation issuance untested at the real boundary; operator CLIs (`ops-pause`, `revoke-support-sessions`) never executed by a test | NP3-G04, NP8-G04                   |
| P1       | The harness accepts the developer's database on port 54322                                                                                    | NP1-G04, NP7-004, NP6-001          |
| P1       | No post-promotion production check; rollback never drilled                                                                                    | NP4-G01, NP4-G02                   |
| P1       | Onboarding creation-draft forms and four profile sections untested at component level                                                         | NP5-G01, NP5-G02                   |
| P1       | No real password sign-in or MFA journey in a browser                                                                                          | NP6-G01, NP6-G02, NP8-G06          |

## 5. Security and supply chain

Workflow hygiene is strong (NP3-001): `permissions: {}` with least privilege
per job, no credential persistence, every third-party action SHA-pinned to
the commented tag, untrusted values through `env:`, zizmor and actionlint
clean. Weak points: the Claude review secret exposure; the self-hosted
runner hooks `pkill -u` across both instances and leave state between jobs
(NP3-002/003); 16 stale `.gitleaksignore` entries (NP3-008); Dependabot npm
updates failing since 2026-10-09 with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`
and security updates off (NP3-007); no workflow lint anywhere while code
scanning is unavailable (NP3-G06). `pnpm audit --prod --audit-level high`
and a full-history gitleaks scan run in the local gate.

## 6. Operational risks

1. Merges rest on local evidence that nothing records per PR.
2. The release gate takes over an hour, so it runs at release time only;
   13 commits on main were ungated when audited (NP4-012).
3. Ad-hoc `pnpm test:integration`/`test:e2e` runs seed and delete tenants in
   whatever database `.env` names, including the owner's dev tenant; fleet
   sweeps in those runs plausibly explain imported reviews disappearing
   (NP1-014, unverified by design).
4. The self-hosted lane, if switched on as written, would produce random
   failures (cross-instance `pkill`) and run any agent branch on the Mac.

## 7. Limitations of the audit

No package ran the integration or e2e suites (forbidden in Stage A to
protect the shared Mac and the dev database); those claims come from the
code and committed receipts. Static counts are regex-based. Timings taken by
packages ran at load averages of 30 to 100 on a Mac shared by three
repositories' agents and are ratios at best; the integrator's measurements
are in [BEFORE_AFTER.md](BEFORE_AFTER.md).
