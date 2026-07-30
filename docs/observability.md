# Observability

NabaPresence registers OpenTelemetry with service name `nabapresence`.
Set `OTEL_EXPORTER_OTLP_ENDPOINT` on the web and jobs processes to the
environment's OTLP collector. Keep tenant identifiers as restricted telemetry
attributes and never attach review text, reply bodies, access tokens, or email
addresses.

## Metric catalog

All application-owned metric names use the `nabapresence.` prefix.

| Metric | Type | Unit | Attributes | Source and purpose |
|---|---|---:|---|---|
| `nabapresence.tenant_transaction.duration` | histogram | ms | `tenant.id`, `outcome` | `lib/server/db.ts`; latency of an RLS-scoped transaction |
| `nabapresence.tenant_transaction.count` | counter | 1 | `tenant.id`, `outcome` | `lib/server/db.ts`; successful and failed RLS-scoped transactions |
| `nabapresence.google.request.duration` | histogram | ms | `server.address`, `http.request.method`, `http.response.status_code`, `nabapresence.google.mode`, `outcome` | `lib/server/google.ts`; provider latency including pacing and safe-read retries |
| `nabapresence.google.request.count` | counter | 1 | same as request duration | `lib/server/google.ts`; provider request outcomes |
| `nabapresence.webhook.discarded` | counter | 1 | `reason` | `app/api/webhooks/google/pubsub/route.ts`; permanently malformed or unroutable deliveries acknowledged as discarded |

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

- `failedWebhookEvents`
- `deadWebhookEvents`
- `oldestFailedEventAgeSeconds`
- `ambiguousPublishAttempts`
- `staleStartedAttempts` (a `started` publish older than 10 minutes)
- `dueJobBacklog` (due webhook, checkpoint, and publish work)
- `checkpointFailures24h`
- `connectionErrors24h`
- `schedulerHeartbeatAt`

The cron-authenticated jobs runner upserts the `scheduler` row in
`ops_heartbeat` whenever a run starts. Scrape the health endpoint once per
minute. Treat a missing heartbeat as silent.

## Alert rules

| Alert | Condition | Severity |
|---|---|---|
| Connection errors | `connectionErrors24h > 0` for any organisation for 15 minutes | page |
| Checkpoint failures | `checkpointFailures24h > 3` per location | ticket |
| Ambiguous publishes | `ambiguousPublishAttempts > 0` for 15 minutes | page |
| Webhook backlog | `failedWebhookEvents > 25` or `oldestFailedEventAgeSeconds > 900` | page |
| Dead letters | `deadWebhookEvents > 0` | ticket |
| Scheduler silent | `schedulerHeartbeatAt` is missing or `now() - schedulerHeartbeatAt > 5 minutes` | page |

Create dashboard panels for every health field and for p50/p95/p99 provider
and tenant-transaction duration. Break down Google request failures by HTTP
status and mode; break down tenant transaction errors by tenant only in the
restricted operations workspace.

## Alert response

1. Correlate the alert timestamp with request, database, Google, webhook, and
   jobs spans.
2. Use `docs/runbook.md` to pause the narrowest affected capability.
3. Preserve the health payload and redacted alert notification in the live
   certification evidence file.
4. Fix forward; do not delete failed, dead, or ambiguous records to clear an
   alert.

