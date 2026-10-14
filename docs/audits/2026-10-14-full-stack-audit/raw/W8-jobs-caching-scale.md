# W8: Background jobs, async processing, caching layers, scalability, cross-layer integration

**Workstream:** W8. Read-only audit of HEAD plus the working tree on `feat/inbox-mail-refinement`, as of 2026-10-14.

## Scope covered

- Job runner: `lib/server/jobs.ts`, `app/api/jobs/run/route.ts`, `claim_due_jobs` / `release_job_lease` (`supabase/migrations/0092_mutation_recovery_jobs.sql`), `next_scheduled_run` / `ensure_recurring_checkpoints` (`0048_fleet_queue.sql`).
- Cron and sync ticks: `vercel.json`, `app/api/sync/{reconcile,presence-resources,performance,keywords,sweep,backfill}`, `app/api/cron/{health,retention}`, `lib/server/{leases,cron-cursor,cron-query,recurring-sync}.ts`, `scripts/scheduler.mjs` (cadence only).
- Runners sharing the tick: `publication-schedule-runner.ts` (`runDueSchedules`), `bulk-listing-runner.ts` (`runDueBulkChildren`), and `notifications/delivery.ts` (`runDeliveries`).
- Google transport, fleet rate budget, token refresh: `lib/server/google/{transport,rate-budget,credentials,connections}.ts`, `0049` budget SQL.
- Review ingest vs reply publish: `lib/server/reviews.ts` (`upsertGoogleReview`, `syncLinkedLocation`), `lib/server/publishing/{intent,settle,retry}.ts`, `app/api/reviews/[id]/publish/route.ts`, `app/api/webhooks/google/pubsub/route.ts`.
- Caching: TanStack Query defaults and per-hook overrides (`lib/queries/*`), React `cache()` users, Next route segment config, `Cache-Control` headers, module-level Maps and singletons in `lib/server`, DB-backed caches (media 5-minute TTL, pause snapshot).
- Inbox cross-layer: `lib/queries/{use-reviews,use-review-detail,use-publish-review,invalidate}.ts`, `lib/inbox/settling.ts`, `components/inbox/{action-bar,sync-reviews-button}.tsx`. Both component files were read only; the second has uncommitted changes, which were left untouched.

**Production hosting (determined):** Vercel Functions in region `iad1`. `vercel.json` defines 9 cron entries (the ledger still says "eight"). Postgres is hosted Supabase behind the transaction pooler (`DATABASE_URL`), plus a session pooler (`DATABASE_SESSION_URL`) for advisory locks. Sources: `docs/release/ledger.md:4-7`, `lib/server/db.ts:51-76`, and `lib/server/cron-query.ts:20-23` ("production has no scheduler process"). `scripts/scheduler.mjs` is legacy/local only (decision D-42, ledger OPS-08). It POSTs, so it takes the inline-walk code path; Vercel GETs take the enqueue path. Every tick route declares `maxDuration = 60`. Whether Fluid compute is enabled, and which plan the project is on, cannot be verified from the repo.

## Commands run (all read-only)

`wc -l`, `cat`, `sed -n`, `rg` and `ls` over the files above. Examples: `rg -n "claim_due_jobs|skip locked|row_number…" supabase/migrations/0092_mutation_recovery_jobs.sql`; `rg "new Map|globalThis\.__" lib/server`; `rg "staleTime|refetchInterval|refetchOnWindowFocus" lib components app`; `rg "Cache-Control|unstable_cache|revalidate|cache\(" app lib next.config.ts`; `rg -o "https://[a-z]+\.googleapis\.com/[a-z0-9]+" lib/server | sort | uniq -c`. No installs, builds, tests, DB access or network calls were made.

## Not covered, and why

- **Runtime numbers.** I measured no per-job latency, DB round-trip time, or `EXPLAIN ANALYZE` cost of `claim_due_jobs` at backlog size. No database or telemetry access was available, and I invented none. The scalability section gives formulas in terms of the latency that needs measuring.
- **Vercel project settings.** Fluid compute, plan, and the cron list after a rollback are dashboard-only.
- **Bulk family adapters** (`bulk-families/*`), the internals of `notifications/retry.ts`, retention purge SQL, privacy withdrawals and invitation delivery. I checked only their budget and loop shape, not their per-item correctness.
- **Publishing intent concurrency.** I did not trace two publishers on the same review in depth (idempotency key = org + review + body hash, per `docs/architecture.md`).

---

## Scalability arithmetic (from code constants)

**The `vercel.json` page sizes are mostly dead.** `/api/sync/reconcile|performance|keywords` GETs validate `maxOrganisations` / `maxLocations` and then only call `enqueueRecurring()`, one SQL statement arming a checkpoint per linked location (`app/api/sync/reconcile/route.ts:303-304`; `lib/server/recurring-sync.ts:55-70`). So "reconcile 100 orgs / 15 min" and "performance 100 × 25 / 6 h" are not the real limits. Three things are:

1. **The job runner.** `/api/jobs/run` is one tick per minute under the fleet lock `naba:jobs` (`app/api/jobs/run/route.ts:10-14`).
   - The tick budget is 45 s inside a 60 s `maxDuration`. When billing is on, the billing slice takes up to `min(15 s, 45/4)` = 11.25 s of it (`lib/server/jobs.ts:1079`).
   - Workers: `JOBS_CONCURRENCY` = 4, `JOBS_BATCH_SIZE` = 25, `JOBS_PER_ORGANISATION` = 3 (`lib/server/env.ts:294-296`).
   - Worker-seconds per tick ≤ 4 × 45 = **180** (135 with the billing slice fully used).
   - Reconcile is due every 15 minutes per linked location (`lib/server/reviews.ts:417`). Per 15 minutes the capacity is 15 × 180 = **2,700 worker-seconds**, shared by every kind.
   - Freshness ceiling: **L_max ≈ 2,700 / T_r**, where T_r is the mean wall time of one reconcile job (token + review list page + page transaction of up to ~4 statements per review + settle). That is 2,700 locations at T_r = 1 s, or 900 at T_r = 3 s.
   - Herds use the same capacity: performance every 6 h (L jobs, 1 call each), keywords every 24 h (L jobs × pages), and the 01:30 sweep (L jobs × ≤5 pages).
   - Raising `JOBS_CONCURRENCY` past `DATABASE_POOL_MAX` (default 10, `lib/server/env.ts:12-21`) just queues on the pool.
   - **Instrument:** `jobs.item.duration{kind}`, plus gauges for due backlog per kind and age of the oldest due item. The existing `nabapresence.tenant_transaction.duration` and `nabapresence.google.request.duration` histograms cover parts of this.
