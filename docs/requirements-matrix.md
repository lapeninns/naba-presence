# Requirement traceability

This matrix maps the PRD requirement IDs to executable implementation evidence.
The Docker PostgreSQL migration, tenant-isolation, and 100k-review performance
gates pass locally. Google live-contract smoke tests remain a release-environment
gate until a verified pilot listing and approved production credentials are
available.

| ID | Implemented evidence | Verification |
|---|---|---|
| CON-001 | Owner/admin-only OAuth start/callback, signed state cookie, PKCE S256, `business.manage`, organisation-level account UI | Route role tests; type/build gates; callback validation paths |
| CON-002 | AES-256-GCM token storage, offline refresh, revoked/expired persistence, durable reconnect task, log redaction | Migration/redaction tests; connection status/audit |
| CON-003 | Disconnect clears notifications/tokens, cancels sync, schedules seven-day purge | Disconnect route; retention job; runbook |
| LOC-001 | Cycle-safe paginated account discovery plus explicit activation selection | Google contract test; Account API and Connections UI |
| LOC-002 | Required `readMask`, pagination, filtering, verified/unverified distinction | Google contract; Connections UI; action guards |
| LOC-003 | One-to-one constraints, title/address candidates, explicit relink confirmation, history move | Link API/UI and `location.relinked` audit |
| NTF-001 | Organisation-selectable Pub/Sub subscriptions for Google updates, reviews, customer media, duplicate locations, and Voice of Merchant changes | Google contract tests; Connections editor; notification route persistence |
| HRS-001 | Tenant-scoped, revisioned NabaPresence canonical schedule with regular, special, and additional-hours CRUD | Standalone migration/domain tests; Hours editor |
| HRS-002 | Normalized canonical/Google comparison and baseline-aware drift classification without cross-product mapping | Hours domain tests; comparison UI |
| HRS-003 | Fresh canonical revision/hash pins, role/location grant, dual write flags, Google `validateOnly`, single-attempt PATCH, read-back reconciliation | Hours route and Google contract tests |
| HRS-004 | Durable pre-write intent, approved payload/mask, ambiguous-write read-back, exact-retry idempotency, 30/365-day retention | Hours migration/retention tests; Hours lifecycle integration test |
| PRO-001 | NabaPresence-owned canonical profile CRUD, field-level source policy, selected Google import, and baseline-aware drift | Profile domain/migration tests; profile editor and comparison UI |
| PRO-002 | Fresh canonical field/hash pins, Google validate-only publish, selected canonical import, readback reconciliation, durable attempts | Profile route and Google contract tests |
| PST-001 | Standard/event/offer draft CRUD, scheduling, approval, Google create/update/delete, unsupported Product posts excluded | `tests/integration/routes/local-posts.test.ts`; post domain/migration tests |
| PST-002 | Live Google list import, provider disappearance reconciliation, retained stored fallback on refresh failure, paused-write read surface | Local Posts lifecycle integration test; rendered Posts paused state |
| MED-001 | Merchant/customer gallery, attribution/takedown preservation, hosted-URL and direct JPEG/PNG/MP4/QuickTime upload, category update, delete, stale hashes, readback | `tests/integration/routes/media-management.test.ts`; Media migration/contract tests; focused management-tab E2E |
| MNU-001 | NabaPresence-owned hierarchical Food Menus CRUD, eligibility check, hierarchy/count preview, and exact source hashes | Food Menus domain/migration tests; menu editor and comparison UI |
| MNU-002 | Explicit full-resource replacement approval, durable intent, fresh pins, Google PATCH, ambiguity-safe live readback | Food Menus lifecycle integration, domain, migration, and Google contract tests |
| ACT-001 | Merchant-editable Place Action link list/create/update/delete, immutable aggregator handling, stale pins, live readback | `tests/integration/routes/place-actions.test.ts`; Place Action migration/contract tests |
| BIZ-001 | Full Business Information editing for identity, address, categories, attributes, services, service areas, labels, store code, open state, and chain relationships with explicit masks | `tests/complete-gbp-management.test.ts`; `tests/e2e/gbp-management-tabs.spec.ts`; Business Information route/editor |
| BIZ-002 | Validate-only preflight, fresh source hashes, durable mutation intent, Google patch, containment readback, snapshots, and audit | `lib/server/business-information.ts`; `0026_complete_gbp_management_foundation.sql`; type/build gates |
| ADM-001 | Google location create/delete/transfer/match, suggested-update inspection/acceptance, and voice-of-merchant status | Administration route/editor; `tests/complete-gbp-management.test.ts`; focused management-tab E2E |
| ADM-002 | Verification options/history/start/complete plus account/location owner-manager CRUD and invitation acceptance/decline | Administration route/editor; Google contract tests; focused management-tab E2E |
| IND-001 | Lodging attributes and Google-updated comparison, Business Calls settings/insights, and healthcare service/provider/insurance resources | Industry route/editor; `tests/complete-gbp-management.test.ts`; focused management-tab E2E |
| PER-001 | Daily Performance metrics ingestion with bounded restatement, local-calendar dates, selectable windows and read-only paused state | `tests/integration/routes/performance-analytics.test.ts`; Performance domain/migration tests |
| PER-002 | Monthly search-keyword backfill/restatement, 18-month bound, pagination, threshold-preserving display | `tests/integration/routes/search-keywords.test.ts`; keyword migration/contract tests |
| OPS-001 | Bounded tenant-isolated background reconciliation for Hours, Profile, Posts, Media, Food Menus, and Place Actions | `tests/integration/routes/presence-resource-reconciliation.test.ts`; reconciliation-state migration tests |
| OPS-002 | Raw/provider snapshot expiry and attempt retention across Profile, Posts, Media, Food Menus, Hours, and existing review data | Retention route plus `0022_presence_retention_hardening.sql`; migration tests |
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
| 1 | A new user can register, confirm email, and sign in without Google | `tests/integration/routes/password-auth.test.ts`; sign-in/registration/recovery axe scenarios |
| 1 | A new organisation is provisioned under a non-superuser role | `tests/integration/routes/password-auth.test.ts` with `TEST_RUNTIME_DATABASE_URL` |
| 1 | A second-device login keeps the same organisation Google connection | `tests/integration/routes/password-auth.test.ts` cross-device persistence case |
| 1 | Only an authenticated owner/admin can start Google OAuth | `tests/integration/routes/sign-in.test.ts`; `tests/integration/routes/roles.test.ts` |
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
- Twenty-six axe-backed WCAG 2.2 AA browser scenarios cover sign-in,
  registration, password recovery, invitation, design-system, inbox/detail
  state variants, connections, settings, approvals, analytics, and responsive
  views.
- CI seeds 100,000 reviews across 500 locations and asserts the warm P95
  cursor-page query remains below 1.5 seconds.

Hosted CI run URLs: **BLOCKED — this checkout has no Git remote and nothing was
pushed, so no GitHub Actions run exists to cite.** The workflow definition is
`.github/workflows/ci.yml`; local results are recorded in the sprint plans and
live-certification reports.

## Release-only evidence

- Apply `0001_initial.sql` with the production migration role.
- Run `pnpm test:integration` against the release database topology.
- Verify hosted Supabase email confirmation/recovery templates, redirect allow
  list, custom SMTP delivery, provider rate limits, and cross-device sign-in.
- Complete Google OAuth, account/location discovery, notification setup,
  backfill, reconciliation, publish, moderation, delete, disconnect, and replay
  smoke tests with a dedicated verified pilot listing.
- Run manual keyboard and screen-reader checks with the supported release
  browser/assistive-technology matrix.
- Obtain Google/legal approval for the production project model, consent copy,
  and retention interpretation before general availability.
