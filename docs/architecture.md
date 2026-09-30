# Architecture and data controls

## Runtime role and startup assertions

Supabase Auth owns password hashing, password recovery, abuse controls, and
email verification. NabaPresence exchanges only a verified Supabase user
identity for an opaque, HTTP-only application session; it never stores a
password or a Supabase access/refresh token. The server hashes the opaque token
before lookup, binds the resulting user and organisation to the request, and
opens every tenant data operation in a transaction that sets
`app.organisation_id`. PostgreSQL row-level policies then default-deny records
from every other organisation. `lib/server/db.ts` owns this `withTenant`
boundary and does not accept a caller-supplied tenant header.

The application `DATABASE_URL` uses a non-superuser member of
`naba_app_runtime`; `DIRECT_DATABASE_URL` is reserved for migrations and
administrative test setup. `lib/server/startup.ts` verifies the active database
identity, RLS posture, required secrets, and production feature configuration.
`instrumentation.ts` runs `assertProductionSafety` before the production server
accepts traffic, so a superuser or `BYPASSRLS` runtime identity fails closed.
Verified application users are provisioned by the SECURITY DEFINER
`provision_authenticated_user` database function through
`lib/server/provisioning.ts`, without giving the runtime role unrestricted
organisation or user-table privileges. The stable provider subject resolves
the same user and default organisation on every device. Google OAuth is a
separate owner/admin action whose encrypted connection belongs to that
organisation, so application sign-out or a new device session does not remove
the Google connection.

Arbitrary tenant headers are never accepted. Owner/admin, member, viewer,
location access, and publish authority checks happen above the database RLS
boundary.

Two content-free routing tables intentionally sit outside tenant RLS:
`webhook_route` maps a globally unique Google location name to its tenant, and
`organisation_job_route` lets authenticated cron workers enumerate tenant IDs.
They contain no customer content; every follow-on operation immediately enters
`withTenant`.

## Request skeleton: `route()`

Every handler under `app/api/**/route.ts` is built by `route({...})` from
`lib/server/route.ts` (77 of 78 route files; the last,
`app/api/auth/callback/google/route.ts`, re-exports another handler). The
wrapper owns, in order: the request id, generated once with
`serverRequestId`, exposed as `ctx.requestId`, echoed as the `x-request-id`
response header on success and error, and written into every error body
(handlers pass it to `writeAudit` and `log`; they never regenerate it);
authentication, where `auth: "session"` (the default) runs `requireSession`,
`auth: "cron"` requires `Authorization: Bearer <CRON_SECRET>` compared in
constant time and otherwise answers 401 `invalid_cron_token`, and
`auth: "public"` hands the handler `session: null`; organisation-level role
gating, declared as `roles: ["owner", "admin"]` on the route rather than
inside the handler and answered with 403 `permission_denied`; parsing of
`params`, `query` and `body` through zod, where a missing or unparsable body
becomes `{}` before validation and any zod failure is a 400 `invalid_request`
with `fieldErrors`; the tenant transaction, exposed to session routes as
`ctx.tenant(fn)`, which is `withTenant(session.organisationId, fn)`; and error
mapping, where everything thrown passes through `apiError(error, requestId)`.
The error body is `{ error: <code>, message, requestId }` plus `fieldErrors`,
`retryable`, `reconnectRequired` and `details` when set.

The wrapper's altitude is the organisation. Location-level access is
deliberately not its concern: handlers call `requireLocationAccess`,
`canPublishLocation` or `grantsFor` inside `ctx.tenant(...)` once they know
which location a request touches, and kill switches and capability checks
stay in the domain module. Cron and public handlers import `withTenant` or
`getDatabase` directly; the only `getDatabase()` calls left in route files are
the commented cross-tenant enumeration and routing reads. `runtime` and
`maxDuration` remain per-file static exports because Next reads them at build
time. `getSession()` is wrapped in `React.cache`, so a server render that asks
for the session from a layout, a page and a prefetch helper performs one
lookup and one `last_seen_at` write; in route handlers the cache is a no-op.

## Location visibility: one rule

"Which locations may this member see, edit or publish to" is decided in
`lib/server/permissions.ts` and nowhere else. Owners and admins see, edit and
publish everywhere. A viewer or member with no `location_member` rows sees
every location in the organisation; one with assignments sees only those.
`canEdit` is visible-and-not-viewer; `canPublish` is true for owner/admin,
false for viewer, and for a member the assigned row's `can_publish` when
assignments exist, else the organisation-level `session.canPublish` fallback.
Routes compose the rule instead of restating it: `visibilityPredicate(sql,
session, column)` is a SQL fragment (`true` for owner/admin) appended to any
SELECT; `requireLocationAccess` raises a 404 for a hidden or nonexistent
location, with the caller's own code where the subject is not a review;
`canPublishLocation` answers for one location; `grantsFor` answers for many in
one query and feeds the capability payloads. There is no inline
`exists (select 1 from location_member ...)` in route files, capabilities or
query builders. Every helper expects the tenant transaction, so RLS already
scopes `location_member` to the organisation before the rule runs.

## Google integration

OAuth uses state, a signed HTTP-only state cookie, PKCE S256, offline access, and
`business.manage`. Access and refresh tokens, Google review resource names, and
Google review IDs are encrypted with AES-256-GCM before persistence; keyed
lookup uses one-way SHA-256 hashes. Discovery uses the Account Management v1 and Business
Information v1 APIs. Reviews and reply operations use the Business Profile v4
surface.

Backfill and reconciliation share one idempotent upsert path. Pub/Sub messages
are verified with Google-signed OIDC audience/issuer claims plus an optional
constant-time deployment token, deduplicated by provider message ID, routed
through a content-free location map, and reconciled against Google before
becoming inbox data. Failed event metadata is retained for at most 30 days and
can be replayed by an authorised operator.

### Connection service

`lib/server/google/connections.ts` is the only code that changes a Google
connection's credentials or lifecycle state; routes call its operations
(`getAccessToken`, `completeAuthorisation`, `recordCredentialRejection`,
`disconnect`, `setNotificationSettings`) and never write `google_connection`
or its reconnect tasks themselves. `connection-failures.ts` holds the state
transitions it and the transport share.

Two invariants hold in SQL rather than by lock ordering:

1. **Disconnect is authoritative.** Every write after a Google round trip is
   conditional on `status <> 'disconnected'`, so a refresh or rejection that
   lands after a disconnect cannot restore tokens, reactivate the row or open
   a reconnect task.
2. **A result belongs to its credential.** `credential_generation` is bumped
   by every consent and every disconnect; refresh results, refresh
   rejections and API 401s carry the generation they were issued under and
   are dropped if it has moved. A request that loses that race retries once
   with the new token.

Refreshes are single-flight per connection across servers (a session advisory
lock on a reserved connection, re-reading the row after taking it). Consent
requires `business.manage` in the returned `scope` (a missing field counts as
not granted) and a refresh token new or stored. Reconnect never revokes the
token it replaces — Google revokes the whole grant for the project, including
the new token — and only a deliberate disconnect calls `/revoke`, recording
the outcome on the row.

