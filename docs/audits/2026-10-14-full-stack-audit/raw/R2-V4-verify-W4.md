# R2-V4: adversarial verification of W4 (database)

**Verifier:** review sub-agent, read-only, static only (Docker down, no DB, no network). HEAD `d8759c74` plus the working tree. Only this file was written.

## Verdict table

| ID    | Verdict                       | Priority            | Key evidence / correction                                                                                                                                                                             |
| ----- | ----------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W4-01 | **CONFIRMED, with additions** | P1                  | 13 sites, not 10 (listed below). Timeout window is longer than W4 said. A second failure mode is new: blocked waiters hit `statement_timeout` at 30 s. Recommendation (a) as written is **not safe**. |
| W4-02 | **PARTIALLY CONFIRMED**       | P2 (was P1)         | The runbook's `EMAXCONNSESSION` note is about the main pool running in session mode, not about lock connections. "Two per bulk child" applies only to `place-actions`.                                |
| W4-03 | **CONFIRMED**                 | P1                  | The upsert has no `WHERE`, `content_hash` is write-only, and HOT updates are blocked. `review` has 12 indexes.                                                                                        |
| W4-04 | **CONFIRMED**                 | P1 (posts part: P2) | No index leads with subject. The proposed index fixes the timeline fully, but the posts list only partially unless it gets `INCLUDE (action)` plus a lateral rewrite.                                 |
| W4-08 | **CONFIRMED**                 | P2                  | `draft(org, review_id, …)` and `review_reply unique(org, review_id)` both lead with `organisation_id`. RI cascade queries bypass RLS and filter on `review_id` only. PG17 has no skip scan.           |
| W4-06 | **CONFIRMED**                 | P2                  | Up to 3 full-tenant aggregates per call, a 60 s poll, and a layout prefetch.                                                                                                                          |
| W4-07 | **CONFIRMED**                 | P2                  | Search goes through a plpgsql `SECURITY DEFINER` SRF, and the GIN index has no `organisation_id`.                                                                                                     |
| W4-09 | **CONFIRMED**                 | P2                  | One `INSERT` per point: 18 months × 11 metrics ≈ 6,028 statements in one transaction. The update is unconditional.                                                                                    |

## W4-01 detail

**Sites.** `withSessionConnection` + `begin` + an advisory xact lock, with Google calls inside the callback:

- `hours.ts:739`, `profile.ts:641`, `food-menus.ts:460`
- `business-information.ts:203`, `:216` (confirm), `:510`
- `industry-management.ts:68` (confirm), `:119`
- `google-verification-execution.ts:90`, `google-administration-execution.ts:16`, `google-lifecycle-execution.ts:15`, `google-account-change-lock.ts:9`
- `bulk-listing-runner.ts:384`

Ruled out: `gbp-management.ts:198`, `media.ts:459` and `bulk-families/photos.ts:158` take xact locks inside pooled `withTenant` with no HTTP inside.

**The timeout applies.**

- The runtime role pins both timeouts: `db-create-runtime-role.mjs:37-39`. `withSessionConnection` sets no startup params (`db.ts:66-70`), and the session URL uses the same role (runbook :1250).
- In the hours path the only statement on the lock connection is the lock itself. Every other DB call uses the pool. So the backend sits idle in transaction for the whole provider sequence.

**Worst case for `publishCanonicalHours`:**

| Step                         | Bound                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Token refresh wait           | ≤ 20 s (`connections.ts:436`)                                                                                                |
| `fetchGoogleHours`           | ≤ 15 s, plus up to 15 s, because the retry sleep `min(retryAfter, timeoutMs)` at `transport.ts:439` can overrun the deadline |
| `getGoogleHoursCategories`   | ≤ 15 s (`hours.ts:153`; W4 missed this call)                                                                                 |
| validateOnly PATCH and PATCH | 20 s each (mutations are single-attempt, `transport.ts:343`)                                                                 |
| Readback                     | ≤ 15 s (`maxAttempts: 3`)                                                                                                    |

The nominal total is about 85 s, roughly 120 s at worst, against a 60 s limit. On a healthy Google it takes seconds. The limit is reached only when Google is degraded or throttling (429).

**What the user sees.**

- The attempt row is started and settled in separate pooled transactions (`gbp-write.ts:11`), so both are committed before the outer `COMMIT`.
- The JS side does not notice the killed backend until that `COMMIT`. The write therefore completes and its receipt says `succeeded`, but the request then rejects and the user gets a 5xx.
- Mutual exclusion is lost from the 60 s mark onward.
- New: a blocking `pg_advisory_xact_lock` waiter fails at 30 s with 57014, the role's `statement_timeout`. That contradicts the "this publish waits for a running bulk child" comment at `hours.ts:730-735`.

**Why fix (a) is unsafe.**

