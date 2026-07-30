# Sprint 5 — Live Google Certification and Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 1–3 and 8–10 involve live external systems and human sign-offs — an agent prepares the scripts/evidence scaffolding and executes what is automatable; every live step that cannot be verified from this machine stays explicitly `BLOCKED`, never assumed complete.

**Goal:** Verify the entire lifecycle against real external systems (Google Business Profile, Pub/Sub, OpenAI), add real-browser E2E coverage, load/failure-test the platform, stand up dashboards/alerts, rehearse operations, correct all documentation, and authorize a controlled pilot release.

**Architecture:** All certification work produces durable evidence under `docs/live-certification/` — per-ticket scripts (exact commands + expected observations), captured payloads frozen into `tests/fixtures/` (making live behavior a permanent regression contract), and a signed release checklist. Code work this sprint: a Playwright journeys spec, load-injection scripts, health-endpoint alerting fields, and doc corrections.

**Tech Stack:** Staging deployment (non-superuser role, per parallel track P4), the pilot Business Profile listing (P2), staging Pub/Sub push + DLQ (P3), Playwright, node load scripts, OTel metrics + the `/api/operations/health` endpoint.

**Sprint dates / points:** 28 September–9 October 2026, 61 points. Tickets: GGL-501 (8), GGL-502 (8), GGL-503 (8), E2E-501 (8), REL-501 (8), OBS-501 (5), A11Y-501 (3), OPS-501 (5), DOC-501 (3), REL-502 (5).

## Global Constraints

- **Preconditions (hard):** parallel-track P1–P4 complete — CI green on `main`, Google API access + verified pilot listing, staging Pub/Sub topic + push subscription + DLQ + OIDC audience, staging PostgreSQL with `naba_app` runtime role, staging env fully set (`assertProductionSafety` passing at boot). If any is missing, the dependent task is `BLOCKED` — record it in the evidence file, do not simulate.
- Evidence convention: every live step appends to `docs/live-certification/evidence/<ticket>.md` — timestamp, actor, command/action, observed output (IDs redacted per `lib/domain/redaction.ts` rules). Fixtures captured from live traffic land in `tests/fixtures/` and are committed (after redaction) so CI regresses against reality.
- Any live-Google uncertainty remains explicitly `BLOCKED`, never assumed complete (program rule).
- Do not commit unless the user explicitly asks.

**Execution order:** Task 4 (E2E-501) and Task 6 (OBS-501) first (they run on CI/compose and unblock evidence capture), then Tasks 1–3 (GGL) on staging, Task 5 (REL-501), Tasks 7–9 (A11Y, OPS, DOC), Task 10 (REL-502 soak last — it needs everything).

---

### Task 1: GGL-501 — Live connect → discover → link → backfill → notification → reconcile

**Files:**
- Create: `docs/live-certification/ggl-501-ingestion-lifecycle.md` (the script below, expanded)
- Create: `docs/live-certification/evidence/ggl-501.md`
- Modify: `tests/fixtures/pubsub/new-review.json` (replace with the redacted live capture)

**Interfaces:**
- Consumes: staging deployment + pilot listing.
- Produces: the frozen real Pub/Sub notification fixture (spec acceptance: "a captured real Pub/Sub notification is preserved as a contract fixture") — after replacement, `pnpm test tests/pubsub-payload.test.ts` must pass unchanged, or the payload module is fixed forward in the same PR.