Failure classification: `invalid_grant`/scope loss → needs reconnect; 5xx,
timeouts, rate limits, `invalid_client` → Degraded (retried, no reconnect);
403 PERMISSION_DENIED or 404 for one location → that listing's
`access_state = 'access_lost'`, connection untouched; 403 with a project
reason (API disabled) → operator fault, logged. RISC events
(`/api/webhooks/google/risc`) route through the same rejection path.

Every Business Profile request draws from a Postgres budget shared by all
instances (`lib/server/google/rate-budget.ts`, 0049) before the per-process
pacer; see `docs/runbook.md`.

Token ciphertext carries a key id (format 0x02) once `TOKEN_ENCRYPTION_KEYS`
is set, and any configured key decrypts, so the encryption key can be rotated
with `POST /api/operations/reencrypt` and no reconnects. OAuth state is signed
with `OAUTH_STATE_SECRET`, not `NEXTAUTH_SECRET`, once that is set.

Platform sign-in and the Google grant are separate lifetimes: sessions slide
to 14 idle days and end 90 days after sign-in, "sign out everywhere" ends
them all, and none of it touches a connection or background sync.

## Standalone canonical resources and Google publication

NabaPresence is the sole owner of canonical profile, Hours, and Food Menus
data. A tenant-scoped `presence_canonical_resource` row stores each location's
resource payload, optimistic revision, reconciliation hashes, and last
successful reconciliation time. The first load of a resource imports the live
Google value as revision 1; all later edits are explicit NabaPresence CRUD
operations. No venue mapping or external product service is involved.

NabaPresence normalizes its canonical Hours and the live Google Business
Information v1 location hours, hashes both, and classifies baseline-aware drift
as `in_sync`, `core_dirty`, `google_dirty`, or `conflict`.
`hours_sync_attempt` stores the approved canonical revision, source hashes,
update mask, intended public payload, warnings, actor, and provider outcome
before any write occurs.

Hours publication is gated by both the global publish control and the
profile-write capability flag, plus the member's location publish permission.
The approved pins are rechecked against fresh provider reads. Google
`validateOnly` runs first; the real PATCH is single-attempt and followed by a
read-back hash comparison. Ambiguous writes are read before any retry, and an
exact repeat of an already successful approval is idempotent.

## Per-surface kill switches

`lib/server/env.ts` declares the global controls `DRAFTS_ENABLED`,
`PUBLISH_ENABLED`, `SYNC_ENABLED`, `WEBHOOKS_ENABLED`, `JOBS_ENABLED`,
`SEMANTIC_VERIFY_ENABLED`, `RETENTION_ENABLED` and `RETENTION_DELETES_ENABLED`,
and one flag per Google surface. The last four gate background and degraded
paths rather than a provider surface: `JOBS_ENABLED` (with `PUBLISH_ENABLED` and
`SYNC_ENABLED`) is passed into `claim_due_jobs` as the permitted job kinds, so a
paused kind is never claimed rather than claimed and refused;
`SEMANTIC_VERIFY_ENABLED` skips the semantic pass instead of failing it; and the
two retention switches separate stopping the sweep from stopping only its
irreversible half. A provider mutation runs only when `PUBLISH_ENABLED` and the
surface flag are both on (`gbpWritesEnabled(env, surface)`); ingestion
surfaces are read-only and answer to their own flag alone
(`gbpIngestionEnabled`). Each module checks the flag at its provider boundary
and keeps its own error code, so a paused surface is distinguishable in logs
and in the UI:

| Flag                         | Surface (`env.ts` key)    | Modules                                                | Error when off                    |
| ---------------------------- | ------------------------- | ------------------------------------------------------ | --------------------------------- |
| `GBP_PROFILE_WRITES_ENABLED` | `profileWrites`           | `hours.ts`                                             | 409 `hours_publishing_disabled`   |
|                              |                           | `profile.ts`                                           | 409 `profile_publishing_disabled` |
|                              |                           | `business-information.ts`                              | 503 `business_information_paused` |
|                              |                           | `industry-management.ts`, `location-administration.ts` | 503 `google_writes_paused`        |
| `GBP_POSTS_ENABLED`          | `posts`                   | `posts.ts`                                             | 503 `publishing_paused`           |
| `GBP_MEDIA_ENABLED`          | `media`                   | `media.ts`                                             | 503 `media_paused`                |
| `GBP_PLACE_ACTIONS_ENABLED`  | `placeActions`            | `place-actions.ts`                                     | 503 `place_actions_paused`        |
| `GBP_FOOD_MENUS_ENABLED`     | `foodMenus`               | `food-menus.ts`                                        | 503 `food_menus_paused`           |
| `GBP_PERFORMANCE_ENABLED`    | `performance` (ingestion) | `performance.ts`                                       | 503 `sync_paused`                 |
| `GBP_KEYWORDS_ENABLED`       | `keywords` (ingestion)    | `keywords.ts`                                          | 503 `sync_paused`                 |
| `IMPORT_REVIEW_ENABLED`      | —                         | `import-review.ts`                                     | 503 `import_review_paused`        |

Review reply publishing answers to `PUBLISH_ENABLED` alone (`publishing_paused`)
and drafting to `DRAFTS_ENABLED` (`drafts_paused`). `lib/server/capabilities.ts`
mirrors the same functions into the per-location capability payload so the
interface can show a paused-write notice without hiding the surface: disabled
features render current stored/live state and a reason code, so an operator
can distinguish "no data" from "writes intentionally disabled".

## One write pipeline: `runGbpWrite`

`lib/server/gbp-write.ts` is the single implementation of the write discipline
above. Hours, profile, media, place actions, food menus and posts run every
provider mutation through it; `gbp-management.ts` is a thin façade over the
same pieces for the Business Information, industry and administration
consoles, which share the `gbp_management_mutation` table. The module owns
`loadLinkedLocation` (the one "linked Google location" query, raising the one
`google_location_not_linked` 409 and a 404 that reads identically for a hidden
and a nonexistent location), `requireGbpWrite` (capability plus kill switch),
`requirePublishGrant`, `idempotencyKey` (one hashing recipe) and the phase
machine `runGbpWrite`: start a durable intent → `validate` (Google
`validateOnly`) → `mutate` outside any transaction → `readback` → settle →
audit. No schema changed: each module keeps its attempt table
(`hours_sync_attempt`, `profile_sync_attempt`, `gbp_media_mutation`,
`place_action_mutation`, `gbp_local_post_attempt`, `food_menus_sync_attempt`,
`gbp_management_mutation`) behind the `AttemptStore` interface;
`attemptStore()` is the generic implementation and maps the canonical
`validating / validated / publishing / succeeded / failed / ambiguous`
vocabulary onto whatever each table's CHECK constraint allows, and posts
implements the interface by hand because every transition also flips
`gbp_local_post.status`.

`onExisting` decides what an existing row for the key means.
`onExisting: "resume"` (hours, profile, food menus and the post publish)
returns a succeeded row as idempotent and re-arms a terminal failure; an
in-flight row gets the module's 409 or is recovered, and a provider failure is
settled `failed` or `ambiguous`, both under the policy in "Ambiguous, failed,
and interrupted writes" below.

