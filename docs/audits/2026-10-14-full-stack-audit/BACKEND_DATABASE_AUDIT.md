# NabaPresence backend and database audit

**Date:** 2026-10-14. **Snapshot:** `main` at `d8759c74` plus the uncommitted inbox UI work on `feat/inbox-mail-refinement` (none of the files cited here are among those changes).
**Scope:** backend services, API routes, data access, database performance, concurrency, background jobs and reliability. Billing, AI-credit and retention integrity are included where they touch data integrity.
**Audience:** the engineering team.

## Scope and method

- **Sources.** Round-1 workstream reports W3 (API), W4 (database), W8 (jobs and scale), and the server parts of W0 (architecture) and W6 (security and reliability). Round-2 reports R2-W0b (billing, credits, retention) and R2-W1b (idempotency). The verifier reports R2-V2, R2-V3 and R2-V4. Raw files are in `raw/`.
- **Ledger wins.** Priorities and statuses follow `VERIFIED_FINDINGS.md`. Where a verifier corrected a raw report, the corrected version is used and the correction is noted. Findings that are not in the ledger keep the raw report's status and are marked _(raw, not re-verified)_.
- **Static analysis only.** No database, `EXPLAIN`, `pg_stat_*`, telemetry or production access was available (local Docker was down). Every cost claim is a prediction from schema and query shape. Each finding names the measurement that would confirm it. All numbers below are counts or bounds derived from code constants, not measurements.
- **Spot checks for this document:** `lib/server/db.ts:33-76`, `scripts/db-create-runtime-role.mjs:34-39`, `lib/server/hours.ts:728-760`, `lib/server/reviews.ts:250-385`, `lib/server/leases.ts:160-190`, `0001_initial.sql:245-283,399`, `0035_reply_state_machine.sql:56`, `0130_bulk_review_families.sql:77-79`.

**Status key:** Confirmed = checked by a second agent or the coordinator. Partially confirmed = confirmed with corrections. Plausible = code path read but effect not independently verified. Unverified = needs a live environment.

### Security P0 (pointer only)

**SEC-11 / W6-01** (P0, Unverified; preconditions Confirmed) may expose the SECURITY DEFINER `provision_local_bootstrap` and the `organisation_job_route` table to the public `anon` key through the Supabase Data API. It is documented, with the operator SQL checklist and the remediation migration, in `CODEBASE_AUDIT.md` and `raw/R2-W6b-data-api-exposure.md`. It is not repeated here. Nothing in this document should be scheduled ahead of it. Some items below change `0005`-era functions and grants (the `claim_due_jobs` priority change, the legal-hold trigger). Their migrations must keep the explicit `revoke … from anon, authenticated` that the P0 fix introduces.

## Summary

| ID                            | Title                                                                       | Priority             | Status                  | Theme               | Size |
| ----------------------------- | --------------------------------------------------------------------------- | -------------------- | ----------------------- | ------------------- | ---- |
| W4-01                         | Advisory-lock transactions held across Google calls (13 sites)              | P1                   | Confirmed               | 1 Locking           | M    |
| W4-03                         | Review sync rewrites every review on every reconcile                        | P1                   | Confirmed               | 2 Sync integrity    | M    |
| W4-04                         | `audit_log` read by subject with no subject index                           | P1 (posts part P2)   | Confirmed               | 3 Indexes           | S    |
| W3-2                          | Editor GETs read Google live with no freshness gate                         | P1                   | Confirmed               | 4 API               | M    |
| W3-3                          | Server-side `ZodError`s become unlogged 400s                                | P1                   | Confirmed               | 4 API               | S    |
| W3-4 / R2B-05                 | Request work outruns `maxDuration`; AI credit charged with no draft         | P1                   | Confirmed               | 4 API               | S–M  |
| W8-01                         | One locked 4-worker tick per minute caps all recurring work                 | P1                   | Confirmed (upper bound) | 5 Jobs              | M    |
| W1-F1                         | Server approval guards are optional (`draftId`, `expectedReviewUpdateTime`) | P1                   | Confirmed               | 7 Idempotency       | S    |
| W8-04                         | Sync can blank or revert a just-published reply                             | P2                   | Confirmed               | 2 Sync integrity    | M    |
| W8-02 / W0-01                 | Scheduled posts and bulk run on leftover tick budget                        | P1 latent / P2 today | Confirmed               | 5 Jobs              | S–M  |
| W8-03                         | Job claim has no per-kind priority; recurring herds                         | P2                   | Confirmed               | 5 Jobs              | S–M  |
| W8-05                         | Fleet session locks have no expiry                                          | P2                   | Partially confirmed     | 5 Jobs              | S    |
| W8-08                         | "Sync now" uses one cross-tenant lock key                                   | P2                   | Confirmed               | 5 Jobs              | S–M  |
| W8-09                         | Bulk runner fans out 25 children with `Promise.all`                         | P2                   | Confirmed               | 5 Jobs              | S    |
| W4-02                         | Session-pooler slot pressure (15 slots)                                     | P2                   | Partially confirmed     | 1 Locking           | M    |
| W4-05 / W0-05 / W3-05 / W8-13 | `app_session` written on every request                                      | P2                   | Confirmed               | 3 Indexes           | S    |
| W4-06                         | Full-tenant counts per poll; analytics window unindexed                     | P2                   | Confirmed               | 3 Indexes           | S–M  |
| W4-07                         | Search is a non-inlinable definer SRF over a fleet-wide GIN                 | P2                   | Confirmed               | 3 Indexes           | M    |
| W4-08                         | FK cascade paths have no leading index                                      | P2                   | Confirmed               | 3 Indexes           | S    |
| W4-09                         | ~6,028 single-row metric upserts on first sync                              | P2                   | Confirmed               | 3 Indexes           | S    |
| W3-1                          | Discovery GETs page all of Google and upsert row by row                     | P2 (was P1)          | Partially confirmed     | 4 API               | M    |
| W3-07                         | Abuse limits missing on expensive endpoints; no Google fairness             | P2                   | Confirmed _(raw)_       | 4 API               | S–M  |
| R2B-01                        | Legal holds enforced only in app queries; FK cascades holds away            | P2                   | Confirmed (FK)          | 6 Billing/retention | M    |
| R2B-02/03/04/06               | Name erasure, missed reasons, member limit, billing dead letters            | P2                   | Plausible               | 6 Billing/retention | S–M  |
| W1-F6/F7                      | Post approve/delete retries; duplicate bulk batches                         | P2                   | Confirmed               | 7 Idempotency       | S–M  |
| W6-03                         | Publish re-arm has no status CAS                                            | P2                   | Plausible               | 7 Idempotency       | S    |
| W7-5 / W4-13                  | No `CONCURRENTLY`, no default `lock_timeout` in migrations                  | P2                   | Plausible               | 3 Indexes           | S    |

Lower-priority items (W4-10..16, W3-06/09/11..14, W8-06/07/10/15..20, R2B-07..14) are listed in each theme's "Also noted" block.

---

## Theme 1: Transactions and locking across Google calls

### W4-01 Advisory-lock transactions stay open across Google read, check, write and readback

- **Priority:** P1. **Status:** Confirmed (coordinator, R2-V1, R2-V2, R2-V4).
- **Location:** 13 sites (R2-V4):
  - `lib/server/hours.ts:739`, `profile.ts:641`, `food-menus.ts:460`
  - `business-information.ts:203`, `:216` (confirm), `:510`
  - `industry-management.ts:68` (confirm), `:119`
  - `google-verification-execution.ts:90`, `google-administration-execution.ts:16`, `google-lifecycle-execution.ts:15`, `google-account-change-lock.ts:9`
  - `bulk-listing-runner.ts:384`

  Ruled out: `gbp-management.ts:198`, `media.ts:459` and `bulk-families/photos.ts:158` take xact locks inside pooled `withTenant` with no HTTP.

- **Current implementation and evidence:**
  ```ts
  withSessionConnection((connection) =>
    connection.begin(async (lock) => {
      await lock`select pg_advisory_xact_lock(hashtextextended(${hoursLockKey(...)}, 0))`
      const live = await readLiveHours(...)                       // Google GET (+ categories GET)
      const checked = checkPublishSnapshot(live, input)
      const result = await publishHoursToGoogle(live, input, ...) // validateOnly PATCH, PATCH, readback
  ```
  - The lock statement is the only statement on that connection. All data work uses the pool. The backend is therefore _idle in transaction_ for the whole provider sequence.
  - `withSessionConnection` sets no timeouts (`db.ts:62-70`). The pooled client sets 30 s / 60 s as startup parameters (`db.ts:40-43`), but the pooler drops those. The only effective limits are the role-level ones in `db-create-runtime-role.mjs:37-39`: `statement_timeout 30s` and `idle_in_transaction_session_timeout 60s`. They apply only where the runbook role script was used.
  - Worst case for `publishCanonicalHours` (R2-V4):

    | Step                           | Bound                                                                                          |
    | ------------------------------ | ---------------------------------------------------------------------------------------------- |
    | Token refresh wait             | ≤ 20 s (`connections.ts:436`)                                                                  |
    | Live hours read                | ≤ 15 s, plus up to 15 s because the retry sleep at `transport.ts:439` can overrun the deadline |
    | Categories read                | ≤ 15 s (`hours.ts:153`)                                                                        |
    | validateOnly PATCH, then PATCH | 20 s each (single attempt)                                                                     |
    | Readback                       | ≤ 15 s                                                                                         |

    That is about 85 s nominal and about 120 s at worst, against the 60 s idle limit. The route's `maxDuration` is also 60 (`app/api/locations/[id]/hours/route.ts:18`). On a healthy Google the sequence takes seconds. The limit is reached only when Google is slow or throttling.
- **Failure modes:**
  1. **Holder killed.** At 60 s idle, Postgres terminates the backend and the lock is released mid-write, so a bulk child can interleave. The attempt row is started and settled in separate pooled transactions (`gbp-write.ts:11`), so the receipt says `succeeded`. The outer `COMMIT` then fails and the user gets a 5xx for a write Google applied.
  2. **Waiter killed (new, R2-V4).** A blocked `pg_advisory_xact_lock` waiter is a running statement. It fails at 30 s with SQLSTATE 57014 (`statement_timeout`). That contradicts the comment at `hours.ts:730-735` ("this publish waits for a running bulk child").
