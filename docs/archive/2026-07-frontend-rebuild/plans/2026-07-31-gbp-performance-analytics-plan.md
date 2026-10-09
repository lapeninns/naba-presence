# GBP performance analytics — implementation plan

Date: 2026-07-31
Status: in progress
Design: `docs/archive/2026-07-frontend-rebuild/specs/2026-07-30-gbp-performance-analytics-design.md`

## Deliverable

Replace both Performance placeholders with durable Google Business Profile
Performance ingestion and database-backed organisation/location reporting.

## Implementation order

1. Add a tenant-isolated daily metric table and performance checkpoints.
2. Add a current Google Performance request contract and defensive response
   normaliser.
3. Add backfill plus trailing-ten-day restatement sync, with feature gating,
   retry state, audit entries, and scheduler integration.
4. Add a session-authenticated read API that never calls Google.
5. Add organisation and location UI with loading, no-link, pending,
   unavailable, empty, lag, and error states.
6. Verify request contracts, date-window math, tenant isolation, API output,
   rendering, type checking, linting, build, and browser behavior.

## Safety invariants

- Google credentials and calls remain inside NabaPresence.
- Every metric row is organisation-scoped, FORCE RLS protected, and indexed.
- Provider dates remain local calendar dates; no timezone conversion occurs.
- Unknown metrics are skipped; they cannot fail a whole sync.
- Feature-off means no provider calls and an honest disabled UI.
- Reads use persisted metrics only and never fabricate Google values.

