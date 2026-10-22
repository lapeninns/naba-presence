# MultiCA execution report, 21-22 October 2026

How the modernisation was split across Claude accounts and checked. Times are
BST (UTC+1), from `multica issue runs`. Briefs, rules, reports, handoffs and
patches are in `~/.multica/claude-team/outputs/naba-presence-test-ci-modernization-20261021/`
on the owner's Mac.

## Accounts and roles

MultiCA 0.6.4, workspace "Lapen Inns", project NabaPresence. Each account is
a separate subscription with its own dedicated daemon capped at one run, so
at most eight packages ran at once, and they shared those daemons with
naba-table's and Nabaperks' modernisation packages queued the same night.

| Account     | MultiCA role used                                   | Work                                                                                                                 |
| ----------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 0 (primary) | the integrator: this Claude Code Desktop session    | discovery, briefs, baseline, the gate and workflow redesign, every integration, review fixes, final validation, docs |
| claude1     | Database Engineer                                   | NP1 audit; C1 isolation and determinism                                                                              |
| claude2     | Code Reviewer                                       | NP2 audit; C5 unit cleanup                                                                                           |
| claude3     | Security Engineer                                   | NP3 audit; C7 runner and security tests; C2 (reassigned)                                                             |
| claude4     | Full-Stack Engineer                                 | NP4 audit; C8 release probe and rollback; C8b review fixes                                                           |
| claude5     | UI & Accessibility Engineer                         | NP5 audit; C6 component cleanup                                                                                      |
| claude6     | Test Automation Engineer                            | NP6 audit; C4 Playwright                                                                                             |
| claude7     | Documentation & Dependencies / Maintenance Engineer | NP7 audit; C3 format ratchet and hook                                                                                |
| claude8     | Requirements & UX Analyst                           | NP8 audit (C2 started here and was moved, below)                                                                     |

The primary and Codex daemons were not started for this work, as the
overnight protocol required.

## Stage A: read-only audit (parent AMA-194)

| Package                                          | Issue   | Account | Ran         | Report           |
| ------------------------------------------------ | ------- | ------- | ----------- | ---------------- |
| NP1 integration, server routes, DB harness       | AMA-195 | claude1 | 22:32-22:46 | `reports/NP1.md` |
| NP2 root unit and source-contract tests          | AMA-196 | claude2 | 22:32-22:52 | `reports/NP2.md` |
| NP3 CI security, supply chain, security coverage | AMA-197 | claude3 | 22:48-23:01 | `reports/NP3.md` |
| NP4 workflows, local gate, release pipeline      | AMA-198 | claude4 | 22:40-22:55 | `reports/NP4.md` |
| NP5 component tests, design checks               | AMA-199 | claude5 | 22:46-23:00 | `reports/NP5.md` |
| NP6 Playwright, agentic, visual, perf            | AMA-200 | claude6 | 22:39-22:49 | `reports/NP6.md` |
| NP7 scripts, dependencies, legacy files, docs    | AMA-201 | claude7 | 22:35-22:46 | `reports/NP7.md` |
| NP8 critical-behaviour coverage map              | AMA-202 | claude8 | 22:34-22:47 | `reports/NP8.md` |

All eight ran in parallel after queuing behind naba-table's audits; 29
minutes from the first start to the last report.

## Stage C: implementation (parent AMA-210)

Each package had exclusive file ownership, worked from `50df9739` (C8b from
the integration branch, shipped as a git bundle), committed locally, never
pushed, and delivered `git format-patch` series plus a handoff. The
integrator owned `package.json`, the lockfile, `vitest.config.ts`,
`playwright.config.ts`, `scripts/release/**`, `.github/**` and `docs/ci.md`.

| Package                                                                 | Issue   | Account | Ran         | Integrated                                                                 |
| ----------------------------------------------------------------------- | ------- | ------- | ----------- | -------------------------------------------------------------------------- |
| C1 test-database isolation, deterministic integration                   | AMA-211 | claude1 | 23:25-00:09 | 8 patches + teardown wiring, docs, ledger                                  |
| C2 RLS catalogue (P0), route gaps, text-only migration test replacement | AMA-212 | claude3 | from 00:54  | see BEFORE_AFTER.md                                                        |
| C3 format ratchet, pre-push hook, docs path checks                      | AMA-213 | claude7 | 23:09-23:22 | 4 patches + wiring; hook fixed to keep the secret scan on docs-only pushes |
| C4 Playwright consolidation and determinism                             | AMA-214 | claude6 | from 23:41  | see BEFORE_AFTER.md                                                        |
| C5 unit cleanup, route scanner, unit gaps                               | AMA-215 | claude2 | 22:53-23:54 | 12 patches + formatting, ledger                                            |
| C6 component cleanup, Google-write form tests                           | AMA-216 | claude5 | 23:41-00:43 | 13 patches                                                                 |
| C7 runner hooks, gitleaks hygiene, two P1 security suites               | AMA-217 | claude3 | 23:58-00:46 | 5 patches + Plan event allowlist, docs                                     |
| C8 post-promotion probe, rollback                                       | AMA-218 | claude4 | 23:14-23:27 | 2 patches + docs                                                           |
| C8b release fixes from the independent review                           | AMA-228 | claude4 | 00:11-00:29 | 3 patches + docs                                                           |

## Independent verification

- **Review workflow on the primary account** (14 agents: three review lenses,
  each finding attacked by a separate verifier) over the integrated branch:
  7 defects confirmed, 4 refuted. The integrator fixed the gate and docs-only
  rule defects; the release ones went back to claude4 as C8b.
- **The Codex overnight supervisor** independently reviewed C8 and the gate
  and found that the upgrade check compared only the last 262,144 characters
  of a 497,304-byte schema dump; the integrator confirmed it on a real
  cluster and fixed it with a regression test.
- **Every package's claims were re-checked by the integrator** on the merged
  tree (typecheck, lint, the package's tests, the format ratchet) and finally
  by full gate runs (BEFORE_AFTER.md).

## Coordination and recovery

- Three repositories' packages shared the eight accounts: mine queued behind
  naba-table's audits and implementation runs, so packages started 10 to 150
  minutes after dispatch.
- C2 waited about two hours behind a long naba-table run on claude8 while
  five accounts were idle. Its never-started run was cancelled and the issue
  reassigned to claude3 (the NP3 author); logged as a recovery in the
  overnight log.
- A comment on a MultiCA issue starts a new run: the addendum sent to C2
  queued a duplicate, which was cancelled before it started. Later
  instructions went in briefs, not comments.
- Full-suite runs were serialised by the integrator: the baseline, then the
  branch gate, never two at once, with machine load logged each minute
  (the Mac was shared with the other repositories' suites; load averages
  9-116).

## Limitations

- MultiCA agents could not run the full integration or e2e suites (shared
  machine and dev-database safety); each ran only the files it changed on
  its own throwaway cluster. The integrator's gate runs are the full-suite
  evidence.
- Hosted CI could not run at all (Actions budget), so no package has a
  hosted check.
- Provider quota was not measured; no account hit a limit during the work.
