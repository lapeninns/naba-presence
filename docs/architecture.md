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
It also compares `schema_migration` with the build's required-migrations
manifest (`lib/server/schema-manifest.ts`, checked by
`lib/server/schema-compat.ts`) and fails closed when the database lacks a
migration the code needs. While serving, the cron-bearer platform scope of
`app/api/operations/health/route.ts` repeats that comparison and reports the
deployed commit from `lib/server/release.ts` (`NABA_RELEASE_SHA`, stamped by
`scripts/release/promote.mjs`); the session scope carries neither.
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

Abuse limits (migration 0066, ledger SEC-07/SEC-08) are fixed windows in the
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
time. `getSession()` is wrapped in `React.cache`, so a server render that asks
for the session from a layout, a page and a prefetch helper performs one
lookup and one `last_seen_at` write; in route handlers the cache is a no-op.

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

Membership scope is explicit (migrations 0063, 0064). `member` and
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

0063 is expand-only: it runs before the release that writes the scope is
deployed, so it refuses nothing the deployed code writes. An invitation
trigger names the scope `assigned` whenever `client_ids` or `location_ids` is
set. Because readers now trust the scope, 0064 keeps the one dangerous drift
(a member or viewer holding rows but named `all`) from arising out of writers
that predate it: inserting a `location_member` row for such a member, or
demoting an owner/admin who holds rows, names them `assigned`. It also
redefines `reconcile_member_location_scope()` to only ever narrow (the 0063
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
action, refuses a relinked Google connection or a changed approval policy,
and fails closed on a supplied security version, generation id or entitlement
until those mechanisms exist (P02-S9, P03-S2/P07-S2, P07-S1 wire them in). A bulk assignee must pass the same
recheck for the review's location (`assignee_not_eligible` otherwise).
Bulk approve (`app/api/reviews/bulk/route.ts`) names, per row, the draft and
review update time the operator was shown; `recordApprovalDecision` refuses
a moved draft (`approval_draft_changed`) or review (`review_changed`) before
anything is recorded. Row outcomes are truthful about the two commits an
approval spans (`lib/server/review-bulk-outcome.ts`): `skipped`/`failed`
before the decision commits, `approved_not_published` or `uncertain` after it,
and an unexpected fault on one row is that row's outcome, not the batch's.

Two-person approval holds on every publication path. For replies,
`has_qualifying_approval` (`lib/server/publishing/intent.ts`) counts only an
approval of the same draft by someone who is neither the requester nor the
draft's author, and `recordApprovalDecision` refuses the author up front. For
posts, `gbp_local_post.content_revision` (0062) is bumped by a trigger
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
the decision it went out under (`approval_decision_id`).
`tests/route-authorization-contract.test.ts` scans `app/api/**/route.ts` so
every session mutation declares non-viewer `roles`, calls an action guard in
its own handler, delegates through a named call chain that ends in one, or is
on its explicit allowlist.

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
action it is retrying, and `useResourceMutation` hands one to each `mutate`
call. No `lib/api` wrapper forwards that id yet and no editor keeps it for a
retry, so through the UI every attempt is a new intent; resending the intent
on an explicit retry of an uncertain write is a follow-up, and until it lands
only callers that pass `intentId` themselves are deduplicated. `route()`
parses the header into `ctx.intentId` on session routes (400
`invalid_intent_id` when it is not a UUID; cron and public routes ignore it)
and makes it the handler's ambient intent. `x-request-id` stays per-request
correlation.

`runGbpWrite` records the intent in `mutation_operation`
(`supabase/migrations/0067_mutation_operation.sql`) in the same transaction
that claims the attempt, so the receipt exists before anything is sent: actor,
surface, action, location and target, payload hash, expected revision, the
Google connection and its `credential_generation`, and the attempt row it
rides on. Only a surface that passes an `operation` descriptor and whose store
names its table takes part (hours, profile, food menus, place actions, media,
post publish and delete), and only the first such write of a request takes the
ambient intent. Then:

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
(`app/api/cron/retention/route.ts`) and `reapStrandedLocalPosts` /
`settleStrandedLocalPosts` in `lib/server/posts.ts` -- settle the linked
receipts too (`settleOperationsForAttempts`). States are the shared outcome
vocabulary: `confirmed_applied` only after
a verifying readback, `awaiting_confirmation` for a write Google accepted
without one, `rejected` for Google's own 4xx refusal, `uncertain` for an
ambiguous write, otherwise `failed`. `GET /api/mutations/{id}`
(`app/api/mutations/[operationId]/route.ts`) returns the receipt by operation
id or by intent id, so a client that lost the answer can ask what happened;
a receipt follows its location's visibility. `approval_ref`,
`security_version` and the recovery columns are reserved for later slices.
`recheckAuthorisation` (`lib/server/authz/actor.ts`) takes the recorded
`google_connection_id` and `connection_generation` together: a relink to
another connection is `connection_changed`, the same connection holding
another credential is `generation_changed`, and a generation without its
connection id is refused, since the counter is per connection.

A module's own pre-dispatch checks still run before `runGbpWrite`, so a replay
after success can be answered by them first (hours and menus answer `in_sync`;
a stale snapshot answers its 409), never by a second dispatch.

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
migrated modules kept their previous behaviour; `"readback"` is used wherever a
readback exists (hours, profile, food menus, post publish and post delete),
because ambiguous writes are read before any retry.

The transport (`lib/server/google/transport.ts`) decides which provider errors
are ambiguous. In mutation mode it raises `GoogleMutationAmbiguousError` for a
network failure, a timeout, a 408 or 5xx, and for a 2xx whose body cannot be
read, is empty (except for a `DELETE`), is not JSON or does not parse: the
request was dispatched and accepted, so the write may have landed
(`classifyMutationFailure` kind `decode` in `lib/domain/retry.ts`). A non-2xx
with an unreadable body is still classified by its status, so a 4xx stays
`failed`. A caller that checks the success shape itself (a create without the
new resource's `name`) raises the same error rather than a plain failure.

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