- [ ] **Step 1: Script the run.** `ggl-501-ingestion-lifecycle.md` steps: (1) fresh staging DB snapshot; (2) open staging `/sign-in`, Continue with Google as the pilot account — verify a new organisation is provisioned (SQL check as `naba_app`: `select count(*) from organisation` = 1) — this is the Sprint 1 P0 fix observed live; (3) discover accounts/locations from `/connections`, link the pilot location; (4) run backfill from the UI; verify checkpoint `succeeded`, review counts match the listing's real review count (provider-totals divergence = false); (5) `PATCH /api/google/notifications` with the staging topic; verify with `GET` that Google stored it (update-mask check belongs to GGL-503 but capture the request/response here); (6) post a fresh review on the pilot listing from a second Google account; (7) observe the Pub/Sub push arrive (webhook event row `processed`, review visible in inbox within one minute); capture the **raw push body + headers** from staging logs; (8) delete nothing yet (GGL-502 owns mutations); (9) trigger reconcile via the scheduler and verify checkpoint watermark advanced.
- [ ] **Step 2: Execute on staging** (human + agent-assisted). Record each observation in the evidence file. Any deviation (payload shape, casing, missing fields) becomes an immediate fix-forward PR on the affected module (`lib/domain/pubsub-payload.ts` is the only sanctioned change point for shape issues).
- [ ] **Step 3: Freeze the fixture.** Redact project/account IDs in the captured push; replace `tests/fixtures/pubsub/new-review.json`; run `pnpm test` — green, or fix the parser forward. Commit note in evidence file linking capture → fixture hash.

### Task 2: GGL-502 — Live publish → moderation → update → delete → republish

**Files:**
- Create: `docs/live-certification/ggl-502-reply-lifecycle.md`, `docs/live-certification/evidence/ggl-502.md`
- Modify: `tests/fixtures/google/review-reply-states.json` (live-verified shapes)

