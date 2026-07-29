# Architecture and data controls

## Request boundary

Browser requests resolve an opaque, HTTP-only session token. The server hashes
that token before lookup, binds the resulting user and organisation to the
request, and opens every tenant data operation in a transaction that sets
`app.organisation_id`. PostgreSQL row-level policies then default-deny records
from every other organisation.

Arbitrary tenant headers are never accepted. Owner/admin, member, viewer,
location access, and publish authority checks happen above the database RLS
boundary.

Two content-free routing tables intentionally sit outside tenant RLS:
`webhook_route` maps a globally unique Google location name to its tenant, and
`organisation_job_route` lets authenticated cron workers enumerate tenant IDs.
They contain no customer content; every follow-on operation immediately enters
`withTenant`.

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

## Reply safety

The model produces a draft only. Structured output is validated against a strict
JSON Schema. A second stage applies deterministic personal-data, promotion,
unsupported-commitment, unsafe-language, location, byte-length, and complaint
checks, followed by semantic evidence verification. A `fail` verdict is a hard
publish block. Human approval is enabled for every new organisation.

Publish idempotency is derived from organisation, review, and reply-body hash.
Each provider attempt is recorded before the Google call. Ambiguous failures
are kept distinct from deterministic provider rejection, verified by a provider
read before retry, and represented in an append-only attempt-event ledger.

## Retention

Google source payloads, review text, reviewer display names, addresses, and media
links carry an expiry no later than the organisation’s configured window, which
is database-constrained to 30 days. `/api/cron/retention` purges expired raw
content while retaining minimal derived operational metrics. An owner-approved
legal hold blocks purge only for its selected review. Privacy access,
rectification, erasure, and restriction requests have an attributable workflow;
exports contain only still-retained content.

Disconnect immediately destroys stored OAuth tokens and disables notifications.
External location data is scheduled for deletion within seven days. Audit rows
are append-only by database trigger.

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
- The CI database `nabareview_test` in `.github/workflows/ci.yml`.
- Historical plan and evidence documents under `docs/superpowers/`, which keep
  pre-rename spellings except where they specify a not-yet-implemented metric
  name or user-facing string.

Identifiers already migrated alongside the design-system replacement stay in
their new form (do not rename back): module paths `lib/naba-presence-api.ts`
and `components/naba-presence/`, the compose project `nabapresence-local` with
local database `nabapresence`, the Supabase local project id `nabapresence`,
and harness/bootstrap addresses (`harness-…@nabapresence.test`,
`local-owner@nabapresence.local`).
