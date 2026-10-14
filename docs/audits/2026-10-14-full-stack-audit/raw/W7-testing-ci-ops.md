# W7 — Testing, CI/CD, infrastructure, observability, release safety

**Scope covered:** the repository's checks (run live), test inventory and coverage mapping against high-risk modules, `.github/workflows/*` against `docs/ci.md`, the local release gate and promotion (`scripts/release/*`, `scripts/ci/*`), committed receipts, migration policy and schema manifest, startup assertions, rollback path, OpenTelemetry/logging/readiness/health/ops-liveness, `vercel.json` crons, `scripts/scheduler.mjs`, `prepare-standalone`, and which hosting model production actually uses.

**Commands run (read-only apart from the checks):**

- `git status --short`, `git diff --stat`, `git log` (various, read-only)
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, run one after another with timing (results below)
- `rg`/`grep`/`find`/`jq`/`wc`/`sed` over `tests/`, `lib/`, `app/api/`, `scripts/`, `supabase/migrations/`, `.github/`, `docs/`
- `jq` over the committed promotion receipts in `docs/release/receipts/`, reading **variable names only** (`configNames`), never values

**Not covered, and why:**

- **Coverage run skipped.** No `@vitest/coverage-*` provider is installed (`node_modules/@vitest/` is absent), and `vitest.config.ts:38` scopes coverage to `lib/domain/**` only. Coverage gaps below are inferred from which modules tests import and which routes they exercise. They are not line coverage.
- **Not run, as instructed:** `pnpm build`, `test:integration`, `test:e2e`, `verify:release`. Their latest real results come from the committed local-gate receipt `docs/release/receipts/20261014T103113Z-2b26bcf2ec59.local.json`.
- **No GitHub API or Vercel calls.** The claims that hosted CI is not running and that PRs merge through admin bypass come from `docs/ci.md` and `docs/release/ledger.md`; I did not check them against live run history.
- **Production telemetry and log drains** (Vercel dashboard settings, drains, the integration's `VERCEL_OTEL_ENDPOINTS`) cannot be seen from the repo. Production env names come from the receipt's `vercel env ls production` capture of 2026-10-14.

---

## Check results (this checkout, HEAD `d8759c74` plus uncommitted inbox work)

| Check                                               | Exit | Wall  | Tail                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | ---- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` (`tsc --noEmit`)                   | 0    | 3 s   | Clean. Warm incremental run (`tsconfig.json:15 "incremental": true`); the cold run in the release gate took 13.7 s.                                                                                                                                               |
| `pnpm lint` (`eslint --max-warnings 0`)             | 0    | 43 s  | Clean, zero warnings.                                                                                                                                                                                                                                             |
| `pnpm test` (vitest `unit` + `components` projects) | 0    | 106 s | `Test Files 515 passed \| 144 skipped (659)` · `Tests 6509 passed \| 1255 skipped (7764)` · `Duration 104.87s (tests 42%, environment 30%, import 14%, setup 8%, transform 6%)` · vitest hint: `jsdom was created 265 times · 220.59s total, 32% of tracked time` |

**Attribution:** nothing failed. The counts match the release receipt for `2b26bcf2` exactly (515/144 files, 6509/1255 tests), so the uncommitted edits to `tests/components/{inbox-view,review-detail,review-list}.test.tsx` and `components/inbox/*` change no test counts and break nothing. The 144 skipped files are the 143 `tests/integration/**` files, which `describe.skip` without `RUN_DB_TESTS=true`, plus `tests/openai-live.test.ts`. stderr carries 152 `Not implemented: Window's scrollBy() method` lines. They come from committed code (`lib/editors/use-keep-focus-clear.ts:93` `window.scrollBy`); `scrollBy` does not appear in the uncommitted diff.

Latest full gate (receipt `…2b26bcf2ec59.local.json`, 2026-10-14, about 56 min end to end): integration `143 files / 1254 tests passed` in **2,059 s (34 min)**, e2e `572 passed (19.1m)`, build 43 s, unit 72 s, audit passed, gitleaks passed.

## Test inventory

| Area                                                                 |                                             Files | Runner / notes                                                                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/*.test.ts` (top level: domain, contracts, migrations-as-text) |                                               218 | vitest `unit` (node), `fileParallelism: false` (`vitest.config.ts:20`)                                                                                                                      |
| `tests/server/` (route units, release/CI scripts)                    |                                                32 | vitest `unit`                                                                                                                                                                               |
| `tests/components/`                                                  |                                               265 | vitest `components` (jsdom)                                                                                                                                                                 |
| `tests/integration/` (incl. 131 `routes/*`)                          |                                               143 | `pnpm test:integration`; boots the **standalone** server (`tests/integration/helpers/app-server.ts`) plus a Google stub, against a migrated Postgres through the non-superuser runtime role |
| `tests/e2e/`                                                         |                                          30 specs | Playwright, `workers: 1`, `retries: CI ? 1 : 0`, `forbidOnly` on CI (`playwright.config.ts:14-17`); webServer `pnpm start` (standalone)                                                     |
| `tests/agentic/`                                                     |                                      7 `*.e2e.ts` | `e2e.config.ts` agentic runner; not part of any gate                                                                                                                                        |
| `tests/perf/`                                                        | scripts + `budgets.json`, `budgets-baseline.json` | lab perf (LCP/TBT/INP/JS bytes/`apiRequests`); **not wired into any script or gate**                                                                                                        |
| `scripts/load/`                                                      |                                    3 load scripts | only `common.mjs` is unit-tested (`tests/load-scripts.test.ts`); not gated                                                                                                                  |

**High-risk modules against coverage.** The integration suite is black-box over HTTP, so 99 of the 219 `lib/server` files are never imported directly by a test but are still exercised through routes. Mapping:

| Risk area                                                  | Route-level / integration evidence                                                                                                                                       | Gap                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google write paths (`lib/server/google/*`, `publishing/*`) | `publish-lifecycle`, `mutation-recovery`, `sync-transactions`, `timeouts`, `connection-failures`, `risc`, 14 `standalone-*` suites, 8 `*-backend.spec.ts` e2e            | Good                                                                                                                                                                                                                          |
| Jobs / scheduler / crons                                   | `jobs-runner`, `leases`, `vercel-cron-ticks`, `cron-fleet-coverage`, `backfill-checkpoints`, `retention-*`, `health-alerting`; `tests/server/vercel-cron.test.ts`        | `scripts/scheduler.mjs` (589 lines) is referenced by only 2 test files (no direct behaviour suite found)                                                                                                                      |
| Billing / credits                                          | `billing-checkout`, `billing-events`, `billing-read-only`, `billing-integrity`, `ai-credits-concurrency`, `ai-credit-adjustments`; e2e `billing.spec.ts` (reads stubbed) | **`lib/server/billing/subscription-changes.ts` (417 lines) / `/api/billing/plan-change` and `/api/billing/cancel`: zero test references** (grep for `subscription-changes\|plan-change\|subscription_change` in `tests/` = 0) |
| Session / MFA                                              | `mfa`, `mfa-step-up`, `session-lifetimes`, `session-scope-fingerprint`, `identity-hardening`, `auth*`; `tests/server/mfa-*`                                              | Good                                                                                                                                                                                                                          |
| Key rotation                                               | `routes/key-rotation.test.ts`                                                                                                                                            | `lib/server/key-rotation.ts` has no unit test; covered at route level only                                                                                                                                                    |
| Mutation recovery                                          | `mutation-recovery` (integration) plus `mutation-recovery*.test.ts` (unit)                                                                                               | Good                                                                                                                                                                                                                          |
| Release/CI scripts                                         | `release-promote`, `release-verify-local`, `ci-aggregate`, `vercel-ignore-build`, `toolchain-parity`, `readiness-probe`                                                  | Good                                                                                                                                                                                                                          |

**Flakiness signals:** no `.only` anywhere in `tests/`. Conditional skips: `tests/e2e/business-mode.spec.ts:45,91,124,143,165` `test.skip(!businessTenant, …)` skip silently when the fixture has no business tenant; `tests/agentic/support.ts:101`; `openai-live` behind `RUN_LIVE_AI_TESTS`. E2E retries are 1 on CI and 0 locally (`playwright.config.ts:16`). The local gate does not set `CI`, so it runs with zero retries and system Chrome (`channel: "chrome"`, line 22) rather than bundled Chromium. No `test.fixme`.

---

## Findings

### W7-01 Merges to `main` have no automated gate; the only enforced gate is one machine's self-attested receipt

- Priority: P1
- Status: CONFIRMED (config and docs); merges through bypass PLAUSIBLE (taken from the ledger, not checked against the GitHub API)
- Location: `docs/ci.md:67-72`, `docs/ci.md:190-200`; `docs/release/ledger.md:323` (CI-01), `:326` (CI-04); `.github/rulesets/main.json`; `scripts/release/local-receipt.mjs:166-192` (`gateProblems`)
- Current implementation / Evidence / Root cause: hosted CI "has not run since about 2026-10-04" because the Actions budget stops every job (`docs/ci.md:70, 222-223`). The ruleset needs `CI result` but 0 approvals, and admin bypass in PR mode "merged PR #57 … with `CI result` … failing". Since 2026-10-10, promotion is bound to a local `verify:release` receipt instead (D-36). That gate is thorough: frozen install, typecheck, lint, unit, build, migration policy, fresh, upgrade and concurrent migrations, integration, e2e, audit, gitleaks. It is also a JSON file the operator's own machine writes, and `promote.mjs` trusts it. So `main` can go red between releases, and CodeQL, dependency review and Claude review do not run at all.
- Recommendation: (a) Restore one cheap hosted job: `Gate (typecheck + lint)` plus `unit`, about 3 min on hosted runners per `docs/ci.md:135-136`, as the required check, and keep the heavy integration/e2e on the local gate. (b) Or finish `scripts/ci/runner-setup.sh` (`SELF_HOSTED_ENABLED`) so the existing graph runs on the Mac at zero metered cost. (c) Either way, set required approvals to 1 for anything touching `supabase/migrations/**`, `scripts/release/**` or `.github/**` (CODEOWNERS), so the expand/contract rule (W7-05) has a real reviewer.
- Expected benefit: a red `main` is caught at merge time rather than at release time; security scanning resumes.
- Complexity: S (a), M (b) / Regression risk: low / Tests: `tests/server/ci-aggregate.test.ts` already pins the `needs` sets; update it if jobs move / Dependencies: Actions budget decision D-36, D-37

### W7-02 Production exports no telemetry; the metric catalogue, p95 dashboards and alert rules in `docs/observability.md` have no data source

- Priority: P1
- Status: CONFIRMED for the metric exporter; PLAUSIBLE for traces (a Vercel-side OTel integration would not show up as an env name)
- Location: `instrumentation.ts:12-40`; `lib/server/telemetry-status.ts` (`telemetryDisabledReason`); `lib/server/startup.ts:132`; `docs/release/receipts/20261014T103113Z-2b26bcf2ec59.json` → `configNames`; `docs/release/ledger.md:342` (OPS-05, open), decision D-41 (open)
- Current implementation / Evidence / Root cause: the OTLP metric reader is registered only when `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` is set. The production variable names captured at the 2026-10-14 promotion are `CRON_SECRET DATABASE_POOL_MAX DATABASE_SESSION_URL DATABASE_URL EMAIL_* GOOGLE_* JOBS_CONCURRENCY LOCAL_BOOTSTRAP_ENABLED NEXTAUTH_* OAUTH_STATE_* OPENAI_* OPS_ALERT_EMAILS PASSWORD_AUTH_ENABLED PUBLISH_ENABLED REGISTRATION_MODE SUPABASE_* TENANT_EMAIL_ENABLED TOKEN_ENCRYPTION_KEY WEBHOOKS_ENABLED`, with no `OTEL_*`. The seven instruments (`lib/server/db.ts:19-31`, `lib/server/google/transport.ts:32-44`, `performance.ts:25`, `keywords.ts:21`, pubsub `route.ts:31`) therefore record into a no-op provider, and readiness reports `telemetry_disabled` (degraded). There is also no error-tracking SDK (OPS-05 note). The only production signals are the structured JSON logs (`lib/server/logger.ts`, `api.unhandled_error` in `lib/server/http.ts`, `next.request_error` in `instrumentation.ts:52`) in Vercel function logs, whose retention depends on plan and drains (not visible from the repo).
- Recommendation: choose D-41's destination and set the endpoint in Preview first, then Production. On Vercel functions also flush on suspend: `PeriodicExportingMetricReader` at 60 s (`instrumentation.ts:24-30`) never gets a tick in an instance that is frozen after a 200 ms request, and nothing in the repo calls `forceFlush` or `after()` for metrics (PLAUSIBLE data loss; verify against `@vercel/otel` behaviour once an endpoint exists). Alternative: a Vercel log drain plus log-derived metrics, which needs no code change.
- Expected benefit: makes every baseline in the table below measurable.
- Complexity: S (configuration) to M (flush) / Regression risk: low / Tests: `readiness` integration already asserts the `telemetry` states; add a unit test that the reader is flushed at end of request if you implement it / Dependencies: D-41

### W7-03 Out-of-band liveness depends on the operator's laptop

- Priority: P1
- Status: CONFIRMED
- Location: `docs/observability.md` "The local probe" ("runs outside the deployment, on an operator's machine … there is no hosted workflow"); `scripts/ops/readiness-probe.mjs`; `app/api/cron/health/route.ts` (in-deployment alerting); ledger G4 "external scraper (OPS-03)" pending
- Current implementation / Evidence / Root cause: in-deployment alerting is strong. The health tick opens `platform_incident` rows and emails `OPS_ALERT_EMAILS` for stale, never-completed and wedged ticks and for quota pressure (`lib/server/ops-liveness.ts`, `notifications/platform.ts`). But it cannot report its own absence: a failed deployment, crons disabled, a startup assertion throwing on every cold start (W7-07), or an expired `CRON_SECRET`. The probe that catches those runs only while the operator's Mac is awake (`--notify` raises a macOS notification).
- Recommendation: point a hosted uptime checker (any SaaS with bearer-header support, or a Cloudflare Worker cron, since the account exists) at `GET /api/operations/readiness` every 5 min with `--expect-promoted` semantics (compare `release.sha`), and alert on non-200 or SHA mismatch. Use a dedicated read-only probe token instead of `CRON_SECRET` if the checker is a third party.
- Expected benefit: detects total outages and silent rollbacks within minutes.
- Complexity: S / Regression risk: none / Tests: existing `tests/server/readiness-probe.test.ts` covers exit codes / Dependencies: D-40

### W7-04 Promotion deploys straight to the production alias from a remote rebuild, and the smoke check is manual

- Priority: P1
- Status: CONFIRMED
- Location: `scripts/release/promote.mjs:471-515` (`deployArgs = ["deploy","--prod","--yes",…]`, then `console.log("Next: smoke-check GET /api/operations/health…")`); `docs/runbook.md:59-63`
- Current implementation / Evidence / Root cause: `vercel deploy --prod` uploads source, and Vercel builds it on Linux with production env, then assigns the production domain right away. The artifact the gate tested is a different build: `pnpm build` on darwin-arm64 with placeholder env, served by `pnpm start` (standalone). Any difference in build-time env, platform-native binaries (`sharp`/`@img`, see `docs/ci.md:235-237`) or the Vercel function runtime reaches users before anyone checks it. The health/readiness smoke is a printed instruction, not a step.
- Recommendation: `vercel deploy --prod --skip-domain` → run `scripts/ops/readiness-probe.mjs --url <deployment url> --expect-sha <sha>` automatically, with protection bypass on the deployment URL → only then `vercel promote <deploymentId>`. On failure, stop and leave the alias on the old deployment. Optionally build with `vercel build --prod` locally and ship with `vercel deploy --prebuilt` so the gate host produces the artifact (it is still not the standalone artifact e2e ran).
- Expected benefit: a bad build or failed startup assertion never takes production traffic, and rollback becomes "do nothing".
- Complexity: M / Regression risk: low (keep `--dry-run`) / Tests: extend `tests/server/release-promote.test.ts` for the three-phase flow and for refusing to promote on a probe exit ≠ 0 / Dependencies: D-38

### W7-05 Expand/contract migration rule is enforced only by review (0 required approvals), and migrations run without `lock_timeout`

- Priority: P2
- Status: CONFIRMED (policy gap); production impact HYPOTHESIS
- Location: `docs/ci.md:358-367` (rule); `scripts/ci/migration-policy.mjs` (checks only modify/delete/rename and numbering); `scripts/db-migrate.mjs` (no `lock_timeout`/`statement_timeout`); `supabase/migrations/0126_bulk_multi_item_batches.sql:20-60`
- Current implementation / Evidence / Root cause: nothing checks DDL content. `0126` combines expand and contract in one file: `add column items` → backfill `update` → `alter column items set not null`, `alter column input drop not null`, replaced CHECK constraints, and on `bulk_listing_child` `item_key`/`input set not null` and `seq drop default`. That is "add NOT NULL without a default", which the rule puts in a later PR. It was harmless here because the bulk tables arrived in the same release (the prior promotion `3294900` and the current one share migration head `0131`). The same pattern on an established table would break the live code between the manual `db:migrate` and `release:promote`, and would break rollback to the previous deployment. Only 2 of 131 migrations (`0105`, `0113`) set `lock_timeout`. A full-table `update` plus `set not null` takes `ACCESS EXCLUSIVE` and can queue every request behind a long transaction.
- Recommendation: add a lint step to `migration-policy.mjs` that flags new files containing `drop column|drop table|rename|set not null|drop default|add constraint … (not valid absent)` unless the file carries a `-- migrate:contract <reason>` header. Have `db-migrate.mjs` `set local lock_timeout = '5s'` per file by default, with a `-- migrate:lock-timeout` override.
- Expected benefit: makes the documented safety rule enforceable and avoids accidental table-lock outages.
- Complexity: S / Regression risk: low (new files only) / Tests: extend `tests/migration-contract.test.ts` with fixtures / Dependencies: W7-01(c)

### W7-06 Rollback runbook prescribes snapshot restore for every migration release, and cron config is not restored by Instant Rollback

- Priority: P2
- Status: CONFIRMED (docs); drills not done (ledger OPS-09 "awaiting evidence")
- Location: `docs/runbook.md:85-93`; `docs/ci.md:447-449`; `lib/server/startup.ts:184-221` (extra applied versions allowed, missing ones refused); ledger `:346`, `:395` (PR11)
- Current implementation / Evidence / Root cause: the rollback unit is "restore the snapshot and promote that exact previous deployment" as one unit. For an expand-only migration that loses every write since the snapshot (reviews, replies, billing events), even though the startup assertion already lets old code run on a newer schema. Instant Rollback "is not known to restore cron configuration".
- Recommendation: replace it with a decision tree: (1) expand-only migration and code fault → promote the previous deployment only; (2) migration corrupted data → restore the snapshot. Write a `release:rollback` script that promotes the previous receipt's `deploymentId`, then checks crons against that commit's `vercel.json` (`vercel inspect`), then runs the readiness probe with `--expect-sha`. Run one drill on staging.
- Complexity: S–M / Regression risk: low / Tests: unit-test the receipt lookup / Dependencies: W7-04

### W7-07 Startup safety assertion runs DB queries on every cold start, inside `register()`

- Priority: P2
- Status: PLAUSIBLE (cost); HYPOTHESIS (failure mode)
- Location: `instrumentation.ts:41-45` → `lib/server/startup.ts:184-221` (`readAppliedMigrations`, `readDbIdentity` → `pg_roles`)
- Current implementation / Evidence / Root cause: on Vercel each new function instance runs `register()`, which awaits two DB round trips before serving its first request. That is cold-start latency added to user requests, with `connect_timeout: 10` in `lib/server/db.ts:39`. Schema read errors become violations, but `readDbIdentity()` is not wrapped. A transient DB error at cold start throws out of `register()`, and how Next 16 on Vercel handles a rejected `register()` (fail that instance or every request on it) is untested.
- Recommendation: measure cold-start `register()` duration with a log field (`durationMs`) on `startup.safety_ok`. Consider caching the verdict per release SHA (one check per deployment, e.g. in the readiness path or a post-deploy probe) and making enforcement fail closed only on real violations, not on transport errors.
- Complexity: S / Regression risk: medium (safety-critical) / Tests: `tests/startup-safety.test.ts` for a thrown `readDbIdentity` / Dependencies: none

### W7-08 Tests run on a different runtime from production (standalone Node server vs Vercel functions)

- Priority: P2
- Status: CONFIRMED (topology); impact PLAUSIBLE
- Location: `next.config.ts` `output: "standalone"`; `package.json` `start` = `node .next/standalone/server.js`; `playwright.config.ts:52` `pnpm start`; `tests/integration/helpers/app-server.ts`; production = `vercel deploy --prod` (`promote.mjs:471`) with `vercel.json` crons, `regions: ["iad1"]`, per-route `maxDuration = 60`
- Current implementation / Evidence / Root cause: **Production is Vercel serverless functions.** `scripts/scheduler.mjs` and `.next/standalone` are the self-host/test topology only; the docs state "On Vercel there is no scheduler process" (`docs/observability.md`). Behaviour only Vercel shows: instance freezing (W7-02), `maxDuration` kills (jobs budget 45 s of 60, `app/api/jobs/run/route.ts:12`), cold-start `register()` (W7-07), per-instance in-memory pacing (`google/transport.ts:46`, documented as non-fleet), and cron GET vs scheduler POST. `vercel-cron-ticks.test.ts` covers the GET contract but not the runtime.
- Recommendation: add a post-deploy synthetic suite against the Preview deployment (W7-04's probe plus 3–5 read journeys from `tests/agentic` or Playwright with `baseURL` = preview). Long term, run e2e against `vercel dev` or a preview.
- Complexity: M / Regression risk: none / Tests: new / Dependencies: W7-04

### W7-09 The release gate does not check test volume, skips or flakes

- Priority: P2
- Status: CONFIRMED
- Location: `scripts/release/local-receipt.mjs:166-192` (`gateProblems` checks only `status`); `scripts/release/verify-local.mjs:233-258` (`summarizeOutput` records counts but nothing reads them); `tests/integration/*` `const describeDatabase = run ? describe : describe.skip`
- Current implementation / Evidence / Root cause: a step "passed" when its process exits 0. If `RUN_DB_TESTS` wiring regressed (`scripts/run-test-command.mjs:84-85`), the integration step would pass with 0 tests run, since every file would `describe.skip`, and promotion would accept it. Likewise Playwright `N skipped` (business-mode) and `flaky` lines are recorded but never judged.
- Recommendation: in `gateProblems`, refuse when integration reports `Tests 0 passed` or any `skipped`; refuse e2e with `flaky` or `skipped` above an allowlist; optionally compare counts to the base receipt and refuse a drop of more than 5% without `--allow-test-drop`.
- Complexity: S / Regression risk: low / Tests: `tests/server/release-verify-local.test.ts` / Dependencies: none

### W7-10 Local release gate takes about 56 min, with integration serial at 34 min

- Priority: P2
- Status: CONFIRMED (receipt timings)
- Location: receipt `…2b26bcf2ec59.local.json` (`integration` 2,058,944 ms, `e2e` 1,149,515 ms); `vitest.config.ts:20` `fileParallelism: false`; CI shards integration and e2e 2-way on separate clusters (`.github/workflows/ci.yml:259-363`)
- Current implementation / Evidence / Root cause: the local gate runs integration and e2e unsharded, one after the other, on one cluster. Hosted CI did the same work in about 8.5 min of integration across 2 shards. A gate this slow invites `--skip` iteration and batching of releases.
- Recommendation: in `verify-local.mjs`, start N clusters with `scripts/ci/postgres.mjs` (it already picks free ports) and run `test:integration --shard=i/N` concurrently, and run e2e alongside. Also: the `components` project spends 220 s creating jsdom 265 times. Try `pool: 'vmThreads'` or `isolate: false` per vitest's hint, and keep `tests/integration/**` out of the `unit` project's `include` so 143 files are not collected only to be skipped.
- Expected benefit: gate wall time could plausibly halve; measure with the receipt's `durationMs`.
- Complexity: M / Regression risk: low–medium (test isolation) / Tests: gate unit tests / Dependencies: none

### W7-11 No request-level latency, DB-per-request or cache metrics exist even in code

- Priority: P2
- Status: CONFIRMED
- Location: `lib/server/route.ts:368-453` (the wrapper adds a request id, abuse budget and intent, but no timing, span or counter); `lib/server/db.ts:19-31` (per-transaction metric with `tenant.id` attribute)
- Current implementation / Evidence / Root cause: the only latency instruments are per tenant transaction and per Google request. Nothing measures route duration or status, the number of `withTenant` transactions or statements per request, or response cache behaviour. `tenant.id` as a metric attribute gives one series per tenant (cardinality cost once exported).
- Recommendation: in `route()` record `nabapresence.http.server.duration` (attributes `http.route` template, method, status class) and a per-request `db.transactions` and `db.statements` count via AsyncLocalStorage, which `withMutationIntent` already uses. Log `durationMs` on every request at info level until W7-02 lands. Move `tenant.id` to span attributes only.
- Complexity: S–M / Regression risk: low / Tests: `tests/server/route-wrapper.test.ts` / Dependencies: W7-02

### W7-12 Lab perf budgets and load scripts exist but gate nothing, and the baseline evidence lives in `/tmp`

- Priority: P3
- Status: CONFIRMED
- Location: `tests/perf/budgets.json:2` (`"…see /tmp/naba-redesign/baseline/perf/REPORT.md"`), `tests/perf/budgets-baseline.json:2` ("NO-REGRESSION gate"); no `package.json` script or `verify-local` step references `tests/perf` or `scripts/load`
- Recommendation: add `perf:lab` / `perf:budgets` scripts, commit the baseline report under `docs/`, and add an optional `perf` gate step that warns on regression.
- Complexity: S / Regression risk: none

### W7-13 Documentation drift in `docs/ci.md`

- Priority: P3
- Status: CONFIRMED
- Location: `docs/ci.md:685-689` says "`pnpm audit` is red … 4 critical, 27 high". The 2026-10-14 gate's `audit` step passed after `e9dc7293 fix(deps): clear production audit advisories`. `docs/ci.md:129-147` timings and the self-hosted lane are described for a CI that is not running.
- Recommendation: update the nightly follow-ups, and put a dated "status" banner on §1–4.

### W7-14 Test stderr noise from jsdom `scrollBy`

- Priority: P3
- Status: CONFIRMED
- Location: `lib/editors/use-keep-focus-clear.ts:92-93`; 152 lines in `pnpm test` stderr
- Recommendation: stub `Element.prototype.scrollBy` and `window.scrollBy` in `tests/components/setup.ts` so real warnings stay visible.

---

## Available baselines against instrumentation needed

| Baseline                               | Available today?      | Source / how measured                                                                                                          | Instrumentation needed                                                                                                   |
| -------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| API p50/p95/p99 per route              | **No**                | Not exported (W7-02); no route timer (W7-11)                                                                                   | Route histogram in `route()` plus OTLP endpoint, or Vercel log drain plus a `durationMs` log                             |
| Google API latency/outcomes            | Code yes, **prod no** | `nabapresence.google.request.duration/count` (`google/transport.ts:32-44`)                                                     | Set `OTEL_EXPORTER_OTLP_ENDPOINT`; fix flush on Vercel                                                                   |
| DB transaction duration                | Code yes, **prod no** | `nabapresence.tenant_transaction.duration` (`db.ts:19`)                                                                        | Same as above                                                                                                            |
| DB query count/duration per request    | **No**                | —                                                                                                                              | Per-request ALS counter in `route()` / `withTenant`; or `pg_stat_statements` in Supabase (read-only query) for aggregate |
| Requests per interaction (page load)   | **Lab only**          | `tests/perf/perf-lab.mjs` records `apiRequests` per route; budgets 5–7 (`budgets.json`)                                        | Commit a baseline run; field RUM (web-vitals plus request count) for production                                          |
| Front-end LCP/INP/TBT/JS bytes         | **Lab only**          | `tests/perf/perf-lab.mjs`, `route-js.mjs`                                                                                      | Gate step (W7-12); RUM for field data                                                                                    |
| Cache hit rate (TanStack Query / HTTP) | **No**                | —                                                                                                                              | Client-side counters (QueryCache subscribe) to an analytics endpoint; `x-vercel-cache` header sampling                   |
| Error rate                             | Logs only             | `api.unhandled_error`, `next.request_error` JSON logs                                                                          | Error SDK or log-drain alert (OPS-05)                                                                                    |
| Job lag / backlog                      | **Yes**               | `/api/operations/health?scope=platform`: `dueJobBacklog`, per-source backlogs, `schedulerTicks[]`, `reconcileStalenessSeconds` | Scrape it on a schedule (W7-03) to keep history                                                                          |
| Tick liveness / cron health            | **Yes**               | `ops_heartbeat` run ledger (0089), readiness `ticks`, health-tick emails                                                       | External prober (W7-03)                                                                                                  |
| Google quota pressure                  | **Yes**               | `googleQuota` in health, `google_quota_pressure` incident                                                                      | —                                                                                                                        |
| Inbox query p95 (DB, lab)              | **Yes (test)**        | `tests/integration/inbox-performance.test.ts:164-208` asserts p95 < 1.5 s on seeded data                                       | Report the measured value in the receipt summary instead of only pass/fail                                               |
| Gate/CI durations                      | **Yes**               | Receipt `durationMs` per step                                                                                                  | —                                                                                                                        |
| Cold-start cost                        | **No**                | —                                                                                                                              | `durationMs` on `startup.safety_ok` (W7-07)                                                                              |

## Top 5 for this workstream

1. **W7-02**: production has no telemetry export, so every latency baseline is unmeasurable. Set the OTLP endpoint (D-41) and handle flush on serverless.
2. **W7-04**: promotion goes straight to the prod alias from a remote rebuild, with a manual smoke check. Switch to `--skip-domain` → probe → `vercel promote`.
3. **W7-03**: the readiness probe only runs on the operator's laptop. Add a hosted uptime check on `/api/operations/readiness`.
4. **W7-01**: merges are ungated while hosted CI is down. Restore a cheap hosted typecheck/lint/unit check, or the self-hosted lane, plus code owners on migrations and release scripts.
5. **W7-05 / W7-09**: make the gate check what it claims to: a DDL lint for the expand/contract rule, a default `lock_timeout`, and refusal on zero or skipped integration tests.

## Cross-layer leads for other workstreams

- Security (W-sec): `LOCAL_BOOTSTRAP_ENABLED` and `OAUTH_STATE_ACCEPT_LEGACY` are **present** in production env names (receipt `configNames`, 2026-10-14). Check their values and the code paths they open (`scripts/run-test-command.mjs:87` sets `LOCAL_BOOTSTRAP_ENABLED=true` for e2e, so it is a test-only surface).
- Billing (W-billing): `lib/server/billing/subscription-changes.ts` (417 lines), behind `app/api/billing/plan-change/route.ts` and `app/api/billing/cancel/route.ts`, has no test references.
- Backend perf (W-db): `lib/server/db.ts:36-45` pool `max: DATABASE_POOL_MAX` per serverless instance against the Supabase pooler. Confirm that instance count × max stays within pooler limits; `withSessionConnection` opens a fresh connection per lock (`db.ts:61-71`).
- Backend perf (W-db): `vercel.json:3` `regions: ["iad1"]`. Confirm the Supabase project region is co-located; every `withTenant` call pays the RTT.
- Google integration (W-google): `lib/server/google/transport.ts:46-64` process-local pacer resets on each cold instance. The fleet limit is the Postgres budget (`rate-budget.ts`), which fails open after 2 s (`google.rate_budget_unavailable` in `docs/observability.md`).
- Jobs (W-jobs): `/api/jobs/run` runs every minute with `budgetMs: 45_000` inside `maxDuration = 60` (`app/api/jobs/run/route.ts:12`). Cold start plus the startup assertion (W7-07) eat into the 15 s margin.
- Frontend (W-fe): `lib/editors/use-keep-focus-clear.ts:93` falls back to `window.scrollBy` when no scroller is found, which may scroll the whole page unexpectedly on layouts without a scroll container.
- Data/migrations (W-db): `supabase/migrations/0126_bulk_multi_item_batches.sql:20-26` runs a full-table `update` plus `set not null` with no `lock_timeout`. The pattern is worth checking in other large-table migrations.