2. **The Google fleet budget** (`lib/server/google/rate-budget.ts`). `GOOGLE_API_REQUESTS_PER_MINUTE` = 240, so `windowCapacity` = floor(240/6) = **40 requests per 10 s window per API host**, and the worst rolling minute is 40 × 7 = 280.
   - Reviews list, reply PUT/GET, posts, media and food menus all share **one** bucket: `mybusiness.googleapis.com` (v4).
   - Per 15 minutes that host allows 15 × 240 = **3,600** calls. A 45 s tick spans about 4.5 windows, so the runner alone gets ≤ ~180–200 v4 calls per tick, or ~2,700–3,000 per 15 minutes.
   - Reconcile needs at least 1 v4 call per location per slot. The v4 ceiling is therefore **L ≤ ~3,000** before counting:
     - presence sweeps: ≥3 v4 calls (posts, media, food menus) × ≤50 location-visits = ≥150 per 15 minutes;
     - daily sweep pages, webhook syncs and interactive reads and replies.
   - Performance uses a separate host bucket: the 6-hourly herd of L calls takes ≥ L/240 minutes to drain. At L = 2,400 that is ≥ 10 minutes.
   - The per-process pacer (8 rps × 45 s = 360 per tick) is not binding.
3. **Presence resources** (`app/api/sync/presence-resources/route.ts`). Each fire handles ≤ 10 orgs × ≤ 5 locations × 6 serial resources, fires 4 times an hour, and has a 45 s budget.
   - Fleet ceiling: ≤ **50 location-visits per fire = 200 per hour = 4,800 per day**, and less when one location takes T_p > 0.9 s, since then 45 / T_p < 50.
   - The 10-minute `DUE_AFTER_SUCCESS_MS` (line 46) is reachable only while the fleet has ≤ 50 linked locations. With L_p linked locations each is revisited every ≥ L_p / 200 hours: 5 h at 1,000 locations, 24 h at 4,800.
   - Per organisation the cap is 5 locations per walk. An org with N locations sees each one every ⌈N/5⌉ walk cycles, and a walk cycle is ≥ ⌈O/10⌉ fires × 15 min. At O = 40 and N = 20 that is 4 cycles × 1 h = **4 h**.

Things that degrade well: `next_scheduled_run` skips missed slots (floor + 1, `0048_fleet_queue.sql:43-63`), so a reconcile backlog lowers freshness instead of growing the queue without bound. Recurring kinds have back-off, and performance/keywords have a dead-letter ceiling.

---

## Findings

### W8-01 One fleet-wide job tick (4 workers, about 45 s per minute) caps all recurring work, and the code that would allow scale-out is already there

- Priority: P1
- Status: CONFIRMED (structure); the throughput figure is PLAUSIBLE until T_r is measured
- Location: `app/api/jobs/run/route.ts:10-14` (`runJobsTick`), `lib/server/jobs.ts:51-56`, `lib/server/jobs.ts:1111-1121`, `lib/server/env.ts:294-296`
- Current implementation / Evidence / Root cause:
  - Every recurring reconcile, performance and keyword sync now runs through the runner (enqueue model, 0048).
  - The runner is one `withAdvisoryLock("naba:jobs")` tick per minute with `runPool(batch, JOBS_CONCURRENCY=4)`. The file header says the lock "is now an optimisation… rather than the thing that makes claiming safe", because row leases with `FOR UPDATE SKIP LOCKED` (`0092:203-324`) already make concurrent claimers safe.
  - Capacity is therefore fixed at about 180 worker-seconds per minute, whatever the number of instances. The scalability section derives L_max ≈ 2,700 / T_r for 15-minute review freshness, before the herds take their share.
- Recommendation:
  - Measure T_r per kind first.
  - Then allow K parallel ticks: either replace the single `naba:jobs` lock with K lock slots (`naba:jobs:0..K-1`, take the first free one), or drop the lock and rely on row leases.
  - Tune `JOBS_CONCURRENCY` against `DATABASE_POOL_MAX` and the pooler's connection limit.
  - Alternatives: a second cron entry (e.g. `/api/jobs/run?lane=recurring`) dedicated to recurring kinds, so user-facing kinds get their own lane (see W8-03).
- Expected benefit: throughput scales roughly linearly with K until the Google bucket binds (~3,000 v4 calls per 15 minutes).
- Complexity: M. Regression risk: Medium (lease expiry vs longer runs; the heartbeat semantics of `naba:jobs` in `ops-liveness.ts`).
- Tests: integration test with two concurrent `runDueJobs` calls claiming disjoint sets (SKIP LOCKED); liveness when one of K slots is skipped.
- Dependencies: W8-03, W8-10, and pooler sizing (W-DB).

### W8-02 Scheduled posts and bulk children only get the leftover tick budget, so a recurring backlog starves them and posts are recorded "missed"

