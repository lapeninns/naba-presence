# W4: Database schema, query efficiency, indexes, transactions, pooling

**Workstream:** W4 (database)
**Auditor:** research sub-agent (read-only)
**Date:** 2026-10-14
**Tree evaluated:** HEAD `d8759c74` plus the working tree as-is. The uncommitted inbox UI files are outside this scope and were not touched.

## Scope covered

- `supabase/migrations/*.sql` (131 files, 13,286 lines). I extracted every `CREATE TABLE`, `CREATE INDEX` (167), inline and `ALTER` constraints, FKs and `ON DELETE` behaviour, and every RLS policy (63) with node scripts.
- `lib/server/db.ts` (pool, `withTenant`, `withSessionConnection`), `lib/server/env.ts` (pool sizing), `lib/server/leases.ts`, `lib/server/google-account-change-lock.ts`, `lib/server/google/connections.ts` (refresh lock), `lib/server/google/rate-budget.ts` and migration `0049`.
- SQL issued from `lib/server/**` and `app/api/**`. I matched hot read paths (inbox list, counts, review detail, analytics, location summary, posts list, audit log, session lookup, platform health) and hot write paths (review sync upsert, performance metrics, job claim, retention purge) against the index inventory.
- `scripts/db-migrate.mjs`, `scripts/migration-rules.mjs`, `scripts/db-create-runtime-role.mjs` (read only).
- Operational context from `docs/architecture.md` (§Runtime role, §Checkpointed synchronization), `docs/runbook.md` (production pooler setup, around lines 1231–1272) and `vercel.json` crons.

## Commands run (all read-only)

- `supabase status`: failed because the Docker daemon is not running. **No local database, so no `EXPLAIN` was run. Everything below is static analysis.**
- `node` scripts that parse the migrations into a per-table index inventory, after applying `DROP INDEX` (`/tmp/w4_idx.txt`), an FK-without-leading-index report (`/tmp/w4_fk.js`) and an RLS-policy shape check.
- `node` scripts that brace-match every `withTenant(` / `tenant(` callback in `lib/` and `app/api/`, flag outbound calls (`googleRequest`, `google*()`, `fetch`, `generateReply`, `sendEmail`, storage), and resolve one-hop and transitive helper calls through a crude name-based call graph. A second pass flagged nested pool use (`getDatabase()`, nested `withTenant`, `withSessionConnection`) inside callbacks.
- `node` script that finds `for…of` loops containing `await sql\`` or `await withTenant(` (39 hits, triaged below).
- `rg` / `sed` / `awk` reads of the files cited.

## What I could NOT cover

- **No runtime evidence.** No `EXPLAIN`, `pg_stat_statements`, `pg_stat_user_indexes`, table sizes or row counts, because the local Supabase is down and production is off-limits. Every "seq scan" or "cannot use index" claim is a planner prediction from schema and query shape. Each finding names the measurement that would confirm it.
- I did not trace every one of the ~357 `withTenant` call sites by hand. The scripted scan is name-based, so a helper with a colliding name could hide an outbound call. I hand-checked the collisions it reported (`call`, `settle`, `decide`, `record`, `getAiCredits`, `changeWorkspaceMode`); all were false positives.
- Billing (`lib/server/billing/*`), the privacy withdrawal SQL and the SECURITY DEFINER provisioning functions were only skimmed.
- I did not determine Supabase plan pooler limits beyond what `docs/runbook.md` records: 15 session-pooler slots, and production `DATABASE_POOL_MAX=5`.

---

## Already good (brief)

- **RLS policies are cheap and index-friendly.** All 63 policies use the shape `organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid`. `current_setting` is STABLE, so it is evaluated once per scan and can be an index condition on `organisation_id`-leading indexes. No per-row function or subquery policies exist on hot tables. The only `EXISTS` policies are `app_user_member_read` and `app_user_session_read` (`0005`), and both hit a PK or unique index.
- **Pooler compatibility is correct.** `prepare: false` (`lib/server/db.ts:39`), transaction-local `set_config(..., true)` everywhere (no session-level `set_config(..., false)` found), and session advisory locks routed through `DATABASE_SESSION_URL`. Timeouts are pinned on the role (`scripts/db-create-runtime-role.mjs:37-39`) because the pooler drops startup parameters (runbook, around line 1254).
- **No outbound HTTP inside `withTenant` / `ctx.tenant`.** The scripted scan found none. Provider calls are deliberately outside tenant transactions (`gbp-write.ts:11`, `publishing/publish.ts:7`), and `loadLinkedLocation` returns a lazy `accessToken()` thunk (`gbp-write.ts:222-232`) that no tenant callback invokes. The exception is a _different_ transaction type; see W4-01.
- **Inbox and audit-log pagination use keysets.** `reviews-query.ts:85-97` and `app/api/audit-log/route.ts:58-66` page with keysets, not OFFSET. `updated_desc` matches `review_inbox_updated_idx (organisation_id, update_time desc, id desc)`.
- **The job claim is well-indexed.** `claim_due_jobs` (`0092`) uses `FOR UPDATE SKIP LOCKED`, and every arm has a matching partial "due" index (`webhook_due_global_idx`, `sync_checkpoint_due_global_idx`, `sync_checkpoint_recurring_due_idx`, `mutation_operation_recovery_idx`).
- **Advisory locks cannot deadlock on lock order.** Multi-lock paths use `pg_try_advisory_xact_lock`, and the one double blocking lock (`business-information.ts:218-219`) always takes `business_info` before `attributes`.
- **Retention is governed and bounded.** `inventory.ts` is test-enforced, and purge statements are bounded (`RETENTION_BATCH_ROWS_DEFAULT = 500`, `purge.ts:23`).

---

## Hot tables vs indexes vs actual queries

The index list is the inventory after all migrations. PK and inline unique constraints are noted where relevant.

