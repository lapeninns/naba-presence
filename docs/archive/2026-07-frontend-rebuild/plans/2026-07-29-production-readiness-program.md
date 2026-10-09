# Production-Readiness Program — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This master plan is the index and shared-design contract; execute the five sprint plans listed in §2, in order, one plan per sprint.

**Goal:** Take NabaPresence from "all local gates green under a superuser + bootstrap setup" to a controlled production release, by executing the five-sprint program (3 August – 9 October 2026) against this exact codebase.

**Architecture:** Five sequential sprint plans fix, in order: (1) tenant safety under a least-privilege PostgreSQL role plus a route-level test harness; (2) a crash-safe reply publication state machine with provider calls outside DB transactions; (3) fleet-safe ingestion/Pub-Sub/scheduler reliability with background workers; (4) product completeness (invitations, language, analytics timezones, inbox UX, privacy execution); (5) live-Google certification and release hardening. A parallel ops track (Google approval, staging Pub/Sub, pilot listing, non-superuser staging DB) starts immediately.

**Tech Stack:** Next.js 16 App Router (webpack builds, standalone output), React 19, TypeScript 5, postgres.js 3.4, PostgreSQL 17 (Supabase CLI locally, plain PG in compose/CI), Zod 4, Vitest 4, Playwright 1.62 + axe-core, OpenAI Responses API, Google Business Profile v4/v1 APIs, Pub/Sub push with OIDC, OpenTelemetry.

## Global Constraints

Copied from the program spec — every sprint-plan task implicitly includes these:

- No production release while any P0 remains.
- Every fix includes route-level integration tests; testing is not deferred to the final sprint.
- Google API approval and pilot-listing setup start immediately as a parallel track.
- Provider calls should not occur inside long database transactions.
- "Implemented" is not accepted as done until behavior is integration-verified.
- Existing uncommitted work remains untouched; this is a planning artifact only.
- Sprint operating rules: acceptance tests written with the fix; security-sensitive routes include authentication, role, IDOR, and cross-tenant cases; provider contract changes include captured/official fixtures; observability is part of implementation; no ticket done on source inspection alone; live-Google uncertainty stays `BLOCKED`.
- Repo conventions: pnpm 10, `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm test:integration` (RUN_DB_TESTS=true) / `pnpm build` / `pnpm test:a11y` must be green at every sprint exit; builds use `--webpack` (Turbopack is intentionally avoided); commits are not made unless the user explicitly asks.

---

## 1. Where the codebase actually is (audit ground truth)

The five-sprint spec was written against audit findings. This section pins each sprint to verified code reality so no ticket is re-litigated later. File references are the anchor; line numbers are as of branch `design-system-replacement` (HEAD f674de0, 2026-07-29).

### 1.1 The three P0s (confirmed)

1. **Tenant provisioning breaks under a non-superuser role.** `provisionOwner` (`app/api/google/connect/callback/route.ts:44-107`) runs `insert into app_user … on conflict (email) do update … returning` (L55-70) and `insert into organisation … returning id` (L73-80) with **no tenant context**, then calls `set_config('app.organisation_id', …)` only at L82-84. Under RLS with a non-BYPASSRLS role, `INSERT … RETURNING` on `organisation` fails: the `organisation_provision` policy (`supabase/migrations/0001_initial.sql:540-543`) permits the write but no policy makes the returned row SELECT-visible. Proven with psql as `naba_test_runtime`.
2. **No production sign-in entry point.** `app/page.tsx` redirects to `/reviews`; all five dashboard routes render for anonymous users as a broken shell; the only "Connect Google" buttons sit inside `connections-view.tsx` behind `loadState === "ready"`, which requires `requireApiSession()` — a session-less user dead-ends at an error card. `POST /api/google/connect/start` itself works signed-out (`app/api/google/connect/start/route.ts:17` treats session as optional).
3. **Google moderation state is never really recorded.** Ingestion reads `reviewReply.state` / `reviewReply.policyViolation` (`lib/server/reviews.ts:252-259`), but the v4 review payload carries moderation as `reviewReplyState` (the string `reviewReplyState` appears nowhere in the repo). Publication writes `String(provider?.state ?? "PENDING")` (`app/api/reviews/[id]/publish/route.ts:425-434`). Net effect: `google_reply_state` is `null` from ingestion and `'PENDING'` forever from publish; the health metric `replyRejections30d` and the UI "Google rejected the reply" banner are dead paths.