- Priority: P1
- Status: CONFIRMED (code path); how often it happens depends on backlog (PLAUSIBLE)
- Location: `lib/server/jobs.ts:1111-1141` (`runDueJobs`), `lib/server/publication-schedule-runner.ts:936-947` (`runDueSchedules`), `lib/server/bulk-listing-runner.ts:643-649`, `supabase/migrations/0118_post_schedule_dispatch.sql:15-19,191,210`
- Current implementation / Evidence / Root cause:
  - The main claim loop runs `while (Date.now() + GOOGLE_TIMEOUT_MS <= deadline)` until the batch comes back empty.
  - Bulk children, then scheduled posts, then privacy and invitations run afterwards with `budgetMs: deadline - Date.now()`.
  - Both `runDueBulkChildren` and `runDueSchedules` claim only `while (Date.now() + GOOGLE_TIMEOUT_MS <= deadline)`, and `GOOGLE_TIMEOUT_MS` = 15 s.
  - Whenever the main queue still has due work at t ≈ 30 s, the main loop exits with < 15 s left. Neither post-loop runner then claims anything.
  - A scheduled post may only start inside its 5-minute window (`intended_at <= now() < deadline_at`). After the window closes, `sweepScheduledOccurrences` records it `outside_dispatch_window`.
  - A backlog that outlasts five ticks therefore turns every post due in that period into a missed post. Reconcile herds are phase-locked (W8-03), so the backlog peaks right at :00/:15/:30/:45.
  - If the backlog is permanent (L × T_r > 2,700 s per 15 minutes), scheduled posts and bulk listing children never run at all.
- Recommendation:
  - Run time-boxed, user-intent work **first**: scheduled posts (which have hard windows), then bulk, each with a reserved slice (e.g. ≤ 10 s, as billing already has).
  - Or fold them into `claim_due_jobs` as kinds with priority (W8-03).
  - Alternative: give them their own cron route and lock.
- Expected benefit: scheduled posts publish inside their window whatever the sync backlog.
- Complexity: S (reorder plus a slice) to M (unified claim). Regression risk: Low–Medium.
- Tests: unit test of `runDueJobs` with a stubbed claim that never empties; assert `runDueSchedules` is called with ≥ its reserved budget.
- Dependencies: W8-03.

### W8-03 `claim_due_jobs` has no priority by kind, and recurring work is phase-locked into herds, so user-facing retries and recoveries queue behind syncs

- Priority: P1
- Status: CONFIRMED
- Location: `supabase/migrations/0092_mutation_recovery_jobs.sql:182-195` (`candidate` CTE), `0048_fleet_queue.sql:43-63,68-105`, `lib/server/reviews.ts:874`
- Current implementation / Evidence / Root cause:
  - Candidates are filtered with `row_number() over (partition by organisation_id order by due_at, id) <= p_per_org`, then `order by due_at, id limit p_limit`. Nothing ranks by kind.
  - `ensure_recurring_checkpoints` arms every location at the same `now()`, and `next_scheduled_run(scheduled_for, interval)` keeps each checkpoint on that grid for ever. So every reconcile checkpoint in the fleet comes due at the same instant every 15 minutes, every performance checkpoint every 6 h, and every keyword checkpoint every 24 h.
  - A publish `retry` (a 429 back-off), `recover` (an ambiguous reply readback) or `mutation_recover` that comes due 30 s after a herd is ranked behind every older item in its organisation. An org with N linked locations needs ⌈N/3⌉ claim batches before its reply retry is claimed. Across orgs it sits behind the whole fleet's herd.
  - Result: a reply the UI shows as "Sending" (polling every 5 s; W8-12) can take minutes or longer to settle under load.
- Recommendation:
  - Add a kind-priority column to `due`, e.g. `retry/recover/mutation_recover/webhook` = 0, `checkpoint` = 1, recurring = 2. Order by `(priority, due_at, id)` both inside the partition and outside.
  - Spread recurring phases: on first arming use `now() + random() * interval`, or a stable hash of the location id modulo the interval, so the herd flattens into a constant trickle.
- Expected benefit: user-visible work is bounded by one batch's latency, and per-tick load is flat instead of peaking.
- Complexity: S–M (SQL migration). Regression risk: Medium; it changes fairness. Starvation of recurring work stays bounded because the user-facing kinds are low volume.
- Tests: a DB test with 100 due recurring rows plus 1 retry due later; assert the retry is in the first claim. A test that newly armed checkpoints are spread across the interval.
- Dependencies: W8-01, W8-02.

### W8-04 Review sync can overwrite a just-published or in-flight reply with stale Google state (nulls the body, reverts workflow to `new`)

- Priority: P1
- Status: CONFIRMED (code path); the race window is PLAUSIBLE (requires overlap)
- Location: `lib/server/reviews.ts:283-289`, `:333-383` (`upsertGoogleReview`); `lib/server/publishing/intent.ts:308-322`; `lib/server/publishing/settle.ts:29-56` (`applyPublishedReply`)
- Current implementation / Evidence / Root cause:
  - `syncLinkedLocation` lists reviews from Google **outside** any transaction, then upserts each page inside a tenant transaction. Nothing guards for staleness.
  - When Google's payload has no reply, it runs `update review_reply set current_body = null, publish_status = 'deleted' … where publish_status in ('accepted','published','rejected')`.
  - The publish intent sets `current_body = <new body>, publish_status = 'accepted'` _before_ the provider PUT (intent.ts:321-322).
  - Interleaving 1:
    1. A reconcile, webhook or Sync-now read of Google completes before the PUT lands.
    2. The publish intent commits.
    3. The sync transaction commits, setting `current_body = NULL` and `publish_status = 'deleted'`.
    4. The publish settle sets `publish_status = 'published'` but never rewrites `current_body`.
    5. The result is a reply that is "published" locally with no body until a later sync sees it on Google (≤ 15 minutes).
  - Interleaving 2, if the settle committed first: `workflow_status = case … when review.workflow_status in ('published','rejected') then 'new'` puts the review **back into the needs-reply queue**.
  - The page transaction also writes `content_hash` and `update_time` from the stale read.
  - No row-level ordering exists: the upsert compares neither `reviewReply.updateTime` with `review_reply.google_reply_updated_at` nor any in-flight `publish_attempt`.
- Recommendation:
  - In `upsertGoogleReview`, skip reply and workflow overwrites while an in-flight `publish_attempt` exists for the review (`status in ('started','ambiguous','retryable')`) or `publish_status = 'accepted'`.
  - Otherwise apply them only when the incoming `reviewReply.updateTime` is ≥ the local `google_reply_updated_at`. A `WHERE` on the reply update or a `CASE` guard does this.
  - Have `applyPublishedReply` also set `current_body` from the provider body, so the settle is self-healing.