| Table                          | Indexes (abridged)                                                                                                                                                                                                                                                                                                                                                                                         | Hot queries                                                                     | Match?                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| `review` (~12 indexes)         | pk; `unique(org, google_review_name_hash)`; `(org, update_time desc, id desc)`; `(org, workflow_status, update_time desc)`; `(org, location_id, update_time desc)`; GIN `search_document`; `(raw_content_expires_at)` partial; `(org, provider_deleted_at)` partial; `(org, google_review_id_hash)`; `(org, assigned_to)` partial; `(org, triaged_at)` partial; `(org, raw_content_expires_at)` partial v2 | Inbox list `updated_desc/asc`                                                   | ✅                                               |
|                                |                                                                                                                                                                                                                                                                                                                                                                                                            | Inbox `rating_desc/asc` (`reviews-query.ts:53-60`)                              | ❌ no index (W4-12)                              |
|                                |                                                                                                                                                                                                                                                                                                                                                                                                            | Counts: 2–3 full-tenant aggregates (`review-counts.ts:73-111`)                  | ⚠️ full tenant scan by design (W4-06)            |
|                                |                                                                                                                                                                                                                                                                                                                                                                                                            | Analytics `create_time` window (`analytics-overview.ts:123-125, 270-272`)       | ❌ no `create_time` index (W4-06)                |
|                                |                                                                                                                                                                                                                                                                                                                                                                                                            | Search `search_review_ids` (`0011`)                                             | ⚠️ GIN not tenant-scoped (W4-07)                 |
|                                |                                                                                                                                                                                                                                                                                                                                                                                                            | Sync upsert `ON CONFLICT (org, name_hash)`                                      | ✅, but write amplification (W4-03)              |
| `audit_log`                    | `(org, created_at desc)`; `unique(org, request_id, action, subject_type, subject_id)`                                                                                                                                                                                                                                                                                                                      | Audit page keyset                                                               | ✅                                               |
|                                |                                                                                                                                                                                                                                                                                                                                                                                                            | Review timeline `subject_type, subject_id` (`review-reads.ts:224-240`)          | ❌ (W4-04)                                       |
|                                |                                                                                                                                                                                                                                                                                                                                                                                                            | Posts list `local_edits` CTE (`posts.ts:740-746`)                               | ❌ (W4-04)                                       |
| `app_session`                  | `unique(token_hash)`; `(expires_at)`                                                                                                                                                                                                                                                                                                                                                                       | Lookup by `token_hash` and an UPDATE every request (`session.ts:217-229`)       | ✅ read; ⚠️ write per request (W4-05)            |
| `sync_checkpoint` (10 indexes) | `unique(org, ext_loc, sync_type)`; 8 partial or "due" indexes                                                                                                                                                                                                                                                                                                                                              | Claim, lateral status in inbox                                                  | ✅; some per-org due indexes look unused (W4-14) |
| `processed_webhook_event`      | `unique(provider, external_event_id)`; 4 partial (status `received`/`failed`/`processing`)                                                                                                                                                                                                                                                                                                                 | Platform health per-org counts incl. `status='dead'` (`health/route.ts:70-120`) | ❌ no org-leading non-partial index (W4-11)      |
| `draft`                        | `(org, review_id, created_at desc)`                                                                                                                                                                                                                                                                                                                                                                        | Inbox lateral, detail                                                           | ✅ under RLS; ❌ for FK cascade (W4-08)          |
| `review_reply`                 | `unique(org, review_id)`                                                                                                                                                                                                                                                                                                                                                                                   | Joins                                                                           | ✅ under RLS; ❌ for FK cascade (W4-08)          |
| `mutation_operation`           | `unique(org, intent_id)`, `unique(org, id)`, attempt, recovery, pending-change                                                                                                                                                                                                                                                                                                                             | Receipt lookups by intent and id                                                | ✅                                               |
| `notification_*`               | due, idempotency and digest partial uniques                                                                                                                                                                                                                                                                                                                                                                | Delivery driver, digests                                                        | ✅ (digest loop is N+1, P3)                      |
| `performance_metric_daily`     | `unique(org, ext_loc, metric, metric_date)` + range idx                                                                                                                                                                                                                                                                                                                                                    | Upsert per point                                                                | ✅ index; ❌ N+1 (W4-09)                         |
| `google_rate_bucket`           | pk(bucket)                                                                                                                                                                                                                                                                                                                                                                                                 | `take_google_rate_budget` FOR UPDATE per Google request                         | ✅, hot row (note in W4-02)                      |

---

## Findings

### W4-01 Advisory-lock transactions stay open on session-pooler connections across Google HTTP calls; worst case exceeds `idle_in_transaction_session_timeout`

- **Priority:** P1
- **Status:** CONFIRMED for the code path and config. PLAUSIBLE that the timeout is hit in practice (needs timing data).
- **Location:**
  - `lib/server/hours.ts:737-760` (`publishCanonicalHours`)
  - `lib/server/profile.ts:640-647` (`publishProfileToGoogle`)
  - `lib/server/food-menus.ts:456-475` (`publishFoodMenus`)
  - `lib/server/business-information.ts:203-212, 216-245, 510`
  - `lib/server/industry-management.ts:68, 119`
  - `lib/server/google-verification-execution.ts:89-95` (`withVerificationLock`)
  - `lib/server/google-administration-execution.ts:16`
  - `lib/server/google-lifecycle-execution.ts:15`
  - `lib/server/google-account-change-lock.ts:7-14`
  - `lib/server/bulk-listing-runner.ts:381-401` (`withResourceLock`)
- **Current implementation / evidence:**
  ```ts
  return withSessionConnection((connection) =>
    connection.begin(async (lock) => {
      await lock`select pg_advisory_xact_lock(hashtextextended(${hoursLockKey(...)}, 0))`
      const live = await readLiveHours(input.session, input.locationId)      // Google GET
      ...
      const result = await publishHoursToGoogle(live, input, checked.plan)    // validate + PATCH + readback
  ```
  - The advisory lock is transaction-scoped, so the transaction stays open, idle, on the session-pooler backend for the entire provider round trip.
  - The runtime role has `idle_in_transaction_session_timeout = '60s'` (`scripts/db-create-runtime-role.mjs:39`, runbook around line 1256), and `DATABASE_SESSION_URL` uses that same role (runbook around line 1251).
  - Per-call deadlines are 15 s for safe calls and 20 s for mutations (`env.ts`, `GOOGLE_TIMEOUT_MS`, `GOOGLE_MUTATION_TIMEOUT_MS`; `transport.ts:344-350`). Each deadline includes `acquireGoogleBudget` waits (`rate-budget.ts:141-175`).
  - A publish is a live read (≤15 s), an optional `validateOnly` PATCH (≤20 s), a PATCH (≤20 s) and a readback (≤15 s). That is up to about 70 s before any token refresh (up to `GOOGLE_TIMEOUT_MS + 5 s`, `connections.ts:436`), which is over the 60 s limit.
  - My scripted `withTenant` scan missed this pattern because it is a `connection.begin` transaction, not `withTenant`.
