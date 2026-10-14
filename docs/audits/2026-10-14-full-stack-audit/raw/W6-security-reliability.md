# W6 — Security, authorisation, concurrency, reliability, error handling

**Scope covered:** all 160 `app/api/**/route.ts` files plus `app/auth/confirm/route.ts` (authn mode, origin guard, roles, MFA step-up, entitlement, location/client guards traced into `lib/server/*`); server actions (none exist: `rg '"use server"'` → 0 hits); `lib/server/route.ts`, `http.ts`, `proxy.ts`, `next.config.ts`; sessions (`session.ts`, `session-store.ts`, `email-auth.ts`, `mfa` step-up, `oauth-return.ts`, `lib/api/next-path.ts`, support impersonation, workspace switch, invitations); webhooks (Stripe, Resend/Svix, Pub/Sub, RISC) and the cron bearer; report-share tokens; `crypto.ts` key ring; `logger.ts` + `lib/domain/redaction.ts`; outbound `fetch` (SSRF), XSS sinks, asset upload pipeline (`lib/server/assets.ts`); RLS + SECURITY DEFINER inventory over `supabase/migrations` (131 files); concurrency in AI credits, reply publish/retry, job runner leases; error boundaries; `pnpm audit --prod`.

**Commands run (all read-only):**

- `find app -name route.ts` + a node script that splits each file on `export const (GET|POST|…)` and extracts `auth`, `origin`, `roles`, `mfa`, `entitlement`, `limits`, `body` → `/tmp/w6inv.txt` (246 handler rows).
- A second node script that follows each handler's imported callees (depth 4) to a visibility/permission guard (`requireLocationAccess|requireLocationAction|visibilityPredicate|grantsFor|requireClientAccess|…`).
- Read `tests/route-authorization-contract.test.ts` (the existing static authz contract) to avoid duplicating it.
- A node script over `supabase/migrations/*.sql` listing tables, `enable/force row level security`, policies, and the latest definition of every SECURITY DEFINER function (52) with its `search_path`; plus `rg` for `revoke … from public` / `grant execute` / `anon` / `authenticated`.
- `rg` sweeps: `dangerouslySetInnerHTML|innerHTML`, `fetch(`, `redirect(`, dynamic `href={…}`, `Cache-Control`, `log.*(` with PII-shaped keys, `for update|skip locked|advisory|on conflict` per workflow module.
- `pnpm audit --prod --json` (exit 0).
- Read `docs/release/ledger.md` / `decision-log.md` security rows to cross-reference known items.

**Could NOT cover / limits:**

- No live database: the Supabase privilege state (Data API exposure, `anon`/`authenticated` grants) is inferred from migrations only. W6-01 therefore stays PLAUSIBLE until the read-only SQL in that finding is run on staging and production.
- I didn't run vitest, integration tests or e2e (they write artifacts and need a DB). Behavioural claims rest on the code paths and the existing tests named below.
- Next.js default `Cache-Control` on route-handler JSON was not measured (W6-11 is PLAUSIBLE).
- Deep Google-workflow modules (verification, lifecycle, administration reviews) were spot-checked only: the PATCH administration path pins `payload.name`.
- `pnpm audit` ran under Node 22.23.1 although `engines` requires Node 24. The audit itself does not depend on the Node version.

**Overall posture (brief):** the application layer is unusually strong. Every route goes through `route()` (`lib/server/route.ts:347-453`): same-origin guard, JSON-only bodies (415 otherwise), constant-time cron bearer, role gate, MFA step-up, billing entitlement and zod parsing. A static contract test pins location-level guards (`tests/route-authorization-contract.test.ts`), and my independent trace found no unguarded state-changing route. Webhooks verify signatures in constant time with replay windows and idempotent receipts. Session tokens are 256-bit random and stored as SHA-256. Cookies are `httpOnly`/`SameSite=Lax`/`Secure`. Redirects are sanitised. Logs are redacted, there are no XSS sinks and no fetches to user-controlled URLs. AI credits are debited under an organisation row lock and leases are advisory-locked on a session pooler. **The weak point is below the app, in the database privilege model.**

---

## Authorisation matrix (summary)

