# Operations runbook

## Deployment gate

CI's required check `CI result` covers lint, typecheck, unit tests, the
build, migrations (append-only policy, from scratch, upgrade from `main`,
concurrent runs), integration and e2e. Each runs against a disposable
PostgreSQL 17 through the runtime test role. See `docs/ci.md`. Locally, run
`pnpm verify:full` for the same checks minus e2e.

Production migrations are **manual**: Vercel's build runs only
`next build --webpack`, and Production has no `DIRECT_DATABASE_URL`. The
operator runs `DIRECT_DATABASE_URL='<admin url>' pnpm db:migrate` and
`pnpm db:status` from their own machine, using the direct or session-pooler
(5432) URL; `db:migrate` refuses port 6543. Migrations must be expand-only
(backward compatible with the live deployment). When the new code needs the
new schema, migrate before merging. Destructive changes go in a later PR. The
full procedure is in `docs/ci.md`, "Migrations".

Confirm
the Supabase project URL/publishable key, email confirmation and recovery
templates, redirect allow list, custom SMTP, Google OAuth redirect URI, Pub/Sub
OIDC audience/service account, optional verification token, cron secret, and
Workers AI account, API token, and GLM model in the deployment environment
(see [Workers AI activation](workers-ai.md)). Never log environment values
or decrypted Google tokens.

Before a canary, confirm `DRAFTS_ENABLED`, `PUBLISH_ENABLED`, `SYNC_ENABLED`,
`WEBHOOKS_ENABLED`, `JOBS_ENABLED`, `SEMANTIC_VERIFY_ENABLED`,
`RETENTION_ENABLED`, and `RETENTION_DELETES_ENABLED`. Roll back to read-only by
disabling publishing and drafting first; pause sync/webhooks only when data
ingestion itself is unsafe. `WORKERS_AI_TIMEOUT_MS` is capped at 55000; a larger
value fails environment validation at startup, because the database kills a
connection left idle in a transaction for 60 seconds and the caller would see an
opaque 500 rather than a provider timeout.
Database migrations are roll-forward-only. Before a migration rollout, capture
a restorable database snapshot and note the currently deployed Vercel
deployment. If the migration or post-migration verification fails, restore the
snapshot and promote that exact previous deployment as one rollback unit; do
not run ad-hoc down migrations.
Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the production collector. Next.js request
spans, tenant-scoped database spans, Google provider spans, latency/outcome
histograms and redacted structured error logs use the `nabapresence` service name.
Set `NEXT_OTEL_VERBOSE=1` temporarily when deeper framework spans are needed.

## Kill switches

Every flag is read once per process — `getServerEnv` parses `process.env` on
first use and memoises it — so flipping one takes an environment change **and** a
redeploy. None of them is a hot switch, and none takes effect on a running
process. When background provider traffic has
to stop faster than a redeploy, disable the project's Cron Jobs in the Vercel
dashboard (or the single cron for the offending tick) instead:
that halts all eight ticks — the jobs runner, reconciliation, retention,
presence-resource reconciliation, the provider-deletion sweep, the
performance/keyword ingests and the health/notification tick — in one step,
and loses no work. Each queue keeps
its due rows, and every tick starts at the head of a stable
organisation order, so a stopped walk repeats work rather than skipping it:
nothing about the walk position survives between ticks.
Interactive routes keep serving while it is down, and `schedulerHeartbeatAt`
plus every entry in `schedulerTicks` goes stale and pages: silence those alerts
deliberately.