- **Root cause:** `pg_advisory_xact_lock` inside `begin()` was chosen to get release-on-disconnect. It ties lock lifetime to an idle-in-transaction session, and there is no explicit budget for the locked section.
- **Rejected fix: W4's original option (a).** W4 proposed session-level `pg_advisory_lock` with no surrounding transaction. **Do not implement it** (R2-V4, ledger):
  1. Today the 60 s idle-in-transaction kill is the _only_ dead-man bound on a frozen Vercel instance. A session lock on a plain idle session has no `idle_session_timeout`, so it would be held until Supavisor or TCP drops the connection. That is unbounded.
  2. If `DATABASE_SESSION_URL` is unset, `withSessionConnection` falls back to `DATABASE_URL` (`db.ts:66`). `startup.ts:41-46` only guards port 6543. Session locks on a transaction pooler are orphaned on whichever backend served them.
  3. The confirm paths read RLS-scoped rows on the lock connection under `set_config(…, true)` (`business-information.ts:217`, `industry-management.ts:69`). Without a transaction those reads lose their tenant context.
- **Recommendation.** Implement 1 and 2 together. Choose 3 or 4 as the follow-up.
  1. **Bound the locked section and size the transaction timeouts to it (S).** Add one helper, e.g. `withResourceXactLock(key, { mode: "wait" | "try", budgetMs }, fn)` in `db.ts`, that replaces the 13 inline patterns:
     - Compute `budgetMs = min(sum of per-call bounds, requestDeadline − now − 5 s)`. On routes the request deadline is `maxDuration`; in the jobs tick it is the tick deadline. Pass the remaining budget down so every Google call inside uses `min(per-call timeout, remaining)`. Without this, raising the DB timeout above `maxDuration` buys nothing, because the platform kills the function first.
     - First statement in the transaction: `SET LOCAL idle_in_transaction_session_timeout = '<budgetMs + 5000>ms'`. This keeps a dead-man for frozen instances, now matched to the real budget instead of a fixed 60 s.
     - For `mode: "wait"`, also `SET LOCAL statement_timeout` and `SET LOCAL lock_timeout` to the caller's own remaining budget. Map 55P03 and 57014 on the lock statement to a retryable `409 listing_busy` instead of a 500. For bulk children, prefer `pg_try_advisory_xact_lock` and reschedule.
     - Set both timeouts on the dedicated client too (`connection: { statement_timeout, idle_in_transaction_session_timeout }` in `withSessionConnection`), so the code no longer depends on the role script having been run.
  2. **Do not turn a lost lock-COMMIT into a 5xx (S).** The lock transaction writes no data. If `work()` resolved and only `COMMIT` fails, log `lock.commit_failed` with the key and return the result. The receipt is already durable. To do this, capture the result outside `begin()`, or use manual `BEGIN`/`COMMIT` on the dedicated client.
  3. **Split the read-check from the write (M).** Do the live read and the snapshot check without the lock. Take the lock only for validateOnly + PATCH + readback, and on entry compare a per-resource write generation (bumped by every locked write) with the one seen at read time. If it moved, re-read. Most of the Google time moves out of the locked window, while keeping the "a bulk child cannot write between read and PATCH" guarantee.
  4. **Table lease with expiry (M).** `resource_lease(organisation_id, lock_key, holder, expires_at)`: acquire with `insert … on conflict (organisation_id, lock_key) do update … where resource_lease.expires_at < now()`, through the _transaction_ pooler. Release by holder. Renew if work runs past half the lease. This removes the session-pooler slot (W4-02), self-heals after a kill, and works the same way in jobs and routes. The trade-off is that a crashed holder blocks the resource until `expires_at`, so size the lease to `budgetMs`.
- **Expected benefit:** a bounded lock lifetime, no 5xx for writes that succeeded, and waiters that fail fast with a retryable code instead of a 30 s 500. To size the problem, measure how often Google sequences exceed 45 s.
- **Complexity:** S (1 + 2), M (3 or 4). **Regression risk:** Medium. Lock semantics are subtle. Keep the try-versus-wait choice per site, and keep the `business_info` → `attributes` order at `business-information.ts:218-219`.
- **Tests:**
  - Integration test with a test-only `SET LOCAL idle_in_transaction_session_timeout = '1s'` and a 2 s `work()`: assert that the returned result is not a 5xx and that the receipt is `succeeded`.
  - Integration test that a waiter with a short budget gets `409 listing_busy`, not 57014.
  - Unit test that the helper issues both `SET LOCAL` statements first.
  - Keep the existing bulk/editor interleave tests.
- **Measure:** span duration of each locked section (`google.api.request` spans already exist); counts of SQLSTATE 25P03 and 57014 in Postgres logs; `pg_stat_activity` rows in `idle in transaction` on the session pooler.
- **Dependencies:** W4-02. A request-deadline primitive is shared with W3-4.

### W4-02 Session-pooler slot pressure

- **Priority:** P2 (was P1). **Status:** Partially confirmed (R2-V4).
- **Location:** `db.ts:62-75` (new client per call); `leases.ts:14-24` (9 lease keys); `google/connections.ts:394,436-473` (refresh waiter); `bulk-listing-runner.ts:398-401`.
- **Evidence:**
  - Each `withSessionConnection` call opens a fresh TCP+TLS client and holds one of 15 session-pooler slots.
  - Holders at one moment can be: up to 9 fleet leases; one per in-flight W4-01 write; two per bulk child, but only for `place-actions` (`family.accountLock` is true only at `bulk-families/place-actions.ts:54`, R2-V4 correction); and each token-refresh waiter. A waiter reconnects every 150 ms for up to 20 s, which is about 60–130 connect/close cycles (W8-15).
  - **Correction:** the runbook's `EMAXCONNSESSION` note (around line 1234) was about the _main pool_ running in session mode, not about lock connections. Exhaustion is unproven.
- **Recommendation:**
  - The refresh waiter re-reads the token row through the transaction pool and retries the lock at most every 1 s, or blocks on one connection with `lock_timeout`.
  - The place-actions child takes the account lock as a second key on the _same_ session connection.
  - The W4-01 lease option removes the per-write slot entirely.
  - Update runbook :1236. The session pooler now also serves the 13 write-lock sites.
- **Complexity:** M. **Regression risk:** Medium.
- **Tests:** a unit test that counts `withSessionConnection` calls during a 2 s refresh wait, and that one bulk child opens one session client.
- **Measure:** session-pooler client count over time (Supavisor metrics), on staging during a bulk run.

### Also noted (theme 1)

- **R2B-09 (P3, Confirmed lock sequence):** billing syncs and plan changes hold `FOR UPDATE` on `organisation_billing` across up to 3–4 Stripe calls (`process-events.ts:310-327`, `subscription-changes.ts:144-306`). `location_link_enforce_limit` locks the same row (`0110:96`, `0111:68`), so link inserts block and can hit the 30 s `statement_timeout`. Give every Stripe call the same options (8 s, no retries; `SYNC_REQUEST_OPTIONS`). Longer term, use an optimistic `version` check instead of holding the lock across HTTP.

---

## Theme 2: Sync write amplification and data integrity (W4-03 + W8-04)

These two findings share one code path, `upsertGoogleReview` (`lib/server/reviews.ts:155-389`), and must be fixed together. W4-03's unconditional rewrite is what makes W8-04 possible. A `content_hash` skip alone closes the common W8-04 case but not all of it (R2-V3).

### W4-03 Review sync rewrites every review on every reconcile

- **Priority:** P1. **Status:** Confirmed (R2-V4, R2-V3).
- **Location:** `reviews.ts:254-288` (upsert), `:302-327` (media), `:332-385` (reply), `:696-718` (page loop), `:713-720` (sweep `last_seen_at`); `google/reviews.ts:17-18` (page size 50); reconcile interval `reviews.ts:409`.
- **Evidence:**
  - `on conflict (organisation_id, google_review_name_hash) do update set …` has **no `WHERE`**.
  - It sets `raw_content_expires_at` (`now() + retention`). That column is in `raw_review_expiry_idx` and `review_unredacted_expiry_v2_idx`, so the update can never be HOT. About 9 of `review`'s 12 indexes get a new entry on every rewrite, including GIN `search_document`. The stored tsvector is recomputed too.
  - The `review_updated_at` and `review_workflow_transition` BEFORE UPDATE triggers fire on every row (`0001:490-492`).
  - For every review, media rows are deleted and re-inserted, and the reply is upserted or updated.
  - `content_hash` is written at `:222` and `:282` and never read.
  - Per location, every 15 minutes, page 1 (≤ 50 reviews) costs about 4–5 + M statements per review, so roughly 200–250 statements per page, almost all of them no-ops.
  - `set_config('app.provider_reconciliation', …)` runs once per review (`:199-201`) where once per transaction would do.
- **Root cause:** idempotent-by-overwrite upsert with no change detection.
- **Recommendation:** see the combined fix below.
- **Expected benefit:** most steady-state writes on the largest table go away (WAL, index churn, GIN pending list, dead tuples). Sync jobs get shorter, which raises the W8-01 ceiling, and new read indexes become cheaper to add (W4-06, W4-12). Measure `n_tup_upd`, `n_tup_hot_upd` and `n_dead_tup` on `review`, `review_media_item` and `review_reply`, and the reconcile job duration, before and after.
- **Complexity:** M. **Regression risk:** Medium. See the risk list below.

### W8-04 Sync can overwrite a just-published or in-flight reply

- **Priority:** P2 (was P1). **Status:** Confirmed (R2-V3). It self-heals at the next sync that sees the reply (≤ 15 min).
- **Location:** `reviews.ts:253-296` (no `WHERE`), `:375-383` (reply null-out), `:361-370` (reply overwrite); `publishing/intent.ts:302-322` (sets `accepted` before the PUT); `publishing/settle.ts:40-53` (never writes `current_body`); `0006_reply_lifecycle.sql:52-55` (the trigger allows `published → new` under `app.provider_reconciliation`).
- **Evidence (R2-V3 interleavings; T = start of a sync job):**
  - **Case A.** The sync reads Google (no reply yet). The publish intent commits (`accepted`, body B). The sync commits and blanks the reply (`current_body = null`, `deleted`). The settle then sets `published` with an empty body.
  - **Case B.** The settle commits first, then the stale sync commits. The workflow goes `published → new` and the review reappears in the needs-reply queue.
  - **Variant C.** The operator edits an existing reply. A stale payload carrying the old reply overwrites `current_body` with the old text, and the settle does not repair it.
  - There is no `FOR UPDATE`, no update-time comparison and no `publish_attempt` check. Under READ COMMITTED the `publish_status in (…)` predicate is re-evaluated on the new row version and still matches.
  - The window is the fetch-to-commit time of one page (about 0.5–3 s). It is longer if Google's list lags the PUT, which is a hypothesis.
