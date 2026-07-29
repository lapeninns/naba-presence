# Operations runbook

## Deployment gate

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
`pnpm db:migrate`, and `pnpm db:status`. Run `pnpm test:integration` against a
disposable PostgreSQL database with the documented runtime test role. Confirm
the OAuth redirect URI, Pub/Sub OIDC audience/service account, optional
verification token, cron secret, and OpenAI model names in the deployment
environment. Never log environment values or decrypted Google tokens.

Before a canary, confirm `DRAFTS_ENABLED`, `PUBLISH_ENABLED`, `SYNC_ENABLED`,
and `WEBHOOKS_ENABLED`. Roll back to read-only by disabling publishing and
drafting first; pause sync/webhooks only when data ingestion itself is unsafe.
Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the production collector. Next.js request
spans, tenant-scoped database spans, Google provider spans, latency/outcome
histograms and redacted structured error logs use the `nabareview` service name.
Set `NEXT_OTEL_VERBOSE=1` temporarily when deeper framework spans are needed.

## Scheduled work

- Run one `pnpm start:scheduler` process alongside the web process. It exhausts
  the content-free tenant routing cursor every 15 minutes for reconciliation
  and every 24 hours for retention; overlapping runs are skipped. Set
  `SCHEDULER_BASE_URL` to the internal web-service URL.
- Alert on failed sync checkpoints, connections in `expired`/`error`, publish
  attempts in `ambiguous`, and unprocessed webhook events older than five
  minutes.
- Poll `GET /api/operations/health` from an owner/admin observability context
  for sync freshness, webhook backlog, OAuth state, publish outcomes, and
  moderation rejection codes.

## Incidents

### OAuth or token refresh failures

Disable new connects if failures are global. Verify the Google project, consent
screen, redirect URI, client secret, and API access status. Individual expired
connections should be reconnected; never ask a customer to send a refresh token.

### Pub/Sub delivery failure

Verify the push URL, OIDC audience, issuer and pinned service-account email,
inspect the subscription backlog/dead-letter topic, then replay a selected
failed event through `POST /api/webhooks/google/pubsub/replay` or run tenant
reconciliation. Keep publishing available only if review freshness is
trustworthy.

### Quota storm

Pause backfills, retain notification ingestion, reduce per-tenant concurrency,
and retry 429/5xx responses with exponential backoff and jitter.

### Ambiguous publish

Do not immediately repeat the write. Fetch the latest Google review/reply state
first, compare the intended body hash, and only then record a new attempt.

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
