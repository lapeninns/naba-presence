# W3: Backend architecture, API routes, services, business logic

**Workstream:** W3, backend API layer (read-only audit, 2026-10-14)
**Evaluated:** HEAD `d8759c74` plus the working tree as-is. The uncommitted inbox UI changes are outside this scope and were not touched.

## Scope covered

- All 159 `app/api/**/route.ts` files. The script inventory (appendix A) records methods, auth mode, role gating, `limits` hook, `runtime`/`maxDuration`/`dynamic` exports, direct `withTenant`/`getDatabase` use, manual `request.json()` and inline SQL counts.
- `lib/server/route.ts` (the wrapper), `lib/server/http.ts` (error mapping), `lib/server/session.ts` (per-request auth cost), `lib/server/db.ts`.
- Outbound clients: `lib/server/google/transport.ts`, `rate-budget.ts`, `credentials.ts`, `connections.ts` (token path), `lib/server/ai.ts`, `lib/server/billing/stripe.ts` (options only). Every `fetch(` call site under `lib/server` and `app/api` was checked for a timeout signal.
- `lib/server/abuse-limits.ts` and every `takeAbuseBudget` call site.
- Service modules, traced end to end where findings depended on them: `reviews.ts` (`syncLinkedLocation`), `review-drafts.ts`, `hours.ts`, `posts.ts`, `media.ts`, `place-actions.ts`, `profile.ts`, `listing-reads.ts`, `prefetch.ts`, `automatic-google-setup.ts`, `google-onboarding-*.ts` (write paths only), `bulk-reviews.ts`, `entitlement-policy.ts`.
- `lib/contracts/*` (page-size caps, sync contracts), `lib/errors/action-errors.ts`, `lib/contracts/wire-codes.ts`, plus the client side where a server finding needed it: `lib/api/client.ts` access-lost codes, `lib/queries/query-client.ts` defaults and the discovery hooks.

## Commands run (all read-only)

- `sed`/`grep`/`wc` over AGENTS.md, docs/architecture.md (§Request skeleton, §Google integration, §Checkpointed synchronization, §Contracts), and the modules listed above.
- `node /tmp/w3audit/inv.mjs`: walks `app/api`, regex-extracts per-route metadata into `/tmp/w3audit/inv.json` (appendix A).
- `node /tmp/w3audit/val2.mjs`: per-handler check for a dynamic segment without a `params` schema, a manual body parse, or a manual `searchParams` parse.
- `node /tmp/w3audit/reach.mjs`: transitive `@/` import-graph scan from each route to `google/transport.ts`, `ai.ts` and `billing/stripe`, cross-referenced with `maxDuration`. This over-approximates: an import does not prove a call.
- `grep -rn "Promise.all…"`, `"request.signal"`, `"process.env.*"`, `"insert into external_location|google_account|webhook_route|location_link"`, `"[a-zA-Z]Schema.parse("`, `"takeAbuseBudget("`, and `fetch(` call sites with a signal check.
- `cat vercel.json` for the cron schedule.

Scratch scripts lived only in `/tmp/w3audit/`. Nothing in the repo was modified except this file.

## Not covered, and why

- **No runtime measurement.** No latency, round-trip or quota numbers were measured. Where impact depends on load, the finding names the instrumentation that would measure it. The platform default `maxDuration` for routes that do not export one was not verified (it depends on the Vercel plan and Fluid settings), so findings say "platform default".
- **Not every service module traced.** About 150 files under `lib/server`, notably the Google onboarding, verification, lifecycle, administration and lodging families. I traced the paths behind the findings and sampled the others' route shells only.
- **Left to other workstreams.** SQL plan and index quality (W4) and authz correctness (W6) are noted only as leads at the end.
- **Job runner internals** (`lib/server/jobs.ts`, `bulk-listing-runner.ts`) were checked only where routes duplicate them.

## What is already good (brief)

- **One wrapper, used everywhere.** All 159 route files go through `route()` (`lib/server/route.ts:368-453`), which owns request id, origin guard, auth, roles, MFA step-up, billing entitlement, zod parsing, abuse limits, the tenant transaction, intents and error mapping. The scripted check found **no dynamic route without a `params` schema**; earlier hits were shorthand `params,` false positives.
- **Uniform error shape.** `{ error, message, requestId, fieldErrors?, retryable?, reconnectRequired?, details? }` comes from `apiError` (`lib/server/http.ts:26-46`). Hand-built `NextResponse.json` returns are used only for non-200 success statuses or redirects.
- **The Google transport is careful** (`lib/server/google/transport.ts:317-538`):
  - per-call deadline and timeout signal;
  - a fleet-wide Postgres budget before a per-process pacer;
  - jittered exponential backoff (`lib/domain/retry.ts:26-34`), honouring `Retry-After` capped at 30s;
  - 429 recorded fleet-wide;
  - mutations never retried, with ambiguous outcomes classified (`classifyMutationFailure`);
  - credential, listing and operator failure classification;
  - OTel span plus duration/count metrics.
- **Every outbound `fetch`** (9 sites) carries an `AbortSignal.timeout`. Stripe uses `timeout` + `maxNetworkRetries: 1` + idempotency keys.
- **Provider calls never sit inside a tenant transaction** (token, then Google, then a short transaction). This is documented and followed: `google/accounts/route.ts:102-110`, `review-drafts.ts:335`, `drafts/[id]/verify/route.ts:93-98`.
- **The Pub/Sub webhook does a real claim with a lease and `maxPages: 1`** (`app/api/webhooks/google/pubsub/route.ts:131-188`).
- **Shared readers.** The prefetch layer and the routes call the same service functions (`lib/server/listing-reads.ts`, `prefetch.ts:176-320`), so business logic is not duplicated between RSC loaders and routes.
- **Bounded list contracts.** Reviews 100, workflows 50, activity 50, bulk list `limit 50` (`bulk-listings.ts:493`).

---

## Findings

### W3-01 Google discovery GETs re-run full paged discovery and per-row upserts on every fetch, including window-focus refetches

- **Priority:** P1
- **Status:** CONFIRMED (the server path and the hook config were read end to end; quota impact is unmeasured)
- **Location:**
  - `app/api/google/accounts/route.ts:72-156` (GET), `:14-36` (`discoverAccounts`), `:111-153` (upsert loop)
  - `app/api/google/locations/route.ts:47-~300` (GET): `:86-116` paging, `:118-257` upsert loop
  - `lib/queries/use-google-accounts.ts:18-21`, `lib/queries/use-google-locations.ts:10-14`
  - `lib/queries/query-client.ts:7-9`
- **Current implementation / Evidence:**
  - Each GET does the following:
    - takes a tenant transaction to find the connection;
    - calls `connectionAccessToken` (its own tenant read);
    - pages **every** Google account (accounts route) or **every location of every active account, serially per account** (locations route, `for (const account of accounts) { … do { googleLocations(...) } while (pageToken) }`);
    - opens a second tenant transaction that runs **one `insert … on conflict do update` per row** inside a `for` loop.
  - The hooks are plain `useQuery`s with the global defaults: `staleTime: 30_000`, `refetchOnWindowFocus: true`, `retry: 1`. So any tab refocus after 30s on the setup or connection screens repeats the whole Google discovery and rewrites every row. A failure is retried once, which doubles the Google load.
  - `PATCH /api/google/accounts` invalidates the same key, so every save triggers another full discovery.
  - Neither route exports `maxDuration`, so they run under the platform default, and neither has an abuse limit.