- **Root cause:** ingest applies a snapshot read outside the transaction with no ordering against local writes made after the read.

### Combined fix for W4-03 and W8-04

1. **Skip on unchanged content.** Add to the review `DO UPDATE`:
   ```sql
   where review.content_hash is distinct from excluded.content_hash
      or review.provider_deleted_at is not null
      or review.raw_content_expires_at < now() + (<retention> - interval '1 day')
   ```
   The last disjunct refreshes the cache-expiry window at most daily. Because expiry runs from the last real write, this stays conservative against Google's caching rule. When the guard suppresses the update, `RETURNING` yields no row, so follow up with `select id, erased_at from review where organisation_id = $1 and google_review_name_hash = $2` (the unique index covers it), or use a `with up as (…) select … union all select …` form.
2. **Skip the dependants on unchanged content.** When the hash is unchanged, skip the media delete and re-insert and all reply writes. The hash already covers both. This alone closes Cases A and B in the common case: the settle never updates `review.content_hash`, so a stale "no reply" payload has the same hash as the pre-reply payload already stored (R2-V3).
3. **Guard reply and workflow writes when content did change**, for reviewer edits and Variant C:
   - Skip the reply null-out and the reply overwrite while an in-flight attempt exists: `and not exists (select 1 from publish_attempt pa where pa.review_reply_id = review_reply.id and pa.status in ('started','ambiguous','retryable'))`, plus `publish_status <> 'accepted'`. This is served by the existing `(review_reply_id, status)` index at `0035:56`. Confirm with the publishing owners whether the attempt status `accepted` also counts as in flight.
   - For the overwrite branch, apply only when `excluded.google_reply_updated_at >= review_reply.google_reply_updated_at`.
   - For the null-out branch (no update time on the payload), record `observedAt` = the time the Google list request started, and null out only when the local reply's last change is earlier than `observedAt`. `review_reply.updated_at` exists (`0001:262`); confirm a trigger maintains it on every update before relying on it.
   - Use the same predicate in the workflow `CASE`, so that `published → new` happens only when the stale-read guard passes.
