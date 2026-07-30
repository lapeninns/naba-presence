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

## Sprint 1–4 acceptance evidence

Every acceptance criterion from the first four sprint plans maps to an
executable path below. A green local path is not represented as a hosted CI run;
this checkout has no Git remote, so real Actions run URLs remain blocked.

| Sprint | Acceptance criterion | Executable evidence |
|---|---|---|
| 1 | A new user can start OAuth from the signed-out UI | `tests/integration/routes/sign-in.test.ts`; `tests/e2e/accessibility.spec.ts` sign-in scenario |
| 1 | A new organisation is provisioned under a non-superuser role | `tests/integration/provisioning.test.ts` with `TEST_RUNTIME_DATABASE_URL` |
| 1 | Startup rejects a database identity that bypasses RLS | `tests/integration/startup-assertion.test.ts`; `tests/startup-safety.test.ts` |
| 1 | Cross-tenant SQL and HTTP reads/writes fail | `tests/integration/tenant-isolation.test.ts`; `tests/integration/routes/tenant-isolation-http.test.ts` |
| 1 | Runtime queries cannot read unrestricted `app_user` PII | `tests/integration/app-user-isolation.test.ts` |
| 1 | Production webhooks require strong authentication configuration | `tests/startup-safety.test.ts`; `tests/env-flags.test.ts` |
| 1 | CI invokes auth, IDOR, role, and tenant-isolation route suites | `.github/workflows/ci.yml` `pnpm test:integration`; route evidence in `auth.test.ts`, `identity-hardening.test.ts`, `roles.test.ts`, and `tenant-isolation-http.test.ts` |
| 2 | Provider mutation intent is durable before the Google call | `tests/integration/routes/publish-lifecycle.test.ts` started-intent case |
| 2 | A crash cannot produce an untracked successful mutation | `tests/integration/routes/publish-lifecycle.test.ts`; `tests/integration/routes/jobs-runner.test.ts` |
| 2 | Ambiguous outcomes are reconciled before retry | `tests/integration/routes/publish-lifecycle.test.ts`; `tests/integration/routes/delete-lifecycle.test.ts` |
| 2 | Rejected replies are not shown or counted as published | `tests/integration/routes/reply-harness.test.ts`; `tests/integration/routes/analytics-metrics.test.ts` |
| 2 | Remote delete cannot roll back locally into divergence | `tests/integration/routes/delete-lifecycle.test.ts`; `tests/integration/routes/audit-integrity.test.ts` |
| 2 | Approval rules are explicit and executable | `tests/integration/routes/approval.test.ts`; `tests/reply-policy.test.ts` |
| 3 | A revoked connection does not stop other tenants | `tests/integration/routes/reconcile-isolation.test.ts` |
| 3 | Interrupted multi-location backfill resumes without skips or duplicates | `tests/integration/routes/backfill-checkpoints.test.ts` |
| 3 | Updates outside the newest two pages are eventually detected | `tests/integration/routes/deep-reconcile.test.ts` |
| 3 | Provider-deleted reviews leave analytics through a defined local state | `tests/integration/routes/tombstones.test.ts`; `tests/integration/routes/analytics-metrics.test.ts` |
| 3 | Permanently malformed Pub/Sub events are acknowledged and audited | `tests/integration/routes/webhook-acks.test.ts`; `tests/integration/routes/webhook-payload.test.ts` |
| 3 | Retriable webhook events are queued or redelivered durably | `tests/integration/routes/webhook-acks.test.ts`; `tests/integration/routes/jobs-runner.test.ts` |
| 3 | Failed work progresses without repeating the API request manually | `tests/integration/routes/jobs-runner.test.ts` |
| 3 | Scheduler load completes within its execution budget | `tests/integration/routes/leases.test.ts`; `docs/live-certification/rel-501-load-report.md` |
| 3 | Pool behavior remains healthy during backfill and reconcile | `tests/integration/routes/sync-transactions.test.ts`; `docs/live-certification/rel-501-load-report.md` |
| 4 | An invited user lands in the inviting organisation | `tests/integration/routes/invitations.test.ts` |
| 4 | Supported languages produce replies in the intended language | `tests/integration/routes/language-drafts.test.ts`; `tests/language-detection.test.ts` |
| 4 | Reviewer text cannot direct the semantic verifier | `tests/semantic-prompt.test.ts`; `tests/fixtures/prompt-injection/` |
| 4 | Analytics pass timezone and DST boundary fixtures | `tests/integration/routes/analytics-timezone.test.ts` |
| 4 | Inbox search uses its index at production-like volume | `tests/integration/inbox-performance.test.ts`; production-role result in `docs/live-certification/rel-501-load-report.md` |
| 4 | Every accessible location is selectable without a review on the current page | `tests/integration/routes/inbox-cursor.test.ts`; `tests/e2e/journeys.spec.ts` |
| 4 | Queue counts are complete server totals | `tests/integration/routes/review-counts.test.ts`; `tests/e2e/journeys.spec.ts` |
| 4 | Stale, disconnected, loading, empty, and provider-error states are distinguishable | `tests/e2e/accessibility.spec.ts` state variants |
| 4 | Privacy erasure and restriction have executable fulfilment | `tests/integration/routes/privacy-fulfilment.test.ts` |
| 4 | Browser payloads omit unused decrypted Google identifiers | `tests/integration/routes/serialization.test.ts` |

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
- Twenty-four axe-backed WCAG 2.2 AA browser scenarios cover sign-in,
  invitation, design-system, inbox/detail state variants, connections,
  settings, approvals, analytics, and responsive views.
- CI seeds 100,000 reviews across 500 locations and asserts the warm P95
  cursor-page query remains below 1.5 seconds.

Hosted CI run URLs: **BLOCKED — this checkout has no Git remote and nothing was
pushed, so no GitHub Actions run exists to cite.** The workflow definition is
`.github/workflows/ci.yml`; local results are recorded in the sprint plans and
live-certification reports.

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
