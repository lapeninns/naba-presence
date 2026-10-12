# Operations runbook

## Deployment gate

Release evidence is local. `pnpm verify:release` runs lint, typecheck, unit
tests, the build, migrations (append-only policy, from scratch, upgrade from
the last promoted commit, concurrent runs), integration and e2e, plus the
production audit and, when installed, gitleaks, on a fresh worktree and a
throwaway PostgreSQL 17 through the runtime test role, and writes the receipt
promotion requires (`docs/ci.md` §5). The GitHub workflows (`CI result`) run
the same graph but are not a gate and are not needed for a release; nothing
here waits on them. `pnpm verify:full` is the quicker check minus e2e.

Production migrations are **manual**: Vercel's build runs only
`next build --webpack`, and Production has no `DIRECT_DATABASE_URL`. The
operator runs `DIRECT_DATABASE_URL='<admin url>' pnpm db:migrate` and
`pnpm db:status` from their own machine, using the direct or session-pooler
(5432) URL; `db:migrate` refuses port 6543. Migrations must be expand-only
(backward compatible with the live deployment). When the new code needs the
new schema, migrate before promoting (verify, snapshot, migrate, promote,
below); keep each migration expand-only. Destructive changes go in a later
release. The
full procedure is in `docs/ci.md`, "Migrations".

Each build ships the list of migrations its code needs
(`lib/server/schema-manifest.ts`). In production, startup reads
`schema_migration` through the runtime role and refuses to serve when any of
them is missing (`startup.schema_incompatible`, then the boot fails); a
database ahead of the code is accepted. Before promoting a deployment, run
`DIRECT_DATABASE_URL='<admin url>' pnpm db:status --expect-current` from the
commit being deployed: it lists `pending` (in the repository, not applied)
and `unknown` (applied, not in this checkout) versions and exits 1 when
anything is pending. `DIRECT_DATABASE_URL` takes precedence over a local
`DATABASE_URL`, as in `db:migrate`; confirm the printed `target`
(host:port/database) is the production database. A cold start that fails on the schema check is fixed by
running `pnpm db:migrate`, not by rolling the code back.

Production is promoted only through `pnpm release:promote`
(`scripts/release/promote.mjs`; full procedure in `docs/ci.md` §7). Merging
does not deploy. In order:

1. Run `pnpm verify:release` on the `origin/main` commit and keep the receipt
   path it prints. Its base is the commit the newest committed promotion
   receipt shipped; before the first promotion, pass
   `--base-ref <the SHA production runs>` (`release.sha` from the platform
   health check). Do not touch the production database until it has passed:
   it is what proves the migrations apply from scratch and from production's
   schema.
2. Snapshot the database and note the current production deployment (the
   rollback unit below).
3. `DIRECT_DATABASE_URL='<admin url>' pnpm db:migrate`, then
   `DIRECT_DATABASE_URL='<admin url>' pnpm db:status --expect-current`.
4. From a fresh worktree of `origin/main`:
   `DIRECT_DATABASE_URL='<admin url>' pnpm release:promote --local-receipt <receipt> --dry-run`,
   then without `--dry-run`. It refuses a dirty worktree, a commit other than
   `origin/main`, a local receipt that is missing, for another commit, run
   with `--skip`, from a base other than the last promoted commit, or with
   any required step not passed, and pending migrations. It deploys with
   `NABA_RELEASE_SHA=<sha>` and writes a receipt under
   `docs/release/receipts/`, with the local receipt's bytes copied beside it
   as `<receipt>.local.json`.
5. Smoke: `GET /api/operations/health?scope=platform` with the cron bearer
   reports `release.sha` equal to the receipt's `sha` and
   `schema.compatible: true`. Then sign in and load the dashboard.
6. Commit both receipt files and copy the receipt's `sha` and
   `deploymentId` into `docs/live-certification/release-checklist.md`. The
   next release's gate reads that committed `sha` as its base.

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
not run ad-hoc down migrations. The previous deployment is the `deploymentId`
(and `sha`) of the newest committed receipt before this release's in
`docs/release/receipts/`. After a rollback, read the deployed cron list back
against that commit's `vercel.json`: Instant Rollback is not known to restore
cron configuration (ledger OPS-09).
Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the production collector. Next.js request
spans, tenant-scoped database spans, Google provider spans, latency/outcome
histograms and redacted structured error logs use the `nabapresence` service name.
Set `NEXT_OTEL_VERBOSE=1` temporarily when deeper framework spans are needed.

### Membership scope switch (0082/0083)

`lib/server/permissions.ts` decides member and viewer visibility from
`member.location_scope` alone: `assigned` with no `location_member` rows is
no access. The shadow compare that was meant to prove rows and scope agree
was never deployed (it was removed in the same branch), so before deploying
the reader switch, run this read-only check on staging and then production
through the session-pooler URL, and attach the counts to the PR as merge
evidence. Both counts should be zero after 0083's reconcile; any other
result, or an explicit owner sign-off replacing the observation, is recorded
against PERM-01 in `docs/release/ledger.md`.

```sql
select
  count(*) filter (
    where m.location_scope = 'all'
      and exists (
        select 1 from location_member lm
        where lm.organisation_id = m.organisation_id and lm.user_id = m.user_id
      )
  ) as all_with_rows,
  count(*) filter (
    where m.location_scope = 'assigned'
      and not exists (
        select 1 from location_member lm
        where lm.organisation_id = m.organisation_id and lm.user_id = m.user_id
      )
  ) as assigned_without_rows
from member m
where m.role in ('member', 'viewer');
```

`assigned_without_rows` is not wrong in itself (it is how "no clients" is
saved now), but each one must be explainable. Code older than 0082 that is
still live between migrating and deploying saves "All clients" by deleting
every row without writing the scope, which leaves the member `assigned` with
no rows: no access once this release is live, and the reconcile does not
repair it. After deploying, list the saves made in that window and have an
owner re-save each affected member (or deploy the code before applying 0083,
which avoids the window):

```sql
select a.organisation_id, a.subject_id as user_id, a.created_at
from audit_log a
join member m
  on m.organisation_id = a.organisation_id and m.user_id::text = a.subject_id
where a.action = 'member.client_access_changed'
  and a.created_at between '<0083 applied at>' and '<deploy promoted at>'
  and m.location_scope = 'assigned'
  and not exists (
    select 1 from location_member lm
    where lm.organisation_id = m.organisation_id and lm.user_id = m.user_id
  )
order by a.created_at;
```

### Prerequisites for the GBP operations programme release

