# Requirement traceability

This matrix maps the PRD requirement IDs to executable implementation evidence.
The Docker PostgreSQL migration, tenant-isolation, and 100k-review performance
gates pass locally. Google live-contract smoke tests remain a release-environment
gate until a verified pilot listing and approved production credentials are
available.

| ID | Implemented evidence | Verification |
|---|---|---|
| CON-001 | OAuth start/callback, signed state cookie, PKCE S256, `business.manage`, account UI | Type/build gates; callback validation paths |
| CON-002 | AES-256-GCM token storage, offline refresh, revoked/expired persistence, durable reconnect task, log redaction | Migration/redaction tests; connection status/audit |
| CON-003 | Disconnect clears notifications/tokens, cancels sync, schedules seven-day purge | Disconnect route; retention job; runbook |
| LOC-001 | Cycle-safe paginated account discovery plus explicit activation selection | Google contract test; Account API and Connections UI |
| LOC-002 | Required `readMask`, pagination, filtering, verified/unverified distinction | Google contract; Connections UI; action guards |
| LOC-003 | One-to-one constraints, title/address candidates, explicit relink confirmation, history move | Link API/UI and `location.relinked` audit |
| REV-001 | Account-grouped `batchGetReviews`, 50-location chunks, pagination/checkpoints/resume, progress/failure UI and safe continuation cancellation | Google contract tests; sync checkpoint API/UI |
| REV-002 | OIDC-verified Pub/Sub, dedupe, replay, 15-minute cursor-exhausting reconciliation scheduler | Webhook/replay/reconcile routes; scheduler; health endpoint |
| REV-003 | Global pacing, bounded exponential jitter, retry taxonomy, hash-keyed upsert | Retry and Google contract tests |
| REV-004 | Encrypted identifiers, 30-day raw expiry, derived metrics, legal holds, privacy export | Migration tests; retention/privacy routes |
| REV-005 | Immutable source text, derived language/confidence, explicit fallback, multilingual templates | Rating-only and verification tests |
| UI-001 | Server cursor pagination, all specified filters, ID/text/location search, rating sorts | Inbox API and rendered filter controls |
| UI-002 | Reviewer/rating/timestamps/media/timeline/moderation; text-only reply editor | Detail API and rendered detail view |
| UI-003 | UTC source timestamps, configured IANA timezone display, DB workflow trigger | Workflow and migration tests |
| REP-001 | Versioned evidence hash, model linkage, deterministic sparse rating-only path | Draft API; rating-only tests |
| REP-002 | Deterministic PII/claim/promotion/escalation/tone/location/language/length checks | Verification suite |
| REP-003 | Approval default, owner consent for direct mode, role/location grants, actor audit | Settings/member/location APIs and UI |
| REP-004 | Google `updateReply`/`deleteReply`, moderation and violation persistence, re-edit path | Google contracts; publish/detail routes |
| REP-005 | Body-hash idempotency, retry schedule, ambiguity read-before-retry, append-only events | Retry/workflow/migration tests |
| ANA-001 | Selectable date windows and day/week/month series; volume/rating/response/p50/p95/complaint/rejection/location metrics | Analytics APIs/UI, per-location calculations, rendered desktop/mobile QA |
| AUD-001 | Append-only DB trigger and events for auth, connection, link, sync, drafts, verification, publish, members, purge, privacy | Migration test; audit JSON/CSV export |

## Cross-cutting evidence

- Next.js OpenTelemetry request spans plus custom Google-provider and
  tenant-database spans; latency/outcome histograms and counters are exportable
  through OTLP.
- Redacted structured error logs, request IDs on active spans, tenant context on
  database spans, and the operations-health endpoint cover the PRD monitoring
  signals.
- The standalone production artifact was exercised at 1440 px and 390 px with
  zero horizontal overflow, zero browser errors, named controls, working mobile
  navigation, and all analytics controls/metrics present.
- Six axe-backed WCAG 2.2 AA production-browser scenarios pass on desktop and
  mobile for inbox, review detail/editor, connections, and settings.
- CI seeds 100,000 reviews across 500 locations and asserts the warm P95
  cursor-page query remains below 1.5 seconds.

## Release-only evidence

- Apply `0001_initial.sql` with the production migration role.
- Run `pnpm test:integration` against the release database topology.
- Complete Google OAuth, account/location discovery, notification setup,
  backfill, reconciliation, publish, moderation, delete, disconnect, and replay
  smoke tests with a dedicated verified pilot listing.
- Run manual keyboard and screen-reader checks with the supported release
  browser/assistive-technology matrix.
- Obtain Google/legal approval for the production project model, consent copy,
  and retention interpretation before general availability.