- Expected benefit: removes phantom "needs reply" reversions and empty published replies, which cause duplicate operator work and confusing UI.
- Complexity: M. Regression risk: Medium; it must not block legitimate external edits or deletes. Use update-time ordering, not a blanket skip.
- Tests: integration test that starts a publish intent, runs `upsertGoogleReview` with a payload lacking the reply, settles the publish, then asserts body and workflow. A test of the reverse order (settle, then a stale sync commit).
- Dependencies: W-data/publishing workstream.

### W8-05 Fleet locks are session advisory locks with no expiry: a frozen or killed function can hold a tick's lock indefinitely

- Priority: P1
- Status: PLAUSIBLE (the code is CONFIRMED; the platform behaviour is a HYPOTHESIS)
- Location: `lib/server/leases.ts:153-189` (`withAdvisoryLock`), `lib/server/db.ts:62-76` (`withSessionConnection`)
- Current implementation / Evidence / Root cause:
  - Each tick takes `pg_try_advisory_lock(hashtext(key))` on a dedicated session-pooler connection with no `idle_session_timeout`, keepalive or statement settings. It holds that connection for the whole run while the work uses other pooled connections, so the session sits idle for about 45–60 s.
  - The lock is released only by the `finally` unlock, or when Postgres sees the client disconnect.
  - If Vercel ends the invocation at `maxDuration` (comments in `cron-cursor.ts:33-35` and `retention/cycle.ts:61` acknowledge that "maxDuration runs no catch block") and the instance is frozen instead of torn down, the socket can stay open. Every later fire then returns `{skipped:true}`, recording `consecutive_skips`, until the pooler or TCP notices.
  - Overrun is possible: `performance` and `keywords` items get no tick deadline (`jobs.ts` `runJob` cases call `syncDuePerformance` / `syncDueKeywords` without `deadline`). A keyword job started at t ≈ 44 s can make several 15 s page calls, and the post-loop runners add more.
  - The same pattern guards `naba:presence-resources`, `naba:health` and `naba:retention`.
- Recommendation:
  - Set `idle_session_timeout` on the lock connection (e.g. 90 s, above the 60 s `maxDuration`) through the postgres.js `connection` options, so a stranded holder is killed server-side.
  - Or replace the advisory lock with a lease row (`update ops_lease set holder=$id, expires_at=now()+90s where name=$k and (expires_at < now() or holder is null)`), which self-heals.
  - Also pass `tick.deadline` into the performance and keyword syncs.
- Expected benefit: bounded recovery (≤ 90 s) from a killed tick, instead of one that cannot be bounded.
- Complexity: S. Regression risk: Low.
- Tests: unit test that `withSessionConnection` sets the timeout; integration test that a killed holder's lock is free after the timeout.
- Dependencies: W7 (ops/liveness alerts on `consecutive_skips`).

### W8-06 Interactive and background Google calls share one budget bucket with no reservation, so user reply publishes queue behind sync herds or fail with 429

- Priority: P2
- Status: PLAUSIBLE
- Location: `lib/server/google/rate-budget.ts:76-110` (`budgetsFor`), `:131-170` (`acquireGoogleBudget`); `lib/server/google/transport.ts:343-372`
- Current implementation / Evidence / Root cause:
  - The bucket key is the host. A reply PUT (`mybusiness.googleapis.com/v4/…/reply`, mode `mutation`, 20 s deadline) draws from the same 40-per-10-s bucket as reconcile lists, sweeps, posts, media and food menus.
  - The runner's 4 workers (plus presence and webhooks) can take every slot in a window during a herd (W8-03).
  - An interactive call waits up to its deadline and otherwise throws 429 `google_rate_limited`, which the publish route maps to HTTP 429.
- Recommendation:
  - Give background callers a lower effective capacity (e.g. 75 % of window capacity) by passing a `priority` to `acquireGoogleBudget`; interactive calls use the full capacity.
  - Or keep separate `bg:` and `fg:` sub-buckets that sum to the limit.
- Expected benefit: user writes stay responsive under background load.
- Complexity: S–M. Regression risk: Low.
- Tests: unit test of capacity selection by priority; DB test of `take_google_rate_budget` with two capacities.
- Dependencies: W8-03.

### W8-07 Presence-resources cursor skips the rest of a half-walked organisation, and the freshness ceiling is far below its 10-minute target

- Priority: P2
- Status: CONFIRMED
- Location: `app/api/sync/presence-resources/route.ts:230` (`where organisation_id > cursor`), `:246` (`lastProcessedOrganisationId = organisation.id`, set _before_ the work), `:316-324` (`nextCursor`); `lib/server/cron-cursor.ts:88-91`
- Current implementation / Evidence / Root cause:
  - When the 45 s budget stops inside an org (line 260), `nextCursor` is that org.
  - The comment at lines 312-316 says "the rest of its locations are the next tick's work". The next fire, however, queries `organisation_id > cursor` and skips the org until the walk wraps.
  - The reconcile walk avoids exactly this: it only advances `lastProcessedOrganisationId` after the org completes (`app/api/sync/reconcile/route.ts:222-229`).
  - Ceiling math (scalability section): ≤ 200 location-visits per hour fleet-wide, and one location per org is revisited only every ⌈N/5⌉ walk cycles.
  - All 6 resources run serially with ≥ 6 Google calls per location. Three of them go to the shared v4 bucket.
  - The budget check is only between locations, so one location started at t ≈ 44 s can run 6 × (≤ 15 s per call) past the 60 s `maxDuration` (W8-05).
- Recommendation:
  - Set `lastProcessedOrganisationId` only after an org finishes, and seed it from the incoming cursor (mirror reconcile).
  - Move presence resources into the job queue as a per-location recurring kind (as 0048 did for reconcile), so they inherit fairness, leases and runner scaling.
  - Run the 6 resources with bounded concurrency (2–3) per location.
- Expected benefit: no starved tail inside large orgs; freshness scales with the runner instead of a fixed 50 locations per fire.
- Complexity: S (cursor) / M (queue migration). Regression risk: Low / Medium.
- Tests: route test where the budget expires inside org #1 of 3; assert the next fire's query includes org #1.
- Dependencies: W8-01.