### 1.2 Why local gates are green anyway

Every local/compose environment connects as the `postgres` superuser (`.env.example:3-4`, `compose.yaml:27-28,43`), which bypasses `FORCE ROW LEVEL SECURITY` entirely, and compose sets `LOCAL_BOOTSTRAP_ENABLED: "true"` (`compose.yaml:53`) so `/api/session` auto-provisions an owner (`lib/server/session.ts:207-251`). CI (`.github/workflows/ci.yml`) is the only place a runtime role is configured — and **CI has never executed because the repo has no git remote**.

### 1.3 Verified subsystem gaps the sprints must close

| Area | Verified state (file anchors) |
|---|---|
| Runtime DB role | No `CREATE ROLE`/`GRANT` in any migration; role `naba_test_runtime` is created ad hoc inside `tests/integration/*.test.ts` `beforeAll` only |
| Startup assertions | None. `instrumentation.ts` only registers OTel; nothing checks `rolsuper`/`rolbypassrls`/`row_security` |
| `app_user` | No RLS at all (`0001_initial.sql:25-33`); `app/api/members/route.ts:88-94` upserts by email and can rewrite another tenant's user's `display_name`; `on conflict (email) do update set google_subject` in the OAuth callback is an account-takeover surface; `email_verified` is never fetched for humans (`lib/server/google.ts:220-229`) |
| Routing tables | `webhook_route` (PK `google_location_name`) and `organisation_job_route` are deliberately outside RLS (`0001_initial.sql:161-166, 41-43, 509-530`); any tenant's transaction can overwrite another tenant's `webhook_route` row |
| Webhook auth | `verifyPubSubRequest` (`lib/server/pubsub.ts:21-68`) fails closed per-request when unconfigured, but nothing prevents production boot with weak/absent config; `WEBHOOKS_ENABLED` defaults `true`; the `featureFlag` Zod shape makes **empty-string env values parse as `true`** (verified), including `LOCAL_BOOTSTRAP_ENABLED=` |
| Publish | Google PUT runs **inside** the tenant transaction (`publish/route.ts:309-329` inside `withTenant` from L50); a failed COMMIT after Google success leaves an untracked live reply; 5xx **responses** to mutations are blindly retried up to 5×, only transport faults become `GoogleMutationAmbiguousError` (`google.ts:345-390`) |
| Delete | `reply/route.ts` DELETE: Google call inside tx, no attempt ledger, no idempotency, no ambiguity read-back; sets `workflow_status='new'` unconditionally (L77) which the transition trigger rejects from several states; unreachable from the UI (no client wrapper, no button) |
| Republish | Idempotency key `sha256(org:review:bodyHash)` with `unique (organisation_id, idempotency_key)` — deleting a reply then republishing identical text hits the old attempt row and is blocked |
| Evidence | `draft.evidence_hash` written, never re-checked at publish; `review.content_hash` written, never read; staleness guard is the **optional** client field `expectedReviewUpdateTime` (`publish/route.ts:32,114-123`) |
| Audit | `requestId()` trusts client `x-request-id` (`lib/server/http.ts:43-47`); `audit_log` unique `(org, request_id, action, subject_type, subject_id)` + `on conflict do nothing` (`lib/server/audit.ts:36-37`) ⇒ a client can suppress audit rows by pinning the header |
| Approval | No approve/reject routes; `awaiting_approval` is a holding state exited by re-POSTing publish; no approver≠requester rule; no two-person option; `published_by` never written on the approval path |
| Sync transactions | Backfill/reconcile/webhook all hold one `withTenant` transaction across **all** Google I/O including pacing sleeps and 5× retries (`app/api/sync/backfill/route.ts:108`, `sync/reconcile/route.ts:57`, `webhooks/google/pubsub/route.ts:80`) |
| Reconcile isolation | No try/catch per org or per location (`sync/reconcile/route.ts:56-100`); a revoked token (throw from `reviews.ts:465`) aborts the org transaction, the loop, the response, and the scheduler's whole cursor walk |
| Backfill checkpoints | `sync_checkpoint.page_token` is **shared across up to 50 locations per batch** (`reviews.ts:375-377,400-404`); resume is a manual UI button; nothing consumes `next_attempt_at` (`sync_retry_idx` unused); backfill requires a browser session — headless continuation impossible |
| Update depth / deletes | Reconcile reads newest 2 pages only; `last_review_update_time` stores `now()` not a watermark; **no deleted-review detection of any kind** |
| Webhook payloads | Malformed JSON → 500, zod-invalid → 400, unresolvable location → 400 — all nacked forever (poison loop); sync failure → **200 ack, message dropped**, manual replay-by-UUID is the only recovery and no endpoint lists failed events |
| Workers/locks/timeouts | No queue, no worker, no leader election (in-process boolean only, `scripts/scheduler.mjs:103-127`); **zero `AbortSignal` in the repo**; unbounded `retry-after` honoured; no statement or idle-in-transaction timeout |
| Invitations/org switching | No invitation table/token/acceptance; `POST /api/members` silently creates `app_user` rows; added members later sign in and get a **brand-new org** (default_organisation_id never set); no org switcher; no sign-out UI |
| Language | `detectLanguage` (`lib/server/reviews.ts:56-66`) knows 3 scripts; de/es/fr/it → `en @ 0.72` which clears the 0.7 gate, so the org default-language fallback is unreachable for Latin scripts; `languageOverride` accepted by the API but has no UI; language not passed to the semantic verifier |
| Verifier injection | `semanticVerification` prompt (`lib/server/ai.ts:161-169`) interpolates `reviewerName`, `reviewText`, and draft `body` raw — no delimiters, no untrusted-data instruction (the generation prompt has both) |
| Promo false positives | `/\b(free|discount|promo code|voucher|coupon)\b/iu` (`lib/domain/verification.ts:40-46`) fails `gluten-free`, `feel free`, `smoke-free` at severity `fail` |
| Analytics | `date_trunc` with no timezone (`analytics/overview/route.ts:29-34`) despite `organisation.default_timezone` and `location.timezone` existing; browser-local chart labels; no zero-fill; response metric uses last-write-wins `google_reply_updated_at` (no first-response column); deleted replies still counted; provider totals (`averageRating`/`totalReviewCount`) typed but never consumed |
| Search | Query tsvector includes `l.name` but the GIN index's third term is `google_review_id_hash` (`reviews/route.ts:196-209` vs `0001_initial.sql:389-396`) — the index can never serve the query; rating-sort cursor missing `rating` silently re-serves page 1 |
| Inbox UI | Queue counts computed client-side over the current 50-row page; location filter derived from loaded reviews; no polling/stale/disconnected states; no delete control |
| Privacy | Decrypted `googleReviewName`/`googleReviewId` serialized on every inbox/detail response (`reviews/route.ts:266-278`, `reviews/[id]/route.ts:118-134`); `/api/google/locations` spreads the raw Google payload; `privacy_request` is a tracker with **no erasure/rectification/restriction execution**; `audit_log` is append-only with no retention and PII in metadata; privacy export matches subjects by case-insensitive display name |
| Ratings/CSV | `STAR_RATING_UNSPECIFIED` → 1 star (schema forbids null); CSV export has RFC-4180 quoting but no formula-injection guard; Google location discovery has no pagination-cycle guard (accounts does) |
| Tests/CI | Zero route-handler tests; perf test duplicates the inbox SQL inline; migration-contract applies only 0001 and string-matches the rest; `routing.spec.ts` not wired into any script; CI role creation is an implicit test side effect; `test:integration` afterAll deletes the tenants the later a11y server needs; gitleaks has no license secret; **no git remote** |
| Docs | README claims a preview-dataset fallback the UI explicitly refuses, overstates `pnpm test` migration coverage; requirements-matrix cites never-run CI evidence |

