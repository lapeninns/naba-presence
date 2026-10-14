# Architecture and data controls

## Runtime role and startup assertions

Supabase Auth owns password hashing, password recovery, abuse controls, and
email verification. NabaPresence exchanges only a verified Supabase user
identity for an opaque, HTTP-only application session; it never stores a
password or a Supabase refresh token, and keeps a Supabase access token only
encrypted inside a five-minute two-step verification ticket (below). The server hashes the opaque token
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
It also compares `schema_migration` with the build's required-migrations
manifest (`lib/server/schema-manifest.ts`, checked by
`lib/server/schema-compat.ts`) and fails closed when the database lacks a
migration the code needs. While serving, the cron-bearer platform scope of
`app/api/operations/health/route.ts` repeats that comparison and reports the
deployed commit from `lib/server/release.ts` (`NABA_RELEASE_SHA`, stamped by
`scripts/release/promote.mjs`); the session scope carries neither.
`app/api/operations/readiness/route.ts` (cron bearer, `lib/server/readiness.ts`)
reports the same release and schema fields with tick liveness (the health tick
included), pause state, alert-email configuration, undelivered operator
incidents and metric export status (`lib/server/telemetry-status.ts`), answering
503 when not ready; `scripts/ops/readiness-probe.mjs` is the local probe that
calls it. `startup.ts` also logs operational warnings (no alert email, no
operator recipients, no metric export) without refusing to start.

Release control is local. `scripts/release/verify-local.mjs`
(`pnpm verify:release`) runs the whole check graph on a fresh worktree and a
throwaway PostgreSQL (`scripts/ci/postgres.mjs`): frozen install, typecheck,
lint, unit, build, migration policy against the last promoted commit, fresh,
upgrade and concurrent migrations, integration, e2e, the production audit and
gitleaks when installed. It writes a receipt (`scripts/release/local-receipt.mjs`)
in the gitignored `local/` folder beside the promotion receipts.
`scripts/release/promote.mjs` (`pnpm release:promote`) deploys only a clean
`origin/main` whose passing receipt it pins by sha256, after
`pnpm db:status --expect-current`, and stamps `NABA_RELEASE_SHA`; its own
receipt (`docs/release/receipts/README.md`) is what rollback and the next
gate's base read. Hosted GitHub workflows are not part of this path.
Verified application users are provisioned by the SECURITY DEFINER
`provision_authenticated_user` database function through
`lib/server/provisioning.ts`, without giving the runtime role unrestricted
organisation or user-table privileges. The stable provider subject resolves
the same user and default organisation on every device. Google OAuth is a
separate owner/admin action whose encrypted connection belongs to that
organisation, so application sign-out or a new device session does not remove
the Google connection.

### Two-step verification (P02-S8, migration 0105)

Behind `MFA_ENABLED` (default off), a person with a verified Supabase TOTP
factor does not get a session from a password, a reset or an emailed link
alone. `lib/server/email-auth.ts` opens a five-minute pending ticket instead
(`mfa_pending_login`, reached only through SECURITY DEFINER functions; the
provider's access token for the challenge is kept encrypted for those five
minutes and never longer), sets it in the httpOnly `naba_mfa_ticket` cookie
scoped to `/api/auth/mfa`, and answers `mfaRequired`. `POST
/api/auth/mfa/verify` (abuse scope `mfa_verify`, five attempts per ticket,
and `mfa_verify_account`/`mfa_verify_account_daily` per provider identity
across tickets)
challenges and verifies the code at the provider, requires the provider's
token to say `aal2`, spends the ticket exactly once and only then provisions,
accepts an invitation and mints the session. `GET /api/auth/mfa/factors`
lists the primary and backup factors a ticket may use. `POST
/api/auth/mfa/enroll` re-checks the password (the app keeps no provider token
for a session) and, for a backup, a current code; verifying the new factor
replaces the enrolling session with an aal2 one. Sessions record `aal`,
`mfa_factor_id`, `mfa_verified_at`, `mfa_proof_expires_at` (verified plus 15
minutes), `auth_method` and the person's `security_version`
(`lib/server/session-store.ts`); a workspace switch and accepting an
invitation while signed in carry the assurance across, and `lookupSession`
deletes a session whose `security_version` is behind the person's (which only
ever increases). Sessions from before 0105 are aal1. A password reset by an
enrolled person sets nothing until the code: the new password waits in the
ticket (encrypted) and the verify route sets it with the aal2 token, then
ends the person's other sessions and audits `user.password_reset`. Issuing a
sign-in ticket ends whatever session the browser already held. `lib/server/mfa.ts` owns the ticket, cookie and assurance
helpers; `/sign-in/verify` and `/settings/security` are the screens.

### Step-up and authorised dispatch (P02-S9, migration 0106)

With `MFA_ENABLED` on, owners and admins need an aal2 proof from the last 15
minutes before a sensitive action: a route handler declares
`route({ mfa: "step_up" })` (`lib/server/route.ts`), which runs
`requireRecentMfa` (`lib/server/mfa.ts`) after the role gate and answers 403
`mfa_step_up_required`, or `mfa_enrollment_required` for a manager with no
authenticator app. The handlers that declare it (team, Google connection and
onboarding writes, every publish, approve and execute path, settings,
legal holds and privacy requests) are pinned by
`tests/mfa-step-up-contract.test.ts`; bulk review approval, editing a
published post and resuming a paused schedule call `requireRecentMfa` for
that branch only. Reads,
enrollment, exports and workspace switching stay at aal1, and members and
viewers are not held to it. `POST /api/auth/mfa/step-up` takes the password
and a current code (primary or backup factor; abuse scopes `mfa_verify` and
the per-account budgets) and replaces the session with an aal2 one.
`components/auth/mfa-step-up-prompt.tsx`, mounted in the app shell, opens on
the window event `lib/api/client.ts` raises for those 403s; the action is not
replayed, the person sends it again.

Approvals record the assurance they were made with
(`authorisationAssurance`): `approval_decision`, `post_approval_decision`
and `mutation_approval_decision` gain `authorised_aal`,
`authorised_mfa_verified_at` and `authorised_security_version`, and
`gbp_change_set`, `post_publication_schedule` and `bulk_listing_operation`
the matching `approved_*` columns (a schedule revision clears them). `publish_attempt` records
who authorised the reply mutation (`authorised_by`, assurance, security
version, `authorised_connection_id` and the approval policy it passed), and
`retryPublishAttempt` (`lib/server/publishing/retry.ts`) re-decides it through
`recheckAuthorisation` before every replay: a removed member, a lost publish
grant, a changed connection, a bumped security version or (for a publish) a
changed approval policy settles the attempt `failed` (`authorisation_revoked`,
reason in the event) with no provider call, and a row with nobody or no policy
recorded fails closed (`authorisation_unverifiable`); 0106 backfills the
attempts in flight when it runs. `gbp_local_post_attempt` records the
assurance beside `actor_user_id` (a scheduled publish records its approval's).
A security version bump also voids stored reply and post approvals, a
reviewed change set at execute, and approved schedules and bulk listing
operations in their runners, wherever a version was recorded. `beginOperation` records the requesting
session's security version on `mutation_operation` (the actor's current one
for a worker re-running a recorded intent). It is recorded for audit and
nothing compares it yet; `mutation_recover` will once it rechecks (P03-S6). Operator recovery is
`scripts/mfa-recover.mjs` (`pnpm ops:mfa-recover`), outside the app runtime:
`recover_user_mfa` (owner connection only) bumps `security_version`, deletes
sessions and tickets, zeroes `mfa_factor_count` and audits
`user.mfa_recovered` per organisation; the script then deletes the factors at
the provider with the service-role key (runbook, "MFA recovery").

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
(handlers pass it to `writeAudit` and `log`; they never regenerate it); the
same-origin guard (`assertSameOrigin`), which refuses a mutation (any method
but GET, HEAD and OPTIONS) on an `origin: "same"` route with 403
`cross_origin_request` unless its `Origin` is the request's own origin,
`NEXTAUTH_URL`'s or one listed in `APP_ALLOWED_ORIGINS` (self-hosted Next
builds `request.url` from the bound hostname and port, not the Host header, so
the E2E harness passes through `NEXTAUTH_URL` and other browser origins need
`APP_ALLOWED_ORIGINS`; Vercel preview origins are unverified), falling back to
`Sec-Fetch-Site` (`same-origin` or `none`) when `Origin` is absent and letting
a request with neither header through, since a non-browser caller cannot ride
a victim's cookies; `origin` defaults to `"same"` for session routes and
`"any"` otherwise, the password forms, sign-out and the session-or-cron sync
POSTs opt in (a valid cron bearer still passes, which keeps
`scripts/scheduler.mjs` working), and the Pub/Sub, RISC and support
impersonation routes declare `"any"`; authentication, where `auth: "session"` (the default) runs `requireSession`,
`auth: "cron"` requires `Authorization: Bearer <CRON_SECRET>` compared in
constant time and otherwise answers 401 `invalid_cron_token`, and
`auth: "public"` hands the handler `session: null`; organisation-level role
gating, declared as `roles: ["owner", "admin"]` on the route rather than
inside the handler and answered with 403 `permission_denied`; parsing of
`params`, `query` and `body` through zod, where a non-empty body not sent as
`application/json` (or a `+json` type) is a 415 `unsupported_media_type`, a
missing or unparsable body becomes `{}` before validation and any zod failure is a 400 `invalid_request`
with `fieldErrors`; abuse limits, where a route's `limits` hook names a
scope in `lib/server/abuse-limits.ts` and the keys to count (the wrapper adds
the client IP) and any key over its fixed window answers 429 with
`details.retryAfter` and a `Retry-After` header; the tenant transaction, exposed to session routes as
`ctx.tenant(fn)`, which is `withTenant(session.organisationId, fn)`; and error
mapping, where everything thrown passes through `apiError(error, requestId)`.
The error body is `{ error: <code>, message, requestId }` plus `fieldErrors`,
`retryable`, `reconnectRequired` and `details` when set.

Abuse limits (migration 0085, ledger SEC-07/SEC-08) are fixed windows in the
platform-level `abuse_rate_bucket` table, reached only through the SECURITY
DEFINER `take_abuse_budget` and `purge_abuse_rate_buckets` functions, so every
instance shares one count. Keys are HMAC digests under `NEXTAUTH_SECRET`,
never plaintext. They cover password login, registration, confirmation resend,
reset request and completion, the emailed confirmation link (`/auth/confirm`,
per IP; a refusal redirects to sign-in), invitation lookup and acceptance, AI draft
generation, support impersonation attempts (counted before the secret is
compared) and `/share/report/[token]` lookups (which answer the same 404 as
an unknown token when limited). The client IP comes only from the header named
by `CLIENT_IP_HEADER`, defaulting to `x-vercel-forwarded-for` on Vercel and to
none elsewhere; `x-forwarded-for` is never trusted by default. The retention
cron purges ended windows once per sweep, even with `RETENTION_DELETES_ENABLED`
off, since they hold no tenant data. `ABUSE_LIMITS_ENABLED` switches the
counting off.

The wrapper's altitude is the organisation. Location-level access is
deliberately not its concern: handlers call `requireLocationAccess`,
`canPublishLocation` or `grantsFor` inside `ctx.tenant(...)` once they know
which location a request touches, and kill switches and capability checks
stay in the domain module. Cron and public handlers import `withTenant` or
`getDatabase` directly; the only `getDatabase()` calls left in route files are
the commented cross-tenant enumeration and routing reads. `runtime` and
`maxDuration` remain per-file static exports because Next reads them at build
time; a route also hands its `maxDuration` to `route()`, which turns it into
`ctx.deadline` (epoch ms, `lib/server/deadline.ts`: start + `maxDuration` −
5 s). Services that make provider calls in a row take that plain `deadline`,
size each call to what is left and stop before a step that cannot finish.
`tests/route-max-duration.test.ts` requires both on every route whose imports
reach the Google transport or the OpenAI client. A route whose Google calls
can outrun 60 s and do not yet stop at the deadline (unbounded paging, a write
and its read-back) declares 300, the Fluid compute default it ran under before
the export was required; database-only routes declare 60. `getSession()` is
wrapped in `React.cache`, so a server render that asks for the session from a
layout, a page and a prefetch helper performs one lookup and one
`last_seen_at` write; in route handlers the cache is a no-op.

## Location visibility: one rule

"Which locations may this member see, edit or publish to" is decided in
`lib/server/permissions.ts` and nowhere else. Owners and admins see, edit and
publish everywhere. A viewer or member sees what their membership's
`location_scope` names: `all` is every location in the organisation,
`assigned` is exactly their `location_member` rows, and no rows on `assigned`
is no access. Absence never means "all": there is no fallback to the old
"no rows sees everything" rule. `canEdit` is visible-and-not-viewer;
`canPublish` is true for owner/admin, false for viewer, and for a member the
organisation-level `member.can_publish` (as `session.canPublish`) on `all`,
or the assigned row's `can_publish` on `assigned`.
Routes compose the rule instead of restating it: `visibilityPredicate(sql,
session, column)` is a SQL fragment (`true` for owner/admin) appended to any
SELECT; `requireLocationAccess` raises a 404 for a hidden or nonexistent
location, with the caller's own code where the subject is not a review;
`canPublishLocation` answers for one location; `grantsFor` answers for many in
one query and feeds the capability payloads. There is no inline
`exists (select 1 from location_member ...)` in route files, capabilities or
query builders. Every helper expects the tenant transaction, so RLS already
scopes `location_member` to the organisation before the rule runs.

Membership scope is explicit (migrations 0082, 0083). `member` and
`invitation` carry `location_scope`: `all` (every location; owners and admins
always) or `assigned` (exactly the `location_member` rows, none when there are
none). Every writer sets it in the same transaction as the rows: the
client-access PUT (choosing no clients saves `assigned` with no rows, which is
no access), the role PATCH (promotion to owner/admin keeps the rows, latent,
under `all`; demotion makes held rows `assigned`), and invitation acceptance,
which copies the invitation's scope and refuses with 409
`invitation_scope_empty` when an assigned invitation's clients or listings are
all gone. Creating an invitation for clients that hold no listings is refused
with the same code. A business workspace can scope an invitation to listings
(`locationIds`, stored in `invitation.location_ids`). `extendClientHolders`
extends only `assigned` holders. `publishPredicate` is the per-row SQL form of
`canPublish` for the review queues.