### W8-08 "Sync now" takes the fleet-wide `naba:reconcile` lock: false cross-tenant contention, no per-location exclusion, and a silent truncation shown as "Up to date"

- Priority: P2
- Status: CONFIRMED
- Location: `app/api/sync/reconcile/route.ts:255-283` (`runReconcilePage`), `:136-147` (per-location budget break), `:232-241` (session `nextCursor` always null, no `truncated` flag); `components/inbox/sync-reviews-button.tsx:38-75`
- Current implementation / Evidence / Root cause:
  - An owner's Sync now holds the _fleet_ lock for up to `RECONCILE_BUDGET_MS` = 45 s.
  - A different organisation pressing Sync now in that window gets `skipped`, and the button says "A sync is already running" (line 40-42), although nothing of theirs is running.
  - The lock gives no protection against the runner's `reconcile` jobs, which do not take `naba:reconcile`. A runner job and a Sync now can therefore sync the same checkpoint concurrently: `syncLinkedLocation`'s upsert unconditionally sets `status='running'` (`reviews.ts:491-501`).
  - When the 45 s budget stops a session walk part-way, the response carries no truncation signal, and the button toasts "Up to date" for locations it never checked.
- Recommendation:
  - Use a per-organisation lock (`naba:reconcile:<orgId>`) or none. Make `syncLinkedLocation`'s checkpoint claim conditional (`… where status <> 'running' or lease_expires_at < now()`) so the two paths exclude per location.
  - Return `truncated` / `remainingLocations` for session walks and surface it in the toast.
- Expected benefit: no cross-tenant blocking, no duplicate Google reads, honest UI.
- Complexity: S–M. Regression risk: Low.
- Tests: two orgs calling Sync now concurrently both succeed; a session walk with the budget exhausted returns `truncated: true`.
- Dependencies: frontend workstream for the toast copy.

### W8-09 The bulk runner fans out a whole claimed batch with `Promise.all` (up to 25 concurrent), ignoring `JOBS_CONCURRENCY`; an unguarded await can fail the tick while children are still writing

- Priority: P2
- Status: CONFIRMED
- Location: `lib/server/bulk-listing-runner.ts:649-688` (`runDueBulkChildren`); `lib/server/jobs.ts:1128-1161`
- Current implementation / Evidence / Root cause:
  - `claim_due_bulk_children(JOBS_BATCH_SIZE=25, …, min(3, BULK_MAX_RUNNING_PER_ORGANISATION=2))` then `await Promise.all(claimed.map(…))`. That is up to 25 concurrent children across ≥ 13 orgs, each doing DB transactions and Google reads and writes, against a pool of 10 (`DATABASE_POOL_MAX`).
  - The deadline is not checked inside the batch.
  - Inside each callback, the `withTenant` owner lookup at line 677 sits **outside** the try/catch. If it rejects, `Promise.all` rejects while sibling children keep running. `runDueBulkChildren` throws, and `runDueJobs` does not catch it (unlike billing and the schedule sweep). The route answers 500 and `withAdvisoryLock` releases `naba:jobs` while Google writes are still in flight.
  - Privacy erasures and invitations are skipped for that tick.
- Recommendation:
  - Reuse `runPool` (from `jobs.ts`) with `JOBS_CONCURRENCY` and the deadline.
  - Move the owner lookup inside the try.
  - Wrap each post-loop runner call in `jobs.ts` in its own `.catch` (as billing is) so one failure cannot skip the others.
- Expected benefit: bounded pool and quota pressure; one failure is contained.
- Complexity: S. Regression risk: Low.
- Tests: stub the owner lookup to throw for one child; assert the other children settle, the tick returns, and `runDuePrivacyWithdrawals` still runs.
- Dependencies: W8-10.

### W8-10 The fleet Google budget fails open after a 2 s DB timeout, which is most likely exactly when concurrency saturates the pool