- **Root cause:** Discovery is a side-effecting synchronisation, but it is modelled as an idempotent read and given cache defaults meant for DB-only reads.
- **Recommendation:**
  1. Split read from refresh. `GET` returns the stored `google_account` / `external_location` rows (DB only). A new `POST …/discover` (or `?refresh=1` with a mutation hook, the way media does it) performs the Google paging and is called on first visit, on explicit "Refresh", or when `last_discovered_at` is older than N minutes.
  2. Batch the upserts into one multi-row `insert … select * from unnest(...)` (or `sql(rows)`) per page instead of N statements.
  3. Set `staleTime: Infinity, refetchOnWindowFocus: false, retry: 0` on these hooks until the split lands.
  4. Add `maxDuration` and a `sync_manual` abuse scope (see W3-07).

  Alternative: keep the GET, but gate the Google read on a `discovered_at` column (the `shouldSyncMediaCache` pattern in `lib/server/media.ts:362-367`).

- **Expected benefit:**
  - Google discovery calls drop from "every focus after 30s" to explicit or stale-only.
  - The DB write volume of the discovery screens collapses.
  - Agencies with many accounts stop risking a `maxDuration` overrun.
- **Complexity:** M
- **Regression risk:** Medium. The setup flow expects fresh rows after OAuth, so trigger discovery on callback return.
- **Tests:** Route test that GET performs no `googleRequest` when rows are fresh. Hook test that focus does not refetch.
- **Measure:** Add an `http.route` attribute to the `google.api.request` span (`transport.ts:355`), then count by route.
- **Dependencies:** W1/W2 hooks; W4 for the batched upsert.

### W3-02 Interactive editor GETs do read-through Google reconciliation with no staleness gate (except media)

- **Priority:** P1
- **Status:** CONFIRMED for the code paths; impact PLAUSIBLE (unmeasured)
- **Location:**
  - **Hours.** `lib/server/hours.ts:125-240` (`readLiveHours`) and `:261-322` (`getHoursState`).
  - **Posts.**
    - `lib/server/posts.ts:688-711` (`listLocalPosts` calls `reconcileLocalPosts` on every first page);
    - `:514-545` (per-post upsert loop, then a delete-marking loop);
    - `:172-191` (up to 100 Google pages).
  - **Place actions.** `lib/server/place-actions.ts:109-117` (`loadPlaceActions` calls `listGooglePlaceActionMetadata` live).
  - **Profile.** `lib/server/profile.ts:258-261` (`readProfileStateBundle` calls `readLiveProfile`).
  - **The good pattern, for comparison.** `lib/server/media.ts:361-385`.
- **Current implementation / Evidence:**
  - `GET /api/locations/{id}/hours` performs, in sequence:
    - a session transaction;
    - `linkedHoursLocation` (`withTenant`, `hours.ts:98`) and a token read;
    - 1–2 Google calls (`fetchGoogleHours` `:132`, `getGoogleHoursCategories` `:153`);
    - `ensureCanonicalResource` (`withTenant`, `:186`);
    - **an observation insert** (`withTenant`, `:213-227`);
    - `latestAttempt` (`withTenant`, `:266`).
  - That is at least 5 transactions, a write, and Google I/O on every read.
  - `GET …/posts` (first page) pages Google posts (cap 100 pages) and upserts each post in a loop before answering.
  - Media alone checks `shouldSyncMediaCache({refresh, count, observedAt})` before touching Google.
  - Combined with the 30s `staleTime` + focus refetch (`query-client.ts:7-9`), an operator switching tabs re-reads Google for each open editor.
  - The 15-minute `/api/sync/presence-resources` cron (vercel.json; architecture.md §Checkpointed synchronization) already reconciles the same resources, so the read-through reconciliation duplicates it.
- **Root cause:** The architecture deliberately reads Google live for the editors (prefetch.ts:319-326 says so). No freshness contract was added after the presence-resources sweep landed.
- **Recommendation:**
  - Apply the media pattern to hours, profile, posts and place actions: serve from canonical/observed rows when the last observation is younger than T (for example 2–5 min), and reconcile live only on explicit `refresh=1`, on first load with no observation, or when stale.
  - Merge the three post-Google transactions in `readLiveHours`/`getHoursState` into one (see W3-06).
  - Alternative: keep live reads but set per-resource `staleTime` of a few minutes and `refetchOnWindowFocus: false` client-side. This is cheaper, but the server stays unguarded.
- **Expected benefit:**
  - Google read quota scales with edits and the cron rather than with UI focus events.
  - GET latency is no longer bound by Google.
  - Fewer interactive requests hit `google_rate_limited` when the fleet budget is busy (W3-07).
- **Complexity:** M per resource
- **Regression risk:** Medium. The drift and "Load theirs" UX relies on fresh Google state, so keep an explicit refresh control.
- **Tests:**
  - A service test asserting no `googleRequest` within T of a prior observation.
  - Existing editor E2E for drift banners.
- **Measure:** `nabapresence.google.request.count` by `http.route`.
- **Dependencies:** W1 (query defaults), W4 (observation table growth).

### W3-03 Server-side `ZodError`s are reported as client 400s and never logged

- **Priority:** P1
- **Status:** CONFIRMED
- **Location:**
  - `lib/server/http.ts:122-160` (`mapError`): the `ZodError` branch at `:139-150` does not log, while unknown errors are logged at `:151`.
  - `lib/server/route.ts:385-399`: input parsing shares the same error type.
- **Current implementation / Evidence:**
  - Any `ZodError` thrown anywhere in a handler becomes `400 invalid_request` "The request did not pass validation.", with `details: error.issues`. It produces **no `log.error`**.
  - Many server-side parses of _provider_ or _stored_ data throw `ZodError`. Examples:
    - `lib/server/google/locations.ts:298` (`hoursCategoryResponseSchema.parse(response)`; the Google response);
    - `lib/server/bulk-listings.ts:402,494`;
    - `lib/server/location-activity.ts:82`;
    - `lib/server/google-administration-reviews.ts:59` and `lib/server/place-action-reviews.ts:33` (stored change-set payloads);
    - the `*-workflows.ts` response parses (`place-action-workflows.ts:38`, `service-workflows.ts:39`, `lodging-workflows.ts:37`).
  - The scripted grep found about 90 `Schema.parse(` call sites in `lib/server`.
  - A Google response-shape change or a contract drift therefore surfaces as a silent client "validation" error, with internal response paths echoed in `details`, invisible to 5xx alerting.
- **Root cause:** The wrapper and `mapError` cannot tell "input failed validation" from "server data failed an assertion".
- **Recommendation:**
  - In `route()`, catch the `params`/`query`/`body` parse failures and convert them to `ApiError(400, "invalid_request", …, { fieldErrors })` right there.
  - In `mapError`, treat any remaining `ZodError` as `500 internal_error` (or `502` when tagged as provider data), logging `api.contract_violation` with the issue paths but not the values.
  - Optionally provide a `parseProvider(schema, value)` helper that throws `ApiError(502, "google_invalid_response")`.
