# W0 — Architecture discovery, repository mapping, dependencies

**Workstream:** W0 (architecture, module map, critical-flow traces, dependency hygiene, module-level coupling/duplication)
**Date:** 2026-10-14 · **Tree evaluated:** HEAD `d8759c74` + uncommitted working tree on `feat/inbox-mail-refinement` (read-only; nothing modified)

## Scope covered

1. Architecture overview from code: directory responsibilities, runtime topology (Next server, `scripts/scheduler.mjs`, `vercel.json` crons, `instrumentation.ts`, `proxy.ts`), auth/session model, data flow. Module map with file counts and LOC.
2. Four critical flows traced hop by hop: (a) inbox list → detail → draft/AI → publish reply; (b) profile field edit → GBP write → confirmation; (c) post create/schedule → publication runner; (d) Google sync cron → reviews ingest.
3. Dependency hygiene: importer counts per runtime dependency, peer-dependency check, client/server boundary and `server-only` discipline.
4. Coupling and duplication: the reviewed-write families (`google-administration-*`, `google-lifecycle-*`, `google-verification-*`, `place-action-*`, `lodging-*`, `service-*`), `lib/server` size hotspots, runtime import cycles.

## Commands run (all read-only)

- `wc -l`, `find … | xargs wc -l | sort -rn` for the module map and size hotspots
- `rg`/`grep` for route wrappers (`grep -L "route({"` over all 159 `route.ts`), `server-only` coverage, `"use client"` files importing `@/lib/server`, `stripe|postgres|jose|node:*` in client files, importer count per `package.json` dependency, repeated SQL predicates
- `node -e` over `node_modules/*/package.json` for peer dependencies and `@types/node` version
- A throwaway Tarjan-SCC cycle detector at `/tmp/w0audit/cycles.mjs` (outside the repo) over `app/`, `components/`, `lib/` resolving `@/` and relative imports, skipping `import type` / all-`type` specifiers
- `diff` of name-normalised sibling modules (`sed 's/Administration/X/;s/Lifecycle/X/'`, `lodging`↔`service`)
- `pnpm exec prettier --check` (check mode only, writes nothing)
- Reading: `AGENTS.md`, `docs/architecture.md` (selected sections), `docs/frontend-backend-feature-map.md` (head), `vercel.json`, `instrumentation.ts`, `proxy.ts`, `next.config.ts`, `scripts/scheduler.mjs`, `lib/server/{db,session,jobs,reviews,profile,gbp-management,gbp-change-sets,google-account-change-lock,…}.ts`, `lib/server/publishing/publish.ts`, the route handlers and hooks on each traced flow

## Not covered, and why

- **No runtime measurement.** No dev server, DB or Google calls were run (read-only brief). Every latency or contention claim below is a code-path count, not a timing; the instrumentation that would measure it is named in each finding.
- **Client bundle size.** `pnpm build` was not run (it writes `.next/`). Bundle analysis is left to the perf workstream.
- **Migrations / RLS policies** (131 SQL files), **security review of auth routes**, **test quality** and **hook-level state bugs** are owned by other workstreams; only leads are listed.
- `docs/architecture.md` is 2,659 lines; I read the sections relevant to topology, request skeleton, write pipeline, reply pipeline, sync/workers, contracts and the frontend pattern, not all of it.
- The uncommitted inbox files were read only to locate hook call sites; their in-progress design was not evaluated.

---

## 1. Architecture overview

### 1.1 Module map (TS/TSX/MJS/SQL/CSS files, LOC including comments)