- [ ] **Step 1: Script.** (1) On the fixture review from GGL-501, generate an AI draft (staging OpenAI key — confirms P2 Step 4), verify, publish; record the live PUT response body verbatim (this settles whether moderation arrives as `reviewReplyState`, `reviewReply.state`, or only via subsequent reads — the audit's P0#3); (2) observe moderation state on the review via `GET /api/reviews/{id}` after the next reconcile — record where the state appears in the live `reviews` list payload; (3) update: edit the draft and republish (same route) — verify Google shows the edited text and `first_published_at` did not move; (4) delete from the UI (Sprint 4 control) — verify the reply is gone on Google Maps and locally `publish_status='deleted'`; (5) republish identical text — verify success (REP-206 live); (6) if the listing can produce a policy-violating reply safely (e.g. a phone number, which Google moderates), attempt once to observe a live `REJECTED` state; if not reproducible, mark the REJECTED live observation `BLOCKED — not reproducible on demand` with the fixture-based coverage cited.
- [ ] **Step 2: Execute + evidence.** Update `review-reply-states.json` fields/casing to match live observations (only if they differ); `pnpm test` regression as in Task 1.
- [ ] **Step 3: Ambiguity drill (live).** Publish with staging configured `GOOGLE_MUTATION_TIMEOUT_MS=1` (forced timeout) → verify attempt `ambiguous`, then let the jobs worker settle it via read-back (evidence: `publish_attempt_event` sequence `started → ambiguity_checked → completed`). Restore the timeout after.

### Task 3: GGL-503 — Notification mask, payload casing, media, Voice of Merchant, refresh rotation, quota

**Files:**
- Create: `docs/live-certification/ggl-503-contract-checks.md`, `docs/live-certification/evidence/ggl-503.md`

- [ ] **Step 1: Notification update mask.** Capture the live `PATCH …/notificationSetting?updateMask=pubsubTopic,notificationTypes` request/response (from GGL-501 Step 5); verify a follow-up `GET` returns both fields as set; verify clearing (empty topic) removes notifications (contract at `lib/domain/google-contract.ts:43-58`).
- [ ] **Step 2: Payload casing sweep.** Diff every live payload captured so far (accounts, locations, reviews page, review, reply PUT response, Pub/Sub push) against the parsers' expectations (`lib/server/reviews.ts` field reads, `lib/domain/pubsub-payload.ts`, `googleReviews` type). Record a table: field → expected → observed → status. Any mismatch → fix-forward PR + fixture update.
- [ ] **Step 3: Media.** Post a photo review on the pilot listing; verify `review_media_item` rows and inbox rendering; record the media payload shape.
- [ ] **Step 4: Voice of Merchant.** Verify the pilot listing's VoM state is green; then document (from a secondary unverified test listing, if available) what the API returns for a non-VoM location and confirm the app surfaces `verified=false` and refuses linking (`reviews.ts:316-323` behavior live). If no unverified listing is available, mark `BLOCKED — needs second listing`.
- [ ] **Step 5: Refresh rotation + invalid_grant.** (a) Let the staging access token expire (wait > 1 h) and verify a reconcile silently refreshes (`last_refresh_at` advances, no user action). (b) Revoke the app's access from the pilot Google account's security settings; trigger reconcile → verify: connection `status='revoked'`, `connection_task` `reconnect` opened, reconcile response lists the failure while other work continues (Sprint 3 isolation, observed live), UI shows the reconnect prompt; reconnect via OAuth and verify recovery (task auto-completed — `connect/callback/route.ts:227-233`). This is the spec acceptance "OAuth refresh and invalid_grant recovery are observed against Google".
- [ ] **Step 6: Quota behavior.** Run a backfill with `GOOGLE_REQUESTS_PER_SECOND` raised to the approved quota ceiling; watch for live 429s; verify pacing + `retry-after` handling keeps the run completing and no attempt lands in `failed` due to quota. Record observed effective QPS. Reset config after.

### Task 4: E2E-501 — Real HTTP → route → DB E2E coverage for critical workflows

**Files:**
- Create: `tests/e2e/journeys.spec.ts`
- Modify: `playwright.config.ts` (webServer env gains the Google stub seam)
- Create: `tests/e2e/helpers/stub-bridge.ts` (start the Sprint 2 Google stub from Playwright's global setup)
- Modify: `.github/workflows/ci.yml` (no change needed — `pnpm test:e2e` already runs the whole `tests/e2e` dir; verify)

**Interfaces:**
- Consumes: Sprint 2 `startGoogleStub` (imported from the integration helpers — keep it dependency-free of vitest), Sprint 1 CI e2e mode (`LOCAL_BOOTSTRAP_ENABLED=true`).
- Produces: a browser-driven journey suite hitting the real server + real DB (no `route.fulfill` mocks): (1) bootstrap session → inbox renders seeded reviews (seed via `DIRECT_DATABASE_URL` in Playwright global setup using the same `tenant.ts` helpers — export them vitest-free); (2) filter by queue + location → server round-trip verified via counts; (3) open review → write human draft → verify → publish (stub PUT) → status chip becomes Published; (4) approval path: seed a member session cookie… browser uses the bootstrap owner — instead toggle `require_two_person_approval` on via settings UI, publish → lands in Approvals, second approver check asserted at API level in the harness (already covered; the browser flow asserts the 202 UI); (5) delete reply via the UI dialog → status returns to New; (6) connections page shows the seeded connection; unlink flow; (7) analytics renders with the seeded org timezone; (8) settings save round-trips. Axe is not re-run here (accessibility.spec owns it); this spec owns behavior.

- [x] **Step 1:** Write the spec + stub bridge (Playwright `globalSetup` starts the stub, writes its URL to an env file consumed by `webServer.env.GOOGLE_API_PROXY_BASE`; `webServer` also gets `WEBHOOKS_ENABLED:"false"`). Run locally: `pnpm build && pnpm test:e2e` — journeys green.
- [ ] **Step 2:** Confirm CI runs it (step already `pnpm test:e2e`) and stays under the 20-minute job budget; if over, split a `quality-e2e` job in `ci.yml`. **BLOCKED — no git remote (P1); workflow command verified and the full local E2E suite completed in 18.9 seconds, but no CI run exists to confirm.**

**Deviation:** Playwright 1.62 starts `webServer` before `globalSetup`, so a URL written by global setup cannot be consumed by `webServer.env`. The config instead assigns an isolated deterministic stub URL to `GOOGLE_API_PROXY_BASE`; global setup starts the binding `startGoogleStub()` interface on that same isolated port and writes only journey state for the worker. The application makes no Google request during boot. The journey also reproduced a debounced inbox refresh resetting a user's selected review; `ReviewsView` now preserves the selection when it remains in the refreshed result.

### Task 5: REL-501 — Load and failure testing

**Files:**
- Create: `scripts/load/webhook-storm.mjs`, `scripts/load/backfill-scale.mjs`, `scripts/load/inbox-concurrency.mjs`
- Create: `docs/live-certification/rel-501-load-report.md`

**Interfaces:**
- Produces: three node scripts, each `node scripts/load/<name>.mjs --base-url … --duration 300` printing a JSON summary `{ sent, ok, failed, p50Ms, p95Ms, p99Ms }`. Targets run against the **compose stack** (prod topology, stub Google via `GOOGLE_API_PROXY_BASE` on the web service) — not against real Google.

- [x] **Step 1: Scripts.** `webhook-storm`: POST the live-captured fixture (varying `messageId`/review name) at a configurable rate (default 50/s for 5 min) with the token header; success = every message 2xx, event rows `processed|failed` (none lost), inbox queries stay < 2 s during the storm. `backfill-scale`: seed 100 locations × 500 stub reviews; run backfill continuation via the jobs runner until drained; success = zero duplicate reviews (`select google_review_name_hash, count(*) … having count(*) > 1` empty), checkpoints all `succeeded`, wall-clock recorded. `inbox-concurrency`: 50 concurrent sessions paging + searching a 100k-row tenant; success = p95 < 1.5 s, zero 5xx, pool metrics healthy (`nabapresence.tenant_transaction.duration` p95 < 500 ms).
- [x] **Step 2: Failure injection during load.** While `webhook-storm` runs: kill the web container for 30 s (compose restart) → storm records failures, Pub/Sub-side retries are simulated by the script re-sending nacked messages; after recovery, verify no event lost and the jobs worker drains `failed` rows. Inject ambiguous publishes (stub 500s on PUT for 60 s) during a scripted publish loop → all attempts end `succeeded` or `failed` with zero divergence (`select … from review_reply rr join publish_attempt …` consistency query in the report). DB-pool exhaustion probe: temporarily set pool `max=3` via env… pool size is hardcoded (`db.ts:31`) — make it env-tunable first (`DATABASE_POOL_MAX`, default 10, added to `env.ts`) as part of this task.
- [x] **Step 3: Run all three + injections on compose; write `rel-501-load-report.md`** with the JSON summaries, the scheduler-scale observation (100-org reconcile within budget — Sprint 3 Task 10's budget test at scale), and pass/fail against the criteria above. Failures become fix-forward issues before REL-502.

**Deviation (Task 5):** The application intentionally paces each Google connection at 25 requests/s, so the 50 requests/s platform storm uses four independently routed seeded connections while preserving the notification fixture shape. The first failure drill exposed an unbounded post-outage retry herd and an unhandled transport close; the load harness now bounds in-flight deliveries and retries all transport failures. The first 100k runtime-role run also proved that PostgreSQL RLS prevented the expression GIN index from serving production search, despite the earlier admin-role plan test passing. Migrations 0010–0011 add a stored search document plus a tenant-context-guarded SECURITY DEFINER candidate search; the production-role plan and cross-tenant rejection are now regression-tested. Compose gained a local OTLP metric reader/collector because the existing `@vercel/otel` registration exported traces but did not install a metrics reader.

### Task 6: OBS-501 — Production dashboards and alerts

**Files:**
- Modify: `app/api/operations/health/route.ts` (alerting fields)
- Create: `docs/observability.md`
- Create: `docs/live-certification/evidence/obs-501.md`

**Interfaces:**
- Produces: health payload gains `{ failedWebhookEvents, deadWebhookEvents, oldestFailedEventAgeSeconds, ambiguousPublishAttempts, staleStartedAttempts, dueJobBacklog, checkpointFailures24h, connectionErrors24h, schedulerHeartbeatAt }` — `schedulerHeartbeatAt` written by the jobs runner to a new single-row table `ops_heartbeat (name text primary key, beat_at timestamptz)` (migration `0009_ops_heartbeat.sql`, granted). `docs/observability.md` catalogs every OTel metric name in the codebase + the alert rules:

| Alert | Condition | Severity |
|---|---|---|
| Connection errors | `connectionErrors24h > 0` for any org 15 min | page |
| Checkpoint failures | `checkpointFailures24h > 3` per location | ticket |
| Ambiguous publishes | `ambiguousPublishAttempts > 0` for 15 min | page |
| Webhook backlog | `failedWebhookEvents > 25` or `oldestFailedEventAgeSeconds > 900` | page |
| Dead letters | `deadWebhookEvents > 0` | ticket |
| Scheduler silent | `now() - schedulerHeartbeatAt > 5 min` | page |

- [x] **Step 1:** Implement the health fields + heartbeat (+ migration) with a harness test (`tests/integration/routes/health-alerting.test.ts`: seed one failed event + one ambiguous attempt → fields reflect them).
- [ ] **Step 2:** Wire staging monitoring (the OTLP collector from `OTEL_EXPORTER_OTLP_ENDPOINT` + a scraper hitting `/api/operations/health` with an owner service session or a new `CRON_SECRET`-authed `GET /api/operations/health?scope=platform` variant — implement the cron-auth variant so no browser session is needed for monitors). **BLOCKED — local cron-authenticated platform endpoint and scraper documentation are complete; wiring requires `STAGING_BASE_URL`, deployed staging credentials/collector, and P1/P4 infrastructure.**
- [ ] **Step 3: Alert-firing drill on staging** (spec acceptance "alerts fire in staging for intentionally injected failures"): stop the scheduler → scheduler-silent alert fires; poison one webhook (bad location, forced sync failure via revoked token) → backlog alert; force one ambiguous publish (Task 2 Step 3's drill) → ambiguous alert. Evidence: screenshots/alert payloads in `evidence/obs-501.md`. **BLOCKED — requires staging P1/P4 plus pilot Google P2 and Pub/Sub P3.**

### Task 7: A11Y-501 — Manual keyboard and screen-reader pass

**Files:**
- Create: `docs/live-certification/a11y-501-manual-pass.md` (checklist + results)

- [ ] **Step 1:** Build the checklist: for each surface (sign-in, invite accept, inbox + filters, review detail + reply editor + confirm dialogs, approvals, connections + link/unlink, settings + members/invitations, analytics, org switcher, sign-out): keyboard-only traversal (no traps, visible focus, logical order, `Escape` closes dialogs, combobox/menu arrow-key behavior), screen-reader pass (VoiceOver + one of NVDA/JAWS: landmark structure, live-region announcements for async loads/counts/stale banner, form labels/errors, dialog focus management), zoom 200 % reflow, `prefers-reduced-motion` respected.
- [ ] **Step 2:** Execute manually on the staging build (desktop + mobile viewport), record per-item pass/fail + issues; fix-forward blockers (axe-clean is already enforced; this pass catches what axe cannot).
- [ ] **Step 3:** Record sign-off (name, date, tool versions) — spec acceptance "manual accessibility sign-off is recorded".

### Task 8: OPS-501 — Operational rehearsals

**Files:**
- Create: `docs/live-certification/ops-501-rehearsals.md`
- Modify: `docs/runbook.md` (fold in what the rehearsals teach)

- [ ] **Step 1: Migration + rollback rehearsal.** On a staging clone restored from a 0003-era snapshot with data: run `pnpm db:migrate` (0004→0009) timing each; then rehearse rollback = restore snapshot + redeploy previous image (document that migrations are roll-forward-only; the rollback unit is snapshot+image). Record durations and the go/no-go decision point.
- [ ] **Step 2: Disconnect cleanup rehearsal.** Live-disconnect the pilot connection → verify notification routing removed immediately (Sprint 3 WEB-303), tokens nulled, `purge_due_at` set; fast-forward the purge (temporarily set `purge_due_at = now()` via admin) → run retention → verify `external_location` purged and webhook routes cascaded; then reconnect cleanly. Spec acceptance "disconnect removes notification routing and purges data within policy".
- [ ] **Step 3: Retention, legal hold, privacy rehearsal.** Place a legal hold, attempt an erasure fulfilment → blocked; release hold → fulfil → verify anonymization; run audit retention against a seeded 400-day-old row; export audit CSV and verify the formula-injection guard on a `=SUM`-named reviewer.
- [ ] **Step 4:** Update `docs/runbook.md` incident playbooks with: jobs-runner operations (`/api/jobs/run`, failures listing route), dead-letter draining, ambiguous-publish resolution (now automatic — describe the worker + manual `recoverAttempt` escape hatch), scheduler heartbeat, alert routing.

### Task 9: DOC-501 — Correct README, requirements matrix, architecture, deployment, incident, and support docs

**Files:**
- Modify: `README.md`, `docs/architecture.md`, `docs/requirements-matrix.md`, `docs/runbook.md`

- [ ] **Step 1: Fix the audited false/stale claims** (each verified in the exploration): README L26-27 preview-dataset fallback (the UI explicitly refuses substitution — delete the claim); README L116-118 "`pnpm test` applies the full migration" (it applies only 0001 to PGlite — state exactly that, and that CI applies all migrations to PG 17); requirements-matrix L44-47 (a11y scenario count now includes sign-in/invite/state variants — recount; CI evidence lines must cite real run URLs now that CI executes).
- [ ] **Step 2: Document the new architecture** in `docs/architecture.md`: runtime-role model + startup assertions (Sprint 1), three-phase mutation engine + recovery (Sprint 2), checkpoint/watermark/tombstone sync + workers + advisory locks (Sprint 3), invitations/org switching + privacy fulfilment + audit retention (Sprint 4). One section each, referencing the module paths.
- [ ] **Step 3: README setup updates:** `pnpm db:runtime-role` step, the runtime `DATABASE_URL` guidance, sign-in flow note (production has `/sign-in`; local uses bootstrap), invitation flow, scheduler's third tick (jobs).
- [ ] **Step 4:** Requirements-matrix rows for every Sprint 1–4 acceptance criterion → evidence file/test path (this program's evidence maps make that mechanical).

### Task 10: REL-502 — Staging soak and limited pilot rollout

**Files:**
- Create: `docs/live-certification/release-checklist.md`
- Create: `docs/live-certification/evidence/rel-502-soak-log.md`

- [ ] **Step 1: Soak entry criteria** (all must hold before day 1): Tasks 1–9 complete or explicitly waived by product; CI green on `main`; staging alerts quiet for 48 h; load report accepted.
- [ ] **Step 2: Seven-day soak** on staging with the pilot listing live (webhooks on, scheduler on, daily synthetic activity: one new review, one publish, one edit, one delete across the week). Daily log entry: health snapshot diff, divergence check (`providerTotals.divergence`, reply-consistency query from REL-501), alert log, zero-tolerance incidents (duplicate mutation, divergence, tenant-isolation anomaly, webhook loss, moderation mishandling) — any occurrence stops the clock, root-cause, fix, restart soak per the release definition.
- [ ] **Step 3: Release checklist** — the sign-off table (product, engineering, QA, security, operations, pilot owner) over: all sprint release gates, the program-level release definition items (master plan §4), rollback plan (feature flags `PUBLISH_ENABLED`/`SYNC_ENABLED`/`WEBHOOKS_ENABLED` rehearsed order from `docs/runbook.md`, image+snapshot rollback from OPS-501), and the canary plan: first production tenant = the pilot org only, one week, then staged tenant onboarding.
- [ ] **Step 4: Production decision** recorded ~9 October 2026. `BLOCKED` items, if any, are listed with owners and dates and explicitly accepted by product — otherwise no release.

---

## Sprint 5 acceptance criteria → evidence map

| Criterion | Evidence |
|---|---|
| Captured real Pub/Sub notification preserved as contract fixture | Task 1 Step 3 (fixture replaced + CI green) |
| OAuth refresh and invalid_grant recovery observed against Google | Task 3 Step 5 |
| Moderation states round-trip correctly | Task 2 Steps 1–2 (+ fixtures updated) |
| Publish ambiguity recovery demonstrated with injected failures | Task 2 Step 3 (live) + Task 5 Step 2 (load-scale) |
| Disconnect removes routing and purges within policy | Task 8 Step 2 |
| Target volume completes inside scheduler/DB budgets | Task 5 report |
| Alerts fire in staging for injected failures | Task 6 Step 3 |
| Manual accessibility sign-off recorded | Task 7 Step 3 |
| Pilot runs without unexplained divergence for the soak period | Task 10 soak log |

**Release gate:** Product, engineering, QA, security, operations, and the pilot owner sign `docs/live-certification/release-checklist.md`. No signature, no release.