- **Expected benefit:** Contract and provider drift becomes observable and correctly classified. Clients no longer get misleading "fix your input" errors.
- **Complexity:** S
- **Regression risk:** Low–medium. Tests asserting 400 for handler-internal parses (e.g. body re-parsing in sync routes, `backfillStartSchema.parse(...)` at `sync/backfill/route.ts:104`) must convert explicitly.
- **Tests:** Wrapper test: handler throws `ZodError` → 500 and `log.error` called. Input schema failure → 400 with `fieldErrors`.
- **Dependencies:** W6 (the issues echoed in `details`).

### W3-04 Long synchronous provider work inside request handlers can exceed `maxDuration`

- **Priority:** P1
- **Status:** a) and b) CONFIRMED on code path; overrun PLAUSIBLE. c) CONFIRMED. d) PLAUSIBLE.
- **Location and evidence:**
  - **a) `POST /api/sync/backfill`** (`app/api/sync/backfill/route.ts:92-160`, `maxDuration = 60`).
    - Loops **serially** over every linked location (all of them when `externalLocationIds` is omitted; contract `lib/contracts/sync.ts:46-49` allows up to 50 ids and `maxPagesPerLocation` up to 20, default 10).
    - It calls `syncLinkedLocation` **without `deadline`** (`:130-136`). Compare `lib/server/reviews.ts:456` and `:780-784`, where only reconcile, sweep, performance and keywords pass one.
    - When the platform kills the function:
      - the `sync.backfill.completed/failed` audit (`:139-158`) is never written;
      - the client gets a gateway timeout;
      - the checkpoint stays `running` until its 15-minute lease (`reviews.ts:489,501`) is reclaimed.
    - Initial backfill is started three different ways:
      - inline, by this route;
      - via `after()` in the OAuth callback (`app/api/auth/callback/google/route.ts:238-262`; no `maxDuration` export);
      - by enqueuing a `pending` checkpoint for the job runner (`lib/server/google-onboarding-match-link.ts:123`, `google-onboarding-creation.ts:166`).
  - **b) `POST /api/reviews/bulk`, approve without the `bulk_actions` feature** (`app/api/reviews/bulk/route.ts:104-114`, `maxDuration = 120`).
    - Up to 100 approvals (`lib/contracts/reviews.ts:556-557`), each a serial Google reply publish through `completeApproval`/`executePublish` (`lib/server/review-approval.ts:231`).
    - Each is subject to per-connection pacing (`transport.ts:59-61`, 4× the interval), the fleet budget, and up to `GOOGLE_MUTATION_TIMEOUT_MS` (20s default, `env.ts:289`).
    - The queued engine path exists but is opt-in per organisation (`lib/server/bulk-reviews.ts:57`).
  - **c) Session sweep** (`app/api/sync/sweep/route.ts:167-215`). The 45s `SESSION_SWEEP_BUDGET_MS` is checked only _between pages_ inside a `do … while` (`reviews.ts:780-784`). After the deadline, each remaining location still runs a header transaction and one Google page.
  - **d) AI draft** (`lib/server/review-drafts.ts:347-411`, route `maxDuration = 60`).
    - Generation and semantic verification are two **sequential** OpenAI calls, each bounded by `OPENAI_TIMEOUT_MS` (default 30s, max 55s; `env.ts:241-246`), plus about 5 tenant transactions.
    - Worst case is over 60s.
    - The credit is settled right after generation (`:366-373`). A kill during verification leaves a settled charge with no stored draft, and the replay path's `settled && draftId` lookup (`:153-160`) then has nothing to return.
- **Root cause:** Budgets are per-call timeouts, not request deadlines. Request-scoped work is not deadline-aware end to end.
- **Recommendation:**
  - **a)** Make `POST /sync/backfill` enqueue: upsert `sync_checkpoint (status 'pending', next_attempt_at now())` for the selected locations, return 202 with `backfillProgress` (the GET already reports progress), and let `jobs/run` drain it. Use the same call in the OAuth callback instead of `after()`. If it must stay inline, pass `deadline: start + 45_000` and stop the location loop at the deadline.
  - **b)** Default `bulk_actions` on for approve, or cap the synchronous approve batch (e.g. 10) and route larger batches to the engine.
  - **c)** Check the deadline before starting a location (`if (Date.now() >= deadline) break` in the outer loop).
  - **d)** Pass a request deadline into `openAiStructured`, using `min(OPENAI_TIMEOUT_MS, deadline − now − margin)` for the verification call, and skip verification (status `unavailable`) when there is not enough time left.
- **Expected benefit:** No platform kills mid-work, truthful audits and receipts, and no charged generations without drafts.
- **Complexity:** a) M, b) S (flag) to M, c) S, d) S
- **Regression risk:** a) Medium (UI expects inline results; `components` would need to poll progress), others Low.
- **Tests:**
  - A backfill route test asserting no Google call in-request (enqueue only).
  - A sweep test with a past deadline and N locations asserting zero Google calls.
  - A draft test with fake timers asserting verification is skipped when the remaining time is under the threshold.
- **Dependencies:** jobs/ops workstream, W1 (backfill UI).

### W3-05 Every API request pays a multi-statement session transaction, including an unconditional write

- **Priority:** P2
- **Status:** CONFIRMED (cost unmeasured)
- **Location:** `lib/server/session.ts:128-239` (`lookupSession`), `:241-248` (`getSession` with `React.cache`, a no-op in route handlers per its own comment); `lib/server/route.ts:364`.
- **Current implementation / Evidence:**
  - Per API request, `requireSession()` runs one transaction:
    - `set_config` (token hash);
    - an identity `select`;
    - `set_config` (org);
    - the session `select` (with the `scopeFingerprintColumn` aggregate over `location_member`, `:109-126`);
    - **`update app_session set last_seen_at = now(), expires_at = …` on every call** (`:217-231`);
    - `getOrganisationBilling` (`:232`).
  - Then `ctx.tenant` opens a second transaction (`BEGIN`, `set_config` ×2, …).
  - Background polling GETs (counts, mutation receipts, notifications) therefore each write `app_session`.
- **Root cause:** The sliding expiry is implemented as a write on every touch.
- **Recommendation:**
  - Throttle the slide: `… where id = $1 and last_seen_at < now() - interval '5 minutes'`. The idle window is 14 days, so minute precision is irrelevant.
  - Fold the identity and session selects into one statement (the version check can be a column).
  - Consider merging the billing read into the same statement.
  - Add an OTel span around `lookupSession`; today only `withTenant` is instrumented (`db.ts:110-150`).
- **Expected benefit:** About one write and 2–3 fewer round trips per API request; less WAL and row churn on `app_session`.
- **Complexity:** S
- **Regression risk:** Low (expiry sliding precision only).
- **Tests:** The session test asserts `expires_at` still slides after the throttle interval and does not within it.
- **Dependencies:** W4.

### W3-06 Several requests open more tenant transactions than needed, and the token accessor costs one per call