- **Root cause:** Using `pg_advisory_xact_lock` inside `begin()` to get "released on disconnect" semantics ties lock lifetime to an idle-in-transaction session.
- **Consequences when the limit is hit:**
  - PostgreSQL terminates the session and the advisory lock is released mid-write, so a bulk child or another editor can now interleave. That defeats the comment's guarantee (`hours.ts:730-735`).
  - The final `COMMIT` fails, so `begin()` rejects after Google may already have applied the change. Receipts are written in separate pooled transactions, so data stays consistent, but the user gets a 5xx for a write that succeeded.
- **Recommendation:**
  - (a) Switch to **session-level** `pg_try_advisory_lock` / `pg_advisory_lock` with an explicit `pg_advisory_unlock` in `finally`, with no surrounding `begin()`. That is the pattern `leases.ts:163-189` and `connections.ts:438-462` already use. The session is then idle, not idle-in-transaction, and closing the client still releases the lock.
  - (b) Alternative: keep the transaction but `SET LOCAL idle_in_transaction_session_timeout` to the computed work budget plus a margin.
  - (c) Longer term: a lock-row lease (`resource_lock(org, location, key, holder, expires_at)`) so the lock does not cost a pooler slot (see W4-02).
- **Expected benefit:** Removes a correctness hole in the mutual exclusion and a class of false-failure responses on slow Google calls.
- **Complexity:** S (mechanical; one helper in `db.ts`, e.g. `withSessionAdvisoryLock(key, { try })`, replaces 10 call sites).
- **Regression risk:** Medium. Lock semantics are subtle. Keep try versus blocking per site; blocking session locks need `lock_timeout` / `statement_timeout` awareness.
- **Tests to add or verify:**
  - Integration: hold the lock, simulate a 65 s `work()` (fake timers or a test-only setting such as `idle_in_transaction_session_timeout=1s`), and assert a second acquirer is still refused.
  - Existing bulk/editor interleave tests.
- **Measure:** span duration of these functions (OTel already wraps `googleRequest`) and occurrences of `57P05 idle-session` / `25P03 idle_in_transaction_session_timeout` in Postgres logs.
- **Dependencies:** W4-02.

### W4-02 Session-pooler slot budget (15) is shared by leases, refresh locks, and per-write lock connections (two per bulk child), with 150 ms reconnect polling

- **Priority:** P1
- **Status:** PLAUSIBLE. The code paths are confirmed; exhaustion needs measurement.
- **Location:**
  - `lib/server/db.ts:57-72` (`withSessionConnection`: new client, `max: 1`, per call)
  - `lib/server/leases.ts:153-189`
  - `lib/server/google/connections.ts:393, 431-475` (`refreshUnderLock`, `REFRESH_WAIT_POLL_MS = 150`)
  - `lib/server/bulk-listing-runner.ts:381-401` (resource lock that nests `withGoogleAccountChangeLock`)
  - All W4-01 sites
- **Current implementation / evidence:**
  - Every `withSessionConnection` opens a fresh TCP+TLS client to the session pooler and holds a pooler slot for its whole lifetime.
  - Concurrent holders at one moment can be:
    - up to 9 fleet leases (`LEASE_KEYS`, `leases.ts:14-24`). Several crons coincide at `:00`, `:15`, `:30` and `:45` (`vercel.json`: jobs every minute, retention every 5 minutes, reconcile/health every 15 minutes, performance every 6 hours);
    - one slot per in-flight W4-01 write;
    - **two** per bulk child whose family has `accountLock` (`withResourceLock(() => withGoogleAccountChangeLock(...))`, `bulk-listing-runner.ts:398-401`), times `JOBS_CONCURRENCY` (3 in production per the runbook);
    - every refresh waiter. A waiter that loses `pg_try_advisory_lock` closes the client, sleeps 150 ms and reconnects (`connections.ts:438-473`) until a deadline of about 20 s. That is up to roughly 100 connect/close cycles per waiting process per refresh.
  - The runbook records that this pooler already failed once with `EMAXCONNSESSION` at 15 slots (around line 1234).
  - If a lease cannot connect, the tick throws and liveness alerts fire.
- **Root cause:** Locks are implemented as connection-scoped Postgres state, and the session pooler is a small fixed resource.
- **Recommendation:**
  - (a) Refresh waiters: poll the `google_connection` row through the **transaction** pooler (they already call `loadFromTenant`). Retry the session lock only every 1–2 s, or use a blocking `pg_advisory_lock` with `lock_timeout` on a single held connection instead of reconnecting.
  - (b) Bulk child: take the account lock on the **same** session connection as the resource lock (a second `pg_try_advisory_lock` key on it), not a nested `withSessionConnection`.
  - (c) Alternative for writes: a table-backed lease (insert-or-steal on expiry) through the transaction pooler, which needs no session slot.
  - (d) Document the slot arithmetic next to `DATABASE_POOL_MAX` in the runbook.
- **Expected benefit:** Bounded session-slot usage, lease ticks that are not starved, and fewer TLS handshakes on the refresh path.
- **Complexity:** M. **Regression risk:** Medium.
- **Tests:** unit test that one bulk child opens exactly one session client; refresh-contention test that counts `withSessionConnection` invocations.
- **Measure:** `select count(*) from pg_stat_activity where usename = '<runtime role>' and application_name ...` grouped over time (on staging); Supavisor client-connection metrics in the Supabase dashboard.
- **Dependencies:** W4-01.

### W4-03 Review sync rewrites every review on every reconcile page (non-HOT updates across ~12 indexes, media delete/reinsert, reply upsert); `content_hash` is computed but never used to skip