The release that merges the GBP operations programme (PR #49) changes the AI
provider and adds schema. Production runs the previous revision with OpenAI
until then. Complete these steps, in order, before promoting it:

1. **Set the Workers AI variables** in the target Vercel environment. The
   environment schema no longer reads `OPENAI_API_KEY`, `OPENAI_ORG_ID`,
   `OPENAI_MODEL_DRAFT`, `OPENAI_MODEL_VERIFY`, `OPENAI_BASE_URL` or
   `OPENAI_TIMEOUT_MS`. If the new variables are missing, the OpenAI values are
   ignored without warning, and AI drafting and verification answer
   `503 ai_not_configured`.
   - Required: `WORKERS_AI_API_TOKEN` and `WORKERS_AI_ACCOUNT_ID` (32
     lower-case hex characters; any other value fails validation at startup).
   - Optional: `WORKERS_AI_MODEL` (accepts only `@cf/zai-org/glm-5.3-flash`,
     which is the default), `WORKERS_AI_BASE_URL` (default
     `https://api.cloudflare.com`) and `WORKERS_AI_TIMEOUT_MS` (default 30000,
     capped at 55000).
2. **Set `EMAIL_WEBHOOK_SECRET`** (the Resend `whsec_...` signing secret) to
   turn on `/api/webhooks/email`. If it is unset, the receiver answers 404 and
   the delivery evidence stops at provider acceptance.
3. **Apply the 19 new migrations, `0062_management_confirmation` to
   `0080_bulk_listing_operations`**, using the manual procedure above
   (snapshot first, then `pnpm db:migrate` and `pnpm db:status` against the
   session-pooler URL). Do this before you promote the deployment.
4. **Deploy and smoke-test** a synthetic draft and verification, as described
   in [Workers AI activation](workers-ai.md).
5. **Remove the `OPENAI_*` variables** only after the switch is verified.
   Rolling back to the previous revision needs them.

## Kill switches

Every flag is read once per process — `getServerEnv` parses `process.env` on
first use and memoises it — so flipping one takes an environment change **and** a
redeploy. None of the env flags is a hot switch. The hot switch is the
operator pause table (below, "Operator pauses"): it stops the same scopes on
every instance within five seconds, with no redeploy. When even that is not
available (the database itself is the problem), disable the project's Cron
Jobs in the Vercel dashboard (or the single cron for the offending tick)
instead:
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
| `RETENTION_ENABLED`         | The retention sweep returns 503 `retention_paused` and deletes nothing. On Vercel the retention cron still fires and receives 503 every five minutes, so expect failing fires for the length of the pause (the tick reports as paused, not stale); only the local `scripts/scheduler.mjs` skips registering the tick.                                                                |
| `RETENTION_DELETES_ENABLED` | Retention keeps redacting expired provider content but performs no irreversible delete of tenant data (ended abuse-limit counters, which hold none, are still purged). Prefer this to `RETENTION_ENABLED` when the concern is a suspect delete predicate rather than the sweep itself, so the redaction obligation keeps being met. |
| `NOTIFICATIONS_ENABLED`     | The health tick returns 503 `notifications_paused`: no incidents are evaluated and no alert email is sent. |
| `GOOGLE_RATE_BUDGET_ENABLED` | Google calls stop drawing from the shared Postgres budget and fall back to per-process pacing only. For a suspected budget fault, not a quota incident. |
| `ABUSE_LIMITS_ENABLED`      | Sign-in, registration, recovery, invitation, shared-report, support-impersonation and AI-draft requests stop counting against the Postgres abuse limits, so none answers 429 `auth_rate_limited` / `draft_rate_limited`. For a suspected limiter fault, not an attack. |
| `RISC_ENABLED`              | The RISC receiver answers 404. Revocations are then detected only at the next refresh or API call. |

Pause the narrowest switch that covers the failure. A paused flag is not a fix:
record why it is off and land the correction, because backlogs accrue behind
`JOBS_ENABLED` and `SYNC_ENABLED` for as long as they are down.

The runner enforces all three of its flags at the claim, not inside the work:
`claim_due_jobs` takes the permitted job kinds as an argument, so a paused kind
keeps its status and its `next_attempt_at` untouched. A tick that is claiming a
reduced set logs `jobs.kinds_paused` with the flags responsible. Nothing is
re-armed, and no retry or recovery budget is spent, while a flag is off.

### Billing enforcement

`BILLING_ENFORCEMENT_ENABLED` (default `false`) switches on central
entitlement enforcement (`lib/server/entitlement-policy.ts`). It is a hard
override: off, nothing is refused for billing, whatever an organisation's own
flag says. On, it applies only to organisations whose
`organisation_billing.enforcement_enabled` is true (and to any organisation
with no billing row). Roll it out per organisation from the operator
connection:

```sql
update organisation_billing set enforcement_enabled = true
where organisation_id = '<organisation id>';
```

An enforced read-only organisation gets 402 `billing_read_only` on new work;
its publish retries and bulk children wait an hour at a time instead of
reaching Google, and its scheduled posts are held like a publishing pause:
each runner tick re-checks the schedule, a due occurrence waits while it is
inside its grace period and is then marked missed. The `schedule_blocked`
incident (reason `billing_read_only`) opens once per occurrence, not per
tick. Its read-backs and syncs keep running.
Linking past the plan's location limit answers 402 `location_limit_reached`
(the onboarding creation and match links record it as their error code and
can be retried once a seat frees; creating a new Google location is refused
before Google is called); nothing is ever unlinked automatically. To stop
enforcing at once, set the env flag to `false` and redeploy, or clear the
organisation's flag.

The env flag reaches the location-limit trigger only through the app's
tenant transaction. A link written from an operator connection or a script
follows the organisation's own `enforcement_enabled` flag alone, even with
the env flag off. To link past the limit deliberately from the operator
connection, turn the trigger off for that one transaction:

```sql
begin;
set local app.billing_enforcement = 'off';
-- insert into location_link ... / update location_link set is_active = true ...
commit;
```

### Stripe billing (P07-S4)

Billing is off unless `BILLING_ENABLED=true`. Turning it on needs, all from
the operator, none of it in code: a Stripe account, the catalog rows in
`billing_plan` (with their `price_...` ids, seeded with `pnpm billing:catalog`,
see "Billing catalog" below), `STRIPE_SECRET_KEY` (a test key
with `BILLING_ENVIRONMENT=test`, a live key only with `live`), and a webhook
endpoint registered at `/api/webhooks/stripe` whose signing secret is
`STRIPE_WEBHOOK_SECRET`. Subscribe it to `customer.subscription.*`,
`invoice.*`, `checkout.session.*` and `subscription_schedule.*`; other types
are stored as `ignored`. A missing or mismatched value leaves billing
unavailable (webhooks answer 503, so Stripe keeps retrying for three days and
nothing is lost).

Receipts are processed on the job tick, and the hourly
`/api/billing/reconcile` cron re-syncs every organisation with a Stripe
customer. Each fire syncs as many organisations as fit in its 30-second
budget (`BILLING_RECONCILE_BUDGET_MS`) and resumes from its cursor the next
hour, so a full pass, and with it the repair of a lost webhook, takes
ceil(linked organisations / per-fire count) hours; watch
`select organisation_cursor from cron_cursor where name = 'billing'`: null
between fires means the last fire finished the walk. To stop processing without a redeploy, pause the `billing` scope
(`pnpm ops:pause`); receipts keep being recorded and are processed after the
pause lifts. Look at the inbox from the operator connection:

```sql
select status, last_error_code, count(*)
from billing_event group by 1, 2 order by 1, 2;
```

`held` with `customer_unknown` is an event for a customer no organisation has
(it retries every 15 minutes; holds do not use up its eight attempts). After
7 days held it becomes `ignored` with `customer_unknown`, and a handled event
that names no customer is `ignored` with `customer_missing` from the start;
reconciliation still covers any organisation linked later. A `received`
event can also be one a worker claimed and released unattempted when its
budget ran out; it is due again at once and no attempt was counted. `dead` needs a look: `billing_plan_unknown`
means a subscription bills a price with no catalog row for this environment;
add the plan version, then re-arm the event:

```sql
update billing_event
set status = 'failed', retry_count = 0, next_attempt_at = now()
where status = 'dead' and external_event_id = '<evt_...>';
```

### Checkout and plan changes (P07-S5)

Owners start subscriptions at `POST /api/billing/checkout`. In the test
environment checkout opens once billing is configured and an active plan
exists; in live it also needs `BILLING_TERMS_URL` (the approved terms, also
set as the terms URL in the Stripe dashboard's public details, which
Checkout's consent box links to) and `BILLING_AUTOMATIC_TAX=true` after Stripe
Tax is set up. `GET /api/billing` reports `checkout.reason` when it is
closed. Configure the Customer Portal so it does NOT allow plan switching
(plan changes are app-controlled and scheduled at the period end); set its id
as `STRIPE_PORTAL_CONFIGURATION_ID` or make it the default configuration.

A plan change is a subscription schedule. If one fails with
`billing_out_of_sync`, the record and Stripe disagree (usually a webhook not
yet processed): wait for the next tick or the hourly reconciliation. An
organisation's open checkout session is in
`organisation_billing.checkout_session_id`; it expires after an hour at
Stripe and is replaced on the owner's next attempt.

### Billing screens (P07-S6)

With `BILLING_ENABLED=true` owners get Settings › Billing and every member
gets Settings › Usage; with it off neither tab nor page exists. Before
anything is configured the Billing screen shows the plans with checkout
disabled ("Subscriptions are not available yet"), and with an empty catalog
it says no plans are on offer. A customer stuck on "Confirming subscription"
after three minutes means no webhook or reconciliation has applied the
subscription yet: check the `billing_event` inbox above, then the
organisation's `provider_synced_at`. Nothing is granted until it arrives.
A test environment shows "Test mode" and marks each plan "Test offer".

### Billing catalog (P07-S7)

The plan catalog is seeded per Stripe environment from a reviewed JSON file
with `scripts/billing-catalog.mjs`. Prices, limits and allowances are a
product-owner decision: keep the reviewed file with the release record, not
in the repository. The file names one environment and its plans:

```json
{
  "environment": "test",
  "plans": [
    {
      "code": "starter",
      "version": 1,
      "workspaceMode": "business",
      "name": "Starter",
      "stripePriceId": "price_...",
      "locationLimit": 3,
      "memberLimit": null,
      "aiDraftCreditsPerPeriod": 200,
      "isTestOffer": true,
      "active": true
    }
  ]
}
```

```sh
pnpm billing:catalog --file catalog.test.json --validate      # no database
DIRECT_DATABASE_URL=... pnpm billing:catalog --file catalog.test.json   # dry run
DIRECT_DATABASE_URL=... pnpm billing:catalog --file catalog.test.json --apply
DIRECT_DATABASE_URL=... pnpm billing:catalog --file catalog.live.json --apply --allow-live
```

- Every test-environment plan must be a test offer; a live plan never is; an
  active plan needs its Stripe price. The file is refused whole on any
  invalid entry.
- Re-running is safe. A version already in the database only has `active`
  set. Changing a published version's terms (price, limits, credits, name) is
  refused: add `version + 1` with the new terms and set the old one
  `active: false`. Organisations on the old version keep it until they
  change plan.
- An active plan the file does not list is reported and kept;
  `--deactivate-unlisted` retires it. Nothing is ever deleted.
- Applying a live catalog needs `--allow-live` and is a release operation
  that needs approval. Run the dry run first and keep its output.

### Stripe webhook backlog, reconciliation and poison events

- Backlog: `received` and `failed` rows in `billing_event` that keep growing
  mean the processor is not keeping up or is paused. Check the `billing`
  pause scope (`pnpm ops:pause status`), `BILLING_ENABLED` and the job tick;
  receipts are kept while paused and processed afterwards. Look at the
  oldest due event:

  ```sql
  select status, min(received_at), count(*)
  from billing_event where status in ('received', 'failed') group by 1;
  ```

- Reconciliation: the hourly `/api/billing/reconcile` cron repairs lost
  webhooks (see "Stripe billing" above for the cursor). To hurry a repair,
  call `GET /api/billing/reconcile` by hand with the cron bearer; each call
  continues the walk from the cursor.
- Poison events: an event that uses all its attempts is `dead`. It does not
  block the organisation's later events, because each sync refetches the
  provider's current state. Read `last_error_code`, fix the cause (usually a missing
  catalog row: seed it with `pnpm billing:catalog`), then re-arm it with the
  `update billing_event ...` statement under "Stripe billing" above. Never
  delete a receipt.

### Manual AI credit grants

Support can add AI draft credits to an organisation's current credit period.
A grant adds to the period's allowance and never resets used credits; it
ends with the period. It is recorded as an `ai_credit_period` row of kind
`adjustment` with the operator and the reason, and in the audit log
(`ai_credits.adjustment_granted`). Who may grant, and how much, is decision
D-33; until it is made, a grant needs the product owner's approval.

```sh
# Balance and grant history
curl -s -H "authorization: Bearer $CRON_SECRET" \
  https://<host>/api/operations/organisations/<organisation id>/ai-credits
# Grant (idempotent on reference: a retry replays, it never grants twice)
curl -s -X POST -H "authorization: Bearer $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"credits": 50, "reason": "Goodwill after the 3 Oct sync outage", "operator": "you@example.com", "reference": "ZD-1234"}' \
  https://<host>/api/operations/organisations/<organisation id>/ai-credits
```

- 409 `ai_credit_period_missing` or `ai_allowance_unknown`: there is no
  known allowance to add to (for example a subscription whose period billing
  has not granted yet). Fix billing first; nothing was granted.
- 409 `ai_credit_adjustment_conflict`: the reference already names a
  different grant. Use a new reference.
- The cron bearer is shared and carries no identity, so `operator` is what
  identifies you. Use your own address.
- `PUT` on the same route (`{"monthlyDraftCredits": n | null}`) still sets a
  pilot's calendar-month allowance. It answers 409
  `ai_credits_override_pilot_only` for any organisation that is not a pilot;
  clearing it (`null`) is always allowed.

### Operator pauses

`ops_pause_control` (migration 0090, `lib/server/pause-controls.ts`) holds one
row per scope: `jobs`, `publish`, `sync`, `notifications`, `retention`,
`drafts`, the Google surfaces (`profileWrites`, `posts`, `media`,
`placeActions`, `foodMenus`, `performance`, `keywords`), `scheduled_post`,
`bulk`, `invitation_email` (invitation emails: nothing is claimed while it is
paused, queued rows stay pending and go out after it lifts; Copy link keeps
working), the reserved `billing`, plus `mutation_recover` (the
uncertain-write recovery kind).
A paused row has the same effect as its env flag being off, at the same
places: the runner's claim, provider dispatch (`runGbpWrite`, the reply
pipeline, and the post and reply approval routes before any decision is
recorded), the performance and keyword ingestion boundaries (session POSTs
included), and the retention, health, reconcile, sweep, backfill, webhook
replay and drafts routes. The Pub/Sub push endpoint still answers to
`WEBHOOKS_ENABLED`/`SYNC_ENABLED` alone: under a table pause it records the
notification and the runner's `sync` claim holds the work.
Every instance picks a change up within the five-second pause cache.

