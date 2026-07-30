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
Database migrations are roll-forward-only. Before a migration rollout, capture
a restorable database snapshot and retain the currently deployed application
image. If the migration or post-migration verification fails, restore the
snapshot and redeploy that exact previous image as one rollback unit; do not
run ad-hoc down migrations.
Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the production collector. Next.js request
spans, tenant-scoped database spans, Google provider spans, latency/outcome
histograms and redacted structured error logs use the `nabapresence` service name.
Set `NEXT_OTEL_VERBOSE=1` temporarily when deeper framework spans are needed.

## Scheduled work

- Run one `pnpm start:scheduler` process alongside the web process. It exhausts
  the content-free tenant routing cursor every 15 minutes for reconciliation
  and every 24 hours for retention, and calls `/api/jobs/run` every 60 seconds
  to drain due webhook, checkpoint, and publish-attempt work. Overlapping runs
  are skipped by advisory locks. Set `SCHEDULER_BASE_URL` to the internal
  web-service URL and use the same `CRON_SECRET` as the web process.
- Alert on failed sync checkpoints, connections in `expired`/`error`, publish
  attempts in `ambiguous`, and unprocessed webhook events older than five
  minutes.
- Poll `GET /api/operations/health` from an owner/admin observability context
  or poll `GET /api/operations/health?scope=platform` with the cron bearer
  credential. Route page-severity alerts to the on-call service and
  ticket-severity alerts to the operations queue; exact thresholds and fields
  are in `docs/observability.md`.

### Jobs runner

The scheduler normally invokes `POST /api/jobs/run` with
`Authorization: Bearer ${CRON_SECRET}`. During an incident, first inspect the
platform health payload and tenant-scoped
`GET /api/webhooks/google/pubsub/failures`. A jobs run is idempotent and can be
triggered manually with the cron credential after the underlying dependency is
healthy. Never delete failed work to make a dashboard green.

For failed webhook events, correct routing/token/provider health and run the
jobs worker. After the retry budget is exhausted the event becomes `dead`.
Preserve its redacted payload and failure history, correct the cause, then use
the authenticated replay route for the selected event. Confirm the original
event is terminal and the replayed event becomes processed; do not bulk-replay
an unbounded dead-letter set.

Ambiguous publish attempts are claimed automatically by the jobs worker. It
reads the provider state, compares the intended reply body, records an
`ambiguity_checked` event, and settles the attempt without blindly repeating a
write. If automatic work is blocked, an engineer may invoke the exported
`recoverAttempt({ organisationId, attemptId })` escape hatch from
`lib/server/publishing.ts` in a controlled one-off process using the runtime
role. Capture the result and attempt-event sequence. Never change an ambiguous
row directly.

Every authenticated jobs run updates the `scheduler` row in `ops_heartbeat`.
A missing heartbeat or one older than five minutes pages on-call. Verify the
scheduler process, web reachability, matching cron secrets, advisory-lock
holders, and database connectivity, then run one manual jobs tick and confirm
the heartbeat advances.

## Incidents

### OAuth or token refresh failures

Disable new connects if failures are global. Verify the Google project, consent
screen, redirect URI, client secret, and API access status. Individual expired
connections should be reconnected; never ask a customer to send a refresh token.

### Pub/Sub delivery failure

Verify the push URL, OIDC audience, issuer and pinned service-account email,
inspect the subscription backlog/dead-letter topic, then replay a selected
failed event through `POST /api/webhooks/google/pubsub/replay` or run tenant
reconciliation. Use the failures listing route and dead-letter procedure above
to ensure retries are bounded and auditable. Keep publishing available only if
review freshness is trustworthy.

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
