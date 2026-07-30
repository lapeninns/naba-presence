# GBP performance analytics — design

Date: 2026-07-30
Status: approved for planning
Sub-project: 1 of 3 in the Google Business Profile expansion

## Context and roadmap

NabaPresence today covers one Google Business Profile surface end to end:
reviews (discovery, backfill, Pub/Sub ingestion, reconcile, AI draft →
verification → human approval → three-phase publish) plus review-centric
analytics. The agreed expansion adds three further GBP capabilities, built as
three sub-projects in this order:

1. **Performance analytics** (this document) — ingest Google's daily
   profile-performance metrics and surface them in the analytics area.
2. **Posts publishing** — compose and publish updates/offers/events through
   the v4 localPosts surface, reusing the three-phase mutation pattern.
3. **Profile info editing** — edit hours, special hours, description, and
   attributes through Business Information v1 writes.

Q&A was considered and parked. Each sub-project gets its own spec, plan, and
implementation cycle; nothing in this document commits API or UI shape for
sub-projects 2 and 3.

## Goal and success criteria

Give every linked location durable, first-class presence metrics: how often
the profile is seen (Search vs Maps, desktop vs mobile) and what people do
next (calls, website clicks, direction requests, and the
conversation/booking/food actions where applicable).

Done means:

- A linked location shows up to ~18 months of daily metrics, backfilled
  automatically at link time and refreshed daily with no operator action.
- Values match the native GBP dashboard for the same range.
- An organisation-level rollup and a per-location view exist in the
  analytics area, with honest loading, empty, error, and data-lag states.
- Metrics ingestion is observable and alertable through the existing
  operational health surface.

Out of scope for this release: search keywords, CSV export, period-over-period
comparison, any new OAuth scope (the Performance API is covered by the
existing `business.manage` grant).

## Provider surface

- Endpoint: `GET https://businessprofileperformance.googleapis.com/v1/{location=locations/*}:fetchMultiDailyMetricsTimeSeries`
  with repeated `dailyMetrics` query parameters and a `dailyRange`.
- Metrics ingested (all that the API offers; ingesting all costs the same
  call): `BUSINESS_IMPRESSIONS_DESKTOP_MAPS`,
  `BUSINESS_IMPRESSIONS_DESKTOP_SEARCH`, `BUSINESS_IMPRESSIONS_MOBILE_MAPS`,
  `BUSINESS_IMPRESSIONS_MOBILE_SEARCH`, `CALL_CLICKS`, `WEBSITE_CLICKS`,
  `BUSINESS_DIRECTION_REQUESTS`, `BUSINESS_CONVERSATIONS`,
  `BUSINESS_BOOKINGS`, `BUSINESS_FOOD_ORDERS`, `BUSINESS_FOOD_MENU_CLICKS`.
  The exact enum list is confirmed against the API reference at
  implementation time; unknown values returned by Google are ignored, not
  fatal.
- Google's data lags roughly 3–5 days and recent days are restated; history
  is available for approximately 18 months. Requested ranges are clamped to
  the horizon Google accepts.
- If the API rejects the full metric set in one call, the client splits the
  set across two calls per pass. This is a request-shaping detail inside the
  client function, invisible to callers.

## Approaches considered

- **A — live proxy, no storage.** Query Google per page view with a short
  cache. Rejected: page latency bound to Google, quota pressure for
  multi-location organisations, blank analytics on disconnect or provider
  outage, and it violates the product rule that the UI shows only
  API-backed records from the configured database.
- **B — durable daily ingestion through existing sync machinery.
  (Chosen.)** Store daily metrics in Postgres; backfill on link; daily
  incremental refetch with a restatement window. Reuses `sync_checkpoint`,
  `withTenant`, advisory leases, and the jobs drainer exactly as reviews
  ingestion does.
- **C — hybrid stored + on-demand refresh.** Rejected: Google's own 3–5 day
  lag makes the freshness gain illusory; two code paths for no user value.

## Data model and retention

New table `performance_metric_daily`:

- `id uuid pk`, `organisation_id` FK → `organisation` (cascade),
  `external_location_id` FK → `external_location` (cascade),
  `metric text` (check-constrained to the known enum),
  `metric_date date`, `value bigint` (`>= 0`),
  `created_at` / `updated_at timestamptz`.
- Unique `(organisation_id, external_location_id, metric, metric_date)`.
- Tenant RLS identical to every other tenant table; all access via
  `withTenant`.

Dates are stored exactly as Google returns them: location-local calendar
dates with no timezone conversion (the ANA-401 lesson — conversion is what
creates off-by-one-day bugs). Rollups sum these dates as-is, matching how
the GBP dashboard itself aggregates.

Retention: rows are aggregate counts containing no personal data. They fall
under the existing "minimal derived operational metrics" carve-out, not the
30-day raw-content window, and persist for trend history. They are removed
with their location: the existing disconnect/unlink purge deletes
`external_location` within seven days and the FK cascade removes metric
rows with it. `docs/architecture.md` gains a sentence recording this
classification.

`sync_checkpoint` changes (one migration):

- Extend the `sync_type` check constraint with `'performance'`.
- Add nullable `last_metric_date date` as the performance watermark. The
  review-specific `last_review_update_time` stays untouched and null for
  performance rows.

## Ingestion and scheduling