1. The 60 s idle-in-transaction kill is currently the only dead-man bound on a frozen Vercel instance. A session-level lock on a plain idle session has no `idle_session_timeout`, so it is held until Supavisor or TCP drops the connection.
2. If `DATABASE_SESSION_URL` is unset, `withSessionConnection` falls back to `DATABASE_URL` (`db.ts:66`; `startup.ts:41-46` only guards port 6543). Session locks taken on a transaction pooler would then be orphaned.
3. The confirm paths read RLS-scoped rows on the lock connection under `set_config(…, true)` (`business-information.ts:217`, `industry-management.ts:69`). Without a transaction those reads lose their tenant context.

**Prefer (b):** `SET LOCAL idle_in_transaction_session_timeout` to the computed budget plus a margin, and `SET LOCAL statement_timeout` for blocking waiters. Or use (c), a table lease with `expires_at`.

## W4-02 detail

**Confirmed:**

- 9 lease keys (`leases.ts:14-24`).
- A fresh client per lock (`db.ts:62-75`).
- The refresh waiter reconnects every 150 ms until the 20 s deadline (`connections.ts:394, 436-473`), about 60–100 cycles. Each cycle holds a slot only briefly.

**Corrections:**

- Runbook :1231-1237 attributes `EMAXCONNSESSION` to the _main pool_ when it ran on the session pooler (suspended instances kept idle pools open). That was before lock connections were split out. It is not evidence that lock connections exhausted anything.
- `family.accountLock` is `true` only in `bulk-families/place-actions.ts:54`. Every other family is `false`.
- Docs drift: runbook :1236 says the session pooler serves "only the refresh lock and the scheduler leases". It now also serves the 13 write-lock sites above.

The risk is real but unmeasured, hence P2.

## W4-03 detail

- The `DO UPDATE` has no `WHERE` (`reviews.ts:254-288`). It sets `raw_content_expires_at = excluded…` and `provider_deleted_at = null`.
- `raw_content_expires_at` is indexed by `raw_review_expiry_idx` and `review_unredacted_expiry_v2_idx`, so the update cannot be HOT.
- `review` has 12 indexes: the pk, `unique(org, name_hash)`, `inbox_updated`, `inbox_status`, `location`, `raw_review_expiry`, `provider_deleted` (partial), `google_id_hash`, `assigned` (partial), `triaged` (partial), `unredacted_expiry_v2` and GIN `search_document` (`0010:13-15`). About 9 of them get a new entry per rewrite.
- The `review_updated_at` and `review_workflow_transition` BEFORE UPDATE triggers fire on every rewrite (`0001:490-492`).
- Media is deleted and re-inserted per review (`reviews.ts:302-327`), and the reply is upserted or updated every time (`:332-387`).
- `content_hash` has no reader: `rg` finds only `reviews.ts:222` and `:282`.
- Reconcile always reads page 1 of 50 (`google/reviews.ts:17-18`) every 15 minutes (`reviews.ts:409`).
- Sweeps add a second update to `last_seen_at` (`reviews.ts:713-720`).

## W4-04 detail

**Timeline** (`review-reads.ts:234-239`): `audit_log` filtered by RLS `organisation_id = current_setting(...)`, then `subject_type = 'review' AND subject_id = $id`, `ORDER BY created_at DESC LIMIT 100`.

**Posts** (`posts.ts:740-746`): `organisation_id = $1 AND subject_type = 'local_post' AND action IN ('post.draft.created', 'post.updated')`, `GROUP BY subject_id`. The planner cannot push the later join key into this grouped CTE, and it aggregates even for a single-post fetch (`options.post`).

**Existing indexes** (after all drops):

- `audit_log_tenant_time_idx (organisation_id, created_at DESC)` (`0001:399`)
- `unique (organisation_id, request_id, action, subject_type, subject_id)` (`0001:380`)

Neither index can seek on subject, because `request_id` comes second in the unique index.

**Proposed index:** `(organisation_id, subject_type, subject_id, created_at DESC) INCLUDE (action)`, built `CONCURRENTLY` (W4-13).

- **Timeline:** seek plus ordered `LIMIT`, fully served.
- **Posts:** bounded to the tenant's `local_post` rows. Because `audit_log` is append-only, the visibility map stays all-visible and this can be an index-only GroupAggregate. A per-listed-post probe still needs the lateral rewrite.

## P2 detail

- **W4-08:**
  - `draft_review_idx (organisation_id, review_id, created_at DESC)` (`0001:397`) and `review_reply unique (organisation_id, review_id)` (`0001:263`) both lead with `organisation_id`.
  - `legal_hold` and `approval_decision.review_id` have no `review_id`-leading index.
  - `review_media_item` already got one: `review_media_item_review_idx` in `0099`.
  - Cascade path: `purge.ts:484-488`.
- **W4-06:** `review-counts.ts:74-108` runs a totals query, a status `GROUP BY` and an optional client `GROUP BY`. Callers are `layout.tsx:66-76` and the 60 s poll at `use-needs-reply-count.ts:25`.
- **W4-07:** `0011:3-30` is `language plpgsql ... security definer` with `RETURN QUERY`. The `0010:14` GIN index has no tenant column.
- **W4-09:** the loop is `performance.ts:199-223`. The constants are at `:30-31`, and the 11 metrics are at `google-contract.ts:34-46`.