| Area                                                |           Files |     LOC | Responsibility                                                                                                                                                                                                                   |
| --------------------------------------------------- | --------------: | ------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/` total                                        |             250 |  21,412 | App Router: pages, layouts, route handlers                                                                                                                                                                                       |
| `app/api/`                                          | 159 route files |  12,174 | JSON API. **All 159 handlers are built with `route({...})`** (`lib/server/route.ts:368`). Largest groups: `locations` 47, `google` 21, `auth` 10, `reviews` 8, `listings` 8, `clients` 7, `webhooks` 6, `sync` 6, `billing` 6    |
| `app/(dashboard)/`                                  |              53 |   2,646 | Thin RSC pages: session check in layout, optional `prefetch()` + `HydrationBoundary`, then one client view component                                                                                                             |
| `components/`                                       |             413 |  95,254 | Client UI. Biggest: `locations` 114 files/24.5k, `ui` 68/16.7k, `settings` 40/10.5k, `inbox` 30/8.7k, `app-shell` 37/7.3k                                                                                                        |
| `lib/server/`                                       |             219 |  61,149 | All server logic: tenancy (`db.ts`), sessions, `route()` wrapper, Google transport (`google/`), write pipeline (`gbp-write.ts`), reply pipeline (`publishing/`), job runner (`jobs.ts`), sync, retention, billing, notifications |
| `lib/contracts/`                                    |              76 |   8,608 | zod request/response schemas, client-safe (enforced by `tests/contracts-client-safe.test.ts`)                                                                                                                                    |
| `lib/domain/`                                       |              61 |   9,870 | Pure domain rules shared by server and client (hashing modules split into `*-vocabulary.ts`)                                                                                                                                     |
| `lib/api/`                                          |              70 |   3,408 | Browser fetch wrappers: `apiFetch` (`lib/api/client.ts:302`) + contract schema per endpoint                                                                                                                                      |
| `lib/queries/`                                      |              57 |   2,417 | TanStack Query hooks, `queryKeys` factory, `useResourceMutation`, `useInvalidateReviewWrites`                                                                                                                                    |
| `lib/{inbox,locations,editors,settings,listings,…}` |            ~120 |    ~14k | Client-side evaluators/URL state/editor state                                                                                                                                                                                    |
| `scripts/`                                          |              29 |   7,635 | Ops: migrate, runtime role, release promote/verify, scheduler, readiness probe                                                                                                                                                   |
| `supabase/migrations/`                              |             131 |  13,286 | Schema + RLS + SECURITY DEFINER functions (latest `0131_bulk_review_claim_receipts.sql`)                                                                                                                                         |
| `tests/`                                            |             745 | 181,461 | Vitest unit/component/integration + Playwright e2e/visual                                                                                                                                                                        |

Largest `lib/server` files: `posts.ts` 2,274 · `media.ts` 1,732 · `gbp-write.ts` 1,526 · `retention/purge.ts` 1,442 · `publication-schedules.ts` 1,346 · `retention/inventory.ts` 1,171 · `jobs.ts` 1,165 · `import-review.ts` 1,140 · `google/connections.ts` 1,115 · `hours.ts` 1,065. Largest components: `bulk/bulk-compose.tsx` 1,884 · `locations/menu-editor.tsx` 1,323 · `locations/hours-editor.tsx` 1,290 · `setup/onboarding-drafts.tsx` 1,275 · `inbox/review-detail.tsx` 1,139 · `inbox/inbox-view.tsx` 1,102.

### 1.2 Runtime topology

- **Next server** (`output: "standalone"`, `next.config.ts`; build on webpack, dev on Turbopack). Region `iad1` (`vercel.json:3`).
- **`instrumentation.ts:6-48`**: Node runtime registers `@vercel/otel`; adds an OTLP metric reader only when a collector is configured (`telemetryDisabledReason()`), then `await assertProductionSafety()` (DB identity, RLS posture, schema manifest) before traffic. `onRequestError` logs redacted JSON (`:51-75`).
- **`proxy.ts:15-30`**: pages only; copies path+search into a request header so the dashboard layout can build `?next=` and the inbox page can choose what to prefetch (`app/(dashboard)/inbox/page.tsx:16-41`). No auth.
- **Background work, two drivers:**
  - **Vercel Cron** (`vercel.json:5-42`, **9 entries**): `GET /api/jobs/run` every minute; `GET /api/sync/{reconcile,presence-resources,performance,sweep,keywords}`; `GET /api/cron/{retention,health}`; `GET /api/billing/reconcile`. All `auth: "cron"` (bearer `CRON_SECRET`).
  - **`scripts/scheduler.mjs`** (self-hosted/local): `setInterval` loops (`:465-500`) that mostly **POST** the same paths, with its own cursor walking (`paginate`, `:166-195`). See W0-02: GET and POST do different things.
- **Job runner** (`lib/server/jobs.ts`, invoked by `/api/jobs/run` under advisory lock `naba:jobs`, budget 45s, `app/api/jobs/run/route.ts:10-14`): schedule sweep → billing slice → claim loop over webhook/checkpoint/publish-retry/recover/reconcile/performance/keywords kinds → bulk listing children → scheduled posts → privacy withdrawals → invitation emails (`jobs.ts:1040-1165`).
- **Database**: `postgres` client, global pool (`db.ts:33-47`, `prepare: false`, statement timeout 30s, idle-in-txn 60s) via the transaction pooler; `withSessionConnection` (`db.ts:62-77`) opens a dedicated single connection on `DATABASE_SESSION_URL` for advisory locks.
- **External**: Google Business Profile APIs (`lib/server/google/*`, `transport.ts`, `rate-budget.ts`), OpenAI for drafts/verification (`lib/server/ai.ts:215`, `:320`), Stripe (`lib/server/billing/*`), Supabase Auth + Storage, Pub/Sub and RISC webhooks (`app/api/webhooks/google/{pubsub,risc}`).

### 1.3 Auth / session model

Supabase Auth verifies identity only; the app issues an opaque HTTP-only `naba_session` cookie (`lib/server/session.ts:25`), stores `sha256(token)` (`session-store.ts:73`) and resolves it per request in one tenant transaction joining `app_session`/`app_user`/`organisation`/`member` plus billing (`session.ts:195-239`). `getSession` is `React.cache`d (`:245`) so an RSC render looks up once; in route handlers it runs per request. `route()` applies, in order: request id → same-origin guard → auth (`session` | `cron` | `public`) → `roles` → zod params/query/body → abuse limits → `ctx.tenant(fn)` = `withTenant(session.organisationId, fn)` → `apiError` mapping (`docs/architecture.md:148-200`, confirmed by `grep -L` that no handler bypasses it). `withTenant` (`db.ts:106-140`) sets `app.organisation_id` and `app.billing_enforcement` with `set_config(..., true)` inside a transaction; RLS default-denies other tenants. Location-level access is checked inside services (`requireLocationAccess`), not by the wrapper.

### 1.4 Data flow (generic)

`page.tsx` (RSC: `getSession`, optional `prefetch()` of DB-only readers) → `HydrationBoundary` → client view → `lib/queries/use-*` (TanStack Query, keys from `lib/queries/keys.ts`) → `lib/api/*` (`apiFetch` + contract schema parse) → `app/api/**/route.ts` (`route()`) → `lib/server/*` service → `withTenant` SQL and/or `lib/server/google/*` → response `satisfies <Contract>` → client parse → `invalidateQueries` on success (`useResourceMutation`, `useInvalidateReviewWrites`) → refetch → render. Google writes go through `runGbpWrite` (`gbp-write.ts:908`: durable intent → validateOnly → mutate outside the data transaction → readback → settle → audit); replies through `lib/server/publishing/*`; reviewed account-level writes through `gbp_change_set` + `gbp_management_mutation` (`gbp-change-sets.ts`).

### 1.5 Things that are already good (briefly)

- **Zero runtime import cycles** across 1,277 files / 5,704 value edges (734 type-only imports skipped). The cycle detector and its limits are described under "Commands run".
- **`server-only` discipline:** 215/219 `lib/server` files import it; the 4 without it are a type module (`publishing/types.ts`), static data (`schema-manifest.ts`), plain-text email copy (`notifications/messages.ts`) and `telemetry-status.ts` (imported from `instrumentation.ts`). No `"use client"` file (426 of them) imports a value from `@/lib/server`, `stripe`, `postgres`, `jose` or `node:*`.
- **One request skeleton:** all 159 route files use `route()`. Contracts are single-sourced and client-safe by test.

---

## 2. Critical flows

Notation: ⚠ = redundant work / extra round trip / inconsistent state / tight coupling.

### (a) Inbox: list → open → draft/AI → publish to Google

1. **Page:** `app/(dashboard)/inbox/page.tsx:30-41`: `getSession` + `resolvePrimaryLocation` + `requestSearch` (proxy header), then `prefetch(session, inboxPrefetch(search))` hydrates the first list page, counts and an open review (`lib/server/prefetch.ts:204`, `:215`, `:385`).
2. **List:** `components/inbox/inbox-view.tsx:147` `useReviews(filters)` → `lib/queries/use-reviews.ts:10-27` (`useInfiniteQuery`, `keepPreviousData`, `refetchInterval: settlingInterval(...)`) → `lib/api/reviews.ts:32-38` `GET /api/reviews?…` → `app/api/reviews/route.ts:11-27` (contract `decodeReviewsQuery`) → `tenant((sql) => readReviewsPage(sql, session, query))` (`lib/server/review-reads.ts:39`). Counts: `inbox-view.tsx:151` `useReviewCounts` → `/api/reviews/counts`.
3. **Open:** `components/inbox/review-detail.tsx:1008`, `reply-composer.tsx:90` and `action-bar.tsx:75` each call `useReviewDetail(reviewId)` (one cache entry, deduped) → `lib/queries/use-review-detail.ts:10-20` → `GET /api/reviews/[id]` → `readReviewDetail` (`review-reads.ts:90`).
4. **Draft/AI:** `reply-composer.tsx:53` `useGenerateOrSaveDraft` (`lib/queries/use-draft-mutations.ts:17`) → `lib/api/drafts.ts:14-19` `POST /api/reviews/[id]/drafts` (roles owner/admin/member, abuse limit) → `createReviewDraft` (`lib/server/review-drafts.ts:238`): tenant txn 1 (load, access, reserve credit, reserve verify usage) → `generateReply` (OpenAI, `lib/server/ai.ts:215`) **outside** txn → `settleDraftCredit` txn → `runSemanticVerification` (second OpenAI call, `ai.ts:320`) → `finishVerifyUsage` txn → final tenant txn writes the draft. ⚠ Two sequential LLM calls plus 4–5 transactions in one request. That is by design (credit ledger correctness), but it is the slowest user-facing request. Lead for perf (measure with the existing `database.tenant_transaction` span plus a span around each `fetch` in `ai.ts:92`).
5. **Publish:** `components/inbox/action-bar.tsx:76` `usePublishReview` (`lib/queries/use-publish-review.ts:9-17`) → `lib/api/publish.ts:7-8` `POST /api/reviews/[id]/publish` (`mfa: "step_up"`) → `app/api/reviews/[id]/publish/route.ts:18-71` → `executePublish` (`lib/server/publishing/publish.ts:148-176`): pause gate → `preparePublish` (intent txn, `intent.ts:390`) → optional `recoverForRequest` (`recover.ts:294`) then **recursive** `executePublish(input)` (`publish.ts:166`) → `publishReplyToGoogle` (`provider.ts:114`), synchronous, outside any txn → settle txn → 200/202/409/429/502.
6. **Cache update:** `onSuccess: useInvalidateReviewWrites` (`lib/queries/invalidate.ts:13-22`) invalidates `reviewDetail(id)`, **all** `reviewsAll` lists and `reviewCountsAll`. ⚠ With an infinite list, TanStack refetches every loaded page sequentially. While any row is `publish_requested`, list and detail both poll every 5s (`lib/inbox/settling.ts`, `SETTLING_POLL_MS = 5_000`), and the list poll also refetches all loaded pages (W0-07). ⚠ The `settling.ts` header says "the route returns 200 with a pending outcome, the publish worker sends it to Google", but the route sends inline (`publish.ts:170`); only retries and recovery are asynchronous.

### (b) Profile field edit → GBP write → confirmation

1. **Load:** `components/locations/profile/profile-editor.tsx` uses `useProfileEditor` (`lib/queries/use-location-profile-editor.ts:29-60`) = `useProfile` + `useBusinessInformation` (gated on profile success). `useProfile` (`lib/queries/use-location-profile.ts:9-24`) → `GET /api/locations/[id]/profile` (`app/api/locations/[id]/profile/route.ts:28-34`) → `getProfileState` → `readProfileStateBundle` (`lib/server/profile.ts:253-310`). ⚠ **This GET writes** and costs a live Google read plus about 6 separate transactions (W0-04). ⚠ The `queryFn`'s `finally` invalidates `listingSummary(id)`, `listingSummaries` and `clientsAll` after **every** profile fetch, including focus refetches.
2. **Save + publish** (`profile-editor.tsx:418-475`, driven by `usePublishFlow`, `lib/editors/use-publish-flow.ts:148`):
   - Step "save": `saveProfile` → `PUT …/profile` (`route.ts:36-55`) → `saveCanonicalProfile` (txn), **then a separate txn** `invalidatePendingListingChanges` (`lib/server/listing-changes.ts:494-511`). ⚠ This is not atomic: if the second call fails, the save is committed and an older pending approval survives. The payload-hash checks in the approval path probably still catch a stale approval (PLAUSIBLE, not traced; lead for mutations).
   - Then `fetchProfile(locationId)` **directly**, not through the query cache (`profile-editor.tsx:440`). ⚠ That is a second live Google read plus the GET's writes, and the cache is not updated from it.
   - Step "profile": `runProfileOperation` → `POST …/profile` (`mfa: "step_up"`) → `submitListingChange("profile_publish")` (`lib/server/listing-change-registry.ts:215`, `:82-98`), which parks the change for a second approver in two-person mode → `publishProfileToGoogle` (`profile.ts:640-647`): **opens a dedicated session-pooler connection and a transaction holding `pg_advisory_xact_lock(org:location:business_info)`**, then `prepareProfilePublish` does **another** `readLiveProfile` (`profile.ts:605`) → `runGbpWrite` (`gbp-write.ts:908`) → validateOnly PATCH → PATCH (`patchGoogleLocationProfile`, `lib/server/google/management.ts:101`) → readback `fetchGoogleProfile(..., {maxAttempts: 3})` → settle → audit. The lock transaction stays open for all of it (W0-03).
3. **Cache update:** `usePublishFlow` invalidates `locationProfile` and `locationBusinessInformation` (`profile-editor.tsx:531-536`) → refetch profile (a third live Google read plus writes, and it re-triggers the summaries/clients invalidation) and business information (fans out across several Google APIs, per the comment in `use-location-profile-editor.ts:47-51`).
   ⚠ **Count for one "save and publish":** at least 4 Google profile reads plus validate, PATCH and readback, and at least 15 tenant transactions. Most of these are reads that the save/publish response could return.

### (c) Post create/schedule → publication runner

1. **Draft:** `components/locations/posts/post-composer-sheet.tsx:434-450` `useResourceMutation({ mutationFn: createPost | updatePost, invalidate: [locationPosts] })` → `lib/api/location-posts.ts:44` `POST /api/locations/[id]/posts` → `createLocalPostDraft` (`lib/server/posts.ts:872`). Local only ("Google is not affected").
2. **Schedule/approve:** `components/locations/posts/schedule-post-sheet.tsx` → `lib/api/publication-schedules.ts` → `app/api/locations/[id]/post-schedules/route.ts:11` → `createPublicationSchedule` (`lib/server/publication-schedules.ts:713`); approval via `…/[scheduleId]/approve` → `approvePublicationSchedule` (`:816`). The calendar (`components/calendar/publication-calendar.tsx`) reads `/api/post-schedules/occurrences`.
3. **Runner:** Vercel cron `GET /api/jobs/run` every minute → `runDueJobs` (`jobs.ts`): `sweepScheduledOccurrences` first (`:1046`, marks closed windows missed even when paused) → … main claim loop (`:1108-1121`) → bulk children (`:1128-1133`) → `runDueSchedules({ budgetMs: deadline - now })` (`:1134-1139`) → `publication-schedule-runner.ts:918-960` claims via SQL `claim_due_publication_schedules` → `processSchedule` (`:380`) → `selectDueOccurrences` (`lib/domain/publication-schedule.ts:501-515`, runs only while `now < deadlineAt`) → `publishScheduledLocalPost` (`posts.ts:1578`, called at `runner.ts:601`) → `publishLocalPost` → `runGbpWrite` (`posts.ts:1680`).
   ⚠ **Coupling/ordering:** time-windowed post publication runs last and only on leftover budget, after an unbounded drain of sync work (W0-01).
4. **Cache:** no push. The posts tab and calendar pick up the result on their next refetch.

### (d) Google sync cron → reviews ingest

1. **Vercel:** `GET /api/sync/reconcile?maxOrganisations=100` every 15 min → `app/api/sync/reconcile/route.ts:299-305` → `enqueueRecurring("reconcile")` (`lib/server/recurring-sync.ts:51-63`, SECURITY DEFINER `ensure_recurring_checkpoints`). That only arms checkpoints.
2. **Drain:** `/api/jobs/run` → `claimBatch` (`jobs.ts:309`) over `organisation_job_route` with per-organisation caps → `runPool` (`:262`) → `runJob` (`:827`) → `case "reconcile"` (`:904-907`) / `"checkpoint"` (`:880-888`) / `"webhook"` (Pub/Sub, `:837-845`) → `syncLinkedLocation` (`lib/server/reviews.ts:448`).
3. **Ingest:** per page, `googleReviews(...)` (`lib/server/google/reviews.ts:9`, called at `reviews.ts:675`) outside any txn → **one** tenant txn per page (`reviews.ts:696-769`): per-review `upsertGoogleReview` (`:155`) in a sequential loop, a `last_seen_at` bulk update, provider totals on the first page, then the checkpoint `page_token`/high-water advance in the same txn. This is correct: the token advances only with committed rows. ⚠ Each review is its own `INSERT … ON CONFLICT` round trip (a page holds up to about 50), so a batch upsert via `unnest` would cut round trips. Lead for perf/DB.
4. **Pub/Sub path:** `app/api/webhooks/google/pubsub/route.ts` (`verifyPubSubRequest`, `lib/server/pubsub.ts:21`) records an event → job runner `webhook` kind → same `syncLinkedLocation`.
5. **Self-hosted:** `scripts/scheduler.mjs:217-240` **POSTs** `/api/sync/reconcile` with an organisation cursor → `route.ts:281-290` → `runReconcilePage`, which **walks organisations and syncs inline** in the request. ⚠ This is a different execution model from (1)/(2) (W0-02).
6. **Client:** the inbox learns about new reviews only through TanStack staleness, focus refetch or the manual "Sync reviews" button (`components/inbox/sync-reviews-button.tsx`). There is no server push.

---

## 3. Findings

### W0-01 Scheduled posts run last on leftover budget in the shared jobs tick and can starve behind sync backlog

- **Priority:** P1
- **Status:** PLAUSIBLE. The ordering and budget arithmetic are confirmed in code; whether starvation happens in production depends on backlog size, which was not measured.
- **Location:** `lib/server/jobs.ts:1108-1139` (`runDueJobs`); `app/api/jobs/run/route.ts:10-14` (budget 45s); `lib/server/publication-schedule-runner.ts:936-947` (`runDueSchedules` loop guard); `lib/server/env.ts:288` (`GOOGLE_TIMEOUT_MS` default 15s); `lib/domain/publication-schedule.ts:501-515` (`selectDueOccurrences`).
- **Current implementation / evidence:** The tick's main loop is `while (Date.now() + GOOGLE_TIMEOUT_MS <= deadline) { claimBatch(...); if empty break; runPool(...) }`. It keeps claiming checkpoint, reconcile, performance, keywords, webhook and retry work until the queue is empty or the budget is nearly gone. Only afterwards do bulk children and then `runDueSchedules` get `deadline - Date.now()`. `runDueSchedules` does nothing unless at least 15s (one Google timeout) remain. A scheduled occurrence only publishes while `now < deadlineAt` (5-minute window per `jobs.ts:1042-1045`). `sweepScheduledOccurrences` (`jobs.ts:1046`) records anything past the window as **missed**. The daily fleet sweep (`/api/sync/sweep` arms a checkpoint for every linked location) and the 15-minute reconcile enqueue both feed the main loop.
- **Root cause:** One minute-tick serves throughput work (sync) and deadline work (scheduled posts) with first-come budget allocation. Billing already gets a reserved slice (`jobs.ts:1073-1087`); scheduled posts do not.
- **Recommendation:** Run `runDueSchedules` **before** the main claim loop with a capped slice (as billing does), or reserve a minimum slice (e.g. `min(15s + GOOGLE_TIMEOUT_MS, budget/3)`). Alternatives: (1) a separate cron entry (`/api/jobs/schedules`, every minute) under its own lease; (2) have `claimBatch` stop when a due schedule exists. Instrument first: add `nabapresence.post_occurrence.lateness_ms` (finished_at − intended_at) and a counter of missed occurrences by reason, and log `summary.schedules` alongside the main loop's batch count per tick.
- **Expected benefit:** Scheduled posts no longer silently become "missed" during sync backlogs.
- **Complexity:** S · **Regression risk:** Low–Med (tick ordering; bulk children have similar latency expectations) · **Tests:** a unit test on `runDueJobs` with a fake claim queue that never drains, asserting `runDueSchedules` still runs; an integration test with a due occurrence plus N due checkpoints · **Dependencies:** none.

### W0-02 Two different recurring-sync execution models: Vercel enqueues, the self-hosted scheduler walks inline

- **Priority:** P1 (reliability/architecture)
- **Status:** CONFIRMED
- **Location:** `app/api/sync/reconcile/route.ts:281-305`; `app/api/sync/performance/route.ts:48-75`; `app/api/sync/keywords/route.ts:45-72`; `app/api/sync/sweep/route.ts:51-76`; `scripts/scheduler.mjs:217-240`, `:343`, `:367`, `:392`; `docs/architecture.md:1105-1106`.
- **Current implementation / evidence:** The `GET` handlers (Vercel Cron) call `enqueueRecurring(kind)` / `enqueueFleetSweep`, so the job runner drains fairly with leases and per-organisation caps (migration 0048). The `POST` handlers are `auth: "public"` with a hand-rolled `authenticate()` that accepts either a session or the cron bearer (`reconcile/route.ts:42-52`). For the cron bearer they **walk organisations inline** (`runReconcilePage`, `runPerformancePage`, `runKeywordsPage`), with the cursor kept in the scheduler process (`scheduler.mjs:117-195`). `scheduler.mjs` POSTs reconcile, performance, keywords and presence-resources; only sweep converges (`POST` without a session → `enqueueFleetSweep`). The docs say the scheduler "POSTs the same eight", which hides the fork. Also, `vercel.json` has 9 crons, not 8.
- **Root cause:** The queue migration (0048) changed only the Vercel entry points. The legacy cursor walkers were kept for the scheduler and the session "refresh my org" path.
- **Recommendation:** Point `scheduler.mjs` at the enqueue path (GET with the bearer, as Vercel does) for reconcile, performance and keywords. Remove the cron branch of the POST walkers so POST is session-only (`auth: "session"`, `roles: ["owner","admin"]`), which also retires the four hand-rolled `auth: "public"` + `authenticate()` handlers. That deletes the scheduler's cursor machinery (`paginate`, `walks`, `CURSOR_STALL_LIMIT`). Alternative: keep POST but call `enqueueRecurring` when no session is present, as `sweep` already does.
- **Expected benefit:** One execution model to test and reason about. Self-hosted deployments get the same fairness and heartbeat semantics, and four route files lose their custom auth path.
- **Complexity:** M · **Regression risk:** Med (self-hosted ops; heartbeat names) · **Tests:** a scheduler integration test asserting enqueue; route tests asserting cron POST → 401 (or enqueue) · **Dependencies:** W-security (auth paths), W-ops.

### W0-03 Google writes run inside an open session-pooler transaction holding an advisory lock

- **Priority:** P1 (prod reliability under concurrency)
- **Status:** PLAUSIBLE. The pattern is confirmed; contention under load was not measured.
- **Location:** `lib/server/profile.ts:640-647`; `lib/server/hours.ts:741`; `lib/server/food-menus.ts:462`; `lib/server/business-information.ts:204`, `:511`; `lib/server/industry-management.ts:120`; `lib/server/google-account-change-lock.ts:7-13` (`withGoogleAccountChangeLock`, used by administration/lifecycle/verification/place-action execution); `lib/server/db.ts:62-77`.
- **Current implementation / evidence:** `withSessionConnection((c) => c.begin(async (lock) => { await lock\`select pg_advisory_xact_lock(...)\`; return publishXLocked(input) }))`. Everything in `publishXLocked`runs while that transaction is open on a **new, dedicated** connection: a live Google read, the validateOnly PATCH, the PATCH, readback with up to 3 attempts, and several pooled`withTenant`transactions. Route`maxDuration`is 60s. The dedicated client is created with`{ max: 1, connect_timeout: 10, prepare: false }`and **no**`statement_timeout`/`idle_in_transaction_session_timeout`, unlike the pooled client (`db.ts:38-43`). The data transactions are outside, as `docs/architecture.md` promises, but a lock transaction spans the provider call. The code comment explains why session locks cannot use the transaction pooler (`db.ts:49-61`).
- **Root cause:** Per-resource serialisation is implemented as a transaction-scoped advisory lock, which forces an open transaction for the whole provider round trip.
- **Recommendation:** Keep the serialisation but bound it. At minimum, pass `connection: { idle_in_transaction_session_timeout, statement_timeout }` matching the route budget to the dedicated client, so a killed function cannot leave the session-pooler slot idle-in-transaction. Better: replace the xact lock with a short-lived lease row (the `leases.ts` pattern, with expiry), or rely on the durable intent row's unique key (`runGbpWrite` already refuses an in-flight row with 409). Measure session-pooler client count and `pg_stat_activity` `state = 'idle in transaction'` duration during bulk publishing (bulk-listing-runner also uses `withSessionConnection`).
- **Expected benefit:** No pooler-slot exhaustion when many writes or bulk children run in parallel, no per-write connection setup, bounded lock lifetime.
- **Complexity:** S (timeouts) / M (lease) · **Regression risk:** Med (concurrency semantics) · **Tests:** an integration test of two concurrent publishes (one must 409 or serialise); a test that the dedicated client sets timeouts · **Dependencies:** W-DB.

### W0-04 Profile GET writes, costs a live Google read plus about 6 transactions, and its hook invalidates three other query families on every fetch

- **Priority:** P2
- **Status:** CONFIRMED (code path); cost not measured
- **Location:** `lib/server/profile.ts:253-310` (`readProfileStateBundle`), `:186-216` (`readLiveProfile`: context txn, error txn, resource txn), `:100` (`loadStoredStates`), `:137-186` (`persistObservedFields`: one txn with a per-field sequential `INSERT … ON CONFLICT` loop), `:274-281` (`recordResourceObservation` txn), `:282-300` (latest attempt txn); `lib/queries/use-location-profile.ts:13-22`; `components/locations/profile/profile-editor.tsx:440` (direct `fetchProfile` after save); `:605` (publish re-reads live).
- **Current implementation / evidence:** See flow (b). Each profile GET makes 1 Google call and about 6 `withTenant` transactions (one with N upserts), and writes observation state. `useProfile`'s `queryFn` invalidates `listingSummary(id)`, `listingSummaries` and `clientsAll` in a `finally` on **every** fetch, so a focus refetch on the profile tab also refetches the listings board and client hub queries if they are mounted. A save-and-publish triggers at least 4 live profile reads.
- **Root cause:** The read doubles as the observation sync (it persists drift state). The cross-surface freshness link is implemented as a side effect in `queryFn`.
- **Recommendation:** (1) Merge the four post-Google transactions into one and batch the field upserts (`insert … select from unnest(...)`). (2) Have the server return `observationChanged: boolean` (or compare a hash) and invalidate summaries only when it is true, in `onSuccess` of an explicit refresh rather than in `queryFn`. (3) Have `PUT …/profile` return the fresh `ProfileState` so the editor does not call `fetchProfile`. Also, `prepareProfilePublish` could accept the `expectedGoogleHash`-validated state rather than re-read; that is a deliberate safety re-read, so keep it.
- **Expected benefit:** Fewer Google quota hits per edit (the connection is rate-budgeted), less DB chatter, and no surprise refetches of unrelated lists.
- **Complexity:** M · **Regression risk:** Med (drift detection correctness) · **Tests:** a hook test that a profile refetch does not invalidate `clientsAll` unless the observation changed; a server test that a GET with an unchanged observation writes nothing · **Dependencies:** W-hooks, W-perf.

### W0-05 Every authenticated request writes `app_session` (including 5-second polls)

- **Priority:** P2
- **Status:** CONFIRMED
- **Location:** `lib/server/session.ts:217-229` (unconditional `update app_session set last_seen_at = now(), expires_at = …`), `:241-256`; `lib/inbox/settling.ts` (`SETTLING_POLL_MS = 5_000`); `lib/queries/use-reviews.ts:19-25`, `use-review-detail.ts:17-19`.
- **Evidence:** `React.cache` dedupes only within an RSC render. In route handlers each request runs the lookup **and** the update. While a reply settles, the inbox polls detail and every loaded list page every 5s, and each of those requests is a write to the same `app_session` row.
- **Recommendation:** Throttle the slide: `… where id = $1 and last_seen_at < now() - interval '60 seconds'`, or fold it into the select as a conditional CTE. Measure with `pg_stat_user_tables.n_tup_upd` on `app_session` or a counter in `lookupSession`.
- **Expected benefit:** Removes one write per API request and avoids row-lock contention on a hot row.
- **Complexity:** S · **Regression risk:** Low (idle expiry granularity becomes 60s) · **Tests:** a session test that two lookups within 60s update once · **Dependencies:** W-DB, W-security (idle-expiry semantics).

### W0-06 Reviewed-write families: a shared core exists, but guards are copy-pasted and two module pairs are ~90% identical

- **Priority:** P2
- **Status:** CONFIRMED
- **Location / quantification:** 33 files, 2,494 LOC: `google-administration-*` (6 files, 373 LOC), `google-lifecycle-*` (6, 378), `google-verification-*` (8, 669), `place-action-*` (5, 311), `lodging-*` (2, 63), `service-*` (3, 96), plus the shared `gbp-change-sets.ts` (185), `gbp-confirmation.ts` (89), `listing-change-registry.ts` (276), `mutation-recovery-registry.ts` (54).
  - **The shared abstraction already exists:** `saveGbpChangeSet` / `listGbpChangeSets` / `checkedRow` / `approvedGbpChange` (`gbp-change-sets.ts`), `gbpManagementAttemptStore` and `auditGbpMutation` (`gbp-management.ts`), `withGoogleAccountChangeLock` / `requireNoUnresolvedAccountChange` (`google-account-change-lock.ts:7-31`). Every family imports these.
  - **Residual duplication:**
    1. `requireNoUnresolvedAccountChange` exists (`google-account-change-lock.ts:24-31`) but its predicate is **inlined verbatim** in `google-lifecycle-execution.ts:37-44` and `google-administration-execution.ts:52-59` (three copies of `status in ('started','validated','ambiguous') or confirmation_state in ('pending','unresolved') or local_reconciliation_state in ('pending','conflict')`). `gbp-management.ts:212` has a fourth variant **without** `local_reconciliation_state`. It may be intentional (location-scoped rather than account-scoped), but nothing documents the difference (HYPOTHESIS: drift).
    2. The "same Google binding" check (`connectionId`/`googleAccountId`/`googleLocationName`/`credentialGeneration`) is hand-written **8 times** (`google-administration-reviews.ts:39`, `google-administration-execution.ts:48`, `:62`, `google-verification-state.ts:69`, `google-verification-reviews.ts:31`, `place-action-reviews.ts:17`, `google-lifecycle-reviews.ts:22`, `google-lifecycle-execution.ts:22`), with slightly different field sets (verification omits some fields).
    3. `lodging-attempt.ts` vs `service-attempt.ts`, and `lodging-workflows.ts` vs `service-workflows.ts`: the name-normalised diff is ~6–10 lines each. They differ in a `requireRole` call and an `update_mask` filter. **Role gating sits in different layers**: `service-*` calls `requireRole` in the function because `GET /business-information` has no `roles` (`app/api/locations/[id]/business-information/route.ts:38-44`), while `/industry` declares `roles` on the route (`industry/route.ts:45-46`). The outcome is equivalent today, but this contradicts the "roles declared on the route" convention (`docs/architecture.md:148-200`).
  - **Genuinely different per family:** the name-normalised diff of administration vs lifecycle `*-attempts.ts` is 152 lines over ~89-line files; the provider operations, baselines and confirmation logic differ in substance.
- **Recommendation:** Do **not** build a generic reviewed-write phase machine (it would be a second `runGbpWrite` with a large surface for little gain). Instead: (1) call `requireNoUnresolvedAccountChange` from the two execution modules; (2) add `assertSameGoogleBinding(before, after, fields?)` in `gbp-management.ts`; (3) collapse lodging/service into `readChangeSetAttempt({ resourceType, updateMask?, schema, notFound })` and `listChangeSetWorkflows(...)`, and move role gating onto the business-information GET route; (4) optionally group the families under `lib/server/reviewed-writes/<family>/` for navigability (88 flat siblings starting with `google-`/`place-action-` today).
- **Expected benefit:** Guard changes land in one place. About 150 LOC removed. No drift between the three unresolved predicates.
- **Complexity:** S · **Regression risk:** Low (pure refactor, covered by existing route tests) · **Tests:** existing integration tests for administration/lifecycle/place-action concurrency; add one asserting a lifecycle write is blocked by an unresolved place action through the shared helper · **Dependencies:** W-mutations.

### W0-07 Review-write invalidation and settling polls refetch every loaded inbox page

- **Priority:** P2
- **Status:** PLAUSIBLE. TanStack v5 infinite-query refetch semantics apply (all loaded pages refetch sequentially); traffic was not measured.
- **Location:** `lib/queries/invalidate.ts:13-22`; `lib/queries/use-reviews.ts:11-26` (no `maxPages`); `lib/inbox/settling.ts`.
- **Evidence:** Each draft, verify, approve, publish or delete invalidates `queryKeys.reviewsAll`, so every active list query refetches all N loaded pages, and also refetches counts and detail. While any row is `publish_requested`, the list's `refetchInterval` repeats that every 5s, as does the detail query. With W0-05, each request is also a session write.
- **Recommendation:** Poll only the detail (or a small `GET /api/reviews/status?ids=` endpoint) and patch the list row with `setQueryData` when it changes. Set `maxPages` on the infinite query, or invalidate the list with `refetchType: "none"` and let it refetch on view. Lead for the hooks workstream.
- **Complexity:** M · **Regression risk:** Med (list consistency) · **Tests:** hook test counting fetches after a publish with 3 pages loaded.

### W0-08 Seven unused runtime dependencies; `@types/node` lags the engine

- **Priority:** P3
- **Status:** CONFIRMED (zero importers in `app components lib scripts tests` plus config files, checked for `from`, `import()`, `require` and CSS `@import`)
- **Location:** `package.json` dependencies.
- **Evidence:** `date-fns`, `embla-carousel-react`, `geist`, `input-otp`, `react-day-picker`, `react-resizable-panels` and `recharts` have no importers. Fonts are self-hosted via `next/font/local` (`app/layout.tsx:2-33`), `components/ui/chart.tsx` is hand-rolled, and OTP uses `@base-ui/react/otp-field` (`components/ui/otp-field.tsx:3`). They are leftovers from the shadcn/design-system replacement. `@opentelemetry/api-logs`, `instrumentation` and `sdk-logs` also have 0 importers, but they are **peer dependencies of `@vercel/otel` 2.1.3**, so keep them. Its other peers `@opentelemetry/resources` and `sdk-trace-base` are not declared and are satisfied by pnpm's auto-installed peers. `@types/node` is `^20` (resolved 20.19.43) while `engines.node` is `>=24 <25`.
- **Recommendation:** Remove the 7 packages and declare the two missing OTel peers explicitly. Bump `@types/node` to `^24`. This changes `pnpm-lock.yaml`, so it needs explicit user approval per the workspace rules. There is no client-bundle effect (unimported packages are not bundled); the benefit is install time, audit surface and clarity.
- **Complexity:** S · **Regression risk:** Low · **Tests:** `pnpm typecheck && pnpm build`.

### W0-09 About 390 source files fail `prettier --check`; reviewed-write modules use very long one-line statements

- **Priority:** P3
- **Status:** CONFIRMED
- **Evidence:** `pnpm exec prettier --check` reports unformatted files in `lib/server` (87), `app/api` (75), `lib/contracts` (44), `lib/api` (41), `components/locations` (33), `lib/domain` (27), `lib/queries` (20) and more. The reviewed-write families contain 368 lines over 160 characters (e.g. `google-administration-attempts.ts:36`, `:59-63`, `place-action-*`). `package.json` has `format` but neither `lint` nor `verify` checks formatting.
- **Recommendation:** One dedicated formatting PR (after the in-flight inbox branch lands, to avoid conflicts), then add `prettier --check` to `verify`. Readability of the dense guard code matters for W0-06.
- **Complexity:** S · **Regression risk:** Low (mechanical; large diff) · **Tests:** none beyond `verify`.

### W0-10 Documentation drift on topology and conventions

- **Priority:** P3
- **Status:** CONFIRMED
- **Evidence:** `docs/architecture.md:151` says "77 of 78 route files; the last, `app/api/auth/callback/google/route.ts`, re-exports another handler". There are now 159, all on `route()`, including that file. `docs/architecture.md:1105-1106` and `README.md:70,121` say "eight ticks" and that the scheduler "POSTs the same eight"; `vercel.json` has 9, and POST ≠ GET (W0-02). `AGENTS.md:17` and `README.md:188` reference Next 16.2.6; `package.json` pins `next` 16.3.8. The frontend-pattern section (`docs/architecture.md`, "Server prefetch … never used on a page whose state lives in the URL") is contradicted by `app/(dashboard)/inbox/page.tsx:16-41`, which now prefetches the first page from the proxy header. The `lib/inbox/settling.ts` header describes the publish as worker-sent, while `executePublish` sends inline.
- **Recommendation:** Correct these five statements. Have W0-02's fix update the scheduler paragraph.
- **Complexity:** S · **Regression risk:** none.

### W0-11 `executePublish` re-enters itself after recovery with no depth bound

- **Priority:** P3 (lead; owned by mutations)
- **Status:** HYPOTHESIS
- **Location:** `lib/server/publishing/publish.ts:148-167`
- **Evidence:** `needs_recovery` → `recoverForRequest` → if not `ambiguous`, `return executePublish(input)`. If recovery settles a row that `preparePublish` still classifies as needing recovery (a race with the retry runner claiming the same attempt), the request recurses until `maxDuration`. I did not trace `preparePublish`'s classification fully.
- **Recommendation:** Pass a `depth` and fail with 409 `publish_in_progress` after one re-entry. Verify in the mutations workstream.
- **Complexity:** S · **Regression risk:** Low.

---

## Top 5 for this workstream

1. **W0-01**: Scheduled posts get only leftover budget after the sync drain and can be marked missed. Reserve a slice or run them first. (P1, S)
2. **W0-02**: The Vercel GET (enqueue) and scheduler POST (inline walk) sync models diverge. Converge on enqueue and make POST session-only. (P1, M)
3. **W0-03**: Google writes hold a session-pooler transaction plus advisory lock for the whole provider round trip with no idle/statement timeout. Bound it or move to a lease row. (P1, S/M)
4. **W0-04**: Profile GET is a write path costing a live Google read plus about 6 transactions, and its hook invalidates unrelated lists on every fetch. A save-and-publish does at least 4 live reads. (P2, M)
5. **W0-05 / W0-07**: One session write per request plus all-page refetch on every review write and 5s poll. Throttle `last_seen_at` and narrow the inbox polling. (P2, S/M)

## Cross-layer leads for other workstreams

- **Mutations:** `executePublish` unbounded self-recursion after recovery (`lib/server/publishing/publish.ts:166`).
- **Mutations:** profile save and pending-approval invalidation are two transactions (`app/api/locations/[id]/profile/route.ts:41-54` → `lib/server/listing-changes.ts:494-511`).
- **Security:** four sync POST routes use `auth: "public"` with a hand-rolled session-or-cron `authenticate()` (`app/api/sync/reconcile/route.ts:42-52`, same in `performance`, `keywords`, `sweep`).
- **Security/ops:** `POST /api/sync/performance` and `/keywords` do not call `requireScopesEnabled("sync", …)`, unlike reconcile and sweep (`app/api/sync/performance/route.ts:48-58`). Verify whether the pause is enforced deeper.
- **DB:** per-review sequential upserts inside the page transaction (`lib/server/reviews.ts:700-712`). Batch with `unnest`.
- **DB:** per-field sequential upserts in `persistObservedFields` (`lib/server/profile.ts:144-160`).
- **DB:** the dedicated `withSessionConnection` client lacks `statement_timeout` / `idle_in_transaction_session_timeout` (`lib/server/db.ts:66-70`).
- **Perf:** draft generation makes two sequential OpenAI calls plus 4–5 transactions in one request (`lib/server/review-drafts.ts:238-420`). A span around `ai.ts:92` `fetch` would measure it.
- **Hooks:** `useProfile` invalidates `listingSummaries` and `clientsAll` inside `queryFn` (`lib/queries/use-location-profile.ts:13-22`).
- **Hooks:** `useReviewDetail` is subscribed by three components on one screen (`review-detail.tsx:1008`, `reply-composer.tsx:90`, `action-bar.tsx:75`). It is deduped by key, but each re-renders on every 5s poll.
- **Hooks:** the editor calls `fetchProfile` directly, bypassing the query cache after save (`components/locations/profile/profile-editor.tsx:440`).
- **Docs/ops:** `settling.ts` header contradicts the inline publish (`lib/inbox/settling.ts` header vs `lib/server/publishing/publish.ts:170`).
- **Maintainability:** largest client components exceed 1,100 LOC (`components/bulk/bulk-compose.tsx` 1,884, `locations/menu-editor.tsx` 1,323, `locations/hours-editor.tsx` 1,290, `inbox/review-detail.tsx` 1,139, `inbox/inbox-view.tsx` 1,102).
- **Maintainability:** largest server modules are `lib/server/posts.ts` 2,274, `media.ts` 1,732 and `gbp-write.ts` 1,526. `posts.ts` mixes CRUD, approval, publish, scheduled publish, delete and reaping (`:483`, `:872`, `:1340`, `:1578`, `:1926`).
- **Tests:** no test asserts scheduled posts still run when the claim queue never drains (`lib/server/jobs.ts:1108-1139`).