- **Priority:** P2
- **Status:** CONFIRMED
- **Location:**
  - `lib/server/hours.ts:98,186,213,266`
  - `app/api/sync/backfill/route.ts:108,139`
  - `lib/server/google/connections.ts:525+` (`connectionAccessToken` calls `loadFromTenant`)
  - `app/api/google/locations/route.ts:86-93` (one token read per account)
- **Current implementation / Evidence:** After the Google call, `readLiveHours` → `getHoursState` runs three back-to-back `withTenant` transactions (`ensureCanonicalResource`, `recordHoursObservation`, the latest attempt read) with no external I/O between them. Every `connectionAccessToken` reads and decrypts the connection in its own transaction, so `google/locations` pays one per account even when several accounts share a connection.
- **Recommendation:**
  - Merge consecutive no-I/O phases into one `withTenant` while keeping the invariant "no transaction across Google".
  - Memoise `connectionAccessToken` per `(connectionId)` for the life of one request: a `Map` passed through, or keyed on the request via `AsyncLocalStorage`, since `React.cache` does not apply to route handlers.
- **Expected benefit:** 2–3 fewer transactions per hours GET and fewer token reads on discovery.
- **Complexity:** S–M
- **Regression risk:** Low
- **Tests:** Count `withTenant` invocations in a hours service test.
- **Dependencies:** W4.

### W3-07 Abuse-limit coverage stops at auth and AI drafts; Google budget has no tenant fairness

- **Priority:** P2
- **Status:** CONFIRMED (coverage). Starvation PLAUSIBLE.
- **Location:**
  - `lib/server/abuse-limits.ts:64-176` (scopes)
  - `limits:` used by only 8 routes (appendix A)
  - manual `takeAbuseBudget` only in `auth/mfa/*`, `support/impersonation`, `app/auth/confirm`
  - `lib/server/google/rate-budget.ts:73-107,139-175`
- **Current implementation / Evidence:**
  - Expensive session endpoints with **no** abuse limit:
    - `POST /api/drafts/[id]/verify` (an OpenAI call; only the monthly token backstop);
    - `POST /api/sync/backfill`;
    - the session paths of `POST /api/sync/{sweep,reconcile,performance,keywords}` (inline Google paging);
    - `GET /api/google/{accounts,locations}` (W3-01);
    - `POST /api/locations/[id]/import-review/refresh`;
    - `POST /api/listings/bulk/preview`;
    - `POST /api/privacy/export`;
    - `POST /api/reviews/bulk`.
  - The fleet Google budget is one bucket per API host (`budgetsFor`, `rate-budget.ts:84-107`) shared by every tenant and by background and interactive traffic alike.
  - One organisation repeatedly triggering manual sweeps or discovery can push other tenants' interactive reads and writes into `google_rate_limited` 429s (`rateDeferredError`, `:111-117`).
- **Recommendation:**
  - Add `sync_manual` (per org, e.g. 6/10 min) and `ai_verify` (per user/org) scopes and attach them via `limits:`.
  - Add a per-org advisory lock (try-lock; 409 `sync_in_progress`) for the manual sync routes.
  - In the rate budget, reserve part of each window for `mode === "mutation"` and interactive requests, or add per-org sub-buckets for background claims.
- **Expected benefit:** Bounded blast radius per tenant, and interactive work protected from background bursts.
- **Complexity:** S (scopes) / M (budget fairness)
- **Regression risk:** Low / Medium
- **Tests:** Route tests for 429 + `Retry-After` on the new scopes, and a budget unit test for the reserved share.
- **Dependencies:** W6.

### W3-08 Discovery and link write paths are duplicated with divergent conflict semantics; business logic lives in route files

- **Priority:** P2
- **Status:** CONFIRMED
- **Location and evidence:**
  - **`external_location` upsert.**
    - `app/api/google/locations/route.ts:127-257` keeps the existing working login: a `CASE … EXISTS` that leaves `google_connection_id` unchanged while the current login is healthy. Its comment says discovering through a second login must never silently re-route another client's venue.
    - `lib/server/automatic-google-setup.ts:110-141` **unconditionally** sets `google_connection_id = excluded.google_connection_id`.
    - The onboarding paths use `on conflict do nothing` (`google-onboarding-match-link.ts:109`, `google-onboarding-creation.ts:154`).
  - **`google_account` upsert** appears 3×, each with a different rule:
    - `app/api/google/accounts/route.ts:116-150` always moves the connection;
    - `automatic-google-setup.ts:~66-90` always moves it;
    - `google-lifecycle-reconciliation.ts:25-29` moves it only `where google_account.google_connection_id = excluded.google_connection_id`.
  - **`webhook_route` upsert.** `automatic-google-setup.ts:144-155` overwrites `organisation_id`/`external_location_id` on conflict, while onboarding uses `do nothing` (`google-onboarding-match-link.ts:119`, `-creation.ts:162`).
  - **Business logic in routes.** 39 route files hold 181 inline SQL statements. The largest are `analytics/presence/keywords` (21), `google/accounts` (16), `location-links` (13), `operations/health` (13), `clients/[clientId]` (11) and `privacy/requests` (10).
  - **`jsonColumn` convention violated.** `google/accounts/route.ts:134` and `google/locations/route.ts:~142-145` inline `sql.json(JSON.parse(JSON.stringify(x)))`, which `lib/server/db.ts:84-96` says never to do.
- **Root cause:** The discovery routes predate the onboarding and automatic-setup modules, and no shared "discovered resource" service was extracted.
- **Recommendation:**
  - Create `lib/server/google/discovery.ts` with `upsertDiscoveredAccounts(sql, connectionId, accounts)` and `upsertDiscoveredLocations(sql, …, { reassign: "if_current_unhealthy" | "never" })`, used by the route, automatic setup and onboarding, so one documented policy governs connection reassignment.
  - Do the same for `webhook_route` registration.
  - Move the remaining route-level SQL for the large handlers into `lib/server/*` modules, matching the pattern `listing-reads.ts` already follows.
- **Expected benefit:** A single rule for which login owns a listing (prevents silent re-routing via OAuth auto-setup), and testable services.
- **Complexity:** M
- **Regression risk:** Medium. Changing auto-setup to "keep healthy login" alters which connection syncs a relinked venue.
- **Tests:** Service tests for second-login discovery with a healthy first login, covering all three entry points.
- **Dependencies:** W6 (webhook_route ownership), W4.

### W3-09 Client cancellation never reaches the server's provider calls

- **Priority:** P2
- **Status:** CONFIRMED
- **Location:**
  - `grep -rn "request.signal"` over `app/` and `lib/` returns 0 hits.
  - `lib/server/google/transport.ts:378-388` spreads `...init`, then sets `signal: AbortSignal.timeout(remainingMs)`, overriding any caller signal.
- **Current implementation / Evidence:**
  - TanStack passes an abort signal (`requestOptions(ctx)` in `lib/queries/*`) that cancels the browser fetch on unmount or key change.
  - On the server, a GET that pages Google (W3-01, W3-02 posts, up to 100 pages) carries on to completion and writes its upserts after the user has navigated away.