---

## 2. Plan of plans

Execute in this order. Each sprint plan is self-contained, TDD-structured, and ends with the sprint's release gate re-verified.

| # | Plan document | Sprint dates | Points |
|---|---|---|---|
| 0 | §3 below (parallel ops track — start immediately) | now → Sprint 5 | — |
| 1 | `docs/archive/2026-07-frontend-rebuild/plans/2026-07-29-sprint-1-tenant-safety-auth-tests.md` | 3–14 Aug | 55 |
| 2 | `docs/archive/2026-07-frontend-rebuild/plans/2026-07-29-sprint-2-reply-lifecycle.md` | 17–28 Aug | 57 |
| 3 | `docs/archive/2026-07-frontend-rebuild/plans/2026-07-29-sprint-3-ingestion-reliability.md` | 31 Aug–11 Sep | 73 |
| 4 | `docs/archive/2026-07-frontend-rebuild/plans/2026-07-29-sprint-4-product-completeness.md` | 14–25 Sep | 76 |
| 5 | `docs/archive/2026-07-frontend-rebuild/plans/2026-07-29-sprint-5-live-certification-release.md` | 28 Sep–9 Oct | 61 |

Dependency shape (unchanged from the spec): Sprint 1 unblocks 2 and 3; 2 and 3 unblock 4; 2, 3, 4 and the parallel track converge on 5.