4. **Make the settle self-healing.** `applyPublishedReply` also sets `current_body` from the provider body (or the attempt's `intended_body`).
5. **Housekeeping.** Move `set_config('app.provider_reconciliation')` to once per page transaction. Fold the sweep's `last_seen_at` update (`reviews.ts:713-720`) into the upsert (W4-16). Optionally, batch the page into one multi-row upsert (`insert … select * from unnest(…)`) after 1–4 are in and tested.

**Regression risks:**

- The erasure guard (`erased_at`) and the workflow reset must still fire when content changes. Both do, because a deleted reply changes the hash.
- **Retention redaction:** a redacted row keeps its hash, so re-ingest no longer repopulates it until the daily refresh disjunct fires. Decide explicitly whether that is wanted. It probably is.
- External reply deletes or edits made on Google during an in-flight attempt are deferred to the next sync. That is acceptable.

**Tests:**

- Unchanged payload: `xmin` of the review, media and reply rows is unchanged.
- Changed reply text: rewrites.
- Expiry within one day of its end: refreshes.
- Cases A, B and C as two-connection integration tests: start an intent, run the upsert with a payload that has no reply, then settle, in both orders. Assert body and workflow.
- Existing erasure and retention tests must still pass.

**Dependencies:** none. Land this before adding the W4-06 and W4-12 indexes.

---

## Theme 3: Indexes and query shape

### W4-04 `audit_log` read by subject with no subject index

- **Priority:** P1 for the timeline, P2 for the posts part. **Status:** Confirmed (R2-V4).
- **Location:** `lib/server/review-reads.ts:224-240` (timeline, on every review-detail open); `lib/server/posts.ts:739-760` (`local_edits` CTE, on every posts list). Existing indexes: `audit_log_tenant_time_idx (organisation_id, created_at desc)` (`0001:399`) and `unique (organisation_id, request_id, action, subject_type, subject_id)` (`0001:380`). `request_id` comes second in the unique index, so it cannot seek on subject.
- **Evidence:**
  - Timeline: RLS `organisation_id = …` and `subject_type = 'review' and subject_id = $id order by created_at desc limit 100`. The planner either walks the tenant/time index and filters, or scans the tenant's rows. Retention is up to `audit_retention_days`, default 365 (`0008:149`).
  - Posts: `organisation_id = $1 and subject_type = 'local_post' and action in ('post.draft.created','post.updated') group by subject_id`. This aggregates every post-edit row for the tenant, including for a single-post fetch, and the join key cannot be pushed into the grouped CTE.
- **Recommendation:**
  ```sql
  -- migrate:no-transaction
  create index concurrently if not exists audit_log_subject_idx
    on audit_log (organisation_id, subject_type, subject_id, created_at desc)
    include (action);
  ```
  - The timeline becomes a seek plus an ordered `LIMIT`.
  - For posts, the index bounds the scan to the tenant's `local_post` rows. Because `audit_log` is append-only (`0001:428,500`) the visibility map stays all-visible, so this can be an index-only GroupAggregate. To probe only the listed posts, rewrite `local_edits` as `left join lateral (select max(created_at) from audit_log where organisation_id = $1 and subject_type = 'local_post' and subject_id = p.id::text and action in (…))`.
  - Alternative for posts: persist `content_edited_at` on `gbp_local_post` next to the existing `content_edited_by` (`0081`) and drop the audit dependency.
- **Expected benefit:** both reads are bounded by the subject's own history, not the tenant's. Confirm with `EXPLAIN (ANALYZE, BUFFERS)` of both queries for the largest tenant on staging.
- **Complexity:** S. **Regression risk:** Low. Write cost: one extra btree entry per audit insert, on an insert-only table.
- **Tests:** timeline ordering test; posts `sort_at` test.
- **Dependencies:** W4-13 (first `no-transaction` migration).

### W4-05 / W0-05 / W3-05 / W8-13 `app_session` is written on every authenticated request

- **Priority:** P2. **Status:** Confirmed (R2-V1).
- **Location:** `lib/server/session.ts:128-239`; the write is at `:217-229`.
- **Evidence:**
  - Each lookup runs one transaction of about 8 round trips: `begin`, `set_config`, identity select, `set_config`, the session select with the `scopeFingerprint` subquery, `update app_session set last_seen_at = now(), expires_at = least(…)`, the billing read, `commit`.
  - `expires_at` is indexed (`0001:395`), so every update is non-HOT.
  - `React.cache` dedupes only within one RSC render.
  - Each open tab has six 60 s polls and a 5 s settling poll (W8-12), and each one writes the row. Parallel requests from one page serialise on that row lock.
- **Recommendation:**
  - `… where id = $1 and last_seen_at < now() - interval '5 minutes'`. The idle window is in days (`SESSION_IDLE_DAYS`), so the slide precision does not matter.
  - Optionally fold the identity and session selects into one statement and pipeline the `set_config`.
  - Add an OTel span around `lookupSession`.
- **Expected benefit:** at most one session write per 5 minutes per session instead of one per request. Measure `n_tup_upd` on `app_session` and the `lookupSession` span p50.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** two lookups within 5 minutes leave `expires_at` unchanged; a lookup after 5 minutes slides it.

### W4-06 Counts and analytics recompute full-tenant aggregates

- **Priority:** P2. **Status:** Confirmed (R2-V4).
- **Location:** `lib/server/review-counts.ts:73-111` (up to 3 aggregates: a `count(*)` with 8 `filter`s, a status `group by` and an optional client `group by`); callers `app/(dashboard)/layout.tsx:66-77`, `use-needs-reply-count.ts:25` (60 s poll) and `/api/reviews/counts`. `lib/server/analytics-overview.ts:115-128,259-305` filters `create_time`, which no index has. `review-queues.ts:62-68` adds a correlated `review_reply` subquery per row.
- **Recommendation:**
  - Serve the poll with `Cache-Control: private, max-age=30` or a short per-org memo, and skip the layout recompute when the client already has fresh data.
  - **After W4-03 lands**, add `(organisation_id, create_time) where provider_deleted_at is null` for analytics.
  - Fold the two `loadProviderTotals` scalar subqueries into one pass.
  - Trigger-maintained counts only if measurement demands them. Two queues depend on the viewer, so they are complex.
- **Complexity:** S (cache) / M (index). **Regression risk:** Low (badge freshness).
- **Measure:** `pg_stat_statements` mean time for the counts query, by tenant size.

### W4-07 Search is a non-inlinable definer function over a fleet-wide GIN index

- **Priority:** P2. **Status:** Confirmed (R2-V4).
- **Location:** `0011_tenant_review_search.sql:3-30` (`language plpgsql … security definer`, `RETURN QUERY`); GIN at `0010:14` (no tenant column); caller `reviews-query.ts:134-146`.
- **Evidence:**
  - PL/pgSQL is never inlined, so the planner sees a function scan estimated at 1,000 rows, materialises every match and cannot stop early for the outer `LIMIT`.
  - Common terms return posting lists for every tenant, which are then rechecked against `organisation_id`.
  - Isolation depends on the explicit check at lines 14-19, which is correct today.
- **Recommendation:**
  - Inline the predicate in `buildInboxQuery`. The runtime role already has `select (search_document)` (`0010:18`). Drop the definer function, or replace it with a `language sql stable`, non-definer helper.
  - For tenant-scoped GIN, enable `btree_gin` and index `(organisation_id, search_document)`. Only do this after measurement, because it adds a second GIN index to the most-written table.
  - Product side: `websearch_to_tsquery('simple')` has no prefix matching.
- **Complexity:** M. **Regression risk:** Medium. Keep the cross-tenant search test.
- **Measure:** `EXPLAIN (ANALYZE, BUFFERS)` with a common word on staging; GIN `idx_tup_read`.

### W4-08 FK cascade paths have no leading index

- **Priority:** P2. **Status:** Confirmed (R2-V4).
- **Location:** `draft_review_idx (organisation_id, review_id, created_at desc)` (`0001:397`) and `review_reply unique (organisation_id, review_id)` (`0001:263`) both lead with `organisation_id`. `approval_decision.review_id`, `approval_decision.draft_id`, `publish_attempt.draft_id`, `review_reply.pending_draft_id` (`0039`) and `publish_attempt_event.publish_attempt_id` have no leading index. `review_media_item` was fixed in `0099`. Delete path: `retention/purge.ts:478-500`. PostgreSQL 17 has no skip scan (`supabase/config.toml:16`).
- **Evidence:** RI triggers run `delete from draft where review_id = $1` with no org predicate and without RLS. A `disconnectedReviews` batch of 500 reviews fans out to drafts, replies, decisions, attempts and events, which can mean per-row full scans of each child table.
- **Recommendation:** add `review_id`-leading indexes on `draft`, `review_reply` and `approval_decision`; `publish_attempt_event (publish_attempt_id)`; and partial `where … is not null` indexes for the three `set null` draft references. Skip `legal_hold` and `webhook_route` (tiny), but note R2B-01 changes the `legal_hold` FK anyway.
- **Expected benefit:** retention and disconnect purges stay linear in the rows deleted. This also helps R2B-12. Measure `seq_scan` on `draft` and `review_reply`, and the RI trigger times in `EXPLAIN ANALYZE delete from review where id in (…)` on staging.
- **Complexity:** S. **Regression risk:** Low.

### W4-09 Performance metrics persisted one statement per point

- **Priority:** P2. **Status:** Confirmed (R2-V4).
- **Location:** `lib/server/performance.ts:192-223`; constants `:30-31` (`METRIC_MONTHS = 18`, `RESTATEMENT_DAYS = 10`); 11 metrics (`google-contract.ts:34-46`).
- **Evidence:** about 6,028 sequential `insert … on conflict do update` statements in one transaction on a location's first sync, and 110 per location every 6 h. The update is unconditional.
- **Recommendation:** one multi-row upsert per chunk of about 1,000 rows (`insert … select * from unnest($1::text[], $2::date[], $3::bigint[])`), with `where performance_metric_daily.value is distinct from excluded.value`. Apply the same pattern to `keywords.ts`, `posts.ts:528-539` and the discovery upserts (W3-1).
- **Expected benefit:** statements per first sync drop from about 6,028 to about 7, and the transaction gets shorter. Measure `pg_stat_statements` calls and the span duration.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** a no-op resync writes 0 rows.

### W7-5 / W4-13 Migration safety

- **Priority:** P2 (ledger, W7-5). **Status:** Plausible (W4-13 confirmed the mechanics).
- **Evidence:**
  - `scripts/db-migrate.mjs` wraps every file in `begin` unless it has `-- migrate:no-transaction`, which no migration uses yet. Support exists at `migration-rules.mjs:4,229-231`.
  - `set local lock_timeout` appears only in `0105`–`0115`.
  - `0099` and `0100` already say "apply in a low-traffic window".
  - Migration `0126` broke the expand/contract rule.
- **Recommendation:**
  - The runner issues `SET lock_timeout = '5s'` before each file, overridable per file.
  - Every index on `review`, `audit_log`, `sync_checkpoint`, `draft` or `review_reply` uses `-- migrate:no-transaction` and `create index concurrently if not exists`, one index per file.
  - Add a migration-policy rule that rejects plain `create index … on review|audit_log` in new files.
  - On failure, drop the `INVALID` index before retrying.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** a rule case in `tests/migration-contract.test.ts`.

### Also noted (theme 3, _raw, not re-verified_)

- **W4-10 (P2):** `app/(dashboard)/layout.tsx:61-77` runs 5 concurrent tenant transactions, and its comment assumes a pool of 10. Production runs `DATABASE_POOL_MAX=5` (runbook around line 1269). Merge the four short reads into one `withTenant`, and add a pool-wait histogram around `getDatabase().begin`.
- **W4-11 (P2):** `processed_webhook_event` rows are kept for ever (`inventory.ts:155-164`). `operations/health` counts them per organisation with no usable index, so the cost is O(orgs × events). Add retention of `processed`/`ignored` rows older than 7 days, and compute the health counts in one grouped pass, or add `(organisation_id) where status = 'dead'`.
- **W4-12 (P2):** rating sorts (`reviews-query.ts:53-84`) have no index and use an `OR`-chain cursor. `star_rating` is `NOT NULL`, so drop `nulls last` and use row comparisons. Add `(organisation_id, star_rating, update_time desc, id desc)` only if `EXPLAIN` shows the sort dominating, and only after W4-03.
- **W4-14 (P3, hypothesis):** indexes that look unused and cost writes: `raw_review_expiry_idx`, `sync_retry_idx`, `webhook_job_due_idx`, `publish_attempt_job_due_idx`, `performance_checkpoint_due_idx`, `keyword_checkpoint_due_idx` and `webhook_backlog_idx`. Drop them only after `pg_stat_user_indexes.idx_scan = 0` over a full stats period, using `drop index concurrently`. Dropping `raw_review_expiry_idx` does not make the review upsert HOT, because the v2 expiry index remains.
- **W4-15 (P3):** the location summary "latest attempt" query (`location-summary.ts:483-507`) unions 7 attempt tables and sorts. `profile_sync_attempt` is filtered on `location_id`, but its index leads with `external_location_id` (`0016:106`). Use a lateral `limit 1` per table, and add `(organisation_id, location_id, created_at desc)`.
- **W4-16 (P3):** `withTenant` costs about 4 round trips; pipeline `set_config` with the first statement. `notifications/evaluate.ts:529-552` digests are N+1. `take_google_rate_budget` serialises on one hot row (watch `n_dead_tup`).
- **R2B-11 (P3, Confirmed):** the stale-reservation reaper (`0059:59-73`) runs `where status = 'reserved' and created_at < …` every minute with no usable index. See the change list.

---

## Theme 4: API layer

### W3-2 Editor GETs read Google live on every open

- **Priority:** P1. **Status:** Confirmed (R2-V2). Includes W0-04 and W8-14.
- **Location:**
  - Hours: `lib/server/hours.ts:98,132,153,186,213,266` (`readLiveHours` / `getHoursState`).
  - Profile: `profile.ts:201,242-261`.
  - Posts: `posts.ts:688-711` (`reconcileLocalPosts` on every first page; up to 100 Google pages, `:172-191`).
  - Place actions: `place-actions.ts:109-117`.
  - Food menus: `food-menus.ts:222`.
  - The model to follow: `media.ts:318-328` (`shouldSyncMediaCache`; 5-minute TTL at `:190-191`; `refresh=1` bypass).
- **Evidence:**
  - An hours GET runs a linked-location transaction, a token read, 1–2 Google calls, `ensureCanonicalResource`, an **observation insert** and a latest-attempt read: 4 tenant transactions and a write per read.
  - Profile likewise writes observed fields and an observation (W0-04). A save-and-publish reads Google at least 4 times.
  - Client defaults (`query-client.ts:7-9`: `staleTime 30 s`, `refetchOnWindowFocus`) repeat all of this on every refocus after 30 s.
  - The 15-minute presence-resources cron already reconciles the same resources and records `presence_resource_reconcile_state.last_succeeded_at`.
- **Root cause:** live reads were a deliberate choice for the editors (`prefetch.ts:319-326`). No freshness contract was added when the sweep landed.
- **Recommendation:** model each resource on `media.ts`:
  - `shouldReadLive({ refresh, observedAt, ttlMs })` returns true only when there is no observation, the observation is older than T (start with 2–5 minutes; make it per-resource config), or the request carries `refresh=1`.
  - Otherwise serve the canonical and observed rows from one `withTenant` that merges the three post-Google transactions (W3-06). Return `observedAt` so the UI can show "as of" and offer **Refresh from Google**.
  - Publish preflights, readbacks and the drift "Load theirs" path keep forcing a live read.
  - Write an observation only when the observed payload hash changes.
  - Client-only stop-gap: per-resource `staleTime` of a few minutes and `refetchOnWindowFocus: false`. Cheaper, but the server stays unguarded.
- **Expected benefit:** Google read volume follows edits and the cron instead of focus events. GET latency is no longer bound by Google, and the observation table stops growing on every read. Measure `nabapresence.google.request.count` by `http.route` (the attribute needs adding to the span at `transport.ts:351-360`).
- **Complexity:** M per resource. **Regression risk:** Medium (the drift UX).
- **Tests:**
  - Service test: no `googleRequest` within T of a prior observation.
  - `refresh=1` bypasses the gate.
  - The drift-banner E2E still passes.
- **Dependencies:** W1 query defaults; W8-06 budget fairness.

### W3-3 Server-side `ZodError`s become unlogged client 400s

- **Priority:** P1. **Status:** Confirmed (R2-V2).
- **Location:** `lib/server/http.ts:139-150` (the `ZodError` branch returns `400 invalid_request` with `details: error.issues` and no log; only unknown errors log at `:151`); `lib/server/route.ts:385-399`.
- **Evidence:**
  - 89 `Schema.parse(` in `lib/server` and 33 in `app/api`.
  - **Correction (R2-V2):** not all of these are invariants. Some are deliberate in-handler input parses (`sync/backfill/route.ts:104`).
  - Most parse provider or stored data: `google/locations.ts:298` (Google response), `password-auth.ts:145,215,314,559,604,622` (auth-provider payloads), `publication-schedules.ts:212,238` (DB rows).
  - Provider contract drift therefore shows up as a silent "fix your input" 400 that is invisible to 5xx alerting, and it echoes internal paths in `details`.
- **Recommendation:**
  - In `route()`, catch the params, query and body parse failures and convert them to `ApiError(400, "invalid_request", { fieldErrors })` at that point.
  - In `mapError`, treat any remaining `ZodError` as `500 internal_error` and log `api.contract_violation` with the issue paths only (no values).
  - Add `parseProvider(schema, value)`, which throws `502 google_invalid_response`.
  - Convert the deliberate in-handler input parses to `ApiError(400)` explicitly.
- **Complexity:** S. **Regression risk:** Low–medium (tests that expect 400 from handler-internal parses).
- **Tests:** a handler `ZodError` gives 500 and `log.error`; an input schema failure gives 400 with `fieldErrors` and no `issues` echo.

### W3-4 / R2B-05 Request work outruns `maxDuration`; AI credit charged with no draft

- **Priority:** P1. **Status:** Confirmed (R2-V2, R2-W0b).
- **Location and evidence:**
  - **a) Backfill.** `sync/backfill/route.ts:127-138` handles up to 50 locations × 20 pages, sequentially, under `maxDuration = 60`, and passes no `deadline`, although `syncLinkedLocation` accepts one (`reviews.ts:455-456`). When killed, there is no completion audit and the checkpoint stays `running` until its 15-minute lease is reclaimed.
  - **b) Bulk approve without the bulk engine.** `reviews/bulk/route.ts:103-113`: up to 100 serial `approveRow` → `completeApproval` publishes under `maxDuration = 120`, with no budget check.
  - **c) Sweep.** `reviews.ts:780-784` checks the deadline only between pages, so the first page of each remaining location always runs.
  - **d) AI draft.** `review-drafts.ts`: reserve (`:286`), generate (`:347`), **settle the charge (`:369-376`)**, verify (`:387`), insert the draft (`:417-438`). Each OpenAI call is bounded only by `OPENAI_TIMEOUT_MS` (default 30 s, max 55 s; `env.ts:241-246`) under `maxDuration = 60`. A kill during verify leaves the customer **charged with no draft**. A retry gets `generation_in_progress` for 120 s, then `409 generation_not_repeatable`. There is no refund path. The charge-first ordering (`:367-368`) is deliberate but does not cover the timeout case.
