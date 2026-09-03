# Operations runbook

## Deployment gate

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
`pnpm db:migrate`, and `pnpm db:status`. Run `pnpm test:integration` against a
disposable PostgreSQL database with the documented runtime test role. Confirm
the Supabase project URL/publishable key, email confirmation and recovery
templates, redirect allow list, custom SMTP, Google OAuth redirect URI, Pub/Sub
OIDC audience/service account, optional verification token, cron secret, and
OpenAI model names in the deployment environment. Never log environment values
or decrypted Google tokens.

Before a canary, confirm `DRAFTS_ENABLED`, `PUBLISH_ENABLED`, `SYNC_ENABLED`,
`WEBHOOKS_ENABLED`, `JOBS_ENABLED`, `SEMANTIC_VERIFY_ENABLED`,
`RETENTION_ENABLED`, and `RETENTION_DELETES_ENABLED`. Roll back to read-only by
disabling publishing and drafting first; pause sync/webhooks only when data
ingestion itself is unsafe. `OPENAI_TIMEOUT_MS` is capped at 55000; a larger
value fails environment validation at startup, because the database kills a
connection left idle in a transaction for 60 seconds and the caller would see an
opaque 500 rather than a provider timeout.
Database migrations are roll-forward-only. Before a migration rollout, capture
a restorable database snapshot and retain the currently deployed application
image. If the migration or post-migration verification fails, restore the
snapshot and redeploy that exact previous image as one rollback unit; do not
run ad-hoc down migrations.
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
that halts all seven ticks — the jobs runner, reconciliation, retention,
presence-resource reconciliation, the provider-deletion sweep and the
performance/keyword ingests — in one step, and loses no work. Each queue keeps
its due rows, and every tick starts at the head of a stable
organisation order, so a stopped walk repeats work rather than skipping it:
nothing about the walk position survives between ticks.
Interactive routes keep serving while it is down, and `schedulerHeartbeatAt`
plus every entry in `schedulerTicks` goes stale and pages: silence those alerts
deliberately.

