# Observability

NabaPresence registers OpenTelemetry with service name `nabapresence`.
Set `OTEL_EXPORTER_OTLP_ENDPOINT` in the Vercel project's Production (and
staging) environment to the environment's OTLP collector; on Vercel one
deployment serves both the web functions and the cron routes. The OTLP metric
exporter is registered only when an endpoint is set (or
`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, and neither `OTEL_SDK_DISABLED=true` nor
`OTEL_METRICS_EXPORTER=none`); without one, startup logs
`startup.operational_warnings` and the readiness endpoint reports telemetry
`disabled` instead of the exporter failing unseen. Keep tenant identifiers as restricted telemetry
attributes and never attach review text, reply bodies, access tokens, or email
addresses.

## Metric catalog

All application-owned metric names use the `nabapresence.` prefix.

| Metric                                     | Type      | Unit | Attributes                                                                                                  | Source and purpose                                                                                                  |
| ------------------------------------------ | --------- | ---: | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `nabapresence.tenant_transaction.duration` | histogram |   ms | `tenant.id`, `outcome`                                                                                      | `lib/server/db.ts`; latency of an RLS-scoped transaction                                                            |
| `nabapresence.tenant_transaction.count`    | counter   |    1 | `tenant.id`, `outcome`                                                                                      | `lib/server/db.ts`; successful and failed RLS-scoped transactions                                                   |
| `nabapresence.google.request.duration`     | histogram |   ms | `server.address`, `http.request.method`, `http.response.status_code`, `nabapresence.google.mode`, `outcome` | `lib/server/google.ts`; provider latency including pacing and safe-read retries                                     |
| `nabapresence.google.request.count`        | counter   |    1 | same as request duration                                                                                    | `lib/server/google.ts`; provider request outcomes                                                                   |
| `nabapresence.webhook.discarded`           | counter   |    1 | `reason`                                                                                                    | `app/api/webhooks/google/pubsub/route.ts`; permanently malformed or unroutable deliveries acknowledged as discarded |
| `nabapresence.performance_sync.count`      | counter   |    1 | `outcome`, `errorCode` (failures only)                                                                      | `lib/server/performance.ts`; one per location per ingestion attempt                                                 |
| `nabapresence.keyword_sync.count`          | counter   |    1 | `outcome`, `errorCode` (failures only)                                                                      | `lib/server/keywords.ts`; one per location per ingestion attempt                                                    |

The application also emits the `database.tenant_transaction` and
`google.api.request` spans. Request spans receive
`nabapresence.request_id` and, when supplied,
`nabapresence.client_request_id`. Google spans additionally receive
`nabapresence.google.attempts`. Structured logs are redacted before output.

## Health scraper

The platform monitor uses a cron credential, not a browser session:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "${STAGING_BASE_URL}/api/operations/health?scope=platform"
```

The response is `Cache-Control: no-store` and aggregates tenant-scoped reads
without bypassing RLS. It contains:

- `scope`, `generatedAt` and `organisationCount` (the platform scope only)
- `partial` and `organisationsCovered` (platform scope only). The tenant walk
  stops at `OPERATIONS_HEALTH_BUDGET_MS` (20000 by default) after at least one
  organisation and starts at a random one. When `partial` is true, the summed
  counters below are lower bounds over `organisationsCovered` of
  `organisationCount` tenants, and the worst-tenant ages may be understated.
- `failedWebhookEvents`
- `deadWebhookEvents`
- `oldestFailedEventAgeSeconds` (the maximum across tenants, not a sum)
- `ambiguousPublishAttempts`
- `staleStartedAttempts` (a `started` publish whose lease has expired, or,
  where it has no lease, one older than 10 minutes)
- `dueJobBacklog` (all due background work, whichever tick owns it — exactly
  the sum of the five fields below)
- `dueWebhookBacklog` (due failed events, plus `processing` events whose lease
  has expired)
- `dueRunnerCheckpointBacklog` (`backfill` / `sweep` — what `claim_due_jobs`
  can actually take)
- `dueMetricsCheckpointBacklog` (`performance` / `keywords` — claimed by the
  runner since 0048)
- `dueReconcileBacklog` (recurring `reconcile` checkpoints due for more than
  two minutes and unleased — the runner is behind)
- `dueUnclaimedCheckpointBacklog` (`notification` — no claimer at all; a
  non-zero value here is rows waiting on 0030's terminal state, not on a
  tick)
- `duePublishBacklog` (unleased due `ambiguous`/`retryable` attempts under the
  recovery ceiling, plus `started` attempts past their lease)
- `checkpointFailures24h`
- `connectionErrors24h`
- `refreshTokensExpiringSoon` (live connections whose Google refresh token
  expires within three days — the seven-day tokens a Testing-status OAuth
  client issues all expire at once, with no other warning)
- `reconcileStalenessSeconds` (how long the WORST actively linked location
  has gone without a successful reconcile — `last_succeeded_at`, which a
  failed reconcile never moves; a never-reconciled location counts from its
  link time. Data freshness, where the heartbeats below are liveness. It used
  to read the newest `finished_at`, which failures also set, so a reconcile
  failing every tick looked fresh.)
- `sweepStalenessSeconds` (the same for the daily deleted-review sweep)
- `listingsAccessLost` (linked listings whose login lost manager access)
- `googleQuota` (platform scope only: Google rate buckets throttled in the
  last hour or blocked now, with `throttledCount`)
- `heldPurgeLocations` (external locations an unreleased legal hold keeps past
  their disconnect purge date)
- `pendingPurgeAgeSeconds` (how long the oldest still-unpurged disconnected
  connection is overdue)
- `schedulerHeartbeatAt` and `schedulerHeartbeatStale`
- `schedulerTicks`, one entry per tick (`jobs`, `reconcile`, `retention`,
  `performance`, `keywords`, `presence-resources`, `sweep`, `health`,
  `billing-reconcile`) with
  `lastCompletedAt`, `staleAfterSeconds` and `stale`, and the run ledger
  (0089): `neverCompleted`, `registeredAt`, `lastStartedAt`, `lastSkippedAt`,
  `consecutiveSkips`, `lockWedged`, `lastFailedAt`, `lastErrorCode`,
  `lastManualCompletedAt`, and for ticks that run in cycles (retention)
  `lastCycleCompletedAt`, `cycleStaleAfterSeconds` and `cycleStale`

The owner/admin scope returns the same fields for one tenant plus `sync`,
`webhooks`, `connections`, `publish24h`, `replyRejections30d` and
`providerTotalDivergence30d`.

`dueJobBacklog` stays one number across all five sources rather than being
narrowed to the runner's share, because `performance` and `keywords`
checkpoints are genuinely due work that their own crons claim: narrowing it
would hide them. The breakdown fields are what say who owes each unit, so alert
on the aggregate and diagnose on the parts — a rise confined to
`dueMetricsCheckpointBacklog` is a metrics cron problem and tells you nothing
about the job runner. It is a gauge of claimable work, not of failure: a healthy
fleet with a 60-second tick sits at a small non-zero value. Alert on it rising
monotonically, not on it being above zero. Terminal work is excluded by
construction: a dead-lettered webhook, a `dead` review checkpoint, a metric
checkpoint with `dead_lettered_at` and an attempt at the eight-attempt recovery
ceiling all leave the window, so a rising backlog is real.

`schedulerTicks` exists because `schedulerHeartbeatAt` cannot fail alone. The
jobs tick stamps `scheduler` at the start of every authenticated run, so that
row stays fresh while reconciliation, retention or an ingest has been failing,
skipping on a wedged advisory lock, or was never registered. Each per-tick row
is stamped by that tick's own lease **on a completed run**, so a tick that never
finishes reports stale. `staleAfterSeconds` is a small multiple of that tick's
documented interval — one missed run is noise, a stopped tick is not — and it
is served by the endpoint rather than hard-coded in the monitor, so an interval
change moves the threshold with it. `billing-reconcile` (the hourly
`/api/billing/reconcile` cron) goes stale after 10,800 seconds (three hours);
it completes with nothing to do while billing is disabled, so its absence is a
fault unless the operator `billing` scope pauses it. A tick its pause scope
holds (`TICK_PAUSE_SCOPES` in `lib/server/ops-liveness.ts`: `jobs`, `sync` for
reconcile and sweep, `retention`, `notifications` for health, `billing` for
billing-reconcile) reports `paused` and raises no stale alert. Since migration 0046 the sweep's fleet
enqueue takes `naba:sweep`, so `sweep` is listed like the other ticks.

Since migration 0089 each row is also the tick's run ledger
(`lib/server/leases.ts`). A scheduled run records when it took the lease
(`lastStartedAt`), a lock skip records `lastSkippedAt` and lengthens
`consecutiveSkips` (taking the lease resets it), and a throw records
`lastFailedAt` and its code without moving `lastCompletedAt`. A session-driven
refresh under the same fleet lease (reconcile, performance, keywords) records
only `lastManualCompletedAt`, so it cannot make a dead cron look alive. The
migration seeds a row for every tick, and `registeredAt` is the grace anchor
for a tick that has never completed. The health tick alerts operators
(`lib/server/notifications/platform.ts`, `tickFindings` in
`lib/server/ops-liveness.ts`) on four tick findings: `stale_heartbeat` (a tick
that used to complete and stopped), `tick_never_completed` (no completed
scheduled run within `staleAfterSeconds` of `registeredAt`),
`tick_lock_wedged` (`consecutiveSkips` reached three) and `tick_cycle_overdue`
(no completed cycle within `cycleStaleAfterSeconds`; the retention dispatcher
records one when its daily cycle completes). Because a cycle completes even
when some organisations failed every attempt, it also alerts on
`tick_cycle_failures` while the latest completed retention cycle has failed
organisations (`retentionCycleFailureFinding` in
`lib/server/retention/cycle.ts`). The health tick never alerts on itself. It
also opens `scheduled_post_stuck` and `scheduled_post_overdue` per
organisation for scheduled post occurrences the jobs tick has not moved on
(P08-R6; `scheduledPostHealth` in `lib/server/ops-liveness.ts`, runbook
"Scheduled post alerts").

The `scheduler` row is stamped at the start of every authenticated jobs run,
including one that claims nothing because a kill switch is off, so it does not
certify that work is being done — `jobs.kinds_paused` in the logs is what says a
flag is holding the runner back. Scrape the health endpoint once per minute.
Treat a missing heartbeat as silent.

## Readiness

`GET /api/operations/readiness` (`app/api/operations/readiness/route.ts`,
`lib/server/readiness.ts`) answers one question for a probe outside the
deployment: is this deployment doing its job, and would anyone be told if it
were not? It exists for what the health tick cannot report: its own absence, a
paused notifications scope, no alert email, and an alert that never went out.

It takes the cron bearer (`Authorization: Bearer ${CRON_SECRET}`) rather than a
token of its own: anything trusted to fire the ticks may ask whether they run,
and a second secret is one more to rotate on the endpoint that must work when
everything else is quiet. It is bounded: a connectivity check, the migration
ledger, `ops_heartbeat`, the cached pause snapshot and one aggregate over
`platform_incident`, each with a 5-second limit. The connectivity check runs
first and the other reads together after it, so an answer takes at most about
10 seconds, inside the probe's 15-second default; with the database
unreachable nothing else is read and `pause` holds the env layer alone. No
tenant walk (`tests/integration/readiness-bounded.test.ts` counts the
statements), no tenant data. `Cache-Control: no-store`.

The answer is `ready` or `degraded` with 200, `not_ready` with 503, plus the
inputs: `release` and `schema` (as on the platform health scope), `database`,
`scheduler`, one entry per tick in `ticks` (`ok`, `paused`, `stale`,
`never_completed` or `awaiting_first_run`), `pause`, `email`, `telemetry`
(`disabled`/`configured`/`exporting`/`failing`, per process) and `incidents`.
Every reason is in `reasons` with a `severity` and, where it applies, a
`subject`:

| Code                      | Severity  | Means                                                                                  |
| ------------------------- | --------- | -------------------------------------------------------------------------------------- |
| `database_unreachable`    | not_ready | `select 1` failed or took over 5 seconds; nothing database-derived is reported         |
| `schema_incompatible`     | not_ready | a required migration is missing (`subject` names it)                                   |
| `schema_unknown`          | not_ready | `schema_migration` could not be read                                                   |
| `scheduler_silent`        | not_ready | the jobs tick's `scheduler` stamp is older than five minutes                           |
| `scheduler_unknown`       | not_ready | `ops_heartbeat` could not be read                                                      |
| `tick_stale`              | not_ready | an unpaused tick used to complete and has stopped; `subject: health` is the health tick's own absence |
| `tick_never_completed`    | not_ready | an unpaused tick has never completed, past its grace from `registeredAt`               |
| `tick_lock_wedged`        | not_ready | three or more lock skips in a row, paused or not                                       |
| `alert_undelivered`       | not_ready | an open platform incident whose alert settled with no send (failed or suppressed)      |
| `tick_awaiting_first_run` | degraded  | a tick has not completed yet but is inside its grace (a fresh database)                |
| `tick_cycle_overdue`      | degraded  | the retention cycle is overdue                                                         |
| `pause_active`            | degraded  | a scope is paused, by env flag or operator table (`subject` names it)                  |
| `alerting_paused`         | degraded  | the notifications scope is paused: no alert of any kind is evaluated or sent           |
| `pause_state_unknown`     | degraded  | the pause table could not be read                                                      |
| `email_not_configured`    | degraded  | `EMAIL_PROVIDER` is `none`, or lacks `EMAIL_API_KEY`/`EMAIL_FROM`                       |
| `ops_recipients_missing`  | degraded  | `OPS_ALERT_EMAILS` is empty                                                            |
| `telemetry_disabled`      | degraded  | no metric export (`subject`: `no_endpoint`, `sdk_disabled`, `exporter_none`)           |
| `telemetry_failing`       | degraded  | two or more metric exports in a row failed in the answering process                    |
| `release_unknown`         | degraded  | neither `NABA_RELEASE_SHA` nor `VERCEL_GIT_COMMIT_SHA` holds a full SHA                 |
| `google_quota_pressure`   | degraded  | an open Google quota-pressure incident                                                 |
| `incidents_unknown`       | degraded  | `platform_incident` could not be read                                                  |

A configuration gap escalates once something goes wrong: with
`OPS_ALERT_EMAILS` empty or no email provider, every platform incident's alert
settles `suppressed`, so the first incident to open (a long-lived
`google_quota_pressure` one included) turns `ops_recipients_missing` or
`email_not_configured` (degraded) into `alert_undelivered` (503) until it
resolves. That is deliberate: nobody was told. An alert whose send is
`uncertain` rolls up to `failed` and counts too, since nobody can be shown to
have been told.

`telemetry` is the answering process's own record: on Vercel each function
instance has its own, and a fresh instance reads `configured` until its first
export interval has passed.

### The local probe

The probe runs outside the deployment, on an operator's machine (by hand, cron
or a launchd agent); there is no hosted workflow:

```bash
READINESS_PROBE_TOKEN=... pnpm ops:readiness --url https://<production> \
  --expect-promoted --notify
```

`scripts/ops/readiness-probe.mjs` reads the token from `READINESS_PROBE_TOKEN`
(or `CRON_SECRET`) in its environment, never from a file, and refuses plain
http off localhost. It exits 0 for ready (and degraded, unless
`--fail-on-degraded`), 1 for degraded with `--fail-on-degraded`, 2 for not
ready, unreachable, 401, an unreadable answer or a SHA mismatch, and 64 for a
usage error. `--expect-sha <sha>` or `--expect-promoted` (the newest receipt in
`docs/release/receipts/`) fails a deployment serving another commit; `--json`
prints one machine-readable line; `--notify` raises a macOS notification on
any non-zero exit. Run it every five minutes; a non-zero exit is the page.

## Alert rules

| Alert               | Condition                                                                   | Severity |
| ------------------- | --------------------------------------------------------------------------- | -------- |
| Connection errors   | `connectionErrors24h > 0` for any organisation for 15 minutes               | page     |
| Checkpoint failures | `checkpointFailures24h > 3` per location                                    | ticket   |
| Ambiguous publishes | `ambiguousPublishAttempts > 0` for 15 minutes                               | page     |
| Webhook backlog     | `failedWebhookEvents > 25` or `oldestFailedEventAgeSeconds > 900`           | page     |
| Dead letters        | `deadWebhookEvents > 0`                                                     | ticket   |
| Scheduler silent    | `schedulerHeartbeatStale` is true (the endpoint applies the 5-minute rule)  | page     |
| Tick silent         | any `schedulerTicks[].stale` is true, other than during a deliberate pause  | page     |
| Tick never ran      | `neverCompleted` past `registeredAt` + `staleAfterSeconds`                  | page     |
| Lock wedged         | any `schedulerTicks[].lockWedged` is true                                   | page     |
| Cycle overdue       | any `schedulerTicks[].cycleStale` is true                                   | ticket   |
| Refresh token cliff | `refreshTokensExpiringSoon > 0`                                             | ticket   |
| Overdue purge       | `pendingPurgeAgeSeconds > 86400`, or `heldPurgeLocations` non-zero and flat | ticket   |
| Reconcile stale     | `reconcileStalenessSeconds > 3600`                                          | ticket   |
| Sweep stale         | `sweepStalenessSeconds > 172800`                                            | ticket   |
| Reconcile behind    | `dueReconcileBacklog` rising for 15 minutes                                 | ticket   |
| Quota pressure      | any `googleQuota[].blocked`, or a bucket throttled on consecutive scrapes   | ticket   |
| Listing access lost | `listingsAccessLost > 0` (the tenant is also emailed)                       | ticket   |
| Not ready           | the readiness probe exits 2 (503, unreachable, 401 or release mismatch)     | page     |
| Degraded            | readiness `degraded` for longer than a deliberate pause or config change    | ticket   |