`"replay"` (media, place actions, the post delete, management) treats any
existing row for the key as idempotent. Those keys embed `ctx.requestId`, which
is minted per HTTP request, so the replay branch is unreachable across
requests: a client retry issues a new request id, a new key, and a second
Google write. Closing that needs an intent token minted by the client — one per
Publish/Upload/Add-link press, resent unchanged on retry — carried on the
request and keyed on instead of the request id. Until then these surfaces are
idempotent within a request and at-least-once across one.

## Ambiguous, failed, and interrupted writes

`ambiguous` means the provider state is not known to match the intent and
might; `failed` means it is known not to. `classifyFailure` in
`lib/server/gbp-write.ts` is the single implementation of that judgement, and
is exported so the surfaces that still run their own phase machine
(`lib/server/business-information.ts`) classify identically. An "ambiguous"
error below is a `GoogleMutationAmbiguousError`, the one thing
`isAmbiguousProviderError` recognises:

| Phase                    | Error                                      | Settled as  | Raised                  |
| ------------------------ | ------------------------------------------ | ----------- | ----------------------- |
| `validate`               | anything                                   | `failed`    | the error               |
| `mutate`                 | ambiguous, under `onAmbiguous: "fail"`     | `ambiguous` | the error               |
| `mutate`                 | ambiguous, under `onAmbiguous: "readback"` | —           | continues to `readback` |
| `mutate`                 | anything else                              | `failed`    | the error               |
| `readback.read`          | anything                                   | `ambiguous` | the error               |
| `readback.verify`        | returned `false`                           | `failed`    | 502 mismatch            |
| `readback.verify`/`hash` | ambiguous                                  | `ambiguous` | the error               |
| `readback.verify`/`hash` | anything else                              | `failed`    | the error               |

A `validateOnly` failure cannot have written anything, so it is always
`failed`. A readback that completes makes the provider state known: a match
proves the write applied, even after an ambiguous PATCH, and a mismatch proves
the intent was not achieved, so both are safe to retry from a fresh snapshot.
Only a readback that itself fails leaves the state unknown. The provider error
code recorded on the row is `ApiError.code`, else an object's string `code`,
else the module's `failureCode`. The two `onAmbiguous` modes exist because the
migrated modules kept their previous behaviour; the intended convergence is
`"readback"` wherever a readback exists, because ambiguous writes are read
before any retry.

An interrupted request strands a row rather than failing it. The intent is
committed in its own transaction and every later phase runs outside it, so a
request that dies in between — a function timeout, an instance recycled
mid-deploy, a settle transaction that does not commit — leaves the row in
flight with nothing in the module to move it. No GBP attempt table carries a
lease, and `reclaim_expired_jobs`
(`supabase/migrations/0029_job_runner_leases.sql`) reaps only the job runner's
own `processed_webhook_event`, `sync_checkpoint` and `publish_attempt`. An
unchanged snapshot re-derives the same key, so without recovery that publish
would 409 until `expires_at` deleted the row: 365 days for hours and profile,
180 for food menus.

A `"resume"` surface therefore 409s an in-flight row only inside a two-minute
grace window (`IN_FLIGHT_GRACE_MS`, the same window
`lib/server/publishing/recover.ts` applies to reply publishes, and comfortably
past the `maxDuration = 60` those routes declare). Past it the row is treated
as interrupted and settled from what the provider actually holds:

- `readback.read` throws — the state is still unknown, so the row settles
  `ambiguous` and the error is raised.
- `readback.verify` is true — the row settles `succeeded`, with `onSuccess`
  and the audit entry, and the request returns `idempotent` without writing to
  the provider.
- `readback.verify` is false or throws — the intent is demonstrably not live,
  so the row settles `failed` and the request re-arms it and publishes.

That is safe because the key pins the intent: two requests share a key only
when they intend the same write (canonical revision, snapshot hashes, payload
hash), so `verify` compares the provider against exactly the intent the
stranded row carries. A row with no recorded start time, and a surface with no
`readback`, keep the plain 409 — there is nothing to compare against.

Recovery needs a request to arrive, so it only ever reaches a row somebody
comes back to under the same key, and the usual repair — edit the canonical
resource and publish again — mints a different one. The retention cron
(`app/api/cron/retention/route.ts`) reaps the remainder: a row left in any
in-flight status for twenty-four hours (measured from `started_at`, or from
`created_at` on the two tables that lack it) is settled `ambiguous` with
`attempt_interrupted`, a settled status, so the next request for that key
re-arms it instead of 409ing on it. The halves are not interchangeable — the
reaper holds no provider credentials and cannot read anything back, and the
readback path never runs at all for a tenant nobody opens.

The reply pipeline in `lib/server/publishing/*` deliberately does not use
`runGbpWrite`; "Three-phase reply mutation and recovery" states what it keeps
instead and why.

## Three-phase reply mutation and recovery

The model produces a draft only. Structured output is validated against a strict
JSON Schema. A second stage applies deterministic personal-data, promotion,
unsupported-commitment, unsafe-language, location, byte-length, and complaint
checks, followed by semantic evidence verification. A `fail` verdict is a hard
publish block. Human approval is enabled for every new organisation.

The semantic pass runs outside any transaction, and its three outcomes are kept
apart because two of them look alike and mean opposite things. Skipped
(`SEMANTIC_VERIFY_ENABLED` off, or no API key) is a deliberate degraded mode:
the deterministic checks stand alone and the draft is publishable. Unavailable —
attempted, and the provider answered 429 or 5xx — saves the operator's text but
settles the verdict `pending`, the fourth member of the verdict vocabulary,
which `assertDraftPublishable` refuses with 409 `verification_required`. A
`pass` there would assert a check that never ran. Approval is bound to a
specific draft: `review_reply.pending_draft_id` records what was parked, the
route resolves it server-side and never trusts the client's `draftId`, and an
approver whose pane went stale is answered 409 `approval_draft_changed` rather
than credited with approving text they never read.