- **Priority:** P1
- **Status:** CONFIRMED (code). The magnitude needs `pg_stat_user_tables.n_tup_upd / n_tup_hot_upd` for `review`.
- **Location:**
  - `lib/server/reviews.ts:155-389` (`upsertGoogleReview`)
  - `reviews.ts:696-718` (per-review loop inside the page transaction)
  - `lib/server/google/reviews.ts:17-18` (`pageSize: "50"`, `orderBy: "updateTime desc"`)
- **Current implementation / evidence:**
  - Reconcile runs for every linked location every 15 minutes (`RECONCILE_INTERVAL`, `reviews.ts:409`) and always fetches at least page 1 (50 reviews).
  - For each review it runs:
    1. `select set_config('app.provider_reconciliation','true',true)` per review (`reviews.ts:199-201`), although once per transaction is enough;
    2. `insert ... on conflict (organisation_id, google_review_name_hash) do update set ...`, with **no `WHERE`**, so the row is rewritten even when nothing changed. It sets `raw_content_expires_at = excluded.raw_content_expires_at` (`now() + retention`), and that column is in two indexes (`raw_review_expiry_idx` and `review_unredacted_expiry_v2_idx`), so the update **cannot be HOT** and every non-partial index on `review` gets a new entry, including the GIN `search_document` index. The stored generated tsvector is recomputed too;
    3. `delete from review_media_item where review_id = …` followed by one `insert` per media item (`reviews.ts:302-327`);
    4. a `review_reply` upsert or update (`reviews.ts:332-387`).
  - That is roughly 4–5 + M round trips per review, about 200–250 per page, per location, every 15 minutes, almost all of them no-op rewrites.
  - `content_hash` (`reviews.ts:178-187`) covers name, rating, text, `updateTime`, reply and media, but is only written, never compared (`rg content_hash lib/server` shows no read).
- **Root cause:** Idempotent-by-overwrite upsert with no change detection.
- **Recommendation:**
  1. Add `where review.content_hash is distinct from excluded.content_hash or review.provider_deleted_at is not null or review.raw_content_expires_at < now() + interval '<retention − 1 day>'` to the `DO UPDATE`.
     - The last disjunct keeps the 30-day cache window refreshed at most daily. Because the expiry is measured from the last actual write, this stays conservative for Google's caching rule.
     - Then handle the no-row `RETURNING` case: follow with `select id, erased_at` by `(org, name_hash)`, or use a `WITH up AS (...) SELECT` union.
  2. Skip the media delete/reinsert and the reply write when the hash is unchanged (the hash already covers both).
  3. Move `set_config('app.provider_reconciliation')` to once per page transaction.
  4. Optional: build the page as one multi-row `INSERT ... SELECT FROM unnest(...)` / `sql(rows)` upsert.
- **Expected benefit:** Removes most steady-state write volume (WAL, index churn and GIN pending-list growth) on the largest table, and cuts sync round trips about 4×. It also makes adding read indexes (W4-04, W4-06, W4-12) cheaper.
- **Complexity:** M. **Regression risk:** Medium.
  - The erasure guard (`erased_at`) and the workflow reset (`published`/`rejected` → `new`) must still fire when relevant. Both depend on content changing, except the reply-deleted case, which changes the hash.
  - Retention redaction must not be undone. A redacted row keeps its hash, so re-ingest would no longer repopulate it before the daily refresh. Decide explicitly whether that is desired (it arguably is).
- **Tests:** existing `upsertGoogleReview` / erasure / retention tests, plus new ones: unchanged payload produces zero row versions (check `xmin` unchanged); changed reply rewrites; expiry near its end refreshes.
- **Measure:** `n_tup_upd`, `n_tup_hot_upd` and `n_dead_tup` on `review`, `review_media_item` and `review_reply` before and after; `pg_stat_statements` calls for the upsert.
- **Dependencies:** none.

### W4-04 `audit_log` read by subject without an index: review detail timeline and posts list scan the tenant's whole audit history

- **Priority:** P1
- **Status:** CONFIRMED (no matching index). PLAUSIBLE for plan choice.
- **Location:**
  - `lib/server/review-reads.ts:224-240` (timeline, run on every review-detail open)
  - `lib/server/posts.ts:739-760` (`local_edits` CTE, run on every posts list)
  - Indexes: `0001_initial.sql:394` (`audit_log_tenant_time_idx (organisation_id, created_at desc)`) and the unique `(organisation_id, request_id, action, subject_type, subject_id)` (`0001:380`)
- **Current implementation / evidence:**
  - Timeline:
    ```sql
    from audit_log a ... where a.subject_type = 'review' and a.subject_id = ${id}
    order by a.created_at desc limit 100
    ```
    The planner either walks `(org, created_at desc)` and filters, or scans the tenant's rows. For any review whose events are older than the newest few thousand tenant events, it reads most of the tenant's audit log, up to `audit_retention_days` (default **365**, `0008:149`).
  - The posts CTE `select subject_id, max(created_at) from audit_log where organisation_id = $1 and subject_type = 'local_post' and action in (...) group by subject_id` aggregates **every** post-edit audit row for the tenant, then joins one location's posts.
- **Root cause:** `audit_log` doubles as a per-subject history store without a subject index.
- **Recommendation:**
  - Add one index, `create index ... on audit_log (organisation_id, subject_type, subject_id, created_at desc)`, which serves both queries.
  - Rewrite `local_edits` as a `left join lateral (select max(created_at) from audit_log where organisation_id=$1 and subject_type='local_post' and subject_id = gbp_local_post.id::text and action in (...))`, so it probes per listed post.
  - Alternative for posts: persist `content_edited_at` on `gbp_local_post` (a `content_edited_by` column already exists, `0081`) and drop the audit dependency.
  - `audit_log` is append-only and insert-heavy, so one extra btree is a modest write cost.
- **Expected benefit:** Index-bounded timeline and posts list regardless of audit volume.
- **Complexity:** S. **Regression risk:** Low.
  - Build with `CREATE INDEX CONCURRENTLY` in a `-- migrate:no-transaction` migration (supported by `migration-rules.mjs:4, 229-231`, but unused so far; see W4-13).
- **Tests:** timeline ordering test; posts list sort test (`sort_at` semantics).
- **Measure:** `EXPLAIN (ANALYZE, BUFFERS)` of both queries on staging for the largest tenant.
- **Dependencies:** W4-13 (migration pattern).