| Flag                        | Off means                                                                                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DRAFTS_ENABLED`            | The drafts route returns 503 `drafts_paused`.                                                                                                                                                                                                        |
| `SEMANTIC_VERIFY_ENABLED`   | Verification runs its deterministic checks alone. Use this, not `DRAFTS_ENABLED`, during a Workers AI incident: a hand-written reply is still saved and still faces the human boundary.                                                                 |
| `PUBLISH_ENABLED`           | No reply or post reaches Google, from the interactive routes or from the runner's publish work.                                                                                                                                                      |
| `SYNC_ENABLED`              | No review ingestion, from the push route or from the runner's webhook and checkpoint work.                                                                                                                                                           |
| `WEBHOOKS_ENABLED`          | The Pub/Sub push route stops accepting deliveries. Google retries, then dead-letters.                                                                                                                                                                |
| `JOBS_ENABLED`              | The background runner claims nothing at all. Due work accumulates and drains when it is turned back on. `PUBLISH_ENABLED` and `SYNC_ENABLED` narrow the same claim by job kind rather than stopping it.                                              |
| `RETENTION_ENABLED`         | The retention sweep returns 503 `retention_paused` and deletes nothing. The scheduler reads this one too and registers no retention tick, so a paused deployment logs no failing run.                                                                |
| `RETENTION_DELETES_ENABLED` | Retention keeps redacting expired provider content but performs no irreversible delete. Prefer this to `RETENTION_ENABLED` when the concern is a suspect delete predicate rather than the sweep itself, so the redaction obligation keeps being met. |
| `NOTIFICATIONS_ENABLED`     | The health tick returns 503 `notifications_paused`: no incidents are evaluated and no alert email is sent. |
| `GOOGLE_RATE_BUDGET_ENABLED` | Google calls stop drawing from the shared Postgres budget and fall back to per-process pacing only. For a suspected budget fault, not a quota incident. |
| `RISC_ENABLED`              | The RISC receiver answers 404. Revocations are then detected only at the next refresh or API call. |

Pause the narrowest switch that covers the failure. A paused flag is not a fix:
record why it is off and land the correction, because backlogs accrue behind
`JOBS_ENABLED` and `SYNC_ENABLED` for as long as they are down.

The runner enforces all three of its flags at the claim, not inside the work:
`claim_due_jobs` takes the permitted job kinds as an argument, so a paused kind
keeps its status and its `next_attempt_at` untouched. A tick that is claiming a
reduced set logs `jobs.kinds_paused` with the flags responsible. Nothing is
re-armed, and no retry or recovery budget is spent, while a flag is off.

## Scheduled work

- Production background work runs as eight Vercel Cron entries in
  `vercel.json` (times UTC): `/api/jobs/run` every minute, `/api/sync/reconcile`
  and `/api/sync/presence-resources` every 15 minutes (staggered by 7 minutes),
  `/api/cron/health` every 15 minutes, `/api/sync/performance` every 6 hours,
  and `/api/sync/sweep`, `/api/sync/keywords`, `/api/cron/retention` once
  daily, staggered across 01:30–03:00. Each cron fires an HTTP GET at the
  route's cron-authenticated `GET` handler. `CRON_SECRET` must be set on the
  Vercel project: Vercel sends it as the `Authorization` bearer automatically,
  and without it every tick answers 401 `invalid_cron_token`.
  `tests/server/vercel-cron.test.ts` pins the table so a quiet edit cannot
  drop a tick. Minute and 15-minute schedules need a Vercel plan that allows
  them; confirm the project's plan before relying on the cadence.
- **Reconcile, performance and keywords are a queue (0048).** Their cron GET
  does no sync work: it calls `ensure_recurring_checkpoints(kind)`, which
  gives every actively linked location in every organisation a checkpoint of
  that kind in one statement, under the kind's lease (which stamps its
  heartbeat). The minute job runner claims whatever is due through
  `claim_due_jobs` — the same per-organisation cap
  (`JOBS_PER_ORGANISATION`), lease and time budget as every other job — and
  skips locations whose login is waiting on a reconnect. A success books the
  next run on the kind's grid from the slot it was due in
  (`next_scheduled_run`: reconcile every 15 minutes, performance every 6
  hours, keywords daily); a run more than one interval late runs once and
  rejoins the grid rather than replaying the missed slots. A failure backs off
  on consecutive failures (reconcile never dead-letters on transient errors;
  only a permanent failure — an unverified or deleted location — retires it).
  Measured locally: 150 organisations reconciled within 3 one-minute ticks and
  swept within 4 (`tests/integration/routes/fleet-scale.test.ts`, production
  runner defaults, 240/min shared budget).
- The owner/admin session POST of `/api/sync/reconcile`, `/performance` and
  `/keywords` still runs its own organisation inline, and the bearer POST
  still walks pages for `scripts/scheduler.mjs` (local and non-Vercel
  deployments). Only presence resources still resume a cursor on the Vercel
  path (`cron_cursor`); a null cursor means the walk finished, and a cursor
  three fires in a row could not finish is abandoned for the head.
- The daily sweep does not page. `/api/sync/sweep` (cron) calls
  `enqueue_sweep_checkpoints`, which arms a `sweep` checkpoint for every
  linked location in every organisation in one statement, under the
  `naba:sweep` lease (heartbeat `sweep`, stale after two days). The job
  runner claims them every minute, five pages per claim; a location with more
  history parks with its cursor and resumes on the next day's enqueue. A sweep
  that finished within 20 hours is not re-queued, and `dead` checkpoints wait
  for a person.
- Vercel does not retry a failed cron fire and may occasionally deliver a fire
  twice or drop one. The ticks are safe under all three: every route holds its
  own advisory lock, so an overlapping or duplicate fire answers `skipped`
  (`reason: "lease_held"`) instead of doing the work twice, and a missed fire
  only delays work — each queue keeps its due rows and the next fire starts at
  the head. A steady stream of `lease_held` skips means a tick is overlapping
  itself: lengthen that cron's interval, do not remove the lock.
- Pausing `GBP_PERFORMANCE_ENABLED` or `GBP_KEYWORDS_ENABLED` does not stop
  the cron calling that ingestion route. Each organisation in the page
  fails with 503 `sync_paused` and logs `performance.organisation_failed` /
  `keywords.organisation_failed`, so expect one error line per tenant per tick
  for as long as the pause lasts. Nothing is claimed, re-armed or lost by it;
  read the flood as the pause, not as an incident.
- Presence resources and retention are bounded by a per-page budget
  (`PRESENCE_RESOURCE_BUDGET_MS`, `RETENTION_BUDGET_MS`, 45000 by default), as
  are the session and scheduler POST paths of reconcile, performance and
  keywords (`RECONCILE_BUDGET_MS`, `PERFORMANCE_BUDGET_MS`,
  `KEYWORDS_BUDGET_MS`). The runner's own tick budget is 45 seconds inside a
  60-second function.
- **Google request budget (0049).** Every Business Profile call first takes a
  slot from `google_rate_bucket`: per API host
  (`GOOGLE_API_REQUESTS_PER_MINUTE`, 240) and, for a write, per location
  (`GOOGLE_LOCATION_EDITS_PER_MINUTE`, 8) for Business Information writes.
  API windows are 10 seconds and edit windows one minute, sized so any
  rolling minute stays under Google's 300 QPM and 10 edits/min. Review
  replies, posts and media draw only on their API's budget. A 429 from
  Google blocks that bucket for every instance until its `Retry-After`. Work
  that cannot get a slot before its deadline fails with the retryable
  `google_rate_limited` and is retried a minute later without spending its
  failure cap. Sustained pressure shows as `googleQuota` in platform health
  and opens a `google_quota_pressure` operator incident.
- Alert on failed sync checkpoints, connections in `expired`/`error`, publish
  attempts in `ambiguous`, and unprocessed webhook events older than five
  minutes.
- Poll `GET /api/operations/health` from an owner/admin observability context
  or poll `GET /api/operations/health?scope=platform` with the cron bearer
  credential. Route page-severity alerts to the on-call service and
  ticket-severity alerts to the operations queue; exact thresholds and fields
  are in `docs/observability.md`.

### Jobs runner

The every-minute Vercel Cron normally invokes `GET /api/jobs/run` with the
cron bearer (Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically).
During an incident, first inspect the
platform health payload and tenant-scoped
`GET /api/webhooks/google/pubsub/failures`. A jobs run is idempotent and can be
triggered manually with the cron credential after the underlying dependency is
healthy. Never delete failed work to make a dashboard green.

Every claim takes a row-level lease rather than a transaction lock, so a tick
that is killed mid-item strands nothing: the next tick's `reclaim_expired_jobs()`
returns the row to its claimable status and logs `jobs.leases_reclaimed` with a
count per kind. A reclaim costs no retry budget. Repeated reclaims of the same
kind mean items are outliving the lease (the tick budget plus 60 seconds), not
that they are failing.

For failed webhook events, correct routing/token/provider health and run the
jobs worker. After five failures the event becomes `dead`. Only its failure
history survives — the push route stores a `payload_hash` and never the payload
itself, so there is nothing to preserve and no way to reconstruct the body from
this system. Correct the cause, then use the authenticated replay route for the
selected event. Replay does not re-deliver: it moves that same row back to
`failed` with `retry_count = 0` and `next_attempt_at = now()` and answers 202,
and the jobs runner does the work on its next tick — so replay is inert while
`JOBS_ENABLED` or `SYNC_ENABLED` is off. Confirm the row reaches `processed`;
do not bulk-replay an unbounded dead-letter set.

Ambiguous publish attempts are claimed automatically by the jobs worker. It
reads the provider state, compares the intended reply body, records an
`ambiguity_checked` event, and settles the attempt without blindly repeating a
write. A readback that itself fails is rescheduled on its own back-off (2s to
5min) and counted; after eight such failures the attempt is settled `failed`
with `provider_error_code = 'recovery_exhausted'` and audited as
`review.reply.recovery_exhausted`. The ceiling is enforced twice — in the
settle and as `recovery_attempts < 8` inside `claim_due_jobs` — so an exhausted
attempt stops taking a claim slot even if a settle is lost to a crash.

A recovery blocked on a revoked, expired or reconnect-pending Google grant is
parked instead: it waits 15 minutes and looks again, and spends none of the
eight-attempt budget, because only a person can end that outage. Reconnecting
the same Google account revives the connection in place, so the park is
correct rather than merely lenient. It is bounded in time rather than attempts
— an attempt still blocked 14 days after it started is settled `failed` with
`provider_error_code = 'reconnect_abandoned'` and audited as
`review.reply.reconnect_abandoned`.

A grant the tenant *disconnected* is not parked at all: nobody is coming back
to it, so the attempt is settled `failed` immediately with
`provider_error_code = 'connection_disconnected'` and audited as
`review.reply.connection_disconnected`.

None of the three terminal settles touches the reply: `ambiguous` means the
write may have landed at Google, so failing the reply would assert a state
nobody observed. The audit row is the operator's handle. Search for
`review.reply.recovery_exhausted`, `review.reply.reconnect_abandoned` and
`review.reply.connection_disconnected`, read the live reply on Google, and
settle the review by hand.

If automatic work is blocked, an engineer may invoke the exported
`recoverAttempt({ organisationId, attemptId })` escape hatch from
`lib/server/publishing.ts` in a controlled one-off process using the runtime
role. Capture the result and attempt-event sequence. Never change an ambiguous
row directly.

Every authenticated jobs run updates the `scheduler` row in `ops_heartbeat`,
including a run that claims nothing because a kill switch is off: the heartbeat
means "the scheduler reached the web process", so a pause must not read as a
dead scheduler. A missing heartbeat or one older than five minutes pages
on-call. Verify the scheduler process, web reachability, matching cron secrets,
advisory-lock holders, and database connectivity, then run one manual jobs tick
and confirm the heartbeat advances.

### Retired sync checkpoints

A checkpoint that keeps failing is retired rather than re-driven forever, by
two different mechanisms, and neither comes back on its own.

Review checkpoints (`backfill`, `sweep`, notification syncs) go to
`status = 'dead'` after ten consecutive failures, or immediately on a failure
no retry can fix (`location_not_verified`, or a Google 404/410). An audit row
`sync.checkpoint.dead` records the error code and the failure count. Every
claim predicate is an allowlist, so a dead checkpoint leaves the retry window
entirely — it also leaves `dueJobBacklog`, and it appears in the backfill
progress counts as `dead`.

Metric checkpoints (`performance`, `keywords`) stay `failed` and set
`dead_lettered_at` after five consecutive failures — the webhook ceiling, not
the review-checkpoint one — with `next_attempt_at` null. The analytics surfaces
keep reporting `last_error_code` as the unavailable reason.

To recover either, fix the cause at Google first, then:

- review checkpoints — start a backfill for that location
  (`POST /api/sync/backfill` with its `externalLocationIds`, or the settings
  backfill card). That moves the row back to `running`. The consecutive-failure
  count is only reset by a successful run, so a checkpoint that fails again
  immediately retires again immediately: that is the signal the cause is not
  actually fixed.
- metric checkpoints — relink the location. `location_link` going active again
  is the explicit "try again": it clears `dead_lettered_at`, resets the
  counter, and re-arms the checkpoint as `pending`.

## Incidents

### Email/password authentication failures

Keep Google connections intact; they belong to organisations and are not user
login sessions. Verify Supabase Auth health, the publishable key, redirect allow
list, confirmation/recovery templates, custom SMTP delivery, and provider rate
limits. Do not bypass email verification or manually set password hashes.

### OAuth or token refresh failures

Disable new connects if failures are global. Verify the Google project, consent
screen, redirect URI, client secret, and API access status. Individual expired
connections should be reconnected; never ask a customer to send a refresh token.

Connection states as people see them (`lib/server/google/connections.ts`):

| State | Stored as | Who acts |
|---|---|---|
| Active | `active`, no `last_error_code` | nobody |
| Degraded (Data delayed) | `active`/`expired` with `last_error_code`, no reconnect task | nobody: the platform retries |
| Needs reconnect (Action needed) | `revoked`, or `expired` **with** an open reconnect task | an owner/admin, from the banner |
| Disconnected | `disconnected`, tokens null, `purge_due_at` set | nobody |

A listing whose manager access was removed at Google is `external_location.
access_state = 'access_lost'`; the connection stays active and its other
listings keep syncing. Reconnecting does not fix it — the business must add
the login back as a manager.

An `invalid_client` from the token endpoint (a rotated client secret) or a 403
with `SERVICE_DISABLED` / `ACCESS_NOT_CONFIGURED` (`google.operator_
configuration_error` in the logs) is an operator fault that hits every tenant:
fix the Cloud project, do not ask customers to reconnect.

Reconnect never revokes the refresh token it replaces: Google revokes a grant
per user and project, so revoking the old token would also kill the new one.
Only a deliberate disconnect calls Google's revoke endpoint; its outcome is
kept on the row (`google_revocation_status`). To confirm a revoke, send the old
refresh token to the token endpoint and expect `invalid_grant` — Google does
not document tokeninfo for refresh tokens.

### Notifications and alert email

The health tick (`/api/cron/health`, every 15 minutes, heartbeat `health`)
turns tenant state into `notification_incident` rows and emails each new
incident once to the organisation's owners and admins:
`connection_reconnect`, `listing_access_lost`, `listing_stale` (no successful
check for `LISTING_STALE_AFTER_HOURS`), `low_rating_review` (3 stars or fewer,
rating and listing only) and `connection_owner_left`. Operators
(`OPS_ALERT_EMAILS`) get `platform_incident` mail for a tick that used to run
and stopped, and for sustained Google 429s. Without `EMAIL_PROVIDER`,
deliveries are recorded `suppressed` (`provider_not_configured`) — check
`notification_delivery.status` before telling anyone an email went out. A
delivery is unique per incident and recipient and is claimed before the send,
so re-running the tick never double-emails.

### Rotating the token encryption key

1. Generate a new 32+ character secret. Set
   `TOKEN_ENCRYPTION_KEYS="<new>,<current TOKEN_ENCRYPTION_KEY>"` and deploy.
   New writes now use the new key (format 0x02); everything old still reads.
2. `POST /api/operations/reencrypt` with the cron bearer and
   `{"dryRun": true}` to count what is left, then without `dryRun`, repeated
   until the response says `"complete": true`. Each call resumes; rows are
   compare-and-set, so live refreshes are safe. `failed > 0` means a row no
   configured key opens: stop and investigate before retiring anything.
   `organisationIds` limits a pass to chosen tenants for a staged rotation.
3. Set `TOKEN_ENCRYPTION_KEY=<new>`, `TOKEN_ENCRYPTION_KEYS=<new>` and
   deploy. Confirm a dry run still reports complete and a refresh works.
4. Rollback: once step 1 is deployed, rows written in format 0x02 can only be
   read by builds that include key rotation (`feat/connect-once-hardening`
   and later). Roll back only to such a build, keeping both keys configured;
   never to an older build. Until `TOKEN_ENCRYPTION_KEYS` is set nothing is
   written in the new format, so deploying this code alone changes nothing on
   disk.

OAuth state has its own secret: set `OAUTH_STATE_SECRET`, deploy, and after
the deploy has been live for more than ten minutes set
`OAUTH_STATE_ACCEPT_LEGACY=false`.

### RISC (Cross-Account Protection)

`POST /api/webhooks/google/risc` is live in code but receives nothing until
the stream is registered: enable `risc.googleapis.com` on the Cloud project,
accept the RISC terms, create a service account with
`roles/riscconfigs.admin`, and call `stream:update` with the receiver URL and
the events `token-revoked`, `tokens-revoked`, `account-disabled`,
`account-purged` and `verification`; then `stream:verify` and look for a
`risc_event` row with outcome `verification`. Refresh-time `invalid_grant`
and API 401s remain the fallback (RISC skips Workspace users and retries
delivery only a few times).

### Platform sessions

Sessions slide to `SESSION_IDLE_DAYS` (14) of inactivity and end
`SESSION_ABSOLUTE_DAYS` (90) after sign-in. "Sign out everywhere" (account
menu, `DELETE /api/session?scope=all`) ends every session the person has in
every organisation. None of this touches Google connections or background
sync. MFA for owners and admins is a Supabase Auth feature still to enable.

### Pub/Sub delivery failure

Verify the push URL, OIDC audience, issuer and pinned service-account email,
inspect the subscription backlog/dead-letter topic, then re-arm a selected
failed event through `POST /api/webhooks/google/pubsub/replay` — which queues
it for the jobs runner rather than syncing it inline — or run tenant
reconciliation. Reconciliation is the more reliable repair for a delivery gap,
because a notification that never arrived has no row to replay. Use the
failures listing route and dead-letter procedure above to ensure retries are
bounded and auditable. Keep publishing available only if review freshness is
trustworthy.

### AI provider degradation

The symptom that brings you here: with the flag still on, verification attempts
the semantic pass, the provider 429s or 5xxs, and the draft is saved with
verdict `pending` and a `semantic_verification_unavailable` warning. The text is
never lost, but `pending` is not publishable — publishing answers
`verification_required` — so replies pile up unsent.

Set `SEMANTIC_VERIFY_ENABLED=false` and restart. Generation stays unavailable
while the provider is down, but the semantic pass is then deliberately skipped
rather than attempted, so a human-authored reply is verified by the
deterministic checks alone, settles `pass`/`warn` and can be published. Do not
reach for `DRAFTS_ENABLED=false`: it takes away the hand-written path as well.
Drafts already parked at `pending` need re-verifying after the restart; the flag
does not retro-settle them. Never raise `WORKERS_AI_TIMEOUT_MS` above 55000 to ride
out latency — the schema rejects it, and the database would kill the connection
first.

### Quota storm

The shared budget already holds every instance under the configured rate and
honours `Retry-After` fleet-wide. If `google_quota_pressure` keeps opening:
lower `GOOGLE_API_REQUESTS_PER_MINUTE`, pause backfills, retain notification
ingestion, and check the project's quota in the Cloud Console (a quota of 0
means API access is not approved).

### Ambiguous publish

Do not immediately repeat the write. Allow the jobs worker to read Google,
compare the intended body, and settle the attempt. Use the controlled
`recoverAttempt` escape hatch only when the worker cannot progress, and confirm
the `publish_attempt_event` sequence before re-enabling writes.

### Tenant-isolation anomaly

Disable affected endpoints, revoke active sessions/support grants, preserve
database and request logs, and treat the event as a security incident. Do not
continue normal operations until the RLS context path is validated.

## Current environment note

The default development database is the Supabase CLI stack running in Docker.
Start it with `pnpm supabase:start`; the CLI applies the committed
`supabase/migrations` chain to PostgreSQL 17. The database is available on
`127.0.0.1:54322`, the local API on `127.0.0.1:54321`, and Studio on
`127.0.0.1:54323`. `pnpm supabase:reset` is destructive to local data.

There is no second, production-topology stack to fall back on. The Docker
Compose stack that once served that purpose has been deleted: production runs
on Vercel, so the Supabase CLI stack above is the only local environment.

## Production database

Production runs on the Supabase project `googlereview-gbp` (ref
`znbjmipdiuzymxytyjvr`, us-east-1, PostgreSQL 17). It sat paused on the free
plan for months, and a paused project's hostname stops resolving: that was the
`ENOTFOUND` / NXDOMAIN every DB-backed production request failed with. It was
restored in September 2026. A free project pauses again after a week without
activity; the every-minute cron keeps it busy, but move it to a paid plan
before relying on it. The project still held the Prisma-era schema (25
tables, 1,040 reviews, 3 July 2026); those objects were moved, not dropped,
into the `legacy_prisma` schema, which the runtime role cannot use, after a
dump to `archive/naba-presence-backups/googlereview-gbp-prisma-20260924-*.sql`.
No data is carried over from the local database, which
is shared with sibling projects and holds artifacts no committed migration
defines. Organisations sign up again, reconnect Google, and the
connect-callback backfill re-imports their reviews. The last local snapshot,
kept for reference only, is
`~/LapenInns Project/archive/naba-presence-backups/local-snapshot-20260903.dump`.

Provision in this order:

1. Use a dedicated Supabase project on PostgreSQL 17. Functions run in
   `iad1` (`vercel.json` `regions`) to sit next to the us-east-1 database. From
   Connect, take both pooler URIs. `DATABASE_URL` uses the **transaction
   pooler** (port 6543): a session-mode client pins a backend for as long as
   it stays open, and suspended Vercel instances keep their idle pools open,
   so session mode exhausted the pooler's 15 slots (`EMAXCONNSESSION`) with
   connections nobody was using. `DATABASE_SESSION_URL` uses the **session
   pooler** (port 5432) and serves only the refresh lock and the scheduler
   leases, which are session advisory locks that a transaction pooler would
   release between statements; each lock opens and closes its own
   connection. Startup refuses a 6543 `DATABASE_URL` without it. Resolve the
   hostname and open one test connection before pointing anything at it; the
   last production database died silently as NXDOMAIN and nothing paged.
2. `DIRECT_DATABASE_URL='<admin url>' pnpm db:migrate` until every file in
   `supabase/migrations` is recorded in `schema_migration`, then re-run to
   confirm idempotence (all "already applied") and run `pnpm db:status`. The
   admin role (`postgres`) owns the SECURITY DEFINER functions, which read
   FORCE-RLS tables across tenants, so it must keep BYPASSRLS.
3. Create the runtime login with a generated password — the script's defaults
   are for local tests only:
   `DIRECT_DATABASE_URL='<admin url>' RUNTIME_ROLE_NAME=naba_runtime
   RUNTIME_ROLE_PASSWORD='<32+ random chars>' pnpm db:runtime-role`.
   `DATABASE_URL` and `DATABASE_SESSION_URL` use the same pooler host with
   user `naba_runtime.<project-ref>`. Through that URL, confirm `rolsuper` and
   `rolbypassrls` are false, `row_security` is `on`, and `show
   statement_timeout` is `30s`. The Supabase pooler drops the
   startup parameters in `lib/server/db.ts`, so the script pins
   `statement_timeout = 30s` and `idle_in_transaction_session_timeout = 60s`
   on the role itself. Role settings apply only to new backends: after
   (re)running the script, terminate the role's older pooled backends.
4. Configure Supabase Auth on the same project: Site URL and redirect allow
   list for the production origin, the `supabase/templates/confirmation.html`
   and `recovery.html` templates, and custom SMTP (the built-in sender only
   mails project members). Register
   `<NEXTAUTH_URL>/api/auth/callback/google` on the Google OAuth client and
   publish the OAuth app out of Testing, or every connection dies after seven
   days.
5. Set the production environment with `vercel env add` / `vercel env rm`
   (list names with `vercel env ls`; never `vercel env pull` into
   `.env.local`). Beyond the variables `.env.example` marks as required, set
   `DATABASE_POOL_MAX=5` and `JOBS_CONCURRENCY=3`: every function instance
   opens its own pool, and the sum across instances must stay under the
   transaction pooler's client limit. Lease and refresh-lock connections sit
   outside that pool, one short-lived session-pooler client per held lock. Launch with `WEBHOOKS_ENABLED=false` until the Pub/Sub push
   subscription and its OIDC pair exist (the 15-minute reconcile picks up new
   reviews meanwhile), and with `PUBLISH_ENABLED=false` until one draft has
   been checked end to end. Keep database secrets out of the Preview scope.
6. `vercel --prod`, then smoke: cron-bearer
   `GET /api/operations/health?scope=platform` (backlog unlatched,
   `ops_heartbeat` fresh), one firing of each of the eight crons in
   `vercel.json`, and watch for `lease_expired` (one reclaim burst is
   expected, a stream is not). Deploying also retires the stale five-minute
   `/api/cron/worker` pings: that endpoint exists only in the old build and
   500s on every fire. Then sign up, connect Google, confirm the reviews
   arrive in the inbox, and generate one draft.

## Privacy and disassociation

Disconnect destroys OAuth tokens immediately, cancels sync checkpoints, clears
the Google notification setting where possible, and schedules remaining
external-location cleanup inside seven days. Track access, rectification,
erasure, and restriction work in `/api/privacy/requests`; use
`/api/privacy/export` for retained-content exports. Apply a legal hold only with
an owner-approved reason and release it explicitly. Audit exports are available
as JSON or CSV from `/api/audit-log`.

A legal hold outranks the seven-day disconnect promise, and does so silently:
the retention sweep refuses to delete an external location while any of its
reviews carries an unreleased hold, so that location and its connection row
persist indefinitely. The sweep reports the count as `heldLocationsSkipped` in
its `retention.purge.completed` audit row and in
`retention.organisation_purged`. Watch that number: a non-zero value that never
falls is an unmet deletion obligation waiting on a hold nobody released, not a
purge failure. Releasing the hold lets the next sweep complete the deletion.

## Retired capabilities and service eligibility

`410 provider_capability_retired` is a terminal unsupported operation. Do not
retry or requeue it. Business Calls, healthcare provider attributes, insurance
networks, Q&A and legacy location association must not contact Google. Old
activity records remain historical; their original status is not rewritten.
Call-click metrics remain separate from the retired Calls API.

For `409 eligibility_unknown` on service publication, refresh Business
Information and inspect `capabilityDetails.fields.serviceItems`. Missing or
malformed metadata is not confirmed support or ineligibility. For
`409 location_ineligible`, Google explicitly denied service editing for the
location. Do not override that observation. Neither outcome creates a write
attempt. For `409 business_information_stale`, generate and approve a new
preview from refreshed data.

The catalogue's documentation date, the location observation time and public
Google display are separate evidence. See [provider support](google-provider-support.md)
and the [acceptance register](gbp-operations-acceptance.md) before claiming a
workflow is deployed or live-provider verified.

## Unresolved lodging confirmation

Activity displays request execution and Google confirmation independently.
`accepted / unresolved` means Google acknowledged the write but independent
readback failed or differed. `unknown / confirmed` means the response was
ambiguous but a subsequent read matched the requested fields. Neither proves
public Search/Maps presentation.

Use **Activity → Check Google confirmation** for an unresolved lodging attempt.
This calls `POST /api/locations/[id]/industry` with its `mutationId` and reads
Google without replaying the mutation. An interrupted `started` or `validated`
attempt becomes checkable after five minutes; refresh Activity to see it.
Owner/admin access and current location access are checked again. A changed
Google target returns `409 google_target_changed`; inspect the original target
instead of treating the newly linked listing as evidence for the old attempt.

`409 google_confirmation_unresolved` blocks another lodging write while a prior
attempt is open. Recheck confirmation first. A mismatch remains unresolved and
requires investigation; this increment deliberately provides no force-resubmit
action. Confirmed retries return the recorded result. Later explicit conflict
resolution and automated recovery are still tracked as open
programme work. Do not mark an unresolved attempt successful merely to clear
the guard.

## Service metadata preflight

Apply migration `0060_business_information_change_sets` before deploying the
service approval endpoints. Business Information PUT saves a review with the
exact payload, update mask and current Google hash. POST accepts its
`changeSetId` and `expectedPayloadHash` for approval; every location-update PATCH must carry
that change-set ID and the unchanged reviewed payload, mask and baseline hash.

Attribute updates now also require an approved change-set ID. The profile editor
saves an attribute review before opening its publish sheet. Saved attribute
reviews allow another authorised manager to approve the exact change when the
organisation requires two people. Attribute approval requests identify
`resourceType: attributes`; previews persist the attribute array and selected
mask. Publication rechecks metadata and the saved Google baseline. A stale
baseline requires a new review; it is never silently refreshed during publishing.
Unresolved attempts are checked through Activity using GET-only provider readback.
The two-person policy applies. Material edits, changed policy or revoked actors
require a fresh review. Repeat submission of the same approved intent returns
the stored attempt; it does not repeat a provider write.

The profile editor persists reviews for store codes, labels, categories,
addresses, open status and opening dates. Saved profile reviews are available
to another authorised manager for two-person approval. Their frozen payloads
are independent of the current local draft. A changed draft or baseline closes
the publish path until a fresh review is prepared. Approved Google fields run
before the existing core-profile steps; a later conflict remains a partial
outcome and must be refreshed and reviewed, not silently rebased.

Unreviewed location updates return `409 approval_required`. Attribute writes
and canonical core-profile writes still use their separate existing workflows;
their persisted-approval migration is not implied by this change.

GET with `type=reviews` returns the latest 20 unexpired Business Information
reviews that have no execution attempt. It reads persisted data without calling
Google and requires current owner/admin publishing access to the location.
The response preserves the original payload, baseline, hashes and approver
identity. Retrieving a review does not renew its expiry or verify that its
baseline remains current; execution performs those checks.

For eligible listings, Business profile now includes a Services section. Edit
the desired service, use Clear price or Clear description for an explicit removal, then Review
service changes. The review is persisted before publication. Under two-person
approval, another authorised owner/admin opens the saved service review to
approve it. Changing the draft does not change that saved review. Services use
their own review; the profile footer routes service-only edits to it, and Save
here does not save service changes. A confirmed outcome requires independent
Google readback; an unconfirmed attempt directs the operator to activity.
The initial editing flow, second-person saved-review reopening, stale rejection,
saved-draft restoration and unconfirmed outcomes have fixture browser coverage.
Saved service drafts are offered only after their shape is validated; unfinished
inputs can be restored but must pass publication validation. Other edge states,
full keyboard journeys and eligible live-account acceptance remain under test.

Service metadata errors require a fresh review: `service_categories_unknown`
means current categories could not be established; `service_metadata_incomplete`
means Google omitted a requested category; `service_not_supported` means a
changed service no longer matches the selected categories. Do not invent an ID
or substitute a category. `service_baseline_unsupported` means existing provider
fields cannot be preserved by the current typed editor. Use Google or wait for
the contract to support those fields. None of these preflight failures submits
a provider mutation.

For approved service changes, a differing readback records
`google_readback_mismatch`, execution `accepted` and confirmation `unresolved`.
This includes Google retaining a price or description that the reviewed
replacement removed. A successful mutation response does not confirm clearing.
Service order alone does not constitute a mismatch; duplicate counts and all
supported item fields do. Older attempts may retain the earlier
`business_information_readback_mismatch` error.

Open Activity and use Check Google confirmation on an eligible approved profile
attempt. This POST sends only the stored mutation ID; the server checks current
manager access, tenant, linked Google account and location, and reads Google
without resending the mutation. It retains the original acknowledgement and
records the new independent observation. A mismatch or failed read stays
unresolved. An interrupted started/validated request is eligible after five
minutes. A confirmed attempt returns its stored result on repeated checks.
Readback remains available when new publishing is paused. Historical profile
attempts without a persisted change set are not enabled for this recovery path.

Core profile phone publication sends the `phoneNumbers` parent with both the
required primary number and the preserved additional-number list. Google's
PhoneNumbers contract disallows updating either phone field with a leaf mask.
The reviewed Google hash includes additional numbers, and independent readback
checks they survived. An empty primary number returns `primary_phone_required`
before a provider write. Description publication continues to use
`profile.description`. The Additional phone numbers section supports editing,
adding up to two numbers and removing specific entries. Select Add number to
include a typed new number in the draft. Review changes saves the full collection
for approval; Saved profile reviews lets an authorised colleague review it.
Removing every additional number still preserves the primary. An empty edited
number must be corrected or explicitly removed. Authorised Google acceptance
remains pending.

Address edits from the profile editor select individual street-line, town,
postcode, district or county fields rather than replacing `storefrontAddress`.
Unselected provider components remain outside the update mask, including fields
the editor does not expose. Reviews name the selected component. A requested clear is confirmed
only when that value is empty or omitted in independent readback; a retained
value stays unresolved and can be checked again without another write. Removing
individual components is not the same operation as removing the storefront
address for a service-area business.

District/neighbourhood and county/region are optional controls in Address.
Existing values are loaded and retained in restored drafts. Leaving an existing
value blank produces a specific clear in review; leaving an absent value blank
does not create a change. Google still validates whether the proposed address
is acceptable before publication.

Service-area API previews and execution require a customer-only conversion to
include `storefrontAddress: {}` and the `storefrontAddress` mask in the same
approved change. An existing service-area country cannot be changed. Customer-only
businesses cannot publish storefront address components. A retained address after
an accepted clear is unresolved; check confirmation again to perform a GET-only
recovery. Service-area confirmation also checks the exact place-ID/name set, so
retained removed places cannot count as confirmed. Local place-ID checks validate
format only; Google validation and readback establish separate provider evidence.
The profile's Service area section shows existing names and place IDs. Choose
where customers are served, remove specific existing areas or enter a name and
place ID and select Add service area. At most 20 areas are supported. The existing
country is locked. A customer-only conversion requires selecting the storefront
removal checkbox; its address removal appears alongside the area changes in
review. Address fields are disabled while the draft is customer-only. Saved
profile reviews support these changes and the organisation's second-approver
policy. Unknown provider fields disable service-area editing with a Google
handoff, preserving them rather than replacing the parent object.

Relationship updates support separate chain affiliation, parent-business and
child-business masks through the business-information API. A selected field must
be explicitly present in the approved payload; other relationship siblings remain
outside its update mask. Empty chain text, an empty parent object or an empty
child collection express a clear. Retained values remain unresolved after provider
acceptance, and confirmation retry only reads Google. Unknown fields prevent
replacing the affected parent object. In the profile's Chain affiliation section,
search by name, then select an exact returned chain. The draft retains its resource
ID; search results alone do not establish affiliation. Remove affiliation creates
an explicit clear in review. Failed searches remain distinct from empty results;
Search or Enter retries the same query. Restored drafts retain their exact chain
ID without requiring another search. Unsupported existing chain resources are
read-only with a Google handoff.

In Related businesses, enter the exact parent or child place ID and explicitly
choose Department or Independent business at the same address. Set parent business
replaces the draft parent; Add child business retains existing children and rejects
duplicate IDs. Remove targets only the indicated relationship. Removing the last
child or parent produces an explicit clear in review. These controls preserve the
chain affiliation and unsupported siblings. Unknown fields within a selected
parent or child collection lock that control with a Google handoff. Saved drafts
restore exact IDs and relationship types. Local format validation does not prove
Google accepts the relationship, and fixture coverage is not live acceptance.

The profile's Google Ads phone section edits the alternate phone number for
Google Ads location extensions. It is separate from the public primary/additional
phone collection. Enter the full number, review the exact change and publish.
Blanking an existing value creates an explicit advertising-override clear;
leaving an absent value blank makes no change. Unsupported advertising data locks
the control with a Google handoff. Accepted clears remain unresolved while Google
still returns the old override; confirmation retry reads state without resending.
Provider confirmation does not establish that an advertisement is publicly
displaying the number.

Open Additional address details within Address to edit the postal address's
language, organisation and recipient lines. An unknown language stays blank;
language tags are checked locally, without changing the immutable profile
language. Recipients are ordered, one per line. Each changed field has its own
review row and update mask, and blanking an existing value creates an explicit
clear. These controls also participate in draft restoration and saved reviews.
The sorting-code control appears for an existing value or the documented country
examples France, Jamaica, Malawi and Cote d'Ivoire; a new UK address does not
show it. This is separate from the postcode. Malformed provider values disable
the affected control with a Google handoff. Provider validation remains required.
The postal schema revision is fixed at zero and is not an editable business field.

## Account-scoped onboarding

Category discovery is available before any location is linked through
`GET /api/google/accounts/[accountId]/categories`. Supply `connectionId`, optional
connected `clientId`, `regionCode`, `languageCode` and a nonempty `query`; pass the
returned `nextPageToken` as `pageToken` to continue with the same search. Each page
contains at most 100 category IDs and display names. The route checks local access,
fresh Google account access and local access again after the provider response.
An unavailable or malformed response remains an error, not an empty choice list.
Google matches the start of the category name, not its ID; region and language are
explicit per its [category API](https://developers.google.com/my-business/reference/businessinformation/rest/v1/categories/list).
Setup's business draft now includes this category search. Choose **Set primary**
for the business's main category and **Add category** for up to nine additional
categories. **Load more categories** continues the search. Changing the primary
category preserves unrelated additional choices and removes any duplicate of the
new primary. **Clear selected categories** removes the draft selection; saving
and choosing categories do not publish a listing. Save changed details before
running the matching search again.

The account-scoped onboarding matching API is available at
`POST /api/google/accounts/[accountId]/matches`. It requires the selected
`connectionId`, an optional connected `clientId`, and either
`search: { kind: "query", query: "..." }` or
`search: { kind: "location", location: { title: "...", ... } }`.
`pageSize` is bounded to 1-10, with 10 as the default. It works before any app
location is linked. Owners/admins must select an active discovered account;
Google account access is freshly checked. Search failure must be retried or
resolved, never interpreted as permission to create. Returned matches and ownership
handoffs are potential matches only. This backend does not create or link a listing;
creation execution and link recovery use the separate endpoints described below;
setup's Listings step now includes saved drafts, basic details, matching and
creation-outcome recovery, creation decisions, exact review, approval and submission.
Full business-type creation details and direct accessible-match linking remain
under implementation.

Onboarding drafts are persisted independently of linked locations. Create one with
`POST /api/google/accounts/[accountId]/drafts`, providing `draftId` (a client-generated
UUID retained across request retries), `connectionId`, optional `clientId`, and a
typed `payload`. An incomplete payload is allowed while drafting; saving it is
not provider validation or approval. The server generates a separate immutable
`providerRequestId`. A deliberately separate draft uses a new `draftId` and receives
a different provider identity, even when its business details match.

Restore with `GET .../drafts/[draftId]`; replace its editable payload with
`PUT .../drafts/[draftId]`, supplying `expectedRevision`. A conflicting save returns
`onboarding_draft_stale`; restore before merging edits. Account, connection and
client targets cannot be changed through this endpoint. All draft reads and writes
recheck current manager access and account/client scope. Drafts expire after 180
days and the existing retention job deletes expired drafts when deletion is enabled.

Service choices for a saved onboarding draft are available at
`GET .../drafts/[draftId]/services?expectedRevision=N`. Save a primary category
first. This read requires current manager/account/client access and fresh Google
account access; it requests FULL metadata for all saved category IDs using the
draft language and country context. A changed draft or revoked connection blocks
the response. An incomplete catalogue is an error; a confirmed category with no
structured services is a valid result. The response includes the draft revision,
payload hash and observation time.

Nonempty creation service proposals are checked against fresh category metadata
before provider validation and again before claiming creation. Structured service
IDs must be advertised by a proposed category; custom services must belong to a
proposed category. A new listing has no unchanged-service exemption. Changed
eligibility after approval blocks creation without recording or sending another
attempt. Provider validation and independent confirmation remain separate checks.
In setup, the Services section loads these choices after categories, language
and country are saved. **Add a suggested service** preserves its Google ID;
**Add a custom service for category** creates a row requiring a service name.
Both support optional descriptions and prices. Prices use decimal text with up
to nine decimal places and a three-letter currency; explicit zero remains zero.
Untouched prices and service siblings are preserved. **Clear service price**
and **Clear service description** omit those values from this new proposal.
**Remove** removes only that service. Incomplete service details block saving,
matching and leaving the draft. Google discovery failure disables additions
until **Retry service choices** succeeds; changing category/language/country
requires saving that context before adding further services.

Save/reload restores service rows. The frozen creation review shows each service
type, exact provider ID or custom category/name/language, description and price.
Reviewing or saving does not publish; the existing validation, approval and
creation controls remain the publication boundary.

For API clients, saved-draft `GET .../accessible-matches` requires the current
`expectedRevision` and `expectedMatchCheckedAt`. It returns an observation bound
to that draft and search. `accessible` means an exact identity was found in the
selected Google account's fresh, fully paginated location list. `not_accessible`
means the supplied identity was absent from that account list; it says nothing
about another account. `identity_unconfirmed` means there is insufficient or
conflicting identity evidence; `ambiguous` means multiple resources share the
supplied place identity. Failed or unfinished discovery is an error, not evidence
to create a duplicate listing. Refresh matching after stale/superseded results.
This endpoint makes no local link. API clients can create an exact mapping review
with `POST .../match-link-reviews`, supplying the same saved revision/search time,
the exact returned `googleLocations/...` match name and an explicit local name.
The server re-proves membership and reads the selected resource, then freezes the
provider identity/details, local name, client and account assignment. Review
conflicts identify an existing local name, existing link (including inactive),
different external assignment or webhook-routing assignment, without disclosing
other tenants' records. Conflicted reviews cannot be approved.

Restore a review with `GET .../match-link-reviews/{reviewId}`. Approve with POST
to that URL and its exact `expectedReviewHash`. Current two-person policy applies;
when required, a different current owner/admin must approve. Approval refreshes
account membership and resource readback, and rejects changed provider details,
draft/search/mapping evidence, policy or actor access. Reviews expire for approval
after 24 hours. Unknown verification is distinct from false.

Review and approval make no mapping and send no Google creation request. Execute
the exact approved mapping with `POST .../match-link`, supplying `reviewId` and
`expectedReviewHash`. The server refreshes membership/resource details before
claiming the draft. Creation and local linking cannot both claim the same draft.
The mapping transaction saves the local listing, provider assignment, webhook
route, client-holder grants, initial sync checkpoint, audit and durable result.
It sends no Google creation request and never merges an existing local name.

Restore with `GET .../match-link`. A `linked` result identifies the same saved
local listing on every retry. A `pending` result means restore status rather than
start another operation. A pending claim older than two minutes is settled as
`failed` with `onboarding_match_link_interrupted`; the mapper's draft lock prevents
that recovery from overtaking an active mapping transaction. Retry the same
review/hash after a failed transaction only while its approval and baselines are
still valid. Otherwise resolve the reported conflict and generate a fresh review.
Failed attempts retain their operation identity and advance the generation on
retry. Active or completed links block draft editing, matching and creation.
In setup, save the business details and search for potential matches. Choose
**Check accessible matches** to prove which exact identities are accessible in
the selected account. Inaccessible, ambiguous and unconfirmed identities have
explanations rather than a link button. Failed discovery is not evidence to
create a new listing. Ownership handoff remains available in the potential-match
list, including when an accessible listing has an ownership URL.

Select an accessible match and enter a distinct local name. **Review existing
listing link** saves an exact mapping review with provider name/resource/place
identity, address, account/client assignment and verification observation.
Unknown verification is displayed as unknown. Resolve listed conflicts before
approval. When two-person policy applies, share the setup URL with a different
authorised owner/admin; the saved review ID is in that URL. Approval is followed
by a separate confirmation checkbox and **Link approved existing listing**.

Setup restores operation status before offering editing or creation. A completed
link replaces the draft actions with **Open linked listing**; initial sync and
verification are separate outcomes. An interrupted or failed operation offers
**Restore link review**. Refresh approval if another manager approved it, or
start a fresh review after expiry/stale evidence. Lost submission responses cause
status restoration, with actions held until that read completes. Unsaved link
decisions disable competing draft changes/creation and trigger the leave guard;
**Discard link decision** restores those actions without changing Google.

Creation drafts support **Opening hours** with exact opening and closing weekdays
and 24-hour times. Choose the closing day explicitly for overnight periods; use
24:00 only for midnight at the end of that day. Add each known opening period;
overlapping or duplicate periods are rejected. Omit regular hours if no schedule
is being proposed rather than inventing opening times.

**Special dates** require proposed regular hours. Choose closed all day or enter
custom hours, with an optional end date for overnight periods. An open special
period must last less than 24 hours and end on the same date or before noon the
following date. Closed dates omit provider-ignored times/end dates. A closed date
cannot overlap an open special period. Remove special dates before removing the
final regular period. Add or discard unfinished entries before save, matching,
review or navigation. Save/reload restores exact dates, times and weekdays;
removing a period affects only that proposal and preserves other listing details.

The frozen creation review displays every regular and special period. Independent
readback permits period reordering and Google's omitted default zero/false values,
while requiring the exact approved weekdays, dates, times and closure states.
Missing or changed periods remain unresolved without another creation request.
Additional service hours use the hour types returned by Google for the saved
categories, language and country. Choose a type, then add explicit opening and
closing weekdays and times. Add further periods to the same type or choose another
type for a separate schedule. Overlapping periods within a type are rejected.
Changing category context disables additions until that context is saved and
metadata is refreshed. Failed discovery offers **Retry hour types** and retains
all saved schedules, including IDs that metadata no longer recognises.
Google returning no types is shown separately from discovery failure.

Add or discard unfinished service-hour entries before saving, matching, review
or navigation. Removing a period preserves other periods and types; removing a
type's final period omits only that schedule. The frozen review shows exact type
IDs and readable weekdays/times. Validation and creation refresh category support;
independent readback checks the exact approved type and period sets. An unsupported
type blocks creation; an unconfirmed result remains unresolved without resubmission.

Creation drafts also support chain affiliation and related businesses.
**Search Google chains** reads Google's chain catalogue for the selected saved
draft, checks fresh account access and rejects results if the revision or
account/client/connection scope changes during discovery. Select an exact result;
the search itself does not confirm affiliation. Failed searches offer a retry,
and an empty search preserves the current proposal. **Remove chain from proposal**
omits only the chain, retaining proposed parent and child businesses.

For **Related businesses**, enter exact Google place IDs and explicitly choose
**Department** or **Independent business at the same address**. These checks
validate format only; Google validates the proposed relationships before approval.
Setting a parent replaces only the parent. Adding/removing a child affects only
that child, with duplicate place IDs rejected. Add/set or discard an unfinished
entry before saving, searching or leaving. Save/reload restores the relationships,
and the frozen review displays exact place IDs, readable relationship types and
the selected chain resource. Removing a relationship omits it from this new
listing proposal; it does not modify an existing Google business.

Independent creation readback compares related children by exact place ID and
relationship type. Google may reorder the children without creating a mismatch;
missing, changed or duplicate children remain unresolved and never trigger a
blind creation retry.

In setup, select the Google account under **Find your business on Google**, then
start or restore a saved business draft. **Save business details** stores the name,
language, categories, contact details and storefront address before **Search for matches** becomes available.
The draft also includes a business description, store code, private listing labels
and a separate Google Ads phone. Store codes must be unique within the selected
Google account. Labels are private organisational tags, up to ten entries with one
per line. Google validates category requirements and store-code uniqueness before
approval. Editing other details preserves these fields. Clearing a field omits it
from the proposed new listing; it does not clear an existing Google business.

**Opening state** can be omitted or explicitly open, temporarily closed or
permanently closed. Google defaults a new location to open when state is omitted;
the form preserves omission until you choose a state. Choose a state before
**Add opening date**, then enter a month and year with an optional day. Calendar
validation rejects impossible dates and dates more than one year in the future.
An unknown day stays unknown in the saved proposal and review. **Clear opening
date from proposal** retains the chosen state; **Not supplied in this proposal**
omits the entire opening-information object. These controls concern the proposed
listing and are separate from regular opening hours or existing-business closure.

Contact details include an optional website, primary phone and up to two additional
phones. Include the full website URL and one additional phone per line. Editing the
primary phone preserves the additional numbers. Clearing these inputs omits them
from the proposed creation payload; it does not change an existing Google listing.
Local checks validate input format. Google validates the saved proposal before
creation approval. The storefront form includes town/city, county/region and
district alongside address lines, postcode and country. Changing one component
preserves other saved address components, including organisation and recipient
metadata. Clear all storefront fields except country to omit the storefront from
the creation proposal. **Where do you meet customers?** distinguishes storefront,
customer-only and hybrid businesses. Enter the service-area country and add areas
using an existing place name and ID from authorised records. No place lookup is
performed. Local format checks reject duplicate IDs and cap the list at 20 areas;
Google validates the saved proposal before approval.

For customer-only businesses, **Remove storefront from creation draft** explicitly
omits the address. Country and address conflicts must be resolved before creation
review becomes available. Switching to hybrid preserves the area IDs and saved
storefront. Area entries must be added or explicitly discarded before saving or
searching; unfinished entries also guard setup navigation. Saving a draft changes
only the proposal, not an existing Google listing.
The saved setup URL restores the draft. **Saved drafts** asks before discarding
unsaved edits; Back/Continue keep unsaved work on the step. After a conflicting save,
local input stays visible until **Discard local edits and reload saved draft** is
chosen. A successful empty search is different from an unavailable Google search.

`GET .../drafts?connectionId=...&clientId=...` lists up to 20 unexpired drafts in
updated order for exactly that client, account and connection. Omitting `clientId`
lists only unassigned drafts; it does not widen the query to all clients. The
interface's **Refresh drafts** can recover a draft whose save response was lost.

`POST .../drafts/[draftId]/matches` takes only `expectedRevision` and searches the
server-saved details. It clears previous match evidence before searching. Failures
leave `matchResult: null`; a successful empty search stores an explicit empty list
and timestamp. Editing the draft clears match evidence. A response for an older
revision or a superseded search is rejected. These results remain potential matches;
they do not authorise creation or establish that a match is accessible for linking.

Creation review is available at `POST .../drafts/[draftId]/reviews`. Supply
`expectedRevision`, the current match result's `expectedMatchCheckedAt`, and
`decision: { action: "create_new", acknowledgedMatchNames: [...], reason: "..." }`.
Every returned Google match name must be acknowledged exactly once, including
potential ownership handoffs; use an empty list only for an explicitly empty
successful search. This decision records why a separate listing is intended and
does not prove that Google has no duplicate. Search evidence expires after 24 hours.

The review endpoint rechecks Google account access and sends the saved payload to
Google with `validateOnly=true`. Validation uses its own request UUID, leaving the
draft's stable creation identity reserved for execution. Provider rejection or an
unconfirmed response cannot produce a review. Business name and language must be
explicit; customer-location-only businesses must omit the storefront address.
Other business-specific acceptance remains subject to Google's validation.

A successful response freezes the target, payload, draft revision, matching
evidence, creation decision and approval policy. Restore with
`GET .../reviews/[reviewId]`; approve with `POST .../reviews/[reviewId]` and the exact
`expectedReviewHash`. The existing two-person policy requires another current
owner/admin to approve. Reviews expire after 24 hours, and edits, rematching,
policy changes or lost initiator/approver access invalidate them. Reviews are
removed with their draft by retention. Approval records intent only: the approval
endpoint does not send a creation request or link a location.

In setup, acknowledge every potential match and enter the reason for creating a
separate listing, then choose **Validate and review creation**. Google validation
must succeed before the frozen details and approval controls appear. The setup URL
includes the saved review so an authorised second approver can restore it. Under
two-person policy, the requesting user cannot approve their own review. Choose
**Approve creation details**, acknowledge the final creation confirmation, then
choose **Create approved Google listing**. This sends the exact review identity
and hash. A lost submission response triggers a status read to recover the durable
operation. **Refresh creation review** checks current approval and expiry; an
invalid review must be replaced through **Start a fresh review**. Unsaved reasons
and match acknowledgements guard navigation and business editing until the decision
is saved in a review or explicitly discarded.

Submit an approved review with `POST .../drafts/[draftId]/creation`, supplying
`reviewId` and `expectedReviewHash`. Before claiming the operation, the server
searches Google again and rechecks the approval and current permissions. Changed
matches require fresh review. Each draft can claim one creation operation; its
payload and matching controls are locked afterwards. Concurrent duplicate submits
return the existing operation, while a different review cannot take it over.

Creation reports `executionState`, `confirmationState` and `linkState` separately.
The Google resource name is persisted before independent readback or local linking.
A successful response alone is not confirmation: the readback must contain the
approved values. A missing/malformed resource name, rejected write or lost response
does not trigger a second create request. `GET .../creation` refreshes known resources
and marks a request stranded for more than two minutes as an unknown outcome.
When no resource identity was received, it remains unresolved for reconciliation;
the API does not infer identity from a similar business name or blindly resend.

For an approved month/year opening date, an omitted day and Google's day-zero
representation both mean that the day is unknown. A concrete day returned instead
does not confirm that proposal. A supplied complete date requires the same day,
month and year before local linking can continue.

After confirmation, local linking creates the listing, exact provider link,
webhook route and pending initial backfill in one transaction. Client access grants
are extended using the existing client rules. A local name collision returns
`onboarding_local_name_conflict` and preserves the successful provider result.
Resume with `POST .../creation/link` and a distinct `localName`. This endpoint
refreshes the known provider resource and retries only the local transaction;
it never calls Google creation. Existing provider mappings or webhook assignments
require explicit reconciliation and are not silently reassigned. An expired
creation approval does not prevent an authorised operator from recovering a
provider resource that was already returned. Connection/client access still applies.

Restoring an executed draft in setup shows its creation outcome instead of editable
details. **Refresh creation outcome** reads available evidence without repeating
creation. **Resume local linking** retries the known-resource recovery above;
choose another local name if a name conflict is shown. Once linked, **Continue to
verification** opens the verification page. Initial synchronisation was requested;
check its actual progress in setup before calling it complete. Unknown outcomes
without a provider resource name require explicit reconciliation, still pending
implementation, and have no automatic resubmit control.

## Location activity

Activity now includes attempts from management, hours, profile, menus, links,
media, posts and review replies. The recorded status is the originating store's
status; an old `succeeded` record does not acquire independent confirmation.
Only records with separate confirmation evidence display that evidence.
Unknown historical actors remain unattributed. Pagination uses stable cursors;
existing API callers can continue using page numbers. Lodging recovery still
uses the original attempt ID rather than the timeline's source-prefixed ID.

## Lodging review and approval

Use **Review lodging changes** to save the exact before/after review. Saving a
review does not write to Google. The review includes the provider assertion
timestamp. **Publish to Google** approves and executes that frozen content.
Where two-person approval is enabled, a different current owner/admin opens the
saved review and approves it. Reviews remain available after navigation and
expire after 24 hours.

A changed payload or mask returns `approval_stale`; changed Google data returns
`google_baseline_stale`. Refresh the form and generate a new review. Policy,
target or initiating/approving membership changes also require a new review.
Never edit stored approved content to repair these conflicts. Repeating the same
approved intent returns its existing attempt, including an unresolved result;
use the read-only confirmation action to investigate that result.

## Verification credential handling

Enter a PIN only in the selected listing's verification form. The immediate
request sends it to Google; ordinary attempts retain the verification resource
without the PIN. Partner tokens and private service verification addresses are
also excluded from ordinary attempt payloads. Provider error messages/details
are replaced with static copy to avoid credential echoes. Do not put PINs or
tokens in notes, logs, incident metadata or durable job payloads.

A rejected PIN and an uncertain provider outcome are different. For an uncertain
outcome, refresh Google's verification state before another attempt; do not infer
completion from a start response. Migration 0069 removes untyped payloads and
credential echoes from legacy verification attempts, raw verification snapshots
and legacy verification audit metadata. It preserves historical scope, actors,
execution/confirmation outcomes, timestamps and retention deadlines; reviewed
attempts and encrypted review bytes remain unchanged. Apply and verify this
migration before release. Full method-specific browser and live acceptance remain
prerequisites in the acceptance register.

## Reviewed verification completion and recovery

The completion-review flow supports preview, approval, execution, saved status
and read-only refresh. Internal start/PIN controls now use these reviewed APIs;
full browser acceptance remains in progress. The administration compatibility
endpoint returns 409 `verification_review_required` for start/completion writes,
before connection or attempt work. Its old verification read fields return null
with `verification_workflow_moved`; use the independent typed verification APIs.
Use an exact current pending
verification resource and a supported PIN
method. AUTO, partner/future methods and non-pending requests require status
refresh or a Google handoff rather than a PIN completion review.

Completion approval expires after twenty minutes and binds the exact target,
normalized PIN and observed pending baseline. A different PIN requires a new
preview and approval. The PIN is never restored from the review; only a protected
keyed commitment is retained. Re-encrypting private review bytes requires a fresh
review. Preserve the old decryption key during normal keyring rotation until
short-lived reviews expire, following the token-key rotation procedure above.

After execution, use the saved attempt GET or empty-body PATCH under
`/api/locations/[id]/verification-completion-reviews/[reviewId]/execute`.
Refresh does not need the PIN and never sends a completion mutation. A recent
interrupted claim must wait five minutes before refresh; an older claim can be
checked independently. Saved outcomes/recovery do not require an unexpired
approval or enabled publishing, but current manager and exact linked target
access still apply. A reconnect may be needed to obtain new provider evidence.

Interpret outcomes separately:

- Accepted plus unresolved: Google acknowledged the request, but the exact
  resource is still pending, unreadable or does not match the approved method.
  Refresh the saved attempt. Do not create another review to bypass it.
- Unknown plus confirmed COMPLETED: independent Google readback establishes the
  desired request phase; the lost acknowledgement remains unknown.
- Rejected plus completion_rejected: Google definitively rejected the PIN
  request. Refresh current verification state, correct the PIN or follow Google's
  expiry instructions, and create a new review. Replaying the rejected review
  returns its recorded failure without resubmission.
- Confirmed FAILED: the exact verification request failed. This is a terminal
  failure, not successful completion; follow the independently refreshed eligible
  method or Google handoff for a new verification journey.
- Refresh unavailable: the previous independently confirmed phase/time is
  preserved as historical evidence. Do not treat its old timestamp as fresh.

A completed verification request does not establish merchant standing or public
Search/Maps display. Read and report those separately. Deployment of the
historical credential cleanup, full UI acceptance and eligible-account live
checks remain release prerequisites.

## Finding saved verification work

The backend index `GET /api/locations/[id]/verification-workflows` lists saved
start/completion reviews and recorded attempts for the listing's current linked
Google target. Owner/admin access is required. Use `operation=all|start|complete`,
`stage=all|reviews|attempts`, `includeExpired=true|false` and `pageSize=1..50`;
follow the returned cursor without changing filters. A relink or filter change
requires restarting pagination. The index remains readable during disconnection
and while publishing is paused; reconnect to obtain fresh provider observations.

Expired unexecuted reviews are hidden by default, while recorded attempts remain
visible. The index contains no PIN, destination, service address, private context
or provider/error echo. Restore a selected review or attempt through its existing
scoped detail/status endpoint before approving or executing. Index approval
eligibility is advisory and cannot replace the current authoritative checks.
Internal start/PIN controls now restore saved reviews/outcomes through these
APIs. A PIN is never restored: preview clears it, approval precedes re-entry, and
refresh/reopening clears re-entered credentials. A changed PIN needs a fresh
review and approval. Use current Google-state refresh and saved-outcome recovery
before a corrected submission; unresolved sends must not be bypassed. The
verification workspace keeps those recovery controls mounted when current Google
state cannot be read. Unknown or failed capability checks pause sends without
hiding saved outcomes. The shared header does not reuse a legacy verified Boolean;
read the separately dated merchant standing and request history in the page.
Failed refreshes label retained observations as earlier evidence. Complete
real-backend PIN and combined start/PIN acceptance passed locally on 2026-09-30:
39 START and 57 PIN/combined/drift/recovery cases, three widths, and two independent
complete capture reviews. Broader accessibility/performance, deployment and
eligible live Google acceptance remain pending in the acceptance register.

An active start request displays **Request action in progress** and disables
duplicate/recovery actions until the response finishes. If its response is
unavailable, use **Check saved request outcome** before another action. Saved
outcomes remain readable after navigation or disconnection. A proven absent
attempt permits returning to methods; it does not make an expired review usable.
Expiry, changed approval policy, manager access, target or eligibility requires a
fresh review. The old send stays disabled even if its consent was checked.

Only one approved START/PIN workflow is active at a time. Switching to another
approved workflow clears consent and any re-entered PIN. While either controller
has an active request, both workflows' actions pause. For a lost completion
response use **Check saved PIN outcome**; re-opening an approved review never
restores its PIN. **Completed with Google** describes the exact request phase.
Check the separate merchant-standing and public-display observations before
claiming that the business is verified or visible to customers.

## Reviewed administrator and invitation requests

In **People with access**, review the exact scope, target, invitee and role before
approving. Approval saves permission to send; check the explicit consent box and
use **Send approved access request** to make the provider request. A primary-owner
change requires the dedicated ownership workflow; generic invitation/role actions
cannot assign primary ownership or remove/demote the last owner.

For a missing response, use the saved-outcome read before another action. Use the
observation refresh to check Google without resending. **Accepted by Google** and
**Independently confirmed** are different evidence. An administrator invitation
listed by Google still awaits acceptance. An account invitation disappearance
requires a separate exact account/role access read; a location invitation
disappearance alone does not establish access. A failed refresh leaves earlier
proof visible with its date. Expired or changed reviews need a fresh preview.
The legacy direct access endpoint returns `administration_review_required`;
operators must use the reviewed workspace. Local tests and visual acceptance do
not prove live Google access changes or public listing state.

## Recovery procedures (WP2/WP6/WP7/WP8)

These describe local, automatically verified behaviour. None has been exercised
on a deployed environment or a live Google account yet.

### Stale approvals

Any reviewed change (profile, lodging, services, attributes, access, lifecycle,
verification, action links, schedules, bulk previews) is refused with 409
`approval_stale`, `approval_expired`, `approval_policy_changed`,
`approval_actor_access_changed` or `google_baseline_stale` when its content,
policy, actors, connection or Google baseline moved. Nothing is sent. Prepare a
fresh review or preview; do not edit stored reviews.

### Ambiguous or unresolved writes

`/settings/operations` lists unresolved writes by family, oldest first. Open
the listing and read the saved outcome; the refresh action reads Google and
settles it without resending. Action links, access and lifecycle writes on the
same Google account stay blocked (409 `google_confirmation_unresolved`) until
the outcome is settled.

### Failed or blocked schedules

A schedule shows "Needs attention" with its reason:
- `approval_invalid` / `permission_revoked`: change the schedule (a new
  revision) and have a current owner or admin approve it.
- `prior_occurrence_unresolved`: a publish was sent but its result is unknown.
  Check the post's saved outcome, then change and re-approve the schedule.
Missed occurrences (older than 24 hours, or with ended event/offer content) are
recorded as missed and raise `schedule_missed`; they are never published late.
Pausing keeps occurrences; cancelling stops every pending one. To stop all
scheduled publishing at once, turn off `PUBLISH_ENABLED` (or `JOBS_ENABLED`):
no new schedule or bulk child is claimed, and nothing already sent is undone.

### Partial bulk changes

A batch finishing with failures raises `bulk_completed_with_failures`. On the
bulk change page, "Retry unsettled listings" re-reads Google for failed and
ambiguous listings: already-applied listings settle without a write, unchanged
ones are written once, and moved ones become conflicts that need a new preview.
Confirmed listings are never written again. Cancelling stops queued listings
only; completed writes are not rolled back.

### Notification delivery failures

`/settings/operations` shows email evidence by state. "Retry failed emails"
requeues sends the provider refused, and unknown sends younger than 23 hours
(still inside Resend's idempotency window); older unknown sends stay unknown to
avoid a duplicate. Every retried send rechecks membership, location access and
preference. Delivery evidence needs `EMAIL_WEBHOOK_SECRET` and a Resend webhook
pointed at `/api/webhooks/email`; without it, evidence stops at provider
acceptance. With no provider configured, sends are suppressed and incidents
still appear in the app.
