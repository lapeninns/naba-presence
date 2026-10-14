# Full-stack audit, 2026-10-14: executive summary

**Snapshot:** `main` at `d8759c74` plus uncommitted, layout-only inbox work.

**Method:** 9 Claude accounts ran 23 delegated tasks. Investigation came
first. Every P0/P1 claim was then re-traced by a different account (adversarial
verification), and the coordinator spot-checked the code directly. All work was
read-only; no production or provider access was used.

## Verdict

The codebase is in better shape than most at this size:

- **One request skeleton.** All 159 routes go through a single `route()`
  wrapper.
- **Tenant isolation.** Forced RLS uses cheap policies, and no IDOR was found.
- **Clean dependency graph.** There are no import cycles, and server-only code
  is kept out of client bundles.
- **Idempotent publishing.** Reply publishing cannot double-post to Google.
- **Robust billing.** Stripe webhook handling is order-independent.
- **Green checks.** `typecheck`, `lint` and 6,509 unit tests pass.

The highest-value work is not a rewrite. It falls into four themes:

1. **Close one database exposure.** The Supabase Data API may be reachable
   (P0, needs operator verification).
2. **Make Google writes honest under time limits.** Lock-only transactions span
   Google calls and can fail _after_ Google applied the change.
3. **Stop redundant work at three multipliers:**
   - review sync rewriting every review;
   - clients refetching every loaded page after each write;
   - a server render plus session write on every inbox click.
4. **Make failures visible.** Production has no telemetry exporter, and
   upstream errors are logged as nothing.

## Top 10, in implementation order

| #   | Improvement                                                                                                                                                                                                                | Priority | Effort       | Evidence                                                    | Roadmap      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ | ----------------------------------------------------------- | ------------ |
| 1   | **Verify, then close, the Supabase Data API exposure.** Run the read-only SQL. If exposed, disable the Data API (no app impact found) and ship the revoke migration with a local-only guard on `provision_local_bootstrap` | P0       | S + operator | `CODEBASE_AUDIT.md §3`; `0005_tenant_hardening.sql:76-136`  | WP-00        |
| 2   | **Bind single-review Approve to the draft the approver saw.** Send `draftId` and `expectedReviewUpdateTime`; the server guards already exist                                                                               | P1       | S            | `use-approval-decision.ts:14`, `review-approval.ts:121,149` | WP-01        |
| 3   | **One time-bounded "Google write session" for 13 publish paths.** Today the worst case is 85–120 s against a 60 s idle-transaction limit, ending in "Google applied, user sees 5xx"                                        | P1       | M–L          | `hours.ts:739`, `profile.ts:641`, +11; R2-V4                | WP-02        |
| 4   | **Guarded, change-detecting review ingest.** Skip unchanged reviews by `content_hash` and never overwrite an in-flight or newer reply. This removes the largest write load _and_ the reply-overwrite race                  | P1       | M            | `reviews.ts:254-288`; R2-V3                                 | WP-03        |
| 5   | **Request budgets and AI credit ordering.** Charge after the draft is saved, or refund, and fit every Google/OpenAI route under its `maxDuration`                                                                          | P1       | M            | `review-drafts.ts:369,387,417`; `backfill/route.ts:127`     | WP-04        |
| 6   | **Error taxonomy and production telemetry.** Upstream and invariant failures become logged 5xx; add an OTLP exporter with per-invocation flush; host the readiness probe off the laptop                                    | P1       | M            | `http.ts:139-150`; W7                                       | WP-05, WP-07 |
| 7   | **Fix the inbox interaction cluster:** History-API URL state, memoised list with scroll only on selection change, composer seeded before commit, throttled `last_seen_at`                                                  | P1       | M            | `inbox-view.tsx:195,212`; `session.ts:217`; R2-V5, R2-X1    | WP-08        |
| 8   | **Patch the cache instead of refetching every page.** Write endpoints return the updated review, so at 10 loaded pages a publish drops from 33 to 13 transactions. Bound the settling poll and stop retrying 4xx           | P1/P2    | M            | `invalidate.ts:15-20`; `lib/contracts/reviews.ts:657-723`   | WP-09        |
| 9   | **Audit-log subject index and cascade FK indexes.** One index fixes the review timeline scan                                                                                                                               | P1       | S            | `review-reads.ts:224`, `posts.ts:740`; R2-V4                | WP-10        |
| 10  | **Freshness-aware editors.** Serve hours, profile, posts and place-actions from synced data within a staleness budget, as media already does; stop profile GET writes                                                      | P1       | L            | `hours.ts:98-266`, `media.ts:318-328`                       | WP-11        |

**Run alongside:** WP-13 (merge gate and staged promotion). Hosted CI is idle,
and promotion switches the live domain without a probe. Neither changes
behaviour, but both are needed to land this much change safely.

## Code-derived interaction costs

These are operation counts, not timings. Source:
`raw/R2-X1-interaction-cost-model.md`.

| Interaction                      | Requests | DB transactions | Session writes |
| -------------------------------- | -------- | --------------- | -------------- |
| Select a review                  | 1        | 5               | 1              |
| Publish a reply (N loaded pages) | N+4      | 2N+13           | N+4            |
| Idle inbox tab, 10 min           | 40       | 80              | 40             |

## Measured baselines

- Build at `d8759c74`: 54.3 s, with 5.74 MB of client chunks.
- About 2.0 MB of those chunks is code duplicated across chunks.
- Every route ships 132.5 KB gzipped of shared framework JS.
- Unit tests take 106 s.
- The latest release gate took about 56 min.

Nothing here measures latency or query counts, because production telemetry
doesn't exist yet (item 6).

## Documents

| File                           | Purpose                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `VERIFIED_FINDINGS.md`         | Source of truth for priority and status after verification                                                 |
| `CODEBASE_AUDIT.md`            | Architecture, flows, the P0 with verification SQL and remediation draft, cross-layer findings, corrections |
| `MUTATIONS_AND_HOOKS_AUDIT.md` | Mutation inventory, invalidation map, polling, idempotency, the inbox render cluster, dirty-state          |
| `BACKEND_DATABASE_AUDIT.md`    | Locking, sync integrity, indexes (25-row DB change list), API budgets, jobs, billing and retention         |
| `PERFORMANCE_OPTIMISATION.md`  | Baselines, frontend, data fetching, backend cost, caching, before/after validation                         |
| `ARCHITECTURE_IMPROVEMENTS.md` | AR-1…AR-9 structural changes, dependency graph, considered and rejected                                    |
| `IMPLEMENTATION_ROADMAP.md`    | WP-00…WP-15, acceptance criteria, dependency graph, parallel agent plan                                    |
| `AGENT_EXECUTION_REPORT.md`    | Accounts, tasks, verification record, blocked items, uncertainties                                         |
| `TASK_REGISTRY.md`             | Live task registry used during the audit                                                                   |
| `raw/`                         | Unedited per-agent evidence                                                                                |

## Needs the operator

1. Run `CODEBASE_AUDIT.md §3.4` on staging, then production (SEC-11).
2. Decide on the Supabase dashboard Data API setting.
3. Choose an OTLP destination and a hosted readiness probe (WP-07).
4. Approve the lockfile change to drop the 7 unused dependencies (WP-14).