The health tick (`/api/cron/health`, every 15 minutes) evaluates the same
conditions per tenant and emails owners and admins itself (see
`docs/runbook.md`, "Notifications and alert email"); it also opens
`platform_incident` rows and emails `OPS_ALERT_EMAILS` for a tick that used to
complete and has stopped, and for Google rate limiting in the last 15
minutes. A tick that has never completed is reported here but not emailed.
The scrape and these rules remain the operator's view; the tick is what makes
alerting work with nobody watching a dashboard.

`heldPurgeLocations` is not a failure: a legal hold is meant to outrank the
seven-day disconnect promise. It is a ticket because a number that never falls
is a deletion obligation waiting on a hold nobody released.

Create dashboard panels for every health field and for p50/p95/p99 provider
and tenant-transaction duration. Break down Google request failures by HTTP
status and mode; break down tenant transaction errors by tenant only in the
restricted operations workspace.

## Scheduler and runner log events

The health endpoint says what is queued; these say why. All are emitted as
structured JSON — the first four by `scripts/scheduler.mjs` only, the rest by
the web process. On Vercel there is no scheduler process: a lock skip returns
200 `{ skipped: true }` with no log line, and a cursor reset logs
`cron.cursor_reset`.

| Event                        | Level | Means                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<tick>.skipped`             | warn  | `reason: "previous_run_active"` (the last run has not returned) or `"lease_held"` (another process holds the advisory lock, and `consecutive` counts how many ticks in a row have bounced off it). Never accompanied by `<tick>.completed`, so a wedged lease cannot look like an idle fleet. |
| `<tick>.cursor_reset`        | warn  | Three ticks in a row died on the same cursor, so the walk was sent back to the head. Names the organisation the walk cannot get past.                                                                                                                                                         |
| `<tick>.truncated`           | warn  | The route stopped on its own budget and handed back a cursor; `skippedOrganisations` is what that page did not reach. Performance, keywords and presence resources only.                                                                                                                      |
| `<tick>.failed`              | error | The tick threw. `cursor` names the organisation it died on, `retrying` says whether a bounded back-off will try again before the next interval.                                                                                                                                               |
| `jobs.kinds_paused`          | warn  | A kill switch narrowed the claim. Carries the three flags and the kinds still being claimed; the heartbeat stays fresh, so this is the only signal that work is deliberately not happening.                                                                                                   |
| `jobs.leases_reclaimed`      | warn  | `reclaim_expired_jobs()` returned rows whose lease outlived their holder, counted per kind. Costs no retry budget. Repeated reclaims of one kind mean items are outliving the lease (tick budget plus 60s), not that they are failing.                                                        |
| `leases.heartbeat_failed`    | warn  | A tick completed but could not stamp its `ops_heartbeat` row, so it will read as stale. Liveness bookkeeping never fails the tick that succeeded.                                                                                                                                             |
| `sync.recurring_enqueued`    | info  | A reconcile/performance/keywords cron fire armed the fleet: `organisations` with linked locations, `queued` rows created or re-armed. |
| `jobs.recurring_failed`      | error | A recurring run threw before its own settle; it retries in a few minutes. |
| `google.rate_budget_deferred` | warn | A request could not get a shared-budget slot before its deadline and was deferred as `google_rate_limited`. |
| `google.rate_budget_unavailable` | warn | The budget could not be read within 2s; the request went ahead on local pacing (fail-open). |
| `google.operator_configuration_error` | error | Google answered 403 with a project-level reason (API disabled, access not configured): an operator fault, not a tenant's. |
| `google.connection.stale_rejection_ignored` | info | A rejection from an older credential generation, or after a disconnect, was dropped instead of flagging the connection. |
| `google.risc_event`          | info  | A verified RISC event was applied; `matchedConnections` says how many connections it reached. |
| `notifications.tick`         | info  | One health tick: incidents opened/resolved, deliveries sent/suppressed/failed, platform incidents. |
| `notifications.delivery_failed` | warn | An alert email failed; `willRetry` says whether it is backed off or given up (after 5 attempts). |
| `ops.platform_incident_opened` | warn/error | An operator incident opened; error when nobody could be emailed. |
| `<tick>.organisation_failed` | error | One tenant failed and the walk carried on. On the session and local-scheduler POST paths, a paused `GBP_PERFORMANCE_ENABLED` / `GBP_KEYWORDS_ENABLED` produces one of these per tenant per tick with `sync_paused`; that is the pause, not an incident. The Vercel cron GETs only enqueue, and the pause holds at the runner claim.                                                                                      |

## Alert response

1. Correlate the alert timestamp with request, database, Google, webhook, and
   jobs spans.
2. Use the kill-switch table in `docs/runbook.md` to pause the narrowest
   affected capability. Every flag needs an environment change plus a
   redeploy to take effect; when background provider traffic has to stop
   sooner, disable the project's Vercel Cron Jobs and expect
   `schedulerHeartbeatStale` and every entry in `schedulerTicks` to go stale
   and page — silence those alerts deliberately rather than reading them as a
   second failure. A `RETENTION_ENABLED=false` deployment is the same case in
   miniature: on Vercel the retention cron still fires and receives 503
   `retention_paused`, so that one tick reports stale for the length of the
   pause.
3. Preserve the health payload and redacted alert notification in the live
   certification evidence file.
4. Fix forward; do not delete failed, dead, or ambiguous records to clear an
   alert.
