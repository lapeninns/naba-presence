# NabaPresence codebase audit (2026-10-14)

Coordinator: claude3. Snapshot: `main` at `d8759c74` (production promotion of
`2b26bcf2`), plus the user's uncommitted, layout-only inbox work on
`feat/inbox-mail-refinement`. All findings come from static analysis, the
repository's own checks, and one isolated production build. Nothing touched a
live database, provider API or deployment.

Companion documents:

| Document                       | Covers                                                       |
| ------------------------------ | ------------------------------------------------------------ |
| `README.md`                    | Executive summary and top 10                                 |
| `VERIFIED_FINDINGS.md`         | Priority/status ledger after verification (source of truth)  |
| `MUTATIONS_AND_HOOKS_AUDIT.md` | Mutations, queries, hooks, client state                      |
| `BACKEND_DATABASE_AUDIT.md`    | Services, APIs, data access, DB, jobs, billing/retention     |
| `PERFORMANCE_OPTIMISATION.md`  | Frontend/backend performance, caching, baselines             |
| `ARCHITECTURE_IMPROVEMENTS.md` | Structural changes, trade-offs, rejected options             |
| `IMPLEMENTATION_ROADMAP.md`    | Ordered work packages, acceptance criteria, agent allocation |
| `AGENT_EXECUTION_REPORT.md`    | Who did what, verification record, gaps                      |
| `raw/`                         | Unedited per-agent evidence (W0–W8, R2-*)                    |

---

## 1. Method

1. Repository mapping, then nine parallel read-only workstreams (W0–W8), one per
   Claude account.
2. Round 2: gap workstreams (billing/credits/retention, Data API exposure,
   idempotency trace, isolated build, per-interaction cost model) and
   **adversarial verification**. Every round-1 workstream's P0/P1 claims were
   re-traced by a _different_ account (R2-V1…V5), and the coordinator
   re-checked the highest-impact claims directly in code.
3. Consolidation into the ledger, then drafting.

Status vocabulary used throughout: **Confirmed** (traced end to end and
independently re-traced), **Partially confirmed** (true with a stated
correction), **Plausible** (likely, single-source), **Unverified** (needs a live
environment).