| Class                   | Routes (handlers)                                                                                                             | Authn                                                                          | Tenant binding                                                             | Authz                                                                                                                                                                      | CSRF                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Session reads           | ~95 GET                                                                                                                       | `requireSession` (cookie → sha256 → `app_session`)                             | `ctx.tenant` = `withTenant(session.organisationId)`; never a client header | visibility helpers in domain modules (traced: all `locations/[id]/*` GETs reach `requireLocationAccess`/`visibilityPredicate`/`linkedForWrite`)                            | n/a (safe method)                                                          |
| Session mutations       | ~105                                                                                                                          | same                                                                           | same                                                                       | `roles` on route **or** `requireLocationAction*` chain (pinned by contract test) **or** NO_LOCATION allowlist; `mfa:"step_up"` on publish/approve/team/connection/settings | `assertSameOrigin` (Origin → Sec-Fetch-Site), JSON-only body, SameSite=Lax |
| Cron                    | 15                                                                                                                            | `Authorization: Bearer CRON_SECRET` via `secretEqual` (timing-safe)            | `withTenant` per org from `organisation_job_route`                         | none beyond bearer                                                                                                                                                         | `origin:"any"`                                                             |
| Session-or-cron hybrids | sync/{sweep,reconcile,keywords,performance} POST, operations/health GET                                                       | in-handler `getSession()` or `isCronRequest`                                   | session org or fleet                                                       | `requireRole(owner,admin)` in handler                                                                                                                                      | `origin:"same"`                                                            |
| Webhooks                | stripe, email, pubsub, risc                                                                                                   | Stripe-Signature / Svix HMAC / Google OIDC + SA pin or shared token / RISC JWT | routed via `webhook_route` → `withTenant`                                  | n/a                                                                                                                                                                        | `origin:"any"`                                                             |
| Public                  | password/*, mfa/verify, mfa/factors, invitations/[token] GET, session GET/DELETE, support/impersonation POST, `/auth/confirm` | abuse-limited                                                                  | n/a                                                                        | n/a                                                                                                                                                                        | password forms and sign-out declare `origin:"same"`                        |

**IDOR check:** no route takes an organisation id from the client except `session/switch` (membership checked inside the target tenant), `support/impersonation` (shared secret) and cron operator routes (bearer). Location, client, review, post and asset ids are always resolved under RLS and then gated by the permissions module. I found no IDOR.

---

## Findings

### W6-01 Supabase Data API + default grants: an anonymous caller could plausibly read tenant ids and make themselves owner of any tenant

- **Priority:** P0
- **Status:** PLAUSIBLE. The code chain is CONFIRMED; whether it is reachable depends on project privilege state that can't be seen from the repo (ledger SEC-11 / D-23 is still "awaiting evidence" while production promotions continue: `docs/release/receipts/20261014T103113Z-2b26bcf2ec59.json`).
- **Location:**
  - `supabase/migrations/0005_tenant_hardening.sql:76-92` (`provision_local_bootstrap`), `:97,101` (revoke from PUBLIC, grant to runtime)
  - `supabase/migrations/0005_tenant_hardening.sql:134-137` (`organisation_job_route_read … for select using (true)`, no `TO` role)
  - `supabase/migrations/0005_tenant_hardening.sql:109-110` (`webhook_route_resolve … using (true)`)
  - `supabase/migrations/0008_product_completeness.sql:61-76` (`list_user_organisations(p_user_id)`)
  - `supabase/config.toml:5-8` (`[api] enabled = true`, `schemas = ["public", …]`)
  - Platform tables with no RLS at all: `ops_heartbeat`, `cron_cursor`, `google_rate_bucket`, `platform_incident`, `platform_incident_delivery` (holds recipient emails), `risc_event`, `retention_cycle`, `retention_cycle_org` (my RLS script: "NO RLS" list minus the 20 tables enabled by the loop at `0001_initial.sql:510-529`).
- **Evidence:**
  - Every SECURITY DEFINER function (52, all with `set search_path = public`) is locked down only with `revoke all on function … from public` followed by `grant execute … to naba_app_runtime` (94 such revokes).
  - `rg -n "anon|authenticated"` over migrations, `scripts/` and `startup.ts` finds no revoke from `anon`/`authenticated` and no `alter default privileges`.
  - Hosted Supabase grants `anon`, `authenticated` and `service_role` privileges on objects `postgres` creates in `public` _directly_, through default privileges. Revoking from PUBLIC doesn't remove a direct grant.
  - The runtime role check in `lib/server/startup.ts:146-162` only checks the runtime's own `rolsuper`/`rolbypassrls`/`row_security`. It never checks what other roles can reach.
- **Root cause:** the tenancy model assumes the only database client is `naba_app_runtime`. With the Data API enabled, PostgREST is a second client: it uses the publishable key, which is public by design, so the model can't depend on keeping it secret.
- **Exploit path (do NOT run):**
  1. `GET https://<project-ref>.supabase.co/rest/v1/organisation_job_route?select=*` with headers `apikey: <publishable key>` and `Authorization: Bearer <publishable key>`. This returns every tenant `organisation_id`, because the policy is `using (true)` for every role.
  2. The attacker gets their own `userId`: register a normal account (registration may be open or invite-only, AUTH-01), then `GET /api/session` returns `session.userId`.
  3. `POST https://<project-ref>.supabase.co/rest/v1/rpc/provision_local_bootstrap` with body `{"p_organisation_id":"<victim org>","p_user_id":"<attacker user id>"}`. The function (running as its owner, so RLS is bypassed) renames the victim org to "Lapen Inns" and upserts `member(role='owner', can_publish=true)` for the attacker (`0005:83-91`).
  4. `POST /api/session/switch {"organisationId":"<victim org>"}`. The membership check now passes, and the attacker is owner of the victim tenant: Google connections, publishing, team management, data export.

  Weaker variants on the same exposure:
  - `rpc/list_user_organisations` with any user id leaks org names and roles.
  - `PATCH /rest/v1/google_rate_bucket` or `ops_heartbeat` (no RLS) can exhaust Google pacing budgets for the whole fleet, or hide dead crons from health checks.
  - `rpc/record_billing_event` can inject billing receipts. This is mitigated: the processor re-fetches from Stripe.

  Discovering the project ref is easy when `MEDIA_ASSET_STORAGE=supabase`. The origin appears in every response's CSP `connect-src` (`next.config.ts:43,59`) and in signed upload URLs returned to members.

- **Verify (read-only SQL, run as postgres on staging, then production):**
  ```sql
  select grantee, table_name, string_agg(privilege_type, ',') from information_schema.role_table_grants
   where table_schema='public' and grantee in ('anon','authenticated') group by 1,2 order by 2;
  select p.proname, has_function_privilege('anon', p.oid, 'execute') anon_exec,
         has_function_privilege('authenticated', p.oid, 'execute') auth_exec
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef order by 1;
  ```
  Also check Dashboard → API settings → exposed schemas. Any `true` / any row confirms P0.
- **Recommendation:**
  - (a) Disable the Data API for the project, or remove `public` from exposed schemas. This is the fastest kill.
  - (b) Add a migration that runs `revoke all on all tables, sequences, functions in schema public from anon, authenticated;` plus `alter default privileges for role postgres in schema public revoke all on tables/sequences/functions from anon, authenticated;`.
  - (c) Add `to naba_app_runtime` to every `using (true)` policy.
  - (d) Add a startup/readiness assertion and a migration-contract test asserting `has_function_privilege('anon', …) = false` for every SECURITY DEFINER function and no `anon` table grants.
  - **Alternatives:** move app objects to a non-exposed schema (larger change).
- **Expected benefit:** removes a cross-tenant takeover path that bypasses every application control.
- **Complexity:** S (a, b, c); M (d)
- **Regression risk:** Low. The app never uses PostgREST: all reads go through `postgres.js` as `naba_app_runtime`, and the Supabase JS client isn't used. `asset-storage` uses Storage with a secret key, not table grants.
- **Tests:** a migration test that asserts no `anon`/`authenticated` privilege on `public` objects; extend the `startup-safety` test.
- **Dependencies:** W6-02, ledger SEC-11/D-23, SEC-10.

### W6-02 `provision_local_bootstrap` lets anyone holding the runtime role make any user owner of any organisation

- **Priority:** P1 (it becomes the P0 primitive in W6-01)
- **Status:** CONFIRMED
- **Location:**
  - `supabase/migrations/0005_tenant_hardening.sql:76-92,101` (function)
  - `lib/server/session.ts:352-372` (only caller, `ensureDevelopmentSession`)
  - `lib/server/startup.ts:88-93` (app-side localhost-only guard)
- **Current implementation:** `security definer` function. Its parameters are caller-chosen org and user uuids. It does `insert into organisation … on conflict (id) do update set name = excluded.name` (renames any existing org to "Lapen Inns") and `insert into member … on conflict … do update set role='owner', can_publish=true`. No check that the ids are the fixed local constants (`session.ts:25-26`), and no environment check. It's shipped by a numbered migration, so it exists in production. `docs/architecture.md:46-49` states the runtime role does not hold "unrestricted organisation or user-table privileges"; this function contradicts that.
- **Root cause:** a dev-bootstrap helper was promoted into the production schema. The production guard lives only in Node (`isLocalBootstrapEnabled`).
- **Exploit:** any SQL reachable as `naba_app_runtime` gives owner on any tenant. That covers a future SQL-injection bug, a leaked `DATABASE_URL`, or the W6-01 PostgREST path: `select provision_local_bootstrap('<victim org>', '<attacker user>')`.
- **Recommendation:** in a new migration, either
  - (a) `drop function provision_local_bootstrap(uuid, uuid)` and seed the local org from a dev-only script, or
  - (b) redefine it to `raise exception` unless `p_organisation_id = '00000000-0000-4000-8000-000000000001' and p_user_id = '00000000-0000-4000-8000-000000000002'`, and remove the `on conflict … do update set name`.

  Also audit the other caller-parameterised definers. `list_user_organisations(p_user_id)` (`0008:61`) and `attach_member_user(p_email, …)` (`0005:60`; no callers in `lib/` or `app/`, so drop it) should bind to `current_setting('app.user_id')` the way `search_review_ids` binds to `app.organisation_id` (`0011:15-20`).

- **Expected benefit:** the database itself refuses privilege escalation, as the architecture doc claims.
- **Complexity:** S. **Regression risk:** Low: local bootstrap only uses the fixed ids. `run-test-command.mjs:87` enables bootstrap in tests, so check those tests still pass.
- **Tests:** add a migration test that calls the function with a random org id and expects an exception. Unit tests should stay green.
- **Dependencies:** W6-01.

### W6-03 User-initiated publish re-arms a `retryable` attempt without a status check, so it can race the job runner's retry claim

- **Priority:** P2
- **Status:** CONFIRMED (code path). The impact is PLAUSIBLE.
- **Location:**
  - `lib/server/publishing/attempt.ts:113-180` (`rearmAttempt`: `update publish_attempt … where id = ${input.attemptId}`, with no `and status = 'retryable'`)
  - `lib/server/publishing/intent.ts:441-452` (calls it after a non-locking `findAttemptByKey`)
  - Contrast `lib/server/publishing/retry.ts:261-277` (runner claim uses `and status = 'retryable'`, CAS)
- **Current implementation / root cause:** under READ COMMITTED, `POST /api/reviews/{id}/publish` reads the attempt as `retryable` with its back-off elapsed. Meanwhile the jobs tick (`* * * * *`) claims the same row (`retryable` → `started`) and dispatches it. The user transaction's UPDATE then waits on the row lock, re-evaluates `where id = …` (still true), sets `started`/`attempt_no+1` again and returns `proceed`. Both processes call Google for the same reply. The same race exists for two concurrent user publishes.
- **Attacker / trigger:** none needed. A double click or two approvers clicking while the runner is due is enough. Request: `POST /api/reviews/<id>/publish` with `{ "draftId": "<uuid>" }`, twice, near a tick.
- **Impact:** a duplicate provider mutation. The Google reply PUT is an upsert, and settlement is CAS-guarded (`attempt.ts:248-270`), so the damage is mostly an extra quota-consuming call and two `started` events. For a delete racing a publish, ordering could flip the final Google state. That's a HYPOTHESIS.
- **Recommendation:** add `and status = 'retryable' and (next_attempt_at is null or next_attempt_at <= now())` to both UPDATEs in `rearmAttempt`. Return `null` when no row matches, so `prepare*` falls into the existing "concurrent winner" branch (`intent.ts:454-466`). **Alternative:** `select … for update` in `findAttemptByKey` when called from the prepare path.
- **Expected benefit:** exactly one dispatcher per attempt number.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** add an integration test where the runner claims between the user's read and re-arm (two connections) and assert exactly one provider call. Also verify the existing `tests/integration` publish-retry tests.
- **Dependencies:** none.

### W6-04 The route authorisation contract accepts `roles` that include `"member"` as proof of authorisation

- **Priority:** P2
- **Status:** CONFIRMED
- **Location:** `tests/route-authorization-contract.test.ts:233-237,330-333` (`declaresNonViewerRoles`: any `roles:[…]` without `"viewer"` short-circuits the location-guard requirement)
- **Evidence:** 7 mutating handlers declare `["owner","admin","member"]`:
  - `assets` POST, `assets/[id]/finalise` POST
  - `drafts/[id]/verify` POST
  - `listings/bulk/[id]/cancel` and `retry` POST
  - `reviews/[id]/drafts` POST
  - `reviews/bulk` POST

  A `member` can be location-scoped (`permissions.ts` "assigned"), so a role gate alone does not authorise a location write. Today each of these does reach a guard. My trace found:
  - `requireLocationAccess`: `app/api/drafts/[id]/verify/route.ts`
  - `requireBatchControl`: `lib/server/bulk-listings.ts`
  - `createReviewDraft`: `lib/server/review-drafts.ts`
  - `requireLocationAction`: `reviews/bulk/route.ts:318`
  - org-level assets are viewer-refused in `lib/server/assets.ts:46-51`

  The contract would not catch a regression in any of them.

- **Recommendation:** treat a roles list containing `"member"` like no roles. Require an action guard, a DELEGATED chain, or a NO_LOCATION entry (assets are org-level and belong in NO_LOCATION with a reason).
- **Expected benefit:** closes the one gap in an otherwise excellent PERM-02 contract.
- **Complexity:** S. **Regression risk:** none (test-only).
- **Tests:** add the contract change plus allowlist entries.
- **Dependencies:** none.

### W6-05 `/auth/confirm` signs a browser in on a plain GET (login CSRF and link-scanner consumption)

- **Priority:** P2
- **Status:** PLAUSIBLE
- **Location:** `app/auth/confirm/route.ts:18-61` (GET → `verifyEmailToken` → `completeEmailAuthentication` → `setSessionCookie`); `lib/server/email-auth.ts:211`
- **Current implementation:** the first GET with a valid `token_hash` consumes the one-time Supabase token and mints a session cookie in whatever browser made the request. No same-browser binding, no interstitial.
- **Exploit:**
  1. The attacker registers `attacker@x` and does not click their own confirmation email.
  2. They send the victim `https://<app>/auth/confirm?token_hash=<attacker's>&type=email`.
  3. The victim's browser is now signed in as the attacker, and their prior session is replaced (`SameSite=Lax` allows top-level GET).
  4. If the victim then clicks "Connect Google" in what looks like their workspace, the victim's Google Business Profile grant lands in the attacker's organisation (`connect/start` → callback binds to the _current_ session, `app/api/auth/callback/google/route.ts:135-145`).

  Separately, corporate mail scanners (Defender Safe Links and similar) prefetch GET links and burn the single-use token. The user then lands on `invalid_email_link`. That's a reliability issue.

- **Recommendation:** make `/auth/confirm` a GET page with a "Continue" button that POSTs (same-origin guarded) to perform verification. Alternatively, bind sign-up to the originating browser with a short-lived cookie nonce and refuse the link elsewhere (that adds friction). At minimum, show the target workspace/email before switching an already signed-in browser.
- **Complexity:** M. **Regression risk:** Medium. Update the email templates (`supabase/templates`) and the e2e sign-up flow.
- **Tests:** an e2e test where the confirm link opened in a browser holding another session doesn't silently switch; a unit test that GET doesn't call `verifyEmailToken`.
- **Dependencies:** AUTH-01/AUTH-02.

### W6-06 Signing in over an existing session leaves the old session row valid

- **Priority:** P3
- **Status:** CONFIRMED
- **Location:** `lib/server/email-auth.ts:141-211`. The non-MFA path calls `setSessionCookie(provisioned.token)` without `clearSession()`. The MFA path does clear it (`:121`), and so do step-up (`app/api/auth/mfa/step-up/route.ts:147`) and the invitation accept path (`app/api/invitations/[token]/route.ts:75-77`).
- **Impact:** the previous token stays usable until its idle expiry (`SESSION_IDLE_DAYS`, 14 days per AUTH-03) for anyone who captured it. That includes the shared-computer case: user B signs in over user A's still-live session, and A's cookie value remains valid server-side.
- **Recommendation:** call `await clearSession()` (or delete by the presented token hash) before `setSessionCookie` in `completeEmailAuthentication`.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** a unit test that signs in with an existing cookie and asserts the old `app_session` row is deleted.
- **Dependencies:** none.

### W6-07 Session-or-cron hybrid POSTs bypass the wrapper's per-session controls

- **Priority:** P3
- **Status:** CONFIRMED
- **Location:**
  - `app/api/sync/sweep/route.ts:38-60`, and the same pattern in `sync/reconcile`, `sync/keywords`, `sync/performance` (`auth:"public", origin:"same"`, session read in handler)
  - `lib/server/route.ts:418-419,437-446` (entitlement and `withAuditActor` run only when the _wrapper_ holds a session)
- **Impact:**
  - An owner/admin of an organisation whose billing is read-only (402 elsewhere) can still trigger manual syncs that spend Google quota.
  - A support-impersonation session triggering a sync is audited as the customer, not the support actor (route.ts doc item 10).
  - No `Idempotency-Key` intent.
- **Recommendation:** add `auth: "session_or_cron"` to `route()`, which resolves the session when present and otherwise requires the bearer, then applies entitlement and the audit actor uniformly. **Alternative:** split each into a session POST and a cron GET (GET is already cron-only).
- **Complexity:** S–M. **Regression risk:** Low. `scripts/scheduler.mjs` uses the bearer.
- **Tests:** `route-entitlements.test.ts` case for the hybrids.
- **Dependencies:** none.

### W6-08 Webhook hygiene: Pub/Sub JWT failures return 500, token accepted in the query string, no body cap on the email webhook

- **Priority:** P3
- **Status:** CONFIRMED
- **Location:**
  - `lib/server/pubsub.ts:55-58`: `jwtVerify` throws JOSE errors that are not `ApiError`, so `mapError` logs `api.unhandled_error` and answers 500 `internal_error` (`lib/server/http.ts:148-156`).
  - `lib/server/pubsub.ts:24-27`: `x-goog-pubsub-token` **or** `?token=`. Query strings land in platform access logs; app logs redact the `token` param via `redaction.ts`, but Vercel's request log does not.
  - `app/api/webhooks/email/route.ts:22`: `request.text()` with no size limit, unlike Stripe's 512 KiB cap (`billing/webhook.ts:22`).
- **Impact:** forged or expired OIDC tokens cause 5xx noise and error-log volume, which can trip 5xx alerting. Shared-token mode may leak the token through URL logs.
- **Recommendation:** wrap `jwtVerify` in try/catch and throw 401 `invalid_pubsub_identity`. Accept only the header (or document OIDC-only for production). Add a `content-length` and byte cap to the email webhook.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** extend `tests/pubsub-verification.test.ts` (forged JWT → 401) and `email-webhook-signature.test.ts` (oversize → 413).
- **Dependencies:** none.

### W6-09 Support impersonation is a single shared bearer secret with a self-asserted actor (known, still open)

- **Priority:** P2 (ledger SEC-01..03, D-18, rated P0 there)
- **Status:** CONFIRMED
- **Location:** `app/api/support/impersonation/route.ts:25-119`
- **Evidence:**
  - One `SUPPORT_IMPERSONATION_SECRET`; `x-support-actor` is any syntactically valid email (`:22,57-59`).
  - The target can be any member including owners (`:72-78`, no role filter).
  - Guessing is throttled only per client IP. `clientIpFromRequest` returns null off Vercel or when `CLIENT_IP_HEADER` is unset, and `checkAbuseBudget` skips null keys (`lib/server/abuse-limits.ts:290-297,343-346`), so the budget is unlimited there.
  - Mitigations already in place: off by default (`SUPPORT_IMPERSONATION_ENABLED`), 1-hour non-sliding session, aal1 (so step-up actions are blocked when MFA is on), audit actor attribution, and support sessions die when the flag flips off (`session.ts:207-215`).
- **Recommendation:** keep it disabled in production until replaced with per-engineer identities (e.g. an OIDC or signed short-lived grant naming the engineer), customer consent, and refusal to impersonate owners for write actions. Add a global (non-IP) budget key for the scope.
- **Complexity:** M. **Regression risk:** Low.
- **Tests:** existing support tests, plus a null-IP budget test.
- **Dependencies:** D-18.

### W6-10 `CRON_SECRET` doubles as an operator credential

- **Priority:** P2 (known, D-33)
- **Status:** CONFIRMED
- **Location:**
  - `app/api/operations/organisations/[id]/ai-credits/route.ts:54` (GET/POST/PUT grant AI credits to any org, with the operator named in the body)
  - `app/api/operations/reencrypt/route.ts:25`
  - `app/api/operations/readiness/route.ts`
  - `app/api/billing/reconcile/route.ts`
- **Impact:** the secret Vercel injects into every cron call can also mint credits for any tenant and drive key re-encryption, so one leak covers all of it. The body-asserted operator isn't authenticated.
- **Recommendation:** use a separate `OPS_ADMIN_SECRET` (or per-operator signed tokens) for `/api/operations/*` writes, and keep `CRON_SECRET` for ticks only.
- **Complexity:** S. **Regression risk:** Low (ops scripts).
- **Tests:** a route test asserting the cron bearer gets 401 on operator writes.
- **Dependencies:** D-33.

### W6-11 Authenticated JSON responses carry no explicit `Cache-Control`

- **Priority:** P3
- **Status:** PLAUSIBLE
- **Location:** `lib/server/route.ts:296-298` (`toResponse` → `NextResponse.json(result)` with no headers). Only 7 routes set `no-store` themselves, for example `app/api/audit-log/route.ts:129` and `app/api/privacy/export/route.ts:244`. `next.config.ts:126-139` sets no API-wide cache header.
- **Impact:** Vercel's CDN does not cache responses lacking `s-maxage`, and the browser heuristic needs `Last-Modified`, so real-world exposure is low. But per-user data (reviews, members, session) relies on defaults rather than intent, and intermediaries or a future `revalidate` could change that. This needs measuring: `curl -sI` against a staging GET with a session cookie to see what Next emits.
- **Recommendation:** in `route()`, set `cache-control: private, no-store` on session-authenticated responses that didn't set their own.
- **Complexity:** S. **Regression risk:** Low (TanStack Query is unaffected).
- **Tests:** a wrapper unit test.
- **Dependencies:** none.

---

## Checked and found sound (no finding)

- **CSRF:**
  - `assertSameOrigin` plus a 415 on non-JSON bodies plus `SameSite=Lax` (`route.ts:265-299`, `session.ts:268-282`).
  - The only cookie-authenticated GETs with side effects are `/auth/confirm` (W6-05) and the dev-only `/api/session` bootstrap, which is gated by `NODE_ENV`/localhost (`session.ts:283-288`, `startup.ts:88-93`).
- **Open redirect:** `sanitiseNextPath` (WHATWG parse against a placeholder origin) plus the `safeOAuthReturn` allowlist; `/auth/confirm` builds redirects from `NEXTAUTH_URL`.
- **OAuth:** HMAC-signed state cookie with nonce, expiry, PKCE verifier, and session/org/user binding re-checked at the callback (`app/api/auth/callback/google/route.ts:116-160`).
- **Webhooks:**
  - Stripe uses `constructEvent` (5-minute tolerance), a livemode/account check, a body cap and an idempotent receipt.
  - Svix: HMAC, `timingSafeEqual`, a 300 s window, an idempotent event id.
  - RISC: JWKS from discovery, issuer/audience, `jti`/`iat`, `jti` replay table.
  - Pub/Sub: OIDC plus a mandatory service-account pin (refuses audience-only config), a messageId upsert and a lease claim.
- **Share links:** 32-byte tokens stored as sha256, mandatory expiry, revocation, a SECURITY DEFINER lookup that answers only live links, abuse-limited, `no-referrer`/`noindex`/`no-store` headers (`next.config.ts:93-97`), and a client-share visibility scope that can't reach grants.
- **Invitations:** token hashed; acceptance under `for update` with an email match against the session (`lib/server/provisioning.ts:499-560`). Only owners can grant owner (`member-roles.ts`, used by members, invitations and resend). The last-owner set is locked `for update` (`members/route.ts:20-38`).
- **Crypto:**
  - AES-256-GCM with a random 12-byte IV per write and a key-id'd ring for rotation.
  - Timing-safe compares everywhere (`crypto.ts:211-244`).
  - Keys are min 32 chars (`env.ts:140-148`).
  - Minor note: there's no AAD binding ciphertext to its row, so a DB-write-capable attacker could swap ciphertexts. Not a finding at this threat level.
- **Logging:** `redactForLog` strips credential keys, bearer/JWT patterns, URL userinfo and query secrets; no PII keys found in `log.*` calls. 500s return a generic message plus the request id.
- **Injection, XSS, SSRF:**
  - No `sql.unsafe`; fragments are parameterised.
  - No `dangerouslySetInnerHTML`.
  - Every server `fetch` targets fixed provider bases with `AbortSignal.timeout` (Google, Supabase Auth/Storage, Resend, OpenAI).
  - Google-sourced hrefs render through React 19, which blocks `javascript:` URLs.
- **Uploads:** client-declared metadata is only recorded; the server re-reads the bytes, sniffs the type, checks size and dimensions, re-hashes, and writes to an app-chosen immutable key. A two-phase finalise without a held lock or transaction; staging purge by retention (`lib/server/assets.ts`).
- **Concurrency:**
  - AI credits reserve and settle under an organisation row lock.
  - The publish idempotency key is `unique(organisation_id, idempotency_key)` with on-conflict handling.
  - Bulk, schedule and invitation claims use `for update` or `skip locked`.
  - Tick leases are advisory locks on a session-pooler connection, and startup refuses a 6543 transaction pooler (`startup.ts:38-46`).
  - Google mutations are never auto-retried (`transport.ts:343`); reads use capped backoff that honours `Retry-After`.
- **Error boundaries:** `app/global-error.tsx`, `(dashboard)/error.tsx`, `(auth)/error.tsx`, `share/report/[token]/error.tsx` plus section-level ones; every dashboard route is covered.
- **Dependencies:** `pnpm audit --prod` reports 0 advisories across 215 production deps (Next 16.3.8). **The ledger is stale:** DEP-01..05 (Next 16.2.6 advisories, `shadcn` and `@shadcn/react` in prod deps) appear resolved, since `package.json` has `next@16.3.8` and neither shadcn package. LST-11/12 (`payload.name` pinning) is implemented on the administration PATCH path (`lib/server/location-administration.ts:234-240`).

---

## Top 5 for this workstream

1. **W6-01 (P0, plausible):** run the two read-only privilege queries now. If `anon`/`authenticated` can execute definers or read `organisation_job_route`, disable the Data API or revoke the grants before the next promotion.
2. **W6-02 (P1):** drop or guard `provision_local_bootstrap`, and bind `list_user_organisations` to `app.user_id`. A database-level privilege escalation exists regardless of W6-01.
3. **W6-03 (P2):** add the `status = 'retryable'` CAS to `rearmAttempt` so a user publish can't double-dispatch with the runner.
4. **W6-05 (P2):** move `/auth/confirm` sign-in behind a POST interstitial (login CSRF and mail-scanner token burn).
5. **W6-04 (P2):** tighten the route authz contract so `member`-inclusive `roles` still need a location guard or an allowlist entry.

## Cross-layer leads for other workstreams

- **Perf/DB:** every authenticated request performs an `UPDATE app_session set last_seen_at, expires_at` (`lib/server/session.ts:221-235`). That is a write per API call; consider throttling it, e.g. only when `last_seen_at < now() - 5 min`.
- **Perf/DB:** `lookupSession` also runs `getOrganisationBilling` on every request (`lib/server/session.ts:237-242`). That's 3–4 queries per call before the handler runs.
- **Frontend/CSP:** `script-src 'unsafe-inline'` remains (`next.config.ts:57`); a nonce-based CSP is the documented follow-up (SEC-05).
- **Frontend/CSP:** there's no HSTS header in `next.config.ts:129-136` (Vercel adds one on its domains; verify on the custom domain).
- **Ops:** the ledger and decision-log rows DEP-01..05 and LST-11/12 look out of date compared with the code (see "Checked and found sound"). Refresh them so the G1 gate isn't blocked on closed items.
- **API contracts:** zod 400 responses echo `details: error.issues` (`lib/server/http.ts:139-146`). That's harmless now, but a contract-shape leak to unauthenticated callers on public routes.
- **Observability:** the client-supplied `x-request-id` is stored unbounded as a span attribute and in audit metadata (`lib/server/http.ts:184-196`). Cap its length.
- **Reliability:** `app/api/webhooks/google/pubsub/route.ts:41-60` returns 503 while `WEBHOOKS_ENABLED`/`SYNC_ENABLED` is off, so Pub/Sub retries pile up during a pause. Check the subscription's retry/DLQ policy.
