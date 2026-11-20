# Readiness re-score · 2026-11-20

Repository: `lapeninns/naba-presence`. Base: `26c9289a`. This uses the same
84-criterion rubric as [the baseline](baseline.md).

**74 pass, 6 fail, 4 skip. Level 1 is complete; Level 2 is not.** The target of
zero failed criteria is not met. Existing passes retain their evidence where
the underlying configuration was unchanged. Skips use only rubric exceptions;
unavailable owner changes are recorded as failures.

| Criterion | Level | Final | Evidence |
| --- | --- | --- | --- |
| `large_file_detection` | 3 | Pass | `pnpm check:quality` ratchets source files over 500 lines. |
| `tech_debt_tracking` | 3 | Pass | The release ledger is retained; `pnpm check:quality` now also ratchets TODO/FIXME markers without issue references. |
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
| `release_notes_automation` | 3 | Pass | `pnpm release:notes` generates Markdown from Git changes. Verified against `26c9289a^`. |
| `progressive_rollout` | 4 | Skip | This is a product application, not an infrastructure repository. |
| `rollback_automation` | 4 | Pass | `pnpm release:rollback`, `scripts/release/rollback.mjs` and `docs/ci.md` §7 implement and document rollback. |
| `monorepo_tooling` | 2 | Skip | Single application and single build package; `pnpm-workspace.yaml` has `packages: []`. |
| `version_drift_detection` | 3 | Skip | One build package, no sibling version graph. |
| `release_automation` | 3 | Fail | `docs/ci.md` §7 says a merge does not deploy production. The release gate automates qualification, but production migrations and promotion are operator steps. |
| `dead_feature_flag_detection` | 3 | Pass | `pnpm check:quality` compares definitions to consumers, finding all 32 flags referenced. |
| `agents_md` | 2 | Pass | `AGENTS.md` gives setup, validation, deployment conventions and repository-specific safety practices. |
| `readme` | 1 | Pass | `README.md` covers local setup, usage and provider dependencies. |
| `automated_doc_generation` | 2 | Pass | `pnpm docs:openapi` generates the checked-in inventory. `check:openapi` detects stale output. |
| `skills` | 3 | Pass | `.factory/skills/verify-and-ship/SKILL.md` was discovered and successfully loaded. |
| `documentation_freshness` | 3 | Pass | Core docs updated 2026-11-20 at `26c9289a`, within 180 days. |
| `service_flow_documented` | 3 | Pass | `docs/architecture.md` and `docs/frontend-backend-feature-map.md` explain application and provider dependencies. |
| `agents_md_validation` | 4 | Pass | `pnpm check:agents` checks local references and package commands in the guide. |
| `devcontainer` | 2 | Pass | `.devcontainer/devcontainer.json` pins the Node 24 dev environment and requests TypeScript tooling. |
| `env_template` | 1 | Pass | `.env.example` is tracked; `tests/env-flags.test.ts` enforces parity with schema and scheduler. |
| `local_services_setup` | 2 | Pass | `README.md` documents setting up Supabase and the non-superuser PostgreSQL role; `docs/testing.md` describes throwaway PostgreSQL. |
| `devcontainer_runnable` | 3 | Skip | `devcontainer` CLI is not installed. |
| `runbooks_documented` | 2 | Pass | `README.md` and `AGENTS.md` point to the operational `docs/runbook.md`. |
| `branch_protection` | 2 | Fail | Admin access verified. Active default branch ruleset `23895031` requires a PR and local CI status but zero approving reviews. Prepare only; do not change it. |
| `secret_scanning` | 3 | Pass | Native API is disabled, but the pre-push hook and required `secret-scan` release step run gitleaks with redaction. |
| `codeowners` | 2 | Pass | `.github/CODEOWNERS` assigns all paths to `@lapeninns`; API confirmed the account has repository admin and push access. |
| `automated_security_review` | 2 | Pass | GitHub code-scanning alerts returned 200 with 3 findings; checked-in CodeQL configuration and the release gate's dependency audit provide review evidence. |
| `dependency_update_automation` | 2 | Pass | `.github/dependabot.yml` and actual Dependabot PRs #277–279. |
| `gitignore_comprehensive` | 1 | Pass | Added `.idea/`, `.vscode/` and `.dev.vars*` ignore coverage. Only the example env file is tracked. |
| `privacy_compliance` | 4 | Pass | `app/(legal)/privacy/page.tsx`, `lib/server/privacy/` and `docs/runbook.md` cover data rights, retention and processing controls. |
| `secrets_management` | 2 | Pass | `.env*` ignored with only `.env.example` tracked; provider configuration references names, not saved credential values. |
| `min_release_age` | 3 | Pass | `.github/dependabot.yml` explicitly sets `cooldown.default-days: 7` for npm and GitHub Actions. |
| `issue_templates` | 2 | Pass | `.github/ISSUE_TEMPLATE/` includes bug and feature forms. |
| `issue_labeling_system` | 2 | Pass | GitHub has the P0–P3 priority, bug/feature/chore type and area families; the two live issues exercise those labels. |
| `backlog_health` | 4 | Pass | Live query found two open, descriptive, labelled issues created today (2/2, none stale). See [#286](https://github.com/lapeninns/naba-presence/issues/286) and [#287](https://github.com/lapeninns/naba-presence/issues/287). |
| `pr_templates` | 2 | Pass | `.github/pull_request_template.md` asks for context and testing. |
| `lint_config` | 1 | Pass | `eslint.config.mjs` and `pnpm lint` with `--max-warnings 0`; baseline lint exited 0. |
| `type_check` | 1 | Pass | `tsconfig.json` is strict; `pnpm typecheck` (`tsc --noEmit`) exit 0. |
| `formatter` | 1 | Pass | Prettier configuration and `pnpm format:check` run on changed files in verify and release gate. |
| `pre_commit_hooks` | 2 | Pass | Opt-in `.githooks/pre-push` runs `pnpm verify` and a pushed-commit gitleaks scan. |
| `strict_typing` | 2 | Pass | `tsconfig.json` already has `"strict": true`; baseline `pnpm typecheck` reported 0 errors. Existing agentic/external-tool exclusions are unchanged. |
| `naming_consistency` | 3 | Pass | `AGENTS.md` documents source conventions; `pnpm check:quality` enforces declaration naming. |
| `cyclomatic_complexity` | 5 | Pass | `pnpm check:quality` measures ESLint cyclomatic complexity over 15 and rejects growth. |
| `dead_code_detection` | 3 | Pass | Knip analysis runs in `lint:gate` and ratchets unused files and exports. |
| `duplicate_code_detection` | 3 | Pass | jscpd runs in `lint:gate` and ratchets both duplicate lines and share; 498 duplicate lines (~0.183%). |
| `code_modularization` | 4 | Pass | `tests/contracts-client-safe.test.ts` enforces transitive import boundaries for `lib/contracts/` in the unit gate. |
| `n_plus_one_detection` | 4 | Pass | `tests/integration/client-query-budget.test.ts` passed against a throwaway PostgreSQL 17 cluster and asserted constant query counts from 1 to 8 linked clients under the runtime role. |
| `heavy_dependency_detection` | 4 | Pass | `tests/perf/route-js.mjs` enforces first-load bundle budgets in the `bundle-budget` gate. |
| `unused_dependencies_detection` | 3 | Pass | Knip detects new unused dependencies in the release and pre-push gates. |
| `unit_tests_exist` | 1 | Pass | `tests/env-flags.test.ts` and other unit tests under `tests/`. |
| `integration_tests_exist` | 3 | Pass | `tests/integration/`, `tests/e2e/` and corresponding package scripts. |
| `unit_tests_runnable` | 2 | Pass | Bounded `pnpm exec vitest list --project unit tests/env-flags.test.ts` exited 0 and listed 18 tests without executing them. |
| `test_performance_tracking` | 4 | Pass | Release-gate receipts include test step durations and result counts; `scripts/ci/e2e-lanes.mjs` uses per-test durations to balance lanes. |
| `flaky_test_detection` | 4 | Pass | `playwright.config.ts` configures one CI retry and `docs/testing.md` describes deterministic test practices; no duplicate status names in the 10 sampled PRs. |
| `test_coverage_thresholds` | 2 | Pass | `pnpm check:coverage` enforces focused log-redaction floors of 88% lines, 81% statements, 84% branches and 83% functions. |
| `test_naming_conventions` | 3 | Pass | `vitest.config.ts` enforces explicit `*.test.ts` and `*.test.tsx` discovery per project. |
| `test_isolation` | 4 | Pass | `vitest.config.ts` runs isolated unit/component workers; integration jobs use scratch DBs and independent tenant fixtures. |
| `interactive_qa_exists` | 2 | Pass | `README.md` documents Node, pnpm, local Supabase, local session bootstrap and opening the local application; `app/api/session/route.ts` implements the bootstrap GET. |
| `interactive_qa_runnable` | 3 | Pass | Documentation fallback only: the local setup requires filling local env and applying migrations, prohibited as manual mission steps. `README.md` documents the prerequisites, launch URL and local bootstrap; no new interactive run claimed. |
| `api_schema_docs` | 3 | Pass | `docs/openapi.json` is an OpenAPI 3.1 inventory with core session/review schemas derived from Zod. |
| `database_schema` | 2 | Pass | `supabase/migrations/0001_initial.sql` and append-only migrations; `tests/integration/rls-catalogue.test.ts` exercises the migrated schema. |
| `structured_logging` | 2 | Pass | `lib/server/logger.ts` remains the JSON sink and now also handles Next Node request errors. |
| `distributed_tracing` | 3 | Pass | OpenTelemetry is retained. API correlation flows through the route wrapper, structured logs and Google transport. Page proxy stamps a separate server-generated ID. |
| `metrics_collection` | 3 | Pass | `instrumentation.ts`, `lib/server/request-metrics.ts` and `docs/observability.md` cover OTLP export and request/provider/database measurements. |
| `code_quality_metrics` | 4 | Pass | GitHub code-scanning analyses returned 200 with 30 entries. The release gate also measures bundle size and maintains a design ratchet. |
| `error_tracking_contextualized` | 2 | Fail | Source map and contextual server capture wiring exists, but end-to-end source mapping and approved data handling still require a staging trial. Browser collection is off. |
| `alerting_configured` | 3 | Pass | `docs/observability.md` Alert rules and `lib/server/notifications/platform.ts` define operational alerting and delivery; the shared nightly smoke is supplemental. |
| `deployment_observability` | 4 | Pass | `docs/ci.md` §7 documents observing deploy impact and exercising the release SHA and schema compatibility through the platform health probe. |
| `health_checks` | 3 | Pass | `app/api/operations/health/route.ts` and readiness automation check the web process, scheduler and schema. |
| `circuit_breakers` | 4 | Pass | `lib/server/notifications/delivery.ts` backs off alert-provider retries exponentially; `lib/server/google.ts` has retry and rate-bucket resilience. |
| `profiling_instrumentation` | 4 | Pass | `docs/observability.md` documents local standalone Node 24 CPU sampling via `--cpu-prof`; profiles remain in the ignored build directory. |
| `dast_scanning` | 4 | Pass | The existing HTTP integration security assertions remain in local CI. Local passive ZAP instructions supplement them but were not run. |
| `pii_handling` | 3 | Pass | Privacy and retention in `docs/runbook.md` and `lib/server/privacy/`; redaction and safe operational logging documented separately. |
| `log_scrubbing` | 3 | Pass | Structured log redaction now covers contact details and cookie header text as well as credentials. |
| `product_analytics_instrumentation` | 3 | Pass | `components/auth/sign-in-analytics.tsx` and `app/(auth)/sign-in/page.tsx` instrument optional GA4. |
| `error_to_insight_pipeline` | 5 | Fail | Nightly smoke can open labelled test-failure issues when configured, but the app error tracker has no verified issue-creation integration. |

## Owner-only actions and remaining failures

- **Branch protection (Level 2):** Ruleset `23895031` is active on the default branch. It blocks deletion and force pushes and requires a pull request and strict `local-ci/release-gate`, but `required_approving_review_count` is `0`. With the repository owner's approval, run the following from a shell with `jq`. The command fetches the current ruleset, changes only the PR approval count, and preserves the conditions, other rules and bypass actors. This command was prepared, not executed.

  ```sh
  set -o pipefail
  gh auth switch --user lapeninns
  ruleset=repos/lapeninns/naba-presence/rulesets/23895031
  gh api "$ruleset" |
    jq -e '
      if .enforcement == "active" and
         ([.rules[] | select(.type == "pull_request")] | length) == 1
      then
        {name, target, enforcement, bypass_actors, conditions, rules}
        | (.rules[] | select(.type == "pull_request")
          | .parameters.required_approving_review_count) = 1
      else error("Unexpected ruleset shape; review manually")
      end
    ' |
    gh api --method PUT "$ruleset" --input -
  gh api "$ruleset" --jq '.rules[] | select(.type == "pull_request") | .parameters.required_approving_review_count'
  ```

- **CI feedback (Level 4):** Measure and improve the required end-to-end gate without omitting lanes or publishing a success status from a faster subset. The latest sampled 20 merged PRs averaged 14m49s. Re-sample typical PRs after the owner changes shared runner capacity or gate parallelism. No `platform/local-ci` edits or runner profile changes were made.
- **Release automation and deployment cadence (Levels 3 and 4):** Decide production trigger policy in [#286](https://github.com/lapeninns/naba-presence/issues/286). Automate qualified promotion with existing migration, receipt and rollback safeguards if the policy allows it. Record enough successful production promotions to demonstrate multiple automated deploys per week. Release-note generation is not a deployment.
- **Error tracking and error-to-issue (Levels 2 and 5):** Approve a Sentry staging project, set `SENTRY_DSN` at build and runtime, and add `--enable-source-maps` to the server's `NODE_OPTIONS`. Use only a synthetic staging error to confirm source mapping, the coarse session context and redaction. In Sentry, install the GitHub integration for `lapeninns/naba-presence`, then configure and exercise issue creation. Do not enable browser error capture before separate diagnostics consent, revocation and disclosures are approved. No provider settings or secrets were changed.
- **Nightly smoke:** Schedule the disposable health and alerting test described in `docs/observability.md` on the shared runner, and use `nightly-report.mjs --post` only on failure. The reporter's dry run was checked; no test issue was opened. No tracked private env files were found (`git ls-files` returned only `.env.example`).
- **Inherited services:** Retained PostgreSQL, Supabase Auth, Stripe and the email adapter because the application calls them. No Mailgun wiring was found in the server code. No guest-facing routes, content or design were removed.

## Validation

- Node 24.16.0 and pnpm 10.34.5; frozen install passed. Existing direct
  dependency versions are unchanged. Vite 8.1.6 is now explicit because the
  Sentry SDK's optional Vite peer otherwise displaced the existing resolution
  used by Vitest.
- `VITEST_MAX_WORKERS=4 pnpm verify` exited 0. Unit and component suite:
  10,904 passed, two existing live tests skipped, 251.41s. The quality ratchet
  passed with 1,463 finding buckets; log-redaction coverage passed at 92.59%
  lines, 89.65% statements, 89.28% branches and 100% functions. Design ratchet
  passed and all 240 contrast pairs passed.
- The first webpack build compiled but exited 1 on a Next.js security
  warning. The unchanged retry completed the standalone build. An unfiltered
  production audit reported seven moderate advisories for pinned Next.js
  16.4.1 and no high or critical advisories. Plan a separate owner-approved
  update to at least 16.4.5; the no-upgrade constraint kept the version pinned
  here. The required release audit threshold was not changed.
- Disposable integration runs passed the new query-budget test and the 13
  existing health, alerting and unlink/disconnect tests. No developer or
  production database was used. The devcontainer CLI and ZAP were absent;
  no container acceptance or passive ZAP scan is claimed. No live Sentry
  test or separate browser suite was run.
- The final-head `local-ci/release-gate` result is tracked on the pull request,
  not in this commit.
