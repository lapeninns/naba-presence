# NabaReview

NabaReview is a Google-only reputation operations SaaS. It connects authorised
Google Business Profile accounts, ingests reviews, drafts and verifies replies,
keeps a human approval boundary, publishes to Google, and exposes tenant-scoped
analytics.

## What is implemented

- Responsive review inbox, detail/editor, overview, analytics, connections, and
  policy settings
- Google OAuth with PKCE, encrypted refresh/access tokens, account and location
  discovery, location linking, backfill, reconciliation, and Pub/Sub ingestion
- AI reply drafting through the OpenAI Responses API with strict JSON Schema
- Deterministic and semantic verification; failed drafts cannot publish
- Idempotent Google reply update/delete workflow with moderation state and audit
- Pooled PostgreSQL schema with forced row-level tenant isolation and encrypted
  Google review identifiers
- 30-day maximum raw-content retention, legal holds, privacy workflows, audit
  export, and seven-day disconnect cleanup
- Pub/Sub OIDC verification, replay tooling, operational health metrics, and
  rollback feature flags
- OpenTelemetry request/provider/database spans and metrics, plus redacted
  structured logs with request and tenant correlation

The interface keeps a preview dataset available if the configured database is
offline. The “Live data” indicator appears when API-backed data is active.

## Local setup

1. Copy `.env.example` to `.env` and fill the values.
2. Apply the database schema:

   ```bash
   pnpm db:migrate
   pnpm db:status
   ```

3. Start the application:

   ```bash
   pnpm dev
   ```

   Production deployments run the web process and one scheduler process:

   ```bash
   pnpm start
   pnpm start:scheduler
   ```

4. Open `http://localhost:3000`. In non-production environments, `/api/session`
   creates a local owner session. Production users are provisioned on their first
   successful Google OAuth connection.

### Docker Compose

Run the complete local production stack without changing `.env`:

```bash
docker compose up --build
```

This starts PostgreSQL 17, applies migrations once, starts the standalone web
image, and starts the reconciliation/retention scheduler. PostgreSQL is exposed
only on `127.0.0.1:54329`. The loopback-only stack enables a local owner
bootstrap session, so the production web container uses the Docker database
without requiring Supabase or Google OAuth. `NABAREVIEW_NODE_IMAGE` can override
the default `node:22-alpine` build image when using a registry mirror or
compatible cached Node 22 image. Remove the disposable database with:

```bash
docker compose down --volumes
```

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:a11y
```

`pnpm test` applies the full migration to an embedded PostgreSQL runtime. CI
also applies it to PostgreSQL 17 and runs `pnpm test:integration` as a
non-owner runtime role to prove cross-tenant RLS behaviour.

Development and production builds intentionally use Next.js 16’s supported
webpack path because Turbopack can spawn runaway PostCSS workers in this
project.

## Google configuration

Enable the Account Management, Business Information, Business Profile, and
Notifications APIs. Add this OAuth redirect URI:

```text
{NEXTAUTH_URL}/api/google/connect/callback
```

Use `business.manage`, configure offline access, and point a verified Pub/Sub
push subscription at:

```text
POST {NEXTAUTH_URL}/api/webhooks/google/pubsub
```

Configure the push subscription with an OIDC service account, set
`GOOGLE_PUBSUB_AUDIENCE` to the exact push audience and optionally pin
`GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL`. A constant-time verification token can
be required in addition. Google API access, OAuth verification, end-client
authorisation, and the storage-policy interpretation must be approved before
general availability.

## Operational references

- [Architecture and data controls](docs/architecture.md)
- [Operations runbook](docs/runbook.md)
- [Requirement traceability matrix](docs/requirements-matrix.md)
- [Design system decision](docs/specs/2026-07-28-design-system.md)
- Original design-system proof sheet: `/design-system`