**Cross-sprint interlocks discovered during grounding** (respect these when re-planning mid-program):

- Sprint 1's `TEN-101` (app_user RLS + SECURITY DEFINER provisioning) changes the exact code `AUTH-101` touches — the Sprint 1 plan sequences AUTH-101 before TEN-101 and TEN-101 re-runs AUTH-101's tests.
- Sprint 2's publish redesign (`REP-201`) extracts `executePublish()` into `lib/server/publishing.ts`; Sprint 3's `JOB-301` retry worker and Sprint 4's approval UI both call that same function — do not inline it back.
- Sprint 3's `API-301` (timeouts) generalises the mutation-timeout Sprint 2 introduces for publish; keep the option name `timeoutMs` on `googleRequest`.
- Sprint 4's `UI-401` delete control depends on Sprint 2's `REP-205` making DELETE safe; ship the API first.
- The Pub/Sub payload schema (`WEB-301`) ships in Sprint 3 against the best documented shape, then Sprint 5 `GGL-501/503` captures a real notification and freezes it as the contract fixture — expect a small Sprint 5 follow-up diff if casing differs.

## 2.1 Shared design decisions (the contract between sprint plans)

These names and shapes are used consistently across all five sprint plans. Change them only by editing all plans together.

**Database roles**

- `naba_app_runtime` — NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE group role created in migration `0004_runtime_role.sql`, holding all schema grants. Every future migration that creates a table/sequence must grant to it (rule enforced by `tests/migration-contract.test.ts` addition).
- Per-environment LOGIN members of that group: `naba_app` (staging/production, password managed by ops), `naba_test_runtime` (CI + local integration tests; creation moves from test `beforeAll` side effect into `scripts/db-create-runtime-role.mjs`).
- `DATABASE_URL` always points at a LOGIN member of `naba_app_runtime`; `DIRECT_DATABASE_URL` stays the admin/migration identity.

**New GUCs** (additions to the existing `app.organisation_id`, `app.session_token_hash`, `app.provider_reconciliation`):

- `app.user_id` — set by the session layer where self-access to `app_user` is needed.
- `app.retention_run` — set only by the retention job to permit bounded `audit_log` deletion (Sprint 4 PRIV-401).

**SECURITY DEFINER functions** (owned by the migration role, `set search_path = public`):

- `provision_google_user(p_email text, p_display_name text, p_google_subject text) returns table (id uuid, default_organisation_id uuid)` — the only INSERT/linking path into `app_user` once RLS lands (Sprint 1 TEN-101; hardened for verified-email rules in Sprint 4 HARD-401).
- `attach_member_user(p_email text, p_display_name text) returns uuid` — used by `POST /api/members`; inserts if absent, never updates an existing row's `display_name`.
- `register_organisation_job_route()` — existing trigger function, converted to SECURITY DEFINER.