### W4-05 Every authenticated request writes `app_session` (non-HOT) in a ~8-round-trip transaction

- **Priority:** P2
- **Status:** CONFIRMED
- **Location:** `lib/server/session.ts:128-238` (`lookupSession`); the `getSession` `cache()` wrapper (`session.ts:241-248`) dedupes only within one RSC render. Route handlers call it once per API request.
- **Current implementation / evidence:**
  - Each lookup runs `begin`, `set_config(token_hash)`, an identity select, `set_config(org)`, a 4-table session select with a `scopeFingerprint` subquery, `update app_session set last_seen_at = now(), expires_at = least(...)`, `getOrganisationBilling`, and `commit`.
  - `expires_at` is indexed (`app_session_expiry_idx`, `0001:395`), so each update is non-HOT.
  - Clients poll several endpoints every 60 s: review counts, notifications, connections, clients, connection health and workspace (`use-needs-reply-count.ts:25`, `notifications-link.tsx:28`, `use-clients.ts:28`, `use-connections-query.ts:19`, `use-connection-health.ts:28`, `use-connection-workspace.ts:27`). So each open tab writes the session row several times a minute, and each API call does two transactions (session, then `ctx.tenant`).
- **Root cause:** The sliding idle window is updated unconditionally.
- **Recommendation:**
  - Make the slide conditional: `... where id = $1 and last_seen_at < now() - interval '5 minutes'`. With a multi-day idle window (`SESSION_IDLE_DAYS`), sliding at 5-minute granularity changes nothing observable.
  - Optionally pipeline the two `set_config` calls into the following statements (postgres.js pipelines un-awaited queries) or merge them into one select.
- **Expected benefit:** Removes nearly all session-table writes and index churn, and shortens every request's critical path.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** session idle-expiry tests (`tests/**/session*`); add a test that two lookups within 5 minutes do not change `expires_at`.
- **Measure:** `n_tup_upd` on `app_session`; p50 of the `getSession` span.
- **Dependencies:** none.

### W4-06 Review counts and analytics recompute full-tenant aggregates on every poll and render; the analytics window column has no index

- **Priority:** P2
- **Status:** CONFIRMED (query shape). PLAUSIBLE (cost, which depends on tenant size).
- **Location:**
  - `lib/server/review-counts.ts:73-111`: `count(*)` with 8 `filter` clauses, plus `group by workflow_status`, plus an optional group by client. Each scans every non-deleted review the viewer can see.
  - Callers: `app/(dashboard)/layout.tsx:66-77` (every dashboard render), `components/app-shell/use-needs-reply-count.ts:25` (60 s poll per tab), and `/api/reviews/counts`.
  - `lib/server/analytics-overview.ts`: `loadSummary` (lines 115-128), `loadSeries`, `loadLocations` (lines 259-275) and `loadProviderTotals` (lines 286-305) are four statements, each filtering `r.create_time >= $from and <= $to` or the full tenant. No index has `create_time` (inventory above). The `awaiting_my_approval` queue adds a correlated `review_reply` subquery per row (`review-queues.ts:62-68`).
- **Root cause:** Aggregates are derived at read time and polled.
- **Recommendation:**
  - Counts: keep the single query, but serve the 60 s poll with HTTP `Cache-Control: private, max-age=30` / ETag, or a short per-org memo, and avoid recomputing in the layout when the client already has fresh data.
  - If counts must scale further, maintain `review_queue_count(org, location_id, queue)` by trigger. That is complex because two queues depend on the viewer, so only do it after measurement.
  - Analytics: add `(organisation_id, create_time) where provider_deleted_at is null` **only after W4-03 lands**, so the extra index does not multiply sync write cost. Fold the two `loadProviderTotals` scalar subqueries into one pass.
- **Expected benefit:** Bounded counts and analytics latency as tenants grow.
- **Complexity:** S (cache), M (index), L (materialised counts). **Regression risk:** Low to medium (badge freshness).
- **Tests:** count parity tests (list versus badge) in `tests/**/review-counts*`.
- **Measure:** `pg_stat_statements` mean time for the counts query keyed by tenant size; the `database.tenant_transaction` span histogram (`db.ts:19-24`) filtered to these routes.
- **Dependencies:** W4-03.

### W4-07 Review search is an opaque plpgsql SECURITY DEFINER SRF over a non-tenant-scoped GIN index

- **Priority:** P2
- **Status:** CONFIRMED (definition). PLAUSIBLE (cost).
- **Location:** `supabase/migrations/0011_tenant_review_search.sql:3-30`; `0010_inbox_search_document.sql:3-16`; caller `lib/server/reviews-query.ts:134-146`.
- **Current implementation / evidence:**
  - `search_review_ids` is `language plpgsql ... security definer` and uses `RETURN QUERY`. PL/pgSQL is never inlined, so the planner sees a function scan with a default estimate of 1,000 rows, the whole match set is materialised before the join, and the outer `ORDER BY ... LIMIT` cannot stop early.
  - Inside it, `search_document @@ websearch_to_tsquery(...)` uses GIN `review_search_idx (search_document)`. That index has no `organisation_id`, so common terms ("great", "food") return posting lists for **every tenant**, and they are rechecked against `organisation_id` afterwards.
  - The function runs as the owner, which bypasses RLS; the explicit tenant check at lines 14-19 is correct.
  - UX side note: `websearch_to_tsquery('simple', ...)` has no prefix matching, so "piz" will not find "pizza".
- **Root cause:** Search was isolated into a definer function rather than expressed under RLS.
- **Recommendation:**
  - Inline the predicate into `buildInboxQuery` (the runtime role already has `select (search_document)`, per `0010:18`) and drop the definer SRF.
  - For tenant-scoped GIN, enable `btree_gin` and index `(organisation_id, search_document)`, or partition the search by location.
  - If the hash-equality branches need columns the runtime role cannot read, keep a `language sql stable` (inlinable, _not_ definer) helper.
  - Consider `to_tsquery` with `:*` prefix terms built server-side.
