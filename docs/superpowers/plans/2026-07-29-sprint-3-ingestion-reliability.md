# Sprint 3 — Ingestion, Pub/Sub, and Scheduler Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All tenants synchronize independently and recover automatically: Google I/O leaves the database transactions, one revoked token cannot stall the fleet, backfill resumes from durable per-location checkpoints, deep updates and deleted reviews are eventually detected, malformed Pub/Sub messages stop poisoning the subscription, failed work is retried by workers without a human, and everything fits scheduler/DB-pool budgets under leader-locked pacing.

**Architecture:** `syncLinkedLocation` is restructured into fetch-outside-transaction / commit-per-page. `sync_checkpoint` becomes strictly per-location (own `page_token`, new `high_water_update_time` watermark) and gains a `sweep` sync type for tombstone detection (`review.provider_deleted_at`). The webhook route splits event bookkeeping from sync work and adopts ack/nack semantics by failure class. A jobs runner (`POST /api/jobs/run`, driven by the existing scheduler process) claims due retry work with `for update skip locked` under a Postgres advisory lock. Every outbound `fetch` gets an `AbortSignal.timeout`.

**Tech Stack:** Sprint 1 harness + Sprint 2 Google stub (`GOOGLE_API_PROXY_BASE`), postgres.js reserved connections + advisory locks, node scheduler process (`scripts/scheduler.mjs`), Zod fixtures.

**Sprint dates / points:** 31 August–11 September 2026, 73 points — the largest sprint; if fewer than three engineers are available, split at the marked seam (Tasks 1–5 = 3a, Tasks 6–10 = 3b). Tickets: SYNC-301 (8), SYNC-302 (8), SYNC-303 (8), SYNC-304 (13), WEB-301 (5), WEB-302 (5), WEB-303 (5), JOB-301 (8), OPS-301 (8), API-301 (5).

## Global Constraints

- Provider calls must not occur inside long database transactions (this sprint finishes the read paths; Sprint 2 did mutations).
- Names fixed by the master plan §2.1: `sync_checkpoint.high_water_update_time`, `review.provider_deleted_at`, webhook event statuses `'discarded'`/`'dead'`, jobs endpoint `POST /api/jobs/run`, module `lib/server/jobs.ts`, advisory-lock keys `'naba:jobs'` and `'naba:reconcile'`, timeout option `timeoutMs`.
- Migration for this sprint: `supabase/migrations/0007_sync_reliability.sql` (with `grant … to naba_app_runtime` for anything new, per the Sprint 1 rule).
- Sprint 2's helpers are the substrate: `startGoogleStub`, `seedGoogleConnection`, `seedLinkedReview`. Webhook tests additionally need `WEBHOOKS_ENABLED=true` + `GOOGLE_PUBSUB_VERIFICATION_TOKEN` on the harness server (token auth is the practical test path; OIDC is covered by unit tests over `verifyPubSubRequest` and live in Sprint 5).
- Do not commit unless the user explicitly asks.

**Execution order:** Task 1 (API-301) → Task 2 (SYNC-301) → Task 3 (SYNC-303) → Task 4 (SYNC-302) → Task 5 (WEB-301) → ‖seam‖ → Task 6 (WEB-302) → Task 7 (WEB-303) → Task 8 (SYNC-304) → Task 9 (JOB-301) → Task 10 (OPS-301).

---

### Task 1: API-301 — Google/OpenAI request timeouts and cancellation

**Files:**
- Modify: `lib/server/google.ts` (default timeouts on `googleRequest`, `exchangeGoogleCode`, `refreshAccessToken`)
- Modify: `lib/server/ai.ts` (timeout on the Responses API fetch)
- Modify: `scripts/scheduler.mjs:38-46` (timeout on scheduler fetches)
- Modify: `lib/server/db.ts:28-38` (statement + idle-in-transaction timeouts)
- Modify: `lib/server/env.ts` (tunables)
- Create: `tests/integration/routes/timeouts.test.ts`

**Interfaces:**
- Produces: env vars `GOOGLE_TIMEOUT_MS` (default 15000), `GOOGLE_MUTATION_TIMEOUT_MS` (default 20000, already used by Sprint 2 call sites), `OPENAI_TIMEOUT_MS` (default 30000) — `z.coerce.number()` with defaults in `serverEnvSchema`; `googleRequest` applies `timeoutMs ?? (mode === "mutation" ? env.GOOGLE_MUTATION_TIMEOUT_MS : env.GOOGLE_TIMEOUT_MS)`.