- **Root cause:** budgets are per-call timeouts, not request deadlines.
- **Recommendation:**
  - Add a request-deadline primitive: `ctx.deadline` from `route()` = start + `maxDuration` − 5 s. Share it with W4-01.
  - **d) First.** Size verification to `min(OPENAI_TIMEOUT_MS, deadline − now − margin)` and skip it (draft stored as `pending`/`unavailable`) when under about 10 s remain. Alternatively, settle the credit in the phase-three transaction that inserts the draft, and release it if phase three never runs. Add a CI assertion that `2 × OPENAI_TIMEOUT_MS + margin ≤ maxDuration` or that the deadline logic exists.
  - **a)** Enqueue: upsert `sync_checkpoint` rows as `pending`, return 202 with `backfillProgress`, and let the runner drain them. Use the same call from the OAuth callback instead of `after()`. If it must stay inline, pass the deadline and stop the location loop at it.
  - **b)** Route approve batches above a small cap (e.g. 10) to the bulk engine, or turn `bulk_actions` on for approve.
  - **c)** Check the deadline before starting each location.
- **Expected benefit:** no platform kills mid-work, truthful audits, and no charge without a draft. Measure the count of `generation_not_repeatable` after a settled charge (should be 0) and function timeouts by route.
- **Complexity:** d) S, c) S, b) S–M, a) M. **Regression risk:** Low, except a), which changes the backfill UI to polling.
- **Tests:**
  - Fake-timer draft test: verification is skipped when time is short, the draft is stored and charged once.
  - Sweep with a past deadline and N locations: zero Google calls.
  - Backfill route: no Google call in-request.

### W3-1 Discovery GETs page all of Google and upsert row by row

- **Priority:** P2 (was P1). **Status:** Partially confirmed (R2-V2). The mechanics are exact, but the realistic frequency is low: owner/admin screens only (connections, setup).
- **Location:** `app/api/google/accounts/route.ts:73-155`; `app/api/google/locations/route.ts:47-257`; hooks `use-google-accounts.ts:18-21`, `use-google-locations.ts:10-14`.
- **Evidence:** each GET pages every account (or every location of every account, serially), then runs one `insert … on conflict do update` per row in one transaction. Neither route has `maxDuration` or `limits`. The global hook defaults refetch on focus after 30 s and retry once.
- **Recommendation:**
  - Hooks: `staleTime: Infinity`, `refetchOnWindowFocus: false`, `retry: 0`, plus an explicit **Rediscover** action.
  - Server: gate the Google paging on a `last_discovered_at` column (the media pattern), batch the upserts per page, and add `maxDuration` and a `sync_manual` limit.
  - Extract `lib/server/google/discovery.ts` so the route, automatic setup and onboarding share one connection-reassignment rule. Today they diverge (W3-08).
- **Complexity:** M. **Regression risk:** Medium (the post-OAuth setup flow needs fresh rows; trigger discovery on callback).

### W3-07 Abuse limits and Google budget fairness _(raw, not re-verified)_

- **Priority:** P2. **Status:** Confirmed (W3, coverage).
- **Evidence:**
  - `limits:` is used by 8 of 159 routes.
  - No limit on: `POST /api/drafts/[id]/verify` (OpenAI), `sync/backfill`, the session paths of `sync/{sweep,reconcile,performance,keywords}`, `google/{accounts,locations}`, `import-review/refresh`, `listings/bulk/preview`, `privacy/export` and `reviews/bulk`.
  - The Google budget is one bucket per API host (`rate-budget.ts:84-107`), shared by every tenant and by background and interactive traffic alike.
- **Recommendation:**
  - Add `sync_manual` (per org) and `ai_verify` (per user and org) scopes.
  - Use a per-org try-lock for manual syncs, returning 409 `sync_in_progress` (pairs with W8-08).
  - Budget fairness is covered under W8-06.
- **Complexity:** S (scopes). **Regression risk:** Low.
- **Tests:** 429 with `Retry-After` on each new scope.

### Also noted (theme 4, _raw, not re-verified_)

- **W3-06 (P2):** `getHoursState` runs three back-to-back no-I/O transactions. Merge them. Memoise `connectionAccessToken` per connection for the life of one request (`AsyncLocalStorage` or a passed `Map`).
- **W3-09 (P2):** `request.signal` is never used, and `transport.ts:378-388` overrides any caller signal. Expose `ctx.signal` and combine signals **for safe-mode calls only**. Never abort a mutation. Check `signal.aborted` between pages.
- **W3-11 (P3):** malformed JSON bodies are parsed as `{}` (`route.ts:325-340`). Return `400 invalid_json` for a non-empty body that fails to parse.
- **W3-12 (P3):** tick budgets are read from raw `process.env`. Move them into `env.ts` with `.max(55_000)`, and reject `GOOGLE_API_PROXY_BASE`/`STRIPE_API_PROXY_BASE` in production.
- **W3-13 (P3):** 42 provider-reaching routes have no `maxDuration`. Add a test that enforces it.
- **W3-14 (P3):** upstream Google 5xx passes through as our own 5xx. Map it to `502 google_unavailable` with `details.providerStatus`, and forward OpenAI `retry-after`.
- **W6-08 (P3):** Pub/Sub JWT failures return 500 (`pubsub.ts:55-58`); return 401. Accept the token in the header only. Cap the email webhook body size.

---

## Theme 5: Jobs and scalability

### W8-01 One locked tick per minute caps all recurring work

- **Priority:** P1. **Status:** Confirmed as an upper bound (R2-V3).
- **Location:** `app/api/jobs/run/route.ts:10-14` (fleet lock `naba:jobs`); `lib/server/jobs.ts:51-56,1079,1111-1121`; `env.ts:294-296`.
- **Arithmetic (from code constants):**

  | Quantity                         | Value                                            | Source                        |
  | -------------------------------- | ------------------------------------------------ | ----------------------------- |
  | Tick budget                      | 45 s inside `maxDuration` 60                     | `route.ts:13`                 |
  | Workers                          | `JOBS_CONCURRENCY` = 4                           | `env.ts:294`                  |
  | Worker-seconds per tick          | 4 × 45 = **180**                                 |                               |
  | With the billing slice           | 4 × (45 − 11.25) = **135**                       | `jobs.ts:1079`                |
  | Per 15-minute reconcile slot     | 15 × 180 = **2,700** worker-s                    |                               |
  | Locations at 15-minute freshness | **L_max ≈ 2,700 / T_r**                          | T_r = mean reconcile job time |
  | Google v4 bucket                 | 240/min, so 40 per 10 s window; 3,600 per 15 min | `rate-budget.ts`              |

  This is an upper bound. Each batch waits for its slowest item (`jobs.ts:1111-1121`), and the performance (6 h), keyword (24 h) and sweep herds share the same capacity. W4-03 inflates T_r: one 50-review page is about 4 statements × 50. The `vercel.json` page sizes on the enqueue routes are validation-only (W8-17).

- **Root cause:** the `naba:jobs` lock is now an optimisation; row leases with `FOR UPDATE SKIP LOCKED` (`0092:203-324`) already make concurrent claims safe. Even so, capacity is fixed at one tick, whatever the number of instances.
- **Recommendation:**
  1. Measure T_r per kind first: add a `jobs.item.duration{kind}` histogram and gauges for due backlog and oldest-due age per kind.
  2. Land W4-03, which lowers T_r.
  3. Allow K parallel ticks: K lock slots (`naba:jobs:0..K-1`, take the first free one), or drop the lock and rely on row leases. Tune `JOBS_CONCURRENCY × K` against `DATABASE_POOL_MAX` (5 in production) and the pooler's connection limit.
  4. Optionally add a second cron lane for user-facing kinds (pairs with W8-03).
- **Expected benefit:** throughput scales roughly linearly with K until the v4 Google bucket binds (about 3,000 calls per 15 minutes).
- **Complexity:** M. **Regression risk:** Medium (lease expiry versus longer runs; the `ops-liveness.ts` heartbeat semantics).
- **Tests:** two concurrent `runDueJobs` calls claim disjoint sets; liveness when one slot skips.

### W8-02 / W0-01 Scheduled posts and bulk children get only the leftover budget

- **Priority:** P1 (latent) / P2 today. **Status:** Confirmed (R2-V1, R2-V3).
- **Location:** `jobs.ts:1047,1111-1141`; `publication-schedule-runner.ts:936-947`; `bulk-listing-runner.ts:643-649`; `0117:66-71` (window = `intended_at + 5 min`), `0118:210` (claim needs `intended_at <= now() < deadline_at`), `0119:43` (missed when `deadline_at <= now()`).
- **Evidence:**
  - The main loop claims while `now + GOOGLE_TIMEOUT_MS (15 s) <= deadline`. The post-loop runners then need at least 15 s left.
  - The only reserved slice is billing (`jobs.ts:738,1079`).
  - A backlog that outlasts 5 ticks turns every post due in that period into "missed". That needs L × T_r ≳ 900 s, e.g. 450 or more locations at 2 s each.