**Startup safety** — `lib/server/startup.ts` exporting `assertProductionSafety()`, called from `instrumentation.ts` `register()` under `process.env.NEXT_RUNTIME === "nodejs"`. Asserts (production): DB identity has `rolsuper = false` and `rolbypassrls = false`; `row_security = on`; `WEBHOOKS_ENABLED ⇒ GOOGLE_PUBSUB_AUDIENCE` set; `LOCAL_BOOTSTRAP_ENABLED` false unless localhost. Throwing here aborts server boot.

**Reply lifecycle** (Sprint 2): `publish_attempt` gains `operation text not null default 'publish' check (operation in ('publish','delete'))`; `review_reply` gains `publish_generation integer not null default 0` (incremented on delete; part of the idempotency key `sha256(org:review:generation:bodyHash)`) and `approval_requested_by uuid`, `first_published_at timestamptz` (ANA-402 backfills). New table `approval_decision`. Publish/delete become three-phase: **tx1 record intent → provider call outside any transaction → tx2 reconcile outcome**; recovery = read-before-retry via `getGoogleReview` for stale `started`/`ambiguous` attempts.

**Moderation fields**: ingestion and publish parse `review.reviewReplyState` (primary) with `reviewReply.state` fallback, same dual-path for `policyViolation`; fixture-driven, frozen by the Sprint 5 live capture.

**Sync** (Sprint 3): per-location checkpoints (no shared page tokens; backfill switches to per-location `googleReviews` pagination); `sync_checkpoint` gains `high_water_update_time timestamptz`; review deletions detected by periodic full sweep writing `review.provider_deleted_at timestamptz`; webhook events gain `status = 'discarded'`/`'dead'`; workers run via `POST /api/jobs/run` (CRON_SECRET) driven by the scheduler, claiming work with `for update skip locked`; mutual exclusion via `pg_try_advisory_xact_lock`; every outbound `fetch` gains `AbortSignal.timeout(…)`.

**Membership** (Sprint 4): new `invitation` table (token-hash based, 7-day expiry); OAuth `state` gains `inviteToken`; `POST /api/session/switch` re-pins a session to another org the user is a member of; `app-shell` gains org switcher + sign-out.

---

## 3. Parallel ops track — start before Sprint 1

Owner: DevOps/security support + product owner. These items live outside the repo but several have repo hooks; the repo hook is listed with each. **The Google approval item is the schedule's primary external risk — assign a named owner on day 1 and review weekly.**

### Task P1: Repository remote + CI activation

The CI workflow has never executed (no git remote). Nothing in Sprints 1–5 can claim CI evidence until this lands.

- [ ] **Step 1:** Create the GitHub repository, add it as `origin`, push `main` and `design-system-replacement`.
- [ ] **Step 2:** Add repository secret `GITLEAKS_LICENSE` (required by `gitleaks/gitleaks-action@v2` for org repos) or swap the step to the OSS `gitleaks detect` CLI if no license will be procured — decide once, in this task.
- [ ] **Step 3:** Open a trivial PR (docs change) and verify both `quality` and `secret-scan` jobs run to completion. Known pre-existing hazards the Sprint 1 CI-101 ticket fixes (do not fix here): role-creation-by-test-side-effect, `test:integration` afterAll wiping the tenants the a11y server needs.

### Task P2: Google Cloud + Business Profile approvals

- [ ] **Step 1:** Submit/confirm Google Business Profile API access (Account Management, Business Information, Business Profile v4, Notifications APIs — the set named in `README.md:126-127`) and record approved quota (baseline assumption in code: `GOOGLE_REQUESTS_PER_SECOND=8`, `lib/server/env.ts:57`).
- [ ] **Step 2:** Verify the OAuth consent screen for scope `https://www.googleapis.com/auth/business.manage` (exact scope string in `lib/server/google.ts:20-25`) in production status, with the staging and production redirect URIs `{NEXTAUTH_URL}/api/auth/callback/google`.
- [ ] **Step 3:** Create the dedicated verified pilot listing (a real, verified Business Profile location the team controls); record its `accounts/{id}` and `locations/{id}` names in the ops vault for Sprint 5.
- [ ] **Step 4:** Confirm OpenAI model access for the configured `OPENAI_MODEL_DRAFT`/`OPENAI_MODEL_VERIFY` values and provision a staging `OPENAI_API_KEY`.