- [x] **Step 1: Failing test.** `tests/integration/routes/timeouts.test.ts`: stub `GET …/reviews` with `delayMs: 20_000`; server started with `GOOGLE_TIMEOUT_MS: "1500"`; `POST /api/sync/backfill` (owner cookie, one linked location) must return within ~5 s with a sync failure recorded (`sync_checkpoint.status = 'failed'`, `last_error_code` containing `timeout` or `google`), not hang to `maxDuration`. Assert wall-clock `< 10_000` ms. A second case: OpenAI — with `OPENAI_API_KEY` set to a dummy and `GOOGLE_API_PROXY_BASE` also serving `/v1/responses` with `delayMs: 20_000` and `OPENAI_TIMEOUT_MS: "1000"`… OpenAI has no proxy seam yet, so add one in Step 2 (`OPENAI_BASE_URL`, default `https://api.openai.com`). The test asserts `POST /api/reviews/{id}/drafts` `{tone}` (the AI path) fails fast with 502, not a 60 s stall. Run — FAIL (no timeouts exist; requests hang the full stub delay).
- [x] **Step 2: Implement.**
  - `lib/server/google.ts`: `googleRequest` already accepts `timeoutMs` (Sprint 2); make it default from env as in Interfaces. Give `exchangeGoogleCode` and `refreshAccessToken` `AbortSignal.timeout(env.GOOGLE_TIMEOUT_MS)` on their raw fetches. Map `TimeoutError`/`AbortError` in safe mode to a retryable transport fault (existing backoff loop), in mutation mode to `GoogleMutationAmbiguousError` (Sprint 2's classifier already treats `kind:"timeout"` as ambiguous).
  - Cap the honoured `retry-after` at 30 s (`google.ts:368-376` currently honours it unbounded): `Math.min(retryAfterMs, 30_000)`.
  - `lib/server/ai.ts`: `const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com"`; fetch `${base}/v1/responses` with `signal: AbortSignal.timeout(getServerEnv().OPENAI_TIMEOUT_MS)`; on abort throw `ApiError(502, "ai_timeout", "The AI provider timed out.")`.
  - `scripts/scheduler.mjs`: add `signal: AbortSignal.timeout(55_000)` to the fetch at line 38 (under the 60 s route budget).
  - `lib/server/db.ts`: pool options gain `connection: { statement_timeout: 30_000, idle_in_transaction_session_timeout: 60_000 }` — safe now because Sprint 2 removed provider calls from mutation transactions and Task 2 removes them from sync transactions; the 100k-row retention deletes run batched (existing `batch_size=100` loop) under 30 s.
- [x] **Step 3: Run** the new test + full suites (`pnpm test` — `tests/retry.test.ts` unchanged; `pnpm test:integration` — Sprint 2 suites must stay green with the new defaults). Expected: PASS.

**Deviation (Task 1):** The initial red run delayed the baseline route's
`POST locations:batchGetReviews`; Task 2 then moved the same assertion to the
planned `GET …/reviews` endpoint. `googleRequest` treats the configured timeout
as the budget for the whole retry operation (each retry receives only the
remaining budget), which preserves safe retry classification without allowing
five attempts to violate the route-level `< 10s` contract. Sprint 2's explicit
15/20-second publish constants were also removed so its read and mutation calls
consume the binding `GOOGLE_TIMEOUT_MS` and
`GOOGLE_MUTATION_TIMEOUT_MS` defaults.

---

### Task 2: SYNC-301 — Move Google I/O outside long database transactions

**Files:**
- Modify: `lib/server/reviews.ts:286-554` (`syncLinkedLocation`, `syncLinkedLocationBatch` → new structure)
- Modify: `app/api/sync/backfill/route.ts`, `app/api/sync/reconcile/route.ts`, `app/api/webhooks/google/pubsub/route.ts`, `app/api/webhooks/google/pubsub/replay/route.ts` (call-site adaptation)
- Create: `tests/integration/routes/sync-transactions.test.ts`

**Interfaces:**
- Consumes: `connectionAccessToken(sql: Sql | TransactionSql, …)` (widened in Sprint 2), `upsertGoogleReview(sql, …)` (unchanged — runs inside the per-page transaction).
- Produces: `syncLinkedLocation(input: { organisationId: string; externalLocationId: string; type: "backfill" | "reconcile" | "notification" | "sweep"; maxPages: number }): Promise<SyncOutcome>` where `SyncOutcome = { status: "succeeded" | "partial" | "failed"; pages: number; upserted: number; hasMore: boolean; errorCode?: string }`. **No `TransactionSql` parameter** — the function owns its transactions. `syncLinkedLocationBatch` is deleted (Task 3 removes its only reason to exist); the Google `locations:batchGetReviews` contract builder stays in `lib/domain/google-contract.ts` (tested, unused).

- [x] **Step 1: Failing test** — `tests/integration/routes/sync-transactions.test.ts`: stub `GET …/reviews` pages with `delayMs: 1_000` each (2 pages); during a running `POST /api/sync/backfill`, poll `pg_stat_activity` as in Sprint 2's publish test and assert **zero** `idle in transaction` sessions for `naba_test_runtime` while the stub delay elapses; after completion assert reviews upserted and `sync_checkpoint.status='succeeded'`. Second case — mid-run crash durability: stub page 1 OK, page 2 returns 500 repeatedly; after the route returns, assert page 1's reviews **are persisted** and `sync_checkpoint.page_token` equals page 1's `nextPageToken` (today the whole transaction rolls back and nothing survives). Run — FAIL on both.
- [x] **Step 2: Restructure `syncLinkedLocation`:**

```
syncLinkedLocation(input):
  header = withTenant(orgId, sql => {
    resolve linked location (linkedLocations() filter, throws 409 unverified as today)
    upsert sync_checkpoint → status 'running' (existing SQL reviews.ts:329-363,
      but scoped to THIS location only) returning id, page_token, high_water_update_time
    read connection id + google_account_name
  })
  accessToken = connectionAccessToken(getDatabase(), orgId, connectionId)  // outside tx
  pageToken = input.type === "backfill" ? header.pageToken : undefined
  pages = 0; upserted = 0
  loop:
    page = googleReviews(accessToken, accountName, locationName, pageToken)   // outside tx, paced, timed out
    withTenant(orgId, sql => {
      for each review payload → upsertGoogleReview(sql, …)
      update sync_checkpoint set page_token = ${page.nextPageToken ?? null},
        high_water_update_time = greatest(coalesce(high_water_update_time, 'epoch'), ${maxUpdateTimeOnPage})
        where id = ${header.checkpointId}
    })                                                                        // COMMIT per page
    pages++; pageToken = page.nextPageToken
    until !pageToken or pages >= input.maxPages
  withTenant(orgId, sql => settle checkpoint: 'succeeded' | 'pending'(hasMore) + last_review_update_time = now())
  on any Google/page error: withTenant(…) → checkpoint 'failed', last_error_code,
    next_attempt_at = syncRetryAt(...); return { status: "failed", errorCode, … }   // never throws for provider errors
```

Token-refresh failures (`google_reconnect_required`) and unverified-location are **returned** as `{status:"failed", errorCode}` too — Task 4 depends on this function never throwing for per-location conditions (it may still throw for programmer errors).

- [x] **Step 3: Adapt call sites.** Backfill route: replace the single `withTenant` wrapping (route L108) with session/role checks, then a plain `for` over target locations calling `syncLinkedLocation` (progress GET/DELETE unchanged). Reconcile route: same per-location call (org loop restructures further in Task 4). Webhook + replay: call with `{type:"notification", maxPages:1}` (event-row handling restructures in Task 6 — for now keep the existing dedupe insert in its own small `withTenant` **before** the sync call so the poison-rollback coupling dies here).
- [x] **Step 4: Run** Step 1's tests (PASS), Sprint 2 suites, and `pnpm test`. The `tests/integration/inbox-performance.test.ts` suite is unaffected (inline SQL). Expected: all PASS.

**Deviation (Task 2):** The baseline batch implementation catches an HTTP 500
inside its transaction and commits the already-upserted first page, so that
fixture did not reproduce the plan's predicted rollback. The durability test
uses an invalid page-2 provider timestamp instead, which aborts the page
transaction exactly like a process/database failure: red was HTTP 500 with
page 1 rolled back; green is HTTP 200 with page 1 committed, its continuation
token retained, and the checkpoint settled `failed` in a fresh transaction.
`high_water_update_time` writes remain deferred until Task 3 creates the
binding column.

---

### Task 3: SYNC-303 — Location-safe durable checkpoints (kill the shared page token)

**Files:**
- Modify: `lib/server/reviews.ts` (delete `syncLinkedLocationBatch` and the token fan-out at L375-377/400-404)
- Modify: `app/api/sync/backfill/route.ts:123-131` (grouping loop → per-location loop)
- Create: `tests/integration/routes/backfill-checkpoints.test.ts`
- Modify: `supabase/migrations/0007_sync_reliability.sql` (start it here)

**Interfaces:**
- Consumes: Task 2's `syncLinkedLocation`.
- Produces: migration columns `sync_checkpoint.high_water_update_time timestamptz` (Task 2 already writes it — migration lands here, so Tasks 2+3 merge into one PR in practice; keep the checklist order for review clarity).

- [x] **Step 1: Migration** — begin `0007_sync_reliability.sql`:

```sql
begin;

alter table sync_checkpoint
  add column high_water_update_time timestamptz;

alter table review
  add column provider_deleted_at timestamptz;

create index review_provider_deleted_idx
  on review (organisation_id, provider_deleted_at)
  where provider_deleted_at is not null;

insert into schema_migration (version) values ('0007_sync_reliability')
on conflict (version) do nothing;

commit;
```

(`review.provider_deleted_at` is used by Task 8; both tables already carry `naba_app_runtime` DML grants from 0004's blanket grant — no new tables yet.)

- [x] **Step 2: Failing test** — `tests/integration/routes/backfill-checkpoints.test.ts`: seed **two** linked locations under one connection; stub serves per-location pages where location A has 3 pages (tokens `A2`, `A3`) and location B has 1 page — keyed by the location id in the request path. Run backfill with `maxPagesPerLocation: 2`: assert checkpoint A has `page_token = 'A3'`, `status='pending'`; checkpoint B `page_token is null`, `status='succeeded'` (today both rows share whichever token the batch loop last saw). Then run backfill again (continuation): assert the stub's next `GET` for A carries `pageToken=A3` — no skipped and no re-fetched pages (stub records query strings). Interruption case: stub 500s on A's page 2 → A `failed` with `page_token='A2'` retained; B untouched `succeeded`. Run — FAIL (shared-token behavior).
- [x] **Step 3: Implement** — backfill route iterates `linkedLocations()` results sequentially, calling `syncLinkedLocation({type:"backfill", maxPages})` per location; delete `syncLinkedLocationBatch` and its exports; `pnpm typecheck` locates any leftover references. Batch-size guard (≤50 locations per request) stays in the route.
- [x] **Step 4: Run** — Step 2 PASS; whole `pnpm test:integration` green.

**Deviation (Task 3):** Task 2's binding signature and required plain
per-location backfill loop necessarily removed the shared-token behavior before
Task 3 began, so the planned token-continuity and interruption assertions were
already green and were not artificially regressed. Task 3's red assertion used
its other binding output: both per-location
`high_water_update_time` values were null after successful pages. The
implementation now advances each watermark from that location's committed page;
the full planned token and interruption matrix remains green.

---

### Task 4: SYNC-302 — Per-organisation/location error isolation; a revoked token must not halt the fleet

**Files:**
- Modify: `app/api/sync/reconcile/route.ts:40-100`
- Modify: `lib/server/google.ts:81-141` (`persistConnectionFailure` — reuse the caller's transaction is no longer required; keep its own short tx, but see Step 3)
- Create: `tests/integration/routes/reconcile-isolation.test.ts`

**Interfaces:**
- Produces: reconcile response shape `{ processed: number; nextCursor: string | null; failures: Array<{ organisationId: string; externalLocationId: string | null; errorCode: string }> }` — HTTP 200 even when some organisations fail. `scripts/scheduler.mjs` keeps walking the cursor on 200; it aborts only on non-2xx (auth/config errors).

- [x] **Step 1: Failing test** — `tests/integration/routes/reconcile-isolation.test.ts`: seed three orgs, each with one linked location; org B's `google_connection` has **no refresh token and an expired access token** (forces `google_reconnect_required` from `connectionAccessToken`); stub serves org A and C reviews normally. `POST /api/sync/reconcile` with `authorization: Bearer route-harness-cron-secret`: expect 200; A and C reviews upserted; response `failures` contains org B with `errorCode: "google_reconnect_required"`; org B's connection `status='expired'|'revoked'` and a `connection_task` row `open`; A and C checkpoints `succeeded`. Today: 401 aborts everything at whichever org sorts first. Run — FAIL.
- [x] **Step 2: Implement isolation.** In the reconcile route: enumeration query unchanged (`organisation_job_route` cursor walk); the per-org body becomes:

```ts
const failures: ReconcileFailure[] = []
let processed = 0
for (const organisationId of organisationIds) {
  const locations = await withTenant(organisationId, (sql) => listLinkedLocationIds(sql))
  for (const externalLocationId of locations) {
    try {
      const outcome = await syncLinkedLocation({
        organisationId, externalLocationId, type: "reconcile", maxPages: 2,
      })
      if (outcome.status === "failed") {
        failures.push({ organisationId, externalLocationId, errorCode: outcome.errorCode ?? "sync_failed" })
      }
    } catch (error) {
      failures.push({
        organisationId, externalLocationId,
        errorCode: error instanceof ApiError ? error.code : "internal_error",
      })
      log.error("reconcile.location_failed", { organisationId, externalLocationId, error })
    }
  }
  processed += 1
  // audit rows write in their own withTenant so a later org's failure can't erase them
}
```

The start/complete audit writes (`route.ts:62-96`) move to per-org `withTenant` blocks around the location loop.

- [x] **Step 3: Connection-failure persistence.** `persistConnectionFailure` (`google.ts:85`) opening a second pool connection while the caller held a transaction was a deadlock risk; after Task 2 the caller holds none — keep the function as-is but add a comment stating the invariant ("callers must not hold an open transaction"), and in `connectionAccessToken` verify both call paths comply (`executePublish` phase 2 ✓, `syncLinkedLocation` header phase runs it outside ✓).
- [x] **Step 4: Scheduler behavior.** `scripts/scheduler.mjs:48-52`: on non-2xx keep the current abort; on 200 with `failures.length`, log a warning line with the count (`log("warn", "reconcile.partial", { failures: body.failures.length })`) and continue the cursor. Add this as an assertion to the test by invoking the scheduler's `runReconciliation` in-process? No — the scheduler is a script; cover it in Task 10's budget test instead. Here, assert route semantics only.
- [x] **Step 5: Run** — PASS; full suites green.

---

### Task 5: WEB-301 — Support the verified real Pub/Sub payload schema

**Files:**
- Create: `tests/fixtures/pubsub/new-review.json`, `tests/fixtures/pubsub/updated-review.json`, `tests/fixtures/pubsub/unknown-shape.json`
- Create: `lib/domain/pubsub-payload.ts`
- Create: `tests/pubsub-payload.test.ts`
- Modify: `app/api/webhooks/google/pubsub/route.ts:14-35, 49-60, 98`

**Interfaces:**
- Produces: `parsePubSubNotification(decoded: unknown): { type: string; locationName: string | null; reviewName: string | null }` in `lib/domain/pubsub-payload.ts`. Fixtures are the documented Business Profile notification shape; Sprint 5 GGL-501 replaces them with a live capture and re-runs this suite — only the fixture files and (if casing differs) this one module may change then.

- [x] **Step 1: Fixtures.** `new-review.json` (documented camelCase shape):

```json
{
  "message": {
    "data": "<base64 of the object below>",
    "messageId": "1234567890",
    "publishTime": "2026-09-01T08:00:00.000Z",
    "attributes": {}
  },
  "subscription": "projects/naba-staging/subscriptions/reviews-push"
}
```

with decoded `data`: `{"location":"accounts/1001/locations/2002","review":"accounts/1001/locations/2002/reviews/r-777","type":"NEW_REVIEW"}`. `updated-review.json`: same with `"type":"UPDATED_REVIEW"`. `unknown-shape.json`: decoded `{"somethingElse":true}`.

- [x] **Step 2: Unit tests** — `tests/pubsub-payload.test.ts`: for each fixture decode and assert `parsePubSubNotification` returns `{type:"NEW_REVIEW", locationName:"locations/2002"…}` etc.; the unknown shape returns `{type:"review_update", locationName:null, reviewName:null}`; legacy keys (`locationName`, `reviewName`, `notificationType`) still parse (current code's fallbacks, kept). Run — FAIL; implement the module by moving `notificationLocation` (`route.ts:24-35`) and the type derivation (`route.ts:98`) into it with a Zod schema accepting both key sets:

```ts
const notificationSchema = z
  .object({
    type: z.string().optional(),
    notificationType: z.string().optional(),
    review: z.string().optional(),
    reviewName: z.string().optional(),
    location: z.string().optional(),
    locationName: z.string().optional(),
  })
  .passthrough()
```

`locationName` extraction: prefer explicit location keys, else derive from the review resource name via the existing `/locations\/[^/]+/` match. Run — PASS.

- [x] **Step 3: Harness auth decision (amends WEB-101).** `verifyPubSubRequest` runs *both* checks when both are configured, so a harness server with `GOOGLE_PUBSUB_AUDIENCE` set could never pass (tests cannot mint Google OIDC tokens) — yet Sprint 1's boot rule requires the audience whenever webhooks are on. Resolve it by widening the rule: in `collectSafetyViolations`, "strong webhook auth" is satisfied by `GOOGLE_PUBSUB_AUDIENCE` **or** a `GOOGLE_PUBSUB_VERIFICATION_TOKEN` of ≥ 32 chars. Update `tests/startup-safety.test.ts` accordingly (existing audience cases unchanged; add: 32-char token + no audience → no violation; 16-char token + no audience → violation). Staging/production still use OIDC (parallel track P3); document that in the module comment.
- [x] **Step 4: Route rewire + route test.** The webhook route uses `parsePubSubNotification`; add `tests/integration/routes/webhook-payload.test.ts`: server env `WEBHOOKS_ENABLED:"true"`, `GOOGLE_PUBSUB_VERIFICATION_TOKEN:"harness-pubsub-token-32-characters!!"`, no audience. POST the `new-review.json` fixture (with `x-goog-pubsub-token` header, `data` re-encoded to reference the seeded location's `google_location_name`): expect 200 `{status:"processed"}` and one stub `GET …/reviews` call. OIDC-path coverage stays at the unit level over `verifyPubSubRequest` (existing behavior, unchanged) and live in Sprint 5. Run — PASS after wiring.

*(Seam note: 3a/3b split point is here.)*

---

### Task 6: WEB-302 — Permanent-malformed acknowledgment vs retriable failure; dead-letter handling

**Files:**
- Modify: `app/api/webhooks/google/pubsub/route.ts` (ack/nack matrix + event-row lifecycle)
- Modify: `supabase/migrations/0007_sync_reliability.sql` (status values)
- Create: `app/api/webhooks/google/pubsub/failures/route.ts` (ops listing)
- Create: `tests/integration/routes/webhook-acks.test.ts`

**Interfaces:**
- Produces: `processed_webhook_event.status` gains `'discarded'` and `'dead'` — append to the migration:

```sql
alter table processed_webhook_event drop constraint if exists processed_webhook_event_status_check;
alter table processed_webhook_event
  add constraint processed_webhook_event_status_check
  check (status in ('processing', 'processed', 'failed', 'discarded', 'dead'));
```

(Reconcile the pre-existing value list against `0001_initial.sql:351-368` when implementing — keep every value 0001 allows plus the two new ones.) Also: `GET /api/webhooks/google/pubsub/failures` (owner/admin) → `{ items: Array<{ id, eventType, status, retryCount, nextAttemptAt, lastErrorCode, receivedAt }> }` for statuses `failed|dead`, newest first, limit 100.

- [x] **Step 1: Failing route tests** — `tests/integration/routes/webhook-acks.test.ts` (server as Task 5):

| Case | POST body | Expected HTTP | Expected persistence |
|---|---|---|---|
| non-base64 / non-JSON `data` | garbage | **200** `{status:"discarded"}` | none (org unknown) — structured log only |
| zod-invalid envelope | `{}` | **200** `{status:"discarded"}` | none |
| unresolvable location | valid envelope, decoded `{}` | **200** `{status:"discarded"}` | none |
| unknown location name | valid, `locations/nope` | 200 `{status:"ignored"}` (today's behavior, kept) | none |
| linked location, sync succeeds | valid | 200 `{status:"processed"}` | event `processed` |
| linked location, Google 500s persistently | valid | **200** `{status:"failed"}` | event `failed`, `retry_count=0`, `next_attempt_at` set (worker recovers — Task 9) |
| database unavailable (simulate: stop… not practical in harness) | — | *unit-level only:* the route's catch classifies unexpected internal errors as 500 | nack |
| duplicate messageId of a `processed` event | valid | 200 `{status:"duplicate"}` | unchanged |

Assert also that discarded cases emit the OTel counter (`nabapresence.webhook.discarded`) via a log line assertion (`stderr` capture from `startAppServer` — extend the helper to expose collected stdout/stderr). Run — FAIL (garbage → 500-loop, invalid → 400-loop, sync-fail currently drops with no `next_attempt_at`).

- [x] **Step 2: Implement the matrix.** Route structure after Task 2's split:

```
1. flags + verifyPubSubRequest (unchanged; auth failures stay 401 → nack, correct)
2. parse envelope: on ANY parse/shape failure → log + counter + return 200 {status:"discarded"}
3. resolve webhook_route (raw pool, unchanged): unknown → 200 ignored
4. tx1 (withTenant): upsert processed_webhook_event on conflict do update set external_event_id = excluded.external_event_id
   returning status, retry_count; if returned status = 'processed' → 200 duplicate;
   else ensure row status='processing'
5. outcome = syncLinkedLocation({type:"notification", maxPages:1})
6. tx2: outcome succeeded → event 'processed'; outcome failed →
   event 'failed', retry_count unchanged (the worker owns increments),
   next_attempt_at = now() + retryDelayMs(retry_count + 1), audit 'webhook.sync_failed'
   → 200 {status:"failed"}
7. unexpected throw (DB down, bug) → 500 (nack → Pub/Sub redelivery + subscription-level DLQ)
```

The subscription-level dead-letter topic (parallel-track P3) catches persistent 500s; in-app `'dead'` is set by the worker after max retries (Task 9).

- [x] **Step 3: Failures listing route** — thin owner/admin `withTenant` select as per Interfaces; add to `lib/naba-review-api.ts` later only if Sprint 4 UI wants it (ops can curl; document in runbook — Sprint 5 DOC-501).
- [x] **Step 4: Run** — matrix PASS; replay route still works (`replay/route.ts` now re-drives `syncLinkedLocation` and updates the event row through the same tx2 helper — extract `settleWebhookEvent(sql, eventId, outcome)` to share).

**Deviation (Task 6):** The exact failures-listing response includes
`lastErrorCode`, but the plan's migration snippet did not add its backing
column. Migration 0007 therefore adds `processed_webhook_event.last_error_code
text`. The replacement status constraint keeps all four 0001 values, adds the
two required terminal values, and also adds the plan's intermediate
`processing` lifecycle value.

---

### Task 7: WEB-303 — Collision-safe webhook routing; route removal on unlink/disconnect

**Files:**
- Modify: `app/api/location-links/route.ts` (add `DELETE`)
- Modify: `app/api/google/connections/[id]/disconnect/route.ts` (purge routes + deactivate links)
- Modify: `lib/naba-review-api.ts` (add `unlinkLocation`)
- Modify: `components/naba-review/connections-view.tsx` (unlink action next to the link action)
- Create: `tests/integration/routes/unlink-disconnect.test.ts`

**Interfaces:**
- Consumes: Sprint 1's RLS policies on `webhook_route` (cross-tenant claims already 409 as `location_routing_conflict` at discovery).
- Produces: `DELETE /api/location-links?externalLocationId=<uuid>` (owner/admin) → 200 `{ unlinked: true }`; client `unlinkLocation(externalLocationId: string)`.

- [x] **Step 1: Failing tests** — `tests/integration/routes/unlink-disconnect.test.ts`:

```ts
it("unlink deactivates the link and removes webhook routing", async () => {
  await unlink(externalLocationId)
  const [link] = await admin`select is_active from location_link where external_location_id = ${externalLocationId}`
  expect(link.is_active).toBe(false)
  expect(await admin`select 1 from webhook_route where external_location_id = ${externalLocationId}`).toEqual([])
  // notifications for the location now ack as ignored:
  const response = await postWebhook(fixtureFor(googleLocationName))
  expect((await response.json()).status).toBe("ignored")
})

it("disconnect removes routing for every location of the connection", async () => {
  await fetch(`${server.baseUrl}/api/google/connections/${connectionId}/disconnect`, { method: "POST", headers: { cookie: owner.cookie } })
  expect(await admin`select 1 from webhook_route where organisation_id = ${owner.organisationId}`).toEqual([])
  const [link] = await admin`select is_active from location_link where external_location_id = ${externalLocationId}`
  expect(link.is_active).toBe(false)
})

it("re-discovery after another tenant's unlink can claim the freed route", async () => {
  await unlinkAs(tenantA, externalLocationA)          // frees google_location_name
  // tenant B discovery upsert for the same google_location_name now succeeds:
  await runtimeAsTenantB(sql => sql`insert into webhook_route (google_location_name, organisation_id, external_location_id) values (${name}, ${tenantB.organisationId}, ${externalLocationB})`)
})
```

Run — FAIL (no DELETE handler; disconnect leaves routes in place — verified gap).

- [x] **Step 2: Implement.** `DELETE` handler in `app/api/location-links/route.ts`: owner/admin; `withTenant`: `update location_link set is_active = false where external_location_id = ${id}` (404 if zero rows), `delete from webhook_route where external_location_id = ${id}` (RLS delete policy permits own-org rows), cancel open `sync_checkpoint` rows for the location (`status='cancelled'`), audit `location.unlinked`. Disconnect route: after the existing token-nulling block, add `delete from webhook_route where organisation_id = ${session.organisationId} and external_location_id in (select id from external_location where google_connection_id = ${connectionId})` and `update location_link set is_active = false where external_location_id in (…)`; extend the existing audit metadata with `routesRemoved` count. Client + a small "Unlink" button with confirm dialog in the linked-locations list of `connections-view.tsx` (same idiom as the link action at L425).
- [x] **Step 3: Run** — PASS + `pnpm test:a11y` (connections scenario mocks unchanged — update the mocked location-links fixture if the view now renders the unlink control unconditionally).

**Deviation (Task 7):** The rebrand moved the planned client and component
paths to `lib/naba-presence-api.ts` and
`components/naba-presence/connections-view.tsx`; the binding remains exactly
`unlinkLocation(externalLocationId: string)`.

---

### Task 8: SYNC-304 — Full-depth update reconciliation and deleted-review detection

**Files:**
- Modify: `lib/server/reviews.ts` (watermark-bounded reconcile depth; sweep mode; un-tombstone on reappearance)
- Modify: `app/api/reviews/route.ts`, `app/api/reviews/[id]/route.ts`, `app/api/analytics/overview/route.ts`, `app/api/analytics/locations/[id]/route.ts` (exclude tombstoned rows)
- Create: `tests/integration/routes/deep-reconcile.test.ts`
- Create: `tests/integration/routes/tombstones.test.ts`

**Interfaces:**
- Consumes: `high_water_update_time`, `review.provider_deleted_at` (Task 3 migration), `syncLinkedLocation` `type: "sweep"`.
- Produces: reconcile depth rule — for `type:"reconcile"`, page (ordered `updateTime desc`) until the page's **oldest** `updateTime` < `high_water_update_time − 24h` or 20 pages, whichever first; sweep rule — full pagination building an in-memory seen-set of `google_review_name_hash`, then `update review set provider_deleted_at = now() where … not in seen and update_time < sweepStartedAt`; reappearing reviews clear the tombstone in `upsertGoogleReview`'s `on conflict` (`provider_deleted_at = null`).

- [x] **Step 1: Deep-update failing test** — `tests/integration/routes/deep-reconcile.test.ts`: stub a location with 150 reviews (3 pages of 50); run a backfill (`maxPages: 20`) to establish `high_water_update_time`; then modify the stub so a review on **page 3** (old `updateTime`, position 130) gains a newer body but keep its `updateTime` older than page 1's newest minus… no — Google re-sorts by `updateTime desc`, so an updated review moves to page 1. The gap the spec targets is different: updates whose new `updateTime` is still older than the newest two pages' floor (batch edits, clock skew, missed cycles). Model it: after backfill, bump 60 stub reviews' bodies with `updateTime`s spread across pages 1–3 while high-water sits at the old max. Reconcile with the new depth rule must page until it passes `high_water − 24h` — i.e. all 3 pages — and upsert all 60 changed bodies; assert a spot-checked deep review's text updated in DB. With today's `maxPages: 2`, page-3 changes are missed — assert that failure first. Run — FAIL.
- [x] **Step 2: Implement depth rule** in `syncLinkedLocation`: for `type:"reconcile"`, ignore the fixed `maxPages: 2` from callers (route passes `maxPages: 20` now) and stop when `oldestUpdateTimeOnPage < highWater - 24h` (both from page data; when `high_water_update_time` is null, treat as backfill-depth). Keep `notification` at 1 page.
- [x] **Step 3: Tombstone failing test** — `tests/integration/routes/tombstones.test.ts`: backfill 100 stub reviews; remove 10 from the stub's dataset; trigger a sweep (call the route-level entry Task 9 exposes, or `syncLinkedLocation({type:"sweep", maxPages: 50})` via a tiny ops route `POST /api/sync/sweep` (owner/admin + cron dual-auth like reconcile) — create that route here); assert: the 10 rows have `provider_deleted_at not null`; `GET /api/reviews` no longer returns them; `GET /api/reviews/{id}` for one returns 404; analytics `reviewCount` drops by 10; audit row `review.provider_deleted` written per sweep (one summary row with count, not 10 rows). Reappearance: restore 1 review in the stub, reconcile → `provider_deleted_at` cleared, visible again. Run — FAIL.
- [x] **Step 4: Implement sweep + exclusions.** Sweep in `syncLinkedLocation` (`type:"sweep"`): paginate fully (respect `maxPages` as a hard cap; if the cap is hit before the last page, mark checkpoint `failed` with `sweep_incomplete` and **do not tombstone** — a partial seen-set must never delete); on completion run the tombstone update + one audit row (`metadata: { tombstoned: n, locationId }`) + checkpoint `succeeded`. Exclusions: add `and r.provider_deleted_at is null` to the inbox list WHERE (`app/api/reviews/route.ts`), detail (404 when tombstoned), both analytics routes' filters, and Sprint 4's counts endpoint when it lands. `upsertGoogleReview` conflict-set gains `provider_deleted_at = null`.
- [x] **Step 5: Run** both suites + full regression. Expected: PASS.

**Deviation (Task 8):** `syncLinkedLocation({ type: "sweep" })` is a binding
interface, but 0001's `sync_checkpoint.sync_type` constraint omitted `sweep`.
The still-open migration 0007 extends that constraint while retaining every
existing value.

---

### Task 9: JOB-301 — Workers for failed webhooks, backfill continuation, and reply retries

**Files:**
- Create: `lib/server/jobs.ts`
- Create: `app/api/jobs/run/route.ts`
- Modify: `scripts/scheduler.mjs` (jobs tick)
- Modify: `lib/server/env.ts` (`JOBS_INTERVAL_SECONDS` default 60 — scheduler-side only, read from `process.env` in the script like the other intervals)
- Create: `tests/integration/routes/jobs-runner.test.ts`

**Interfaces:**
- Consumes: `syncLinkedLocation` (Tasks 2/3), `recoverAttempt` + `retryPublishAttempt` (Sprint 2 — `retryPublishAttempt(organisationId, attemptId)` re-runs phases 2–3 from the stored `intended_body`; add it to `lib/server/publishing.ts` now if Sprint 2 shipped without it), `settleWebhookEvent` (Task 6).
- Produces: `runDueJobs(options: { budgetMs: number }): Promise<{ webhooks: number; checkpoints: number; attempts: number; dead: number }>` in `lib/server/jobs.ts`; `POST /api/jobs/run` (CRON_SECRET bearer only) → that summary; scheduler drives it every `JOBS_INTERVAL_SECONDS`.

- [ ] **Step 1: Failing tests** — `tests/integration/routes/jobs-runner.test.ts`:

```ts
it("retries a failed webhook event and marks it processed", async () => {
  // seed: event row status 'failed', retry_count 1, next_attempt_at now()-1s,
  // stub healthy again
  const response = await runJobs()
  expect((await response.json()).webhooks).toBe(1)
  const [event] = await admin`select status, retry_count from processed_webhook_event where id = ${eventId}`
  expect(event).toEqual({ status: "processed", retry_count: 2 })
})

it("dead-letters a webhook event after 5 attempts", async () => {
  // seed retry_count 5, stub still failing → status 'dead' + audit
})

it("continues a pending backfill checkpoint headlessly", async () => {
  // seed checkpoint status 'pending', page_token 'A3', next_attempt_at due
  await runJobs()
  // stub receives GET with pageToken=A3; checkpoint ends 'succeeded'
})

it("settles a stale started publish attempt via read-back", async () => {
  // Sprint 2 crash seed (started, 10 min old, reply live on stub)
  const body = await (await runJobs()).json()
  expect(body.attempts).toBe(1)
  const [attempt] = await admin`select status from publish_attempt where id = ${attemptId}`
  expect(attempt.status).toBe("succeeded")
})

it("retries a retryable publish attempt without a human", async () => {
  // attempt 'retryable', next_attempt_at due, stub PUT healthy → 'succeeded',
  // exactly one PUT
})

it("claims work exclusively (skip locked)", async () => {
  // two concurrent runJobs() calls over 1 due item → summed counts equal 1
})
```

Run — FAIL (no runner exists; today every one of these requires a human).

- [ ] **Step 2: Implement `lib/server/jobs.ts`.** Claim pattern per queue (short transactions, work outside them):

```ts
async function claimWebhookEvents(limit: number) {
  return getDatabase().begin(async (sql) => {
    return sql<ClaimedEvent[]>`
      select id, organisation_id::text as "organisationId"
      from processed_webhook_event
      where status = 'failed'
        and retry_count < 5
        and next_attempt_at <= now()
      order by next_attempt_at
      limit ${limit}
      for update skip locked
    `
    // mark claimed inside the same tx: set status='processing', retry_count = retry_count + 1
  })
}
```

`runDueJobs` loops three queues round-robin under the `budgetMs` deadline: (a) claimed webhook events → resolve their location from the event's stored payload/route (persist `external_location_id` on the event row at Task 6 tx1 to make this a column read — add the column to 0007: `alter table processed_webhook_event add column external_location_id uuid`), re-run `syncLinkedLocation({type:"notification"})`, settle `processed`/`failed`+backoff/`dead`+audit at `retry_count >= 5`; (b) `sync_checkpoint` rows `status in ('pending','failed') and next_attempt_at <= now() and sync_type in ('backfill','sweep')` → `syncLinkedLocation` continuation (`maxPages 5` per claim); (c) `publish_attempt` rows `status in ('retryable') and next_attempt_at <= now()` → `retryPublishAttempt`; `status='ambiguous'` or stale `'started'` (> 10 min) → `recoverAttempt`. Every item is individually try/caught; failures re-schedule with `retryDelayMs(retry_count)`.
- [ ] **Step 3: Route + scheduler.** `app/api/jobs/run/route.ts`: `runtime="nodejs"`, `maxDuration=60`, CRON_SECRET bearer via `secretEqual` (same as reconcile), calls `runDueJobs({budgetMs: 45_000})` under the Task 10 advisory lock (stub the lock as a no-op until Task 10 lands, then tighten). `scripts/scheduler.mjs`: add `recurring("jobs", runJobsTask, jobsIntervalMs, 10_000)` posting `/api/jobs/run`.
- [ ] **Step 4: Run** the suite — PASS. The spec criterion "failed work progresses without a human repeating the API request" is this task's evidence.

---

### Task 10: OPS-301 — Leader election, runtime budgets, and provider-safe pacing

**Files:**
- Create: `lib/server/leases.ts`
- Modify: `app/api/jobs/run/route.ts`, `app/api/sync/reconcile/route.ts` (locks + budgets)
- Modify: `lib/server/google.ts:46-54` (pacing jitter + per-connection floor)
- Create: `tests/integration/routes/leases.test.ts`

**Interfaces:**
- Produces: `withAdvisoryLock<T>(key: "naba:jobs" | "naba:reconcile" | "naba:retention", fn: () => Promise<T>): Promise<T | { skipped: true }>` in `lib/server/leases.ts` — reserves a dedicated connection (`getDatabase().reserve()`), `select pg_try_advisory_lock(hashtext(${key}))`, runs `fn` outside any transaction, unlocks + releases in `finally`; returns `{skipped:true}` when the lock is held elsewhere.

- [ ] **Step 1: Failing test** — `tests/integration/routes/leases.test.ts`: hold `pg_advisory_lock(hashtext('naba:jobs'))` on an admin connection; `POST /api/jobs/run` → 200 `{skipped:true}` with zero work performed; release; run again → normal summary. Second case: two truly concurrent `POST /api/sync/reconcile` (cron auth) → exactly one does work (the other `{skipped:true}`); assert via stub call counts. Run — FAIL.
- [ ] **Step 2: Implement `lib/server/leases.ts`** per the interface; wrap the jobs route body and the reconcile route body (`{skipped:true}` responses are 200 so the scheduler treats them as healthy). Retention route gets the same wrapper with `'naba:retention'` (cheap; prevents double-purge from a second scheduler).
- [ ] **Step 3: Budgets.** Reconcile route: thread a `deadline = Date.now() + Number(process.env.RECONCILE_BUDGET_MS ?? 45_000)` through the org loop; when exceeded, stop and return `nextCursor` so the scheduler's existing cursor walk (`scripts/scheduler.mjs:56-78`) continues next call — assert in the Task 4 test file with a tight budget override (`RECONCILE_BUDGET_MS: "1"` → first call processes ≤1 org and returns a cursor).
- [ ] **Step 4: Pacing.** In `paceGoogleRequest` (`google.ts:46-54`): add ±20 % jitter to the interval (`interval * (0.9 + Math.random() * 0.2)`) and a per-connection floor — extend the function signature to `paceGoogleRequest(connectionKey?: string)` holding a `Map<string, number>` of per-connection next-at floors at `4 × interval`, and pass `connectionId` from `googleRequest` callers that have one (`connectionAccessToken` consumers thread it via the existing options object). Fleet-level correctness note (goes in the module doc comment): scheduled work is single-flight via `withAdvisoryLock`, so process-local pacing is fleet pacing for sync; interactive publishes remain per-process and are individually rare.
- [ ] **Step 5: Pool-health regression.** Extend `tests/integration/routes/sync-transactions.test.ts` with the "database pool behavior remains healthy during backfill" criterion: run a 4-location backfill against a slow stub (250 ms/page) while concurrently issuing 20 authenticated `GET /api/reviews` requests; assert all inbox requests complete `< 2 s` (no pool starvation — sync holds no connections while waiting on Google).
- [ ] **Step 6: Run everything** — full `pnpm test:integration`, `pnpm test`, `pnpm build`, `pnpm test:e2e`. Expected: PASS.

---

## Sprint 3 acceptance criteria → evidence map

| Criterion | Evidence |
|---|---|
| One revoked connection produces a tenant-scoped failure and does not stop other tenants | Task 4 `reconcile-isolation.test.ts` |
| Interrupted multi-location backfill resumes without skips or duplicates | Task 3 `backfill-checkpoints.test.ts` (token continuity assertions) |
| Updates outside the newest two pages are eventually detected | Task 8 `deep-reconcile.test.ts` |
| Google-deleted reviews receive a defined local state and leave analytics | Task 8 `tombstones.test.ts` |
| Permanent malformed Pub/Sub events are acknowledged and audited | Task 6 matrix rows 1–3 (ack + log/audit) |
| Retriable events are durably queued or redelivered | Task 6 row 6 (`failed` + `next_attempt_at`) + Task 9 retry |
| Failed work progresses without a human repeating the API request | Task 9 `jobs-runner.test.ts` |
| Scheduler load completes within the configured execution budget | Task 10 Step 3 budget test |
| Database pool behavior remains healthy during backfill and reconciliation | Task 10 Step 5 |

**Release gate:** Synchronization is fleet-safe, recoverable, and eventually consistent — all suites above green in CI under the runtime role, plus a compose-stack manual smoke (`docker compose up --build`, scheduler running, stub-free) showing reconcile/jobs ticks logging cleanly.
