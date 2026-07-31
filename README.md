# NabaPresence

**Nab a Presence.** NabaPresence is a Google Business Profile management
platform. Users sign in with an email and password; an organisation owner or
admin separately connects the organisation's authorised Google Business
Profile account. NabaPresence ingests reviews, drafts and verifies replies,
keeps a human approval boundary, publishes to Google, and exposes tenant-scoped
analytics.

## What is implemented

- Location-centred workspace covering profile identity and reviews, plus a
  cross-location review inbox, organisation roll-up, reply performance
  reporting, Google connection management, team access, and compliance tools
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

The interface only displays tenant-scoped, API-backed records from the
configured database. It does not substitute preview or mock reviews when the
database is unavailable.

## Local setup

1. Install dependencies, copy `.env.example` to `.env`, and fill the application
   secrets:

   ```bash
   pnpm install
   cp .env.example .env
   ```

2. Start Docker Desktop (or another Docker-compatible runtime), then start the
   local Supabase stack and create the non-superuser runtime login:

   ```bash
   pnpm supabase:start
   pnpm supabase:status
   pnpm db:runtime-role
   ```

   Supabase CLI runs PostgreSQL 17 and the Supabase services in Docker, then
   automatically applies every migration in `supabase/migrations`. The local
   database is at `127.0.0.1:54322`, the API at `127.0.0.1:54321`, Studio at
   `127.0.0.1:54323`, and the test email inbox at `127.0.0.1:54324`.
   `DIRECT_DATABASE_URL` is the migration/admin connection only.
   `DATABASE_URL` must use the `naba_test_runtime` login locally, or another
   non-superuser member of `naba_app_runtime` in a deployment. The application
   refuses an RLS-bypassing production identity at startup.

3. Start the application:

   ```bash
   pnpm dev
   ```

   Production deployments run the web process and one scheduler process:

   ```bash
   pnpm start
   pnpm start:scheduler
   ```

   The scheduler runs reconciliation, retention, and a third jobs tick that
   drains due webhook, checkpoint, and publish-recovery work through
   `/api/jobs/run`.

4. Open `http://localhost:3000`. Production users start at `/sign-in`, create
   an email/password account, and confirm ownership of the email address.
   Invited users open the one-time `/invite/{token}` URL and continue with the
   invited email; acceptance adds them to the inviting organisation rather than
   creating a new one. Google OAuth is not an application sign-in method: an
   owner or admin connects it once from `/settings/connections`, and the
   resulting connection remains attached to the organisation when users sign
   in from other devices.
   Local development may enable `LOCAL_BOOTSTRAP_ENABLED=true`, which lets
   `/api/session` create a local owner session without Google.

To rebuild the local database from the committed migrations, or to stop the
local stack while preserving its Docker volume:

```bash
pnpm supabase:reset
pnpm supabase:stop
```

`supabase:reset` destroys local database data. The local Supabase stack is for
development only and must not be exposed publicly.

For a hosted Supabase project, link it explicitly with `pnpm supabase link`,
review with `pnpm supabase db push --dry-run`, and then use
`pnpm supabase db push`. The existing `pnpm db:migrate` command remains
available for deployments to a direct PostgreSQL URL.

### Production-style Docker Compose

Run the complete local production stack without changing `.env`:

```bash
docker compose up --build
```

This separate stack starts a plain PostgreSQL 17 container, applies migrations
once, starts the standalone web image, and starts the reconciliation/retention
scheduler with its jobs worker tick. Use it to exercise the production
container topology; normal local
development uses Supabase CLI above. PostgreSQL is exposed only on
`127.0.0.1:54329`. The loopback-only stack enables a local owner bootstrap
session, so it does not require hosted Supabase or Google OAuth.
`NABAPRESENCE_NODE_IMAGE` can override the default `node:22-alpine` build image.
Remove this disposable Compose database with:

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

`pnpm test` runs the unit and contract suites; its embedded PGlite migration
contract applies only `0001_initial.sql`. CI separately runs `pnpm db:migrate`
against PostgreSQL 17, creates a non-superuser runtime login with
`pnpm db:runtime-role`, builds the standalone server, and runs the integration
and browser suites through that runtime role.

Development and production builds intentionally use Next.js 16’s supported
webpack path because Turbopack can spawn runaway PostCSS workers in this
project.

## Email and password authentication

Supabase Auth is the credential authority. NabaPresence never receives or
stores a password hash; after Supabase verifies an email/password or email
token, NabaPresence provisions the identity and issues its own opaque,
HTTP-only, database-backed session.

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, enable email confirmations,
configure the application URL and redirect allow list, and use the committed
confirmation and recovery templates. The local Supabase CLI reads those
settings from `supabase/config.toml`; messages appear in Inbucket at
`http://127.0.0.1:54324`. For a hosted project, copy the templates from
`supabase/templates/` into Authentication → Email Templates and configure
custom SMTP before production. The templates deliberately send token hashes to
`/auth/confirm`, allowing the server to verify the link without exposing a
provider session in a URL fragment.

## Google configuration

Enable the Account Management, Business Information, Business Profile, and
Notifications APIs. Google OAuth connects organisation data and is restricted
to signed-in owners/admins; it does not create an application account. Add this
OAuth redirect URI:

```text
{NEXTAUTH_URL}/api/auth/callback/google
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
- [Backend, API, and frontend feature map](docs/frontend-backend-feature-map.md)
- [Design-system palette specification](docs/specs/2026-07-28-design-system.md)
- [Full design-system replacement specification](docs/superpowers/specs/2026-07-29-full-design-system-replacement-design.md)
- [Full design-system replacement plan](docs/superpowers/plans/2026-07-29-full-design-system-replacement.md)
- Production design-system proof surface: [`/design-system`](/design-system)
- [UI DS-idiom rebuild design](docs/superpowers/specs/2026-07-28-ui-ds-idiom-rebuild-design.md)