- **Expected benefit:** Search cost scales with the tenant, not the fleet, and is LIMIT-friendly.
- **Complexity:** M. **Regression risk:** Medium (tenant isolation of search; keep the existing tenant test).
- **Tests:** existing cross-tenant search test; add a prefix-search test if adopted.
- **Measure:** `EXPLAIN (ANALYZE, BUFFERS)` of an inbox query with a common word on staging; GIN `idx_tup_read`.
- **Dependencies:** none.

### W4-08 FK columns on cascade paths lack a leading index; bounded retention deletes trigger per-row sequential scans (PostgreSQL 17 has no skip scan)

- **Priority:** P2
- **Status:** CONFIRMED (schema). PLAUSIBLE (cost depends on table sizes).
- **Location:**
  - FKs, scripted report `/tmp/w4_fk.js`. All are `0001` unless noted:
    - `draft.review_id` (cascade)
    - `review_reply.review_id` (cascade)
    - `legal_hold.review_id` (cascade)
    - `approval_decision.review_id` (cascade, `0006`)
    - `approval_decision.draft_id` (set null, `0006`)
    - `publish_attempt.draft_id` (set null)
    - `review_reply.pending_draft_id` (set null, `0039`)
    - `publish_attempt_event.publish_attempt_id` (cascade)
    - `sync_checkpoint.external_location_id`, `location_link.external_location_id` and `webhook_route.external_location_id` (cascade from `external_location`)
  - Delete paths: `lib/server/retention/purge.ts:478-500` (`disconnectedReviews`, then `disconnectedLocations`).
  - PostgreSQL version: `supabase/config.toml:16` (`major_version = 17`); CI uses `postgres:17-alpine` (`scripts/ci/postgres.mjs:35`).
- **Current implementation / evidence:**
  - The existing indexes lead with `organisation_id`, for example `draft_review_idx (organisation_id, review_id, created_at desc)` and `unique(organisation_id, review_id)`. That is fine for RLS-scoped reads.
  - RI triggers, however, issue `DELETE FROM draft WHERE review_id = $1` with no `organisation_id`. PG17 cannot use a btree whose leading column is unconstrained except as a full index scan.
  - `disconnectedReviews` deletes up to 500 reviews per statement. Each deleted review cascades to `draft`, `review_reply`, `legal_hold` and `approval_decision`. Each deleted draft then nulls `approval_decision.draft_id`, `publish_attempt.draft_id` and `review_reply.pending_draft_id`, and each deleted `publish_attempt` cascades to `publish_attempt_event`.
  - Potentially that is thousands of full-table (all-tenant) scans per statement, under `statement_timeout`. `purge.ts:1310` already manages timeouts dynamically, which suggests this pressure has been felt.
- **Root cause:** Composite indexes were designed for tenant reads, not for RI.
- **Recommendation:**
  - Add single-column (or `review_id`-leading) indexes where the cascade fan-out is real: `draft(review_id)`, `review_reply(review_id)`, `approval_decision(review_id)`, `publish_attempt_event(publish_attempt_id)`, and partial `where ... is not null` indexes for the `set null` draft references.
  - Skip the tiny tables (`legal_hold`, `webhook_route`).
  - Alternative: reorder the existing composites to `(review_id, organisation_id, …)`. Do this only if no read relies on the `organisation_id` prefix alone, because it changes read plans.
- **Expected benefit:** Retention and disconnect purges stay linear in the rows deleted.
- **Complexity:** S. **Regression risk:** Low. **Write cost:** one extra btree each on `draft` and `review_reply` (low churn).
- **Tests:** retention integration test with a location of N reviews and drafts; assert it completes within one batch timeout.
- **Measure:** `EXPLAIN ANALYZE delete from review where id in (...)` on staging shows the RI trigger times; `pg_stat_user_tables.seq_scan` on `draft` and `review_reply`.
- **Dependencies:** W4-13.

### W4-09 Performance metrics are persisted one `INSERT … ON CONFLICT` per point (up to ~6,000 per location on first sync)

- **Priority:** P2
- **Status:** CONFIRMED
- **Location:**
  - `lib/server/performance.ts:192-223` (`persistPerformancePoints`)
  - Constants `METRIC_MONTHS = 18` and `RESTATEMENT_DAYS = 10` (`performance.ts:30-31`)
  - 11 metrics (`lib/domain/google-contract.ts:34-46`)
- **Current implementation / evidence:**
  - `for (const point of points) { await sql\`insert into performance_metric_daily ... on conflict ... do update set value = excluded.value\` }`runs inside one`withTenant`.
  - Up to 18 months × 11 metrics (about 6,000 sequential round trips) on a location's first sync, and 10 days × 11 = 110 per location every 6 hours in steady state (`vercel.json` cron `0 */6 * * *`).
  - The update is also unconditional (no `where performance_metric_daily.value is distinct from excluded.value`).
- **Recommendation:** Do one multi-row upsert per chunk (`insert ... select * from unnest($1::text[], $2::date[], $3::bigint[])` or postgres.js `sql(rows, ...)`), chunked at about 1,000 rows, with a `where ... is distinct from` guard. Apply the same pattern to `keywords.ts` and the `upsertLiveLocalPost` loop (`posts.ts:528-539`).
- **Expected benefit:** About 100× fewer round trips per backfill, and shorter transactions.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** existing performance sync tests; add a "no-op resync writes 0 rows" test.
- **Measure:** `pg_stat_statements` calls for this statement; duration of the `persistPerformancePoints` span.
- **Dependencies:** none.

### W4-10 Dashboard layout fans out 5 concurrent tenant transactions, assuming a pool of 10; production runs a pool of 5