- **Recommendation:**
  - Run time-windowed user-intent work **first** with a reserved slice: scheduled posts, then bulk, each with ≤ 10 s, mirroring billing.
  - Or fold both into `claim_due_jobs` as kinds with top priority (W8-03).
  - Wrap each post-loop runner in its own `.catch` (see W8-09).
- **Complexity:** S (reorder plus slice) / M (unified claim). **Regression risk:** Low–medium.
- **Tests:** a stubbed claim that never empties; assert `runDueSchedules` gets at least its reserved budget.

### W8-03 No per-kind priority in `claim_due_jobs`; recurring work arrives in herds

- **Priority:** P2. **Status:** Confirmed (R2-V3).
- **Location:** `0092_mutation_recovery_jobs.sql:182-195` (the `candidate` CTE: `row_number() over (partition by organisation_id order by due_at, id) <= p_per_org`, then `order by due_at, id limit p_limit`); `0048:43-63,68-105` (armed at `now()`, kept on the grid); `reviews.ts:874`.
- **Evidence:**
  - Every reconcile checkpoint in the fleet comes due at the same instant every 15 minutes.
  - The first publish is inline in the request (`publish.ts:166`), so only async `retry`/`recover`/`mutation_recover` work waits. That work waits about L·T_r/4 s behind a herd.
- **Recommendation:**
  - Add a computed `priority` to the candidate rows: `retry`/`recover`/`mutation_recover`/`webhook` = 0, one-off checkpoint = 1, recurring = 2. Order by `(priority, due_at, id)` both inside the partition and outside it.
  - De-phase recurring arming: offset first arming by a stable hash of the location id modulo the interval, so `next_scheduled_run` keeps each location on its own phase.
  - Recurring starvation stays bounded because the priority-0 kinds are low volume.
- **Complexity:** S–M (one `create or replace function` migration). **Regression risk:** Medium (fairness).
- **Tests:** a DB test with 100 due recurring rows and 1 retry due later; the retry is in the first claim. Newly armed checkpoints spread across the interval.
- **Measure:** oldest-due age per kind.

### W8-05 Fleet session locks have no expiry

- **Priority:** P2. **Status:** Partially confirmed (R2-V3).
- **Location:** `lib/server/leases.ts:153-189`; `db.ts:62-75`.
- **Evidence:**
  - `pg_try_advisory_lock` on a bare `max: 1` session-pooler client, with no `idle_session_timeout` or keepalive.
  - The session is idle (not in a transaction) while the work runs on the pool, so the role's 60 s idle-in-transaction limit does not apply.
  - Whether a killed or frozen invocation strands the lock depends on the platform (hypothesis).
  - **Correction (R2-V3):** passing the tick deadline into performance and keyword jobs would do nothing. They run with `maxLocations: 1` (`jobs.ts:921-935`) and always attempt the first location. The real overrun is that `runPool` starts any item while `now < deadline` (`jobs.ts:278`), with no bound on how long the item runs.
- **Recommendation:**
  - Set `idle_session_timeout` on the lease connection to about 90 s (above `maxDuration`) through postgres.js `connection` options, so the server kills a stranded holder.
  - Or move fleet leases to a lease row: `update ops_lease set holder = $id, expires_at = now() + interval '90 seconds' where name = $k and (expires_at < now() or holder is null)`. This shares the W4-01 option 4 table design.
  - In `runPool`, do not start an item unless `now + expectedItemBound <= deadline`.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** the helper sets the timeout; a killed holder's lock is free after it.
- **Measure:** `consecutive_skips` per lease key.

### W8-08 "Sync now" takes the fleet-wide reconcile lock

- **Priority:** P2. **Status:** Confirmed (R2-V3).
- **Location:** `app/api/sync/reconcile/route.ts:262-266` (fixed key `naba:reconcile`), `:232-241` (no truncation flag); `reviews.ts:491-501` (unconditional `status = 'running'`).
- **Evidence:**
  - One tenant's Sync now blocks every other tenant's for up to 45 s, and they are told "A sync is already running".
  - It does not exclude the runner's reconcile jobs, so both paths can sync one checkpoint concurrently.
  - A truncated walk toasts "Up to date".
- **Recommendation:**
  - Per-org key `naba:reconcile:<orgId>`, or no lock.
  - Make the checkpoint claim conditional: `… where status <> 'running' or lease_expires_at < now()`.
  - Return `truncated` and `remainingLocations`.
- **Complexity:** S–M. **Regression risk:** Low.
- **Tests:** two orgs sync concurrently and both succeed; an exhausted budget returns `truncated: true`.

### W8-09 Bulk runner runs a whole claimed batch at once

- **Priority:** P2. **Status:** Confirmed (R2-V3).
- **Location:** `bulk-listing-runner.ts:650-685`; `jobs.ts:1129-1133`.
- **Evidence:**
  - `Promise.all` over up to 25 claimed children (per-org cap 2), against a pool of 5–10, with no deadline check inside the batch.
  - The owner lookup sits outside the `try` (`:675-683`). If it rejects, `Promise.all` rejects while siblings are still writing. `runDueJobs` does not catch that, so the tick returns 500, `naba:jobs` is released mid-write, and the privacy erasure and invitation runners are skipped for that tick.
- **Recommendation:**
  - Reuse `runPool` with `JOBS_CONCURRENCY` and the deadline.
  - Move the owner lookup inside the `try`.
  - Wrap each post-loop runner in `jobs.ts` in its own `.catch`, as billing already is.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** one child's owner lookup throws; the siblings settle, the tick returns, and `runDuePrivacyWithdrawals` still runs.

### Also noted (theme 5, _raw, not re-verified_)

- **W8-06 (P2, Plausible):** interactive reply PUTs share the v4 bucket with sync herds. Pass a `priority` to `acquireGoogleBudget`: background callers get about 75 % of window capacity, interactive calls get the full window.
- **W8-10 (P2, Plausible):** the fleet budget fails open after a 2 s DB timeout (`rate-budget.ts:33,147-165`), which happens exactly when the pool is saturated. Fail closed for background callers (retryable `google_rate_limited`), and stay fail-open only for interactive calls.
- **W8-07 (P2):** the presence-resources cursor advances before an organisation finishes (`presence-resources/route.ts:246`), so the rest of a half-walked organisation is skipped until the walk wraps. Mirror reconcile (`reconcile/route.ts:222-229`). Longer term, make presence resources a per-location recurring job kind.
- **W8-15 (P2):** covered under W4-02.
- **W8-16 (P3):** a full batch claimed near the deadline strands leases for 105 s. Size the claim to the remaining time, and release unstarted items.
- **W8-17 (P3):** cron query parameters on the enqueue routes are validation-only; the docs say 8 crons where `vercel.json` has 9.
- **W8-18 (P3):** the pause snapshot is fixed for a whole tick (up to about 50 s stop latency). Re-read it before each claim.
- **W8-19 (P3):** webhook retries back off 0.5–8 s × 5, so an outage of a few minutes dead-letters them. Use the checkpoint curve.
- **W8-20 (P3):** health tick coverage is random. Use `followCronCursor`.
- **W0-02 (P1 in W0, not in ledger P1 list):** the Vercel GET path enqueues, while `scripts/scheduler.mjs` POSTs and walks inline. Running both doubles the work. Converge on enqueue (decision D-42).

---

## Theme 6: Billing, credits and retention integrity

The billing design is sound (R2-W0b):

- Receipts are idempotent on `unique (provider, external_event_id)` (`0112:74`).
- The processor re-fetches provider state under `FOR UPDATE`, so duplicate and out-of-order events converge.
- Credit grants are idempotent on `(organisation_id, kind, source_ref)` (`0107:182`).
- Credits are integers end to end.

The gaps are at the edges.

### R2B-01 Legal holds are enforced only in app queries, and the FK cascades holds away

- **Priority:** P2. **Status:** Confirmed for the FK (`0001:303`, coordinator). The races are Plausible (PostgreSQL semantics, not reproduced).
- **Location:** `app/api/legal-holds/route.ts:47-79`; `retention/purge.ts:118-150,437-460,484-488`; `app/api/privacy/requests/route.ts:252-271`; `legal_hold.review_id references review(id) on delete cascade`. No other migration touches `legal_hold`.
- **Evidence:**
  - Every hold check is a `not exists (…)` against the statement snapshot, re-implemented in at least five places.
  - **Redaction race:** the purge UPDATE takes `FOR NO KEY UPDATE`, which does not conflict with the hold insert's `FOR KEY SHARE`. A hold that commits after the purge snapshot is ignored.
  - **Delete race:** the disconnected-review DELETE waits on the hold's KEY SHARE lock, then proceeds without re-checking. The ON DELETE CASCADE then **deletes the newly committed hold**. The owner got a 201 and an audit row, and neither the hold nor the review exists.
  - **Erasure:** the PATCH has the same pattern.
- **Recommendation (one migration):**
  - Add a `BEFORE UPDATE OF review_text, reviewer_display_name, reviewer_profile_photo_url, raw_payload OR DELETE ON review` trigger that checks for an active `legal_hold`. In READ COMMITTED, queries inside a trigger see a fresh snapshot. Under `app.retention_run` it returns NULL to skip the row; otherwise it raises.
  - Change the FK to `ON DELETE RESTRICT`.
  - In the hold POST, select the review `FOR NO KEY UPDATE`.
  - Separately, `notHeldReview` casts `h.review_id::text`, which defeats any index. Compare uuids.
- **Complexity:** M. **Regression risk:** Medium. RESTRICT changes the disconnected-location cascade order, though held locations are already excluded.
- **Tests:** two-connection integration tests (hold commits mid-purge; hold versus erasure): the review text is kept and the hold row exists. Map purge counts for skipped rows.
- **Write cost:** the trigger fires on every `review` update, including sync. It is cheap with `UPDATE OF` column targeting, and W4-03's skip removes most updates anyway.

### R2B-02 Erasure by display name is a blind multi-match

- **Priority:** P2. **Status:** Plausible (ledger). The code path was confirmed by R2-W0b.
- **Location:** `app/api/privacy/requests/route.ts:239-251,271`; `privacy/fulfil.ts:252-324`; `lib/contracts/privacy.ts:44` (min 3 characters).
- **Evidence:** `lower(reviewer_display_name) = lower(subjectReference)` across the whole organisation erases every match in one transaction, and `withdrawReplies` deletes the owner's live Google reply on each. Nothing previews the matches.
- **Recommendation:** add a dry-run (`?preview`) that returns the matched reviews. The PATCH then takes confirmed `reviewIds`, with a count cap, and refuses more than one display-name match without explicit confirmation. Or require a hash or review-id match.
- **Complexity:** M. **Regression risk:** Low.
- **Tests:** two reviewers share a name; only the confirmed one is erased and withdrawn.

