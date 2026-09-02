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
`lib/server/route.ts` (70 of 71 route files; the last,
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

| Flag | Surface (`env.ts` key) | Modules | Error when off |
|---|---|---|---|
| `GBP_PROFILE_WRITES_ENABLED` | `profileWrites` | `hours.ts` | 409 `hours_publishing_disabled` |
| | | `profile.ts` | 409 `profile_publishing_disabled` |
| | | `business-information.ts` | 503 `business_information_paused` |
| | | `industry-management.ts`, `location-administration.ts` | 503 `google_writes_paused` |
| `GBP_POSTS_ENABLED` | `posts` | `posts.ts` | 503 `publishing_paused` |
| `GBP_MEDIA_ENABLED` | `media` | `media.ts` | 503 `media_paused` |
| `GBP_PLACE_ACTIONS_ENABLED` | `placeActions` | `place-actions.ts` | 503 `place_actions_paused` |
| `GBP_FOOD_MENUS_ENABLED` | `foodMenus` | `food-menus.ts` | 503 `food_menus_paused` |
| `GBP_PERFORMANCE_ENABLED` | `performance` (ingestion) | `performance.ts` | 503 `sync_paused` |
| `GBP_KEYWORDS_ENABLED` | `keywords` (ingestion) | `keywords.ts` | 503 `sync_paused` |
| `IMPORT_REVIEW_ENABLED` | — | `import-review.ts` | 503 `import_review_paused` |

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

The ambiguous-versus-failed policy is explicit. A `validateOnly` failure
cannot have written anything and is always `failed`. A
`GoogleMutationAmbiguousError` from `mutate` settles `ambiguous` under
`onAmbiguous: "fail"` (profile, media, place actions, posts) or continues to
the readback under `onAmbiguous: "readback"` (hours, food menus): a readback
that matches proves the write applied, a mismatch settles `failed` with the
module's mismatch code (502 by default), and only a readback that itself
fails leaves the row `ambiguous`. `onExisting: "resume"` (hours, profile, food
menus and the post publish) returns a succeeded row as idempotent and re-arms a
terminal failure. It answers an in-flight row with the module's 409 only inside
a two-minute grace window; past that the row is treated as abandoned by a
request that died, and is recovered by reading Google back and settled
`succeeded` or `ambiguous` before this request proceeds. Without that window an
interrupted write left the row `publishing` for its whole retention and every
later attempt on the same key 409'd forever.

`"replay"` (media, place actions, the post delete, management) treats any
existing row for the key as idempotent. Those keys embed `ctx.requestId`, which
is minted per HTTP request, so the replay branch is unreachable across
requests: a client retry issues a new request id, a new key, and a second
Google write. Closing that needs an intent token minted by the client — one per
Publish/Upload/Add-link press, resent unchanged on retry — carried on the
request and keyed on instead of the request id. Until then these surfaces are
idempotent within a request and at-least-once across one.

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

`lib/server/jobs.ts` drains retryable webhook events, checkpoints, and publish
attempts across the content-free `organisation_job_route`, immediately
re-entering `withTenant` for customer data. `scripts/scheduler.mjs` runs seven
ticks — reconciliation, retention, the provider-deletion sweep,
presence-resource reconciliation, the performance and keyword ingests, and jobs.
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
- The CI database `nabareview_test` in `.github/workflows/ci.yml`.
- Historical plan and evidence documents under `docs/superpowers/`, which keep
  pre-rename spellings except where they specify a not-yet-implemented metric
  name or user-facing string.

Identifiers already migrated alongside the design-system replacement stay in
their new form (do not rename back): module paths `lib/naba-presence-api.ts`
and `components/naba-presence/`, the compose project `nabapresence-local` with
local database `nabapresence`, the Supabase local project id `nabapresence`,
and harness/bootstrap addresses (`harness-…@nabapresence.test`,
`local-owner@nabapresence.local`).
