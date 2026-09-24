# Observability

NabaPresence registers OpenTelemetry with service name `nabapresence`.
Set `OTEL_EXPORTER_OTLP_ENDPOINT` on the web and jobs processes to the
environment's OTLP collector. Keep tenant identifiers as restricted telemetry
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
  `performance`, `keywords`, `presence-resources`, `sweep`, `health`) with
  `lastCompletedAt`, `staleAfterSeconds` and `stale`

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
change moves the threshold with it. `naba:sweep` is deliberately absent: the
sweep route holds no advisory lease, so nothing stamps a row for it and
reporting one would be a permanent false alarm. (Since 0046 the sweep's fleet
enqueue does take `naba:sweep`, so `sweep` is now listed.)

The `scheduler` row is stamped at the start of every authenticated jobs run,
including one that claims nothing because a kill switch is off, so it does not
certify that work is being done — `jobs.kinds_paused` in the logs is what says a
flag is holding the runner back. Scrape the health endpoint once per minute.
Treat a missing heartbeat as silent.

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
| Refresh token cliff | `refreshTokensExpiringSoon > 0`                                             | ticket   |
| Overdue purge       | `pendingPurgeAgeSeconds > 86400`, or `heldPurgeLocations` non-zero and flat | ticket   |
| Reconcile stale     | `reconcileStalenessSeconds > 3600`                                          | ticket   |
| Sweep stale         | `sweepStalenessSeconds > 172800`                                            | ticket   |
| Reconcile behind    | `dueReconcileBacklog` rising for 15 minutes                                 | ticket   |
| Quota pressure      | any `googleQuota[].blocked`, or a bucket throttled on consecutive scrapes   | ticket   |
| Listing access lost | `listingsAccessLost > 0` (the tenant is also emailed)                       | ticket   |

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
structured JSON — the first four by `scripts/scheduler.mjs`, the rest by the
web process.

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
| `<tick>.organisation_failed` | error | One tenant failed and the walk carried on. A paused `GBP_PERFORMANCE_ENABLED` / `GBP_KEYWORDS_ENABLED` produces one of these per tenant per tick with `sync_paused`; that is the pause, not an incident.                                                                                      |

## Alert response

1. Correlate the alert timestamp with request, database, Google, webhook, and
   jobs spans.
2. Use the kill-switch table in `docs/runbook.md` to pause the narrowest
   affected capability. Every flag needs a restart of the web and scheduler
   processes to take effect; when background provider traffic has to stop
   sooner, stop the scheduler process and expect `schedulerHeartbeatStale` and
   every entry in `schedulerTicks` to go stale and page — silence those alerts
   deliberately rather than reading them as a second failure. A
   `RETENTION_ENABLED=false` deployment is the same case in miniature: the
   scheduler registers no retention tick, so that one tick reports stale for
   the length of the pause.
3. Preserve the health payload and redacted alert notification in the live
   certification evidence file.
4. Fix forward; do not delete failed, dead, or ambiguous records to clear an
   alert.