```sh
DIRECT_DATABASE_URL=... pnpm ops:pause status
DIRECT_DATABASE_URL=... pnpm ops:pause pause --scope publish \
  --operator you@example.com --reason "Google incident: stop all writes"
DIRECT_DATABASE_URL=... pnpm ops:pause resume --scope publish \
  --operator you@example.com --reason "Google incident resolved"
```

- The env flag stays the hard override. `resume` lifts only the table's
  pause; a scope whose env flag is off stays paused until the redeploy.
- Every call appends an `ops_pause_event` row (scope, before/after, operator,
  reason). The table is append-only.
- `naba_app_runtime` can read both tables and cannot write either or run
  `set_ops_pause`, so this needs the owner/operator connection. Pausing
  production is an incident action; resuming it is a release operation that
  needs approval.
- A paused answer carries `details.pausedScopes`. If the pause table cannot
  be read, claims and Google writes stop (fail closed) and the answer says
  `pauseStateUnknown: true`; the liveness report keeps alerting (fail open).
- A tick held by its scope (`jobs`, `sync` for reconcile and sweep,
  `retention`, `notifications` for health) reports `paused: true` in
  `schedulerTicks` and raises no stale or never-completed alert while paused.
  A wedged lease is still alerted. The performance and keywords ticks only
  enqueue, keep completing under a pause of their scope, and stay alerted.
- Per-organisation product flags live in `organisation_feature` (off without
  a row): `pnpm ops:pause feature --organisation <uuid> --feature
  post_scheduling --enable --operator you@example.com`. The script refuses a
  feature name not listed in `lib/contracts/org-features.ts`.
- `post_scheduling` switches on one-time scheduled posts for an
  organisation; `post_scheduling_recurring` additionally allows daily, weekly
  and monthly schedules. With either off, a due schedule that needs it is
  blocked (`feature_disabled` / `recurring_disabled`), not deferred: after
  switching it back on, the schedule is changed and approved again. Repeating
  schedules quarantined by migration 0116 show as "Needs review"; find them
  with `select id, organisation_id from post_publication_schedule where
  status = 'needs_review'`, and legacy per-post times with `select post_id
  from gbp_local_post_legacy_schedule where status = 'needs_review'`.
- `listing_change_approvals` makes direct listing writes obey the
  organisation's two-person policy: with both on, a publisher's hours,
  profile, menu and media writes park as change requests that another
  publisher approves on the editor. (Business information, attributes,
  lodging and booking links are reviewed change sets that apply the policy
  without this feature.) Turning it (or the policy) off leaves parked requests
  `awaiting_approval`: the editors keep listing them, and they stay
  decidable there and through `POST /api/locations/{id}/change-requests/{id}`
  until someone approves, rejects or withdraws them. Find them with `select
  id, location_id, change_request ->> 'kind' from mutation_operation where
  state = 'awaiting_approval'`. Media uploads are refused (409
  `listing_change_upload_unsupported`) while it applies. An approval killed
  before its dispatch claimed an attempt settles `failed`
  (`approval_dispatch_interrupted`) after five minutes, on its receipt read or
  the daily retention run; one killed later settles with its attempt.

## Scheduled work

- Production background work runs as eight Vercel Cron entries in
  `vercel.json` (times UTC): `/api/jobs/run` every minute, `/api/sync/reconcile`
  and `/api/sync/presence-resources` every 15 minutes (staggered by 7 minutes),
  `/api/cron/health` every 15 minutes, `/api/cron/retention` every 5 minutes
  (see "Retention cycle" below), `/api/sync/performance` every 6 hours, and
  `/api/sync/sweep` and `/api/sync/keywords` once daily at 01:30 and 02:00. Each cron fires an HTTP GET at the
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
  own advisory lock, so an overlapping or duplicate fire answers 200
  `{ skipped: true }` (no reason and no log line on Vercel; `lease_held` is
  logged only by `scripts/scheduler.mjs`) instead of doing the work twice, and a missed fire
  only delays work — each queue keeps its due rows and the next fire starts at
  the head. A tick whose heartbeat goes stale while its fires return
  `skipped` is overlapping itself: lengthen that cron's interval, do not remove
  the lock.
- Pausing `GBP_PERFORMANCE_ENABLED` or `GBP_KEYWORDS_ENABLED` does not stop
  the cron calling that ingestion route. On Vercel the cron GET only enqueues
  checkpoints, and the pause is enforced when the jobs runner claims work, so
  checkpoints accumulate and drain after the pause. The per-tenant
  `performance.organisation_failed` / `keywords.organisation_failed` lines with
  503 `sync_paused` appear only on the session and local-scheduler POST paths;
  read them as the pause, not as an incident.
- Retention cycle. `/api/cron/retention` with no `cursor` is a dispatcher
  (`lib/server/retention/cycle.ts`). Each five-minute fire resumes the
  running cycle, or at or after 03:00 UTC opens the day's
  (`retention_cycle`, one row per UTC day), and works through it for
  `RETENTION_BUDGET_MS`: pending organisations first, then the next page of
  the fleet from the persisted `enumeration_cursor`, then, once enumeration
  has ended, organisations that failed on an earlier fire. Each organisation
  has a `retention_cycle_org` row with its status, attempts (counted before
  each run, so a killed fire uses one) and `last_error_code`
  (`attempt_interrupted` while a run is in flight, so a killed run stays
  visible); after three runs it stays `failed` (`attempts_exhausted` if every
  run was killed) and stops holding the cycle open. The cycle completes when
  enumeration has ended and nothing is left to run, and stamps
  `last_cycle_completed_at` on the `retention` tick (alerted as
  `tick_cycle_overdue` after 26 hours). Completing with failed organisations
  still stamps it, so those raise `tick_cycle_failures` instead (below). A
  second fire the same day, or any fire before 03:00 with nothing running,
  answers `cycle: null` and does nothing. Progress:
  `select cycle_date, status, enumerated, succeeded, failed,
  enumeration_completed_at from retention_cycle order by cycle_date desc
  limit 3`, and the failures:
  `select organisation_id, attempts, last_error_code from retention_cycle_org
  where status = 'failed' and cycle_id = '<id>'`. `enumerated` counts the
  organisations copied in; one deleted mid-cycle takes its row with it but
  stays counted (and in `failed` if it had failed), so `succeeded + failed`
  can stay below `enumerated` on a completed cycle. A failed organisation is
  retained again by the next day's cycle; to retain it now, run a hand page
  `POST /api/cron/retention?cursor=<the organisation id just before it>&batch_size=1`
  with the cron bearer. A hand page (any `cursor`, empty for the head) never
  moves the cycle and is recorded as a manual run. Completed cycles older
  than 35 days are pruned when a new one opens.