0082 is expand-only: it runs before the release that writes the scope is
deployed, so it refuses nothing the deployed code writes. An invitation
trigger names the scope `assigned` whenever `client_ids` or `location_ids` is
set. Because readers now trust the scope, 0083 keeps the one dangerous drift
(a member or viewer holding rows but named `all`) from arising out of writers
that predate it: inserting a `location_member` row for such a member, or
demoting an owner/admin who holds rows, names them `assigned`. It also
redefines `reconcile_member_location_scope()` to only ever narrow (the 0082
version moved row-less members to `all`, a widening once zero rows means no
access), runs it once, and leaves it safe to rerun. The opposite drift, an
older "every client" save that removed the rows but left `assigned`, is a
narrowing and is fixed by saving the member's access again.

Visibility never authorises a write. Every mutation names its action
(`read`, `edit`, `request_approval`, `triage`, `assign`, `decide_approval`,
`publish`) and calls `requireLocationAction`, which answers 404 for a hidden
location and 403 `permission_denied` when the role or grant may not act; the
rule is the pure `actionAllowed`, which `lib/server/capabilities.ts` also uses
so the UI offers only what the server accepts (the location payload's
`canEdit`, `canRequestApproval` and `canDecideApproval` gate the posts
composer, Request approval, and Approve/Reject). A viewer is read-only
everywhere: post drafts, post and reply approval requests, post rejection and
bulk assign/triage all refuse it. Work that runs without a session (retries,
schedules, recovery, bulk batches) re-derives the actor's grant at dispatch
through `lib/server/authz/actor.ts`: `actorScopeFromMembership` turns the
member row into a grant scope, and `recheckAuthorisation` re-decides the
action, refuses a relinked Google connection, a changed approval policy or
a security version the person has moved past (P02-S9), and fails closed on a
supplied generation id or entitlement until those mechanisms exist
(P03-S2/P07-S2, P07-S1 wire them in). A bulk assignee must pass the same
recheck for the review's location (`assignee_not_eligible` otherwise).
Bulk approve (`app/api/reviews/bulk/route.ts`) names, per row, the draft and
review update time the operator was shown; `recordApprovalDecision` refuses
a moved draft (`approval_draft_changed`) or review (`review_changed`) before
anything is recorded. Row outcomes are truthful about the two commits an
approval spans (`lib/server/review-bulk-outcome.ts`): `skipped`/`failed`
before the decision commits, `approved_not_published` or `uncertain` after it,
and an unexpected fault on one row is that row's outcome, not the batch's.
With `bulk_actions` on, approvals are recorded the same way and the publishes
run as a bulk batch instead (see "Bulk listing changes", P09-R8).

Two-person approval holds on every publication path. For replies,
`has_qualifying_approval` (`lib/server/publishing/intent.ts`) counts only an
approval of the same draft by someone who is neither the requester nor the
draft's author, and `recordApprovalDecision` refuses the author up front. For
posts, `gbp_local_post.content_revision` (0081) is bumped by a trigger
whenever content sent to Google changes, and an edit withdraws an outstanding
request. `requestOrPublishLocalPost` (`lib/server/posts.ts`) applies
`requiresPostApproval` to POST `/publish` and to a PATCH of a live post alike:
in two-person mode a publisher's publish parks unless
`post_approval_decision` holds an approval of the current revision and payload
hash by someone other than the author that no later rejection of that revision
overturned (the approver may retry a publish they approved). Rejecting a parked
edit of a live post returns the row to `draft` with the rejected text while
Google keeps serving the last approved version; restoring the published
content on reject is an open LST-01 follow-up. An approval names
the `expectedRevision` the approver read (409 `approval_post_changed`
otherwise), needs the post to be `awaiting_approval`, and the publish claim
refuses a row whose revision moved after the decision. The attempt row records
the decision it went out under (`approval_decision_id`). A scheduled
occurrence (`publishScheduledLocalPost`) goes out under its schedule's
approval (`post_publication_schedule.approved_by`), so its attempt names the
approver and no decision row. Creating or revising a publication schedule
needs `request_approval` at the location, and a bulk listing preview needs it
at every target (`requireLocationActionForAll`, one 404 for any hidden
target); approving, executing, pausing or cancelling either stays with owners
and admins.

Direct listing writes take part when an organisation has both
`require_two_person_approval` and the `listing_change_approvals` feature
(`organisation_feature`) on; with either off they behave as before. The
listing write routes (hours, profile publish, food menus and media
create/patch/delete) call `submitListingChange`
(`lib/server/listing-change-registry.ts`) instead of the surface function.
Business information, attributes, lodging and Place Action links do not:
every one of their writes already needs a reviewed change set whose
approval applies the two-person policy itself (see "Management execution
and confirmation evidence" and "Reviewed Place Actions" below).
`updateBusinessInformation` refuses any update without an approved change
set (409 `approval_required`) before Google is read, and accepting Google's
suggested update (`lib/server/location-administration.ts`), which has no
review step, is refused with 409 `business_info_review_required` while
two-person approval is on. Change sets, bulk batches, scheduled posts and
both runners share one approval-policy helper
(`lib/server/authz/approval-policy.ts`):
the organisation's current policy and manager read by organisation and
user, the second-approver rule, and `recheckApprovedWork`, which a worker
calls before dispatch. For a
publisher, `parkListingChange` (`lib/server/listing-changes.ts`) sends
nothing: it records a change request
as a `mutation_operation` receipt in the outcome state `awaiting_approval`
(`supabase/migrations/0094_listing_change_approval.sql`) holding the frozen,
validated body (`change_request`), its payload hash, the fields it writes
(`field_mask`), the baseline it was edited against (`expected_revision`) and
its author, and answers 202. A same-intent retry gets the same request
while it is pending and the reason it ended once it is not; a newer request
for the same change (same kind, operation and target) supersedes the older
one -- a create only an identical pending create -- and a local save
of the content a publish request would send (hours, profile, menus)
invalidates it. `POST /api/locations/[id]/change-requests/[changeId]`
approves or rejects: the decider needs `decide_approval` and the authoring
route's organisation roles (`LISTING_CHANGE_DECIDER_ROLES`), must not be the
author, and must name the request's payload hash. Each request carries
`details`, every content value its frozen body sends and what its target
photo holds now (`lib/domain/listing-change-details.ts`), which the
panel shows beside Approve. The decision is a
`mutation_approval_decision` row whose CHECK forbids the requester deciding.
An approval dispatches the frozen body through the same registry entry, as
the approver, so `runGbpWrite` and the surface's own freshness checks run as
for any write and a stale baseline is refused with the surface's 409. The
change request is a follower of the dispatch intent: `linkOperationAttempt`
links it to the dispatch's attempt row in the transaction that claims it,
before anything is sent, so the attempt's settle, the reapers or the
`mutation_recover` job settle it even if the approval request dies. One that
died before claiming an attempt sent nothing and is settled `failed`
(`approval_dispatch_interrupted`) by `settleInterruptedListingChanges` on its
receipt read or the retention run. A media
upload cannot be frozen (no asset store yet), so it is refused with 409
`listing_change_upload_unsupported` while approval applies. The editors show
pending requests above themselves (`components/locations/listing-change-requests.tsx`,
only where the location capability `listingChangeApprovals` is true), and the
API client raises a parked answer as `listing_change_awaiting_approval`, never
as a failure or a send. Each decision records the approver's assurance
(P02-S9, above).

`tests/route-authorization-contract.test.ts` scans `app/api/**/route.ts` so
every session mutation declares non-viewer `roles`, calls an action guard in
its own handler, delegates through a named call chain that ends in one, only
throws (handlers whose write moved behind a reviewed change set, such as the
direct place-action routes), or is on its explicit allowlist.

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
Sign-out is truthful: `DELETE /api/session` answers 204 only when it did what
was asked. If revoking every session fails, this browser is still signed out
(its row when the database allows, its cookie always) and the answer is 503
`sign_out_everywhere_failed`; the account menu then says other devices may
still be signed in. Any other failure keeps the person signed in on the page
with a Retry. A confirmed sign-out clears the query cache and every
`naba:draft:` stash before the full-page navigation.

Client state is bound to the session's scope. Stashed editor drafts are keyed
by user, organisation, resource, resource id and draft schema version
(`lib/editors/draft-key.ts`), so a stash is only offered to whoever wrote it
and a schema bump ignores old ones. The session projection carries an opaque
`scopeFingerprint` (the person's `security_version` (0105), role, publish
right, `location_scope` and location grants, hashed in
`lib/server/session.ts`); `lib/queries/scope-reset.ts`
drops every cached query but the session when the user, organisation, role,
publish right or fingerprint changes, purges stashes of any other identity,
and drops one location's or client's cache when a read of it is refused for
access (403, or the 404 a hidden location or client answers); a 403 to a write
refetches that cache in place instead, and every such answer refetches the
session so a real scope change resets the rest at once. Unsaved edits held in
memory when the signed-in identity changes are never stashed under the new
identity (`lib/hooks/use-dirty-guard.ts`), and `useEditorDraft` reseeds them.

Every editor that holds unsaved edits keeps them through a refetch and asks
before they are lost. `useEditorDraft` (`lib/editors/use-editor-draft.ts`)
seeds the draft from the server value and, when a newer revision arrives
while the draft is dirty, keeps the edits and offers "Load theirs" / "Keep
mine" (the profile, hours, menu, services, lodging, post composer and new
action link editors). `useLeaveGuard` (`lib/editors/use-leave-guard.ts`)
holds an in-app link click, the browser's back button (a sentinel history
entry above a dirty page, paired by id with the entry beneath it so only a
step from that sentinel onto its own base asks, and kept through Next's
same-address `replaceState` on `router.refresh()`) and programmatic
navigation through
`useGuardedRouter` / `guardNavigation` (the command palette and client
switcher). `useCloseGuard` (`lib/editors/use-close-guard.ts`) asks before a
sheet or dialog with unsaved edits closes (the post composer and the action
link edit dialog). `components/editors/draft-notices.tsx` renders the stash,
incoming-version and leave prompts for an editor.

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

A publish may carry a `selection` (`lib/contracts/location-hours.ts`) instead
of replacing the whole schedule: weekdays (all seven is a whole-week
replacement and needs all seven in the saved schedule), special-hours start
dates (upserted when the saved schedule has the date, removed when it does
not) and more-hours service types. `buildGoogleHoursPatch` in
`lib/domain/hours.ts` merges only those parts of the saved schedule over the
live Google hours, so every other day, date and service in a written field is
sent back exactly as Google holds it, and fields with nothing selected are
left out of the mask. The selection pins each selected part's Google hash
(`googlePartHashes` on the GET) rather than the whole Google hash, so a Google
edit to an unselected part does not make the review stale. The approved mask
must lie within the selection's fields and cover every field the changed
selected parts write; when every selected part already matches Google nothing
is sent and the response is `selection_in_sync` (`in_sync` only when the whole
schedule matches). Readback verifies the selected parts and that no
unselected part changed; the attempt records the parts in
`hours_sync_attempt.selection` (migration 0087).

Drift is also classified per part (`classifyHoursPartDrift`) against a
per-part comparison baseline in
`presence_resource_reconcile_state.comparison_part_hashes`
(`lib/server/hours-observations.ts`). A selective publish moves the baseline
of only the parts it wrote, so the differences it leaves on purpose stay
`core_dirty` rather than reading as Google changes or conflicts, and the
overwrite confirmation is asked for only when a part being written changed on
Google. The listing summary uses the same per-part classification from the
stored `observed_google_part_hashes`. With no part baseline yet (rows from
before 0087), the whole-schedule hashes decide as before. The first selective
publish from there starts a complete part baseline and seeds each differing
part it did not write with the whole-schedule verdict from before the publish
(`HOURS_PART_UNKNOWN` marks the side that changed), so an unpublished Google
edit keeps needing overwrite confirmation instead of reading as local.

Selective hours publication ships ungated: the release plan scopes it as a
fix to hours publication (whole-schedule publishes overwrote unselected
Google edits), so the feature-flag rule for new customer-visible work does
not apply. The server still accepts requests without a `selection`.

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