- **Recommendation:**
  - Expose `ctx.signal = request.signal` from `route()`.
  - In `googleRequest`, combine signals for **safe mode only** (`AbortSignal.any([init.signal, AbortSignal.timeout(remainingMs)])`). Never abort a mutation mid-flight, because that only creates ambiguity.
  - Thread the signal through the paging loops (discovery, posts reconcile, backfill) and check `signal.aborted` between pages.
- **Expected benefit:** Wasted Google quota and DB writes are cut on abandoned reads.
- **Complexity:** S–M
- **Regression risk:** Low (safe mode only)
- **Tests:** A transport unit test where an aborted caller signal rejects before fetch, and a mutation ignores it.
- **Dependencies:** none

### W3-10 Session-or-cron hybrid auth and manual body parsing are re-implemented in four routes

- **Priority:** P3
- **Status:** CONFIRMED
- **Location:** `app/api/sync/sweep/route.ts:38-62`, `sync/reconcile/route.ts:49-…`, `sync/keywords/route.ts:27-…`, `sync/performance/route.ts:30-…`. Manual `request.json().catch(() => ({}))` also appears in `sync/backfill/route.ts:103-105`, `locations/[id]/media`, `support/impersonation`, `webhooks/google/pubsub*`.
- **Current implementation / Evidence:**
  - These routes are declared `auth: "public"` and call `getSession()`/`isCronRequest()`/`requireRole()` themselves.
  - They parse the body manually so that the kill switch runs before validation.
  - `request.json()` ignores `Content-Type`, so the wrapper's 415 guard (`route.ts:325-334`) is bypassed for these routes. The same-origin check still applies.
- **Recommendation:** Add `auth: "session_or_cron"` (with `roles` applying to the session branch) and a `preflight(ctx)` hook that runs before body parsing (for kill switches) to `route()`. Then delete the four `authenticate` copies.
- **Expected benefit:** One auth path, a consistent 415 rule, and less drift risk.
- **Complexity:** S
- **Regression risk:** Low (keep the 401→403→503→400 order covered by tests)
- **Tests:** Existing sync route tests, plus a 415 case.
- **Dependencies:** none

### W3-11 Malformed JSON bodies are silently treated as `{}`

- **Priority:** P3
- **Status:** CONFIRMED (mechanism); impact PLAUSIBLE (needs an all-optional schema)
- **Location:** `lib/server/route.ts:325-340` (`readJsonBody`: a `JSON.parse` failure returns `{}`).
- **Evidence:** A request with `Content-Type: application/json` and a truncated body passes validation for any schema whose fields are all optional or defaulted. The handler then runs as a no-op or default action and answers 200.
- **Recommendation:** Return `400 invalid_json` when the media type is JSON, the body is non-empty and `JSON.parse` fails. Keep `{}` only for an empty body.
- **Complexity:** S
- **Regression risk:** Low
- **Tests:** A wrapper test for a truncated JSON body.
- **Dependencies:** none

### W3-12 Time budgets and a provider redirect are read from raw `process.env`, outside the validated env

- **Priority:** P3
- **Status:** CONFIRMED
- **Location:**
  - **Budgets read raw:**
    - `app/api/sync/reconcile/route.ts:69` (`RECONCILE_BUDGET_MS`), `sync/presence-resources` (`PRESENCE_RESOURCE_BUDGET_MS`), `sync/performance` (`PERFORMANCE_BUDGET_MS`), `sync/keywords` (`KEYWORDS_BUDGET_MS`);
    - `operations/health` (`OPERATIONS_HEALTH_BUDGET_MS`), `billing/reconcile` (`BILLING_RECONCILE_BUDGET_MS`);
    - `lib/server/retention/purge.ts` (`RETENTION_BUDGET_MS`, `RETENTION_BATCH_ROWS`).
  - **Provider redirect read raw:** `lib/server/google/transport.ts:100` (`GOOGLE_API_PROXY_BASE`).
- **Evidence:**
  - Nothing stops a budget being set at or above the route's `maxDuration = 60`, which would cause a platform kill mid-run.
  - `GOOGLE_API_PROXY_BASE` (a test hook, set in `playwright.config.ts:51`) has no production guard. If set, it redirects every Google call, including bearer tokens.
- **Recommendation:**
  - Move the budgets into `lib/server/env.ts` with `.max(55_000)`.
  - Reject `GOOGLE_API_PROXY_BASE` and `STRIPE_API_PROXY_BASE` when `NODE_ENV === "production"` and `VERCEL_ENV === "production"`, in `startup.ts`.
- **Complexity:** S
- **Regression risk:** Low
- **Tests:** An env schema test.
- **Dependencies:** W6

### W3-13 `maxDuration` is declared inconsistently on provider-reaching routes

- **Priority:** P3
- **Status:** CONFIRMED (inventory). The reachability list is over-approximate.
- **Location:** appendix A. 102 of 159 route files have no `maxDuration`. No route exports `dynamic`. 150 export `runtime = "nodejs"` and 9 do not.
- **Evidence:**
  - The import-graph scan finds 92 routes reaching Google, AI or Stripe transitively; 42 of them have no `maxDuration`.
  - Confirmed real provider work among those:
    - `google/accounts` and `google/locations` (W3-01);
    - `locations/[id]/posts` GET (W3-02);
    - `locations/[id]/place-actions` GET;
    - `locations/[id]/media/[mediaId]` PATCH/DELETE;
    - `locations/[id]/posts/[postId]` PATCH/DELETE;
    - `auth/callback/google` (an `after()` backfill of up to 10 pages);
    - `webhooks/google/risc`.
  - These routes silently inherit the platform default, while sibling routes declare 60.
- **Recommendation:** Declare `maxDuration` on every provider-reaching route, and add a test (alongside `tests/route-entitlements.test.ts`) asserting that any route whose handler module imports `lib/server/google*`, `ai`, or `billing/stripe` exports one.
- **Complexity:** S
- **Regression risk:** Low
- **Dependencies:** W7

### W3-14 Upstream status codes pass through as this API's own status; OpenAI 429 has no Retry-After

- **Priority:** P3
- **Status:** CONFIRMED
- **Location:** `lib/server/google/transport.ts:470-476` (`throw new ApiError(response.status, String(code), String(reason))`); `:478-482` (`google_retry_exhausted` is effectively unreachable for status-driven retries, because the last attempt falls through to the line above); `lib/server/ai.ts:122-127`.
- **Evidence:**
  - After retries, a Google `500`/`503` is answered as _our_ `500`/`503` with code `INTERNAL`/`UNAVAILABLE` and Google's message. A 4xx keeps Google's status.
  - The client copes: `lib/errors/action-errors.ts:510-514,735` maps SCREAMING_CASE codes, and `ACCESS_LOST_CODES` (`lib/api/client.ts:202-215`) ignores them.
  - The problem is in server dashboards and 5xx SLOs: provider faults look like app faults.
  - OpenAI 429 is mapped to 429 with no `details.retryAfter`, so `retryAfterHeaders` (`http.ts:80-89`) sends no `Retry-After`.
- **Recommendation:**
  - Map upstream 5xx to `502 google_unavailable` (retryable), keeping the raw status in `details.providerStatus`.
  - Forward OpenAI's `retry-after`.
