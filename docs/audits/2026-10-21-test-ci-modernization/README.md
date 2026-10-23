# Testing and CI/CD modernisation, 21-22 October 2026

Branch `chore/test-ci-modernization`, from `50df9739`. The living
documents this changed are [docs/ci.md](../../ci.md) (the gate, the
workflow, release and rollback) and [docs/testing.md](../../testing.md)
(the test strategy). This folder is the record of how and why:

| File                                                       | What it holds                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [AUDIT_REPORT.md](AUDIT_REPORT.md)                         | the eight-package audit of the starting point: tests, CI/CD, coverage, security, risks |
| [CLEANUP_DECISIONS.md](CLEANUP_DECISIONS.md)               | what was removed, kept, consolidated and replaced, and why                             |
| [BEFORE_AFTER.md](BEFORE_AFTER.md)                         | measurements before and after, the validation runs, remaining risks and follow-ups     |
| [MULTICA_EXECUTION_REPORT.md](MULTICA_EXECUTION_REPORT.md) | how the work was split across the Claude accounts, verified and recovered              |

## In one paragraph

Hosted CI had not run since 2026-10-03 and the only real gate, the local
`pnpm verify:release`, took 54-106 minutes, ran its steps one after another,
compared only half of the schema in its upgrade check, and failed on main
under load. It is now one gate run the same way locally and in CI: steps run
by their dependencies under a CPU budget, integration in four isolated
shards, the browser suite in two concurrent halves, with new checks
(formatting, design ratchet, bundle budget, workflow lint) and a whole-schema
comparison. The test harness can no longer touch the developer's database,
fixed sleeps and skips are gone, and the P0 and P1 coverage gaps the audit
found (forced row-level security on every tenant table, the public and cron
route surface, cross-tenant reads, support impersonation, the Pub/Sub replay
route, Google-write forms, post-promotion verification and rollback) have
tests.