| Flag                         | Surface (`env.ts` key)    | Modules                                                | Error when off                                                                                                                                     |
| ---------------------------- | ------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GBP_PROFILE_WRITES_ENABLED` | `profileWrites`           | `hours.ts`                                             | 409 `hours_publishing_disabled`                                                                                                                    |
|                              |                           | `profile.ts`                                           | 409 `profile_publishing_disabled`                                                                                                                  |
|                              |                           | `business-information.ts`                              | 503 `business_information_paused`                                                                                                                  |
|                              |                           | `industry-management.ts`, `location-administration.ts` | 503 `google_writes_paused`                                                                                                                         |
| `GBP_POSTS_ENABLED`          | `posts`                   | `posts.ts`                                             | topic, language, summary, call to action, event title and schedule, offer ("identify" compares the last three only where Google's list shows them) | `matchLivePost` (ambiguous creates, stranded posts) and post update verification |
| `GBP_MEDIA_ENABLED`          | `media`                   | `media.ts`                                             | 503 `media_paused`                                                                                                                                 |
| `GBP_PLACE_ACTIONS_ENABLED`  | `placeActions`            | `place-actions.ts`                                     | 503 `place_actions_paused`                                                                                                                         |
| `GBP_FOOD_MENUS_ENABLED`     | `foodMenus`               | `food-menus.ts`                                        | 503 `food_menus_paused`                                                                                                                            |
| `GBP_PERFORMANCE_ENABLED`    | `performance` (ingestion) | `performance.ts`                                       | 503 `sync_paused`                                                                                                                                  |
| `GBP_KEYWORDS_ENABLED`       | `keywords` (ingestion)    | `keywords.ts`                                          | 503 `sync_paused`                                                                                                                                  |
| `IMPORT_REVIEW_ENABLED`      | —                         | `import-review.ts`                                     | 503 `import_review_paused`                                                                                                                         |

Review reply publishing answers to `PUBLISH_ENABLED` alone (`publishing_paused`)
and drafting to `DRAFTS_ENABLED` (`drafts_paused`). `lib/server/capabilities.ts`
mirrors the same functions into the per-location capability payload so the
interface can show a paused-write notice without hiding the surface: disabled
features render current stored/live state and a reason code, so an operator
can distinguish "no data" from "writes intentionally disabled".

### Operator pause controls

The env flags above are read once per process, so on their own they take a
redeploy. `ops_pause_control` (migration 0090) is the hot layer on top:
one row per scope (the env switches' own names, plus `scheduled_post`,
`bulk`, `mutation_recover`, `invitation_email` (invitation email delivery),
and `billing`, which holds Stripe event processing on the job tick and the
hourly `/api/billing/reconcile` tick while the Stripe webhook receiver keeps
recording receipts), read through `lib/server/pause-controls.ts` with a
5-second cache. A scope runs only when its env flag is on **and** its row is
not paused: the env flag stays the hard override, and a row can add a pause
but never lift one. The checks sit where work starts:

- the runner's claim: `claimableKinds(env, pauses)` in `lib/server/jobs.ts`
  filters `claim_due_jobs` by both layers;
- provider dispatch: `runGbpWrite` takes the write's `surface` and calls
  `requireGbpDispatch` (`publish` plus the surface) before anything is
  written, answering the module's own paused error; the reply pipeline
  checks `publish` in `executePublish`, `executeReplyDelete` and, for an item
  the runner claimed just before a pause, `retryPublishAttempt` (which then
  skips and leaves the row `retryable`);
- approval decisions: `lib/server/posts.ts` (`requireGbpDispatch("posts")`
  in the approve path) and `app/api/reviews/[id]/approval/route.ts` and
  `app/api/reviews/bulk/route.ts` (`publish`) refuse before a decision row
  or its audit is written;
- ingestion boundaries: `syncDuePerformance` and `syncDueKeywords`
  (`performance`, `keywords`), for the runner and the session POSTs alike;
- whole-tick routes: `app/api/cron/retention/route.ts`,
  `app/api/cron/health/route.ts` (`notifications`), and the review sync ticks
  `app/api/sync/reconcile/route.ts` and `app/api/sync/sweep/route.ts`
  (`sync`), plus the drafts route (`drafts`) and the owner-triggered
  `app/api/sync/backfill/route.ts` and
  `app/api/webhooks/google/pubsub/replay/route.ts` (`sync`).

A paused answer carries `details.pausedScopes`, so it is distinguishable
from a failure. An unreadable pause table fails closed for anything that
claims, sends or deletes, and open for reporting: `lib/server/ops-liveness.ts`
marks a tick its scope holds as `paused` (with `pausedScopes`) and raises no
staleness alert for it. The runtime role can read the tables and nothing
else; operators write them through `scripts/ops-pause.mjs` (`pnpm ops:pause`).

`organisation_feature` (same migration) is the per-organisation product
flag, off without a row, read inside the tenant transaction by
`lib/server/org-features.ts` `isOrgFeatureEnabled`. A paused scope stops the
work even where the feature is on.

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
existing row for the key as idempotent. Media, place actions and the post
delete key on the request's intent id when it carries one
(`requestScopedKeyPart` in `lib/server/mutation-operations.ts`), so a retry of
the same intent derives the same key and replays; without an intent the key
embeds `ctx.requestId`, which is minted per HTTP request, and a retry is a
second Google write as before. Management (`gbp-management.ts`) still keys on
the request id: it replays any row for a key that does not include the
content, so keying it on the intent without the ledger's conflict check could
answer a changed request with an earlier result.

## Operation receipts: one per user intent

The client mints an intent id per user action and sends it as the
`Idempotency-Key` header (`INTENT_HEADER` in
`lib/contracts/mutation-operations.ts`); `apiFetch` in `lib/api/client.ts`
sends a fresh one on every mutation unless the caller passes the id of the
action it is retrying. The listing mutation wrappers in `lib/api` (hours,
profile, food menus, business information, industry, media, booking links,
post publish) take `{ intentId }`. `useResourceMutation` hands each `mutate`
call one and `usePublishFlow` hands each step `intent.idFor(body)`; both
resend the previous id when the person retries an action whose last attempt
may have applied (`isUnconfirmedFailure` in `lib/errors/action-errors.ts`:
an ambiguous answer, a dropped connection, another request still in flight)
with the same input, and mint a new one after a success, a definite failure
or an edit (`intentKey` names the input for a call that reads it from render
state, such as a post publish keyed on its revision). `route()`
parses the header into `ctx.intentId` on session routes (400
`invalid_intent_id` when it is not a UUID; cron and public routes ignore it)
and makes it the handler's ambient intent. `x-request-id` stays per-request
correlation.

`runGbpWrite` records the intent in `mutation_operation`
(`supabase/migrations/0086_mutation_operation.sql`) in the same transaction
that claims the attempt, so the receipt exists before anything is sent: actor,
surface, action, location and target, payload hash, expected revision, the
Google connection and its `credential_generation`, and the attempt row it
rides on. Only a surface that passes an `operation` descriptor and whose store
names its table takes part (hours, profile, food menus, media, post publish
and delete), and only the first such write of a request takes the ambient
intent. Business information, attributes, lodging and Place Action links
record no receipt: each write executes one approved change set, which is
its own idempotency key (`change_set_id`), with execution and confirmation
states on its attempt row. Then:

- same intent, same payload hash, settled — the stored receipt answers: a
  success returns `idempotent` with the original attempt, a failure re-raises
  the recorded status and code; nothing is sent to Google;
- same intent, different payload hash — 409 `intent_conflict`;
- same intent still `sent` on another attempt row, or on its own row while
  that row is in flight on a replay surface (media, place actions, post
  delete) — 409 `intent_in_progress`;
- same intent still `sent` on a row something else has settled — the row's
  outcome settles the receipt and answers as above;
- no intent — no receipt; the write behaves exactly as before.

Settling an attempt settles every receipt still `sent` on it, so a receipt an
interrupted request left behind is settled by whichever request recovers the
row; a new intent that finds another request's row in flight joins that row
and settles with it. The paths that settle attempt rows without
`runGbpWrite` -- the retention cron's stranded-attempt reapers
(`lib/server/retention/purge.ts`) and `reapStrandedLocalPosts` /
`settleStrandedLocalPosts` in `lib/server/posts.ts` -- settle the linked
receipts too (`settleOperationsForAttempts`). States are the shared outcome
vocabulary: `confirmed_applied` only after
a verifying readback, `awaiting_confirmation` for a write Google accepted
without one, `rejected` for Google's own 4xx refusal, `uncertain` for an
ambiguous write, otherwise `failed`. `GET /api/mutations/{id}`
(`app/api/mutations/[operationId]/route.ts`) returns the receipt by operation
id or by intent id, so a client that lost the answer can ask what happened;
a receipt follows its location's visibility. `security_version` (0105) is
recorded with each write (`lib/server/mutation-operations.ts`), and scheduled
and bulk writes record their `approval_ref`; only the comparison of the
recorded version in `mutation_recover` is still open.
`recheckAuthorisation` (`lib/server/authz/actor.ts`) takes the recorded
`google_connection_id` and `connection_generation` together: a relink to
another connection is `connection_changed`, the same connection holding
another credential is `generation_changed`, and a generation without its
connection id is refused, since the counter is per connection.

Every listing mutation route answers with `operation: { operationId,
outcome }` beside its own fields (`operationSummarySchema` in
`lib/contracts/mutation-operations.ts`): `outcome` is the receipt's state, or
the same judgement when the request carried no intent (`operationId` null),
taken from `runGbpWrite`'s result. A readback may narrow a success with
`GbpReadback.outcome`: a local post Google holds but is still reviewing is
`awaiting_confirmation`, one it refused is `rejected`
(`lib/domain/post-outcome.ts`, shared with the posts tab). A receipt this
request did not settle itself -- an unchanged re-publish answered from its
succeeded attempt, or a new intent joining a row a readback just recovered --
takes the same judgement: the recovered readback's outcome, or
`GbpReadback.settledOutcome` read from the module's stored state (the post's
`google_state`), and `awaiting_confirmation` when neither is known, never a
bare `confirmed_applied`. A same-intent replay of a `rejected` receipt whose
attempt `succeeded` answers as the idempotent success it was, not as "not
applied". On the client, `apiFetch` wraps a write's `fetch()` rejection as
`ApiClientError(0, "network_error")` carrying its intent, and `errorOutcome`
(`lib/errors/action-errors.ts`) calls a proxy's bare 5xx, an unhandled 500
`internal_error` and a 2xx `malformed_response` `uncertain`, so a retry
resends the intent; `useResourceMutation` keeps one carried intent per
action fingerprint. The client words
every state with `lib/editors/outcome.ts`: toasts, publish steps
(`stepOutcome` in `lib/editors/use-publish-flow.ts` prefers the answer's
outcome to the step's `verified` flag), the posts tab and inbox status pills,
and `OperationReceiptNotice` (`components/locations/operation-outcome.tsx`),
which follows the receipt of a write that failed uncertainly through
`useMutationReceipt` (`lib/queries/use-mutation-receipt.ts`), polling while it
is `sent` or `uncertain` and stopping once it settles.

A module's own pre-dispatch checks still run before `runGbpWrite`, so a replay
after success can be answered by them first (hours and menus answer `in_sync`;
a stale snapshot answers its 409), never by a second dispatch.

## Ambiguous, failed, and interrupted writes

`ambiguous` means the provider state is not known to match the intent and
might; `failed` means it is known not to. `classifyFailure` in
`lib/server/gbp-write.ts` is the single implementation of that judgement.
Business information, attributes and lodging execute an approved change set
through `lib/server/gbp-confirmation.ts` instead (see "Management execution
and confirmation evidence"). An "ambiguous" error below is a
`GoogleMutationAmbiguousError`, the one thing `isAmbiguousProviderError`
recognises:

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
migrated modules kept their previous behaviour; `"readback"` is used wherever a
readback exists (hours, profile, food menus, post publish and post delete),
because ambiguous writes are read before any retry.

### Readback adapters

`lib/domain/readback/*` are the client-safe comparisons the readbacks use: the
live resource is read after the write, both sides are normalised the way
Google normalises what it stores, and only the written fields are compared, so
unrelated drift and fields Google adds never fail a write that applied.

| Adapter    | Compares                                                                         | Used by                                                                          |
| ---------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `posts.ts` | topic, language, summary, call to action, event title and schedule, offer fields | `matchLivePost` (ambiguous creates, stranded posts) and post update verification |

A post create is still proven by its name alone: settling a named create
`failed` would invite a second create. Business information, attributes and
lodging compare their readback in the reviewed change-set executor
(`businessInformationMatches`, `googleAttributesMatch`,
`matchesGoogleUpdateMask`).

The transport (`lib/server/google/transport.ts`) decides which provider errors
are ambiguous. In mutation mode it raises `GoogleMutationAmbiguousError` for a
network failure, a timeout, a 408 or 5xx, and for a 2xx whose body cannot be
read, is empty (except for a `DELETE`), is not JSON or does not parse: the
request was dispatched and accepted, so the write may have landed
(`classifyMutationFailure` kind `decode` in `lib/domain/retry.ts`). A non-2xx
with an unreadable body is still classified by its status, so a 4xx stays
`failed`. A caller that checks the success shape itself (a create without the
new resource's `name`) raises the same error rather than a plain failure.
The reviewed change-set paths (`lib/server/gbp-confirmation.ts` for business
information, attributes and lodging; `lib/server/place-action-execution.ts`
for action links) record such an answer, or a create answered without its
`name`, as execution state `unknown` and never store it as Google's response:
only the independent readback can move the attempt to `confirmed`.

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

Receipts are recovered without a request. A receipt
(`mutation_operation`) settled `uncertain` is due for the job runner's
`mutation_recover` kind two minutes later (`RECOVERY_FIRST_DELAY_SECONDS` in
`lib/server/mutation-operations.ts`; at once when the retention cron aged it).
`lib/server/mutation-recovery.ts` rechecks the actor with
`recheckAuthorisation` (read access, same connection; not the credential
generation, which a reconnect renews), reads Google through the surface's
adapter in `lib/server/mutation-recovery-registry.ts` and compares it with the
intent the attempt row recorded before dispatch. Hours compares a whole
schedule with the pinned canonical hash and a selective publish (0087
`selection`) with its selected parts only. A landed write settles the attempt
`succeeded` and the receipt `confirmed_applied` (`awaiting_confirmation` when
the readback only identifies it, as for a post create); a
write that did not land settles both `failed`; nothing is re-sent. A post's
verdict moves the post row only while the post still holds the content that
attempt sent, has no later attempt and is `ambiguous` or `failed`; otherwise
only the attempt and receipt settle, so a later edit or publish is never
overwritten (a landed create still adopts its Google name). Unreadable
reads back off up to eight counted attempts, reconnect-blocked connections
park without counting, and a receipt nothing can resolve stays `uncertain`,
leaves the queue and notifies the owners and admins (`mutation_unconfirmed`).
Writes made without an intent have no receipt and keep the request-driven
recovery below.

Request-driven recovery needs a request to arrive, so it only ever reaches a row somebody
comes back to under the same key, and the usual repair — edit the canonical
resource and publish again — mints a different one. The retention cron
(`lib/server/retention/purge.ts`) reaps the remainder: a row left in any
in-flight status for twenty-four hours (measured from `started_at`, which
every GBP attempt table now carries; media gained it in 0093) is settled
`ambiguous` with
`attempt_interrupted`, a settled status, which the next request for that key
reconciles as below instead of 409ing on it as in flight. The halves are not interchangeable — the
reaper holds no provider credentials and cannot read anything back, and the
readback path never runs at all for a tenant nobody opens.

A settled `ambiguous` row is never re-armed blindly: the write it carried may
have landed, and re-sending a create is a duplicate. On a `"resume"` surface
the next request for that key reads it back first, with no grace window, under
the same three outcomes as an interrupted row (an unreadable provider leaves
it `ambiguous`; a match settles it `succeeded` and answers `idempotent`; a
mismatch settles it `failed` and the request re-arms and publishes). A surface
with no `readback` answers 409 `mutation_uncertain` instead. Every settle the
reconcile makes, and every re-arm, is conditional on the status that was read
(`expectedStatus`, and `start` re-arming only the status `find` saw), so two
requests reconciling the same row cannot both send. `"replay"` surfaces are
unchanged: their keys are request- or intent-scoped and a repeat answers from
the existing row.

Posts add a guard of their own because a post's key moves with its content:
`requestOrPublishLocalPost` refuses to dispatch a post whose status is
`ambiguous` until Google's live list has settled it on the server
(`reconcileLocalPosts`). When the list cannot be read the request fails with
the provider's own error and the post stays `ambiguous`. For an uncertain
create (no Google name yet), a listed match adopts the live post and the
publish answers `published` without a second create; no match settles it
`failed` and the publish proceeds; a post still `ambiguous` after that (a
concurrent re-strand) answers 409 `post_publish_uncertain`, as does an edit
of an uncertain create, which would otherwise move the post's key away from
the guard. An uncertain update is different: the post's name being listed
proves only that the post exists, so it settles `failed` with
`google_post_update_unconfirmed` (the list then leaves the unsent text alone)
and the publish re-sends the PATCH, which carries no duplicate risk. For the
same reason a publish readback of an update proves nothing without the PATCH's
own response, so an ambiguous update settles `failed` rather than `succeeded`.
Post deletes read the live list only when the DELETE itself was ambiguous; a
clean 2xx is taken as Google's answer.

Media creates add upload checkpoints
(`supabase/migrations/0093_media_mutation_checkpoints.sql`). An upload is
three provider calls -- `media:startUpload`, the byte upload, then the create
naming the reserved `dataRef` -- and only the create can put anything on the
listing. `lib/server/media.ts` records `upload_phase` (`data_ref_obtained`
with `upload_data_ref`, `bytes_uploaded`, `create_sent`) on the attempt before
each next call, and a create from a URL records `create_sent` alone. Anything
that fails before `create_sent`, a timeout included, settles `failed`
(`media_upload_interrupted`): nothing can exist, so a retry is safe. A create
is keyed on its content (`content_sha256`: the bytes, or the source URL) plus
the intent. When the create itself is uncertain (a timeout, a 5xx, a 2xx
without the new item's name), the live merchant media list is matched
(`lib/domain/media-reconcile.ts`): same format, category, description and
source URL, created after the attempt started, not already named by another
create's `google_response`. Nothing in an upload's item ties it to its bytes,
so while another create of the same format and category overlaps the attempt
without a name of its own (sent and unsettled, or adopted by a person) no
candidate is adopted. Exactly one match is adopted (`resolution = 'adopted'`)
and read back; none or several, a contested match, or a list that cannot be
read leave the attempt `needs_resolution` for a person. A photo someone adds
in Google directly in the same window cannot be told apart. While a create of
the same content at the same location is unresolved (or still being sent)
another one is refused with 409 `media_needs_resolution`
(`media_create_in_progress`), so it is never re-created blindly. The guard
runs in the transaction that claims the attempt, under a transaction advisory
lock on (location, content), so two concurrent creates cannot both pass it; a
retry under the same intent is answered from its receipt first. The photos tab lists unresolved creates
(`unresolvedCreates`, `components/locations/photos/unresolved-creates.tsx`)
and `POST /api/locations/[id]/media/resolutions/[attemptId]`
(`resolveMediaCreate`) records the person's verdict: `adopted` settles the
attempt `succeeded` and its receipts `confirmed_applied`, `abandoned` settles
both `failed` and lets the content be added again. The verdict is final over a
request still running: its later failure settles nothing, and its later
success over `abandoned` answers 409 `media_resolution_conflict`. The
retention purge keeps an unresolved create past `expires_at`; it ages off once
resolved. Recovery
(`mediaRecoveryAdapter`) reads the same checkpoints: a create stopped before
`create_sent` did not land, a sent one is matched against the list or marked
`needs_resolution` when recovery stops, a later one still at phase `none`
(it records `content_sha256` from the start) stopped before its first call
and did not land, and a create from before 0093 (phase `none`, no content) is
handed to a person as before. A create Google answered with a name
is verified by that name and its format, not field by field, so a landed
create is never settled `failed`.

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

Google Posts and merchant/customer Media run through
`runGbpWrite` like Hours, Profile and Food Menus (Place Action links moved to
reviewed change sets, "Reviewed Place Actions" below): tenant/location permission,
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
POSTs the same eight for local and non-Vercel deployments.
`lib/server/leases.ts` protects each fleet-wide loop with PostgreSQL advisory
locks so overlapping schedulers skip rather than duplicate work, and records
each run in that loop's `ops_heartbeat` row (start, skip streak, failure and
completion; 0089) so the lock namespace and the liveness names cannot drift. A
session-driven refresh under the same lease is recorded as manual and never
moves the cron heartbeat.

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
pressure, delivered per operator recipient (`platform_incident_delivery`).
Email goes through `lib/server/notifications/email.ts`; with no provider
configured deliveries are recorded `suppressed`. Every queue claims, sends and
settles through one driver, `lib/server/notifications/delivery.ts`: sent,
suppressed, failed (refused, retried with back-off) and uncertain (a timeout
after dispatch, retried only under its idempotency key's window, checked
again at claim time; sticky through later attempts via `may_have_sent`).

## Membership, organisation switching, privacy, and retention

Owners create one-time invitations through `app/api/invitations/route.ts`.
`lib/server/provisioning.ts` validates the invitation and provisions the
verified email/password identity inside the inviting organisation; it does not
create an unrelated tenant. `app/api/session/switch/route.ts` verifies
membership, rotates the session, updates the default organisation, and audits
organisation switching.

Invitation email (plan P06-6), behind the organisation's `invitation_email`
feature (default off; off, an invitation is a link the inviter copies). On,
`POST /api/invitations` queues an `invitation_delivery` row (migration 0104)
in the invitation's transaction and sends it inline once that commits;
`POST /api/invitations/[token]/resend` (owner/admin, the segment carrying the
invitation id) queues another. Both go through the shared email driver in
`lib/server/invitations/delivery.ts`, with the idempotency key
`invitation-delivery/<id>`, at most one pending row per invitation, and the
link rebuilt from the encrypted token and `NEXTAUTH_URL` at send time (never
logged). The job tick (`runDueJobs`) drains retries and rows the inline
attempt did not settle, across tenants through
`invitation_delivery_due_organisations`, under the `jobs` and
`invitation_email` pause scopes; every claim reads the feature again, and
rows found pending once it is off are suppressed (`invitation_email_disabled`).
`TENANT_EMAIL_ENABLED=false` or no provider records the row `suppressed`; the
`invitation_email` abuse limit (`lib/server/abuse-limits.ts`) is counted in
the transaction that queues the row, so only a queued email spends it: a
creation over it is written `suppressed`, a Resend answers 429, and a Resend
refused as still pending counts nothing. `GET /api/invitations` returns each invitation's latest
delivery and `emailDelivery`; Team shows the state, Resend and Copy link as
the fallback (`components/settings/invitations-panel.tsx`,
`lib/settings/invitation-delivery.ts`).

Workspace mode (plan P06-5). Registration can offer a business (the default)
or an agency workspace while admission is open (`lib/domain/auth.ts`
`registerSchema.workspaceMode`), but only with
`REGISTRATION_WORKSPACE_CHOICE_ENABLED` on (default off; `lib/server/env.ts`);
while it is off the choice is hidden, the register route ignores it and
stored provider metadata cannot pick agency. An invited sign-up never chooses. The choice
travels in the auth provider's user metadata (`workspace_mode`, set by
`lib/server/password-auth.ts`), so it survives the email confirmation round
trip, and `provisionAuthenticatedOwner` creates the hidden home client only
for a business. An owner can switch modes with `PATCH /api/organisations
{ workspaceMode }` (`app/api/organisations/route.ts`,
`lib/server/workspace-mode.ts`), dark behind the `workspace_mode_change`
organisation feature with the Settings card
`components/settings/workspace-mode-card.tsx`. Business to agency demotes the
home client to an ordinary visible client; agency to business is refused with
more than one active client, promotes the sole active client (or creates a
home client) and refiles every other location under it. Report shares are
scoped by `location.client_id` when read (`lib/server/shared-report.ts`), so
when the refile would put locations under a client with live share links the
switch is refused (409 `workspace_mode_report_shares`, with the counts) until
the owner confirms with `confirmReportShares`. A billing plan belongs to one
workspace mode (migration 0109's `organisation_billing_plan_matches`), so the
switch also locks the organisation's billing row after the organisation row
and is refused (409 `billing_subscription_active`) while a subscription is
running (trialing, active, past_due, grace), a read-only one still has a
Stripe subscription, or a Checkout session is open. Each change is audited as
`organisation.mode.changed`, with the refiled count and those share ids.
Migration 0102's `client_guard_business_single` trigger refuses an active
non-home client in a business workspace, and migration 0103's
`location_require_business_home` trigger files a business location with no
client under the home client and refuses any other client. Both take FOR
SHARE on the organisation row, which the switch holds FOR UPDATE, so neither a
concurrent client create nor a concurrent location write can slip past it.

Google source payloads, review text, reviewer display names and profile photo
links, addresses, and media links carry an expiry no later than the
organisation’s configured window, which is database-constrained to 30 days.
`/api/cron/retention` purges expired raw content while retaining minimal derived
operational metrics. It is a five-minute dispatcher over one retention cycle per
UTC day, opened at or after 03:00 (`lib/server/retention/cycle.ts`, migration
0097): each fire resumes the running cycle from its persisted enumeration
cursor, retains each organisation in bounded rounds
(`lib/server/retention/purge.ts`, migration 0099: one tenant transaction per
round, at most `RETENTION_BATCH_ROWS` rows per dataset statement), leaves an
organisation the budget stopped part-way pending for the next fire with its
committed counts, records its success or failure per organisation, retries a
failed organisation on later fires up to three runs, and completes the cycle --
reported to the tick ledger through `recordTickCycleCompleted` -- once every
organisation has succeeded or used up its runs. An explicit `?cursor=` runs one
hand-run page instead and never moves the cycle. The same purge deletes
`ai_usage` cost rows 13 months after creation (migration 0100), behind
`RETENTION_DELETES_ENABLED`, and never a `reserved` row, one of the calendar
month still open, or one whose allowance period (`ai_credit_period`, 0107) has
not ended or has an operator adjustment still open (`aiUsageInClosedPeriod`). An owner-approved legal hold from `app/api/legal-holds/route.ts` blocks
purge and erasure only for its selected review.
`app/api/privacy/requests/route.ts` implements attributable access,
rectification, erasure, and restriction fulfilment; the erasure halves (local
scrub, reply withdrawal at Google, settlement) live in
`lib/server/privacy/fulfil.ts`. An erasure whose reply Google will not drop is
parked `in_progress` and retried by the job tick
(`lib/server/privacy/withdrawals.ts`, claimed through
`claim_due_privacy_withdrawals`, migration 0101) with backoff for up to 12
rounds, as the owner who fulfilled it: that owner's grant is re-derived from
membership at dispatch (`lib/server/authz/actor.ts`), so a removed or demoted
owner stops the retries (`actor_revoked`). A publish pause defers a round
without spending its budget; entitlements do not gate it. A round only
starts a reply with one Google timeout left in its budget (the tick's, or
the PATCH's inline 40 seconds); replies it has no time for are deferred to
the next tick at no cost, and requests claimed but not started have their
lease released. A request with no retry coming is listed first and flagged
`withdrawalStalled` and `overdue`; an owner fulfilling it again takes it
over and restarts the budget. Erasures parked before migration 0101 have no
retry actor or schedule, so they are listed as stalled and join the
background retry only after one manual re-fulfil.
`app/api/privacy/export/route.ts` exports only still-retained content, in
keyset pages (`create_time desc, id desc`, both immutable, at most 1000
reviews each) so any match size completes: each page returns `nextCursor`
(codec `lib/contracts/cursor.ts`, sealed by `sealCursor` in
`lib/server/crypto.ts` with an HMAC bound to the organisation and subject)
until the last, an interrupted download resumes from the last cursor
received, and every page writes its own audit row with its page index and
starting position. The last page reports `complete: false` with
`addedDuringExport` when matching reviews were first stored after page 1 and
sort ahead of it. Nothing about an export in progress is stored server-side.
Owners work all of this from `/settings/privacy`
(`app/(dashboard)/settings/privacy/page.tsx`, plan P04-7), which ships dark
behind the `privacy_settings` organisation feature: the page and
`app/api/privacy/retention-status/route.ts` are a 404 while it is off, and the
settings capabilities carry `privacy` (`none`, `read` for admins, `manage` for
owners) so the settings tabs only offer it when it is on. The export form
follows `nextCursor` page by page, joins the pages into one JSON file, and
resumes from the last cursor after a failed page. The retention-status route
reads `retention_cycle` and `retention_cycle_org` outside the tenant
transaction, filtered to the session's organisation, and returns none of a
cycle's fleet-wide counts.

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
`describeActionError` on error. What a write achieved is worded once: the
seven outcome states (`saved_locally`, `sent`, `awaiting_confirmation`,
`confirmed_applied`, `rejected`, `failed`, `uncertain`) are fixed in
`lib/contracts/mutation-operations.ts`, `lib/editors/outcome.ts` maps each to
its label, headline, tone and toast kind, and success toasts, the publish step
list (`components/ui/publish-steps.tsx`) and the inline notice
(`components/ui/operation-outcome.tsx`) all read that mapping. Only
`confirmed_applied` may say "Live on Google"; a request that merely succeeded
is "Sent to Google". `lib/errors/action-errors.ts` is the single
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

Migration `0062_management_confirmation` adds execution and confirmation states,
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

Migration `0063_gbp_change_sets` adds lodging reviews with frozen payload, mask,
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
Migrations `0064` and `0065` extend these reviews to business-information and
attribute writes. Other write families still require the same approval boundary.

Account onboarding has no linked location at the start. Migrations `0066` through
`0068` therefore add tenant-scoped draft, review and creation records rather than
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
and authorises no link. Migration `0069` adds separate immutable local match-link
reviews, with a composite tenant/draft foreign key, forced RLS and approval-only
runtime updates. Reviews freeze exact resource readback, draft/search identities,
account/connection/client, proposed local name and existing mapping conflicts.
Approval refreshes account membership and the selected resource, then rechecks
draft, actors, mapping state and current two-person policy under the draft lock.
Unknown provider verification remains null rather than false. Reviews expire for
approval after 24 hours and cascade with the parent draft's 180-day retention.
No provider create/validation call represents local-link review. Migration `0070`
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

Activity pages by keyset cursor only (a `page` from an older client is
ignored and reads the first page). The cursor binds to a location and orders
by timestamp plus source-prefixed ID. It retains PostgreSQL microseconds so
ties and same-millisecond attempts are not skipped. The drawer follows
returned cursors with "Load more" (`useLocationActivityPages`).

The growing per-location lists share that shape (P06-7): opaque cursors from
`lib/contracts/cursor.ts`, each bound to its location and filters and refused
elsewhere with 400 `invalid_cursor`, and infinite queries merged by
`lib/queries/paged-list.ts` behind the `components/ui/load-more.tsx` footer.
Posts (`listLocalPosts`) materialise their sort time in a CTE and page on
(`sort_at` desc nulls last, `id`) within one status view, returning per-view
counts; only the first page reconciles with Google. Media (`loadMedia`) pages
on (ownership, `google_create_time` desc nulls last, `id`); only the first page
may re-read Google. No new indexes: both lists filter on the existing
per-location indexes and stay small per location. Future bulk and schedule stores must join this projection
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

Migration 0073 projects legacy, unreviewed verification payloads onto a bounded
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

Migration `0071_verification_start_reviews` adds encrypted private payloads to the
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
0073 redacts legacy credential echoes while retaining known outcomes and
historical identity, scope, actors, timestamps and retention state. Its isolated
fresh/upgrade tests do not establish production migration activation.

`google-verification-completion-reviews.ts` now provides scoped PIN-completion
preview, restore and approval. It independently establishes the exact pending
request and a supported PIN method, freezes that sanitized request and credential
generation, and rechecks them at approval. Migration 0072 extends the existing
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
(0077, intent immutable by trigger). Acceptance and independent collection
readback are recorded separately; a confirmed outcome is settled and never
downgraded by later Google edits. Writes serialise per Google account with
access and lifecycle changes (`google-account-change-lock.ts`,
`requireNoUnresolvedAccountChange`). Outcomes are reported as operational events
(`publication_failed`, `publication_unresolved`, `publication_confirmed`).

## Operational notifications (WP8, 0078)

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

## Scheduled post publication (WP7, 0079)

A `post_publication_schedule` freezes a post's content, the location, an IANA
timezone, a bounded local rule (`lib/domain/publication-schedule.ts`) and any
explicit event-date offsets; approval binds its payload hash and revision.
Approval materialises future occurrences once (`unique (schedule_id,
schedule_revision, intended_at)`). The job tick claims due schedules with a
lease (`claim_due_publication_schedules`), rechecks approval, policy, requester
and approver grants, connection and kill switches, publishes an occurrence only
inside its 5-minute dispatch window (P08-R3, below), never publishes ended event
or offer content, and for a repeating rule creates one post row per occurrence
so a retry reuses the same publish idempotency key (a one-time occurrence
publishes its source draft itself, P08-R4 below). An ambiguous publish blocks the schedule; nothing
is resubmitted automatically. Edits create a new revision and cancel pending
occurrences. For repeating rules, spring-forward times run at the first valid
local time, repeated autumn times run once at the earlier instant, and absent
month days are skipped.

One-time slots are strict (P08-R2, migration 0117; `resolveLocalSlot` and
`planOnceSlot` in `lib/domain/publication-schedule.ts`). Create, revise and
approve each require the slot to be 5 minutes to 90 days ahead
(`schedule_too_soon`, `schedule_too_far`). A time the clocks skip is refused
(`schedule_time_nonexistent`). A time that happens twice needs `offsetMinutes`
naming one of its two UTC offsets (`schedule_time_ambiguous`, with both choices
in `details`). An offset the time does not have is `schedule_offset_invalid`.
The resolved offset is stored as `post_publication_schedule.offset_minutes`;
the payload hash covers it only for a time that happens twice, since elsewhere
the rule and zone already fix the instant (so hashes stored before 0117 stay
valid). Each occurrence carries `deadline_at` (intended + 5 minutes, defaulted
by a trigger for writers that omit it). 0117 backfills the offset from an
unadjusted run of the current revision; an active or paused one-time schedule
whose run a clock change moved goes to `needs_review` /
`slot_needs_new_time` (its waiting run cancelled `schedule_quarantined`).
Approving a schedule from before 0117 resolves its stored slot strictly, stores
the offset and never guesses the earlier instant. Repeating rules materialise
only occurrences at least 5 minutes ahead.

Dispatch is strict (P08-R3, migration 0118;
`lib/server/publication-schedule-runner.ts`). Approval freezes the Google target
(`target_google_connection_id`, `target_credential_generation`,
`target_google_location_name`) and the approval policy
(`approved_approval_required`), and records the approver's assurance (0106:
`approved_aal`, `approved_mfa_verified_at`, `approved_security_version`). Approving
needs an active link (409 `schedule_location_not_linked`). Approve and resume
apply the shared approval rules (`lib/server/authz/approval-policy.ts`: the
frozen two-person flag, the second approver, and on resume a current manager
holding the security version the approval recorded). Before each publish
the runner calls the shared `recheckApprovedWork` (the same recheck as bulk
batches): the requester may still `request_approval` at the listing, and the
approver (`recheckAuthorisation`, `lib/server/authz/actor.ts`) may still
publish there as an owner or admin with the frozen connection, generation,
policy (both flags) and security version, and under two-person approval is
not the requester. So a lost right (`permission_revoked`), a relink,
reconnect, policy change or an operator MFA recovery of the approver since
approval blocks the schedule (`connection_changed`, `approval_invalid`)
instead of publishing through whatever is linked now; the
publish's attempt records the approval's assurance; `publishScheduledLocalPost` refuses a
moved link again with nothing sent. An occurrence starts only while
`intended_at <= now() < deadline_at`: `claim_due_publication_schedules` skips one
past its deadline, and `publishScheduledLocalPost` checks the deadline before
anything is written and again immediately before the provider call
(`schedule_deadline_passed`). Every tick, before any pause check,
`mark_missed_post_occurrences()` records a passed slot as missed
(`paused_when_due` when the schedule was paused, otherwise
`outside_dispatch_window`) and raises `schedule_missed`; a one-time schedule then
goes to `needs_review` with that reason, and resume answers 409
`schedule_missed` (choose a new time by editing it). Each publish runs under an
intent derived from the occurrence id (`scheduledPublishIntentId`, stored as
`post_publication_occurrence.intent_id`), so it records a `mutation_operation`
receipt and `mutation_recover` reads back an uncertain create.
`settle_post_occurrences_from_receipts()` (also every tick, redefined in 0119)
settles an `ambiguous` occurrence from its own receipt (surface `local_post`,
target its own post; another write that took the intent does not count):
published, rejected with `provider_rejected` / `publish_failed`, or missed
(`outside_dispatch_window`) for `schedule_deadline_passed`. One with no receipt
of its own was never sent and settles missed once its window has closed plus a
minute. One from before 0118 (no intent) settles from its post, or is cancelled
(`outcome_unverified`) with its schedule sent to review
(`prior_occurrence_unverified`). A one-time schedule whose slot settled missed
goes to `needs_review`; a schedule blocked only by unresolved occurrences
returns to active (or completed). `mark_missed_post_occurrences()` raises
`schedule_missed` only for active or paused schedules, so a blocked repeating
schedule does not raise an incident per day. Recovery never sends anything,
so a create proven not to have landed is never made late. Event-date offsets
apply to repeating schedules only; a one-time schedule publishes its approved
content as is.

A schedule is bound to its source draft (P08-R4, migration 0120). Create and
revise freeze the draft's `content_revision` (0081) and `postContentHash`
(`lib/server/post-content.ts`, the hash a post approval binds) as
`source_content_revision` / `source_content_hash` with the template. An edit to
the draft (`updateLocalPostDraft`) re-freezes every live schedule made from it
in the same transaction: a new revision with the new text, approval and frozen
target cleared, status `awaiting_approval` / `source_changed`, its waiting
occurrences cancelled `source_changed` (a schedule whose rule no longer fits the
content goes to `needs_review`). A paused schedule stays `paused` (reason
`source_changed`) and resuming it asks for the approval again; a blocked one
keeps its block and reason. Re-saving identical text keeps the revision
and changes nothing. Every path that locks a draft's schedules and the draft
(the editor, the runner, create, revise) first locks all the draft's live
schedules in id order, then the draft, so none of them can deadlock another. Approval refuses a draft that moved on some other way
(409 `schedule_source_changed`). A one-time occurrence publishes the source post
itself instead of a copy, and `publishScheduledLocalPost` sends it only at the
frozen revision and hash (`schedule_source_changed`, nothing sent; the publish
claim also requires the revision it read). A draft already on Google, being
published or deleted cannot be scheduled once (409
`schedule_source_unavailable`). Only an end state (on Google, or deleted)
supersedes a due occurrence: the occurrence and schedule end `cancelled` /
`source_superseded`, nothing sent. A manual publish still in flight
(`publishing`, or `ambiguous` with no Google name) leaves the occurrence
`scheduled`; a later tick inside the window publishes it if that publish
failed, and past the window it is missed. A draft has at most one live
one-time schedule (409 `schedule_source_already_scheduled`); create and revise
lock the draft for the check, so concurrent requests cannot both pass. The
runner re-freezes a schedule whose draft changed without the editor and sends
nothing. 0120 binds live rows whose template is their draft's current content
(revision only, no hash); a live one-time schedule it cannot bind goes to
`needs_review` (`source_changed`, or `source_superseded` when the draft is gone
or on Google). The unique index on an occurrence's post now covers only
`scheduled`, `publishing`, `published` and `ambiguous` occurrences, so a later
revision can publish a draft an earlier one missed. A repeating schedule still
publishes copies of its frozen template.

Scheduling is behind the organisation feature `post_scheduling`
(`lib/server/publication-schedules.ts` `schedulingAvailability`). Off, the
routes refuse to create, approve, revise or resume a schedule and the calendar
occurrences route answers 404 `post_scheduling_unavailable`; listing, pausing
and cancelling stay available. One-time is the generally available frequency:
a repeating rule also needs `post_scheduling_recurring` (422
`schedule_recurring_unavailable` without it). The runner blocks a due schedule
whose feature is off (`feature_disabled`, `recurring_disabled`), so turning a
feature back on needs a fresh approval. Migration 0116 quarantined every
repeating schedule that could still run as `needs_review`
(`recurring_quarantined`, its scheduled occurrences cancelled) and copied
unpublished posts' legacy `scheduled_publish_time`/`recurrence` values into
`gbp_local_post_legacy_schedule` for review; nothing creates a job from them.

The Posts tab (P08-R5) shows a draft "Publish now" beside "Schedule" (one-time
only unless repeating is on) while `post_scheduling` is on, and nothing about
scheduling while it is off: no Schedule button, no old-time review and no
Calendar destination (the dashboard layout reads the feature and passes
`hideCalendar` to the shell). Existing schedules stay listed so they can be
paused or cancelled. A post with a live one-time schedule shows it and is not
offered Schedule again; publishing it by hand says the scheduled run will not
happen. Badges and actions come from `lib/locations/schedule-display.ts`: a
slot missed while paused or outside the window reads "Missed" and offers only
"Choose a new time" or cancel, never resume or retry. Owners and administrators
review old per-post times through
`app/api/locations/[id]/legacy-post-schedules/route.ts` (list) and
`app/api/locations/[id]/legacy-post-schedules/[legacyId]/route.ts` (dismiss),
both 404 with the feature off and 403 for any other role. An owner or
administrator scheduling the post closes its review row in the same
transaction; a member's schedule request leaves it open until a manager
approves that schedule (closed then) or dismisses the old time. A post that
already has a live one-time schedule is listed as not schedulable
(`alreadyScheduled`), so only Dismiss is offered. The sheet pre-fills the old
time only while it is at least 5 minutes and at most 90 days ahead in the
sheet's zone. Either way only the review columns change and an audit row
(`post_schedule.legacy_reviewed`) records the outcome.

Operations (P08-R6, migrations 0121 and 0122). The health tick
(`lib/server/notifications/platform.ts`) reads `post_schedule_health()` through
`scheduledPostHealth` in `lib/server/ops-liveness.ts` and opens one
`platform_incident` per organisation for an occurrence still `publishing` past
its schedule's lease (`scheduled_post_stuck`, 10 minutes after it started; not
while the `jobs`, `publish` or `scheduled_post` pause holds the claim) or still
`scheduled` three minutes past its deadline (`scheduled_post_overdue`; one
jobs tick that overran its budget can delay the sweep about two minutes). Both only
report. The retention purge (`lib/server/retention/purge.ts`) has no step
for scheduled post history: D-47 keeps it until a period is decided
(`lib/server/retention/inventory.ts`, `tests/retention-inventory.test.ts`).
0122 adds the proposed rule for when it is, uncalled until then:
`purge_post_schedule_dataset(dataset, 180, limit)` in each tenant, with a dry
run count, ages off ended occurrences and schedules and dismissed per-post
times after 180 days; anything unresolved, awaiting approval or in review is
kept, including every occurrence of a schedule in review or blocked.
`purge_post_schedule_history(180)` is the unbounded run of all three. Both
refuse without a tenant or below 30 days, and the runtime role has no DELETE
on the three tables. `schedule_blocked` also carries `prior_occurrence_unverified`,
`source_changed` and `source_superseded`
(`lib/contracts/operational-events.ts`), raised only for a schedule that was
going to publish; incident emails and digest lines add the reason's wording
from `lib/locations/schedule-display.ts`. The event is written in a savepoint,
so a failed incident insert rolls back only the event, never the post edit. The runner logs `post_schedule.tick` and
`post_schedule.sweep` summaries.

## Bulk listing changes (WP6, 0080; P09-R1, 0123; P09-R2, 0124; P09-R3, 0125; P09-R4, 0126; P09-R5, 0127; P09-R6, 0128; P09-R7, 0129; P09-R8, 0130; P09-R9 UI)

Bulk ships dark behind the per-organisation feature `bulk_actions`: every
`/api/listings/bulk/**` route answers 404 `feature_disabled` without it, the
listings board hides selection and the claim skips the organisation's
children (they wait and expire with their dispatch window).

A preview freezes up to 50 explicit location ids; a batch naming any listing
the requester cannot see is refused without saying which. Each listing gets a
frozen plan from its family (`lib/server/bulk-families/*`, reached through
`lib/server/bulk-listing-targets.ts`): eligibility or skip reason, the current
Google value, the value to send and its update mask. Hours families plan a
selective publish (`lib/domain/bulk-merge.ts` `bulkHoursSelection`): only the
chosen weekdays (seven is a whole week), dates or service type change, and
everything else in the field is written back as Google holds it. Attributes
change by stable ID with typed values (an empty answer clears the masked name;
`[false]` is an answer). Action links are matched by type and addressed by
their Google link name, never by URI (`lib/domain/bulk-place-actions.ts`); a
listing with several editable links of the type is skipped. Approval
binds the preview hash and requires acknowledging skipped listings. A preview
can be approved for 15 minutes from the start of its Google reads
(`preview_expires_at`, set at insert on the database clock); approval opens a
24-hour dispatch window (`dispatch_expires_at`) checked per child at claim and
again just before the provider write, so a child that misses it ends `expired`
and is never sent. Each child also freezes its Google target (connection,
credential generation, location resource name) and its resource key
(`lib/domain/bulk-merge.ts` `bulkResourceKey`); a relink or reconnect fails it
with `google_target_changed`. Execution queues children claimed by the job
tick (`claim_due_bulk_children`, 0123): at most 2 running per organisation
across batches, never two running for one (location, resource key), and the
runner holds the per-location advisory lock of that key (the attribute
editor's `<org>:<location>:attributes`, or `<org>:<location>:hours`, which
`publishCanonicalHours` holds across its live read, snapshot checks, PATCH
and readback) from the baseline read through the
write and readback (an action link also holds the Google account lock), so an
editor write cannot land between the baseline check and the provider call;
it defers with `resource_busy` when an editor holds it. A closed window reads
`expired` per child before the sweep records it (`preview_expired` for a
preview never approved, `dispatch_expired` after approval). The sweep finishes a preview or approved
batch it expires and audits it once (`bulk_listing.expired`, stage `preview`
or `dispatch`); a running batch is finished by the runner. Only 0123 marks a
pre-existing batch over the cap `legacy_over_cap`: a trigger refuses the flag
on any new row or later change, and a grandfathered batch cannot gain
targets. Under two-person approval the requester can never approve their
own batch: the approve route refuses it and the table's CHECK
(`bulk_listing_operation_second_approver`, 0124) refuses any writer
recording it; a pre-existing self-approved batch is flagged
`legacy_self_approved` by 0124 only and the runner sends none of it. Before
dispatch each child calls `recheckApprovedWork`
(`lib/server/authz/approval-policy.ts`): the frozen two-person flag still
holds with two different people, the requester may still
`request_approval` at the listing, the approver may still `publish` there
as an owner or admin (`recheckAuthorisation`), and the listing is still
linked through the frozen connection and credential generation. A lost
right fails the child `permission_revoked`, a relink or reconnect
`google_target_changed`, and an operator MFA recovery of the approver since
the approval `approval_invalid`: approval records the approver's assurance in
0106's `approved_aal`, `approved_mfa_verified_at` and
`approved_security_version` (a review batch records its starter's, who
decides it; 0124 refuses assurance on a batch nobody approved), the runner
passes the version to `recheckAuthorisation`, and each write's attempt
records the approval's assurance. While the organisation is read-only
(`deriveAccess` through `organisationWriteBlock`, with billing enforcement's
rollout flags) a child is held queued with `billing_read_only` for an hour at
a time and nothing is sent; its 24-hour dispatch window still applies. Then
the child's family reads Google, succeeds without writing when the change is
already there, writes once when its baseline is unchanged (for hours, the
selected parts only), and otherwise records a conflict needing a new preview.
Every write goes through a surface pipeline under a receipt: hours through the
hours editor's own path (`publishHoursSelectionLocked` in
`lib/server/hours.ts`, which saves the change as a new canonical revision and
publishes that revision's selected parts, putting the revision back if the
write definitely did not apply; an uncertain one keeps the restore point on
the child, `hours_restore`, and the revision is put back if recovery reads it
back as not applied, unless a later edit has saved over it), attributes and
action links through
`runGbpWrite` on `bulk_listing_write_attempt` (their editors run reviewed
change sets and record no receipts). Each claim of a child has its own
deterministic intent (`bulkIntentId`), the child stores the receipt of its
latest send only (`mutation_operation_id`, composite tenant key, cleared on
each claim, 0125), and
`GET /api/mutations/{id}` answers for it. An uncertain write is left to
`mutation_recover` (the hours adapter, or the two bulk adapters in
`lib/server/mutation-recovery-registry.ts`); once its receipt settles, the
runner settles the child from it (`bulk_children_to_reconcile`, 0125; audit
`bulk_listing.child_reconciled`) and re-finishes the batch, without sending
anything. Retry leaves such a child alone while recovery is still reading it
back, so succeeded and uncertain children are never replayed. Cancelling
stops only queued children.

A batch holds an ordered change list (`items`, 1-50 changes; P09-R4, 0126).
Each child is one (listing, change) pair, keyed `<seq>:<family>`
(`item_key`, unique per batch and listing), and carries its own change
(`input`); the batch's `operation` is the shared family or `mixed`. A batch
holds at most 500 children (listings x changes), in the request contract and
the table (`bulk_listing_operation_item_cap`). Two changes of one batch never
touch the same part of a listing (weekday, date, service hours type,
attribute, action-link type; `bulkChangeParts`), because a listing's children
are previewed against one Google read per resource, shared across that
listing's changes (`planReads`), and each pins only its own parts. A preview
plans five listings at a time and each listing's changes in list order, so a
full batch costs a few reads per listing, not per change. At each
listing a change waits for every earlier eligible change (`depends_on`), so
the listing's changes reach Google in list order; the claim skips a child
while any dependency is previewed, queued or running. Hard prerequisites
(`requires_applied`, a subset of `depends_on`; the rule is
`BULK_PREREQUISITES` in `lib/domain/bulk-merge.ts`: a category change
before service hours and attributes) must have applied: a
dependent waits while one is unresolved and fails `dependency_not_applied`,
unsent, when one ends otherwise (or is skipped at preview with it; blocking
carries down a chain of prerequisites). Retry requeues such a dependent
together with its prerequisite when the prerequisite is retryable (failed, or
ambiguous with recovery finished); a dependent whose prerequisite, directly or
through a chain, ended conflict, expired, cancelled or skipped stays failed
and needs a new preview. A trigger
(`bulk_listing_child_dependency_guard`) holds dependencies to earlier changes
at the same listing of the same batch.

Business information, categories and lodging (P09-R5, 0127) are field-mask
patches. Business information (`lib/domain/bulk-business-info.ts`) offers only
fields that make sense across listings and that Google lets a client write:
website, description, labels and the open status (open or temporarily
closed). Each is set or explicitly cleared (a clear is in the mask and absent
from the body); provider-owned fields and per-listing identity (title,
address, phones, store code, service area, relationships, services) are
refused by the contract, and a permanently closed listing is skipped. Only
the named fields are frozen and compared, so an edit to another field is not
a conflict. Categories change by stable ID (a new primary, additional ones
added or removed; at most 9 additional) and each listing's result is checked
against Google's category list for its region (`categories.batchGet`). Both
patch the location resource under the business-information lock
(`business_info` resource key) with Google's validateOnly check first. The
business-information editor and the profile publisher
(`publishProfileToGoogle`, which also writes website and description) take
the same lock, so neither can write between a bulk child's baseline read and
its PATCH. A bulk website or description write does not go through the
canonical profile, so the profile editor shows those fields as changed on
Google until it is refreshed. A
category change must be listed before the service-hours and attribute
changes that depend on it: their preview is planned under the proposed
categories (`PlanReads.propose`; attribute metadata by `categoryName`), and
they are sent only once it applied. Lodging (`lib/domain/bulk-lodging.ts`,
the industry family) takes paths from the typed lodging allowlist
(`GOOGLE_LODGING_UPDATE_PATHS`, minus `metadata` and `guestUnits`) with typed
values, each set or explicitly cleared; nothing outside the mask may be in
the payload, `false` reads back as `false`, a group path (`pools`) replaces
the group, so it reads back as applied only when the group's other writable
fields are empty, `metadata.updateTime` is stamped at the send, and a listing
without a lodging resource is skipped (a lost Google connection is a
connection error, not a skip). It runs
under the lodging editor's lock. All three record attempts in
`bulk_listing_write_attempt` with receipts (surfaces `business_info` and
`lodging`), read back by their recovery adapters. Healthcare is not a bulk
family, pending decision D-24.

Food Menus and post drafts (P09-R6, 0128). A menus change
(`lib/domain/bulk-menus.ts`) is a full replacement or a merge by stable node
ID; nodes are never matched by label. A node's ID (`menuNodeId`,
`lib/domain/food-menus.ts`) hashes its kind (menu, section or item), its own
content without its child nodes and its parent's ID, so the same node has
the same ID at every listing that holds it, and a node that is merely named
the same is another node. A merge updates named fields of a node, removes a
node, or appends one under a parent, and skips a listing where a named ID is
missing or repeated, where a node is added under the wrong level, or where a
change falls inside a removed node. The preview freezes Google's menus hash
and lists every node each listing loses, adds and updates; a listing whose
saved menus hold an unpublished edit is skipped, and so is one whose saved
menus were edited after the preview, even when Google already shows the
result (both settle as a `food_menus_local_changes` conflict). The child is sent through
the menu editor's own path (`publishFoodMenusChangeLocked` in
`lib/server/food-menus.ts`): the result is saved as a new canonical
revision, then published as the editor's full replacement on
`food_menus_sync_attempt` with the child's intent and a receipt, read back,
and settled by the existing Food Menus recovery adapter. The restore point
(the revision saved and the menus it replaced) is kept in
`bulk_listing_child.hours_restore`, so a write recovery reads back as not
applied puts the saved menus back. A re-claim that finds its own earlier save
(the claim clears the restore point) records it again: the menus that save
replaced matched the preview's Google menus, which Google still shows. The
editor's publish (`publishFoodMenus`)
now holds the same `<org>:<location>:food_menus` lock as bulk children.
Post drafts (`lib/server/bulk-families/posts.ts`) send nothing to Google:
each listing gets one independent local draft (`insertLocalPostDraft`),
authored by the batch's requester, whose id is stored on the child
(`bulk_listing_child.local_post_id`) in the same transaction so a re-run
claim never drafts twice. Each draft is published from the listing's posts
with its own approval (`requestOrPublishLocalPost`), so under two-person
approval its author cannot publish it alone.

Photos and private assets (P09-R7, 0129). A bulk photo is an owned asset
(`media_asset`, lib/server/assets.ts) in a private storage bucket reached only
through the server-only adapter (`lib/server/storage/asset-storage.ts`,
Supabase Storage over REST in `lib/server/storage/supabase-storage.ts`). The
app checks the tenant itself: every asset row is read under the tenant's RLS,
and storage keys are built from the organisation and asset ids, never from a
request. Upload is `POST /api/assets` (a staging row and a signed URL for one
staging object; abuse scope `asset_upload`), a browser PUT straight to
storage (no photo passes through a route body), then
`POST /api/assets/{id}/finalise`, which reads the staged bytes, checks magic
bytes, size (10 KB to 5 MB), dimensions (at least 250 × 250) and SHA-256
against the declaration (`lib/domain/media-sniff.ts`), and writes exactly
those bytes once to `assets/<org>/<sha256>/<asset>`; a trigger keeps a
`ready` asset's content columns immutable. Finalise holds no transaction or
row lock across storage calls: a short transaction checks the asset, the
read, check and idempotent write run outside it, and a second short
transaction settles the asset only if it is still `staging`. The retention
purge (`purgeOrganisation` in `lib/server/retention/purge.ts`, once an
organisation's rounds are complete and only while `RETENTION_DELETES_ENABLED`
is on; a storage failure is logged and retried next run) deletes the staging
key of every asset 24 hours after the upload started
(`purgeExpiredStagingAssets`, counted as `stagingAssets` and recorded with the
rows it marks as a `retention.purge.staging_assets` audit), finalised ones included: finalise deletes the
staged object at once, but the signed upload URL (2 hours) could put a new
one there, so the sweep deletes it once more after the URL expired, with no
transaction open during the storage call.
Everything fails closed: without `MEDIA_ASSET_STORAGE=supabase`, the secret
key and the bucket, the asset routes answer 503 `asset_storage_unavailable`
and photo previews skip every listing. The photos family
(`lib/server/bulk-families/photos.ts`) adds one asset per change, at most 10
per batch (10 new photos per listing), under the key `media`. The preview
freezes the asset's SHA-256, type, size and dimensions and skips a listing
that already shows the photo (`already_applied`, from
`media_asset_publication.google_media_name` and the live media list). A photo
is its bytes: a publication of another asset with the same SHA-256 counts, so
the same file uploaded twice is added to a listing once (the dispatch claim
answers `photo_already_added`, under an advisory lock per listing and
SHA-256). The
child re-reads the bytes from the immutable key, re-hashes them and sends them
through the media editor's checkpointed upload (`uploadMediaFromAsset`) with
the child's intent and approval ref, so the receipt, the unresolved-create
guard and media recovery all apply. The listing's Google media name is
recorded on the asset's publication in the create's settle transaction. A
re-claimed child settles from its earlier receipt instead of sending again;
an unconfirmed create waits for recovery or a person's resolution on the
listing's photos tab, and the bulk reconcile then records the publication
(`afterReconcile`).

Bulk review work (P09-R8, 0130). With `bulk_actions` on, the inbox's bulk
approve and its template replies run on this engine
(`lib/server/bulk-reviews.ts`, families in
`lib/server/bulk-families/reviews.ts`): `POST /api/reviews/bulk` answers with
the batch (`operationId`) and rows `queued`, the job runner sends each
review, and the batch page (`/listings/bulk/[id]`) shows each outcome after
the tab closes. Without the feature, approve stays the synchronous per-row
loop and template replies stay the inbox's own two-step run; assign and "no
reply needed" are always synchronous. A review batch is one child per
review at its location (up to 100, `seq` 0..99, resource key `reviews`), and
is started and decided by one person, so it carries no batch-level
two-person flag: the runner's recheck is per item (`perItemApproval` in
`lib/server/authz/approval-policy.ts`, with each family's own actions), and
each review's approval rules apply at publish as they always have. Approvals
are recorded when the batch starts, one savepoint per row, by
`recordApprovalDecision` with the draft and review version shown; a child
publishes only while that decision is still the review's latest (a
rejection or newer decision since is `approval_withdrawn`). A template child
drafts through `createReviewDraft` (`lib/server/review-drafts.ts`, the drafts
route's own code, template only) under a draft id derived from the child, so
a re-run claim finds its draft, and checks it before publishing or
submitting it for approval (`submitted_for_approval`). Every send goes
through `executePublish`, whose idempotency key and recovery make a re-run
safe; an unresolved publish (ambiguous, or a 429 parked for the reply retry
runner) leaves the child waiting on its `publish_attempt_id` until the reply
pipeline settles it (`bulk_children_to_reconcile`, now including those
attempts). A review child whose lease ran out is queued again within its
dispatch window, at most five runs (`requeue_interrupted_review_children`).
The requester of a review batch may cancel or retry it; retry leaves a child
whose publish attempt is still unsettled alone.

Composer and batch page (P09-R9). The composer
(`components/bulk/bulk-compose.tsx`, `/listings/bulk?ids=…`) edits one change
at a time and adds it to an ordered change list (move up, move down,
remove); the preview sends exactly that list as `items`, or the change being
edited alone when nothing was added. It checks the list with the wire
contract before any request (`bulkPreviewRequestSchema`: overlapping parts,
category changes first, 10 photos, listings × changes at most 500) and
refuses a link naming more than 50 listings instead of trimming it. Regular
hours send only the ticked weekdays. The photos editor uploads through
`lib/api/assets.ts` (`uploadPhotoAsset`: the browser hashes the file with
SHA-256, `POST /api/assets`, PUTs the bytes to the signed URL, then
finalises) or picks a ready asset; the browser PUT needs the storage origin
in the CSP's `connect-src`, which `next.config.ts` (`assetUploadOrigin`) adds
only when `MEDIA_ASSET_STORAGE=supabase`. Food Menus in the composer are a
full replacement copied from one selected listing; merges by node ID stay
API-only. The batch page (`components/bulk/bulk-operation-view.tsx`) counts
the 15-minute approval window down by the server's clock (`serverTime` on
the projection) and disables approval when it closes. It offers "New
preview" for children that can never be retried in place (`conflict`,
`expired`, and `dependency_not_applied` whose prerequisite Retry would not
requeue; `lib/domain/bulk-repreview.ts` `newPreviewRequest`), only once
nothing in the batch is queued or running. The preview API pairs every
listing with every change, so the request is built from (listing, change)
pairs that need it plus their prerequisites, in order; a change already at
a listing is skipped there at plan time, except a post draft, which has no
such check and is left out (and named on the page) whenever the request
would reach a listing that already has it. The page also links a review
child to its review in the inbox, and shows a child's receipt (`GET /api/mutations/{id}` through
`OperationReceiptNotice`) only when asked, so a 500-child batch never polls
every receipt.

## Billing foundation and entitlements (P07, 0107)

Migration `supabase/migrations/0107_billing_foundation.sql` adds the
commercial records. Nothing refuses work on them until central enforcement is
switched on (see "Central entitlement enforcement" below), so by default the
app behaves as before.

- `billing_plan` is the versioned catalog: platform-level, readable by the
  runtime, written only from the operator connection. A version's terms never
  change (a trigger allows only `active` to flip), an active plan must name its
  Stripe price, and a test-environment plan is always a test offer. The
  migration seeds no plans, so nothing can be sold until a catalog exists;
  `scripts/billing-catalog.mjs` seeds one from a reviewed file (P07-S7).
- `organisation_billing` is one row per organisation under forced tenant RLS.
  Every existing organisation was backfilled as an explicit `pilot`, and
  `lib/server/provisioning.ts` seeds the same row in the transaction that
  creates an organisation (`seedPilotBilling` in
  `lib/server/billing/state.ts`, which also holds the plain and `FOR UPDATE`
  reads). Migration `0109_billing_integrity` makes the row a database
  guarantee: an `AFTER INSERT` trigger on `organisation` seeds the pilot row
  whatever code creates the organisation (an older app release, an operator
  script), and it backfills any organisation created between 0107 and 0109.
  The same migration requires a subscription state's current and scheduled
  plan to match the record's `environment` and the organisation's
  `workspace_mode`, so a live subscription can never name a test offer.
  Both 0107 and 0109 set `lock_timeout` (5s) before they alter tables the
  app writes.
- `ai_credit_period` is one allowance grant (pilot month, trial, paid period,
  adjustment), idempotent per organisation, kind and `source_ref`; a null
  allowance means unknown. `ai_usage.credit_period_id` links usage to its
  period through a composite tenant key. The migration grants nothing: no
  periods, and existing usage keeps a null link.

`lib/domain/entitlements.ts` `deriveAccess(billing, plans, now)` is the one
pure answer to "what may this organisation do now": `full`, `grace` or
`read_only`, with a reason, the location limit and the limit new links must fit
(the lower of the current and a scheduled plan's). Pilots get full access with
no limits; a failed renewal gets seven days of grace; a failed first payment
gets none; a missing record or a paid state without its plan derives read-only.
The period columns mirror the provider's subscription period, which Stripe
advances at renewal whatever the payment outcome, so grace is never inferred
from `current_period_end`: the processor records `grace_ends_at` (migration
0108 requires it for a failed renewal, and an end for an active period),
deriveAccess caps it at seven days after `current_period_start` (the failed
boundary), and a missing grace end or an active period with no end derives
read-only (`record_incomplete`). The reasons are the `ACCESS_REASONS` list,
which the wire contract pins. The local bootstrap organisation
(`provision_local_bootstrap`) gets its pilot record from
`ensureDevelopmentSession`. `lookupSession` attaches the result as
`Session.access`, and whether enforcement applies as
`Session.entitlementEnforced`. Wire shapes live in `lib/contracts/billing.ts`.

### Central entitlement enforcement (P07-S3, 0110)

`lib/server/entitlement-policy.ts` is the one place that decides whether an
organisation's billing lets it start new work. It applies only when both
switches are on: `BILLING_ENFORCEMENT_ENABLED` (env, default off, a hard
override) and `organisation_billing.enforcement_enabled` (per organisation,
added by `supabase/migrations/0110_entitlement_enforcement.sql`, default off).
With the env flag on, an organisation with no billing row is enforced too.

- Routes: `route()` (`lib/server/route.ts`) refuses every session mutation
  (any method but GET/HEAD/OPTIONS) with 402 `billing_read_only` while the
  organisation is read-only. A route declares `entitlement: "ai"` for AI work
  (`Access.canUseAi`) or `entitlement: "exempt"` for what read-only keeps:
  session switching, privacy export and requests, legal holds, Google
  disconnect, unlinking, invitation accept and revoke, member removal,
  cancelling or pausing queued work and a person's own notification state.
  Resuming a paused schedule shares its route with pausing and cancelling
  but re-arms an approved publication, so that handler refuses `resume`
  while read-only (and without a recent two-step verification), like
  retrying a bulk batch.
  `ENTITLEMENT_EXEMPT_ROUTES` lists them, and
  `tests/route-entitlements.test.ts` fails when a route and the list disagree.
- Workers: a publish `retry` for a read-only organisation is held for an hour
  with `provider_error_code = 'billing_read_only'` and audited once
  (`publish.retry_held_billing`, `lib/server/jobs.ts`); a bulk listing child
  is re-queued for an hour with that result code
  (`lib/server/bulk-listing-runner.ts`); a scheduled post is held like a
  publishing pause (`scheduledPostEntitlement` in
  `lib/server/publication-schedule-runner.ts`, `schedule_blocked` with reason
  `billing_read_only`, counted as `readOnly` in the tick summary): nothing is
  claimed or sent, there is no hour-long hold, every tick re-checks it inside
  the occurrence's 5-minute window, a slot still held when the window closes
  is recorded missed (`outside_dispatch_window`) and never publishes late, and
  the incident opens once per occurrence (its subject is the occurrence), not
  once per tick. The scheduled post sweep (`scheduleSweep`) runs: it only
  records missed slots and settles from receipts. Read-backs (`recover`,
  `mutation_recover`) and the syncs, which only read, keep running.
  `READ_ONLY_BACKGROUND_WORK` records the decision for every job kind, job
  tick runner and cron tick: only `retry`, `bulk` and `schedules` are held.
  Privacy withdrawals, retention, billing processing and queued invitation
  and alert email keep running; resending an invitation is a `write` route
  and is refused. `tests/route-entitlements.test.ts` fails when a kind,
  runner or cron has no decision.
- Location limit: the `location_link_enforce_limit` trigger refuses a new
  active link (an insert, or an inactive link turned active) once the
  organisation's distinct active Google locations reach the lower of the
  current and the scheduled plan's limit; re-linking a Google location that is
  already linked takes no seat, a pilot has no limit, and a subscription state
  without a plan has a limit of 0. It never touches existing links, so a
  downgrade never unlinks anything. A link whose connection expired or was
  revoked still counts until unlinked; a disconnect deactivates links, and
  reactivating one goes back through the trigger. The env override reaches
  the trigger as the transaction setting `app.billing_enforcement`, which
  `withTenant` sets (`lib/server/db.ts`); a write outside `withTenant`
  (operator SQL, scripts) has no setting and follows the organisation's own
  flag alone. With no billing row the trigger applies a limit of 0 when the
  setting is `on` (0111), as the app does. `billable_location_count` is the
  trigger's alone: 0111 revoked it from the runtime role, because as a
  SECURITY DEFINER function it would read any tenant's count. Onboarding
  creation checks the seat (`assertNewLocationSeat`) before it creates the
  Google location, and the creation and match links record the trigger's
  refusal as `location_limit_reached`. `apiError` maps the trigger's error
  to 402 `location_limit_reached` with the limit (`locationLimitError` in
  `lib/server/http.ts`); after a Google login the automatic link reports
  `location_limit_reached` as its setup outcome and keeps the connection.
- Capabilities: `lib/server/capabilities.ts` returns `canWrite` and turns the
  write flags off while read-only, so the UI disables what the routes refuse
  (`lib/locations/gating.ts` explains the billing block first).

### Stripe webhooks, lifecycle processing and reconciliation (P07-S4, 0112, 0113)

Off unless `BILLING_ENABLED` is on and `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET` and `BILLING_ENVIRONMENT` are set and agree (the key's
`sk_test_`/`sk_live_` mode must be the environment);
`lib/server/billing/stripe.ts` `billingConfig` decides, and every billing
entry point fails closed with 503 `billing_unavailable` otherwise. The client
uses the official `stripe` SDK pinned to the API version its types describe
(`STRIPE_API_VERSION`), with a 10-second timeout; the sync's own calls, made
while the billing row lock is held, use 8 seconds and no SDK retry, so one
sync (at most three calls) takes at most about 24 seconds.

- Receipt: `app/api/webhooks/stripe/route.ts` (public, Node runtime) reads the
  raw body, verifies `Stripe-Signature` with `constructEvent`
  (`lib/server/billing/webhook.ts`), refuses the other Stripe mode and Connect
  events, writes a `billing_event` row through `record_billing_event` and only
  then answers 200. The row is content-free: event id and type, mode, the
  customer id it routes by and a SHA-256 of the body; the payload is never
  stored. Redeliveries are idempotent on the event id. The runtime role has
  no privilege on the table; it records, claims and settles only through the
  SECURITY DEFINER functions of `supabase/migrations/0112_billing_events.sql`.
- Processing: the job tick (`lib/server/jobs.ts`) calls
  `processBillingEvents` (`lib/server/billing/process-events.ts`) first, on at
  most 15 seconds, gated by `jobs`, `BILLING_ENABLED` and the operator
  `billing` scope but none of the Google flags. `claim_billing_events` leases
  due rows and resolves each organisation from `stripe_customer_id`; an
  expired lease (a worker that died) is reclaimed and counted as an attempt.
  An event whose customer no organisation has is `held` and retried every 15
  minutes; a hold is not an attempt, so it never uses up the event's retry
  budget (0113). A handled event without a customer id is recorded as
  `ignored` (`customer_missing`), and a held event that has waited 7 days
  settles as `ignored` (`customer_unknown`): the backlog is bounded and the
  hourly reconciliation still covers an organisation linked later. No
  organisation's sync starts after the budget; the events it claimed for
  the rest are released (`settle_billing_event` outcome `released`: due
  again at once, no attempt counted), so the tick overruns its budget by at
  most one sync and no event outlives its 120-second lease. The billing
  slice's time comes out of the tick's overall budget. Per organisation, one sync covers
  all its claimed events: under `lockOrganisationBilling` it lists the
  customer's subscriptions from Stripe (the newest running one wins), runs the
  pure reducer `lib/domain/billing-lifecycle.ts`, writes the record, closes a
  converting pilot's open `pilot_month` period and inserts at most one
  `ai_credit_period` (`trial` with `source_ref` `<sub>:trial`, or
  `paid_period` with `<sub>:<period start>`, `on conflict do nothing`). The
  event payload is never trusted, so duplicates and reordering converge on
  provider state. Failures settle `failed` with back-off (one minute doubling
  to an hour) and go `dead` after eight attempts, audited as
  `billing.event_dead`. An unknown price, the other environment or a
  subscription with more than one item fails the event and leaves the record
  alone.
- Lifecycle: `trialing` grants the trial allowance; `active` grants a paid
  period once its latest invoice is paid; `past_due` after a successful first
  payment records `grace_ends_at` = current period start + 7 days and grants
  nothing, a failed first payment records no grace (read-only); `unpaid` and
  `paused` become `read_only`; `canceled` becomes `canceled`; `incomplete`
  changes nothing, so a pilot whose checkout never completed stays a pilot.
  Recovery to `active` grants the recovered period once. A pilot only gets a
  Stripe customer through its owner's checkout (P07-S5), so a pilot reaching
  any running subscription is an owner-initiated conversion, the only thing
  that closes its calendar month (0112 grants the runtime `update (ends_at)`
  on `ai_credit_period` for that alone, and the 0113 trigger
  `ai_credit_period_window_guard` refuses, for every role, any change of
  `ends_at` other than shortening a `pilot_month`: 23514
  `ai_credit_period_window_fixed`).
- Reconciliation: `app/api/billing/reconcile/route.ts` (Vercel Cron, hourly,
  `naba:billing-reconcile` lease, `cron_cursor` walk `billing`) runs the same
  sync for every organisation with a Stripe customer (`billing_reconcile_page`
  returns ids only). Each fire walks page after page (`maxOrganisations` per
  page) until its 30-second budget runs out (`BILLING_RECONCILE_BUDGET_MS`;
  no sync starts after it, so a fire ends by about 54 seconds, inside
  `maxDuration` 60) and resumes from the cursor next hour. A lost webhook is
  therefore repaired within the hour while every linked organisation fits
  in one fire (roughly 30 seconds of syncs, typically 50 or more
  organisations), and otherwise within ceil(linked organisations / per-fire
  count) hours. It completes doing nothing while billing is disabled; the `billing` pause
  answers 503 and is reported as paused, not stale.

### Checkout, Customer Portal, plan change and cancellation (P07-S5, 0114)

Owner-only routes, each `entitlement: "exempt"` (a read-only organisation
must be able to pay its way back) and refused to support impersonation
sessions (403 `support_session_forbidden`). Each declares `mfa: "step_up"`
(P02-S9): an owner without a recent two-step verification gets 403
`mfa_step_up_required` before anything reaches Stripe.

- Readiness (`lib/server/billing/checkout.ts` `billingReadiness`): billing
  configured (`billingConfig`), the operator `billing` scope open, and
  `NEXTAUTH_URL` set for the return pages; checkout in the LIVE environment
  also needs `BILLING_TERMS_URL` (Checkout then requires acceptance of the
  terms) and `BILLING_AUTOMATIC_TAX` (Stripe Tax). Otherwise 503
  `billing_unavailable` with the reason. No active plan for the
  organisation's workspace mode and environment is `catalog_empty`, also 503.
- Catalog (`lib/server/billing/catalog.ts`): the client names a plan id; only
  an active `billing_plan` version for the organisation's workspace mode in
  this deployment's environment, with a Stripe price, is accepted (400
  `plan_unavailable`). Inputs are strict objects (`lib/contracts/billing.ts`),
  so a price id or customer id in the body is a 400; the price id never
  leaves the server.
- `POST /api/billing/checkout` (`app/api/billing/checkout/route.ts`): under
  the billing row lock, refuses an organisation already subscribed, here or
  at Stripe (409 `subscription_exists`, which also covers a completed
  checkout whose webhook has not arrived). It creates the organisation's
  Stripe customer once, committed in its own transaction, then the
  subscription-mode session: one price, quantity 1, `payment_method_collection`
  `always`, a 14-day trial (`TRIAL_DAYS`) only for a first subscription,
  `client_reference_id` the organisation id, metadata on the session and the
  subscription, and an expiry one hour ahead rounded up to a 10-minute
  window (so a retry in the same window sends the same body). The open session is recorded on
  `organisation_billing` (`checkout_session_id`, `checkout_plan_id`,
  `checkout_expires_at`, 0114): a repeat for the same plan reuses it (so
  concurrent tabs get one session), another plan expires it at Stripe first,
  and a session completed meanwhile answers 409 `checkout_completed`. Stripe
  calls carry idempotency keys from the organisation, plan, record version
  and a fingerprint of the request body: a retry after a rolled-back
  transaction replays the session Stripe already made, and a retry whose
  body differs (no trial any more, another owner's email) gets its own key
  rather than Stripe's `idempotency_error`. Nothing is granted on the redirect back: the organisation stays
  as it was (a pilot stays a pilot) until the webhook processor reads the
  subscription from Stripe, which is also what closes the pilot month.
- `POST /api/billing/portal`: a Customer Portal session for the
  organisation's own customer only (409 `billing_customer_missing` without
  one), optionally with `STRIPE_PORTAL_CONFIGURATION_ID`.
- `POST /api/billing/plan-change`
  (`lib/server/billing/subscription-changes.ts`): trialing or active, not
  set to cancel. A target below the organisation's billable locations
  (distinct active links, `countBillableLocations`) is 409
  `location_limit_exceeded`. Otherwise a subscription schedule (created from
  the subscription when it has none) gets two phases, the current price to
  the period end (the trial end while trialing) and the new price after,
  `proration_behavior` `none`, `end_behavior` `release`; the record stores
  `pending_plan_id`/`pending_effective_at`, so a downgrade's lower limit
  binds new links at once (0110, `newLinkLimit`). The current plan releases
  the schedule and clears the change, even if that plan has since been
  retired (it is checked against the workspace, not the allowlist). The provider subscription must match
  the record (customer and price), else 409 `billing_out_of_sync`.
- `POST /api/billing/cancel`: sets `cancel_at_period_end` (or resumes,
  clearing a portal-set `cancel_at`) and only that flag; access continues
  to the period end. Cancelling releases a schedule first (Stripe refuses
  cancellation on a scheduled subscription), which drops a pending plan
  change.
- `GET /api/billing` (`lib/server/billing/overview.ts`): any member reads
  the record, access, billable locations, the catalog for the workspace and
  whether checkout is available (with its reason); `canManage` is the owner.
- Audits: `billing.customer_created`, `billing.checkout_started`,
  `billing.portal_opened`, `billing.plan_change_scheduled`,
  `billing.plan_change_cleared`, `billing.cancel_scheduled`,
  `billing.cancel_withdrawn`.
- Tests point the SDK at a local stub with `STRIPE_API_PROXY_BASE`, which
  `lib/server/billing/stripe.ts` honours for test-mode keys only.

### Billing, Usage and read-only screens (P07-S6)

The customer-facing surfaces read one overview, `GET /api/billing`
(`lib/server/billing/overview.ts`), through `lib/queries/use-billing.ts`
(keyed by organisation) and the pure copy in `lib/billing/presentation.ts`.
The overview now also carries `providerSyncedAt`, `trialDays` (the record's
half of checkout's first-subscription rule) and `writesBlocked` (enforcement
applies and access refuses changes).

- `/settings/billing` (`app/(dashboard)/settings/billing/page.tsx`) is the
  owner's screen: state, plan, trial/renewal/grace dates, linked locations
  against the limit, a scheduled change with "Keep", payment details and
  invoices through the Customer Portal, cancel (with a confirmation saying
  access continues to the period end) and resume, and the plans
  (`components/settings/plan-picker.tsx`). Test offers carry a "Test offer"
  badge on the plan and the page says "Test mode". Prices are not shown: the
  catalog holds no amounts, and Stripe's page shows them before any charge.
  A support session sees the screen with every action disabled.
- Checkout and the portal open only `https://*.stripe.com` URLs
  (`isStripeHostedUrl`); anything else is refused in the browser.
- Stripe returns to `/settings/billing?checkout=returned`, which redirects to
  `/settings/billing/confirming` (`components/settings/billing-confirming.tsx`).
  It polls every 2s and says "Subscription confirmed" only once the record
  holds a running subscription with a provider sync; after three minutes it
  says the confirmation is late. The return itself grants nothing.
- `/settings/usage` is shared by every member: AI credits per period
  (`components/settings/usage-card.tsx`) and the plan's linked locations
  (`components/settings/plan-usage-card.tsx`).
- The app shell's `components/app-shell/billing-banner.tsx` shows a banner
  during grace and while read-only. With enforcement on it lists what still
  works; without it, it says only AI drafting is off (AI is refused on
  read-only whatever the enforcement switch says).
- The Billing and Usage tabs and pages exist only while `BILLING_ENABLED` is
  on (`components/settings/billing-screens.tsx`, provided by the settings
  layout); with billing off Settings is unchanged and the credits card stays
  on the Policy page.
- Billing error codes have customer copy in `lib/errors/action-errors.ts`;
  `location_limit_reached` and `location_limit_exceeded` name the limit when
  the server sends it.

### AI credit periods and generation ids (P07-S2)

`lib/server/ai-credits.ts` accounts AI work against the organisation's current
`ai_credit_period`, read by the database clock (`now()` in the same
transaction), never the application's. The billing state picks the kind: a
pilot uses its UTC calendar month, created lazily and idempotently
(`source_ref` `pilot:YYYY-MM`, so parallel first requests leave one row) with
the live allowance `organisation.ai_monthly_draft_credits ??
AI_MONTHLY_DRAFT_CREDITS`; a trial or paid state uses the period billing
granted, and without one the allowance is unknown (`null`): AI drafting answers
402 `ai_allowance_unknown`, manual replies still save. Read-only access
(`deriveAccess`) answers 402 `billing_read_only`. Usage is summed by
`credit_period_id`; rows from before periods existed count only toward the
pilot month their `period_start` names. Every provider call is reserved under
the organisation row lock before it is made: a draft reserves one credit, a
verification (`lib/server/ai-usage.ts` `reserveVerifyUsage`) reserves none, and
both hold `AI_MAX_OUTPUT_TOKENS` plus a fixed prompt estimate against
`AI_MONTHLY_TOKEN_BACKSTOP` until settled with real counts, so parallel draft
and verify calls cannot together pass it. `lib/server/ai.ts` sends the same
`AI_MAX_OUTPUT_TOKENS` cap with every call. A reservation keeps the period it
was made in, so a settle after a rollover lands in the period that paid.

The drafts route's generation id is the request's `Idempotency-Key` intent
(`requestScopedKeyPart`, falling back to the request id). A retry under the
same id never reserves or calls the provider again: a finished generation
returns its stored draft (200), one still running answers 409
`generation_in_progress` (which the client resends under the same id, see
`lib/queries/use-draft-mutations.ts`), and one that ended without a draft
answers 409 `generation_not_repeatable`. `/api/ai/credits` reports `periodId`,
`periodKind`, `periodStart`/`periodEnd` from the row, a nullable allowance,
`canUseAi` and the access reason; credit notifications use the period id as
their subject and the period end as the reset date.

### AI credit adjustments and catalog seeding (P07-S7, 0115)

A support grant of extra AI draft credits is an `ai_credit_period` row of kind
`adjustment` (`lib/server/ai-credit-adjustments.ts`), written by
`POST /api/operations/organisations/{id}/ai-credits`
(`app/api/operations/organisations/[id]/ai-credits/route.ts`, cron bearer).
Migration `supabase/migrations/0115_ai_credit_adjustments.sql` gives the row
`applies_to_period_id` (the current base period: pilot month, trial or paid
period, through the composite tenant key, never another adjustment),
`reason` and `granted_by`; a check makes all three, and at least one credit,
required for an adjustment and absent otherwise. `readCreditLedger` adds the
credits of every adjustment of the current period to that period's
allowance; usage is never touched, so used credits stay used, and the grant
ends with its period. The grant runs under the organisation row lock, the
operator-chosen `reference` (source_ref `adjustment:<reference>`) makes it
idempotent (a repeat replays, a different grant under the same reference is
409 `ai_credit_adjustment_conflict`), and it fails closed with 409
`ai_credit_period_missing` or `ai_allowance_unknown` when there is no known
allowance to add to. Each grant writes `ai_credits.adjustment_granted` to the
audit log. `GET` on the same route returns the balance and the grant history;
`PUT` (the monthly override) is kept for pilots only and answers 409
`ai_credits_override_pilot_only` otherwise. The shared cron bearer has no
identity, so the operator names themself in the body (D-33).

`scripts/billing-catalog.mjs` (`pnpm billing:catalog`) seeds `billing_plan` for
one Stripe environment from a reviewed JSON file. It validates the file
against the table's checks, then diffs it with the database under a table
lock: missing versions are inserted, existing ones only have `active` set, a
version whose terms differ is refused (terms are immutable; add a version),
and an unlisted active plan is reported, or retired with
`--deactivate-unlisted`. It is a dry run without `--apply`, and applying a
live catalog needs `--allow-live`.

## Reporting provenance (WP9)

`loadPresenceReport` returns null (not zero) for a metric Google sent no rows
for, an equal-length previous window, oldest/newest successful fetch times
separate from the data-through date, and coverage counts (eligible, reporting,
unavailable, stale, not yet fetched). Daily metric dates are Google's own; they
are never shifted. Share links carry the same provenance.