- **Complexity:** S
- **Regression risk:** Low (check client code that keys on 5xx)
- **Dependencies:** W1

### W3-15 Minor

- **Priority:** P3
- **Status:** CONFIRMED
- **`checkAbuseBudget` round trips.** It makes one sequential DB call per key kind, up to 4 (`lib/server/abuse-limits.ts:345-362`). These could be one call taking arrays.
- **Unbounded pacer map.** `nextGoogleConnectionRequestAt` (`transport.ts:29`) is a `Map` that is never pruned. It is bounded by the number of connections per warm instance, so this is negligible.
- **Fresh connection per refresh-lock attempt.** `refreshUnderLock` (`lib/server/google/connections.ts:432-475`) opens a new dedicated Postgres client for each lock attempt in its polling loop. It only runs on token refresh, so the impact is low.
- **N+1 inside one transaction.** `lib/server/publication-schedules.ts:803-812` runs `Promise.all` over up to 50 rows, each doing `loadRow` and `project` on one transaction connection. postgres.js serialises these, so it is N+1, not parallelism (W4 lead).
- **Doc drift.** `docs/architecture.md:150-152` says "77 of 78 route files" go through `route()`; the inventory shows 159 of 159.

---

## Top 5 for this workstream

1. **W3-01 (P1).** Google account and location discovery GETs re-page Google and upsert every row on each focus refetch. Split read from refresh, batch the upserts, and fix the hook defaults.
2. **W3-02 (P1).** The hours, posts, profile and place-actions GETs reconcile with Google live on every read. Extend media's staleness gate to them.
3. **W3-03 (P1).** Server-side `ZodError`s are reported as client 400s and never logged. Separate input validation from contract and provider assertions.
4. **W3-04 (P1).** Request-scoped provider work is not deadline-aware: backfill has no deadline, non-engine bulk approve runs 100 serial publishes, the sweep deadline is checked only between pages, and the two-call AI path can exceed 60s. Enqueue backfill, and budget everything to a request deadline.
5. **W3-07 / W3-05 (P2).** Expensive manual sync and AI-verify endpoints have no abuse limits, and the Google budget has no per-tenant fairness. Separately, every API request writes `app_session` and spends about 8 round trips on auth.

## Cross-layer leads for other workstreams

- **W1/W2:**
  - `lib/queries/use-google-accounts.ts:18-21` and `use-google-locations.ts:10-14` inherit `staleTime 30s / refetchOnWindowFocus / retry 1` (`lib/queries/query-client.ts:7-9`), and each refetch triggers full Google discovery.
  - The editor queries for hours, posts and profile trigger live Google reads on focus.
- **W4:**
  - `app/api/google/locations/route.ts:162-237` repeats the same `EXISTS(google_connection … connection_task)` subquery four times in `CASE` arms. Compute it once (CTE or `ON CONFLICT … WHERE`).
  - Row-at-a-time upsert loops: `google/accounts/route.ts:112-151` and `lib/server/posts.ts:528-545`.
  - N+1 in `publication-schedules.ts:803-812`.
  - An observation insert on every hours GET (`hours.ts:213`) adds table growth.
- **W6:**
  - `lib/server/automatic-google-setup.ts:144-155` upserts `webhook_route` with `organisation_id = excluded.organisation_id` on conflict. Cross-org takeover is prevented only by the RLS policy `webhook_route_update_own` (`supabase/migrations/0005_tenant_hardening.sql:117`); verify that it blocks the update.
  - `GOOGLE_API_PROXY_BASE` (`lib/server/google/transport.ts:100`) has no production guard.
  - `ZodError` issues are echoed to clients in `details` (`lib/server/http.ts:145`).
- **W6/W3 boundary:** `automatic-google-setup.ts:133-141` reassigns a listing's `google_connection_id` unconditionally. This can silently re-route another client's venue, contrary to the rule in `google/locations/route.ts:155-160`.
- **Jobs/ops:**
  - There are three initial-backfill mechanisms: inline route (`sync/backfill/route.ts:127`), `after()` in the OAuth callback (`auth/callback/google/route.ts:238`), and a pending checkpoint in onboarding (`google-onboarding-match-link.ts:123`).
  - The sweep's `do…while` ignores the deadline for the first page (`lib/server/reviews.ts:780-784`).
- **W7:**
  - No test enforces `maxDuration` on provider-reaching routes (W3-13).
  - No wrapper test asserts that a handler-internal `ZodError` is logged (W3-03).
- **Observability:** the `google.api.request` span (`transport.ts:351-360`) lacks an `http.route`/caller attribute, and `lookupSession` (`session.ts:128`) has no span. Both are needed to measure W3-01, W3-02 and W3-05.

---

## Appendix A: route inventory (scripted, `node /tmp/w3audit/inv.mjs`)

**How to read it:**

- `auth`: the wrapper's `auth` option. `public/cron` means a hybrid that authenticates manually inside the handler.
- `roles`: `roles:` is declared on at least one handler.
- `limits`: the wrapper `limits:` hook only. MFA and support routes call `takeAbuseBudget` manually.
- `maxDur`: the exported `maxDuration`.
- `inline SQL stmts`: count of `` sql` `` / `sql<` in the route file (excluding `` getDatabase()` ``).

Every row is built by `route()`. No route exports `dynamic`.