Publish idempotency is derived from organisation, review, and reply-body hash.
`lib/server/publishing.ts` is the barrel for `lib/server/publishing/`, whose
modules are named after the phases: `intent` (gates, approval routing,
idempotency key, the durable `started` attempt), `approval`, `provider`
(Google reply PUT/DELETE/GET, always outside a transaction), `settle` (local
reply and workflow state), `attempt` (the `publish_attempt` row and event
store, provider-failure classification), `publish` and `delete`
(orchestration), `retry` (the job runner's due-retry path) and `recover`. The
intent therefore exists durably before the provider write. Ambiguous failures
are kept distinct from deterministic provider rejection and are never blindly
repeated. `recoverAttempt` reads the provider state first, compares the
intended body, and settles `succeeded`, `not_applied`, or `diverged`.
`lib/server/jobs.ts` claims due retry/recovery work; `app/api/jobs/run/route.ts`
exposes the cron-authenticated worker tick.

The reply pipeline shares `runGbpWrite`'s discipline and its
`isAmbiguousProviderError` primitive but deliberately keeps its own attempt
store and phase machine. `publish_attempt` schedules automatic retries
(`retryable`, `next_attempt_at`, `attempt_no`, 429 back-off) that the
helper's succeeded/failed/ambiguous settle vocabulary cannot express; an
in-flight or ambiguous row is recovered by readback and intended-body
comparison rather than rejected with a 409; a permanent failure is a 409
rather than a re-arm; the intent transaction also writes `review_reply`,
`review.workflow_status` and `publish_attempt_event`; and a provider failure
is returned as an outcome the routes map to 409/429 rather than thrown. The
boundary statement lives in both file headers and is kept in step.

The vocabulary also carries `superseded` (0035), which is not a provider
verdict but a retirement: the mutation a queued attempt was keyed to is no
longer the one the reply wants — a delete parked on a 429 while the operator
publishes new text, or a publish intent withdrawn by a local cancel. Settling
those `failed` would keep the runner away from them (every claim predicate is
an allowlist) but would also make `resolveExistingPublishAttempt` answer the
same idempotency key with a permanent 409 `previous_publish_failed` for ever;
`superseded` asserts nothing, so the row stays re-armable under its own key.
`publish_attempt.publish_generation` pins the `review_reply` generation an
attempt was created against, and `applyDeletedReply` bumps that counter, so a
claim whose recorded generation no longer matches is provably about to replay a
mutation for a reply that has since been replaced.

`review.restricted_at` is a publish gate in its own right, enforced in
`assertDraftPublishable` and again in the runner's `claimRetry` — not only on
the drafts route — so a review Google restricts after a retry was queued is
never published by the background path.

## Profile and location-content control plane

NabaPresence owns the public venue profile and Food Menus. Profile fields carry
explicit source policy (`bidirectional`, `import_only`, or `google_read_only`);
operators can edit supported canonical fields directly or explicitly import
selected live Google values. Food Menus support hierarchical CRUD for menus,
sections, and items. Publication is a complete-resource replacement: the
operator sees canonical and live Google hierarchies, counts, eligibility, and
source hashes before explicit approval. A Google readback must hash to the
approved canonical resource.

Google Posts, merchant/customer Media, and Place Action links run through
`runGbpWrite` like Hours, Profile and Food Menus: tenant/location permission,
capability plus kill switch, durable pre-call intent, provider mutation
outside the transaction, and a live readback or list reconciliation. Posts
support only Google API topic types that can be created (`STANDARD`, `EVENT`,
`OFFER`). Customer Media keeps author attribution and takedown links, while
only merchant-owned media can be changed. Aggregator-owned Place Actions
remain visible but immutable.

Capability switches gate provider mutations and ingestion, not the visibility
of completed management surfaces (see "Per-surface kill switches").

## Checkpointed synchronization and workers

`lib/server/reviews.ts` uses a durable `sync_checkpoint` for every backfill,
notification sync, sweep, and reconcile. Page tokens advance only after the
page transaction commits; high-water timestamps drive bounded reconciliation,
and deep sweeps eventually revisit older pages. Provider-deleted reviews are
tombstoned locally and excluded from analytics rather than silently retained.
Every claim predicate is an allowlist of statuses, which is what makes the
terminal `dead` state (0030) sufficient on its own: a checkpoint retired after
ten consecutive failures — or immediately, on an error no retry can fix — leaves
every claim window and the backlog gauge without a single predicate changing.
The metric checkpoints retire the same way through `dead_lettered_at`, and both
are re-armed only by an explicit operator act (a fresh backfill; a relink).

`lib/server/jobs.ts` drains retryable webhook events, checkpoints, publish
attempts and the recurring reconcile, performance and keyword checkpoints
(0048) across the content-free `organisation_job_route`, immediately
re-entering `withTenant` for customer data. Those three recurring syncs are a
queue: their cron only arms a checkpoint for every linked location
(`ensure_recurring_checkpoints`), the runner claims what is due under its
per-organisation cap, and success books the next run on the kind's grid from
the slot it was due in (`next_scheduled_run`). `sync_checkpoint.
last_succeeded_at` moves only on success and is what every freshness signal
reads. Vercel Cron drives eight ticks (`vercel.json`); `scripts/scheduler.mjs`
runs the older seven for local and non-Vercel deployments.
`lib/server/leases.ts` protects each fleet-wide loop with PostgreSQL advisory
locks so overlapping schedulers skip rather than duplicate work, and stamps that
loop's `ops_heartbeat` row on a completed run so the lock namespace and the
liveness names cannot drift.

`/api/sync/presence-resources` performs a separate bounded sweep for Hours,
Profile, Posts, Media, Food Menus, and Place Actions. It selects the least
recently attempted linked locations per tenant, isolates every resource
failure, and records content-free success/error checkpoints. The scheduler
runs this sweep every 15 minutes by default, so reconciliation does not depend
on a user opening the location workspace.

## Health and notifications

Client and listing health derive from successful checks, never from token
refreshes (`lib/clients/health.ts`, `lib/server/location-summary.ts`): Up to
date (checked within an hour), Data delayed (late or retrying — the platform
recovers on its own), Action needed (a login to reconnect, a permission
missing, or a listing's manager access removed). The org-wide banner shows any
login that needs reconnecting to everyone, with a one-click reconnect for
owners and admins.

`/api/cron/health` (every 15 minutes) re-derives incidents per tenant under
RLS (`notification_incident`), emails each new one once to owners and admins
(`notification_delivery`, unique per incident and recipient, claimed before
sending), and raises `platform_incident` for stopped ticks and sustained quota
pressure. Email goes through `lib/server/notifications/email.ts`; with no
provider configured deliveries are recorded `suppressed`.

## Membership, organisation switching, privacy, and retention

Owners create one-time invitations through `app/api/invitations/route.ts`.
`lib/server/provisioning.ts` validates the invitation and provisions the
verified email/password identity inside the inviting organisation; it does not
create an unrelated tenant. `app/api/session/switch/route.ts` verifies
membership, rotates the session, updates the default organisation, and audits
organisation switching.

Google source payloads, review text, reviewer display names, addresses, and media
links carry an expiry no later than the organisation’s configured window, which
is database-constrained to 30 days. `/api/cron/retention` purges expired raw
content while retaining minimal derived operational metrics. An owner-approved
legal hold from `app/api/legal-holds/route.ts` blocks purge and erasure only for
its selected review. `app/api/privacy/requests/route.ts` implements attributable
access, rectification, erasure, and restriction fulfilment;
`app/api/privacy/export/route.ts` exports only still-retained content.

Disconnect immediately destroys stored OAuth tokens and disables notifications.
External location data is scheduled for deletion within seven days. Audit rows
are append-only by database trigger, and `/api/cron/retention` enforces the
bounded audit-retention policy.

Canonical profile, Hours, and Food Menus are public operational business data
owned by NabaPresence and retained until the location or organisation is
deleted. Ephemeral live-Google comparison snapshots expire after 30 days;
mutation attempts expire according to the resource policy. Reconciliation
hashes contain no customer content.

Google Business Profile performance rows are non-personal, derived daily
counts. They persist for trend reporting outside the raw-content retention
window and are deleted automatically when their `external_location` is
purged. Dates are stored as Google-reported local calendar dates without
timezone conversion.

Profile and Food Menu comparison payloads and Google Media provider
snapshots expire after 30 days. Posts retain only the authored product record
after their raw provider payload expires. Profile/Hours attempts retain one
year; Posts, Media, Food Menus, and Place Action mutation attempts retain 180
days.

## Contracts: one declaration per endpoint

`lib/contracts/*` is the one declaration of every request, query and response
schema, as zod plus inferred types, one module per surface (reviews, hours,
profile, media, posts, place actions, capabilities, import review, links and
directory, activity, business information, industry, administration, food
menus, settings, connections, google, notifications, members, invitations,
legal holds, privacy, analytics, sync, session, operations, auth). Routes
import the request schemas into `route({ params, query, body })` and mark
their responses with `satisfies <Response>`; `lib/api/*` imports the response
schemas into `apiFetch({ schema })` instead of hand-mirroring server shapes,
so a drift between reader and wire is a compile error on the server and a
parse error in the browser. The reviews contract is the model: the sort,
workflow, reply-state, verification and publish vocabularies and the wire
codec (`encodeReviewsQuery` / `decodeReviewsQuery` plus the cursor codec)
live once, and `lib/server/reviews-query.ts` maps `ReviewSort` to SQL through
a `Record` the compiler refuses to leave incomplete.

Contracts are client-safe by construction: no `server-only`, nothing from
`lib/server`, and from `lib/domain` only modules with no Node imports. The
domain modules that hash (`hours.ts`, `profile.ts`, `food-menus.ts`) therefore
split their constants, enums, types and non-hashing normalisers into sibling
`*-vocabulary.ts` modules, which the server module re-exports so server code
is unchanged. `tests/contracts-client-safe.test.ts` walks the import graph of
every contract and fails if a `node:*` or `server-only` import becomes
reachable.

## Frontend pattern

The locations area follows the inbox's "pure evaluator + thin renderer"
shape. `components/locations/location-tab.tsx` is the one shell for every
per-location tab: it owns capabilities → optional gate → resource fetch →
pending/error with retry → loaded, and each tab is a render function that
receives `{ data, caps, disabled, editReason, publishReason }`. The resource
query is passed as a hook, so a gate that fails (industry and administration
require `canEditCanonical`) never mounts the query and a member never issues
the 403 GET. `useResourceMutation` (`lib/queries/use-resource-mutation.ts`)
is `useMutation` plus the three things every write used to hand-roll:
invalidate through the `queryKeys` factory, toast on success, and
`describeActionError` on error. `lib/errors/action-errors.ts` is the single
mapping from server error codes to user copy, with 401 and 5xx fallbacks and
one `context` switch for the two approval codes whose wording differs between
replies and posts; no error code is ever shown. `components/ui/query-states.tsx`
renders pending, error, empty and ready states for every query-backed
surface, and each dashboard segment (`home`, `inbox`, `settings`,
`(business)`) has its own `error.tsx` boundary so a failure stays inside the
segment. Every `queryFn` forwards its abort signal; a 401 redirects to sign-in
only for foreground requests, so a focus or interval refetch cannot pull an
operator off a half-edited page. The inbox and the photos tab keep their
filters, page and selection in the URL (`lib/inbox/url-state.ts`,
`lib/locations/photos-url-state.ts`).

Server prefetch (`lib/server/prefetch.ts`) hydrates a page's first queries
under the same keys the client hooks use: the reader the API route calls,
built under `satisfies <Response>` and pushed through a JSON round-trip plus
the contract parse, so the cache is byte-for-byte what `apiFetch` would have
produced; a failed reader is logged and skipped, never thrown. It is limited
on purpose. Only readers served from our own database are prefetched (home
counts and the 30-day overview, location capabilities, the posts list, the
settings role projection): the Google-backed tabs read live and cost 3-5s per
request inside a server render, which would hold first paint and be repeated
by every `<Link prefetch>`. And it is never used on a page whose state lives
in the URL: a page that reads `searchParams` re-renders on the server for
every filter, queue or selection change, and Next moves focus to the
re-rendered segment, which wiped text an operator had typed into the inbox
location filter. Those pages hydrate client-side as before.

## Naming

The product's display name is NabaPresence (renamed from NabaReview on
2026-07-29). The rename covers the presentation and telemetry layer only:
user-facing copy and metadata, documentation, the `package.json` name, the
OpenTelemetry service name, the structured-log `service` field, and the
`nabapresence.*` metric, tracer, and span-attribute prefixes.

Wire and infrastructure contracts keep their existing names on purpose;
renaming them breaks live installs or local environments for no user value.
Do not "finish" the rename on any of these:

- Cookies `naba_session` and `naba_google_oauth` — renaming signs every user
  out; the `naba` prefix is brand-neutral.
- Database roles `naba_app_runtime`, `naba_app`, and `naba_test_runtime`, the
  `app.*` GUC namespace, and any future `naba:*` advisory-lock keys.
- The CI database `nabareview_test`, created per job by
  `scripts/ci/postgres.mjs` for ci.yml's Migrations, Integration and E2E
  jobs.
- Historical plan and evidence documents under
  `docs/archive/2026-07-frontend-rebuild/`, which keep pre-rename spellings
  except where they specify a not-yet-implemented metric name or user-facing
  string.

Identifiers already migrated alongside the design-system replacement stay in
their new form (do not rename back): the local database `nabapresence`, the
Supabase local project id `nabapresence`, and harness/bootstrap addresses
(`harness-…@nabapresence.test`, `local-owner@nabapresence.local`).

## Provider support evidence

`lib/domain/google-support.ts` is the versioned retirement catalogue. The shared
Google transport refuses retired endpoints before quota acquisition or network
dispatch; old industry mutations also fail before an attempt is persisted.
Historical activity keeps its original status and adds a retirement explanation.

`lib/domain/google-capabilities.ts` adds field-level Business Information
classifications. API support, observed eligibility, local validation permission
and positive write eligibility are separate values. The response contains the
catalogue version, documentation check date and location observation time.
The current service-write guard uses the same catalogue metadata flag after a
fresh baseline read. Ordinary field writes retain their validate-only step.
See [provider support](google-provider-support.md) for current coverage and
[programme acceptance](gbp-operations-acceptance.md) for uncompleted families;
these additions do not yet complete the action catalogue or shared approvals.

## Management execution and confirmation evidence

Migration `0059_management_confirmation` adds execution and confirmation states,
independent readback JSON, observation time and confirmation error to the existing
tenant-scoped `gbp_management_mutation` table. Existing records start as
`unrecorded`; historical success is not converted into independent confirmation.
These columns share the parent record's 180-day expiry, tenant isolation and
retention/legal-hold classification. The confirmation payload is provider data
and must be handled with the same access and erasure rules as `google_response`.

Lodging uses `lib/server/gbp-confirmation.ts`: one mutation, then an independent
read matching the requested update-mask paths. Accepted execution can remain
unresolved. An ambiguous response can be confirmed by readback while execution
remains unknown. Only the readback is cached as an observation. Missing boolean
values are not treated as false. Public Search/Maps display is not inferred.

A location/resource advisory lock serialises the unresolved-attempt check and
attempt creation. Confirmation recovery uses the same lock on a dedicated
connection, allowing the runtime pool to contain only one connection without
deadlocking nested tenant work. Recovery validates the original Google target
and performs only reads. Its outcomes are appended to the audit log.

Apply this additive migration before deploying these readers/writers. Rolling
back application code can leave the evidence columns in place. Other write
families and automatic confirmation jobs remain programme work.

Migration `0060_gbp_change_sets` adds lodging reviews with frozen payload, mask,
Google baseline, target/account/connection, initiating user and approval policy.
The runtime role can update only the approval actor/time; it cannot rewrite
reviewed content. Reviews expire for approval after 24 hours and are retained
for 180 days under the existing tenant retention sweep. Approval checks current
membership and enforces the organisation's two-person policy. Publication checks
them again, re-reads Google, and rejects changed baselines, policy or targets.
The required lodging assertion timestamp is part of the displayed, frozen payload.

Publication holds the location/resource lock across preflight, execution and
readback. A unique attempt reference binds each change set to one execution;
repeating the same approved intent returns its recorded outcome without sending
another Google mutation. A distinct intent cannot bypass an unresolved attempt.
Migrations `0060` and `0061` extend these reviews to business-information and
attribute writes. Other write families still require the same approval boundary.

Account onboarding has no linked location at the start. Migrations `0062` through
`0064` therefore add tenant-scoped draft, review and creation records rather than
requiring a synthetic location. Draft targets and provider request UUIDs are
immutable. Revision checks and search identities reject concurrent edits and late
matching responses. Reviews freeze the draft, matching evidence and creation
decision after provider validation; approval follows the current two-person policy.

Saved-draft service metadata and chain discovery use the selected account and
connection without a linked location. Both check the expected revision, obtain
fresh provider account proof and recheck local account/client/connection access
and payload hash after discovery. Services retain category, language and country
context; nonempty new services require fresh category support before validation
and creation. Chain discovery returns exact provider resources, with malformed
or duplicate identities rejected. Neither metadata read authorises publication.
Saved-draft accessible-match discovery also obtains fresh account proof and lists
every account location page, up to 100 pages of 100 resources. Malformed pages,
duplicate resource names, repeated tokens or an unfinished page limit are errors;
they never become an empty or inaccessible result. Correlation uses an exact
nested Location resource name or exact provider metadata place ID. Search resource
prefixes and business titles are not converted into location identities, and an
ownership URL does not imply lack of access. The response distinguishes accessible,
not accessible, ambiguous and identity-unconfirmed matches. Revision/hash, search
identity, search observation time, client/connection access and creation-started
state are checked before and after discovery. Discovery creates no local mapping
and authorises no link. Migration `0065` adds separate immutable local match-link
reviews, with a composite tenant/draft foreign key, forced RLS and approval-only
runtime updates. Reviews freeze exact resource readback, draft/search identities,
account/connection/client, proposed local name and existing mapping conflicts.
Approval refreshes account membership and the selected resource, then rechecks
draft, actors, mapping state and current two-person policy under the draft lock.
Unknown provider verification remains null rather than false. Reviews expire for
approval after 24 hours and cascade with the parent draft's 180-day retention.
No provider create/validation call represents local-link review. Migration `0066`
adds forced-RLS local-link operation records, immutable review identity/hash and
generation-bound retries. A parent-draft lock and cross-table exclusion triggers
serialize creation against pending/completed local links. The mapper transaction
commits local/provider mapping, routing, client-holder grants, sync checkpoint,
audit and result together. Failed transactions roll back those mapping effects;
the separate durable claim records failure and supports guarded retry. Status
restoration settles abandoned pending claims after two minutes. A duplicate
submission whose discovery finishes after the first claim restores that exact
review/hash's recorded result. Setup restores the operation before draft actions,
then exposes revision/search-bound discovery, exact mapping review, policy-aware
approval, explicit execution confirmation and outcome recovery. Shared Zod API
adapters treat only the explicit no-operation response as absence; permission,
missing-draft and status-service errors block new actions. Review IDs restore
from the setup URL. Unsaved mapping decisions guard navigation and competing
creation; status restoration after submission keeps actions disabled until the
recorded outcome is available. Provider confirmation/initial sync is not inferred
from a local linked result.
Setup forms preserve service and relationship siblings and omit only explicitly
removed values. Unfinished service/relationship/hours entries block save, matching
and review. Creation hours retain provider opening and closing weekdays, explicit
special dates and overnight end dates rather than flattening them through the
linked-listing normalized editor. Closed special dates omit provider-ignored
end dates/times. Reviews show exact periods alongside proposed IDs, relationship
types and service prices. Independent hours readback compares the period set,
normalizing omitted zero times, false closure flags and same-date end defaults
without accepting changed days, dates, times or missing periods.
Additional creation hours retain exact provider type IDs and one period set per
type. The shared saved-category metadata query supplies supported types; category
context edits disable additions while preserving saved schedules. Validation and
creation both refresh support across every proposed category. Readback compares
type identity and period sets without depending on provider ordering. Review puts
the exact ID in the value so display-label styling cannot change its appearance.
Independent relationship confirmation compares child sets by place ID and type,
allowing provider reordering while rejecting missing, changed or duplicate children.

Creation claims one durable record per draft under the draft row lock. It checks
current matches and approval before the provider call, then persists the returned
resource identity before readback or local linking. Execution, confirmation and
linking have separate states. Duplicate submissions read the existing record.
Unknown outcomes without a provider resource remain unresolved; no name-based
identity inference or automatic retransmission is permitted. Draft editing and
rematching are locked after a claim to prevent changing a started request's payload.

Known-resource recovery performs provider GETs and a separate local transaction.
That transaction creates the local listing, exact external link, webhook route,
client grant extensions and initial backfill checkpoint. Conflicting names or
existing mappings roll it back without losing the provider outcome. The operator
can retry local linking with a distinct local name. Setup/recovery UI and broader
activity/notification integration remain incomplete. These additive migrations
must precede application deployment; reverting application code leaves the durable
outcome records available for recovery. Records cascade with draft retention.

The location activity reader projects management, hours, profile, menus, links,
media, posts and review-reply attempts with `UNION ALL` under tenant RLS. It
checks current location access and existence before reading. Each ID includes
the source prefix; `sourceId` retains the original attempt ID for recovery.
No attempt tables are consolidated. Missing historical actors remain null,
and legacy success states are not upgraded to independent confirmation.

Activity supports the existing page/pageSize interface and an optional cursor.
The cursor binds to a location and orders by timestamp plus source-prefixed ID.
It retains PostgreSQL microseconds so ties and same-millisecond attempts are
not skipped. The client follows returned cursors, with page-number fallback
for older responses. Future bulk and schedule stores must join this projection
when those workflows are implemented.

`lib/contracts/operational-events.ts` defines the next operational event
boundary: versioned tenant/target/source identity, enumerated reasons and
distinct execution, confirmation and recovery events. It excludes raw provider
bodies and verification credentials. Recovery retains the original subject
identity; new optional email categories require explicit enablement. These
contracts are not yet incident producers. Extend `notification_incident` and
`notification_delivery`, with recipient preferences/access checks, when wiring
them into execution; do not create another incident store.

Reviewed verification credentials cross a transient boundary in
`lib/server/google-verification-transient.ts`. Completion accepts the selected
listing's exact resource and a bounded PIN; the executor sends it only after
checking its approved commitment. Typed response identity/state/time fields and
static failure copy exclude arbitrary provider echoes. The legacy administration
start/completion handler now rejects requests with `verification_review_required`
before resolving a connection or creating an attempt. Access-page reads retain
null compatibility fields with `verification_workflow_moved` and make no
verification calls or raw verification snapshot writes.

Migration 0069 projects legacy, unreviewed verification payloads onto a bounded
identity/outcome allowlist and redacts old verification snapshots/audit metadata.
It preserves ledger identities, actors, outcomes, timestamps and retention,
leaves reviewed attempts and encrypted review bytes unchanged, and restores the
snapshot timestamp and append-only audit triggers within its transaction. Runtime
permissions and forced RLS remain unchanged. Deployment and live acceptance of
this cleanup remain distinct from isolated migration tests.

`lib/contracts/google-verification-options.ts` and the location-scoped
`verification-options` GET/POST route add typed fresh discovery. Private
service-context addresses require a currently confirmed customer-only business;
they are not cached or persisted. Unknown business type/editability stays null.
Normalised choices retain multiple offered destinations and bind stable identity
to resource, language and context hash. Unsupported/unreadable destination data
does not become a usable method. The pure destination matcher supplies
review/execution validation; it does not authorise a write. The internal start
UI uses reviewed, freshly rechecked choices; full method-specific
browser acceptance remains pending.

Migration `0068_verification_start_reviews` adds encrypted private payloads to the
existing review store and a `verification_start` resource kind. Public review
records bind the exact start input and context/choice hashes; private service
context and postal choice data live together in authenticated ciphertext.
`google-verification-reviews.ts` restores and validates the immutable proposal,
then fresh discovery precedes approval. Location-scoped typed preview/read/approve
routes preserve manager permissions, two-person approval, target identity and a
20-minute expiry. Existing review resources retain a 24-hour expiry and null
private payload. Approval-only UPDATE grants leave reviewed bytes immutable.
These review routes do not execute Google writes; a separate executor is described
below. Migration of the existing start UI and reviewed PIN completion remain
required before this workflow is complete.

`google-verification-state.ts` now provides independent read-only observation
through the typed `verification-state` GET and client adapter. Verification
resource identity/method/state/time fields are projected through a strict boundary;
private provider echoes never enter snapshots or audit data. Complete pagination
is bounded to 20 pages and fails honestly for malformed, foreign or duplicate
resources, repeated tokens or limit exhaustion. Merchant standing/recommended
action is a separate observation and can be unavailable while history is readable.
Missing booleans and unfamiliar enum values remain unknown. Current manager
membership, target, account, connection and credential generation are checked
before and after reading Google. The observer does not settle attempts directly;
the executor below persists its independent results. The internal verification
workspace now uses this typed observation rather than the administration bundle.

`google-verification-execution.ts` now connects approved start reviews to the
existing management attempt store and settlement helpers. The review baseline
includes credential generation and a hash of independently observed verification
history/merchant state. A location advisory lock and review-derived attempt key
guard the single provider request. Current approval/policy/scope/flags and fresh
baseline are rechecked; competing unresolved work and pending/unknown/inappropriate
merchant state block another start. A typed execute/status/refresh route restores
the durable attempt without reissuing it. Independent confirmation requires the
exact returned verification identity/method and a known request phase; lost
identity remains unknown even when the business later gains merchant standing.
Status/recovery do not depend on review expiry or old policy/flags. Saved status
can be read while disconnected; failed refresh retains prior confirmed evidence
with its old observation time and an explicit refresh-unavailable marker.
Public attempt/audit data contains no private service context or provider echoes.
Internal start/completion controls now use reviewed execution and distinct
request/merchant-state feedback. Legacy administration start/completion requests
return `verification_review_required` before provider or ledger work. Migration
0069 redacts legacy credential echoes while retaining known outcomes and
historical identity, scope, actors, timestamps and retention state. Its isolated
fresh/upgrade tests do not establish production migration activation.

`google-verification-completion-reviews.ts` now provides scoped PIN-completion
preview, restore and approval. It independently establishes the exact pending
request and a supported PIN method, freezes that sanitized request and credential
generation, and rechecks them at approval. Migration 0068 extends the existing
review store; its forced RLS, retention/legal holds and immutable runtime payload
grants are retained. Completion reviews expire after twenty minutes.
The PIN stays transient. An encrypted random HMAC key and commitment bind the
normalized PIN and exact verification name; the ordinary payload contains a hash
of the randomized encrypted bytes. Neither the public review nor restored private
binding contains the PIN. Execution must receive the same PIN again and compare
the commitment before any provider write. Private-byte rotation invalidates this
short-lived review and requires a fresh preview; accepted encryption-key rotation
without rewriting its bytes keeps it readable. The existing administration UI
still requires migration to the approved execution path below.

The approved completion executor now shares the start executor's location lock,
durable attempt/status projection and independent observer. It rechecks the exact
approval, transient PIN binding, pending baseline, current managers/policy/target/
connection/generation and publishing flags before claiming a completion attempt.
The unresolved-work guard can be scoped to complete_verification plus its exact
resource, including legacy attempts; unrelated lost start identity does not block
completion of an independently known pending resource. Google receives only the
transient PIN. Repeated execution returns the recorded attempt and never sends
another request, including after rejection or an uncertain response.

Completion confirmation reads the exact reviewed resource and method. COMPLETED
settles success; FAILED settles a confirmed terminal failure; PENDING/unknown or
mismatched identity/method remains unresolved. A lost completion response can be
recovered against the already-known target, while execution stays unknown rather
than pretending an acknowledgement was received. Merchant standing remains a
separate observation. Saved status and read-only recovery survive review expiry,
policy changes, paused writes and disconnect; prior confirmed evidence/time is
retained when a later read fails. The typed response adds an optional operation
and completion-specific error codes. Internal administration UI migration and
historical credential cleanup remain required before full verification closure.

The location-scoped `verification-workflows` GET and typed client provide a
credential-free index over start/completion reviews and their recorded attempts.
Current manager/location access and linked account/connection/resource scope
apply; disconnection does not erase saved outcomes. Operation/stage/expiry
filters are bound into the cursor along with the linked scope. Defaults exclude
expired unexecuted reviews but retain all recorded attempts. Review creation
time and UUID determine order, so creating an attempt does not move its review.
Only safe identifiers, method, approval eligibility/reason and execution/
confirmation summaries are returned. Detail, approval and execution still run
their own authoritative preflight; index eligibility is advisory.

Workflow and unified activity cursors preserve PostgreSQL microseconds by binding
timestamps as text before casting to timestamptz. Direct timestamp parameters
pass through postgres.js Date conversion and lose sub-millisecond precision;
regressions seed exact text timestamps and assert exact ordered identifiers.

The internal verification workspace no longer loads the legacy administration
bundle. A known owner/admin session mounts independently scoped capabilities,
typed Google observation and saved workflow queries. Capability errors or missing
per-resource write availability fail closed; Google observation failure also
blocks new sends, while saved reviews and attempts remain available under their
own server authority. A session refresh failure removes privileged controls even
when cached role data exists. Changing location remounts transient state.

Merchant standing, business authority, exact request phase and public display are
separate observations. The shared verification header suppresses its DB-derived
Verified/Not verified fallback, leaving current claims to the typed dated section.
Completion/history controls consume typed observations directly; the raw adapter
is retained only for existing read compatibility. Preview PIN entry clears before
the action; approved re-entry uses the shared action bar. No PIN is stored in
query or mutation caches, URLs, browser storage, saved workflow rows or activity
through these new reviewed controls. Historical credential cleanup and legacy
endpoint retirement remain separate release gates.

START and PIN controllers share the verification workspace's synchronous
in-flight claim and active approved-workflow key. Only the selected approved
workflow renders its send surface. Switching keys remounts consent and PIN
re-entry controls, clearing transient input while retaining saved reviews in
the controllers. Both families stay disabled during an active action. A finished
unavailable response exposes read-only exact-attempt recovery. An authoritative
absent attempt clears uncertainty before restoring the review; expired or stale
approval never becomes reusable through that recovery. The current local
39-case START and 57-case PIN/combined/drift/recovery matrix and two independent
complete visual reviews are recorded in the programme acceptance register.

## Reviewed administrator and invitation access

Administrator invitation, role update/removal and invitation acceptance/decline
use the `administration_access` review family. The frozen payload binds exact
account/location scope, target, collection, credential generation and baseline.
Approval and send are separate UI actions; current actor, policy, expiry,
credentials, target and Google baseline are rechecked before a durable attempt.
An account-wide advisory claim serializes these operations across its locations.
Legacy direct access writes return `administration_review_required` before
token, provider or attempt work. Primary ownership assignment and last-owner
removal/demotion are blocked pending dedicated ownership handling.

The typed workflow index uses microsecond-preserving keyset pagination. Saved
outcomes distinguish acknowledgement from independently observed postcondition;
pending administrator invitations do not mean accepted access. Invitation
acceptance requires the exact reviewed account and role to be independently
accessible; location-invitation absence alone remains unresolved. Recovery reads
the exact attempt and observes Google without resending. A lost acknowledgement
stays unknown even when the postcondition is confirmed. Failed reads retain the
prior proof and its date. Active or uncertain access requests also block adjacent
lifecycle writes. The local 31 backend and 126 browser cases, immutable source
and capture manifest, and two independent complete image reviews are recorded in
the acceptance register; deployment and live provider acceptance remain separate.

## Reviewed Place Actions (2026-09-30)

Action-link writes go through `app/api/locations/[id]/place-action-reviews/**`
only; the legacy `/place-actions` POST, PATCH and DELETE return 409
`place_action_review_required` before any Google call. A review freezes the
exact request, connection, credential generation, target and the full Google
baseline (supported action types, editable links and read-only
`unsupportedLinks` of types this release does not model). Approval and sending
are separate; one attempt per review is claimed in `place_action_mutation`
(0073, intent immutable by trigger). Acceptance and independent collection
readback are recorded separately; a confirmed outcome is settled and never
downgraded by later Google edits. Writes serialise per Google account with
access and lifecycle changes (`google-account-change-lock.ts`,
`requireNoUnresolvedAccountChange`). Outcomes are reported as operational events
(`publication_failed`, `publication_unresolved`, `publication_confirmed`).

## Operational notifications (WP8, 0074)

Incidents (`notification_incident`) are conditions re-derived by the health
tick or events recorded through `recordOperationalEvent`, one open incident per
`operationalSubjectKey`. Location-scoped incidents carry `location_id` and reach
any member who can see that location; account and organisation incidents stay
owner/admin only. Reading is per person (`notification_recipient_state`) and
never resolves; conditions clear themselves and managers resolve events.
Preferences store only explicit choices; defaults preserve the original
owner/admin immediate emails and make every digest category opt-in. Each send
rechecks membership, location access and preference, and carries a stable
`Idempotency-Key` (`notification-delivery/<id>`). Delivery evidence
(`delivery_state`) is separate from the send queue and moves only forward via
signed Resend webhooks (`record_email_delivery_event`, replay-safe by Svix id).
Owners and admins see scheduler, sync, queued work, unresolved writes and email
evidence at `/settings/operations`; retry requeues only refused sends or unknown
ones still inside the provider's idempotency window.

## Scheduled post publication (WP7, 0075)

A `post_publication_schedule` freezes a post's content, the location, an IANA
timezone, a bounded local rule (`lib/domain/publication-schedule.ts`) and any
explicit event-date offsets; approval binds its payload hash and revision.
Approval materialises future occurrences once (`unique (schedule_id,
schedule_revision, intended_at)`). The job tick claims due schedules with a
lease (`claim_due_publication_schedules`), rechecks approval, policy, requester
and approver grants, connection and kill switches, publishes at most the latest
occurrence inside 24 hours (older ones are missed), never publishes ended event
or offer content, and creates one post row per occurrence so a retry reuses the
same publish idempotency key. An ambiguous publish blocks the schedule; nothing
is resubmitted automatically. Edits create a new revision and cancel pending
occurrences. Spring-forward times run at the first valid local time; repeated
autumn times run once, at the earlier instant; absent month days are skipped.

## Bulk listing changes (WP6, 0076)

A preview freezes up to 100 explicit location ids; a batch naming any listing
the requester cannot see is refused without saying which. Each listing gets a
frozen plan (`lib/server/bulk-listing-targets.ts`): eligibility or skip reason,
the current Google value, the merged value (`lib/domain/bulk-merge.ts`: only the
chosen dates, hours type or attributes change) and its update mask. Approval
binds the preview hash and requires acknowledging skipped listings. Execution
queues children claimed by the job tick (`claim_due_bulk_children`, fair per
organisation). Each child rechecks the approver's grant and the policy, reads
Google, succeeds without writing when the change is already there, writes once
when the baseline is unchanged, and otherwise records a conflict needing a new
preview. Readback confirms; interrupted children become ambiguous and a retry
re-reads before any write, so succeeded children are never replayed. Cancelling
stops only queued children.

## Reporting provenance (WP9)

`loadPresenceReport` returns null (not zero) for a metric Google sent no rows
for, an equal-length previous window, oldest/newest successful fetch times
separate from the data-through date, and coverage counts (eligible, reporting,
unavailable, stale, not yet fetched). Daily metric dates are Google's own; they
are never shifted. Share links carry the same provenance.