### R2B-03 Erasure misses model-written text quoting the reviewer

- **Priority:** P2. **Status:** Plausible (ledger). R2-W0b confirmed the column is not scrubbed.
- **Location:** `privacy/fulfil.ts:124-226`; `ai.ts:347-356` (`unsupported_claim` messages ≤ 240 characters, ≤ 10 per result); `inventory.ts:450-456`.
- **Recommendation:**
  - In `eraseReviews`, replace `verification_result.reasons[].message` for the drafts of erased reviews, keeping `code` and `severity` and keeping `message` a string for `verificationReasonSchema`.
  - Null `publish_attempt.provider_error_body` for those replies.
  - Update the `fulfil.ts` comment and the inventory wording.
- **Complexity:** S. **Tests:** extend `tests/integration/routes/privacy-fulfilment.test.ts`.

### R2B-04 Plan `member_limit` is never enforced

- **Priority:** P2. **Status:** Plausible (ledger). R2-W0b grep found only reads and contracts.
- **Location:** `0107_billing_foundation.sql:56`; `billing/state.ts:75-81,118-120`; `entitlements.ts:157,167`; `subscription-changes.ts:215-225` (the downgrade check counts locations only).
- **Recommendation:**
  - Enforce it with a trigger on member insert and activation that mirrors `location_link_enforce_limit` (`0110`/`0111`), plus checks on invitation create and accept, plus a downgrade check on member count.
  - Or have `billing-catalog.mjs` reject a non-null `memberLimit` until enforcement exists.
- **Complexity:** M. **Regression risk:** Medium (invitation flows).
- **Tests:** acceptance over the limit returns 402; a downgrade below the member count returns 409.

### R2B-06 No alert when billing events dead-letter or reconciliation keeps failing

- **Priority:** P2. **Status:** Plausible (ledger).
- **Location:** `billing/process-events.ts:642-673` (dead events: `log.error` and an audit row, errors swallowed), `:726-732`; `ops-liveness.ts:41,86` (heartbeat only).
- **Evidence:** for an unknown price (`billing_plan_unknown`, `:394-402`), every event and every hourly reconcile fails. A pilot that has just paid stays on `pilot` (full access, unlimited locations) while liveness stays green.
- **Recommendation:** add `billingFailureFinding()`, modelled on `retentionCycleFailureFinding` (`retention/cycle.ts:480`). It fires on any `billing_event` with status `dead`, or on an organisation whose `provider_synced_at` is more than 3 h older than its latest receipt. Route it through `notifications/platform.ts`.
- **Complexity:** S. **Tests:** a seeded dead event raises a finding.

### Also noted (theme 6, P3)

- **R2B-07:** AI drafting returns `402 ai_allowance_unknown` across renewal boundaries and the 7-day grace window, while `/api/ai/credits` reports `canUseAi: true`. This needs a product decision: grant provisionally, fall back to the last paid period, or report `canUseAi: false`.
- **R2B-08:** the AI ledger enforces billing read-only even when enforcement is switched off (`ai-credits.ts:216-217,356-363`). Gate it on `enforcementApplies(view)`.
- **R2B-10:** phase two of a plan change is always one month (`subscription-changes.ts:285-289`). Assert in `billing-catalog.mjs` that the price interval is monthly. Add tests for: changing plan while trialing, an existing schedule from an earlier change, and Stripe updated but the DB rolled back, then retried.
- **R2B-12:** a retention round checks the deadline only between rounds. A `disconnectedReviews` cascade can push it past `maxDuration`, roll it back, and repeat it. Check the deadline between steps, and cap cascading deletes at about 50 reviews (helped by W4-08).
- **R2B-13:** derived copies of the reviewer's name (drafts, verification text) outlive raw-content retention. Legal/product decision. 21 inventory datasets are still `PENDING_UNDECIDED`.
- **R2B-14:** no warning when Stripe has two running subscriptions; a re-applied hold overwrites `approved_by`; no abuse limit on `verify` (see W3-07); pilot conversion silently ends operator adjustments early.

---

## Theme 7: Idempotency and duplicate-write safety

**Headline (R2-W1b, coordinator):** no duplicate Google write is possible on the reviewed paths:

- `publish_attempt` has `unique (organisation_id, idempotency_key)` (`0001:283`).
- The key is content-derived, `sha256(org:review:publish_generation:bodyHash)` (`publishing/intent.ts:214-224`).
- `insertAttempt` uses `on conflict do nothing`, and the loser replays or recovers.
- Google's reply endpoint is a PUT upsert.

The harms below are local: wrong status codes, duplicate rows, and stale guards.

### W1-F1 Server approval guards are optional

- **Priority:** P1. **Status:** Confirmed (coordinator).
- **Location:** client `lib/queries/use-approval-decision.ts:14` omits `draftId` and `expectedReviewUpdateTime`; server `lib/server/review-approval.ts:121,149` checks them only when present.
- **Evidence:** a single-review Approve can approve a draft the approver never saw, for example one replaced by a colleague after the pane loaded.
- **Recommendation:** make both fields **required** in the approval contract (`lib/contracts/reviews.ts`), so the server rejects their absence with `400 invalid_request`. Then send them from the hook. Deploy order: the client change first, the contract tightening second, or accept a short window of 400s for stale tabs.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** approve without `draftId` gives 400; with a stale `draftId`, 409.

### W1-F6 Post approve and delete: retry after success, and concurrency

- **Priority:** P2. **Status:** Confirmed (R2-W1b).
- **Evidence:**
  - **Delete:** a retry after success gives 404 `post_not_found` (`posts.ts:630,635`), because `loadPost` runs before `runGbpWrite`'s intent replay. A concurrent retry gets a fresh key (`posts.ts:1968-1972`), so two Google DELETEs are sent; the second 404 is swallowed. The result is two attempts, two receipts and two audit rows.
  - **Approve:** a retry after success gives 409 `approval_not_pending` (`posts.ts:1290-1297`). Under concurrency, the locked row's status does not change in the decide transaction, so a second decision row and audit row are written. There is one Google write (content key).
- **Recommendation:**
  - Forward the intent from `posts-action-bar.tsx:192-196,208-209` (add `MutationOptions` to `decidePostApproval` and `deletePost`).
  - Make DELETE idempotent: treat an already-`deleted` row as `200 {status: "deleted"}`, or replay the receipt under the intent before `loadPost`.
  - For approve, return the settled outcome when the post is already `published` at `expectedRevision` by this user's approval, or move the post to a transitional status inside the decide transaction.
- **Complexity:** S–M. **Regression risk:** Low.
- **Tests:** a retry with the same key after success gives 200 and no provider call.

### W1-F7 Duplicate bulk batches

- **Priority:** P2. **Status:** Confirmed (R2-W1b).
- **Evidence:** `insertBatch` always inserts. Uniqueness is only `(operation_id, review_id)` per batch (`0130:79`). Residual effects:
  - duplicate `approval_decision` and audit rows;
  - a second, concurrent template draft that leaves a published review showing `verified` (F7-b);
  - a second AI verification spend (F7-c).
- **Recommendation:**
  - At plan time in `startBulkTemplateReplies` and `startBulkReviewApprovals`, skip with `review_busy` when `exists (select 1 from bulk_listing_child c where c.review_id = r.id and c.status in ('queued','running','ambiguous'))`.
  - Back it with a partial unique index (see the change list).
  - Forward an `Idempotency-Key` from `queueBatch` into `bulk_listing_operation` with `unique (organisation_id, intent_id)`.
  - For F7-b, re-check `hasReply` in `createReviewDraft`'s settle transaction when `templateOnly`.
- **Complexity:** S–M. **Regression risk:** Low.

### W6-03 Publish re-arm has no status compare-and-set

- **Priority:** P2. **Status:** Plausible.
- **Location:** `publishing/attempt.ts:113-180` (`rearmAttempt` updates `where id = …` only); `intent.ts:441-452`; contrast the runner's CAS at `retry.ts:261-277`.
- **Evidence:** a user publish and the runner's retry claim can both move one `retryable` attempt to `started`, giving two provider calls for the same attempt number. Google's PUT upsert and the CAS-guarded settle limit the damage to an extra call and a duplicate `started` event. A publish racing a delete could flip the final state (hypothesis).
- **Recommendation:** add `and status = 'retryable' and (next_attempt_at is null or next_attempt_at <= now())` to both UPDATEs, and return null on no match, so the caller takes the existing "concurrent winner" branch (`intent.ts:454-466`).
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** a two-connection test where the runner claims between the read and the re-arm gives exactly one provider call.

### Also noted (theme 7, P3)

- `template-reply-dialog.tsx:155` and `verifyDraft` do not forward an intent, so a retry creates a second draft or bills a second verification. `verify/route.ts:109` keys on the request id. Systemic fix: make `MutationOptions` a required parameter on every intent-aware `lib/api` wrapper, so a missing intent fails typecheck.
- **W0-11:** `executePublish` re-enters itself after recovery with no depth bound. Add one.

---

## Database change list

All DDL follows W4-13: `-- migrate:no-transaction` and `CONCURRENTLY` for large or hot tables, one index per file, and `lock_timeout` set. Table sizes are unknown (no DB access), so "Large or hot" is inferred from write paths. Check `pg_total_relation_size` before choosing.