| route (app/api/…)                                                          | methods               | auth        | roles | limits | maxDur | inline SQL stmts |
| -------------------------------------------------------------------------- | --------------------- | ----------- | ----- | ------ | ------ | ---------------- |
| ai/credits/daily                                                           | GET                   | session     |       |        |        |                  |
| ai/credits                                                                 | GET                   | session     |       |        |        |                  |
| analytics/overview                                                         | GET                   | session     |       |        |        |                  |
| analytics/presence/keywords                                                | GET                   | session     |       |        |        | 21               |
| analytics/presence                                                         | GET                   | session     |       |        |        |                  |
| assets/[id]/finalise                                                       | POST                  | session     | y     |        | 60     |                  |
| assets                                                                     | GET,POST              | session     | y     | y      |        |                  |
| audit-log                                                                  | GET                   | session     | y     |        |        | 9                |
| auth/callback/google                                                       | GET,POST              | public      |       |        |        |                  |
| auth/mfa/enroll                                                            | POST                  | session     |       |        |        | 1                |
| auth/mfa/factors                                                           | GET                   | public      |       |        |        |                  |
| auth/mfa/step-up                                                           | POST                  | session     |       |        |        | 4                |
| auth/mfa/verify                                                            | POST,DELETE           | public      |       |        |        | 3                |
| auth/password/login                                                        | POST                  | public      |       | y      |        |                  |
| auth/password/register                                                     | POST                  | public      |       | y      |        |                  |
| auth/password/resend                                                       | POST                  | public      |       | y      |        |                  |
| auth/password/reset/complete                                               | POST                  | public      |       | y      |        |                  |
| auth/password/reset/request                                                | POST                  | public      |       | y      |        |                  |
| billing/cancel                                                             | POST                  | session     | y     |        |        |                  |
| billing/checkout                                                           | POST                  | session     | y     |        | 60     |                  |
| billing/plan-change                                                        | POST                  | session     | y     |        | 60     |                  |
| billing/portal                                                             | POST                  | session     | y     |        |        |                  |
| billing/reconcile                                                          | GET                   | cron        |       |        | 60     |                  |
| billing                                                                    | GET                   | session     |       |        |        |                  |
| clients/[clientId]/connections                                             | POST                  | session     | y     |        |        | 1                |
| clients/[clientId]/locations                                               | POST,DELETE           | session     | y     |        |        | 3                |
| clients/[clientId]/report-shares/[shareId]                                 | DELETE                | session     | y     |        |        | 2                |
| clients/[clientId]/report-shares                                           | GET,POST              | session     | y     |        |        | 3                |
| clients/[clientId]                                                         | GET,PATCH             | session     | y     |        |        | 11               |
| clients/[clientId]/setup                                                   | GET                   | session     | y     |        |        |                  |
| clients                                                                    | GET,POST              | session     | y     |        |        | 2                |
| cron/health                                                                | POST,GET              | cron        |       |        | 60     |                  |
| cron/retention                                                             | POST,GET              | cron        |       |        | 60     |                  |
| drafts/[id]/verify                                                         | POST                  | session     | y     |        | 60     | 1                |
| google/accounts/[accountId]/categories                                     | GET                   | session     | y     |        |        |                  |
| google/accounts/[accountId]/drafts/[draftId]/accessible-matches            | GET                   | session     | y     |        |        |                  |
| google/accounts/[accountId]/drafts/[draftId]/chains                        | GET                   | session     | y     |        |        |                  |
| google/accounts/[accountId]/drafts/[draftId]/creation/link                 | POST                  | session     | y     |        | 60     |                  |
| google/accounts/[accountId]/drafts/[draftId]/creation                      | POST,GET              | session     | y     |        | 60     |                  |
| google/accounts/[accountId]/drafts/[draftId]/match-link-reviews/[reviewId] | GET,POST              | session     | y     |        |        |                  |
| google/accounts/[accountId]/drafts/[draftId]/match-link-reviews            | POST                  | session     | y     |        |        |                  |
| google/accounts/[accountId]/drafts/[draftId]/match-link                    | GET,POST              | session     | y     |        |        |                  |
| google/accounts/[accountId]/drafts/[draftId]/matches                       | POST                  | session     | y     |        | 60     |                  |
| google/accounts/[accountId]/drafts/[draftId]/reviews/[reviewId]            | GET,POST              | session     | y     |        |        |                  |
| google/accounts/[accountId]/drafts/[draftId]/reviews                       | POST                  | session     | y     |        | 60     |                  |
| google/accounts/[accountId]/drafts/[draftId]                               | GET,PUT               | session     | y     |        |        |                  |
| google/accounts/[accountId]/drafts/[draftId]/services                      | GET                   | session     | y     |        |        |                  |
| google/accounts/[accountId]/drafts                                         | GET,POST              | session     | y     |        |        |                  |
| google/accounts/[accountId]/matches                                        | POST                  | session     | y     |        | 60     |                  |
| google/accounts                                                            | GET,PATCH             | session     | y     |        |        | 16               |
| google/connect/start                                                       | POST                  | session     | y     |        |        | 1                |
| google/connections/[id]/disconnect                                         | POST                  | session     | y     |        | 60     | 4                |
| google/connections                                                         | GET                   | session     |       |        |        |                  |
| google/locations                                                           | GET                   | session     | y     |        |        | 4                |
| google/notifications                                                       | GET,PATCH             | session     | y     |        | 60     | 1                |
| import-review/counts                                                       | GET                   | session     |       |        |        |                  |
| invitations/[token]/resend                                                 | POST                  | session     | y     |        |        | 1                |
| invitations/[token]                                                        | GET,POST,DELETE       | public      | y     | y      |        | 2                |
| invitations                                                                | GET,POST              | session     | y     |        |        | 7                |
| jobs/run                                                                   | POST,GET              | cron        |       |        | 60     |                  |
| legal-holds                                                                | GET,POST,DELETE       | session     | y     |        |        | 4                |
| listings/bulk/[id]/approve                                                 | POST                  | session     | y     |        |        |                  |
| listings/bulk/[id]/cancel                                                  | POST                  | session     | y     |        |        |                  |
| listings/bulk/[id]/execute                                                 | POST                  | session     | y     |        |        |                  |
| listings/bulk/[id]/retry                                                   | POST                  | session     | y     |        |        |                  |
| listings/bulk/[id]                                                         | GET                   | session     |       |        |        |                  |
| listings/bulk/preview                                                      | POST                  | session     |       |        | 60     |                  |
| listings/bulk                                                              | GET                   | session     |       |        |        |                  |
| listings/summary                                                           | GET                   | session     |       |        |        |                  |
| location-links                                                             | GET,POST,DELETE       | session     | y     |        |        | 13               |
| locations/[id]/activity                                                    | GET                   | session     |       |        |        |                  |
| locations/[id]/administration-access-reviews/[reviewId]/execute            | GET,POST,PATCH        | session     | y     |        | 60     |                  |
| locations/[id]/administration-access-reviews/[reviewId]                    | GET,POST              | session     | y     |        | 60     |                  |
| locations/[id]/administration-access-reviews                               | GET,POST              | session     | y     |        | 60     |                  |
| locations/[id]/administration-access-workflows                             | GET                   | session     | y     |        |        |                  |
| locations/[id]/administration-lifecycle-reviews/[reviewId]/execute         | GET,POST,PATCH        | session     | y     |        | 60     |                  |
| locations/[id]/administration-lifecycle-reviews/[reviewId]                 | GET,POST              | session     | y     |        | 60     |                  |
| locations/[id]/administration-lifecycle-reviews                            | GET,POST              | session     | y     |        | 60     |                  |
| locations/[id]/administration                                              | GET,POST,PATCH        | session     | y     |        | 60     |                  |
| locations/[id]/business-information                                        | GET,PATCH,PUT,POST    | session     | y     |        | 60     |                  |
| locations/[id]/capabilities                                                | GET                   | session     |       |        |        |                  |
| locations/[id]/change-requests/[changeId]                                  | POST                  | session     |       |        | 60     |                  |
| locations/[id]/change-requests                                             | GET                   | session     |       |        |        |                  |
| locations/[id]/food-menus                                                  | GET,PUT,POST          | session     | y     |        | 60     |                  |
| locations/[id]/hours                                                       | GET,PUT,POST          | session     | y     |        | 60     |                  |
| locations/[id]/import-review/[proposalId]/decision                         | POST                  | session     | y     |        |        |                  |
| locations/[id]/import-review/refresh                                       | POST                  | session     | y     |        | 60     |                  |
| locations/[id]/import-review                                               | GET                   | session     |       |        |        |                  |
| locations/[id]/industry                                                    | POST,PUT,GET,PATCH    | session     | y     |        | 60     |                  |
| locations/[id]/legacy-post-schedules/[legacyId]                            | PATCH                 | session     | y     |        |        |                  |
| locations/[id]/legacy-post-schedules                                       | GET                   | session     | y     |        |        |                  |
| locations/[id]/media/[mediaId]                                             | PATCH,DELETE          | session     |       |        |        |                  |
| locations/[id]/media/resolutions/[attemptId]                               | POST                  | session     |       |        |        |                  |
| locations/[id]/media                                                       | GET,POST              | session     |       |        | 60     |                  |
| locations/[id]/place-action-reviews/[reviewId]/execute                     | GET,POST,PATCH        | session     | y     |        | 60     |                  |
| locations/[id]/place-action-reviews/[reviewId]                             | GET,POST              | session     | y     |        | 60     |                  |
| locations/[id]/place-action-reviews                                        | GET,POST              | session     | y     |        | 60     |                  |
| locations/[id]/place-actions/[linkId]                                      | PATCH,DELETE          | session     |       |        |        |                  |
| locations/[id]/place-actions                                               | GET,POST              | session     |       |        |        |                  |
| locations/[id]/post-schedules/[scheduleId]/approve                         | POST                  | session     | y     |        |        |                  |
| locations/[id]/post-schedules/[scheduleId]                                 | PUT,PATCH             | session     | y     |        |        |                  |
| locations/[id]/post-schedules                                              | GET,POST              | session     |       |        |        |                  |
| locations/[id]/posts/[postId]/approval                                     | POST                  | session     |       |        |        |                  |
| locations/[id]/posts/[postId]/publish                                      | POST                  | session     |       |        | 60     |                  |
| locations/[id]/posts/[postId]                                              | PATCH,DELETE          | session     |       |        |        |                  |
| locations/[id]/posts                                                       | GET,POST              | session     |       |        |        |                  |
| locations/[id]/profile                                                     | GET,PUT,POST          | session     | y     |        | 60     |                  |
| locations/[id]/summary                                                     | GET                   | session     |       |        |        |                  |
| locations/[id]/verification-completion-reviews/[reviewId]/execute          | GET,POST,PATCH        | session     | y     |        | 60     |                  |
| locations/[id]/verification-completion-reviews/[reviewId]                  | GET,POST              | session     | y     |        | 60     |                  |
| locations/[id]/verification-completion-reviews                             | POST                  | session     | y     |        | 60     |                  |
| locations/[id]/verification-options                                        | GET,POST              | session     | y     |        | 60     |                  |
| locations/[id]/verification-reviews/[reviewId]/execute                     | GET,POST,PATCH        | session     | y     |        | 60     |                  |
| locations/[id]/verification-reviews/[reviewId]                             | GET,POST              | session     | y     |        | 60     |                  |
| locations/[id]/verification-reviews                                        | POST                  | session     | y     |        | 60     |                  |
| locations/[id]/verification-state                                          | GET                   | session     | y     |        | 60     |                  |
| locations/[id]/verification-workflows                                      | GET                   | session     | y     |        |        |                  |
| members/[userId]/client-access                                             | GET,PUT               | session     | y     |        |        | 5                |
| members                                                                    | GET,POST,PATCH,DELETE | session     | y     |        |        | 6                |
| mutations/[operationId]                                                    | GET                   | session     |       |        |        |                  |
| notifications/[incidentId]/resolve                                         | POST                  | session     | y     |        |        |                  |
| notifications/preferences                                                  | GET,PUT               | session     |       |        |        |                  |
| notifications/read                                                         | POST                  | session     |       |        |        |                  |
| notifications                                                              | GET                   | session     |       |        |        |                  |
| operations/health                                                          | GET                   | public      |       |        |        | 11               |
| operations/notification-deliveries/retry                                   | POST                  | session     | y     |        |        |                  |
| operations/organisations/[id]/ai-credits                                   | GET,POST,PUT          | cron        |       |        |        | 1                |
| operations/readiness                                                       | GET                   | cron        |       |        |        |                  |
| operations/reencrypt                                                       | POST                  | cron        |       |        | 60     |                  |
| organisations                                                              | GET,PATCH             | session     | y     |        |        | 3                |
| post-schedules/occurrences                                                 | GET                   | session     |       |        |        |                  |
| privacy/export                                                             | POST                  | session     | y     |        |        | 6                |
| privacy/requests                                                           | GET,POST,PATCH        | session     | y     |        | 60     | 10               |
| privacy/retention-status                                                   | GET                   | session     | y     |        |        | 1                |
| reviews/[id]/approval                                                      | POST                  | session     |       |        | 60     |                  |
| reviews/[id]/drafts                                                        | POST                  | session     | y     | y      | 60     |                  |
| reviews/[id]/publish                                                       | POST                  | session     |       |        | 60     |                  |
| reviews/[id]/reply                                                         | DELETE                | session     |       |        | 60     |                  |
| reviews/[id]                                                               | GET                   | session     |       |        |        |                  |
| reviews/bulk                                                               | POST                  | session     | y     |        | 120    | 4                |
| reviews/counts                                                             | GET                   | session     |       |        |        |                  |
| reviews                                                                    | GET                   | session     |       |        |        |                  |
| session                                                                    | GET,DELETE            | public      |       |        |        |                  |
| session/switch                                                             | POST                  | session     |       |        |        | 3                |
| settings/capabilities                                                      | GET                   | session     |       |        |        |                  |
| settings                                                                   | GET,PATCH             | session     | y     |        |        | 3                |
| support/impersonation                                                      | POST,DELETE           | public      |       |        |        | 1                |
| sync/backfill                                                              | GET,POST,DELETE       | session     | y     |        | 60     | 5                |
| sync/keywords                                                              | POST,GET              | public/cron |       |        | 60     |                  |
| sync/performance                                                           | POST,GET              | public/cron |       |        | 60     |                  |
| sync/presence-resources                                                    | POST,GET              | cron        |       |        | 60     | 3                |
| sync/reconcile                                                             | POST,GET              | public/cron |       |        | 60     |                  |
| sync/sweep                                                                 | POST,GET              | public/cron |       |        | 60     |                  |
| webhooks/email                                                             | POST                  | public      |       |        |        |                  |
| webhooks/google/pubsub/failures                                            | GET                   | session     | y     |        |        | 1                |
| webhooks/google/pubsub/replay                                              | POST                  | session     | y     |        |        | 1                |
| webhooks/google/pubsub                                                     | POST                  | public      |       |        | 60     | 3                |
| webhooks/google/risc                                                       | POST                  | public      |       |        |        |                  |
| webhooks/stripe                                                            | POST                  | public      |       |        |        |                  |

**Validation scan** (`val2.mjs`, per handler):

- Every dynamic-segment handler declares a `params` schema.
- Manual body parsing:
  - `sync/{backfill,keywords,performance,reconcile,sweep}`, deliberately so the kill switch comes first (W3-10);
  - `locations/[id]/media` POST (multipart upload);
  - `support/impersonation`;
  - `webhooks/google/pubsub` and `/replay`.
- Manual `searchParams` parsing appears in `auth/password/{register,resend,reset/request}` (redirect target) and `locations/[id]/place-action-reviews` GET (`placeActionWorkflowsQuerySchema.parse(Object.fromEntries(...))` inside the handler instead of `query:`).