### Task P3: Staging Pub/Sub + push subscription

- [ ] **Step 1:** Create staging topic + push subscription pointed at `POST {staging NEXTAUTH_URL}/api/webhooks/google/pubsub`, with an OIDC service account; set the push audience.
- [ ] **Step 2:** Create the dead-letter topic and attach it to the subscription (max delivery attempts 5) — Sprint 3 WEB-302 assumes a DLQ exists at the subscription level in addition to in-app discard handling.
- [ ] **Step 3:** Record `GOOGLE_PUBSUB_AUDIENCE`, `GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL`, and a ≥16-char `GOOGLE_PUBSUB_VERIFICATION_TOKEN` in the staging env. Repo hook: after Sprint 1 WEB-101, staging boot **fails** if `WEBHOOKS_ENABLED=true` without the audience set — provision these before deploying Sprint 1 to staging.

### Task P4: Production-like PostgreSQL with a non-superuser runtime role

- [ ] **Step 1:** Provision the staging PostgreSQL 17 instance. Run migrations with an admin identity via `DIRECT_DATABASE_URL` (`scripts/db-migrate.mjs` uses `DIRECT_DATABASE_URL ?? DATABASE_URL`).
- [ ] **Step 2:** After Sprint 1 SEC-101 merges, create the LOGIN role: `create role naba_app login password '…' in role naba_app_runtime;` and point staging `DATABASE_URL` at it. Until then, stage with the admin URL but treat every green check as non-evidence (that is the exact failure mode this program exists to remove).
- [ ] **Step 3:** Set the full staging env from `.env.example`, including `LOCAL_BOOTSTRAP_ENABLED=false` (set the value explicitly — empty string currently parses as `true` until Sprint 1 fixes the flag parser).

---

## 4. Program-level release definition

A production release requires all of (verbatim from the spec, with repo bindings):

- All Sprint 1–3 P0/P1 safety gates complete; all Sprint 4 release-scope behavior complete.
- Green: `pnpm lint`, `pnpm typecheck`, `pnpm test`, route integration suite (`pnpm test:integration`, which after Sprint 1 includes `tests/integration/routes/**`), DB integration, `pnpm exec playwright test tests/e2e/` (routing + accessibility + the Sprint 5 journey spec), `pnpm build` — all in CI, on a non-superuser `DATABASE_URL`.
- Non-superuser staging deployment with `assertProductionSafety()` passing at boot.
- Successful live-Google lifecycle and failure-recovery tests (Sprint 5 GGL-501/502/503 evidence files committed under `docs/live-certification/evidence/`).
- Seven-day pilot soak with no unresolved duplicate, divergence, tenant-isolation, webhook, or moderation incident.
- Remaining P2 work explicitly accepted by product with owners and dates.
- Sign-off checklist (product, engineering, QA, security, operations, pilot owner) recorded in `docs/live-certification/release-checklist.md` (created in Sprint 5 OPS-501/DOC-501).

## 5. Team allocation (unchanged from spec)

- **Platform engineer:** Sprint 1 SEC/TEN/CI, Sprint 3 OPS/JOB, Sprint 4 PERF/PRIV migrations, observability.
- **Backend/integration engineer:** Sprint 1 AUTH/WEB, Sprint 2 REP/AUD, Sprint 3 SYNC/WEB/API, Sprint 5 GGL.
- **Full-stack engineer:** Sprint 1 AUTH-102 UI, Sprint 2 APR UI touchpoints, Sprint 4 MEM/UI/LANG/ANA, Sprint 5 A11Y.
- **QA:** TST-101 harness co-ownership, per-sprint scenario suites, Sprint 5 E2E/REL evidence.
- **DevOps/security:** §3 parallel track, staging secrets, alerts (OBS-501).
- **Product owner:** APR-201 approval policy, REP-205/206 deletion semantics, PRIV-401 privacy behavior, LANG-401 language support, REL-502 pilot acceptance.

With two engineers instead of three: split Sprint 3 into 3a (SYNC-301/302/303, WEB-301/302, API-301) and 3b (SYNC-304, WEB-303, JOB-301, OPS-301), shifting everything after by roughly two sprints — the spec's stated allowance.
