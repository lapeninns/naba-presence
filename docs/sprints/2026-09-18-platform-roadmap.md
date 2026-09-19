# Platform roadmap — from the 2026-09-18 assessment

Source: full-codebase assessment on branch `design/listings` (backend, frontend, tests,
CI/ops, docs, product gaps). Every finding from that assessment maps to exactly one goal
below. The format matches `2026-09-core-hardening.md`: each sprint has one outcome; each
goal has an owner scope (file allowlist), and a done-when check. Every sprint ends with
the same gate, run by the orchestrator only:

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:integration
```

Phases run in order. Sprints inside a phase run in the order listed unless a goal says
"parallel". Rough sizes are in agent-days, assuming the current one-orchestrator,
parallel-owner-agents workflow.

| Phase | Theme                                | Size      | Unlocks                                   |
| ----- | ------------------------------------ | --------- | ----------------------------------------- |
| A     | Hygiene                              | 2         | trustworthy docs, smaller repo            |
| B     | Security and correctness blockers    | 8         | real customers on the current feature set |
| C     | Independent human review             | 1 + fixes | confidence in tenancy and publishing      |
| D     | Scale ceilings                       | 6         | more than a handful of tenants            |
| E     | Test coverage and delivery pipeline  | 7         | safe weekly releases                      |
| F     | Structure refactors                  | 8         | features in G land without fighting size  |
| G     | Compliance and ops UI                | 5         | the data-controls story is visible        |
| H     | Product features (internal-tool bar) | 12        | Lapen venues fully served                 |
| I     | Product features (agency bar)        | 25        | sellable to hospitality groups            |
| J     | Growth bets                          | open      | general local-presence market             |

---

## Phase A — Hygiene

### Sprint A1 — Docs and dead code

**Outcome:** every document under `docs/` is either living and accurate or clearly archived; the app tree contains no prototype code.

| Goal                                      | Owner scope                                                                                     | Done when                                                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1.1 Archive historical plans **(done 2026-09-19)** | the former `docs/superpowers/**` tree → `docs/archive/2026-07-frontend-rebuild/**`, `README.md`, `AGENTS.md` | the tree no longer exists and nothing outside this sprint record points at it; README and AGENTS link to the archive with a one-line note that its instructions are historical. Amended on completion: the original "grep returns nothing" wording was unsatisfiable, since any record of the move must name the old path. Three specs (agency UX, work-first IA, listings) were swept in by the move and returned to `docs/specs/` — they are live contracts, not history |
| A1.2 Fix the feature map                  | `docs/frontend-backend-feature-map.md`, `docs/architecture.md`                                  | no referenced path fails `test -e`; a unit test (`tests/docs-paths.test.ts`) greps both docs for backtick paths and asserts each exists                         |
| A1.3 Move the migration guide out of code | `lib/server/gbp-write.ts:31-120` → `docs/archive/2026-09-core-hardening/gbp-write-migration.md` | `gbp-write.ts` header is under 30 lines and describes the current contract only                                                                                 |
| A1.4 Remove prototype surfaces **(done 2026-09-19)** | `app/design-system/**`, `lib/server/env.ts`, `playwright.config.ts`, `README.md`, related tests | the inbox prototype is deleted; `/design-system` returns 404 unless `DESIGN_SYSTEM_EVIDENCE_ENABLED` is set, which defaults off in production and on in development; build passes. Amended on completion: a `NODE_ENV !== "production"` gate was rejected because the e2e harness serves a production build, so it would have 404ed the accessibility and contrast evidence the a11y certification depends on. There is no sitemap, robots route or middleware in the repo to exclude the route from |
| A1.5 Prune merged branches **(done 2026-09-19)** | git only | only `main`, `design/listings` and `design/menu-workspace-rebuild-2026-09-07` remain locally and on origin. Ten local and six origin branches were deleted, each confirmed an ancestor of `main` first |
| A1.6 Decide the self-hosted path **(done 2026-09-19)** | `Dockerfile`, `compose.yaml`, `.github/workflows/ci.yml`, `README.md`, `docs/runbook.md` | **Decided: Vercel only.** `compose.yaml`, the `Dockerfile`, `.dockerignore` and the compose-only `scripts/load/otel-collector.yaml` are deleted, and the README and runbook say production is Vercel. CI never built or booted the stack, so it was untested infrastructure that both documents instructed people to run. The `scripts/load/` harness itself is kept for D2.3 |

---

## Phase B — Security and correctness blockers

### Sprint B1 — Abuse limits and cost caps

**Outcome:** no public or AI-backed route can be driven without bound by one caller or one tenant.

| Goal                         | Owner scope                                                                                                                                                                   | Done when                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1.1 Rate-limit primitive    | new `lib/server/rate-limit.ts`, migration `rate_limit_bucket`, `lib/server/route.ts` (`rateLimit` option), unit + integration tests                                           | Postgres-backed fixed-window or token bucket keyed by `(scope, key)`; `route({ rateLimit: { scope, keyBy: "ip" \| "email" \| "org", limit, windowMs } })`; 429 with `retry-after`; no Redis dependency |
| B1.2 Apply to public auth    | `app/api/auth/password/**`, `app/api/invitations/**`, `app/api/session/**`                                                                                                    | login, register, resend, reset-request and reset-complete limited per IP and per email; tests assert 429 after the limit and recovery after the window                                                 |
| B1.3 AI quota and accounting | migration `ai_usage`, `lib/server/ai.ts`, `lib/server/env.ts` (`AI_DAILY_DRAFTS_PER_ORG`, `AI_MONTHLY_TOKENS_PER_ORG`), `app/api/drafts/**`, `app/api/reviews/[id]/drafts/**` | every OpenAI call records model, tokens in/out and org; a per-org daily draft cap and monthly token cap return a stable `ai_quota_exceeded` 429; usage is visible on `/api/operations/health`          |
| B1.4 AI resilience           | `lib/server/ai.ts`, tests with a fake fetch                                                                                                                                   | one retry with jitter on 429/5xx inside the existing timeout; a `Provider` interface (`draft`, `verify`) with the OpenAI implementation behind it so a second provider is a new file, not an edit      |

### Sprint B2 — Sessions and visibility

**Outcome:** sessions rotate and expire absolutely; visibility fails closed.

| Goal                              | Owner scope                                                                                                                                                    | Done when                                                                                                                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2.1 Throttle last-seen writes    | `lib/server/session.ts`, `lib/server/session-store.ts`, tests                                                                                                  | `last_seen_at` written only when older than `SESSION_TOUCH_INTERVAL_MS` (default 5 min); a read-only request does zero writes                                                                                                    |
| B2.2 Rotation and absolute expiry | same, `lib/server/password-auth.ts`, `app/api/session/switch`, `lib/server/env.ts` (`SESSION_ABSOLUTE_MAX_AGE_MS`)                                             | session id rotated on login, password reset and organisation switch; sessions older than the absolute cap are rejected regardless of activity; cookie `max-age` matches                                                          |
| B2.3 Fail-closed visibility       | migration (`organisation_member.all_locations boolean`), `lib/server/permissions.ts`, `lib/server/member-roles.ts`, `components/team/**`, `app/api/members/**` | a member with zero `location_member` rows and `all_locations = false` sees nothing; migration backfills existing members to `true`; the Team page exposes the toggle; owners/admins are always `true`; tests cover both branches |
| B2.4 Close the env hole           | `lib/server/env.ts`, `lib/server/google/transport.ts`                                                                                                          | `GOOGLE_API_PROXY_BASE` is a schema field with URL validation; no `process.env` reads outside `env.ts` (lint rule or grep test)                                                                                                  |

### Sprint B3 — One attempt machine and hot kill switches

**Outcome:** provider attempts have one state machine and one failure classifier; operators can pause a surface without a deploy.

| Goal                      | Owner scope                                                                                                                                                                                                                      | Done when                                                                                                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B3.1 Unify attempt stores | `lib/server/publishing/attempt.ts`, `lib/server/gbp-write.ts` (`attemptStore`), `lib/server/publishing/{retry,settle,recover}.ts`, migration if needed, tests                                                                    | one `AttemptStore` implementation and one `classifyProviderFailure()` used by replies and every GBP write; 429 and 5xx classify identically everywhere; the "two stores" header comment is gone; recovery tests pass unchanged                     |
| B3.2 Runtime flags table  | migration `runtime_flag`, new `lib/server/flags.ts`, `lib/server/env.ts` (env value becomes the default), every `GBP_*_ENABLED` / `WEBHOOKS_ENABLED` / `RETENTION_*` read site, `app/api/operations/flags` (support role), tests | flags resolve `db override → env default`, cached for `FLAGS_TTL_MS` (default 15 s); flipping via the route takes effect on the next tick without a deploy; every flip is audited; `docs/runbook.md` drops "disable Vercel Cron" as the fast lever |

### Sprint B4 — Migration safety

**Outcome:** a bad migration cannot reach production unnoticed.

| Goal                        | Owner scope                                                        | Done when                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B4.1 Dry-run gate           | `scripts/db-migrate.mjs` (`--dry-run`), `.github/workflows/ci.yml` | CI applies `main`'s migrations, then the branch's new ones inside a transaction that is rolled back; failure blocks the PR                                                      |
| B4.2 Destructive-DDL marker | new `scripts/check-migrations.mjs`, `supabase/migrations/**`       | any `drop table`, `drop column` or type narrowing requires a `-- destructive: <reason>` header line; the check runs in CI; existing 0003/0024/0025 get the header retroactively |
| B4.3 Expand/contract policy | `docs/runbook.md`, `docs/architecture.md`                          | the roll-forward policy states the two-release expand/contract rule and the check that enforces it                                                                              |

---

## Phase C — Independent human review

### Sprint C1 — External review

**Outcome:** one engineer who did not write the code has read the tenancy, session and publishing modules and every finding is closed or explicitly accepted.

| Goal                  | Owner scope                                         | Done when                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1.1 Review brief     | new `docs/reviews/2026-xx-security-review-brief.md` | lists the modules (`permissions.ts`, `session*.ts`, `route.ts`, `db.ts`, `crypto.ts`, `publishing/**`, `gbp-write.ts`, `jobs.ts`, `pubsub.ts`, RLS migrations), the threat model, and the questions to answer |
| C1.2 Review           | read-only, external                                 | findings recorded in `docs/reviews/` with severity                                                                                                                                                            |
| C1.3 Fixes            | as found                                            | every high and medium finding fixed with a regression test; lows accepted in writing                                                                                                                          |
| C1.4 Review as a rule | `.github/CODEOWNERS`, branch protection             | PRs touching the listed modules require one human approval; no self-merge                                                                                                                                     |

---

## Phase D — Scale ceilings

### Sprint D1 — Distributed pacing and pool sizing

| Goal                     | Owner scope                                                                                            | Done when                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1.1 Shared Google pacer | `lib/server/google/transport.ts`, migration `provider_rate_bucket`, tests with two simulated processes | the pacer is a Postgres token bucket keyed per Google project (and per connection where Google quotas are per account); N processes together never exceed `GOOGLE_REQUESTS_PER_SECOND`; process-local fallback only when the DB is down |
| D1.2 Pool sizing         | `lib/server/env.ts`, `lib/server/db.ts`, `docs/runbook.md`                                             | `DATABASE_POOL_MAX` default derived from `JOBS_CONCURRENCY + request headroom`; startup warns when the sum across configured instances exceeds the Supabase pooler limit; runbook documents the pooler mode                             |

### Sprint D2 — Job runner throughput

| Goal                       | Owner scope                                                                             | Done when                                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2.1 Partitioned tick lock | `lib/server/jobs.ts`, `app/api/jobs/run/route.ts`, `claim_due_jobs` migration, tests    | the single global advisory lock becomes one lock per job kind (or per `hash(org) % N` partition); two ticks can run at once without double-claiming; fairness caps preserved                                           |
| D2.2 Webhook fast path     | `app/api/webhooks/google/pubsub/route.ts`, `lib/server/pubsub.ts`, `lib/server/jobs.ts` | a verified push drains its own organisation's due webhook jobs inline within a small budget when no tick holds that partition; end-to-end latency from Google push to stored review under 10 s in the integration test |
| D2.3 Load evidence         | `scripts/load/**`, new workflow `load.yml` (manual dispatch)                            | a load run against a preview deployment reports p95 tick duration, claim fairness and pacer adherence; results attached to the run                                                                                     |

---

## Phase E — Test coverage and delivery pipeline

### Sprint E1 — Measured coverage where it matters

| Goal                                                           | Owner scope                                                                                                                                                                                                                                                               | Done when                                                                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1.1 Instrument `lib/server`                                   | `vitest.config.ts`, `.github/workflows/ci.yml`                                                                                                                                                                                                                            | coverage includes `lib/server/**` and `lib/api/**`; CI uploads the report and fails below a baseline that ratchets up (`coverage.thresholds` from the current measured number) |
| E1.2 Direct tests, untested modules (parallel, one agent each) | `automatic-google-discovery`, `automatic-google-setup`, `canonical-resources`, `email-auth`, `flat-route-redirect`, `location-activity`, `location-directory`, `member-roles`, `review-approval`, `review-queues`, `session-store` and their new `tests/server/*.test.ts` | each module has direct tests for its branches, not only via a route; `review-approval` covers every approval-gate outcome                                                      |
| E1.3 Job runner unit tests                                     | `lib/server/jobs.ts`, `tests/server/jobs-*.test.ts` (pglite)                                                                                                                                                                                                              | leasing, reaping, per-org caps, kill-switch-at-claim and ambiguous-outcome refusal each have a unit test independent of the route                                              |
| E1.4 Thin modules                                              | `gbp-write`, `cron-query`, `logger`, `oauth-return` tests                                                                                                                                                                                                                 | redaction, cron auth and OAuth return-path parsing have negative-case tests                                                                                                    |

### Sprint E2 — Google contract and webhook realism

| Goal                     | Owner scope                                                                                       | Done when                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E2.1 Recorded fixtures   | `tests/fixtures/google/**`, `lib/server/google/**` tests                                          | every v4 and v1 endpoint the app calls has a recorded request/response pair (redacted) and a contract test that the client parses it; adding an endpoint without a fixture fails a test |
| E2.2 Live smoke workflow | new `.github/workflows/live-smoke.yml` (manual dispatch, secrets-gated), `scripts/live-smoke.mjs` | against a dedicated Google test location: list reviews, read profile, write and revert hours; never runs on PRs; results feed `docs/live-certification/`                                |
| E2.3 Webhook E2E         | `tests/e2e/helpers/stub-bridge.ts`, new `tests/e2e/webhook.spec.ts`, a local OIDC signing fixture | a signed Pub/Sub push with the pinned service account is accepted, an unsigned one is 401, and the resulting review appears in the inbox                                                |

### Sprint E3 — E2E stability and speed

| Goal                     | Owner scope                                                                   | Done when                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| E3.1 Locator convention  | `tests/e2e/**`, `components/**` (`data-testid` on interactive landmarks only) | page objects under `tests/e2e/pages/`; no spec selects by visible copy that is also user-facing text; the a11y spec is split per surface |
| E3.2 Parallel Playwright | `playwright.config.ts`, `tests/e2e/helpers/**`                                | stub bridge state is per-worker; `workers: 3` passes 5 consecutive CI runs; gate time drops below 12 min                                 |

### Sprint E4 — Deploy pipeline

| Goal                         | Owner scope                                                                                             | Done when                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E4.1 Preview smoke           | `.github/workflows/preview-smoke.yml`, `scripts/smoke.mjs`                                              | on every PR the Vercel preview URL is smoke-tested (health, sign-in page, one authenticated read via a preview-only bootstrap); failure blocks merge                 |
| E4.2 Post-deploy smoke       | same workflow on `deployment_status` for production                                                     | the same script runs against production after each deploy and pages on failure                                                                                       |
| E4.3 Scripted rollback       | `scripts/rollback.mjs`, `docs/runbook.md`                                                               | one command promotes the previous Vercel deployment and prints the migration state; runbook step replaced with the command                                           |
| E4.4 Alerts and SLOs in repo | `docs/observability.md`, new `ops/alerts/*.yaml` (or the provider's format), `scripts/check-alerts.mjs` | each health field in `/api/operations/health` has a threshold and an alert definition; SLOs for publish success, webhook latency and tick freshness are written down |

---

## Phase F — Structure refactors

### Sprint F1 — Server module splits (parallel, one agent each)

| Goal                    | Owner scope                                                              | Done when                                                                                              |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| F1.1 `import-review.ts` | `lib/server/import-review/{proposals,refresh,decision,apply}.ts`, barrel | no file over 400 lines; no function over 120; behaviour and error codes unchanged; existing tests pass |
| F1.2 `posts.ts`         | `lib/server/posts/{drafts,approval,publish,readback}.ts`                 | same                                                                                                   |
| F1.3 `media.ts`         | `lib/server/media/{upload,list,delete,readback}.ts`                      | same                                                                                                   |
| F1.4 `jobs.ts`          | `lib/server/jobs/{claim,run,reap,kinds/*.ts}`                            | same; each job kind is a file registering a handler                                                    |

### Sprint F2 — Component splits and shared form hook

| Goal                                       | Owner scope                                                                                                                                                                                                                       | Done when                                                                                                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F2.1 `useDraftForm`                        | new `lib/forms/use-draft-form.ts`, `lib/forms/field-errors.ts`, tests                                                                                                                                                             | one hook owns draft state, dirty tracking, reset-on-revision, submit, and mapping the API `fieldErrors` envelope onto fields; `useResetOnRevision` is absorbed                                                     |
| F2.2 Migrate the seven forms (parallel)    | `lib/locations/forms/{administration,business-information,food-menus,hours,industry,local-post,profile}.ts` and their editors                                                                                                     | each editor uses `useDraftForm`; field-level errors from the server render inline; no per-editor dirty logic remains                                                                                               |
| F2.3 Split oversized components (parallel) | `components/inbox/inbox-view.tsx`, `reply-composer.tsx`, `review-detail.tsx`, `review-publish.tsx`, `components/locations/profile/sections/industry-sections.tsx`, `profile-editor.tsx`, `components/listings/listings-board.tsx` | no component file over 350 lines; extracted pieces are pure evaluators plus thin renderers per the inbox pattern; component tests pass                                                                             |
| F2.4 Replace DOM events                    | `PUBLISH_PULSE_EVENT`, `REPLY_FOCUS_EVENT` sites, new `lib/ui/signals.ts`                                                                                                                                                         | cross-component signalling goes through a typed store or query state; no `window.dispatchEvent` in `components/`                                                                                                   |
| F2.5 One navigation model                  | `components/app-shell/nav.tsx`, `components/settings/settings-nav.tsx`, `lib/listings/areas.ts`                                                                                                                                   | one nav registry drives the shell, settings and listing areas; the "More" disclosure state lives in URL or server preference, not `sessionStorage`; the `/clients` landing for multi-location orgs explains itself |

### Sprint F3 — Legacy Google API isolation

| Goal                   | Owner scope                                                                                                     | Done when                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F3.1 v4 boundary       | `lib/server/google/legacy-v4/{reviews,posts,media}.ts`, `lib/domain/google-contract.ts`, `docs/architecture.md` | every `mybusiness.googleapis.com/v4` call lives under one directory behind interfaces the rest of the server imports; the doc lists them and the replacement status of each |
| F3.2 Deprecation watch | `docs/runbook.md`, a quarterly scheduled reminder                                                               | a checklist for the day Google announces successors: which fixtures, which interfaces, which kill switch                                                                    |

---

## Phase G — Compliance and ops UI

**Outcome:** every API the product already ships has a screen; the approval-boundary and data-controls story is visible to a buyer.

| Goal                        | Owner scope                                                                                  | Done when                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| G1 Audit log                | `app/(dashboard)/settings/audit/**`, `components/audit/**`, `lib/api/audit-log.ts`           | filter by actor, location, action and date; export CSV; server prefetch; a11y spec                                                      |
| G2 Privacy and legal holds  | `app/(dashboard)/settings/privacy/**`, `components/privacy/**`                               | create and track privacy requests, run an export, place and lift legal holds, all with confirm dialogs and audit                        |
| G3 Operations console       | `app/(dashboard)/operations/**` (support role), `components/operations/**`                   | health fields, backlogs, lease staleness, token expiry, runtime flags (B3.2) and AI usage (B1.3) on one screen with thresholds coloured |
| G4 Impersonation            | `components/app-shell/impersonation-banner.tsx`, `app/(dashboard)/operations/impersonate/**` | start and end impersonation from the console; a persistent banner while active; every impersonated write audited with both identities   |
| G5 Notification preferences | folded into H1                                                                               | —                                                                                                                                       |

---

## Phase H — Product features, internal-tool bar

**Outcome:** the nine venues can be run entirely from the product.

### Sprint H1 — Notifications

| Goal               | Owner scope                                                                                                         | Done when                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1.1 Event model   | migration `notification`, `notification_preference`, `lib/server/notifications.ts`, job kind `notification.deliver` | events: new review at or below a rating threshold, publish failure, hours or profile drift detected by reconciliation, connection token expiring, verification state change; per-user channel preferences |
| H1.2 In-app centre | `components/app-shell/notifications.tsx`, `app/api/notifications/**`                                                | unread count in the shell, list with mark-read, deep links to the review or listing                                                                                                                       |
| H1.3 Email digest  | `lib/server/email.ts` (Supabase SMTP or a provider), templates under `supabase/templates/`                          | immediate email for low-rating reviews and publish failures; daily digest for the rest; unsubscribe per event                                                                                             |

### Sprint H2 — Scheduled and recurring posts

| Goal                  | Owner scope                                                                                                                | Done when                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H2.1 Contract and job | `lib/contracts/location-posts.ts` (`scheduledAt`, `recurrence`), migration, `lib/server/posts/**`, job kind `post.publish` | a post approved with `scheduledAt` is published by the runner through `runGbpWrite` at that time; recurrence generates the next instance; failures raise H1 events |
| H2.2 Calendar         | `app/(dashboard)/listings/[id]/posts/**`, `components/posts/calendar.tsx`                                                  | month and week views across the org's listings, drag to reschedule, status per post                                                                                |

### Sprint H3 — Google Q&A

| Goal                      | Owner scope                                                                                                                           | Done when                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| H3.1 Ingest               | `lib/server/google/qanda.ts` (`mybusinessqanda` v1), migration, reconciliation job kind, fixtures (E2.1)                              | questions and answers stored per location with the same retention rules as reviews                         |
| H3.2 Answer with approval | `lib/server/qanda.ts` through `runGbpWrite`, `app/api/locations/[id]/questions/**`, `components/qanda/**`, AI draft via B1.4 provider | drafting, verification, approval and publish reuse the review pipeline phases; owner-posted FAQs supported |

### Sprint H4 — Bulk multi-location edits

| Goal            | Owner scope                                                                                      | Done when                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H4.1 Bulk write | `lib/server/bulk-write.ts` over `runGbpWrite`, `app/api/listings/bulk/**`, job kind `bulk.apply` | hours, special hours, attributes and place actions applied to a selection; one intent per location; per-location outcome; partial failure never blocks the rest |
| H4.2 UI         | `components/listings/bulk-editor.tsx`, board selection                                           | select on the board, edit once, review the per-listing diff, publish, watch outcomes; a11y spec                                                                 |

---

## Phase I — Product features, agency bar

**Outcome:** an agency can onboard a client, request reviews, report to them and bill for it.

### Sprint I1 — Review request campaigns

| Goal                      | Owner scope                                                                                     | Done when                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| I1.1 Contacts and consent | migrations `contact`, `consent`, `lib/server/contacts.ts`, CSV import                           | contacts per location with explicit consent source and timestamp; suppression list; UK PECR and GDPR notes in `docs/architecture.md`    |
| I1.2 Email requests       | `lib/server/campaigns.ts`, templates, job kind `campaign.send`, short-link route `app/r/[code]` | templated email with a per-contact link to the Google review URL; sends paced by the runner; opens and clicks tracked; opt-out honoured |
| I1.3 SMS provider         | `lib/server/sms/**` behind an interface, first provider adapter                                 | same flow over SMS; sender id and cost visible; kill switch                                                                             |
| I1.4 Campaign UI          | `app/(dashboard)/campaigns/**`, `components/campaigns/**`                                       | create, schedule, monitor conversion (requests → clicks → new reviews matched by time window)                                           |

### Sprint I2 — Client-facing reports

| Goal                    | Owner scope                                                                                         | Done when                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| I2.1 Export             | `lib/server/reports/**`, `app/api/reports/**`, PDF via a headless renderer job kind `report.render` | reply performance, presence and keyword reports export as PDF and CSV for a client and date range |
| I2.2 Branding           | migration `client_branding`, `app/(dashboard)/clients/[clientId]/settings/**`                       | logo, colours and sender name per client applied to PDFs and report emails                        |
| I2.3 Scheduled delivery | job kind `report.deliver`, `components/reports/schedule.tsx`                                        | weekly or monthly email to client recipients with the PDF attached; delivery logged               |

### Sprint I3 — Review analytics

| Goal                      | Owner scope                                                                                   | Done when                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| I3.1 Sentiment and topics | `lib/server/ai.ts` provider method `classify`, migration `review_insight`, job kind on ingest | each review tagged with sentiment and up to three topics from a fixed vocabulary; cost counted by B1.3 |
| I3.2 Trends               | `app/(dashboard)/reports/insights/**`, `lib/server/analytics-overview.ts`                     | topic and sentiment trends per location and across the org; included in I2 exports                     |

### Sprint I4 — Billing

| Goal                  | Owner scope                                                                                      | Done when                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| I4.1 Plans and limits | migration `plan`, `subscription`, `lib/server/billing.ts`, `lib/server/route.ts` (`requirePlan`) | location, seat, AI draft and campaign limits per plan enforced at the route                                                                         |
| I4.2 Stripe           | `app/api/billing/**`, webhook route with signature verification, customer portal link            | checkout, upgrade, downgrade and cancellation reflected within one webhook delivery; failed payment moves the org to read-only after a grace period |

---

## Phase J — Growth bets

Each is a separate spec before any code. Listed so they are not forgotten and so nothing in
A–I paints them out.

- Local rank grid and competitor tracking (third-party SERP data; cost model first).
- Listing sync to Apple Business Connect, Bing Places and Facebook through the same
  intent → write → readback pipeline, one provider adapter each.
- Public API and outbound webhooks with per-org keys, scoped by the same permissions.
- Mobile: PWA with push for H1 events before any native app.
- Regulated-sector positioning: the verification and approval boundary as the
  differentiator, with an evidence export per published reply.

---

## Ordering summary

```
A1 → B1 ∥ B2 → B3 → B4 → C1 → D1 ∥ E1 → D2 ∥ E2 ∥ E3 → E4 → F1 ∥ F2 → F3 → G → H1 → H2 ∥ H3 ∥ H4 → I1 ∥ I2 → I3 → I4 → J
```

C1 sits after B because B rewrites the modules under review. F precedes H so features
land in split modules. I4 is last in I because pricing needs the features to exist.

## Ledger

Filled in per sprint on completion, in the same form as `2026-09-core-hardening.md`.

### Sprint A1 — docs and dead code (2026-09-19)

Gate green before staging: `pnpm typecheck && pnpm lint && pnpm test && pnpm build &&
pnpm test:integration` — 1687 unit tests passed (301 skipped), 301 integration tests passed.
The `/design-system` flag gate is not covered by that gate, so
`tests/e2e/accessibility.spec.ts` and `tests/e2e/foundation.spec.ts` were run separately
against the production build: the design-system proof and both axe checks pass, confirming
the gating did not cost the accessibility evidence.

Shipped: the 2026-07 frontend-rebuild plans archived to
`docs/archive/2026-07-frontend-rebuild/` with an index README, every reference rewritten, and
README and AGENTS stating the archive is not active policy (A1.1); both audited documents'
cited paths corrected and held there by `tests/docs-paths.test.ts`, whose candidate rule is
derived from tracked files so CI and local runs agree (A1.2); the Sprint 2 migration guide
moved to `docs/archive/2026-09-core-hardening/gbp-write-migration.md`, leaving a 28-line
header, with the still-live behavioural contract (ambiguous vs failed, in-flight recovery,
the reply-pipeline boundary) rehomed into `docs/architecture.md` rather than archived with it
(A1.3); the inbox prototype deleted and `/design-system` gated behind
`DESIGN_SYSTEM_EVIDENCE_ENABLED` (A1.4); ten local and six origin branches deleted, each
confirmed an ancestor of `main` first (A1.5); `compose.yaml`, the `Dockerfile`,
`.dockerignore` and the compose-only otel config deleted, with README and runbook stating
production is Vercel (A1.6).

Deviations: A1.4's `NODE_ENV !== "production"` gate was replaced by a named flag — the e2e
harness serves a production build, so the specified gate would have 404ed the accessibility
and contrast evidence, and e2e is not in the sprint gate, so nothing would have caught it.
A1.1's "grep returns nothing" criterion was amended on completion as unsatisfiable: any record
of the move must name the old path. Review also caught the archive move sweeping in three
specs that are live contracts — `2026-09-03-agency-ux.md`, `2026-09-18-work-first-ia.md` and
`2026-09-19-listings.md`, the last being the contract for the branch this sprint ran on — which
were returned to `docs/specs/`.

Carried forward: a pre-existing WCAG 2.2 AA colour-contrast failure on the application shell
(`--np-ink-muted` #73777e on white at 4.49 against the 4.5 threshold, eight nodes, plus the
accent button at 3.95) — unrelated to this sprint, which touches no CSS, token or shell
component. `onAmbiguous` is still `"fail"` for profile, media, place actions and posts where
`docs/architecture.md` now records the intended convergence on `"readback"`; that convergence
is unscheduled and is not part of B3.1 as written. `scripts/scheduler.mjs` and
`pnpm start:scheduler` lost their only production consumer with compose; Vercel Cron drives
production. `Library/` (a stray pnpm store at the repo root) and `public/fonts/` are untracked
and not ignored.