- Priority: P2
- Status: PLAUSIBLE
- Location: `lib/server/google/rate-budget.ts:33` (`BUDGET_TIMEOUT_MS = 2_000`), `:147-165`
- Current implementation / Evidence / Root cause:
  - `take_google_rate_budget` runs on the shared pool (`getDatabase()`, `max: 10`).
  - On timeout it logs `google.rate_budget_unavailable` and `break`s, so the request proceeds on local pacing alone.
  - Pool saturation happens under fan-out (W8-09's 25 concurrent children, interactive bursts). That is exactly when many callers are waiting, so the fleet limit is bypassed at peak and a Google 429 becomes more likely. The 429 does then trigger the fleet `blocked_until`.
- Recommendation:
  - Fail closed for background callers (throw the retryable `google_rate_limited`, so the job backs off) and stay fail-open only for interactive calls.
  - Or take the budget on a small dedicated pool.
- Expected benefit: the quota stays honoured under load.
- Complexity: S. Regression risk: Low.
- Tests: unit test with a budget query that times out and a `priority: background` caller → throws.
- Dependencies: W8-06.

### W8-11 Publish mutation errors do not invalidate the review caches, so the server's `failed`/ambiguous state is invisible and the settling poll never starts

- Priority: P2
- Status: CONFIRMED
- Location: `lib/queries/use-publish-review.ts:9-18` (`onSuccess: invalidate` only); `app/api/reviews/[id]/publish/route.ts:50-64`; `components/inbox/action-bar.tsx:208-211`
- Current implementation / Evidence / Root cause:
  - The publish route throws 502 `google_mutation_ambiguous`, 409 or 429 _after_ the server has already moved state: the review is at `publish_requested` with an ambiguous attempt, or at `failed`.
  - Only `onSuccess` invalidates. The error path just shows a toast.
  - The cached detail and list keep the pre-publish state, and `settlingInterval` sees no `publish_requested` row, so no 5 s poll starts. The UI is stale until the 30 s `staleTime` passes and the window regains focus.
  - The operator may press Publish again. Server idempotency (same body hash) makes that safe, but it is a confusing UX.
- Recommendation: use `onSettled: invalidate`, or `onError` for codes where the server state changed (`google_mutation_ambiguous`, `google_publish_failed`, 429). Approval and delete hooks have the same pattern, so check them too.
- Expected benefit: the pane reflects server truth right after an error.
- Complexity: S. Regression risk: Low.
- Tests: hook test asserting invalidation after a 502 from `publishReview`.
- Dependencies: W1 (mutations/queries).

### W8-12 The inbox settling poll re-fetches every loaded page every 5 s with no bound, including replies parked for hours or days

- Priority: P2
- Status: CONFIRMED (code); load impact PLAUSIBLE
- Location: `lib/queries/use-reviews.ts:20-25`, `lib/inbox/settling.ts:16-36`, `lib/queries/use-review-detail.ts:17-19`; parking constants at `lib/server/jobs.ts:186` (`RECOVERY_PARK_MS` 15 min, `RECOVERY_PARK_LIMIT` "14 days") and `:736` (`BILLING_HOLD_MS` 1 h)
- Current implementation / Evidence / Root cause:
  - `useInfiniteQuery` with `refetchInterval` returning 5,000 while any row is `publish_requested`. An infinite query refetch re-requests **every loaded page** in sequence.
  - The comment says the poll is "Deliberately unbounded".
  - A reply blocked on reconnect stays `publish_requested` for up to 14 days; one held by billing waits in 1 h steps.
  - Each visible tab with P loaded pages then issues P list requests + 1 detail + counts every 5 s. Every request also runs a session UPDATE (W8-13) and a tenant query.
- Recommendation:
  - Back off the interval (5 s → 15 s → 60 s) by age, using `query.state.dataUpdateCount` or the attempt's `next_attempt_at`, which could be returned in the row.
  - Poll only the detail and the affected IDs (a small `/api/reviews/status?ids=` endpoint) instead of all pages.
  - Stop polling when the attempt is parked (`reconnect_blocked`, `billing_read_only`) and show that state.
- Expected benefit: much lower steady API and DB load from idle tabs.
- Complexity: S–M. Regression risk: Low.
- Tests: hook test that the interval grows; a parked row stops the poll.
- Dependencies: W8-13; API contract for the parked state.

### W8-13 Every authenticated request writes `app_session` (including 5 s and 60 s polls)

- Priority: P2
- Status: CONFIRMED
- Location: `lib/server/session.ts:214-229` (inside `getSession`, `cache()`-wrapped at `:245`)
- Current implementation / Evidence / Root cause:
  - `update app_session set last_seen_at = now(), expires_at = least(…)` runs on every server request. React `cache()` dedupes only within one RSC render; route handlers each call it once.
  - Background polls per visible tab: needs-reply count, notifications, clients, connections and connection health at 60 s each; settling at 5 s (W8-12).
  - Each poll writes WAL and creates a dead tuple. Parallel queries from one page serialise on the same row lock.
- Recommendation:
  - Throttle the write: `… where id = $1 and last_seen_at < now() - interval '60 seconds'`. The idle-expiry slide is measured in days (`SESSION_IDLE_DAYS`), so minute granularity is enough.
- Expected benefit: roughly one session write per minute per session instead of one per request.
- Complexity: S. Regression risk: Low (the idle window only moves at minute resolution).
- Tests: session test showing two lookups within 60 s produce one update.
- Dependencies: auth workstream.

### W8-14 Listing GETs read Google live on every request; only media has a server-side cache

- Priority: P2
- Status: CONFIRMED (code); quota impact PLAUSIBLE
- Location: `lib/server/hours.ts:261-266` (`getHoursState` → `readLiveHours`), `lib/server/profile.ts:246-260` (`getProfileState` → `readProfileStateBundle`), `lib/server/food-menus.ts:222` (`getFoodMenusState` → `readLiveFoodMenus`), `lib/server/place-actions.ts:109-116`, `lib/server/posts.ts:688`; contrast `lib/server/media.ts:190-191` (`MEDIA_CACHE_TTL_MS` 5 min); `lib/queries/query-client.ts:7-9`
- Current implementation / Evidence / Root cause:
  - The hours, profile, food-menu, place-action and posts GET routes call Google every time.
  - On the client, TanStack defaults (`staleTime: 30_000`, `refetchOnWindowFocus: true`) mean every focus after 30 s re-hits Google.
  - Each read draws on the shared bucket (W8-06), where it competes with background sync. Presence-resources already records `presence_resource_reconcile_state.last_succeeded_at`, but the GETs do not use it.
- Recommendation:
  - Adopt media's pattern for every read-only live surface: serve the stored observation when it is younger than N minutes, and offer an explicit "Refresh from Google" (`refresh: true`).
  - Alternatively raise `staleTime` for these keys to several minutes and disable focus refetch.
- Expected benefit: fewer Google calls per user session; faster page loads.
- Complexity: M. Regression risk: Medium. Readbacks and publish preflights must keep forcing a live read.
- Tests: route test where a second GET within the TTL makes no Google call; `refresh=true` bypasses the cache.
- Dependencies: W8-06; frontend.

### W8-15 A token-refresh waiter opens a new session-pooler connection every 150 ms

- Priority: P2
- Status: CONFIRMED (code); pooler pressure PLAUSIBLE
- Location: `lib/server/google/connections.ts:394` (`REFRESH_WAIT_POLL_MS = 150`), `:433-470` (`refreshUnderLock` loop)
- Current implementation / Evidence / Root cause:
  - On a failed `pg_try_advisory_lock`, the loop closes the connection, sleeps 150 ms, re-reads the row, and opens a **new** `withSessionConnection` client.
  - The wait lasts up to `GOOGLE_TIMEOUT_MS + 5 s` = 20 s, so each waiter on another instance can churn about 130 connect/teardown cycles against the session pooler. Its slot count is small, and the job and cron locks need it too.
  - The in-process `refreshesInFlight` map dedupes only within one instance.
- Recommendation:
  - Poll the token row through the transaction pool, which `loadFromTenant` already does. Retry the lock only every ~1 s, or use a blocking `pg_advisory_lock` with `lock_timeout`, holding one connection.
- Expected benefit: no pooler slot churn during refresh storms (e.g. many jobs for one connection right after expiry).
- Complexity: S. Regression risk: Low.
- Tests: unit test counting `withSessionConnection` calls during a 2 s wait.
- Dependencies: none.

### W8-16 The main job loop claims a full batch near the end of the budget, stranding leases for 105 s

- Priority: P3
- Status: CONFIRMED
- Location: `lib/server/jobs.ts:1106` (`leaseSeconds = budget/1000 + 60` = 105 s), `:1111-1121`, `:205-231` (`runPool`)
- Current implementation / Evidence / Root cause:
  - A batch of 25 can be claimed at t ≈ 30 s. With 4 workers and multi-second items, many items never start before the deadline. They keep their 105 s lease and are delayed about two ticks.
  - The batch also blocks on its slowest item before the next claim (head-of-line blocking).
- Recommendation:
  - Claim `min(BATCH, concurrency × ceil(remaining / expected))`, or let each worker claim its own small batch, with `release_job_lease` for unstarted items at the deadline.
- Complexity: S. Regression risk: Low.
- Tests: unit test that unstarted items get their lease released.
- Dependencies: W8-01.

### W8-17 Cron query parameters on enqueue routes are ignored, and the docs drift

- Priority: P3
- Status: CONFIRMED
- Location: `vercel.json:11-26`; `app/api/sync/reconcile/route.ts:300-305`; performance and keywords GET (`route.ts:69-73` / `66-70`); `docs/release/ledger.md:4` ("eight Vercel Cron entries"; `vercel.json` has 9 with billing); `lib/server/cron-query.ts:18-23` (comment says each fire runs one page from the head, which is out of date since `followCronCursor` and enqueueing)
- Evidence: `maxOrganisations=100&maxLocations=25` is parsed for validation only. `enqueueRecurring` arms the whole fleet.
- Recommendation: drop the parameters from `vercel.json`, or document them as validation-only; update the ledger count and the `cron-query.ts` comment.
- Complexity: S. Regression risk: None.
- Tests: `tests/server/vercel-cron.test.ts` asserts the expected paths, so update it.
- Dependencies: W7.

### W8-18 The pause snapshot is fixed for a whole tick

- Priority: P3
- Status: CONFIRMED
- Location: `lib/server/jobs.ts:1041,1056` (one `loadPauseSnapshot()` per tick), `lib/server/pause-controls.ts:184` (`PAUSE_CACHE_TTL_MS = 5_000`)
- Evidence: the cache claims a 5 s stop latency, but `kinds` is computed once and reused for every claim in the ≤ 45 s loop. An operator pause can therefore take up to ~50 s to stop new claims.
- Recommendation: re-read `claimableKinds` before each `claimBatch`. It is cheap thanks to the 5 s cache.
- Complexity: S. Regression risk: None.
- Tests: pause flipped between batches; assert the next claim excludes the kind.

### W8-19 Webhook retry back-off is short (0.5 s base), so any outage longer than ~5 minutes dead-letters notifications

- Priority: P3
- Status: CONFIRMED
- Location: `lib/server/webhooks.ts:55-58`, `lib/server/jobs.ts:333-341` (`retryDelayMs(retryCount+1)` with default 500 ms base and 30 s cap, `lib/domain/retry.ts`), `WEBHOOK_MAX_RETRIES = 5`
- Evidence: the five delays are about 0.5–8 s. The runner ticks every 60 s, so the retry budget is spent in ~5 ticks.
- Impact: dead webhook rows and audit noise. Reconcile backfills the reviews within 15 minutes, so no data is lost.
- Recommendation: use the checkpoint curve (`30 s` base, `30 min` cap) for webhook retries, or park on `reconnect` as publish recovery does.
- Complexity: S. Regression risk: Low.

### W8-20 Health tick fairness is random, with no coverage guarantee

- Priority: P3
- Status: CONFIRMED
- Location: `app/api/cron/health/route.ts:29-60` (random start, 45 s budget, serial per-org evaluate and deliver)
- Evidence: with coverage fraction f = K/O per run, an org is missed n runs in a row with probability (1−f)^n. At f = 0.5 that is ~6 % for 1 h of no incident evaluation.
- Recommendation: use `followCronCursor` (already used for the other walks) for deterministic round-robin.
- Complexity: S. Regression risk: Low.

---

## Caching inventory

| Layer                   | Location                                                                                                                                      | Key / scope                                                                          | TTL / invalidation                                                            | Tenant safety                                                                                                                                                                                                                            | Notes                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| TanStack Query defaults | `lib/queries/query-client.ts:4-23`                                                                                                            | Keys in `lib/queries/keys.ts` use the literal `"organisation"` scope, not the org id | `staleTime` 30 s, `retry` 1, `refetchOnWindowFocus` true, mutations `retry` 0 | Safe: `resetScopedQueries` (`lib/queries/scope-reset.ts:25-55`) drops all non-session queries when the session scope token (user, org, role, publish right, fingerprint) changes; the account menu calls `queryClient.clear()`           | Many 60 s `refetchInterval` polls (clients, connections, health, notifications, needs-reply count, operations); settling polls at 5 s (W8-12) |
| React `cache()`         | `lib/server/session.ts:245`, `primary-location.ts:34`, `listing-metadata.ts:17`, `app/(dashboard)/clients/[clientId]/layout.tsx:24`           | Per request                                                                          | Request lifetime                                                              | Safe                                                                                                                                                                                                                                     | `getSession` does a write per request (W8-13)                                                                                                 |
| Next route config       | `app/(legal)/{terms,privacy}/page.tsx` `force-static`; `app/share/report/[token]/page.tsx` and design-system `force-dynamic`                  | —                                                                                    | —                                                                             | Safe                                                                                                                                                                                                                                     | No `unstable_cache`, `revalidate*`, `'use cache'` or `fetch` cache in app code; all outbound `fetch` is `cache: "no-store"`                   |
| HTTP Cache-Control      | `next.config.ts:109-113` (share pages `private, no-store`); explicit `no-store` on audit-log, privacy export, operations, report-share create | —                                                                                    | —                                                                             | No explicit header on most authenticated JSON API responses; they rely on Next/Vercel not caching dynamic handlers. HYPOTHESIS, low risk. Optional hardening: set `Cache-Control: private, no-store` in `route()` (`lib/server/http.ts`) |                                                                                                                                               |
| Pause snapshot          | `lib/server/pause-controls.ts:184-249`                                                                                                        | Platform-level (no tenant data)                                                      | 5 s, single-flight, failures not cached                                       | Safe                                                                                                                                                                                                                                     | Snapshot held for the whole tick (W8-18)                                                                                                      |
| Token-owner map         | `lib/server/google/credentials.ts:27-57`                                                                                                      | Access token → {org, connection, generation}                                         | 1 h, LRU-ish cap of 2,000                                                     | Safe: keyed by the bearer token itself; every issued token is registered (`connections.ts:481-489`)                                                                                                                                      | Per instance                                                                                                                                  |
| Refresh single-flight   | `lib/server/google/connections.ts:400-415`                                                                                                    | `org:connection:generation`                                                          | Promise lifetime                                                              | Safe                                                                                                                                                                                                                                     | W8-15                                                                                                                                         |
| Pacer maps              | `lib/server/google/transport.ts:28-29`                                                                                                        | Process-global plus per-connection                                                   | No eviction (bounded by connection count)                                     | Safe                                                                                                                                                                                                                                     | Not the fleet limit; that is in Postgres                                                                                                      |
| DB pool singleton       | `lib/server/db.ts:33-47` (`globalThis.__nabaSql`, `max` 10)                                                                                   | Per instance                                                                         | —                                                                             | Safe                                                                                                                                                                                                                                     | With Fluid compute, concurrent invocations share 10 connections (HYPOTHESIS: Fluid status unknown)                                            |
| JWKS                    | `lib/server/pubsub.ts:10-12` (`createRemoteJWKSet`)                                                                                           | Google certs                                                                         | jose internal                                                                 | Safe                                                                                                                                                                                                                                     | —                                                                                                                                             |
| DB-backed media cache   | `lib/server/media.ts:190-191`                                                                                                                 | Per location                                                                         | 5 min, `refresh: true` bypass (used by the presence sweep)                    | RLS via `withTenant`                                                                                                                                                                                                                     | The only server-side read cache for live Google surfaces (W8-14)                                                                              |
| Google rate budget      | `rate-budget.ts` + `google_rate_bucket`                                                                                                       | Per API host; per location for Business Information edits                            | 10 s / 60 s windows, `blocked_until` on 429                                   | Platform-level                                                                                                                                                                                                                           | W8-06, W8-10                                                                                                                                  |

**No cross-tenant cache leak found:** no module-level cache in `lib/server` is keyed without an org-specific or secret key. There is no P0 in this area.

## What is already good (brief)

- Claims use `FOR UPDATE SKIP LOCKED` with re-checked predicates and row leases, plus a single reaper (`reclaim_expired_jobs`).
- Every claim predicate is an allowlist, so the terminal `dead`, `cancelled` and `failed` states drop out with no extra filtering.
- Recovery and readback for ambiguous writes are never blindly retried.
- Each `runJob` never throws, and a failure reschedules the item with back-off.
- Recurring grids skip missed slots instead of piling up.
- Billing holds are per item.
- Liveness is honest: skips do not move `beat_at`, manual runs are recorded separately, and `followCronCursor` resets after 3 unfinished attempts.
- The fleet Google budget plus a fleet-wide block on 429 is a real circuit breaker for quota. Plain 5xx gets bounded retries inside each call's deadline and is limited by the same budget, so a Google outage cannot cause an unbounded retry storm.

## Top 5 for this workstream

1. **W8-04** (P1): sync ingest overwrites in-flight or just-settled replies. The local state goes wrong in a way users can see: published reviews go back to "new" and reply bodies are blanked.
2. **W8-02** (P1): scheduled posts and bulk children starve behind the recurring backlog, so posts are recorded "missed".
3. **W8-03** (P1): `claim_due_jobs` has no priority by kind, and phase-locked herds put user-facing retries and recoveries behind fleet syncs.
4. **W8-01** (P1): one 4-worker tick per minute caps the fleet at about 2,700 / T_r locations for 15-minute review freshness. Measure T_r, then allow parallel ticks.
5. **W8-05** (P1, plausible): session advisory locks with no expiry can wedge a tick after a killed invocation. Add `idle_session_timeout` or a lease row, and pass the deadline to the performance and keyword jobs.

## Cross-layer leads for other workstreams

- `lib/queries/use-publish-review.ts:16`: success-only invalidation. Check the approval and delete hooks for the same gap (W1).
- `lib/server/session.ts:218`: an unthrottled session write per request (auth/DB).
- `components/inbox/sync-reviews-button.tsx:40`: the "already running" message is shown for another tenant's lock (frontend; fix the server side per W8-08).
- `lib/server/reviews.ts:491-501`: `syncLinkedLocation`'s checkpoint claim is unconditional, so concurrent syncs of one location both run (data/sync).
- `scripts/scheduler.mjs:223`: POSTs reconcile, performance and keywords, which take the inline-walk path, while Vercel takes the enqueue path. Running both would double the work; resolve D-42 (W7).
- `docs/release/ledger.md:4` and `docs/architecture.md:1105` say "eight" crons; `vercel.json` has 9 (W7).
- `lib/server/jobs.ts:1128-1161`: post-loop runners are not isolated, so one throwing runner skips privacy erasures, which are a legal obligation (W-privacy).
- `app/api/sync/presence-resources/route.ts:62-90`: the synthetic system session borrows the first owner or admin's identity for reads. Confirm that no write path is reachable through it (security).
- `lib/server/rate-budget.ts:160-164`: fails open under pool saturation (W-DB pool sizing; ties to `DATABASE_POOL_MAX` = 10).
- `app/api/sync/reconcile/route.ts:52-63`: route is `auth: "public"` with in-handler checks. The ordering looks correct, but it is worth a security-workstream pass.