- Retention batches. Each organisation is purged in rounds
  (`lib/server/retention/purge.ts`): one tenant transaction per round, in
  which every dataset still behind changes at most `RETENTION_BATCH_ROWS`
  rows (500 by default, 1-10000). Rounds repeat until every dataset has
  caught up or `RETENTION_BUDGET_MS` passes; a run always commits at least
  one round. A run the budget stopped is reported under `partial` (with what
  it committed), logged as `retention.organisation_partial`, and leaves the
  organisation `pending` in its cycle with `resumes` incremented and the run
  handed back rather than counted as an attempt (up to 48 times, then each
  stopped run uses an attempt). Every round that changed rows writes a
  `retention.purge.round` audit (its counts, `round` and `batchRows`) in the
  same transaction, so each committed change is in `audit_log` even when the
  run later fails, is given up on, or is killed. `retention_cycle_org.counts`
  sums what each committed round changed, and the `retention.purge.completed`
  audit, written by the round that catches up, reports those totals as a
  summary; it can undercount a run killed after committing, so reconcile
  against the round audits. The row bound applies to the rows a statement
  selects, not to cascades: a disconnected location's reviews are deleted in
  bounded batches (`disconnectedReviews`) before the location itself goes,
  but the location's other children (metrics, attempts, posts, media) still
  go in its cascade. A hand page that stops inside an organisation answers a
  `nextCursor` just before it (the nil UUID at the head of the fleet), so
  following the cursor resumes it. A large backlog after an outage or a raised
  window drains over successive fires; watch
  `select organisation_id, resumes, counts from retention_cycle_org where status = 'pending' and resumes > 0`.
- Presence resources and retention are bounded by a per-page budget
  (`PRESENCE_RESOURCE_BUDGET_MS`, `RETENTION_BUDGET_MS`, 45000 by default), as
  are the session and scheduler POST paths of reconcile, performance and
  keywords (`RECONCILE_BUDGET_MS`, `PERFORMANCE_BUDGET_MS`,
  `KEYWORDS_BUDGET_MS`). Performance and keywords check the deadline between
  locations inside an organisation as well, so an owner's manual refresh
  returns `truncated: true` rather than running past it; the locations it did
  not reach stay due. The runner's own tick budget is 45 seconds inside a
  60-second function. The platform health walk is bounded by
  `OPERATIONS_HEALTH_BUDGET_MS` (20000) and reports `partial`.
- A presence-resource sweep records success only for a real Google read. A
  posts read that failed (the page still shows cached posts) records `failed`
  and keeps `last_succeeded_at`. The sweep always refreshes media past the
  five-minute cache.
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

Uncertain listing writes (hours, profile, menus, posts, media) are recovered
the same way by the `mutation_recover` kind (`lib/server/mutation-recovery.ts`,
claim arm in `supabase/migrations/0092_mutation_recovery_jobs.sql`); reviewed
change sets (business information, attributes, lodging, booking links) are
checked by a person instead (see "Unresolved lodging confirmation"). It claims
`mutation_operation` receipts in state `uncertain` whose `next_recovery_at` is
due, rechecks the actor's authorisation, reads Google back through the
surface's adapter and settles the receipt and its attempt row: `confirmed_applied`
(or `awaiting_confirmation` for a create identified by content) when the
write landed, `failed` when it did not. It never sends the write again; a
`failed` receipt is re-sent by a person from the editor. The same ladder
applies: an unreadable Google backs off and counts, eight counted failures
stop it as `recovery_exhausted`, a reconnect-blocked connection parks for 15
minutes without counting and is abandoned after 14 days
(`reconnect_abandoned`), and a disconnected location stops at once
(`connection_disconnected`). A write no readback can identify (a media create)
stops as `media_create_unverifiable`; an update whose target Google no longer
holds (a 404 on the link or media item) stops as `target_changed`, and a
receipt with no attempt row recorded, or a surface with no adapter, as
`recovery_unsupported`. The first tick after 0092 is deployed also reads back
every receipt that was already `uncertain`; those without an attempt row stop
at once and each sends one `mutation_unconfirmed` email, so expect a short
burst on that deploy. A stopped receipt stays `uncertain`
with `next_recovery_at` null, is audited as `mutation.recovery_abandoned`, and
opens a `mutation_unconfirmed` notification to the owners and admins asking
them to check Google. The kind answers to `PUBLISH_ENABLED`, the `publish`
pause and its own `mutation_recover` pause.

If automatic work is blocked, an engineer may invoke the exported
`recoverAttempt({ organisationId, attemptId })` escape hatch from
`lib/server/publishing.ts` in a controlled one-off process using the runtime
role. Capture the result and attempt-event sequence. Never change an ambiguous
row directly.

Every authenticated jobs run updates the `scheduler` row in `ops_heartbeat`,
including a run that claims nothing because a kill switch is off: the heartbeat
means "the scheduler reached the web process", so a pause must not read as a
dead scheduler. A missing heartbeat or one older than five minutes pages
on-call. Verify that the Vercel Cron Jobs are enabled and firing (project Cron
Jobs page and logs), that `CRON_SECRET` is set on the project, and check
advisory-lock holders and database connectivity, then run one manual jobs tick
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
`notification_delivery.status` (tenant) or `platform_incident_delivery.status`
(operators, one row per `OPS_ALERT_EMAILS` address) before telling anyone an
email went out. A delivery is unique per incident and recipient, is claimed
before the send and carries its own idempotency key, so re-running the tick
never double-emails; refused sends retry with back-off up to five attempts.
`uncertain` means the send timed out or lost its connection after the request
left: it may have been delivered. It is retried only inside the provider's
24-hour idempotency window; past that it stays `uncertain` and must not be
resent blindly — check the provider's dashboard for the recipient first.
Once any attempt was uncertain the row keeps `may_have_sent` (0096): a later
refusal or suppression settles it `uncertain`, never `failed`, and a requeued
row claimed after the window (a pause, a skipped tick) settles
`email_idempotency_window_expired` without sending.
`platform_incident.notify_status` is now only a summary of its deliveries.

### Stale heartbeat

The health tick emails `OPS_ALERT_EMAILS` and opens a `platform_incident`
for four tick findings, read from each tick's `ops_heartbeat` run ledger
(0089) and shown in `schedulerTicks` on the platform health endpoint, and for
retention cycle failures:

- `stale_heartbeat`: the tick used to complete and has not for
  `staleAfterSeconds`. Check `lastFailedAt`/`lastErrorCode` first: a tick that
  starts and fails needs the function logs; one with no recent
  `lastStartedAt` is not firing (Vercel Cron Jobs page, `CRON_SECRET`).
- `tick_never_completed`: no scheduled run has completed since `registeredAt`
  plus the same grace. A `lastManualCompletedAt` does not count: a customer
  refreshing proves the route works, not that the cron fires. Check the
  tick's entry in `vercel.json` and that its cron is enabled.
- `tick_lock_wedged`: three or more scheduled fires in a row found the
  advisory lock held. Find the holder in `pg_locks` (`locktype = 'advisory'`)
  joined to `pg_stat_activity`; a session stuck holding it releases the lock
  when its connection is terminated.
- `tick_cycle_overdue`: a tick that runs in cycles (retention) has not
  finished a walk over every organisation within `cycleStaleAfterSeconds`.
  Read the cycle's progress (see "Retention cycle" above) and the
  `retention.organisation_failed` logs.
