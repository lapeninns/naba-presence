# Connect once, return daily — implementation record

Branch `feat/connect-once-hardening`, cut from `main` at `6d1872e` on
2026-09-23. Brief: the "Connect once, return daily" architecture review
(23 Sep 2026, written against `design/np-redesign`). The "Now" fixes from that
review had already landed on `main` through PR #15 (`49b2003`) before this
work started; they were re-verified here, and several were extended.

Every finding below is **implemented**, **externally blocked** or
**deferred**, with the code and the test that prove it. Nothing is marked done
without both.

## 1. Finding-by-finding

### Blocker

| Finding                                               | Status                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production isn't running; Google approvals unrecorded | **Externally blocked** (see §6) | Checked read-only on 2026-09-23: Vercel production still serves the 226-day-old gb-preview build (`/sign-in` 404, `/signin` 200); production `DATABASE_URL`/`DIRECT_DATABASE_URL` are the 226-day-old values the runbook records as NXDOMAIN; no `SUPABASE_*`, `EMAIL_*` or `OPS_ALERT_EMAILS`. Google Cloud project `23639420332`: every Business Profile API enabled, **quota approved** (Business Information / Account Management / Performance 300 QPM, v4 600 QPM). OAuth publishing status and the `business.manage` sensitivity class are not readable from the CLI. |

### High