Checks run (W7, in the main checkout, including the user's uncommitted work):

| Check                                                  | Result                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                       | pass (3 s, warm incremental cache)                                                                         |
| `pnpm lint` (`--max-warnings 0`)                       | pass (43 s)                                                                                                |
| `pnpm test` (Vitest unit/component)                    | pass: 515 files, 6,509 tests passed, 1,255 skipped (106 s); identical counts to the latest release receipt |
| `pnpm build` (isolated worktree at `d8759c74`, no env) | pass (54.3 s)                                                                                              |
| `pnpm audit --prod`                                    | 0 advisories across 215 production dependencies                                                            |

Not run, and why: `test:integration` and `test:e2e` (need Postgres/Supabase;
Docker was down; last receipt 2026-10-14 shows them passing, 34 min and 19 min),
coverage (no provider installed), any `EXPLAIN` (no local database), anything
against staging or production (out of scope without the operator).

---

## 2. System overview

### 2.1 Stack and size

Next.js 16 App Router (webpack build, Turbopack dev), React 19, TanStack Query
v5, zod contracts, `postgres` driver against Supabase Postgres 17 via
Supavisor, Supabase Auth (identity only), Stripe, OpenAI, Google Business
Profile APIs, OpenTelemetry. Production runs as **Vercel Functions** in `iad1`.
The standalone server and `scripts/scheduler.mjs` serve local/self-hosted and
test runs only.

| Area                        |      Files |   LOC | Role                                                                                                     |
| --------------------------- | ---------: | ----: | -------------------------------------------------------------------------------------------------------- |
| `app/api/`                  | 159 routes | 12.2k | JSON API, all through one `route()` wrapper                                                              |
| `app/(dashboard)/`          |         53 |  2.6k | Thin RSC pages: session, optional prefetch + `HydrationBoundary`, one client view                        |
| `components/`               |        413 | 95.3k | Client UI (locations 24.5k, ui 16.7k, settings 10.5k, inbox 8.7k)                                        |
| `lib/server/`               |        219 | 61.1k | Tenancy, sessions, Google transport and write pipeline, reply publishing, jobs, sync, retention, billing |
| `lib/contracts/`            |         76 |  8.6k | zod request/response schemas, client-safe by test                                                        |
| `lib/domain/`               |         61 |  9.9k | Pure rules shared by client and server                                                                   |
| `lib/api/` + `lib/queries/` |        127 |  5.8k | Fetch wrappers and TanStack hooks, `queryKeys` factory                                                   |
| `supabase/migrations/`      |        131 | 13.3k | Schema, RLS, 50 live SECURITY DEFINER functions                                                          |
| `tests/`                    |        745 |  181k | Vitest unit/component/integration, Playwright e2e/visual                                                 |

### 2.2 Request path

`page.tsx` (RSC: `getSession` → optional `prefetch()`) → `HydrationBoundary` →
client view → `lib/queries/use-*` → `lib/api/*` (`apiFetch` + contract parse) →
`app/api/**/route.ts` via `route()` (request id → same-origin guard → auth
`session|cron|public` → roles → zod params/query/body → abuse limits →
`ctx.tenant` = `withTenant`) → `lib/server/*` → SQL in a tenant transaction
(`set_config('app.organisation_id', …, true)`, forced RLS) and/or Google outside
the data transaction → response `satisfies` contract → client parse →
`invalidateQueries` → refetch → render.

Google writes go through `runGbpWrite` (`gbp-write.ts:908`: durable intent →
validateOnly → mutate → readback → settle → audit). Replies go through
`lib/server/publishing/*` with a content-derived idempotency key and a unique
`(organisation_id, idempotency_key)` constraint (`0001_initial.sql:283`).

### 2.3 Background work

A Vercel cron (9 entries, `vercel.json`) calls `GET /api/jobs/run` every
minute. That route runs a single tick under the advisory lock `naba:jobs`, with
a 45 s budget and 4 workers. The tick drains the queue in a fixed order:

1. Sweep closed post windows.
2. Billing slice (the only reserved budget).
3. Claim loop over webhook, checkpoint, publish-retry, recover, reconcile,
   performance and keyword jobs.
4. Bulk listing children.
5. Scheduled posts.
6. Privacy withdrawals and invitations.

The other cron routes (`sync/*`) only arm checkpoints. Pub/Sub review
notifications are recorded and drained by the same runner.

### 2.4 Critical flows (cost hot-spots marked)

Full hop-by-hop traces with file:line are in `raw/W0-architecture.md §2`.
The per-interaction cost model is in `raw/R2-X1-interaction-cost-model.md`.

- **Inbox → publish reply.**
  - Pressing Publish runs the Google send inline in the request (`publish.ts:166-170`).
  - On success, the client waits for the detail, _every loaded list page_ and
    the counts to refetch (W1-F2).
  - While anything is settling, a 5 s poll refetches all pages again (W1-F3).
  - Every request also writes `app_session.last_seen_at` (W0-05).
  - Each row click goes through `router.replace`, which re-renders the inbox
    page on the server and re-runs its prefetch: 5 transactions per click.
    Layouts are reused (W5-01, R2-X1).
- **Profile save and publish.**
  - About 4 live Google profile reads, plus validate/PATCH/readback, plus about
    15 tenant transactions. Even a profile GET writes to the database (W0-04).
  - The Google sequence runs inside a lock-only transaction (W4-01).
- **Scheduled post.** It runs last on whatever is left of the tick budget, and
  is marked missed once its 5-minute window passes (W8-02).
- **Review sync.** Each page upserts every review unconditionally, rewriting
  12 indexes, photos and the reply (W4-03). The upsert has no freshness guard
  against a reply published in between (W8-04).

### 2.5 What is already good

These held up under verification and should be preserved:

- One request skeleton: all 159 handlers use `route()`. Contracts are
  single-sourced and client-safe by test. No IDOR was found in the per-route
  authorisation matrix (W6).
- Tenancy: forced RLS with cheap, index-friendly policies. `withTenant` sets the
  tenant transaction-locally, and startup refuses a superuser or `BYPASSRLS`
  runtime identity.
- No circular imports (1,277 files). No client file imports server values.
  215/219 server modules import `server-only`.
- Reply publishing cannot double-post to Google: a content-derived key, a unique
  constraint and an idempotent PUT (R2-W1b).
- Stripe webhooks: deduplicated by event id, and the body is ignored in favour
  of a re-fetch under a row lock, so order does not matter (R2-W0b).
- The Google transport has timeouts on every call and never retries writes.
  Job claiming uses leases and is indexed. Inbox and audit pagination use
  keysets, not OFFSET.
- CSRF/same-origin guard, webhook signatures, share tokens, AES-GCM key ring,
  log redaction and upload handling all checked out clean (W6).
- Every dashboard page is a server component with a loading state, and no
  heavy server-only library reaches the browser (W5, R2-W7b).

---

## 3. P0: Supabase Data API exposure (SEC-11 / W6-01)

**Status:** The code-level chain is confirmed. Whether production is exposed is
unverified; the deep-dive put it at about 80% likely. It is already tracked in
`docs/release/ledger.md` as SEC-11 ("awaiting evidence"), and the G1 gate lists
it as a blocker.

### 3.1 Evidence

- Migrations run as the Supabase admin login (`postgres`). Nothing changes
  object ownership (`docs/runbook.md:1245-1247`, `scripts/db-migrate.mjs`).
- Hosted Supabase gives `anon`, `authenticated` and `service_role` direct
  default grants on new objects in `public`. **No migration revokes anything
  from those roles.** The repository's 94 `revoke … from public` statements
  remove only the PUBLIC pseudo-role entry.
- `supabase/config.toml` exposes `public` through the Data API.
- `anon` cannot set `app.organisation_id`, so every standard
  `tenant_isolation` policy denies it. **Tenant data tables are not directly
  readable.** The exposure is through three routes:
  - **SECURITY DEFINER functions (50 live).** They run as the owner, which
    bypasses RLS.
  - **Tables without RLS.** Notably `schema_migration`.
  - **`using (true)` policies with no `TO` clause.** These are
    `organisation_job_route_read` (`0005:136`) and `webhook_route_resolve`
    (`0005:108`).

### 3.2 Impact if reachable (ranked, from `raw/R2-W6b-data-api-exposure.md §2`)

- **Tenant takeover:** `provision_local_bootstrap(org, user)` (`0005:76-92`)
  makes any user owner of any organisation. `organisation_job_route` hands out
  every organisation id.
- **Account takeover:**
  - `provision_authenticated_user` accepts a caller-asserted
    `p_email_verified`, which binds an attacker identity to any user whose
    `auth_subject` is null.
  - `provision_google_user` overwrites `google_subject` on any user found by
    email.
  - `attach_member_user` acts as an email oracle and can pre-claim an address.
- **Control tampering:**
  - `recover_user_mfa` and `revoke_support_sessions` are operator-only by
    design but anon-executable.
  - The job-queue and lease functions are exposed; with them an attacker can
    zero every AI-credit reservation or reclaim jobs.
  - `schema_migration` is writable, so an attacker can make `db:migrate` skip a
    migration or stop the next cold start.

### 3.3 Likelihood

Lower than W6-01 first claimed: an attacker needs both the project URL and the
publishable key.

- The key is server-only (`lib/server/password-auth.ts:95-115`). There is no
  `NEXT_PUBLIC_*` copy and no supabase-js.
- Production does not use Supabase Storage, which was the one path that put the
  project URL in the CSP.

Neither value is a secret by design, so the tenancy model must not depend on
them staying private. **Priority stays P0.**

### 3.4 Operator verification (read-only; run as `postgres` on staging, then production)

```sql
-- a) Default privileges that would grant future objects to API roles
select pg_get_userbyid(d.defaclrole) as grantor_role, d.defaclobjtype, d.defaclacl
from pg_default_acl d
join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname = 'public';

-- b) Schema reachability
select r.rolname, has_schema_privilege(r.rolname, 'public', 'usage') as public_usage
from pg_roles r
where r.rolname in ('anon', 'authenticated', 'service_role');

-- c) Functions the API roles can execute (expected safe result: 0 rows)
select p.oid::regprocedure as function, p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prorettype <> 'trigger'::regtype
  and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute'))
order by p.prosecdef desc, 1::text;

-- d) Tables, views and sequences the API roles can touch (expected safe result: 0 rows)
select c.relname, c.relkind, c.relrowsecurity as rls,
       has_table_privilege('anon', c.oid, 'select') as anon_select,
       has_table_privilege('anon', c.oid, 'insert, update, delete') as anon_write,
       has_table_privilege('authenticated', c.oid, 'select') as auth_select,
       has_table_privilege('authenticated', c.oid, 'insert, update, delete') as auth_write
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm', 'f')
  and (has_table_privilege('anon', c.oid, 'select, insert, update, delete')
       or has_table_privilege('authenticated', c.oid, 'select, insert, update, delete'))
order by 1;

select c.relname as sequence
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'S'
  and (has_sequence_privilege('anon', c.oid, 'usage')
       or has_sequence_privilege('authenticated', c.oid, 'usage'));

-- e) Schemas PostgREST serves (also visible under Dashboard → API settings)
select rolname, rolconfig from pg_roles where rolname = 'authenticator';
```

The project is safe if either of these holds:

- (c) and (d) return no rows;
- `public` is absent from the exposed schemas, with the Data API disabled.

### 3.5 Remediation

**Interim, no deploy needed.** In the Supabase dashboard, either disable the
Data API or remove `public` from the exposed schemas.

- App impact: none found. The app uses no supabase-js, PostgREST or GraphQL;
  it talks to Postgres directly and calls Auth/Storage, which are separate
  services.
- This is a provider-settings change, so it needs the operator.
- Re-run 3.4(e) afterwards to confirm.

**Durable fix, migration draft.** This is not committed and needs review. It
must no-op on the plain PostgreSQL that `verify:release` uses, where the
Supabase roles don't exist.

```sql
-- 0132_revoke_data_api_grants.sql (DRAFT)
do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on all tables in schema public from %I', api_role);
      execute format('revoke all on all sequences in schema public from %I', api_role);
      execute format('revoke all on all functions in schema public from %I', api_role);
      execute format('revoke usage on schema public from %I', api_role);
      -- Stop future grants from objects created by the migrating role.
      execute format('alter default privileges in schema public revoke all on tables from %I', api_role);
      execute format('alter default privileges in schema public revoke all on sequences from %I', api_role);
      execute format('alter default privileges in schema public revoke all on functions from %I', api_role);
    end if;
  end loop;
end $$;

-- Routing policies: scope to the runtime role instead of every role.
alter policy organisation_job_route_read on organisation_job_route to naba_app_runtime;
alter policy webhook_route_resolve on webhook_route to naba_app_runtime;

-- Local-only helper: refuse anything except the fixed local identities
-- (lib/server/session.ts:26-27), so a production call cannot take over a tenant.
create or replace function provision_local_bootstrap(
  p_organisation_id uuid,
  p_user_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_organisation_id <> '00000000-0000-4000-8000-000000000001'::uuid
     or p_user_id <> '00000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'provision_local_bootstrap is local-only';
  end if;
  -- body unchanged from 0005_tenant_hardening.sql:81-91
end;
$$;
```

Notes on the draft:

1. `alter default privileges` without `for role` changes only the migrating
   role's defaults. If the project also has defaults owned by `supabase_admin`,
   query (a) will show them. Those need the dashboard or Supabase support.
2. Revoking from `service_role` is deliberate: the runtime holds no service key
   today, and BYPASSRLS plus these grants would make a leaked key total. Check
   that no operator tooling uses PostgREST with that key before including it.
3. `provision_google_user` has no live login caller
   (`lib/server/provisioning.ts:632-640`, test-only) and `attach_member_user`
   has none at all. Dropping both means updating
   `tests/integration/app-user-isolation.test.ts:102-117` in the same change.
4. `provision_authenticated_user` must keep its runtime grant. Once the API
   roles lose access, the caller-asserted `p_email_verified` is acceptable,
   because only the server calls it after verifying with Supabase Auth.
5. Add a catalogue test to the integration suite that asserts, when the roles
   exist:
   - queries (c) and (d) return no rows;
   - every SECURITY DEFINER function in `public` is executable only by
     `naba_app_runtime` and the owner.

   The release ledger notes "no catalogue test" for SEC-10/11. This closes it.

Related: W6-02 (P1) is the same function existing in production at all. It is
fixed by the guard above, or by moving the helper into a local-only seed.

---

## 4. Findings index by theme

Priorities after verification. Details, evidence and fixes are in the themed
documents.

| Theme                                  |  P0 |  P1 | Key items                                                                                                                                                                | Document                         |
| -------------------------------------- | --: | --: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| Security and tenancy                   |   1 |   1 | SEC-11, W6-02; P2: `/auth/confirm` login CSRF (W6-05), legal-hold cascade (R2B-01)                                                                                       | this file §3, BACKEND            |
| Google writes and locking              |   – |   1 | W4-01: 13 lock-only transactions span Google calls; worst case 85–120 s against a 60 s idle-transaction limit; ends as "Google applied, user sees 5xx"                   | BACKEND, ARCHITECTURE            |
| Sync integrity and write amplification |   – |   1 | W4-03: unconditional upsert; W8-04 (P2): reply overwrite race                                                                                                            | BACKEND                          |
| Query shape and indexes                |   – |   1 | W4-04: audit-log subject index; P2: counts per poll, search function, FK indexes for cascades                                                                            | BACKEND                          |
| API request budgets                    |   – |   3 | W3-2: live Google reads on every editor open; W3-3: invariant errors hidden as 400; W3-4: work outruns `maxDuration`, including an AI credit charged with no draft saved | BACKEND                          |
| Jobs and scale                         |   – |   1 | W8-01: runner capacity ceiling; P2: no per-kind budget or priority (W8-02/03), stale-lock risk (W8-05)                                                                   | BACKEND, ARCHITECTURE            |
| Client data layer                      |   – |   3 | W1-F1: approve binds to nothing; W1-F2: refetch every loaded page; W5-01: server render per row click or keystroke                                                       | MUTATIONS_AND_HOOKS, PERFORMANCE |
| Inbox rendering                        |   – |   2 | W2-01: scroll-snap churn; W2-02: dirty flash adds Back entries                                                                                                           | MUTATIONS_AND_HOOKS              |
| Bundles                                |   – |   – | P2: ~2.0 MB of 5.74 MB of chunks duplicated; lodging schema and zod shipped where unneeded                                                                               | PERFORMANCE                      |
| Delivery and operations                |   – |   4 | W7-1: no production telemetry; W7-2: promote goes straight live; W7-3: laptop-only readiness probe; W7-4: no merge gate                                                  | ROADMAP                          |

---

## 5. Cross-layer findings (Phase 8)

These came from combining workstreams; no single agent saw them whole.

1. **Inbox interaction amplification (W0-05 × W5-01 × W1-F2 × W1-F3 × W2-01).**
   Selecting a review costs 1 RSC request and 5 transactions, including an
   `app_session` write. Shared layouts are reused on a search-param-only
   navigation, so only the inbox page re-runs (Next 16.3.8 source, R2-X1).

   A happy-path publish costs N+4 requests and 2N+13 transactions, where N is
   the number of loaded pages. Most of that is the refetch of every loaded
   page, not the publish itself (4 transactions).

   An idle, visible inbox tab makes 40 requests and 80 transactions every 10
   minutes.

   Each re-render snaps the list back to the selected row. R2-X1 also flags a
   plausible list collapse: new page data on selection may replace the N
   loaded pages with page 1. This needs runtime confirmation.

   The individual fixes are small, but they compound. The model is in
   `raw/R2-X1-interaction-cost-model.md`. All counts are operations derived
   from code, not timings.

2. **Mutation contracts cause the refetch storms (W1-F2 × W3).** Review write
   endpoints return only status fields and IDs, not the updated review
   (`lib/contracts/reviews.ts:657-723`: draft, publish, delete and approval
   results). The client cannot patch its cache from them, so it invalidates
   everything. If publish, approve and delete returned the updated review row,
   in the same shape as `readReviewsPage`, the client could `setQueryData` into
   the loaded pages and refetch only the counts. That needs a server contract
   change.
3. **Sync vs. user writes (W4-03 × W8-04 × publishing).** The same
   unconditional upsert that rewrites every review every 15 minutes is what can
   blank a just-published reply. One change fixes both the cost and the
   integrity race: skip unchanged rows by `content_hash`, and guard reply
   columns on update time or an in-flight attempt.
4. **Lock transactions × pooler × function limits (W4-01 × W4-02 × W3-4).**
   Publish paths hold a session-pooler slot and an idle transaction across
   Google calls that can outlast both the 60 s idle-transaction limit and the
   function's `maxDuration`. The outcomes:
   - the receipt says "succeeded" while the user sees a 5xx;
   - lock waiters fail at 30 s;
   - pooler slots tie up under load.
5. **Errors invisible to operations (W3-3 × W7-1).** Upstream and invariant
   failures surface as unlogged 400s. Production has no telemetry exporter
   either, so the failure modes in items 3–4 would not be noticed today.
6. **Live Google reads instead of the synced copy (W3-2 × W0-04 × W8).** Editors
   read Google on every open, even though the 15-minute sync already holds the
   data. That multiplies Google quota and latency per human action. The
   freshness check already used for media shows the pattern to reuse.

---

## 6. Corrections made during verification

The full list is in `VERIFIED_FINDINGS.md`, under "Refuted or corrected
claims". The most consequential:

- **W4-01's first proposed fix was unsafe.** It moved the lock to session level
  outside a transaction. That removes the only time limit on a lock held by a
  frozen instance, and it fails when `DATABASE_SESSION_URL` is unset.
- **Lock-connection timeouts exist only as role settings.** They are set by
  `db-create-runtime-role.mjs:37-40`. `withSessionConnection` (`db.ts:65-69`)
  sets none itself.
- **W8-04, W8-03, W8-05, W3-1, W5-02 and W1-F3 were downgraded to P2** after
  re-tracing showed bounded or self-healing impact.
- **Two leads were downgraded on inspection:** the `webhook_route` hijack is
  blocked by forced RLS, and the `LOCAL_BOOTSTRAP_ENABLED` production name is
  guarded by hostname checks.
- **W2's lint claim was refuted.** "Compiler rules skip complex components" was
  wrong.
- **W7's claim that subscription changes were untested was wrong.** The
  integration suite covers them.

---

## 7. Limitations

- No runtime measurements exist for latency, query counts or render counts.
  Every cost figure is derived from code paths and labelled as such.
  `PERFORMANCE_OPTIMISATION.md` lists the instrumentation each figure needs.
- SEC-11 needs the operator to run the SQL in §3.4.
- These need a running app to confirm:
  - the number of server renders per row click (W5-01);
  - the Back-history effect (W2-02);
  - scroll-snap frequency (W2-01).
- Integration and e2e results are taken from the latest release receipt, not
  re-run.
- The user's in-progress inbox edits were reviewed by R2-V5. They are
  layout-only and change no verdict.
