# Readiness baseline · 2026-11-20

Target: `lapeninns/naba-presence`, lci profile `naba-presence`. Base: `origin/main` at `26c9289a`. Scored against the 2026-11-20 rubric before making changes.

**53 pass, 27 fail, 4 skip (84 criteria).** The lowest failing level is Level 1; higher levels are not fully satisfied.

| Criterion | Level | Baseline | Evidence |
| --- | --- | --- | --- |
| `large_file_detection` | 3 | Fail | No source file line/size gate; the existing `bundle-budget` checks emitted browser JS, not source files. |
| `tech_debt_tracking` | 3 | Pass | `docs/release/ledger.md` tracks open evidence and residual risks with IDs, priorities and owners; `docs/requirements-matrix.md` traces requirements to tests. |
| `build_cmd_doc` | 2 | Pass | `AGENTS.md` commands table documents `pnpm build`; CI uses the webpack standalone output. |
| `deps_pinned` | 2 | Pass | Committed `pnpm-lock.yaml`; `pnpm install --frozen-lockfile` passed with Node 24.16.0 and pnpm 10.34.5. |
| `vcs_cli_tools` | 2 | Pass | `gh auth status` confirmed active `lapeninns`; repository API confirmed admin and push access. |
| `automated_pr_review` | 2 | Pass | Recent PRs #280, #283 and #285 have generated Codex review comments or reviews, not just check statuses. |
| `agentic_development` | 3 | Pass | `git log -100` contains Claude co-author trailers; recent Codex PR reviews corroborate active use. |
| `fast_ci_feedback` | 4 | Fail | Latest lci gate comment on each of 20 recently merged PRs averaged 14m49s, before install; 2 of 20 were under 10m. GitHub StatusContexts report publication timestamps, not when each job started. |
| `build_performance_tracking` | 4 | Pass | Promotion copies include per-step build duration (e.g. 116632 ms in `docs/release/receipts/20261117T235439Z-2f0bb5b0f199.local.json`); the gate builds once and reuses the output, documented in `docs/ci.md` §4. |
| `deployment_frequency` | 4 | Fail | No GitHub releases or deploy runs in the queried window. Checked-in promotion receipts show 3, 5, 1 and 1 promotions in the last four completed Friday–Thursday weeks as of Nov 20; not multiple every week. Production promotion is manual per `docs/ci.md` §7. |
| `single_command_setup` | 3 | Pass | `README.md` Local setup covers Node, pnpm, local Supabase and `pnpm dev`. |
| `feature_flag_infrastructure` | 4 | Pass | `lib/server/env.ts` defines runtime flags; `tests/env-flags.test.ts` covers defaults and switch behavior. |
| `release_notes_automation` | 3 | Fail | Promotion receipts carry operational qualification evidence, not generated change notes. |
| `progressive_rollout` | 4 | Skip | This is a product application, not an infrastructure repository. |
| `rollback_automation` | 4 | Pass | `pnpm release:rollback`, `scripts/release/rollback.mjs` and `docs/ci.md` §7 implement and document rollback. |
| `monorepo_tooling` | 2 | Skip | Single application and single build package; `pnpm-workspace.yaml` has `packages: []`. |
| `version_drift_detection` | 3 | Skip | One build package, no sibling version graph. |
| `release_automation` | 3 | Fail | `docs/ci.md` §7 says a merge does not deploy production. The release gate automates qualification, but production migrations and promotion are operator steps. |
| `dead_feature_flag_detection` | 3 | Fail | `tests/env-flags.test.ts` checks schema/template parity and behavior, not whether all defined flags have live consumers. |
| `agents_md` | 2 | Pass | `AGENTS.md` gives setup, validation, deployment conventions and repository-specific safety practices. |
| `readme` | 1 | Pass | `README.md` covers local setup, usage and provider dependencies. |
| `automated_doc_generation` | 2 | Fail | No configured release-note, API or other documentation generator found. |
| `skills` | 3 | Fail | No tracked `SKILL.md`; `.claude/launch.json` is not a skill. |
| `documentation_freshness` | 3 | Pass | Core docs updated 2026-11-20 at `26c9289a`, within 180 days. |
| `service_flow_documented` | 3 | Pass | `docs/architecture.md` and `docs/frontend-backend-feature-map.md` explain application and provider dependencies. |
| `agents_md_validation` | 4 | Fail | No CI, hook or script verifies commands and links in `AGENTS.md`. |
| `devcontainer` | 2 | Fail | No `.devcontainer/devcontainer.json`. |
| `env_template` | 1 | Pass | `.env.example` is tracked; `tests/env-flags.test.ts` enforces parity with schema and scheduler. |
| `local_services_setup` | 2 | Pass | `README.md` documents setting up Supabase and the non-superuser PostgreSQL role; `docs/testing.md` describes throwaway PostgreSQL. |
| `devcontainer_runnable` | 3 | Skip | `devcontainer` CLI is not installed. |
| `runbooks_documented` | 2 | Pass | `README.md` and `AGENTS.md` point to the operational `docs/runbook.md`. |
| `branch_protection` | 2 | Fail | Admin access verified. Active default branch ruleset `23895031` requires a PR and local CI status but zero approving reviews. Prepare only; do not change it. |
| `secret_scanning` | 3 | Pass | Native API is disabled, but the pre-push hook and required `secret-scan` release step run gitleaks with redaction. |
| `codeowners` | 2 | Fail | No tracked CODEOWNERS; default-branch `gh api repos/lapeninns/naba-presence/codeowners/errors` returned 404. |
| `automated_security_review` | 2 | Pass | GitHub code-scanning alerts returned 200 with 3 findings; checked-in CodeQL configuration and the release gate's dependency audit provide review evidence. |
| `dependency_update_automation` | 2 | Pass | `.github/dependabot.yml` and actual Dependabot PRs #277–279. |
| `gitignore_comprehensive` | 1 | Fail | `git check-ignore` confirmed env, dependencies, build and OS patterns, but `.idea/`, `.vscode/` and `.dev.vars` were not ignored. Only `.env.example` is tracked among env-file names queried. |
| `privacy_compliance` | 4 | Pass | `app/(legal)/privacy/page.tsx`, `lib/server/privacy/` and `docs/runbook.md` cover data rights, retention and processing controls. |
| `secrets_management` | 2 | Pass | `.env*` ignored with only `.env.example` tracked; provider configuration references names, not saved credential values. |
| `min_release_age` | 3 | Pass | `.github/dependabot.yml` explicitly sets `cooldown.default-days: 7` for npm and GitHub Actions. |
| `issue_templates` | 2 | Fail | No `.github/ISSUE_TEMPLATE/`. |
| `issue_labeling_system` | 2 | Fail | GitHub has default and dependency labels, but lacks priority and area families. |
| `backlog_health` | 4 | Fail | `gh issue list --state open --limit 50` returned an empty list. |
| `pr_templates` | 2 | Pass | `.github/pull_request_template.md` asks for context and testing. |
| `lint_config` | 1 | Pass | `eslint.config.mjs` and `pnpm lint` with `--max-warnings 0`; baseline lint exited 0. |
| `type_check` | 1 | Pass | `tsconfig.json` is strict; `pnpm typecheck` (`tsc --noEmit`) exit 0. |
| `formatter` | 1 | Pass | Prettier configuration and `pnpm format:check` run on changed files in verify and release gate. |
| `pre_commit_hooks` | 2 | Pass | Opt-in `.githooks/pre-push` runs `pnpm verify` and a pushed-commit gitleaks scan. |
| `strict_typing` | 2 | Pass | `tsconfig.json` already has `"strict": true`; baseline `pnpm typecheck` reported 0 errors. Existing agentic/external-tool exclusions are unchanged. |
| `naming_consistency` | 3 | Fail | No application-wide naming gate or written conventions apart from specialized test and framework filenames. |
| `cyclomatic_complexity` | 5 | Fail | No complexity gate in ESLint or local release scripts. |
| `dead_code_detection` | 3 | Fail | No Knip or equivalent unused-file/export check in the release gate. |
| `duplicate_code_detection` | 3 | Fail | No CPD, jscpd or equivalent in the release gate. |
| `code_modularization` | 4 | Pass | `tests/contracts-client-safe.test.ts` enforces transitive import boundaries for `lib/contracts/` in the unit gate. |
| `n_plus_one_detection` | 4 | Fail | `lib/server/request-metrics.ts` counts tenant transactions, not SQL statements; no query-count growth test found. |
| `heavy_dependency_detection` | 4 | Pass | `tests/perf/route-js.mjs` enforces first-load bundle budgets in the `bundle-budget` gate. |
| `unused_dependencies_detection` | 3 | Fail | No dependency-use analysis in the release gate. |
| `unit_tests_exist` | 1 | Pass | `tests/env-flags.test.ts` and other unit tests under `tests/`. |
| `integration_tests_exist` | 3 | Pass | `tests/integration/`, `tests/e2e/` and corresponding package scripts. |
| `unit_tests_runnable` | 2 | Pass | Bounded `pnpm exec vitest list --project unit tests/env-flags.test.ts` exited 0 and listed 18 tests without executing them. |
| `test_performance_tracking` | 4 | Pass | Release-gate receipts include test step durations and result counts; `scripts/ci/e2e-lanes.mjs` uses per-test durations to balance lanes. |
| `flaky_test_detection` | 4 | Pass | `playwright.config.ts` configures one CI retry and `docs/testing.md` describes deterministic test practices; no duplicate status names in the 10 sampled PRs. |
| `test_coverage_thresholds` | 2 | Fail | `docs/testing.md` says no global coverage target; `vitest.config.ts` has a coverage include but no enforced threshold. |
| `test_naming_conventions` | 3 | Pass | `vitest.config.ts` enforces explicit `*.test.ts` and `*.test.tsx` discovery per project. |
| `test_isolation` | 4 | Pass | `vitest.config.ts` runs isolated unit/component workers; integration jobs use scratch DBs and independent tenant fixtures. |
| `interactive_qa_exists` | 2 | Pass | `README.md` documents Node, pnpm, local Supabase, local session bootstrap and opening the local application; `app/api/session/route.ts` implements the bootstrap GET. |
| `interactive_qa_runnable` | 3 | Pass | Documentation fallback only: the local setup requires filling local env and applying migrations, prohibited as manual mission steps. `README.md` documents the prerequisites, launch URL and local bootstrap; no new interactive run claimed. |
| `api_schema_docs` | 3 | Fail | 172 Next API route files and no matching OpenAPI, Swagger or GraphQL document. |
| `database_schema` | 2 | Pass | `supabase/migrations/0001_initial.sql` and append-only migrations; `tests/integration/rls-catalogue.test.ts` exercises the migrated schema. |
| `structured_logging` | 2 | Pass | `lib/server/logger.ts` emits structured JSON and redacts context. |
| `distributed_tracing` | 3 | Pass | `instrumentation.ts` registers OpenTelemetry; `lib/server/route.ts` and `lib/server/http.ts` correlate route requests with `x-request-id`. This passes the rubric but not the additional milestone requirement for middleware and outbound propagation. |
| `metrics_collection` | 3 | Pass | `instrumentation.ts`, `lib/server/request-metrics.ts` and `docs/observability.md` cover OTLP export and request/provider/database measurements. |
| `code_quality_metrics` | 4 | Pass | GitHub code-scanning analyses returned 200 with 30 entries. The release gate also measures bundle size and maintains a design ratchet. |
| `error_tracking_contextualized` | 2 | Fail | Structured Next request errors are logged, but no source-mapped error-tracking SDK with breadcrumbs and user context is configured. |
| `alerting_configured` | 3 | Pass | `docs/observability.md` Alert rules and `lib/server/notifications/platform.ts` define operational alerting and delivery; the shared nightly smoke is supplemental. |
| `deployment_observability` | 4 | Pass | `docs/ci.md` §7 documents observing deploy impact and exercising the release SHA and schema compatibility through the platform health probe. |
| `health_checks` | 3 | Pass | `app/api/operations/health/route.ts` and readiness automation check the web process, scheduler and schema. |
| `circuit_breakers` | 4 | Pass | `lib/server/notifications/delivery.ts` backs off alert-provider retries exponentially; `lib/server/google.ts` has retry and rate-bucket resilience. |
| `profiling_instrumentation` | 4 | Fail | OTLP spans/metrics and the browser performance lab do not provide configured runtime profiling. |
| `dast_scanning` | 4 | Pass | The local CI integration step runs HTTP security tests against a locally built server, e.g. unauthenticated and forbidden unlink requests in `tests/integration/routes/unlink-disconnect.test.ts`. No ZAP baseline command yet. |
| `pii_handling` | 3 | Pass | Privacy and retention in `docs/runbook.md` and `lib/server/privacy/`; redaction and safe operational logging documented separately. |
| `log_scrubbing` | 3 | Pass | `lib/domain/redaction.ts` scrubs sensitive keys, URL credentials, bearer values and JWTs. Email and phone coverage still required by M6. |
| `product_analytics_instrumentation` | 3 | Pass | `components/auth/sign-in-analytics.tsx` and `app/(auth)/sign-in/page.tsx` instrument optional GA4. |
| `error_to_insight_pipeline` | 5 | Fail | No configured error tracker issue integration or error-to-issue workflow. |

## Baseline check results

- `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`: exit 0.
- `pnpm test`: exit 1 in 458.26s; 720 files passed, 2 failed, 2 skipped; 10,895 tests passed, 2 failed, 2 skipped.
- `tests/server/release-fast-path.test.ts` reproduced independently: 12 passed, 1 failed with `spawnSync git ENOENT`. The test used a file URL pathname as a filesystem path, leaving the worktree's spaces percent-encoded.
- `tests/components/client-settings.test.tsx` did not reproduce independently: 25 passed, including the archive test that failed waiting for copy in the full suite.
- No PR, deployment, GitHub setting changes, or lci invocation were needed to score the baseline.