- `tick_cycle_failures`: the latest completed retention cycle left
  organisations `failed` after every attempt, so their expired Google content
  was not purged (0098). The alert lists up to ten with their
  `last_error_code` and counts those that also failed in the cycle before
  (`repeated`), which points at a tenant that fails every day rather than a
  passing fault. Read the failures and retain them by hand (see "Retention
  cycle" above). It stays open while the next cycle runs and resolves once a
  cycle completes with none failed.

The incident resolves on the first health tick after the condition clears.
The health tick cannot alert on its own absence; the readiness probe is that
signal (below).

### Readiness probe failure

`pnpm ops:readiness` (`scripts/ops/readiness-probe.mjs`) exits non-zero and
prints the reasons from `GET /api/operations/readiness`
(docs/observability.md, "Readiness"). Triage by the first line:

- `unreachable` or `unreadable`: the deployment or its domain is down, or
  something other than the app answered. Check the Vercel deployment and its
  function logs before anything else.
- `unauthorised`: the probe's token is not the deployment's `CRON_SECRET`
  (rotated, or the wrong environment).
- `release_mismatch`: production is not serving the promoted commit (an
  Instant Rollback, a Git-integration deploy, or a promotion that did not
  finish). Compare with `docs/release/receipts/`.
- `database_unreachable`, `schema_incompatible`, `schema_unknown`: as for a
  failed startup assertion; do not migrate production from here without the
  release process.
- `tick_stale`, `tick_never_completed`, `tick_lock_wedged`, `scheduler_silent`:
  as in "Stale heartbeat" above. `tick_stale (health)` means no alerting has
  run since the tick stopped: check the Vercel cron for `/api/cron/health`
  and that `NOTIFICATIONS_ENABLED` is on.
- `alert_undelivered`: an operator incident is open and nobody was emailed.
  Read it with `GET /api/operations/health?scope=platform` and the
  `platform_incident_delivery` rows; fix the provider (`EMAIL_PROVIDER`,
  `EMAIL_API_KEY`, `EMAIL_FROM`) or `OPS_ALERT_EMAILS`, then handle the
  incident itself.
- Degraded only (`pause_active`, `alerting_paused`, `email_not_configured`,
  `telemetry_disabled`, ...): expected during a deliberate pause; otherwise a
  configuration gap to close before relying on in-app alerting.

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
every organisation. If that fails (503 `sign_out_everywhere_failed`, logged as
`session.revoke_all_failed`), the requesting browser is still signed out but
the other sessions may remain; the person can sign in and retry. None of this
touches Google connections or background sync. Two-step verification for
owners and admins is behind `MFA_ENABLED` (default off) and needs TOTP
enabled in the Supabase project first.

### MFA recovery

For a person who lost every authenticator app. Verify their identity out of
band first (a call to a number already on file, a second owner's
confirmation) and record how in the reason. Running it against production is
a release operation that needs approval, and the recovery procedure itself
needs security reviewer sign-off before first use. It runs outside the app,
with the owner/operator database connection and the Supabase service-role
key, which the operator holds:

```sh
DIRECT_DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  pnpm ops:mfa-recover --email person@example.com \
  --operator you@example.com --reason "Lost phone; identity checked by call, ticket 123" --dry-run
DIRECT_DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  pnpm ops:mfa-recover --email person@example.com \
  --operator you@example.com --reason "Lost phone; identity checked by call, ticket 123"
```

`recover_user_mfa` (0106; the runtime role cannot execute it) bumps the
person's `security_version`, so every session they hold stops resolving and
what they authorised or approved before it is voided wherever the recorded
version is compared: queued reply retries, stored reply and post approvals,
reviewed change sets at execute, and scheduled posts and bulk listing
operations they approved (the runners block or fail them as
`approval_invalid`). Records made before 0106 carry no version and are judged
on membership and role alone. It also deletes their sessions and
pending MFA tickets; zeroes `mfa_factor_count`, so their next sensitive action
asks them to enroll again; and writes one `user.mfa_recovered` audit row per
organisation naming the operator and reason. The script then deletes every
TOTP factor at the provider. If that step fails the person is signed out
everywhere but still needs a code; re-run it (safe). `--skip-provider` does
only the database step; without it a missing key refuses to start.

#### Reply attempts in flight when 0106 is applied

0106 backfills who authorised each in-flight reply attempt (from the
`publish_requested` / `delete_requested` audit row, or the reply's publisher)
so the retry worker can recheck it. A row it cannot attribute fails closed
(`authorisation_unverifiable`) on its next retry, and its reply is marked
failed for the person to send again. Before deploying, count them with the
owner connection:

```sql
select count(*) from publish_attempt pa
join review_reply rr on rr.id = pa.review_reply_id
where pa.status in ('started', 'accepted', 'retryable', 'ambiguous')
  and not (pa.operation = 'publish' and rr.published_by is not null)
  and not exists (
    select 1 from audit_log a
    where a.organisation_id = pa.organisation_id
      and a.action in ('review.reply.publish_requested',
                       'review.reply.delete_requested')
      and a.subject_type = 'review'
      and a.subject_id = rr.review_id::text
      and a.metadata->>'publishAttemptId' = pa.id::text
      and a.actor_user_id is not null
  );
```

and after it, find the ones left unattributed:

```sql
select organisation_id, id, operation, status from publish_attempt
where status in ('started', 'accepted', 'retryable', 'ambiguous')
  and authorised_by is null;
```

### Support impersonation

Support impersonation (`POST /api/support/impersonation`) is off by default.
`SUPPORT_IMPERSONATION_ENABLED=false` (the default) answers 404 even when
`SUPPORT_IMPERSONATION_SECRET` is set, and stops any outstanding support
session from resolving: the request is a 401 and the presented
`app_session` row is deleted. Turning it on takes both the flag and the
secret, and a decision under D-18.

Turning the flag off does not delete support sessions that are not
presented. To remove every outstanding one (a release operation that needs
approval on production), run with the owner/operator connection:

```sh
DIRECT_DATABASE_URL=... pnpm ops:revoke-support-sessions \
  --operator you@example.com --reason "Pilot launch: impersonation disabled" --dry-run
DIRECT_DATABASE_URL=... pnpm ops:revoke-support-sessions \
  --operator you@example.com --reason "Pilot launch: impersonation disabled"
```

The script calls `revoke_support_sessions(operator, reason)` (migration
0084), which deletes every `app_session` row with a `support_actor` and
writes one `support.sessions_revoked` audit row per affected organisation
with the operator, reason, session count and support actors. The runtime role
cannot execute it. `--dry-run` only counts.

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

Set `SEMANTIC_VERIFY_ENABLED=false` in the Vercel environment and redeploy
(flags are memoised per process; see Kill switches). Generation stays unavailable
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

The production application is at `https://nabapresence.com`; `www.nabapresence.com`
redirects to that origin. The Vercel project is `nabapresence`. Production
`NEXTAUTH_URL`, Supabase Auth's Site URL and redirect allow list, and the Google
OAuth client's production origin and callback use `https://nabapresence.com`.

### Authentication email (verified 9 October 2026)

Hosted Supabase Auth uses Resend custom SMTP: `smtp.resend.com`, port `465`,
username `resend`, sender `NabaPresence <noreply@nabapresence.com>`. The password
is a sending-only key restricted to the NabaPresence domain; keep it in the
provider's encrypted settings and the operator's credential store, never this
repository or a Vercel environment export. All 13 Auth email subjects and
template bodies identify NabaPresence. Signup requires email confirmation.

Cloudflare holds the provider-issued DKIM TXT, `send` MX and SPF TXT, and
`rsend` CNAME records, all DNS-only. `_dmarc` starts at
`v=DMARC1; p=none; adkim=r; aspf=r;`: this checks alignment without enforcing
rejection. Receiving a support mailbox is a separate setup from this outbound
SMTP configuration. The initial Auth send limit is 30 emails/hour with a
60-second minimum interval per user; revisit it against pilot admission and
abuse controls before increasing it.

Real confirmation and recovery mail reached the authorised test alias in
Gmail's inbox, each after one second, with SPF, DKIM and DMARC PASS. The live
confirmation link established an app session. Recovery completed through the
production API after the browser opened the received link; browser sign-in
with the new password passed. The old password, consumed recovery link and
previous app session were rejected. The reset form's final submission was not
performed through browser UI in this check.

See `docs/release/pilot-readiness-2026-10-09.md` for candidate-bound validation,
evidence locations and outstanding launch gates. Custom Auth SMTP does not
configure the application's incident/support email adapter.

### Controlled pilot and operator email

Production uses `REGISTRATION_MODE=invite_only`. Owners/admins create invitation
links in Team and share them with the intended tester; the application returns
an `inviteUrl`. It emails the invitation itself only for an organisation with
the `invitation_email` feature on (`scripts/ops-pause.mjs`, default off), and
only once the email adapter below is configured and `TENANT_EMAIL_ENABLED` is
on; otherwise the delivery is recorded `suppressed` and Team says to copy the
link. Delivery state is `invitation_delivery.status` (migration 0104);
`invitation_email` pauses it, and turning the feature off for an organisation
also stops its email already queued or retrying (rows are suppressed
`invitation_email_disabled`). Before enabling the feature, get security and
product sign-off on two risks: the email carries the token-bearing link, and
its subject and body carry the organisation's own name, which a tenant can set
to free text (fake URLs or instructions) sent from the platform's sending
domain to any address, bounded only by the `invitation_email` abuse limits. Invitees join that organisation. Signup checks token validity, expiry, prior use and the invited
email before sending confirmation. Confirmation/acceptance checks again under
a database row lock. Existing members can still sign in and recover without
an invitation, while identities with no membership cannot create a workspace.

Operator alerts use `EMAIL_PROVIDER=resend`, a separate domain-scoped
`EMAIL_API_KEY`, `EMAIL_FROM=NabaPresence <notifications@nabapresence.com>` and
the approved `OPS_ALERT_EMAILS` inbox. `TENANT_EMAIL_ENABLED=false` suppresses
customer incident emails while retaining in-app incident records and operator
mail. Changing these variables requires a new deployment because configuration
is cached per process. A real adapter test reached the approved inbox, but
never-started ticks and absence of the health tick still require external
monitoring; do not treat the email test as a paging or recovery rehearsal.

Production runs on the Supabase project `nabapresence` (ref
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
   expected, a stream is not). (Historical note: the first Vercel deployment
   retired the stale five-minute `/api/cron/worker` pings from the old build.)
   Then sign up, connect Google, confirm the reviews
   arrive in the inbox, and generate one draft.

## Privacy and disassociation

Disconnect destroys OAuth tokens immediately, cancels sync checkpoints, clears
the Google notification setting where possible, and schedules remaining
external-location cleanup inside seven days. Track access, rectification,
erasure, and restriction work in `/api/privacy/requests`; use
`/api/privacy/export` for retained-content exports (paged: repeat the POST
with the returned `nextCursor` until it is null; an interrupted export resumes
from the last cursor received). Check `complete` on the last page: pages are
ordered by the review's immutable Google create time, so reviews edited during
the export are still served, but a matching review first imported after page 1
sorts ahead of it and may be missing. The last page then reports
`complete: false` with `addedDuringExport` above 0; restart from page 1 (no
cursor) and hand over the restarted set. Cursors are signed with
`NEXTAUTH_SECRET`, so rotating it mid-export makes the next page a 400
`invalid_cursor`; restart from page 1. Apply a legal hold only with
an owner-approved reason and release it explicitly. Audit exports are available
as JSON or CSV from `/api/audit-log`.

A legal hold outranks the seven-day disconnect promise, and does so silently:
the retention sweep refuses to delete an external location while any of its
reviews carries an unreleased hold, so that location and its connection row
persist indefinitely (its reviews are kept with it). The sweep reports the count as `heldLocationsSkipped` in
its `retention.purge.completed` audit row and in
`retention.organisation_purged`. Watch that number: a non-zero value that never
falls is an unmet deletion obligation waiting on a hold nobody released, not a
purge failure. Releasing the hold lets the next sweep complete the deletion.

A legal hold on a review keeps everything retention would otherwise remove
for it: the review's redaction and media, its drafts, replies and publish
attempts (they go only with the review), its location on disconnect, its AI
usage rows past 13 months, and audit rows whose subject is the review past the
audit window. It does not freeze the location: the location's own windows
still run, so its expired sync attempts are deleted and its Google payloads
(location raw payload and address, profile, post and media content) are
redacted as for any location. The inventory's Hold column says `yes` for
rows a hold keeps whole and `cascade only` for these.

### Retention inventory and dry run

`lib/server/retention/inventory.ts` classifies every table: provenance
(`google`, `customer`, `derived`, `operational`), action (`redact`,
`delete`, `keep`), window, the purge steps or cascades that act on it,
whether `RETENTION_DELETES_ENABLED` gates its deletes, what a legal hold
keeps of it, and the approval the window stands on (`published` in the privacy
notice, `lifecycle` of its owning record, `internal`, or `pending` a named
decision with the interim keep decision). `tests/retention-inventory.test.ts`
fails on any table a migration creates without a row, on a purge step its row
does not list, and on a new derived dataset without a published window; a
new table lands with its row in the same change.

Preview a purge before enabling deletes or after changing a predicate:
`POST /api/cron/retention?dryRun=1&batch_size=25` with the cron bearer (add
`&cursor=<nextCursor>` to continue). Each organisation reports `counts`, the
rows each dataset would change now (a `select count(*)` on the step's own
predicate), `deferredDeletes` while `RETENTION_DELETES_ENABLED` is off (what
would be deleted once it is on), and `heldLocationsSkipped`. It changes
nothing except one `retention.dry_run` audit per organisation, takes no lease
and runs while the retention scope is paused. The Vercel cron GET never
previews.

Neither the pause nor `RETENTION_ENABLED` stops a dry run, and unlike the
purge its counts are not bounded by `RETENTION_BATCH_ROWS`: each is a full
scan of its step's predicate. If retention was paused for database load, use
`batch_size=1` and wait for the load to clear. Every count stops at the page
budget (`RETENTION_BUDGET_MS`); an organisation cut short is previewed again
on the next page, and one that cannot be counted within a whole budget is
listed in `failures` with `retention_dry_run_budget`.

<!-- retention-inventory:start -->
| Table | Provenance | Action | Window | Mechanism | Deletes | Hold | Approval |
| ----- | ---------- | ------ | ------ | --------- | ------- | ---- | -------- |
| `abuse_rate_bucket` | operational | delete | when its window ends (expires_at) | purgeEndedAbuseBuckets (lib/server/retention/purge.ts), once per cycle | ungated | no | internal |
| `ai_credit_period` | operational | keep | kept after the period ends: allowance grants and operator adjustments are the billing record; usage rows of a period still open are never purged (aiUsageInClosedPeriod) | none | none | no | pending D-47: keep every allowance period and adjustment for the life of the organisation |
| `ai_usage` | derived | delete | 13 months after creation, never while its allowance period is open or the row is reserved | `aiUsage` | gated | yes | published |
| `app_session` | operational | delete | 7 days after it expires | `appSessions` | gated | no | published |
| `app_user` | customer | keep | for the life of the account | none | none | no | lifecycle |
| `approval_decision` | customer | keep | with its review | cascade from `review` | gated | yes | published |
| `audit_log` | operational | delete | organisation.audit_retention_days (default 365) after it is written; never a held review's | `auditLogs` | gated | yes | published |
| `billing_event` | operational | keep | kept after it is processed, ignored or dead (Stripe ids, event type and body hash; no payload) | none | none | no | pending D-47: keep settled Stripe event receipts as the billing processing record |
| `billing_plan` | operational | keep | every catalog version, active or not: an organisation's plan_id keeps naming the terms it chose | none | none | no | internal |
| `bulk_listing_child` | customer | keep | with its bulk operation | none | none | no | pending D-47: keep each location's current and proposed values with its bulk operation |
| `bulk_listing_operation` | customer | keep | kept after it finishes | none | none | no | pending D-47: keep finished bulk operations for the life of the organisation |
| `bulk_listing_write_attempt` | operational | keep | with its bulk listing child (attributes and action-link writes and what their readback must find) | none | none | no | pending D-47: keep each bulk write attempt with its bulk operation |
| `client` | customer | keep | for the life of the client record | none | none | no | lifecycle |
| `client_google_connection` | customer | keep | for the life of the client and connection | none | none | no | lifecycle |
| `connection_task` | operational | keep | for the life of the connection | none | none | no | lifecycle |
| `cron_cursor` | operational | keep | one row per walk, updated in place | none | none | no | internal |
| `draft` | customer | keep | while its location stays connected; deleted with the external location 7 days after disconnect; scrubbed by privacy erasure | cascade from `review` | gated | yes | published |
| `external_location` | google | redact | raw payload and address at raw_content_expires_at: organisation.raw_content_retention_days (default 30, at most 30) after last receipt; the row 7 days after its Google connection is disconnected (purge_due_at), unless a review of it is held | `locations`, `disconnectedLocations` | gated | cascade only | published |
| `food_menu_item_identity` | derived | keep | for the life of the location | none | none | no | pending D-28: keep the item mapping while the location exists; it is rebuilt on each menu reconcile |
| `food_menus_state` | google | delete | expires_at (30 days after each observation) | `foodMenuStates`, cascade from `external_location` | gated | cascade only | published |
| `food_menus_sync_attempt` | operational | delete | expires_at (180 days after it is created); in-flight rows aged to ambiguous after 24 hours | `foodMenuAttempts`, `strandedFoodMenus`, cascade from `external_location` | gated | cascade only | internal |
| `gbp_change_set` | operational | delete | expires_at (180 days after it is requested), once no Place Action attempt refers to it | `managementChangeSets` | gated | no | internal |
| `gbp_local_post` | customer | redact | provider payload at provider_payload_expires_at; the post while its location stays connected; deleted with the external location 7 days after disconnect | `postPayloads`, `strandedPosts`, cascade from `external_location` | gated | cascade only | published |
| `gbp_local_post_attempt` | operational | delete | expires_at (180 days after it is created) | `postAttempts`, cascade from `gbp_local_post` | gated | cascade only | internal |
| `gbp_local_post_legacy_schedule` | customer | keep | with its post (while its location stays connected; deleted with the external location 7 days after disconnect); a dismissed one is kept too | cascade from `gbp_local_post` | gated | yes | pending D-47: keep every old per-post time, reviewed or not, for the life of its post |
| `gbp_management_mutation` | operational | delete | expires_at (180 days after it is created); in-flight rows aged to ambiguous after 24 hours | `managementMutations`, `strandedManagement` | gated | no | internal |
| `gbp_media_item` | google | redact | URLs, description, attribution, dimensions and insights at payload_expires_at (30 days after each observation) | `googleMediaPayloads`, cascade from `external_location` | gated | cascade only | published |
| `gbp_media_mutation` | operational | delete | expires_at (180 days after it is created), except an unresolved uncertain create; in-flight rows aged to ambiguous after 24 hours | `mediaMutations`, `strandedMedia` | gated | no | internal |
| `gbp_resource_snapshot` | google | delete | expires_at (30 days after each observation) | `resourceSnapshots` | gated | no | published |
| `google_account` | google | redact | raw payload at raw_content_expires_at: organisation.raw_content_retention_days (default 30, at most 30) after last receipt; the row while its connection exists | `accounts` | none | no | published |
| `google_connection` | operational | keep | for the life of the organisation; tokens are cleared on disconnect | none | none | no | lifecycle |
| `google_onboarding_creation` | google | delete | with its onboarding draft | cascade from `google_onboarding_draft`, cascade from `google_onboarding_review` | gated | no | internal |
| `google_onboarding_draft` | google | delete | expires_at (180 days after it is started) | `onboardingDrafts` | gated | no | internal |
| `google_onboarding_match_link` | google | delete | with its onboarding draft | cascade from `google_onboarding_match_link_review` | gated | no | internal |
| `google_onboarding_match_link_review` | google | delete | with its onboarding draft | cascade from `google_onboarding_draft` | gated | no | internal |
| `google_onboarding_review` | google | delete | with its onboarding draft | cascade from `google_onboarding_draft` | gated | no | internal |
| `google_rate_bucket` | operational | keep | one row per quota bucket, updated in place | none | none | no | internal |
| `hours_sync_attempt` | operational | delete | expires_at (365 days after it is created); in-flight rows aged to ambiguous after 24 hours | `hoursAttempts`, `strandedHours`, cascade from `external_location` | gated | cascade only | internal |
| `invitation` | customer | keep | kept after it is accepted or expires | none | none | no | pending D-47: keep accepted and expired invitations (email, role, inviter) for the life of the organisation |
| `invitation_delivery` | operational | keep | with its invitation; deleted when the invitation is revoked | none | none | no | lifecycle |
| `legal_hold` | customer | keep | with the review it protects; a released hold stays as its record | cascade from `review` | gated | yes | lifecycle |
| `location` | customer | keep | for the life of the location | none | none | no | lifecycle |
| `location_link` | customer | keep | while its location stays connected; deleted with the external location 7 days after disconnect | cascade from `external_location` | gated | yes | lifecycle |
| `location_member` | customer | keep | while the person is assigned to the location | none | none | no | lifecycle |
| `media_asset` | customer | keep | a finalised photo is kept until decided; an upload never finalised has its staged object removed from private storage 24 hours after it started (staging_expires_at, purgeExpiredStagingAssets in the retention purge, while RETENTION_DELETES_ENABLED is on) and its row kept, marked purged | none | none | no | pending D-47: keep owned photos and their rows; remove only staged objects never finalised |
| `media_asset_publication` | customer | keep | with its photo asset (where each photo was published) | none | none | no | pending D-47: keep where each owned photo was published with the photo |
| `member` | customer | keep | while the person is a member | none | none | no | lifecycle |
| `mfa_pending_login` | operational | delete | when the five-minute sign-in ticket expires (expires_at); an enrollment ticket also goes with its session | cascade from `app_session`, purgeExpiredMfaTickets (lib/server/retention/purge.ts), once per cycle | ungated | no | internal |
| `mutation_approval_decision` | operational | keep | with its operation receipt | none | none | no | lifecycle |
| `mutation_operation` | operational | keep | for the life of the organisation; approved requests whose dispatch never started are settled failed | `interruptedApprovals` | none | no | pending D-47: keep every operation receipt as the outcome record of the write it answers |
| `notification_delivery` | operational | keep | kept after it is sent or fails | none | none | no | pending D-47: keep delivery history for the life of the organisation |
| `notification_delivery_event` | operational | keep | with its delivery | none | none | no | pending D-47: keep provider delivery events with their delivery |
| `notification_digest` | operational | keep | kept after it is sent | none | none | no | pending D-47: keep digest records for the life of the organisation |
| `notification_incident` | operational | keep | kept after it resolves | none | none | no | pending D-47: keep resolved incidents for the life of the organisation |
| `notification_preference` | customer | keep | while the person is a member | none | none | no | lifecycle |
| `notification_recipient_state` | operational | keep | with its incident; cleared when a person marks it unread | none | none | no | lifecycle |
| `ops_heartbeat` | operational | keep | one row per tick, updated in place | none | none | no | internal |
| `ops_pause_control` | operational | keep | one row per pause scope, updated in place | none | none | no | internal |
| `ops_pause_event` | operational | keep | append-only history of pause changes | none | none | no | pending D-47: keep every pause change as the operator record |
| `organisation` | customer | keep | for the life of the account | none | none | no | lifecycle |
| `organisation_billing` | operational | keep | one row per organisation, updated in place, for the life of the account | none | none | no | lifecycle |
| `organisation_feature` | customer | keep | for the life of the organisation | none | none | no | lifecycle |
| `organisation_job_route` | operational | keep | for the life of the organisation | none | none | no | internal |
| `performance_metric_daily` | derived | keep | while its location stays connected; deleted with the external location 7 days after disconnect | cascade from `external_location` | gated | yes | pending D-28: keep daily figures while the location stays connected, as the privacy notice says |
| `performance_search_keyword_monthly` | derived | delete | 18 months after the metric month | `keywordHistory`, cascade from `external_location` | gated | cascade only | pending D-28: keep deleting keyword history after 18 months, as the privacy notice says |
| `place_action_link` | google | keep | while its location stays connected; deleted with the external location 7 days after disconnect | cascade from `external_location` | gated | yes | pending D-28: keep the mirrored links while the location stays connected; they are refreshed on every read |
| `place_action_mutation` | operational | delete | expires_at (180 days after it is created); in-flight rows aged to ambiguous after 24 hours | `placeActionMutations`, `strandedPlaceActions`, cascade from `external_location` | gated | cascade only | internal |
| `platform_incident` | operational | keep | kept after it resolves | none | none | no | pending D-47: keep resolved platform incidents as the operations record |
| `platform_incident_delivery` | operational | keep | with its incident | none | none | no | pending D-47: keep operator alert deliveries (recipient address included) with their incident |
| `post_approval_decision` | customer | keep | with its post | cascade from `gbp_local_post` | gated | yes | lifecycle |
| `post_publication_occurrence` | customer | keep | with its schedule | none | none | no | pending D-47: keep every occurrence, run or skipped, for the life of its schedule |
| `post_publication_schedule` | customer | keep | for the life of the location | none | none | no | pending D-47: keep finished and cancelled schedules for the life of the location |
| `presence_canonical_resource` | customer | keep | for the life of the location | none | none | no | lifecycle |
| `presence_import_proposal` | google | delete | expires_at (90 days after it is raised) | `importProposals`, cascade from `external_location` | gated | cascade only | published |
| `presence_resource_reconcile_state` | operational | keep | one row per location and resource, for the life of the location | none | none | no | internal |
| `privacy_request` | customer | keep | kept after it is resolved | none | none | no | pending D-47: keep resolved privacy requests as the record of how each was answered |
| `processed_webhook_event` | google | redact | payload at payload_expires_at (30 days; legacy rows only, new events store no payload); the dedupe row is kept | `webhookPayloads` | none | no | published |
| `profile_field_state` | google | redact | canonical and Google values at snapshot_expires_at (30 days after each observation) | `profileSnapshots`, cascade from `external_location` | gated | cascade only | published |
| `profile_sync_attempt` | operational | delete | expires_at (365 days after it is created); in-flight rows aged to ambiguous after 24 hours | `profileAttempts`, `strandedProfiles`, cascade from `external_location` | gated | cascade only | internal |
| `publish_attempt` | operational | keep | with its reply | cascade from `review_reply` | gated | yes | published |
| `publish_attempt_event` | operational | keep | with its publish attempt (append-only; yields only to retention) | cascade from `publish_attempt` | gated | yes | published |
| `report_share` | customer | keep | kept after it expires or is revoked | none | none | no | pending D-22: keep expired and revoked share rows (token hash only) for the life of the client |
| `retention_cycle` | operational | delete | completed cycles 35 days after their day (RETENTION_CYCLE_KEEP_DAYS) | openOrResumeCycle (lib/server/retention/cycle.ts), when a new cycle opens | ungated | no | internal |
| `retention_cycle_org` | operational | delete | with its cycle | cascade from `retention_cycle` | ungated | no | internal |
| `review` | google | redact | review text, reviewer name, photo link and raw payload at raw_content_expires_at: organisation.raw_content_retention_days (default 30, at most 30) after last receipt; the row 7 days after its Google connection is disconnected (purge_due_at) | `reviews`, `disconnectedReviews`, cascade from `external_location` | gated | yes | published |
| `review_media_item` | google | delete | with its review's raw_content_expires_at: organisation.raw_content_retention_days (default 30, at most 30) after last receipt | `media`, cascade from `review` | gated | yes | published |
| `review_reply` | customer | keep | while its location stays connected; deleted with the external location 7 days after disconnect; scrubbed by privacy erasure | cascade from `review` | gated | yes | published |
| `risc_event` | operational | keep | kept as the Cross-Account Protection record | none | none | no | pending D-47: keep received security events as their record |
| `schema_migration` | operational | keep | one row per applied migration | none | none | no | internal |
| `sync_checkpoint` | operational | keep | while its location stays connected; deleted with the external location 7 days after disconnect | cascade from `external_location` | gated | yes | internal |
| `verification_result` | customer | keep | with its draft | cascade from `draft` | gated | yes | published |
| `webhook_route` | operational | keep | while its location stays connected; deleted with the external location 7 days after disconnect | cascade from `external_location` | gated | yes | internal |
<!-- retention-inventory:end -->

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

Apply migration `0064_business_information_change_sets` before deploying the
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
  `mutation_recover` reads Google back for its receipt; the next tick settles
  the occurrence from that receipt and the schedule carries on. Nothing is
  resent. If recovery gives up (the receipt stays `uncertain`), check the post
  on Google, then change and re-approve the schedule. A publish interrupted
  before it recorded a receipt was never sent: once its window has closed
  (plus a minute) the sweep records it missed (`outside_dispatch_window`), so
  a repeating schedule carries on and a one-time one asks for a new time.
- `prior_occurrence_unverified` ("Needs review"): an unresolved occurrence from
  before migration 0118 (no intent, so no receipt) whose post is neither
  published nor failed. Its occurrence is cancelled as `outcome_unverified`.
  Check the location's posts on Google, then choose a new time or cancel.
- `connection_changed`: the location was relinked or its Google connection
  reconnected after approval. Change the schedule and approve it again.
- `source_changed` ("Awaiting approval", or "Needs review" when the rule no
  longer fits the content): the post was edited after the schedule was set up.
  The schedule now holds the edited text as a new revision; review and approve
  it, or cancel it. Nothing was or will be published from the old approval.
  A paused schedule stays paused with this reason: resuming it moves it to
  "Awaiting approval", and only an approval makes it active. A blocked schedule
  keeps its block reason; submit it again once the block is cleared.
  A one-time slot that comes due while the post is being published by hand
  waits inside its 5-minute window rather than ending; if that publish fails
  it goes out, and otherwise it is superseded or missed.
- `source_superseded`: the post was published another way or deleted before a
  one-time slot came due. The schedule ended without sending anything; schedule
  a new draft if another publication is wanted.
An occurrence may start only within 5 minutes of its time. One that could not
(runner down, publishing paused, link missing) is recorded missed by the next
tick, even while paused, and raises `schedule_missed` (`outside_dispatch_window`,
or `paused_when_due` when its schedule was paused); one with ended event/offer
content is missed as `expired_content`. Missed occurrences are never published
late. A one-time schedule with a missed slot shows "Needs review": resuming it
answers `schedule_missed`, so choose a new time by editing it.
Pausing keeps occurrences; cancelling stops every pending one. To stop all
scheduled publishing at once, turn off `PUBLISH_ENABLED` (or `JOBS_ENABLED`):
no new schedule or bulk child is claimed, and nothing already sent is undone.

Notifications (P08-R6): `schedule_missed` emails immediately and
`schedule_blocked` goes in the digest, each with the reason in the Posts tab's
words (in the immediate email, and on an indented line under its digest
entry). `schedule_blocked` is also raised when an approved, active schedule
will no longer publish because its post was edited (`source_changed`) or was
published another way or deleted (`source_superseded`), and when the sweep
sends a schedule to review as `prior_occurrence_unverified`. The jobs tick
logs `post_schedule.tick` (published, rejected, ambiguous, missed, blocked,
superseded, sourceChanged, sourceInFlight) and `post_schedule.sweep` (missed,
resolved, unverified) whenever either did anything.

### Scheduled post alerts

The health tick opens a `platform_incident` per organisation (the subject is
the organisation id; details hold counts and instants only) and emails
`OPS_ALERT_EMAILS`:

- `scheduled_post_stuck`: an occurrence still `publishing` 10 minutes after it
  started, with its schedule's lease gone. The next claim
  (`claim_due_publication_schedules`) would have made it `ambiguous`, so the
  jobs tick or its scheduled post path is not running: check the `jobs`
  heartbeat, `post_schedule.process_failed` logs, and the `jobs`, `publish`
  and `scheduled_post` pauses. Not raised while one of those scopes is
  paused (the pause is what holds the claim). Once the tick runs, the
  occurrence becomes unresolved and is settled from its receipt; nothing is
  resent.
- `scheduled_post_overdue`: an occurrence still `scheduled` more than three
  minutes after its 5-minute window closed. The sweep runs on every jobs tick
  before any pause check, but only inside the `naba:jobs` lock, so one tick
  that overran its budget can delay it by about two minutes; three minutes
  allows for that. Past it, the jobs tick is not running, its lock is held
  (see `tick_lock_wedged`) or `post_schedule.sweep_failed` is in the logs. It will not publish late
  either way; the alert is that nobody has been told it was missed.

Both read `post_schedule_health()` (migrations 0121 and 0122; every affected
organisation is reported) and resolve on the first health tick after the
condition clears. Neither changes an occurrence.

Retention: the daily retention cycle does not purge scheduled post history.
Schedules, their occurrences and old per-post times are pending D-47
(`docs/release/decision-log.md`), whose interim is keep until decided, so the
purge has no step for them and `RETENTION_DELETES_ENABLED` does not reach them
(an old per-post time still goes with its post when its location is purged on
disconnect). `purge_post_schedule_dataset` (0122) holds the P08-R6 proposal
for when D-47 sets a period: ended occurrences (published, rejected, missed,
cancelled) and ended schedules (cancelled, completed) 180 days after they
ended, dismissed old per-post times 180 days after the dismissal, and anything
unresolved, awaiting approval, in review, paused or blocked kept however old.
Nothing calls it until D-47 is decided and the inventory row changes.

### Partial bulk changes

Bulk listing changes are off for an organisation until an operator turns on
`bulk_actions` (`pnpm ops:pause feature --organisation <uuid> --feature
bulk_actions --enable --operator you@example.com`). Turning it off stops new
claims for that organisation; queued listings wait and expire when their
24-hour dispatch window closes. A listing showing "Expired, not sent"
(`dispatch_expired`, or `preview_expired` for a preview nobody approved
within 15 minutes) or `google_target_changed` was never sent: prepare a new
preview. `resource_busy` means another change to the same listing resource was
running; the listing is retried a minute later. `permission_revoked` (the
person who prepared or approved the batch lost access to that listing, or the
approver is no longer an owner or admin), `approval_policy_changed`,
`second_approver_required` and `security_version_unverifiable` (an approver
security version the MFA stream records but this build cannot verify) were
never sent either: fix access or the policy, then prepare a new preview.

Review batches (bulk approve and template replies from the inbox, with
`bulk_actions` on) show on the same batch page. `approval_withdrawn` means the
approval was rejected or replaced after the batch started, so the reply was
not sent; `submitted_for_approval` means the template reply was parked for
someone who can publish. A child "Outcome unknown" with
`response_ambiguous` or `publish_retry_scheduled` waits on the reply's own
publish attempt: the job runner's reply retry or readback settles it, and
the child follows; retrying the batch does not touch it. An interrupted
review child is run again by the next tick (at most five times); each run
reads Google back before sending, so it is never published twice.

Two-person approval and business information: every business-information
update needs a reviewed change set, and accepting Google's suggested update in
one step is refused (`business_info_review_required`) while two-person
approval is on; review the suggested fields in Business information instead.

A batch with several changes sends each listing's changes in list order: a
listing marked "Waits for the earlier changes to this listing" is queued
behind them. `dependency_not_applied` means a change it needs (for example a
category change) did not apply at that listing, so it was not sent. Retrying
the batch requeues the dependent with its prerequisite only when the
prerequisite failed (or its outcome is unknown and no longer being recovered);
if the prerequisite ended in a conflict or expired, retry leaves the dependent
failed, and it needs a new preview. Retry requeues each failed change on its
own, so an earlier failed change can land after a later one already applied;
changes of one batch never touch the same part of a listing, so that order
does not matter.

Business information, categories and lodging in bulk skip a listing rather
than guess: `permanently_closed` (reopen it from the listing's own page),
`too_many_categories` (more than 9 additional), `category_not_available` (not
offered in the listing's country), `category_region_unknown` (no address or
service-area region) and `lodging_not_available` (no lodging resource on
Google). Their uncertain writes have receipts (surfaces `business_info` and
`lodging`) that `mutation_recover` reads back; retry never re-sends one while
recovery is reading it. Healthcare services are not offered in bulk (D-24).

A batch finishing with failures raises `bulk_completed_with_failures`. On the
bulk change page, "Retry unsettled listings" re-reads Google for failed and
ambiguous listings: already-applied listings settle without a write, unchanged
ones are written once, and moved ones become conflicts that need a new preview.
Confirmed listings are never written again. An "Outcome unknown" listing whose
receipt is still being read back by `mutation_recover` is not retried: it
settles on its own once recovery reads Google (the batch then re-finishes,
audit `bulk_listing.child_reconciled`). If recovery gives up (the receipt stays
`uncertain` and owners are notified), check the listing on Google; a retry then
reads Google before sending. Each listing's receipt is at
`GET /api/mutations/{mutationOperationId}`. A bulk hours change also updates
the listing's saved hours; `hours_reconciliation_required` means its saved
hours need reviewing in the hours editor first, and
`multiple_links_for_type` means the listing has several editable links of
that type, so change it on its own. A bulk menu change also updates the
listing's saved menus; `food_menus_local_changes` means the listing's menu
editor holds unpublished edits, including edits saved after the preview
(publish or discard them, then prepare a new preview; the batch never
overwrites them), and `menu_node_not_found`/`menu_node_ambiguous` mean the menu entry
the change names is not on that listing exactly once (entries are matched by
their content and place, never by name), so change that listing on its own. A
bulk post change only creates drafts: publish each from the listing's posts,
where two-person approval applies as usual. A bulk photo needs private
storage configured (`MEDIA_ASSET_STORAGE=supabase`, `SUPABASE_SECRET_KEY`,
`MEDIA_ASSETS_BUCKET` pointing at a private bucket); without it uploads answer
503 `asset_storage_unavailable` and photo listings are skipped or wait
queued. `media_needs_resolution` on a photo listing means Google did not
confirm the create: resolve it on that listing's photos tab (it is never sent
twice), and the batch settles from that decision. `photo_already_added` and
`photo_publication_pending` mean another change already added, or is still
adding, that photo there. Cancelling stops queued listings only; completed
writes are not rolled back.

On the batch page, "New preview for N listings not sent" prepares a fresh
preview of the listings that expired, changed on Google after the preview,
or were blocked by a prerequisite that conflicted, expired, was cancelled or
was skipped (a prerequisite that merely failed is retried with its dependent
by Retry instead). It is offered only once nothing in the batch is queued or
running. It reads Google again, and an hours, attribute, category, menu, link
or photo change a listing already shows is skipped there as already applied.
A post draft has no such check, so it is left out whenever the new preview
would also reach a listing that already has it; the page names those
listings, and the post goes out as its own bulk change for just them.
While a preview waits, the page counts down the 15 minutes left to approve
it by the server's clock; approval is still decided by the server. "Show receipt" on a listing reads that write's receipt
(`GET /api/mutations/{id}`). Photo uploads from the composer go straight from
the browser to the private bucket, so the deployed build must have
`MEDIA_ASSET_STORAGE=supabase` and `SUPABASE_URL` set at build time for the
CSP to allow that origin; otherwise the upload is blocked in the browser.

### Notification delivery failures

`/settings/operations` shows email evidence by state. "Retry failed emails"
requeues sends the provider refused, and unknown sends younger than 23 hours
(still inside Resend's idempotency window); older unknown sends stay unknown to
avoid a duplicate. Every retried send rechecks membership, location access and
preference. Delivery evidence needs `EMAIL_WEBHOOK_SECRET` and a Resend webhook
pointed at `/api/webhooks/email`; without it, evidence stops at provider
acceptance. With no provider configured, sends are suppressed and incidents
still appear in the app.