- **Priority:** P2
- **Status:** CONFIRMED (inconsistency). PLAUSIBLE (queueing impact).
- **Location:** `app/(dashboard)/layout.tsx:61-77`; the comment there says "five concurrent checkouts sit well inside DATABASE_POOL_MAX (10 by default)". Pool settings: `lib/server/env.ts:12-21` (default 10) and `docs/runbook.md` around line 1269 (production `DATABASE_POOL_MAX=5`).
- **Current implementation / evidence:**
  - With `max: 5`, one dashboard render (after `getSession`'s own transaction) takes every pooled connection on that instance.
  - Page-level prefetches (`lib/server/prefetch.ts:181-253`) and any concurrent request on the same Fluid instance queue behind it. postgres.js queues without a timeout, and there is no queue-wait metric.
- **Recommendation:**
  - Merge the four short reads (clients, the feature flag, counts and directory rows) into **one** `withTenant` with sequential statements: same round trips, one connection. Or cap layout concurrency at 2–3.
  - Fix the comment, and add a pool-wait histogram around `getDatabase().begin`.
- **Expected benefit:** Predictable tail latency under concurrency, and the pool stays under the pooler client limit.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** layout prefetch tests still hydrate all keys.
- **Measure:** add an OTel histogram for the time from `begin()` call to first statement; compare it with `nabapresence.tenant_transaction.duration`.
- **Dependencies:** none.

### W4-11 `processed_webhook_event` dedupe rows are kept forever, and platform health counts them per organisation without a usable index

- **Priority:** P2
- **Status:** CONFIRMED (retention and indexes). PLAUSIBLE (cost).
- **Location:**
  - `lib/server/retention/inventory.ts:155-164` (`action: "redact"`, window text "the dedupe row is kept", `deletes: "none"`)
  - Indexes: `0001:409` and `0007` / `0029` (all partial, on statuses `received`, `failed` and `processing`)
  - `app/api/operations/health/route.ts:70-120` (`tenantAlerting`), called once per organisation in a loop (lines 417-430)
- **Current implementation / evidence:**
  - One row per Pub/Sub notification, never deleted.
  - `tenantAlerting` runs `count(*) ... where status = 'dead'` plus several other status and lease predicates. Under RLS each is `organisation_id = X AND status = 'dead'`. No index covers `dead` or `processed`, and no non-partial index leads with `organisation_id`, so each per-organisation call is a sequential scan of the fleet-wide table, giving O(organisations × events) per platform health call.
  - The same pattern applies to `publish_attempt where status = 'started'`, which is covered only by the global `publish_attempt_started_idx (started_at)`. That is acceptable.
- **Recommendation:**
  - Add a retention step that deletes `processed` and `ignored` dedupe rows older than Pub/Sub's maximum redelivery window. Seven days, the maximum message retention, is defensible; record it as a decision in `inventory.ts`.
  - For health, compute the per-status counts **once fleet-wide** in a SECURITY DEFINER aggregate grouped by `organisation_id`, instead of N RLS-scoped scans. Or add the partial index `(organisation_id) where status = 'dead'`.
- **Expected benefit:** A bounded table, and a health endpoint that stays O(table) instead of O(organisations × table).
- **Complexity:** S–M. **Regression risk:** Low (dedupe beyond the redelivery horizon has no value).
- **Tests:** retention inventory test (it forces the inventory update); a webhook replay test still dedupes within the window.
- **Measure:** `pg_total_relation_size('processed_webhook_event')` growth rate; health route duration.
- **Dependencies:** none.

### W4-12 Rating sorts have no supporting index, and their keyset predicate is not sargable

- **Priority:** P2
- **Status:** PLAUSIBLE
- **Location:** `lib/server/reviews-query.ts:53-60` (`ORDER BY`) and lines 65-84 (`ratingCursor`).
- **Current implementation / evidence:**
  - `order by r.star_rating desc nulls last, r.update_time desc, r.id desc`. `star_rating` is `NOT NULL` (`0001:186`), so the `nulls last` and null-cursor branches are dead code, but the planner still needs an index with matching null ordering.
  - No `review` index starts `(organisation_id, star_rating …)`, so every page of a rating sort sorts all of the tenant's visible reviews. The cursor's `OR` chain also prevents a range scan.
- **Recommendation:**
  - Drop `nulls last` and the null branches, then rewrite the cursor as row comparisons, e.g. `(r.star_rating, r.update_time, r.id) < ($rating, $time, $id)` for desc. `rating_asc` mixes directions, so it needs either `(-star_rating)` or a separate predicate.
  - Add `(organisation_id, star_rating, update_time desc, id desc)` **only if** `EXPLAIN` on a large tenant shows the sort dominating, and after W4-03.
- **Expected benefit:** Index-ordered rating pages.
- **Complexity:** S–M. **Regression risk:** Medium (cursor correctness).
- **Tests:** existing cursor pagination tests for all four sorts; add a duplicate-rating boundary test.
- **Dependencies:** W4-03.

### W4-13 Migration safety: no migration can use `CONCURRENTLY`, and `lock_timeout` is opt-in (8 of 131 files)

- **Priority:** P3
- **Status:** CONFIRMED
- **Location:**
  - `scripts/db-migrate.mjs` (wraps each file in `begin`, unless `-- migrate:no-transaction`)
  - `scripts/migration-rules.mjs:4, 229-271`
  - `rg 'migrate:no-transaction' supabase/migrations` returns 0 files
  - `set local lock_timeout` appears only in `0105`–`0115`
- **Current implementation / evidence:**
  - Index builds on `review` take a SHARE lock that blocks ingest for the duration. `0099_retention_batches.sql:30-36` and `0100_ai_usage_retention.sql:25-31` acknowledge this ("Apply this migration in a low-traffic window").
  - Without `lock_timeout`, a DDL statement queued behind a long transaction blocks every later reader and writer on that table.
  - The runner itself is good: a session advisory lock that refuses port 6543 (`db-migrate.mjs:20-25`).
- **Recommendation:**
  - Default `lock_timeout = '5s'` in the runner, issued as `SET` before each file and overridable per file.
  - Adopt the `-- migrate:no-transaction` + `CREATE INDEX CONCURRENTLY IF NOT EXISTS` pattern for any index on `review`, `audit_log` or `sync_checkpoint` (needed for W4-04, W4-06, W4-08 and W4-12). Add a migration-policy check that rejects plain `create index ... on review|audit_log` in new files.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** `tests/migration-contract.test.ts` gets a rule case.
- **Dependencies:** none.

### W4-14 Index candidates that cost writes and appear unused by current SQL (verify before dropping)

- **Priority:** P3
- **Status:** HYPOTHESIS (static grep only)
- **Location and evidence:** `rg` finds no query whose predicates match these:
  - `raw_review_expiry_idx (raw_content_expires_at) where not null` (`0001:402`). Every purge step is tenant-scoped (`purgeSteps(organisationId)`, `purge.ts:395+`) and matches the `(organisation_id, raw_content_expires_at)` v2 index instead. This one is updated on **every** review upsert (W4-03).
  - `sync_retry_idx` (`0001:398`), `webhook_job_due_idx` and `publish_attempt_job_due_idx` (`0007`): per-org due indexes superseded by the global ones in `0029`.
  - `performance_checkpoint_due_idx` (`0014`) and `keyword_checkpoint_due_idx` (`0017`). Their remaining callers use `coalesce(sc.next_attempt_at, now()) <= now()` (`performance.ts:164`, `keywords.ts:160`), which cannot range-scan them.
  - `webhook_backlog_idx (organisation_id, received_at) where status in ('received','failed')` (`0001:404`).
- **Recommendation:** On production or staging, run `select indexrelname, idx_scan from pg_stat_user_indexes where relname in ('review','sync_checkpoint','processed_webhook_event','publish_attempt')` after a full stats period, then drop those with `idx_scan = 0` (using `DROP INDEX CONCURRENTLY`, W4-13).
- **Complexity:** S. **Regression risk:** Low if the stats are verified.

### W4-15 Location summary's "latest attempt" reads every attempt in the retention window; `profile_sync_attempt` is filtered on an unindexed column

- **Priority:** P3
- **Status:** PLAUSIBLE
- **Location:** `lib/server/location-summary.ts:483-507`; index `profile_sync_attempt_location_idx (organisation_id, external_location_id, created_at desc)` (`0016:106`), while the query filters `location_id` (a column added in `0024`).
- **Evidence:** `select distinct on (location_id) ... from (union all of 7 attempt tables) where location_id = any($ids) order by location_id, at desc` materialises every attempt for the listed locations, then sorts.
- **Recommendation:** Use one `left join lateral (... order by created_at desc limit 1)` per table per location, or keep a `last_publish_attempt_at/area/status` column on a per-location state row. Add or replace the `profile_sync_attempt` index to lead with `(organisation_id, location_id, created_at desc)`.
- **Complexity:** S–M. **Regression risk:** Low.

### W4-16 Minor N+1 and round-trip patterns (each bounded; fold opportunistically)

- **Priority:** P3
- **Status:** CONFIRMED
- **Locations:**
  - `app/api/reviews/bulk/route.ts:116-180`: one tenant transaction per review, max 100 (`lib/contracts/reviews.ts:549`). This is intentional per-item isolation, but `requireLocationAction` and `requireAssigneeEligible` could be computed once per distinct location.
  - `lib/server/notifications/evaluate.ts:529-552` (`buildDigests`): 3–5 queries per member per health tick.
  - `lib/server/reviews.ts:713-722`: a sweep updates `last_seen_at` with a second statement over rows the upsert has just rewritten. Fold it into the upsert to halve row versions on sweeps.
  - `withTenant` itself costs about 4 round trips (`BEGIN`, `set_config`, the work, `COMMIT`; `db.ts:120-135`). `set_config` could be pipelined with the first statement.
  - `claim_due_jobs` recurring arm (`0092`): the `EXISTS` probes `location_link` by `external_location_id` and `connection_task` by `google_connection_id`. No index leads with those columns (the function is a definer with no org predicate), but both tables are small.
  - `take_google_rate_budget` (`0049`): a row lock and update on one hot row per Google request. Sub-millisecond, but it serialises fleet-wide. Watch `n_dead_tup` on `google_rate_bucket`.
- **Recommendation:** Address these when touching the files; not worth a dedicated change.

---

## Top 5 for this workstream

1. **W4-01 (P1):** Advisory-lock transactions are held across Google HTTP calls on session connections. The 60 s idle-in-transaction kill can drop the lock mid-write and fail a request that succeeded. Fix with session-level locks and no `begin()`.
2. **W4-03 (P1):** Review sync rewrites every review on every 15-minute reconcile: non-HOT updates across about 12 indexes, plus media and reply churn. Guard the upsert with `content_hash`.
3. **W4-04 (P1):** The review detail timeline and the posts list scan the tenant's whole `audit_log` (365-day default). Add `(organisation_id, subject_type, subject_id, created_at desc)`.
4. **W4-02 (P1):** The 15-slot session pooler is shared by leases, refresh-lock reconnect polling (every 150 ms) and two connections per bulk child.
5. **W4-08 / W4-05 (P2):** FK cascade paths without leading indexes make retention purges slow. Separately, `app_session` is written on every request; throttle the slide.

## Cross-layer leads for other workstreams

- **Frontend (polling):** six 60 s `refetchInterval` polls per tab (`use-needs-reply-count.ts:25`, `notifications-link.tsx:28`, `use-clients.ts:28`, `use-connections-query.ts:19`, `use-connection-health.ts:28`, `use-connection-workspace.ts:27`). Each one triggers a session write (W4-05) and a tenant transaction. Consider pausing them on `document.hidden` and coalescing them into one endpoint.
- **API / reliability:** after the W4-01 failure mode, `publishCanonicalHours` and the others can return 5xx after Google applied the change. Check that the UI reads the operation receipt rather than showing a hard failure (`hours.ts:737-760`).
- **Product / UX:** inbox search has no prefix matching (`0011_tenant_review_search.sql:24`, `websearch_to_tsquery('simple')`), so partial words return nothing.
- **Observability:** there is no metric for pool checkout wait or session-pooler connection count. `db.ts` records transaction duration only (`db.ts:19-31`).
- **Docs drift:** the comment at `app/(dashboard)/layout.tsx:61-65` assumes `DATABASE_POOL_MAX` is 10, while the runbook (around line 1269) sets production to 5.
- **Security (minor):** `search_review_ids` is SECURITY DEFINER owned by a BYPASSRLS role (`0011:11`; runbook around line 1246). Isolation relies on the explicit `app.organisation_id` check, which is correct today; keep it covered by a test.
- **Retention policy:** `performance_metric_daily`, `notification_delivery(_event)`, `publish_attempt(_event)` and `mutation_operation` are `keep` (unbounded) in `lib/server/retention/inventory.ts`. They grow linearly with fleet activity, so they need a product decision on windows.