| Finding                                              | Status                                    | Code                                                                                                                                                                             | Tests                                                                                                                                                       |
| ---------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wizard stuck after connecting a multi-location login | Implemented (#15), re-verified end to end | `lib/server/clients.ts` `belongsToClient`; callback attaches the client in the connection service's transaction                                                                  | `onboarding-multi-location.test.ts` — 3 accounts / 9 locations, connect → done, resume re-read after every stage                                            |
| Refresh can revive a disconnected connection         | Implemented (#15) and extended            | `lib/server/google/connection-failures.ts`, `connections.ts`: every write guarded by `status <> 'disconnected'` **and** `credential_generation`; disconnect bumps the generation | `connection-failures.test.ts` — refresh succeeds after disconnect; refresh rejected after disconnect                                                        |
| One organisation swept; later batches never reached  | Implemented as a queue                    | `0046` (sweep), `0048_fleet_queue.sql`, `lib/server/recurring-sync.ts`, runner arms in `lib/server/jobs.ts`                                                                      | `fleet-scale.test.ts` — 150 organisations reconciled in **3** simulated minutes (target 20) and swept in **4** (target 24 h); `cron-fleet-coverage.test.ts` |

### Medium

| Finding                                   | Status                                       | Code                                                                                                                                                                                                     | Tests                                                                                                                              |
| ----------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Granted permissions never checked         | Implemented (#15) and extended               | `completeAuthorisation` refuses no `business.manage` (a missing `scope` counts as not granted) and a grant with no refresh token at all; a refresh answer that names scopes without it → needs reconnect | `connection-failures.test.ts` "never activates a consent that left out business.manage"; unit `google-credential-failures.test.ts` |
| 401/403 never mark needs-reconnect        | Implemented (#15) and refined                | `transport.ts` `credentialFailureCode`, `listingAccessFailureCode`, `operatorFailureCode`                                                                                                                | unit `google-credential-failures.test.ts`; `connection-failures.test.ts` "marks one listing, never the connection"                 |
| Disconnect doesn't revoke at Google       | Implemented (#15), outcome now recorded      | `disconnect()` records `google_revocation_status` on the row; a failure is audited and reported as `failed`, never as revoked                                                                            | `connection-failures.test.ts` revoke / revoke-fails cases                                                                          |
| Revocations from Google not received      | Implemented (endpoint); registration blocked | `app/api/webhooks/google/risc`, `lib/server/google/risc.ts`, `0052_risc.sql`                                                                                                                             | `risc.test.ts` — signature, audience, replay, token-hash match, disconnected left alone                                            |
| Concurrent refreshes                      | Implemented (#15), generation-aware          | per-connection session advisory lock + in-process fold, re-read after lock                                                                                                                               | `connection-failures.test.ts` "refreshes an expired token once for 20 concurrent requests across two servers"                      |
| Broken connections fail quietly           | Implemented                                  | org-wide banner `components/app-shell/reconnect-banner.tsx`; incidents + email `lib/server/notifications/*`, `/api/cron/health`                                                                          | `app-shell.test.tsx`; `notifications.test.ts`                                                                                      |
| Accounts/locations tangled across clients | Implemented                                  | account toggle scoped to client + connection (#15); location upsert moves a listing only off a broken login                                                                                              | `onboarding-multi-location.test.ts` isolation + reassignment cases                                                                 |
| Rate limiting only per instance           | Implemented                                  | `0049_google_rate_budget.sql`, `lib/server/google/rate-budget.ts`                                                                                                                                        | `rate-budget.test.ts` (unit + two-server integration)                                                                              |

### Low

| Finding                         | Status      | Code                                                                                                                                   | Tests                                                                                       |
| ------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Encryption key can't be rotated | Implemented | `lib/server/crypto.ts` (format 0x02 + key id, `TOKEN_ENCRYPTION_KEYS`), `lib/server/key-rotation.ts`, `POST /api/operations/reencrypt` | `crypto-rotation.test.ts`; `key-rotation.test.ts` (old key → both → new only, no reconnect) |
| Connections have no named owner | Implemented | `connected_by_user_id` (0047, backfilled from the audit log); `connection_owner_left` incident                                         | `notifications.test.ts`; `onboarding-multi-location.test.ts`                                |
| Misleading health signals       | Implemented | `sync_checkpoint.last_succeeded_at`; staleness from the worst linked location's last success; `sweepStalenessSeconds`; grid scheduling | `health-alerting.test.ts`; `clients-health.test.ts`                                         |
| Alert rules only on paper       | Implemented | `/api/cron/health` every 15 minutes, `platform_incident` for stale heartbeats and quota pressure                                       | `notifications.test.ts` "alerts operators when a tick that used to run stops"               |

### Review sections beyond the findings table

| Item                                                                  | Status                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Three-state health (Up to date / Data delayed / Action needed)        | Implemented: `lib/clients/health.ts` `clientFreshness`, client summaries, listing summaries, board, health strip, inbox, shell chip                                                                                                                    |
| Reconnect in ≤ 2 clicks, back to where you were                       | Implemented: banner button → Google with `login_hint` → same page (return allow-list widened to the working screens)                                                                                                                                   |
| "Reconnected. Catching up …"                                          | Implemented with facts only: the callback reports how many listings were made due; no invented review counts                                                                                                                                           |
| Errors stay where the user was                                        | Implemented (#15); the shell now shows the result on any page                                                                                                                                                                                          |
| Listing-level "Access lost"                                           | Implemented: `external_location.access_state`, listing health `access_lost`, its own incident                                                                                                                                                          |
| Sessions: 14 d idle / 90 d absolute / sign out everywhere             | Implemented: `0051_session_lifetimes.sql`                                                                                                                                                                                                              |
| MFA for owners and admins                                             | **Deferred** — provider dependency (Supabase Auth MFA/TOTP enrolment and step-up); no custom crypto built                                                                                                                                              |
| OAuth-state signing separate from NEXTAUTH_SECRET                     | Implemented with a legacy-accept window                                                                                                                                                                                                                |
| Post scheduling, bulk edits, exports, PWA/push, review campaigns, SSO | **Deferred** — product expansion, out of scope for this brief                                                                                                                                                                                          |
| Presence-resource reconciliation as a queue                           | **Deferred** — it keeps the cron-cursor walk (`cron_cursor`, resumable, no abandoned cursor); its state lives in `presence_resource_reconcile_state` and its work needs a synthesised owner session, so moving it onto the runner is a separate change |

## 2. Decisions and differences from the review

1. **No revoke of the replaced refresh token on reconnect.** The review
   proposed it. Google's web-server guide: revocation "removes all OAuth 2.0
   scopes previously granted to a project, invalidating any issued access or
   refresh tokens for all clients registered under that project" — revoking
   the old token would kill the new grant. The old token is dropped locally
   and ages out of Google's 100-per-client limit. `/revoke` runs only on a
   deliberate disconnect.
2. **Credential generations, not only a status guard.** The review's
   `and status <> 'disconnected'` does not stop a late result from an old
   credential overwriting a reconnect (same row, status active). Every
   post-Google write carries `credential_generation`; reconnect and
   disconnect bump it. A request that loses the race retries once with the
   new token instead of failing.
3. **Missing `scope` is treated as not granted.** Google documents the field
   and never says it may be omitted; failing closed is the documented-safe
   reading.
4. **Revocation testing.** The review's "Google's tokeninfo rejects the old
   refresh token" is not supported by Google's docs (tokeninfo is documented
   for ID tokens only). The supported check is the token endpoint: a revoked
   refresh token answers `invalid_grant`. The soak procedure (§5) uses that.
5. **Queue, not a larger batch.** Reconcile, performance and keywords cron
   ticks only enqueue (`ensure_recurring_checkpoints`); the minute runner
   claims under its per-organisation cap. The fleet sweep was already a
   queue (0046). Next runs are booked on each kind's grid from the slot they
   were due in (`next_scheduled_run`): a late run catches up once and rejoins
   the grid instead of drifting.
6. **Postgres rate budget, windowed so the limit really holds.** Fixed
   10-second windows sized at a sixth of the per-minute setting; any rolling
   minute spans at most seven windows, so 240/min never exceeds 280 < 300, and
   8 edits/min never exceeds 7 < 10. A 429 blocks the bucket for every
   instance until `Retry-After`. The budget fails open to local pacing after
   2 s so a saturated pool can never deadlock a request.
7. **Degraded ≠ needs reconnect.** `expired` without an open reconnect task
   is the platform retrying (Data delayed). Needs reconnect is `revoked` or
   `expired` **with** a task. A client with any broken login is Action
   needed, not the softer "attention" it used to be.
8. **Different-account reconnect.** Only the connection the reconnect was
   started for is labelled `superseded_by_reconnect` (it used to relabel
   every open task in the organisation). Listings move to the new login only
   when their old login is broken, and only through discovery by a login that
   just proved it can reach them.
9. **Email provider.** None existed (only Supabase Auth's own mail). A small
   interface with an optional Resend-compatible HTTP adapter; with none
   configured every delivery is recorded `suppressed` and nothing claims an
   email was sent.
10. **Low-rated review alerts go to owners and admins** and contain only the
    rating and listing title — never the reviewer's name or words.
11. **Session changes never touch Google.** Proven by test: sign out
    everywhere, then the runner still reconciles the organisation.

## 3. Changed files, migrations, configuration

Migrations (all roll-forward, additive, with defaults/backfills, indexes and
RLS where tenant-scoped):

| Migration                   | Adds                                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0047_connection_lifecycle` | `google_connection.credential_generation`, `connected_by_user_id` (backfilled), `last_error_at`, `google_revocation_status/_at`; `external_location.access_state/_lost_at/_error_code`; `sync_checkpoint.last_succeeded_at` (backfilled) |
| `0048_fleet_queue`          | `sync_checkpoint.scheduled_for`, `next_scheduled_run()`, `ensure_recurring_checkpoints()`, `claim_due_jobs` recurring arms, `release_job_lease` fix                                                                                      |
| `0049_google_rate_budget`   | `google_rate_bucket`, `take_google_rate_budget()`, `record_google_throttle()`                                                                                                                                                            |
| `0050_notifications`        | `notification_incident`, `notification_delivery` (both RLS), `platform_incident`                                                                                                                                                         |
| `0051_session_lifetimes`    | `app_session.absolute_expires_at` (backfilled), `revoke_user_sessions()`                                                                                                                                                                 |
| `0052_risc`                 | RISC fingerprints on `google_connection`, `risc_event`, cross-tenant lookup functions                                                                                                                                                    |

New configuration (all optional with safe defaults; `.env.example` documents
each): `TOKEN_ENCRYPTION_KEYS`, `OAUTH_STATE_SECRET`,
`OAUTH_STATE_ACCEPT_LEGACY`, `GOOGLE_RATE_BUDGET_ENABLED`,
`GOOGLE_API_REQUESTS_PER_MINUTE` (240), `GOOGLE_LOCATION_EDITS_PER_MINUTE`
(8), `NOTIFICATIONS_ENABLED`, `EMAIL_PROVIDER` (`none`), `EMAIL_API_KEY`,
`EMAIL_FROM`, `EMAIL_API_BASE_URL`, `OPS_ALERT_EMAILS`,
`LISTING_STALE_AFTER_HOURS` (6), `SESSION_IDLE_DAYS` (14),
`SESSION_ABSOLUTE_DAYS` (90), `RISC_ENABLED`.

New cron: `/api/cron/health` every 15 minutes (`vercel.json`). New endpoints:
`/api/cron/health`, `/api/notifications`, `/api/operations/reencrypt`,
`/api/webhooks/google/risc`, `DELETE /api/session?scope=all`.

## 4. Test evidence

See the final handover in the PR description for the exact commands and
results of the full run. Per-area suites added or changed on this branch:
`connection-failures`, `fleet-scale`, `cron-fleet-coverage`,
`vercel-cron-ticks`, `rate-budget` (unit and integration), `health-alerting`,
`notifications`, `session-lifetimes`, `risc`, `key-rotation`,
`onboarding-multi-location`, `crypto-rotation`, `clients-health`,
`google-credential-failures`, `listing-health`, `app-shell`,
`oauth-return`, `google-pacing`.

The acceptance list from the brief, mapped:

| #   | Criterion                                           | Test                                                                                                                                          |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 20 concurrent expired-token requests → one refresh  | `connection-failures` "…20 concurrent requests across two servers"                                                                            |
| 2   | Disconnect race                                     | `connection-failures` "stays disconnected when a refresh succeeds/is rejected after the disconnect"                                           |
| 3   | Reconnect race                                      | `connection-failures` "a refresh rejected/answered on the old credential cannot…", "a 401 on a token from before a reconnect…"                |
| 4   | No `business.manage` → never active                 | `connection-failures` "never activates a consent that left out business.manage"                                                               |
| 5   | Outages/quota → Data delayed; listing loss isolated | `clients-health` freshness cases; `connection-failures` "marks one listing, never the connection"; `rate-budget`                              |
| 6   | 3 accounts / 9 locations, resume                    | `onboarding-multi-location`                                                                                                                   |
| 7   | Client isolation                                    | `onboarding-multi-location` "keeps one client's account choice…"                                                                              |
| 8   | 150 organisations                                   | `fleet-scale`                                                                                                                                 |
| 9   | Failures never advance last success                 | `health-alerting` (failed reconcile after an old success stays stale); reviews/performance/keywords set `last_succeeded_at` on success only   |
| 10  | Notifications: recipients, dedup, isolation         | `notifications`                                                                                                                               |
| 11  | Reconnect UX keeps identity and return path         | `app-shell` "…one-click reconnect for admins" (`reconnectConnectionId` + `returnTo`); login_hint from the stored email (#15, `connect/start`) |
| 12  | Key rotation without reconnects                     | `key-rotation`, `crypto-rotation`                                                                                                             |
| 13  | Session separation                                  | `session-lifetimes` "signs a person out everywhere without touching Google or background sync"                                                |

## 5. Staging soak and live verification (not run here)

The 30-day persistent-connection criterion cannot be proven in a session, and
this record does not claim it. Procedure for staging once it exists:

1. Preconditions: OAuth app **In production** (not Testing — Testing issues
   7-day refresh tokens); staging on its own database; health cron and
   `OPS_ALERT_EMAILS` configured; email provider configured.
2. Day 0: connect a shared manager login for one test Business Profile
   through the setup wizard. Record `google_connection.id`,
   `credential_generation`, and `refresh_token_expires_at` (must be null in
   production mode).
3. Daily, automatically: `GET /api/operations/health?scope=platform` (cron
   bearer) → record `reconcileStalenessSeconds`, `sweepStalenessSeconds`,
   `schedulerTicks`, `googleQuota`; and for the connection: `status`,
   `last_refresh_at`, open reconnect tasks, `credential_generation` (must not
   change without a person reconnecting). Store in
   `docs/live-certification/evidence/connect-once-soak.md`.
4. Pass: 30 consecutive days with the connection `active`, no reconnect task,
   `reconcileStalenessSeconds` under 3600 at every sample, no person action.
5. Revocation drills (separate test login, after the soak): (a) remove the
   app at myaccount.google.com → Third-party connections; measure time to
   `status = revoked` + reconnect task + email + banner (target ≤ 15 min
   without RISC via the next refresh/API call, ≤ 1 min with RISC registered).
   (b) Disconnect in the app → verify with the token endpoint that the old
   refresh token now answers `invalid_grant` (not tokeninfo).

What is simulated here versus live: all Google traffic in the test suites is
a local stub; RISC events are signed by a test key served as a stand-in
discovery document. Live RISC delivery requires registration (§6).

## 6. External blockers

| Blocker                                 | Evidence                                                                | Owner action                                                                                                                                                                                                                                                         | Blocks                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Production database does not exist      | Production DB variables unchanged for 226 days, host NXDOMAIN (runbook) | Provision the database (runbook "Production database"), run `pnpm db:migrate` (now 52 migrations incl. 0047–0052), create the runtime role, set Vercel env                                                                                                           | Everything in production                                                 |
| Production serves the old build         | `/sign-in` 404, `/signin` 200 on `googlereview-gbp.vercel.app`          | Deploy this branch after merge, once the database exists                                                                                                                                                                                                             | Everything in production                                                 |
| OAuth publishing status and scope class | Not readable via gcloud                                                 | In Cloud Console → Google Auth Platform: confirm **In production**; check the Data Access page for `business.manage` sensitivity; start verification if sensitive                                                                                                    | Persistent (> 7 day) connections                                         |
| Email provider                          | None configured anywhere                                                | Choose a provider (adapter is Resend-shaped), verify a sender domain, set `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `OPS_ALERT_EMAILS`                                                                                                                        | Email delivery (incidents still recorded and shown in-app)               |
| RISC registration                       | `risc.googleapis.com` not enabled on the project                        | Enable the RISC API, accept RISC terms, create a service account with `roles/riscconfigs.admin`, register the stream at `/api/webhooks/google/risc` for `token-revoked`, `tokens-revoked`, `account-disabled`, `account-purged`, `verification`; run `stream:verify` | Revocation detection within a minute (fallback: next refresh / API call) |
| Vercel plan vs cron cadence             | `vercel.json` already had a minute cron before this work                | Confirm the project's plan supports minute and 15-minute crons                                                                                                                                                                                                       | Queue drain rate, alerts                                                 |
| Supabase Auth in production             | No `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` in production env          | Set them (runbook)                                                                                                                                                                                                                                                   | Sign-in                                                                  |
| MFA                                     | Provider feature                                                        | Enable Supabase Auth MFA and decide enrolment policy for owners/admins                                                                                                                                                                                               | MFA (deferred)                                                           |

## 7. GO / NO-GO

**NO-GO for production.** The code for the Now, Next and feasible Later work is
implemented and tested locally, but production has no database, still serves
the old build, has no email provider, and the OAuth publishing status is
unconfirmed. `docs/live-certification/release-checklist.md` remains NO-GO. The
branch is ready for review and merge; production readiness depends on the
owner actions in §6 and the soak in §5.