| Flag                        | Off means                                                                                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DRAFTS_ENABLED`            | The drafts route returns 503 `drafts_paused`.                                                                                                                                                                                                        |
| `SEMANTIC_VERIFY_ENABLED`   | Verification runs its deterministic checks alone. Use this, not `DRAFTS_ENABLED`, during an OpenAI incident: a hand-written reply is still saved and still faces the human boundary.                                                                 |
| `PUBLISH_ENABLED`           | No reply or post reaches Google, from the interactive routes or from the runner's publish work.                                                                                                                                                      |
| `SYNC_ENABLED`              | No review ingestion, from the push route or from the runner's webhook and checkpoint work.                                                                                                                                                           |
| `WEBHOOKS_ENABLED`          | The Pub/Sub push route stops accepting deliveries. Google retries, then dead-letters.                                                                                                                                                                |
| `JOBS_ENABLED`              | The background runner claims nothing at all. Due work accumulates and drains when it is turned back on. `PUBLISH_ENABLED` and `SYNC_ENABLED` narrow the same claim by job kind rather than stopping it.                                              |
| `RETENTION_ENABLED`         | The retention sweep returns 503 `retention_paused` and deletes nothing. The scheduler reads this one too and registers no retention tick, so a paused deployment logs no failing run.                                                                |
| `RETENTION_DELETES_ENABLED` | Retention keeps redacting expired provider content but performs no irreversible delete. Prefer this to `RETENTION_ENABLED` when the concern is a suspect delete predicate rather than the sweep itself, so the redaction obligation keeps being met. |

Pause the narrowest switch that covers the failure. A paused flag is not a fix:
record why it is off and land the correction, because backlogs accrue behind
`JOBS_ENABLED` and `SYNC_ENABLED` for as long as they are down.

The runner enforces all three of its flags at the claim, not inside the work:
`claim_due_jobs` takes the permitted job kinds as an argument, so a paused kind
keeps its status and its `next_attempt_at` untouched. A tick that is claiming a
reduced set logs `jobs.kinds_paused` with the flags responsible. Nothing is
re-armed, and no retry or recovery budget is spent, while a flag is off.

## Scheduled work

- Production background work runs as seven Vercel Cron entries in
  `vercel.json` (times UTC): `/api/jobs/run` every minute, `/api/sync/reconcile`
  and `/api/sync/presence-resources` every 15 minutes (staggered by 7 minutes),
  `/api/sync/performance` every 6 hours, and `/api/sync/sweep`,
  `/api/sync/keywords`, `/api/cron/retention` once daily, staggered across
  01:30–03:00. Each cron fires an HTTP GET at the route's cron-authenticated
  `GET` shim, which runs the same single page the scheduler used to POST,
  with the page sizes carried in the cron path. `CRON_SECRET` must be set on
  the Vercel project: Vercel sends it as the `Authorization` bearer
  automatically, and without it every tick answers 401 `invalid_cron_token`.
  `tests/server/vercel-cron.test.ts` pins the table — cadences, page sizes,
  and the GET handler each path lands on — so a quiet edit cannot drop a tick.
- Each fire is stateless and runs one page from the head of the tenant order
  (or from the `organisationCursor` it is given); nothing follows `nextCursor`
  between fires. One page covers 100 organisations for reconciliation,
  performance and keywords, 100 for retention (`batch_size=100`), 10 for
  presence resources, and 1 organisation at 5 pages per location for the sweep.
  While the fleet fits in one page that is a complete walk; past that, add
  cursor-following (or another host running `scripts/scheduler.mjs`, which
  still walks cursors across pages for local development and non-Vercel
  deployments via `SCHEDULER_BASE_URL` and the same `CRON_SECRET`) rather than
  enlarging pages past the per-page budgets below.
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
- Five of the cursor-walking routes are bounded by a per-page budget
  (`RECONCILE_BUDGET_MS`, `RETENTION_BUDGET_MS`, `PERFORMANCE_BUDGET_MS`,
  `KEYWORDS_BUDGET_MS`, `PRESENCE_RESOURCE_BUDGET_MS`, all 45000 by default).
  A page that exhausts its budget commits the organisations it has finished
  and returns a `nextCursor` for the rest; the scheduler asks for the next
  page immediately, and for the three routes that report `truncated`
  (performance, keywords, presence resources) it also logs `<tick>.truncated`
  naming the organisations that page did not reach. `/api/sync/sweep` has no
  budget of its own — the scheduler bounds it by asking for one organisation
  and five pages per location, and a location with more history than that
  parks its checkpoint for the jobs runner. Keep every budget below the
  scheduler's 55s request abort: a page cut off by the abort still commits on
  the server, but no cursor reaches the scheduler, so it resumes from the last
  cursor it holds and repeats that page.
- Under Vercel Cron there is no walk position between fires: every fire starts
  at the head and a `nextCursor` in the response is only a handle for a manual
  follow-up request, not something the next fire resumes. A page that fails
  every time therefore delays — but cannot starve — the organisations ordered
  after it, because the next fire re-enters at the head rather than resuming
  onto the poisoned page. (`scripts/scheduler.mjs` keeps the old in-memory
  walks with `<tick>.cursor_reset` when it is the driver; the routes behave
  identically under either caller.)
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
does not retro-settle them. Never raise `OPENAI_TIMEOUT_MS` above 55000 to ride
out latency — the schema rejects it, and the database would kill the connection
first.

### Quota storm

Pause backfills, retain notification ingestion, reduce per-tenant concurrency,
and retry 429/5xx responses with exponential backoff and jitter.

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

The separate production-style stack remains available through
`docker compose up --build`; its plain PostgreSQL database is available only on
`127.0.0.1:54329`.

The separately configured hosted PostgreSQL URLs were previously rejected by
their provider as an unknown tenant/user. They are not required for local
Docker validation. Replace them with active project credentials before a hosted
deployment, then run `pnpm db:migrate`. Migration and status scripts never print
credentials.

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