New module `lib/server/performance.ts`, shaped like `lib/server/reviews.ts`:

- **Backfill (on location link, and on relink):** create/claim the
  `'performance'` checkpoint, request the full ~18-month window, upsert all
  returned datapoints, set `last_metric_date` to the newest date Google
  returned, settle the checkpoint. Backfill is one or two provider calls
  per location, so chunking is unnecessary, but the checkpoint makes
  restarts and rate-limit deferrals safe.
- **Incremental (recurring):** refetch a trailing 10-day window ending
  today and upsert over prior values, absorbing Google's restatements of
  recent days. Advance `last_metric_date` monotonically.
- **Client:** one new function in `lib/server/google.ts` calling
  `fetchMultiDailyMetricsTimeSeries` through the existing `googleRequest`
  auth/refresh/retry/error taxonomy. It takes the stored
  `google_location_name`, the metric set, and a date range, and returns a
  normalised `{ metric, date, value }[]`.

Scheduling: a new tick in `scripts/scheduler.mjs`
(`PERFORMANCE_INTERVAL_SECONDS`, default 21600, minimum 3600) posts to a new
cron-authenticated `POST /api/sync/performance`, which iterates
organisations through `organisation_job_route`, immediately re-enters
`withTenant` per tenant, and processes due `'performance'` checkpoints.
The loop is guarded by a fleet advisory lease like reconcile/retention, so
overlapping schedulers skip rather than duplicate. Failed checkpoints retry
through the existing jobs drainer with the standard backoff and
`next_attempt_at` discipline.

Feature flag: `PRESENCE_METRICS_ENABLED` gates the scheduler tick, the sync
endpoint, and the UI section, consistent with the existing rollback-flag
pattern. Off means: no provider calls, section hidden.

## Read API and UI

**Endpoint:** `GET /api/analytics/presence` — session-authenticated,
`withTenant`, visible to viewers like the other analytics routes. Query
parameters: `range` preset (`28d` | `90d` | `12m` | `18m`) and optional
`locationId`. Response: per-metric daily series for the range, period
totals, and `freshThrough` (the newest `metric_date` present) so the UI can
state how current the data is. Reads Postgres only; never calls Google.
Existing review-analytics endpoints are untouched.

**Analytics area:** a new Presence section alongside review analytics:

- Headline tiles: impressions split Search vs Maps (desktop+mobile
  summed per surface), calls, website clicks, direction requests.
- A daily time-series chart on the design-system chart components, with
  the range picker and the same location switcher pattern as existing
  per-location analytics.
- Conversations, bookings, and food metrics render as additional tiles
  only when the organisation has any nonzero value in the selected range,
  so inns with bookings see them and others get no permanent zero tiles.
- A pinned caption: "Google reports these metrics with a few days' delay",
  plus `freshThrough` rendered as "data through {date}".

**Overview page:** one compact presence tile row linking into the section.

**States** (matching the certified inbox-state patterns): loading skeletons;
distinct empty states for "no linked locations" and "linked, first sync
pending"; an error state; and per-location "metrics unavailable" (below).
Days newer than `freshThrough` are not drawn — no fabricated zeros for
Google's lag window. Missing days inside the fresh range render as zero
with the lag caption.

## Error handling and edge cases

- **Unverified/ineligible locations:** Google rejects the call. The
  checkpoint records the terminal error code, retries at most daily, and
  the UI shows "metrics unavailable for this location" instead of a
  spinner.
- **Restatements:** absorbed by the 10-day incremental window upserting
  over stored values.
- **Disconnect mid-backfill:** the checkpoint fails cleanly; the purge
  cascade removes metric rows; relinking starts a fresh backfill.
- **Rate limits / 5xx:** classified by the existing `googleRequest`
  retryable-vs-terminal taxonomy; retryable failures reschedule via
  `next_attempt_at`, never hot-loop.
- **Unknown metric enums in responses:** logged and skipped, not fatal, so
  a Google-side addition cannot break ingestion.
- **Timezone/DST:** no conversion anywhere; dates are location-local
  calendar dates end to end.

Telemetry: `nabapresence.performance_sync.*` counters and spans mirroring
the review-sync signals (pages, upserts, failures, lag gauge =
`today - freshThrough` per location) so the existing alerting health
endpoint picks the loop up without new plumbing.

## Testing

- **Unit:** date-window math (18-month clamp, 10-day trailing window),
  restatement upsert semantics, rollup summation, response mapper against
  recorded Google fixtures, unknown-enum tolerance.
- **Contract:** the new client function's request shape (metric params,
  date range encoding) and error mapping against fixtures.
- **Integration:** `/api/sync/performance` and `/api/analytics/presence`
  against migrated PostgreSQL through the non-superuser runtime role,
  with the Google boundary mocked: backfill, incremental restatement,
  terminal ineligibility, RLS tenant isolation, feature flag off.
- **Browser (Playwright):** seeded metrics render tiles, chart, range
  switching, location filter, and each empty/error/lag state.
- **Accessibility:** `pnpm test:a11y` covers the section; the chart gets a
  text-summary/table fallback consistent with the A11Y-501 standard.

## Open items to confirm during implementation

- Whether one call may carry all eleven `dailyMetrics` values or the set
  must be split (the client hides whichever is true).
- The exact request horizon Google enforces (clamp constant).
- Final metric enum list against the current API reference.