| #   | Change                                                                                                                                                                                            | Exact query served                                                                                                                                                                                        | Write-cost note                                                                                                      | `CONCURRENTLY`?                                                          | Finding       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------- |
| 1   | `create index audit_log_subject_idx on audit_log (organisation_id, subject_type, subject_id, created_at desc) include (action)`                                                                   | Timeline: `… where subject_type = 'review' and subject_id = $id order by created_at desc limit 100` (`review-reads.ts:234-239`); posts `local_edits` CTE / lateral `max(created_at)` (`posts.ts:740-746`) | One btree entry per audit insert; insert-only table                                                                  | **Yes** (large, insert-hot)                                              | W4-04         |
| 2   | `ON CONFLICT … DO UPDATE … WHERE review.content_hash is distinct from excluded.content_hash or …` (code, not DDL)                                                                                 | Review sync upsert (`reviews.ts:253-296`)                                                                                                                                                                 | **Removes** most writes and index churn on `review`, `review_media_item`, `review_reply`                             | n/a                                                                      | W4-03 / W8-04 |
| 3   | Reply guards: `and not exists (select 1 from publish_attempt pa where pa.review_reply_id = review_reply.id and pa.status in ('started','ambiguous','retryable'))` (code)                          | Reply null-out and overwrite (`reviews.ts:332-385`)                                                                                                                                                       | Served by the existing `(review_reply_id, status)` index (`0035:56`); no new index                                   | n/a                                                                      | W8-04         |
| 4   | `create index draft_review_id_idx on draft (review_id)`                                                                                                                                           | RI cascade `delete from draft where review_id = $1`                                                                                                                                                       | Low (drafts are written per user action)                                                                             | **Yes**                                                                  | W4-08         |
| 5   | `create index review_reply_review_id_idx on review_reply (review_id)`                                                                                                                             | RI cascade; also the sync's `update review_reply … where review_id = $1` when RLS is bypassed                                                                                                             | Low; HOT is unaffected unless `review_id` changes                                                                    | **Yes**                                                                  | W4-08         |
| 6   | `create index approval_decision_review_id_idx on approval_decision (review_id)`                                                                                                                   | RI cascade from `review`                                                                                                                                                                                  | Low                                                                                                                  | Yes if large, else plain with `lock_timeout`                             | W4-08         |
| 7   | `create index … on publish_attempt_event (publish_attempt_id)`                                                                                                                                    | RI cascade from `publish_attempt`                                                                                                                                                                         | One entry per event insert                                                                                           | **Yes**                                                                  | W4-08         |
| 8   | Partial: `approval_decision (draft_id) where draft_id is not null`; `publish_attempt (draft_id) where draft_id is not null`; `review_reply (pending_draft_id) where pending_draft_id is not null` | `ON DELETE SET NULL` from `draft`                                                                                                                                                                         | Low; only non-null rows                                                                                              | Yes for `publish_attempt` and `review_reply`                             | W4-08         |
| 9   | `create index ai_usage_reserved_idx on ai_usage (created_at) where status = 'reserved'`                                                                                                           | Reaper `update ai_usage … where status = 'reserved' and created_at < now() - …` (`0059:59-73`), every minute                                                                                              | Tiny partial index; rows leave it on settle                                                                          | **Yes**                                                                  | R2B-11        |
| 10  | `create index … on review (organisation_id, create_time) where provider_deleted_at is null`                                                                                                       | Analytics `r.create_time >= $from and <= $to` (`analytics-overview.ts:123-125,270-272`)                                                                                                                   | One more non-HOT entry per review rewrite. **Only after #2**                                                         | **Yes**                                                                  | W4-06         |
| 11  | _(conditional)_ `create index … on review (organisation_id, star_rating, update_time desc, id desc)` plus the row-comparison cursor                                                               | `rating_desc` keyset pages (`reviews-query.ts:53-84`)                                                                                                                                                     | As #10. Only if `EXPLAIN` shows the sort dominating                                                                  | **Yes**                                                                  | W4-12         |
| 12  | _(conditional)_ `create extension btree_gin`; GIN `(organisation_id, search_document)`, then drop `review_search_idx`                                                                             | Inline inbox search predicate (W4-07)                                                                                                                                                                     | GIN maintenance on the hottest table. Measure first                                                                  | **Yes**                                                                  | W4-07         |
| 13  | `create index … on processed_webhook_event (organisation_id) where status = 'dead'`, plus a retention step deleting `processed`/`ignored` rows older than 7 days                                  | `tenantAlerting` `count(*) … where status = 'dead'` (`health/route.ts:70-120`)                                                                                                                            | Small partial; the retention step shrinks the table                                                                  | Yes                                                                      | W4-11         |
| 14  | `create index … on profile_sync_attempt (organisation_id, location_id, created_at desc)`                                                                                                          | Latest-attempt query filtering `location_id` (`location-summary.ts:483-507`)                                                                                                                              | Low                                                                                                                  | Yes if large                                                             | W4-15         |
| 15  | `create or replace function claim_due_jobs(…)` with `(priority, due_at, id)` ordering; hash-phased first arming in `ensure_recurring_checkpoints`                                                 | Job claim (`0092:182-195`, `0048:68-105`)                                                                                                                                                                 | None; the partial due indexes still serve the per-arm scans. Re-check the plan with `EXPLAIN` at backlog             | n/a (function). Keep revokes from `anon`/`authenticated` (P0)            | W8-03         |
| 16  | Trigger `review_legal_hold_guard` `BEFORE UPDATE OF review_text, reviewer_display_name, reviewer_profile_photo_url, raw_payload OR DELETE ON review`                                              | Purge redaction, `disconnectedReviews`, erasure                                                                                                                                                           | One `legal_hold` probe per targeted update/delete; needs a `legal_hold (review_id)` lookup (the table is tiny today) | n/a                                                                      | R2B-01        |
| 17  | `legal_hold.review_id` FK → `ON DELETE RESTRICT`: `add constraint … not valid`, then `validate constraint`, then drop the old one                                                                 | Prevents a cascade from deleting a hold                                                                                                                                                                   | None                                                                                                                 | n/a (`NOT VALID` + `VALIDATE` avoids a long lock)                        | R2B-01        |
| 18  | `create unique index … on bulk_listing_child (review_id) where status in ('queued','running')`                                                                                                    | Backstops the plan-time `review_busy` check                                                                                                                                                               | Low                                                                                                                  | Yes                                                                      | W1-F7         |
| 19  | `unique (organisation_id, intent_id)` on `bulk_listing_operation` (new column `intent_id`)                                                                                                        | Replay `POST /api/reviews/bulk` by Idempotency-Key                                                                                                                                                        | Low                                                                                                                  | Expand/contract: nullable column, then a unique index built concurrently | W1-F7         |
| 20  | _(option)_ table `resource_lease (organisation_id, lock_key, holder, expires_at, primary key (organisation_id, lock_key))`; optionally the same for `ops_lease`                                   | W4-01 option 4; W8-05                                                                                                                                                                                     | One upsert per acquire and release, via the transaction pooler                                                       | n/a (new table)                                                          | W4-01, W8-05  |
| 21  | Member-limit trigger mirroring `location_link_enforce_limit`                                                                                                                                      | Member insert/activation; invitation accept                                                                                                                                                               | One `organisation_billing` read per member insert                                                                    | n/a                                                                      | R2B-04        |
| 22  | Throttled slide `update app_session … where id = $1 and last_seen_at < now() - interval '5 minutes'` (code)                                                                                       | `lookupSession` (`session.ts:217-229`)                                                                                                                                                                    | **Removes** almost all session writes                                                                                | n/a                                                                      | W4-05         |
| 23  | Batched upserts via `unnest` with `is distinct from` guards (code)                                                                                                                                | `performance.ts:199-223`, `keywords.ts`, `posts.ts:528-539`, discovery routes                                                                                                                             | **Fewer** statements; no-op rows are skipped                                                                         | n/a                                                                      | W4-09, W3-1   |
| 24  | Drop candidates (W4-14), after `idx_scan = 0` over a full stats period                                                                                                                            | n/a                                                                                                                                                                                                       | **Removes** index maintenance on `review` and `sync_checkpoint`                                                      | **Yes** (`drop index concurrently`)                                      | W4-14         |
| 25  | Runner default `SET lock_timeout = '5s'` per file; policy rule rejecting non-concurrent indexes on hot tables                                                                                     | All future migrations                                                                                                                                                                                     | n/a                                                                                                                  | n/a                                                                      | W4-13 / W7-5  |

**Suggested order:** 25 → 2/3 → 1 → 4–9 → 22/23 → 15 → 16/17 → 18/19 → 10–14 (each measured first) → 24.

---

## Open questions / needs live measurement

1. **Google latency distribution inside locked sections (W4-01).** How often does the sequence exceed 45 s or 60 s? Count SQLSTATE 25P03 and 57014 in Postgres logs, and `idle in transaction` duration on the session pooler.
2. **Did every environment run `db-create-runtime-role.mjs`?** If not, the lock connection has _no_ timeouts at all (`SHOW idle_in_transaction_session_timeout` as the runtime role, read-only).
3. **`review` churn (W4-03).** `n_tup_upd`, `n_tup_hot_upd` and `n_dead_tup` on `review`, `review_media_item` and `review_reply`; reconcile job duration; autovacuum frequency on `review`.
4. **T_r per job kind (W8-01/02/03).** None is instrumented today. Add `jobs.item.duration{kind}`, due backlog per kind and oldest-due age. Without these, the 2,700 / T_r ceiling and the ~450-location starvation point cannot be placed.
5. **Session-pooler occupancy (W4-02, W8-05).** Supavisor client counts over a bulk run and a token-refresh storm; `consecutive_skips` per lease key.
6. **Platform behaviour on `maxDuration` kill.** Is the instance frozen or torn down, and does Supavisor drop the socket? This decides whether W8-05 is real.
7. **Plans for the index proposals.** `EXPLAIN (ANALYZE, BUFFERS)` on staging for the largest tenant: the audit timeline and posts list (W4-04), counts and analytics (W4-06), common-word search (W4-07), rating sort (W4-12), a retention `delete from review where id in (…)` with RI trigger times (W4-08), and `claim_due_jobs` at backlog.
8. **Unused indexes (W4-14).** `pg_stat_user_indexes.idx_scan` over a full stats period.
9. **Table sizes** for `audit_log`, `review`, `draft`, `review_reply`, `ai_usage` and `processed_webhook_event`, to decide `CONCURRENTLY` and batch sizes.
10. **Pool wait (W4-10).** Production `DATABASE_POOL_MAX` is 5 per the runbook. Add a checkout-wait histogram before tuning `JOBS_CONCURRENCY` or K ticks.
11. **Google list lag after a reply PUT (W8-04).** If the list lags by seconds, the stale-read window widens. Measure it on staging.
12. **Product/legal decisions** required before implementation: R2B-07 (AI during grace), R2B-13 and the 21 `PENDING_UNDECIDED` retention datasets, W4-11's 7-day dedupe horizon, and whether W4-03's guard may leave redacted rows unrefreshed for up to a day.
13. **SEC-11 / W6-01** remains Unverified pending the operator's read-only SQL checklist (see `CODEBASE_AUDIT.md`).
