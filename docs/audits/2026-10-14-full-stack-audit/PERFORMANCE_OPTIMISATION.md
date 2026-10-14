# Performance optimisation: frontend, data fetching, backend, caching

Part of the 2026-10-14 full-stack audit of NabaPresence. Audience: engineering team.

## Scope and method

- **Snapshot:** `main` at `d8759c74` plus the uncommitted inbox work on `feat/inbox-mail-refinement`. Inbox line numbers come from the working tree; R2-V2 found the cited inbox lines unchanged from HEAD.
- **Source of truth:** `VERIFIED_FINDINGS.md` for priority and status. Where a raw report disagrees, the ledger and the verifier files (`raw/R2-V*.md`) win. Detailed evidence comes from `raw/W5`, `W1`, `W0`, `W4`, `W8`, `W7` and `R2-W7b`.
- **Measured vs inferred:** every number below is either measured (the R2-W7b build, live check runs in W7, the committed release receipt) or a count taken from code (constants, call sites, index counts). Production latency, request rates and table statistics were **not** measured: there is no production telemetry export (W7-1) and the audit made no DB, network or production calls. Where a benefit cannot be quantified from code, this document says what to measure instead.
- **Static only:** no runtime profiling, Lighthouse or React Profiler runs. W5-01 and W2-01 were confirmed by reading Next 16.3.8 and TanStack Query 5.101.4 source, not by observing requests.
- **Status key:** Confirmed / Partially confirmed / Plausible / Unverified, mapped from the ledger's C / PC / P / U.

## Summary

| ID                            | Title                                                                           | Priority | Status                                      | Cx  | Section  |
| ----------------------------- | ------------------------------------------------------------------------------- | -------- | ------------------------------------------- | --- | -------- |
| W5-01                         | URL state via `router.replace/push` re-runs the server page per click/keystroke | P1       | Confirmed                                   | S–M | 2.1      |
| W2-01                         | Inbox `reviews` rebuilt every render; effects and scroll-snap rerun             | P1       | Confirmed                                   | S–M | 2.2      |
| W1-F2                         | Each review write awaits refetch of detail + every loaded page + counts         | P1       | Partially confirmed                         | S–M | 3.1      |
| W3-2 / W8-14                  | Hours/profile/posts/place-actions read Google live on every open                | P1       | Confirmed                                   | M   | 4.6      |
| W4-03                         | Review sync rewrites every review every reconcile                               | P1       | Confirmed                                   | M   | 4.4      |
| W4-04                         | Review timeline and posts list scan the tenant audit log                        | P1       | Confirmed                                   | S   | 4.5      |
| W5-02                         | 15 s clock re-renders the whole inbox; no memoisation; per-row `Intl`           | P2       | Confirmed                                   | S–M | 2.2      |
| BUNDLE                        | ~2.0 MB of 5.74 MB client JS duplicated; lodging schema and zod shipped widely  | P2       | Confirmed (measured)                        | M   | 2.4      |
| W5-03 / W5-04                 | Shell sheets and heavy dialogs statically bundled                               | P2       | Confirmed (size); saving Plausible          | S   | 2.3      |
| W5-05                         | Listings board recomputes everything per keystroke and tick                     | P2       | Confirmed (code)                            | S   | 2.5      |
| W5-06                         | Inbox avatars load eagerly via Base UI                                          | P2       | Confirmed                                   | S   | 2.6      |
| W1-F3 / W8-12                 | Settling poll refetches every loaded page every 5 s, unbounded                  | P2       | Partially confirmed                         | M   | 3.2      |
| W5-07                         | Focus refetch re-reads Google after 30 s; five 60 s shell polls                 | P2       | Confirmed                                   | S   | 3.3      |
| W1 retry                      | `retry: 1` retries deterministic 4xx                                            | P2       | Confirmed                                   | S   | 3.4      |
| W8-11                         | Publish error path does not invalidate review caches                            | P2       | Confirmed                                   | S   | 3.5      |
| W0-05 / W4-05 / W8-13         | `app_session` write on every authenticated request                              | P2       | Confirmed                                   | S   | 4.1      |
| W4-10                         | Dashboard layout opens 5 concurrent tenant transactions per full load           | P2       | Confirmed (inconsistency); impact Plausible | S   | 4.2      |
| W4-06                         | Full-scope count aggregates per poll and per render                             | P2       | Confirmed                                   | S–L | 4.3      |
| W4-09                         | ~6,028 single-row metric upserts on first sync                                  | P2       | Confirmed                                   | S   | 4.4      |
| W0-04                         | Profile GET: live Google read + 6 transactions incl. writes                     | P2       | Confirmed                                   | M   | 4.6      |
| W3-1                          | Google discovery routes page all of Google per request                          | P2       | Partially confirmed                         | S   | 4.6      |
| W4-07                         | Review search via non-inlinable SRF over non-tenant GIN index                   | P2       | Confirmed                                   | M   | 4.5      |
| W5-08 / W5-10 / W5-11 / W1-F9 | CSS scan, formatter caching, needless `"use client"`, redundant refetches       | P3       | Plausible / Confirmed                       | S   | 2.7, 3.6 |

The highest-leverage single change is W0-05 (throttle the session write). It is small, low risk, and every other item in sections 2–3 multiplies its cost: each RSC navigation, poll tick and refetch is one `app_session` UPDATE today.

---

## 1. Baselines

### 1.1 Measured today

All figures are from this audit's own runs. "gz" is gzip -9 computed locally, not CDN transfer size.

| Metric                                                                  | Value                                                                                              | Source                                                |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `pnpm build` wall time (Next 16.3.8, webpack, Node 24.16, no env)       | **54.30 s** real (compile 23.3 s, TypeScript 16.7 s)                                               | R2-W7b, isolated worktree                             |
| Client JS chunks                                                        | **366 files, 5,739,211 B raw / 1,843,879 B gz**                                                    | R2-W7b                                                |
| Duplicated minified bytes across chunks                                 | **2,014,817 B** (~35 % of raw total); `components/ui` 1,021.3 K, lucide 130.2 K, query-core 98.1 K | R2-W7b (source-map attribution)                       |
| Unreferenced chunks (async / pages-router leftovers)                    | 205 files, 818,776 B raw                                                                           | R2-W7b                                                |
| Shared `rootMainFiles` (every route)                                    | 448,411 B raw / **132,484 B gz**                                                                   | R2-W7b                                                |
| Exact first-load JS, static pages                                       | `/privacy` **184,066 B gz**; `/forgot-password` **225,964 B gz**                                   | R2-W7b method A                                       |
| Upper-bound first-load JS (rank only; overcounts by ~175 KB gz)         | `/listings/[id]/profile` 550.8 KB, `/inbox` 522.6 KB, `/setup` 518.1 KB gz                         | R2-W7b method B                                       |
| Largest page chunks                                                     | setup 199,113 / 53,913; inbox 188,656 / 58,757; profile 165,771 / 48,610 (raw / gz B)              | R2-W7b                                                |
| Dashboard layout entry chunk                                            | 76,362 / 23,625 B (W5 estimated ~194 KB gz including its 27 chunks, from an older build)           | R2-W7b, W5                                            |
| Global CSS (every route)                                                | 235,152 B raw / 37,350 B gz                                                                        | R2-W7b                                                |
| Lodging schema JSON in client                                           | 56,086 B raw (chunk `1914`)                                                                        | R2-W7b                                                |
| zod in client                                                           | 73.9 K; chunk `772` referenced by 35 routes incl. auth pages                                       | R2-W7b                                                |
| `pnpm typecheck`                                                        | 3 s warm; 13.7 s cold (release gate)                                                               | W7                                                    |
| `pnpm lint`                                                             | 43 s                                                                                               | W7                                                    |
| `pnpm test` (unit + components)                                         | 106 s wall (vitest 104.87 s); jsdom created 265× = 220.59 s, 32 % of tracked time                  | W7                                                    |
| Local release gate (receipt `20261014T103113Z-2b26bcf2ec59.local.json`) | ~56 min end to end; integration 2,058,944 ms; e2e 1,149,515 ms (572 passed); build 43 s; unit 72 s | W7                                                    |
| Inbox DB query p95 (seeded, lab)                                        | Asserted < 1.5 s; the measured value is not recorded                                               | `tests/integration/inbox-performance.test.ts:164-208` |

Repo-defined targets exist but gate nothing (W7-12): `tests/perf/budgets.json` sets mobile `firstLoadJsTransfer` 330 KB (inbox 380 KB), `apiRequests` 5, LCP 2,500 ms, INP 100 ms, and build ceilings `--max-chunk 50 --max-shared 250 --max-route 400`. Its own note says the 2026-10-13 baseline does not meet them, and that baseline report lives in `/tmp`.

### 1.2 Needs instrumentation

| Metric                                     | Available today?                                | How to instrument                                                                                                                                         | Owner        |
| ------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| API p50/p95/p99 per route                  | No (W7-1, W7-11)                                | Histogram `nabapresence.http.server.duration` in `route()` (`lib/server/route.ts:368-453`) + OTLP endpoint (D-41), or `durationMs` log + Vercel log drain | Platform/ops |
| DB transactions and statements per request | No                                              | AsyncLocalStorage counter in `route()` / `withTenant`; aggregate via `pg_stat_statements`                                                                 | Backend      |
| DB transaction duration                    | Code yes, prod no (`db.ts:19`)                  | Set `OTEL_EXPORTER_OTLP_ENDPOINT`; flush on suspend                                                                                                       | Platform/ops |
| Pool wait time                             | No                                              | Histogram from `getDatabase().begin()` call to first statement (W4-10)                                                                                    | Backend      |
| Google request latency/count               | Code yes, prod no (`google/transport.ts:32-44`) | Same as above                                                                                                                                             | Platform/ops |
| `app_session` writes                       | No                                              | `pg_stat_user_tables.n_tup_upd` on `app_session`, or a counter in `lookupSession`                                                                         | Backend/DB   |
| `review` write amplification               | No                                              | `n_tup_upd`, `n_tup_hot_upd`, `n_dead_tup` on `review`, `review_media_item`, `review_reply`; `pg_stat_statements` calls for the upsert                    | DB           |
| RSC requests per interaction               | No                                              | Playwright: count `?_rsc=` requests per row click / keystroke                                                                                             | Frontend     |
| API requests per interaction / page load   | Lab only (`tests/perf/perf-lab.mjs`)            | Commit a baseline run; add a gate step (W7-12); RUM counter for field data                                                                                | Frontend     |
| LCP / INP / TBT / JS transfer              | Lab only (`perf-lab.mjs`, `route-js.mjs`)       | Gate step; `web-vitals` RUM                                                                                                                               | Frontend     |
| React commit duration (inbox, listings)    | No                                              | React Profiler with 50 / 200 / 500 loaded rows; Chrome Performance long tasks on ArrowDown                                                                | Frontend     |
| Client query cache hit rate                | No                                              | `QueryCache.subscribe` counters to an analytics endpoint                                                                                                  | Frontend     |
| Cold-start cost                            | No                                              | `durationMs` on `startup.safety_ok` (W7-07)                                                                                                               | Platform/ops |
| Job lag / backlog                          | Yes, live only                                  | Scrape `/api/operations/health?scope=platform` on a schedule to keep history (W7-03)                                                                      | Platform/ops |

Without the first two rows, none of the backend acceptance thresholds in section 6 can be checked in production; they can still be checked on staging with `pg_stat_statements` and the lab scripts.

---

## 2. Frontend

### 2.1 W5-01 URL state via the router re-runs the server page on every row click and keystroke

- **Priority:** P1 · **Status:** Confirmed (R2-V2, from Next 16.3.8 source)
- **Location:** `components/inbox/inbox-view.tsx:212-213` (`updateState`), `:314` (clear filters), `:404` (auto-select on load); `components/listings/listings-board.tsx:482-488` (`writeUrl`, called per keystroke by `setSearch`); same pattern in `notifications-view.tsx:160`, `performance-view.tsx:146`, `publication-calendar.tsx:143`, `photos-tab.tsx:52`, `clients-index.tsx` (31 `router.replace|push` sites in total).
- **Current implementation & evidence:** Next 16 includes the search string in the page segment key (`shared/lib/segment.js:61-68`), and treats a search-only change as a refresh of the page segment (`router-reducer/ppr-navigations.js:158-176`). Reuse needs `staleTimes.dynamic`, which defaults to 0 and is not set in `next.config.ts`. Both pages are dynamic (`cookies()` in `getSession`, `headers()` in `requestSearch`). So each inbox selection re-runs `InboxPage`: `getSession()` (including its UPDATE, §4.1), `resolvePrimaryLocation()`, `bulkActionsEnabled()` and `prefetch(inboxPrefetch(search))`, which reads list, counts and the selected review while the client's `useReviewDetail` fetches the same review. Listings search is not debounced, so each keystroke re-runs `ListingsPage`. `router.replace` is a transition, so the highlighted row does not commit until the RSC response arrives.
- **Root cause:** the comments at `app/(dashboard)/inbox/page.tsx:16-22` and `listings/page.tsx:10-12` assume a page that does not read `searchParams` is reused. That is not true in Next 16.
- **Recommendation:** use `window.history.replaceState/pushState` for client-only URL state (Next syncs it with `useSearchParams` without a server request); the repo already does this at `components/settings/team-view.tsx:92`. Add one helper and migrate the inbox and listings call sites first. Debounce listings search (inbox uses 300 ms, `review-filters.tsx:54`). Keep the first-load server prefetch. Correct the two page comments.
  - _Alternatives:_ `experimental.staleTimes.dynamic > 0` (weaker: serves stale RSC data); move URL state into a client-only segment (heavier).
- **Expected benefit:** removes one RSC round trip, its DB reads and one `app_session` write per row selection, filter change or keystroke; selection no longer waits on the server. Count to confirm: `_rsc` requests per interaction.
- **Complexity:** S–M (one helper, ~8 call sites). **Regression risk:** Medium: back/forward (`openedByPushRef`, `inbox-view.tsx:299-310`), focus (`RouteFocus`), and the leave guard, which monkey-patches `history.pushState/replaceState` (`lib/editors/use-leave-guard.ts:176-202`).
- **Tests/verification:** Playwright asserting zero `?_rsc=` requests on row selection and listings typing; existing `tests/components/inbox-view.test.tsx` and the inbox back-button e2e.
- **Dependencies:** none. Coordinate with the user's in-flight inbox branch; do not land on top of uncommitted inbox edits.

### 2.2 W2-01 / W5-02 Inbox render churn

**W2-01 `reviews` and `reviewsQuery` change identity every render**

- **Priority:** P1 · **Status:** Confirmed (root by coordinator; scroll-snap consequence confirmed and extended by R2-V5)
- **Location:** `components/inbox/inbox-view.tsx:195` (`flattenReviews`, a bare `flatMap`, `lib/queries/use-reviews.ts:29-33`); `:201-205` (`loadMore`); `components/inbox/review-list.tsx:174-183` (scroll effect on `[selectedId, reviews]`), `:224-236` (IntersectionObserver).
- **Current implementation & evidence:** `reviews` is a new array every render, and `reviewsQuery` is a new tracked Proxy every render (`queryObserver.ts:267`), so `loadMore` and the IntersectionObserver are rebuilt every render. The scroll effect calls `scrollIntoNearestScroller` (`:599-621`) on every render, so a desktop operator who scrolls away from the selected row is pulled back within ≤ 15 s (clock tick), within ≤ 5 s while a publish is settling, and on every focus refetch or page append. The auto-select loop W2 suggested is overstated (R2-V5): repeat `router.replace` calls go to the same href.
- **Root cause:** effect dependencies on unmemoised derived values, compounded by W5-02's 15 s re-render.
- **Recommendation:** (1) `useMemo(() => flattenReviews(data), [data])`; (2) scroll only when `selectedId` changes (previous-id ref). R2-V5 found (1) alone is insufficient because a page append legitimately changes `reviews`. (3) Stabilise `loadMore` with a latest-ref or `useEffectEvent`.
- **Expected benefit:** no involuntary scroll; observer and effect work proportional to real changes. This is a UX correctness fix as much as a performance one.
- **Complexity:** S. **Regression risk:** Low–Medium (keyboard roving, auto-select).
- **Tests/verification:** component test: scroll the list, advance fake timers 15 s, assert `scrollIntoView` not called; append a page, assert no scroll.
- **Dependencies:** the user's inbox branch touches these files.

**W5-02 15 s clock re-renders the whole inbox; nothing memoised; per-row `Intl` construction**

- **Priority:** P2 (ledger; W5 proposed P1) · **Status:** Confirmed (R2-V2)
- **Location:** `inbox-view.tsx:139` (`Math.floor(useNow() / 3_600_000)`); `lib/time/clock.ts:7` (`TICK_MS = 15_000`); `review-list.tsx:266-300` (row body); `lib/format/date.ts:3-32`.
- **Current implementation & evidence:** `useNow()` returns the millisecond clock, so the ~1,100-line `InboxView` re-renders every 15 s although it only uses the hour. `components/inbox/` has no `memo(` and there is no React Compiler, so `ReviewList`, `InboxToolbar`, `ReviewDetail` and every row re-render too. Per row and per render: `deriveReplyStatus`, `parseReviewText`, and 1–2 `formatDateTime` (4 `Intl.DateTimeFormat` each) plus one `formatDate` (3 more). The list is unbounded (50-row pages, infinite scroll, no windowing).
- **Root cause:** a non-primitive clock snapshot for a threshold consumer; no row memo boundary.
- **Recommendation:** (1) `useNowHour()` with a primitive hourly snapshot; apply the same idea in `listings-board.tsx:408`, `listing-overview.tsx:208`, `area-cards.tsx:193`, `health-strip.tsx:114`, `area-frame.tsx:601`. (2) Module-level formatter cache keyed by locale, time zone and options (also fixes W5-10's 33 construction sites). (3) `React.memo` `ReviewRow` with stable callbacks. (4) Windowing only if field data shows long sessions.
  - _Alternative to (3):_ `reactCompiler: true` app-wide, after W2-03's bail-out measurement.
- **Expected benefit:** removes the periodic full-list render (one every 15 s while the inbox is open); per-render row cost drops to changed rows only. Measure commit duration with 50 / 200 / 500 rows.
- **Complexity:** S for (1)–(2), M for (3), L for (4). **Regression risk:** Low (1–2), Medium (3).
- **Tests/verification:** unit test that `useNowHour` does not notify within an hour; formatter-cache output parity; `tests/components/review-list.test.tsx`.
- **Dependencies:** W2-01.

### 2.3 W5-03 / W5-04 Code-splitting the shell and on-demand dialogs

- **Priority:** P2 · **Status:** Confirmed (static imports, chunk sizes); size of saving Plausible until an analyzer diff
- **Location:** shell: `components/app-shell/app-shell.tsx:21-39`, `:427-447` (`MoreSheet`, `ClientScopeSheet` mounted closed on desktop), `client-switcher.tsx:390` → `scope-sheet.tsx` (666 lines), `scope-sheet-model.tsx` (404), `more-sheet.tsx` (287), `account-menu.tsx` (598). Dialogs: `components/inbox/bulk-action-bar.tsx:14,110` → `TemplateReplyDialog` (555 lines); `components/locations/posts-tab.tsx:11,272`, `posts-action-bar.tsx:25,33` → `PostComposerSheet` (1,112), `SchedulePostSheet` (757); `photos-library.tsx` → `AddPhotoDialog`; `setup-wizard.tsx:41-48` imports all 8 steps, and `setup/page.tsx:10` imports the wizard even on the no-client branch.
- **Current implementation & evidence:** the dashboard layout chunk (76,362 B raw) is on all 51 app routes. The heaviest page chunks are setup, inbox, profile and posts (§1.1). These dialogs render only after a user action. `next/dynamic` is already used for the command palette, switcher search, reconnect banner, OAuth return, MFA prompt, listings board and two profile sheets, so the pattern is established.
- **Recommendation:** `next/dynamic` with `ssr: false` for the phone-only sheets, the account-menu popup body and each dialog above; mount on first open; preload on pointer/focus intent as `ShellLink` does. Split setup steps per step.
- **Expected benefit:** smaller layout and page chunks on every dashboard route; measure with a per-route chunk diff (method B ranking or `route-js.mjs`).
- **Complexity:** S per site. **Regression risk:** Low–Medium (first-open delay; focus return for sheets, `app-shell.tsx:331-345`).
- **Tests/verification:** component tests that open these dialogs must use `findBy*`; touch-390 e2e (`pnpm test:e2e:touch`) for More and client-scope sheets.
- **Dependencies:** none.

### 2.4 BUNDLE Chunk duplication, lodging schema, zod on auth routes

- **Priority:** P2 · **Status:** Confirmed (measured, R2-W7b)
- **Location:** `next.config.ts` (no `webpack`/`splitChunks` customisation); `lib/domain/google-lodging-schema.json` imported by `components/locations/profile/sections/{lodging-workspace,industry-editor,industry-sections}.tsx` and `lib/contracts/lodging-preview.ts`; zod chunk `772`.
- **Current implementation & evidence:**
  - 2,014,817 B of duplicated minified bytes across 366 chunks. Most is cross-route (disk and CDN cache cost), but some is within one route: 111 source files appear in more than one chunk loaded by `/inbox`, 112 by `/listings/[id]/profile`, 40 by `/privacy`. `@tanstack/query-core` `mutation.js` is in 18 chunks and `mutationObserver.js` in 17. Per-route duplicated bytes were **not** quantified.
  - Two react-dom copies are emitted (`framework` for the pages-router fallback, `a3c2aa7f` for app routes); a page loads only one. Not actionable.
  - The 56,086 B Google Lodging discovery document ships as JSON in chunk `1914`, referenced by `/listings/bulk` and `/listings/bulk/[operationId]`, and probably lazily from the profile editor (unconfirmed).
  - zod v4 classic (≈ 19.9 KB gz) is in chunk `772` on 35 routes, including `/sign-in/verify`, `/forgot-password`, `/reset-password`.
- **Root cause:** default webpack split heuristics with many medium shared modules (`components/ui`, Base UI, lucide); contract schemas imported by client components for parsing.
- **Recommendation — investigation plan, not a config change yet:**
  1. Add a temporary `@next/bundle-analyzer` run in a throwaway worktree (dependency changes need owner approval) or extend R2-W7b's source-map scripts to compute **per-route duplicated bytes** for `/inbox` and `/listings/[id]/profile`.
  2. If within-route duplication is material, trial `splitChunks.cacheGroups` for `components/ui`, `@base-ui/react`, `@tanstack/query-core` and lucide's base helpers (`minChunks` ≥ 2, `reuseExistingChunk`) in the worktree; compare per-route method-A/B numbers and chunk count. Check `next build --turbopack` output as an alternative, since Next 16 defaults there and splits differently.
  3. Lodging schema: move the lookup server-side (return only the attributes the location's category needs) or `import()` it when the lodging section opens.
  4. zod: keep schemas out of auth-page client components (validate on the server route, or use a hand-written form check); for dashboard routes, consider `zod/mini` only if the analyzer shows it matters.
  - _Alternative:_ accept cross-route duplication and target only within-route duplicates and the two specific payloads.
- **Expected benefit:** lodging: up to 56,086 B raw off the affected routes; zod: chunk `772` off the auth routes. Duplication: unknown until step 1.
- **Complexity:** M (investigation), S (lodging, zod). **Regression risk:** Medium for `splitChunks` (more requests, cache churn on every deploy); Low for the targeted removals.
- **Tests/verification:** `node tests/perf/route-js.mjs --max-chunk 50 --max-shared 250 --max-route 400` before and after; `pnpm build`.
- **Dependencies:** W7-12 (wire budgets into the gate) so gains are kept.

### 2.5 W5-05 Listings board work per keystroke

- **Priority:** P2 · **Status:** Confirmed (code); scale impact needs production row counts
- **Location:** `components/listings/listings-board.tsx:408` (`useNow()`), `:486-489` (un-debounced `setSearch` → `writeUrl`), `:524-640` (unmemoised rows, filter, sort; `clientChips` at `:603-617` is O(clients × rows)); `lib/server/location-directory.ts:16-48` (no limit).
- **Recommendation:** `useMemo` the derivations; one-pass `Map<clientId, count>` for chips; `useDeferredValue(search)`; history-API URL write (W5-01); hourly clock selector (W5-02). Window only if agencies exceed ~300 listings.
- **Expected benefit:** typing cost no longer scales with C × R; one server round trip less per keystroke via W5-01.
- **Complexity:** S. **Regression risk:** Low. **Tests:** listings-board filter/sort/chip tests; Profiler while typing against a seeded 500-location org.
- **Dependencies:** W5-01, W5-02.

### 2.6 W5-06 Image loading: inbox avatars

- **Priority:** P2 · **Status:** Confirmed
- **Location:** `components/inbox/review-avatar.tsx:52-53`; `@base-ui/react/avatar/image/useImageLoadingStatus.mjs:14-50`.
- **Current implementation & evidence:** Base UI preloads every `src` with `new window.Image()` in a layout effect, so each row's avatar downloads on mount regardless of viewport, and each causes a synchronous layout-phase state update. A page append can start up to 50 Google CDN requests at once. Media thumbnails already use `loading="lazy"` with fixed aspect boxes (`review-detail.tsx:563-568`, `media-card.tsx:110-115`, `post-card.tsx:74-78`).
- **Recommendation:** in list rows render `<img loading="lazy" decoding="async" width height>` with an `onError` initials fallback; keep Base UI Avatar for the single detail-pane avatar.
- **Expected benefit:** avatar requests on first load bounded by the viewport rather than by rows loaded (≤ 50 per page today).
- **Complexity:** S. **Regression risk:** Low. **Tests:** avatar fallback test; CSP remote-thumbnail e2e (`next.config.ts:9-16`).
- **Dependencies:** none.

### 2.7 Lower-priority frontend items (P3)

- **W5-08 CSS (Plausible):** `app/globals.css:1-7` `@source "./"` scans `app/design-system/*` (14 files, 3,970 lines) into the every-route stylesheet (235,152 B raw / 37,350 B gz). Add `@source not "./design-system";` for non-evidence builds and diff the CSS size. S, Low.
- **W5-10 formatter construction (Confirmed):** 33 `new Intl.*Format` sites; folded into W5-02 step 2.
- **W5-11 needless `"use client"` (Plausible):** 8 candidates, notably `components/share/shared-client-report.tsx` on the public share page. Check importers before removing. S, Low.
- **Unused dependencies (Confirmed, no bundle cost):** 7 packages with zero imports and none in client chunks (R2-W7b). Install-time and supply-chain hygiene only; needs owner approval.

---

## 3. Network and data fetching

### 3.1 W1-F2 Review writes await a refetch of every loaded page

- **Priority:** P1 · **Status:** Partially confirmed (R2-V1: 1–3 rounds per Publish press, not 2–4)
- **Location:** `lib/queries/invalidate.ts:15-20` (awaited `Promise.all` over detail, `reviewsAll`, `reviewCountsAll`); `onSuccess: invalidate` in `use-publish-review.ts:16`, `use-approval-decision.ts:16`, `use-delete-reply.ts:15`, `use-draft-mutations.ts:48-54,66`; `use-reviews.ts:11-26` (no `maxPages`); `components/inbox/action-bar.tsx:149-192`.
- **Current implementation & evidence:** TanStack awaits `onSuccess` before `mutateAsync` resolves (`mutation.js:123`), and an infinite refetch walks every cached page sequentially (`infiniteQueryBehavior.js:64-72`). After scrolling k pages, each refetch round is 1 detail + k list pages + every active counts query. Rounds per press: publish only = 1; save + publish = 2; stale-evidence path = 3 plus a duplicate `detail.refetch()` (W1-F9). "Publishing…" stays on screen throughout.
- **Root cause:** list and count freshness is awaited as part of the write.
- **Recommendation:** (a) await only `reviewDetail(id)`; fire-and-forget list and counts, as `useResourceMutation` already does (`use-resource-mutation.ts:151-156`). (b) Set `maxPages` on `useReviews`, or invalidate the list with `refetchType: "none"` and patch the affected row. (c) Seed the detail from the mutation response (`publishResultSchema` returns `status`/`googleReplyState`) with `setQueryData`.
- **Expected benefit:** press-to-outcome becomes the write RTT plus one detail read, instead of rounds × (1 + k + counts) reads. Reads per press are countable today in a component test.
- **Complexity:** S (a), M (b, c). **Regression risk:** Medium (status line and footer must agree, `use-reply-pending.ts`).
- **Tests/verification:** hook test that `mutateAsync` resolves before the list refetch resolves; inbox-view test that the row still updates.
- **Dependencies:** W1-F3; W1-F1 (approval guard) touches the same hook.

### 3.2 W1-F3 / W8-12 Settling poll

- **Priority:** P2 · **Status:** Partially confirmed (R2-V1: scope is the viewer's visible locations; in practice short-lived because publish is inline and the minute recovery cron settles stragglers)
- **Location:** `lib/queries/use-reviews.ts:20-25`; `lib/inbox/settling.ts:16-37` ("Deliberately unbounded"); `use-review-detail.ts:17-19`; `use-review-counts.ts:38-43` (keys on `byStatus`); parking constants `lib/server/jobs.ts:186` (`RECOVERY_PARK_MS` 15 min, limit 14 days), `:736` (`BILLING_HOLD_MS` 1 h).
- **Current implementation & evidence:** while any loaded row is `publish_requested`, list, detail and counts poll every 5 s; each list tick refetches all k pages. A reply parked on reconnect can stay `publish_requested` for up to 14 days, keeping every visible tab on the 5 s poll. Each counts request runs 3–4 aggregate statements (§4.3) plus the session transaction (§4.1).
- **Recommendation:** poll the detail of in-flight rows only and patch list rows via `setQueriesData`; back off 5 s → 15 s → 60 s and stop after N minutes, as `use-mutation-receipt.ts:19-28` does; stop when the attempt is parked (`reconnect_blocked`, `billing_read_only`) and show that state; drive the counts poll from "this session has a pending publish" instead of `byStatus`.
- **Expected benefit:** per visible tab, steady-state requests drop from (k + 2) per 5 s to 1 per 5 s at worst, then decay.
- **Complexity:** M. **Regression risk:** Medium (settling UX regressed before; see the `settling.ts` header).
- **Tests/verification:** `settlingInterval` back-off unit test; parked row stops the poll; settled row updates in the list.
- **Dependencies:** W1-F2; API exposure of the parked state.

### 3.3 W5-07 Window-focus Google re-reads and shell polls

- **Priority:** P2 · **Status:** Confirmed (config); request counts not measured
- **Location:** `lib/queries/query-client.ts:6-9` (`staleTime: 30_000`, `refetchOnWindowFocus: true`); Google-backed hooks with no override: `use-location-hours.ts:11`, `use-location-profile.ts:11`, `use-location-menu.ts:11`, `use-location-booking.ts:10`, `use-location-media.ts:39`, `use-location-posts.ts:29`, `use-location-business-information.ts:16,24`; discovery hooks `use-google-accounts.ts:18-21`, `use-google-locations.ts:10-14`. Shell polls at 60 s: `use-clients.ts:28`, `use-connections-query.ts:19`, `use-connection-health.ts:28`, `use-needs-reply-count.ts:25`, `notifications-link.tsx:28` (plus `use-connection-workspace.ts:27` on connection pages, W4-05).
- **Current implementation & evidence:** returning to a tab after > 30 s refetches every mounted Google-backed query, and each is a live Google read (§4.6; `docs/architecture.md:1360-1366` puts these at 3–5 s). Profile fetches also invalidate three other query families in `finally` (W0-04). The five shell polls cost about 5 requests per minute per visible tab; R2-V1 found observers mounted in the same commit collapse to one in-flight request per key, so the extra volume from repeated observers is small (W1-F10, P3). Hidden tabs do not poll.
- **Recommendation:** for Google-backed resource hooks set `staleTime` to minutes and `refetchOnWindowFocus: false`, relying on mutation invalidation (`useResourceMutation` already invalidates via `queryKeys`) and an explicit Refresh. Discovery hooks: `staleTime: Infinity`, no focus refetch, explicit "Rediscover" (R2-V2). Consolidate the five shell polls into one `/api/shell-status` query, or at least align them on one timer.
  - _Alternative:_ server-side observation cache (§5, C2), which also helps first opens.
- **Expected benefit:** 0 Google reads per focus event on Google-backed tabs; shell polling from 5 requests/min/tab to 1.
- **Complexity:** S. **Regression risk:** Low–Medium (freshness expectations; editors must not reseed on background refetch).
- **Tests/verification:** query-defaults unit test per hook; count `/api/locations/*` requests per focus event in Playwright.
- **Dependencies:** W1-F10 401 fix (`lib/api/clients.ts:14-18` must pass `background` before the consolidated poll inherits the redirect bug).

### 3.4 W1 retry policy

- **Priority:** P2 · **Status:** Confirmed (config, R2-V1)
- **Location:** `lib/queries/query-client.ts:8`; `lib/api/client.ts:348-364`.
- **Evidence:** `retry: 1` is unconditional, so deterministic 400/403/404/409/422 reads are re-sent after 1 s, error states appear 1 s late, and `reportAccessLost` runs per attempt. A foreground 401 hard-navigates on the first attempt, so the double redirect rarely bites (R2-V1).
- **Recommendation:** `retry: (n, e) => n < 1 && !(e instanceof ApiClientError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429)`.
- **Expected benefit:** 0 retries on deterministic 4xx; error UI 1 s sooner.
- **Complexity:** S. **Regression risk:** Low. **Tests:** unit test on `makeQueryClient().getDefaultOptions().queries.retry`.
- **Dependencies:** none.

### 3.5 W8-11 Publish error path leaves caches stale

- **Priority:** P2 · **Status:** Confirmed
- **Location:** `lib/queries/use-publish-review.ts:9-18`; `app/api/reviews/[id]/publish/route.ts:50-64`.
- **Evidence:** the route can return 502 `google_mutation_ambiguous`, 409 or 429 after moving server state; only `onSuccess` invalidates, so the settling poll never starts and the pane is stale until `staleTime` expires and focus returns.
- **Recommendation:** `onSettled` (or `onError` for state-changing codes) invalidates the **detail** only, consistent with 3.1(a). Check approval and delete hooks.
- **Complexity:** S. **Regression risk:** Low. **Tests:** hook test asserting detail invalidation after a 502.
- **Dependencies:** W1-F2 (do not reintroduce awaited all-page refetch on the error path).

### 3.6 W1-F9 Redundant refetches (P3, Confirmed)

`action-bar.tsx:186` duplicate `detail.refetch()`; `sync-reviews-button.tsx:44-60` awaited invalidate then `fetchQuery({ staleTime: 0 })` on the same key; `photos-library.tsx:57-74` seeds then prefix-invalidates the seeded key; `location-access-form.tsx:72-77` and `client-access-dialog.tsx:204-208` set then invalidate the same key. Each is one extra GET per action; fix with `getQueryData` or a predicate. S, Low.

---

## 4. Backend and database cost

### 4.1 W0-05 / W4-05 / W8-13 Session write on every authenticated request

- **Priority:** P2 · **Status:** Confirmed (R2-V1; spot-checked `lib/server/session.ts:217-229`)
- **Location:** `lib/server/session.ts:128-238` (`lookupSession`), `:241-256` (`cache()` wrapper); `lib/server/route.ts:364` (`requireSession()` per route).
- **Current implementation & evidence:** each lookup is one transaction of about 8 round trips: `begin`, `set_config(token_hash)`, identity select, `set_config(org)`, 4-table session select, an unconditional `update app_session set last_seen_at = now(), expires_at = least(...)`, `getOrganisationBilling`, `commit`. `expires_at` is indexed (`app_session_expiry_idx`), so the update is non-HOT. React `cache()` dedupes only within one RSC render; every API call, poll tick and RSC navigation writes. Parallel requests from one page serialise on the same row lock.
- **Root cause:** the sliding idle window is updated unconditionally, although it is measured in days (`SESSION_IDLE_DAYS`).
- **Recommendation:** add `and last_seen_at < now() - interval '<N>'` to the update (W0/W8 suggest 60 s, W4 suggests 5 min; either is invisible at day granularity). Optionally fold the two `set_config` calls into the following statements.
- **Expected benefit:** at most one `app_session` write per session per N, instead of one per request. Measure `n_tup_upd` on `app_session` per active session-hour.
- **Complexity:** S. **Regression risk:** Low (idle expiry moves at N resolution; support sessions unchanged).
- **Tests/verification:** session test: two lookups within N produce one update and unchanged `expires_at`; existing idle-expiry tests.
- **Dependencies:** none. Do first: it reduces the cost of every other request in this document.

### 4.2 W4-10 Layout loaders per navigation

- **Priority:** P2 · **Status:** Confirmed (inconsistency); queueing impact Plausible
- **Location:** `app/(dashboard)/layout.tsx:61-77` (comment assumes `DATABASE_POOL_MAX` 10); `lib/server/env.ts:12-21`; `docs/runbook.md` ~:1269 (production `DATABASE_POOL_MAX=5`); unbounded `listLocationDirectoryRows` (`location-directory.ts:16-48`) and `listClientSummaries` (`clients.ts:111`).
- **Current implementation & evidence:** each full dashboard load runs `getSession` plus 5 concurrent tenant transactions (clients, feature flag, counts, directory rows, …). With a pool of 5, one render takes every pooled connection on the instance; postgres.js queues without a timeout and there is no pool-wait metric. The directory and client list are serialised into every full load's RSC payload without a cap.
- **Recommendation:** merge the four short reads into one `withTenant` with sequential statements (same round trips, one connection), or cap concurrency at 2–3; fix the comment; add the pool-wait histogram (§1.2). Longer term, page the directory (the sidebar needs only clients).
- **Expected benefit:** layout holds ≤ 2 pooled connections instead of 5 (+ session). Measure pool wait under concurrent navigation.
- **Complexity:** S. **Regression risk:** Low. **Tests:** layout prefetch tests still hydrate all keys.
- **Dependencies:** W5-01 removes the extra page-segment reruns but not layout loads on full navigation.

### 4.3 W4-06 Count aggregates per poll

- **Priority:** P2 · **Status:** Confirmed (query shape); cost Plausible (tenant-size dependent)
- **Location:** `lib/server/review-counts.ts:49-111` (settings read; totals with N `count(*) filter`; `group by workflow_status`; optional client group-by); callers `app/(dashboard)/layout.tsx:66-77`, `use-needs-reply-count.ts:25` (60 s), the settling poll (5 s, §3.2), `/api/reviews/counts`. Analytics: `lib/server/analytics-overview.ts:115-128,259-305` (no `create_time` index); `review-queues.ts:62-68` correlated subquery.
- **Current implementation & evidence:** each counts request scans every non-deleted review the viewer can see, 3–4 statements, on every dashboard render and poll tick.
- **Recommendation:** fold `byStatus` into the totals pass (one scan); serve the poll with `Cache-Control: private, max-age=30` or an ETag (see §5 tenant note); skip the layout recompute when the client already holds fresh counts. Analytics: add `(organisation_id, create_time) where provider_deleted_at is null` **only after W4-03** so the index does not multiply sync writes. Materialised per-queue counts (L) only after measurement.
- **Expected benefit:** 1 scan instead of 2–3 per counts request; fewer counts requests per tab-minute with HTTP caching.
- **Complexity:** S (single pass, cache), M (index), L (materialised). **Regression risk:** Low–Medium (badge freshness; list/badge parity).
- **Tests/verification:** count parity tests (list vs badge); `pg_stat_statements` mean time keyed by tenant size.
- **Dependencies:** W4-03 before the analytics index.

### 4.4 W4-03 / W4-09 Sync write amplification

**W4-03 Review sync rewrites every review every reconcile**

- **Priority:** P1 · **Status:** Confirmed (R2-V4, R2-V3)
- **Location:** `lib/server/reviews.ts:155-389` (`upsertGoogleReview`), `:254-288` (`DO UPDATE` with no `WHERE`), `:302-327` (media delete + reinsert), `:332-387` (reply upsert), `:696-718` (per-review loop); `google/reviews.ts:17-18` (page size 50); `reviews.ts:409` (15 min reconcile).
- **Current implementation & evidence:** for every linked location every 15 minutes, page 1 (50 reviews) is upserted unconditionally. Each review costs a per-review `set_config`, the upsert, a media delete plus one insert per item, and a reply write: about 4–5 + M round trips, ~200–250 per page. Setting `raw_content_expires_at` (in two indexes) blocks HOT updates, so ~9 of `review`'s 12 indexes get a new entry per rewrite, including the GIN `search_document`, and two BEFORE UPDATE triggers fire. `content_hash` is written (`:222`, `:282`) and never read.
- **Root cause:** idempotent-by-overwrite upsert without change detection.
- **Recommendation:** add `where review.content_hash is distinct from excluded.content_hash or review.provider_deleted_at is not null or review.raw_content_expires_at < now() + interval '<retention − 1 day>'`; handle the no-row `RETURNING`; skip media and reply writes when the hash is unchanged; set `app.provider_reconciliation` once per page transaction; optionally a multi-row `unnest` upsert. R2-V3: also add reply update-time / in-flight `publish_attempt` guards, because the hash skip alone does not close W8-04's stale-overwrite race.
- **Expected benefit:** unchanged reviews produce 0 row versions; sync round trips per page drop roughly 4× (W4 estimate from statement counts). Also shortens W8-01's per-location job time, which caps fleet throughput.
- **Complexity:** M. **Regression risk:** Medium (erasure guard, workflow reset `published/rejected → new`, retention redaction must not be undone).
- **Tests/verification:** unchanged payload leaves `xmin` unchanged; changed reply rewrites; expiry near its end refreshes; existing erasure and retention tests. Staging: `n_tup_upd`, `n_tup_hot_upd`, `n_dead_tup` before and after one reconcile cycle.
- **Dependencies:** W8-04 guards; prerequisite for W4-04/W4-06/W4-12 index additions.

**W4-09 Performance metrics persisted one statement per point**

- **Priority:** P2 · **Status:** Confirmed
- **Location:** `lib/server/performance.ts:192-223` (loop), constants `:30-31` (`METRIC_MONTHS = 18`, `RESTATEMENT_DAYS = 10`); 11 metrics (`google-contract.ts:34-46`).
- **Evidence:** ~6,028 sequential `INSERT … ON CONFLICT` in one transaction on first sync; 110 per location every 6 hours in steady state; unconditional update.
- **Recommendation:** chunked multi-row upsert (~1,000 rows) with `where … value is distinct from excluded.value`; same for `keywords.ts` and `posts.ts:528-539`.
- **Expected benefit:** first-sync statements from ~6,028 to ~7 chunks; no-op resync writes 0 rows.
- **Complexity:** S. **Regression risk:** Low. **Tests:** performance sync tests plus "no-op resync writes 0 rows".
- **Dependencies:** none.

### 4.5 W4-04 / W4-07 Audit-log index and search

**W4-04 Timeline and posts list scan the tenant audit log**

- **Priority:** P1 (posts part P2) · **Status:** Confirmed (R2-V4)
- **Location:** `lib/server/review-reads.ts:224-240` (every review-detail open); `lib/server/posts.ts:739-760` (`local_edits` CTE, every posts list); existing indexes `0001_initial.sql:394` `(organisation_id, created_at desc)` and the unique `(organisation_id, request_id, action, subject_type, subject_id)` at `:380`.
- **Evidence:** neither index can seek on subject. For a review whose events are older than the newest tenant events, the timeline reads much of the tenant's audit history (retention default 365 days, `0008:149`). The posts CTE aggregates every post-edit row for the tenant even for one post.
- **Recommendation:** `create index concurrently … on audit_log (organisation_id, subject_type, subject_id, created_at desc) include (action)` in a `-- migrate:no-transaction` migration (W4-13); rewrite `local_edits` as a `left join lateral` per listed post, or persist `content_edited_at` on `gbp_local_post`.
- **Expected benefit:** timeline becomes an index seek + ordered `LIMIT 100`, independent of audit volume.
- **Complexity:** S. **Regression risk:** Low (one btree on an append-only table).
- **Tests/verification:** timeline ordering; posts `sort_at` semantics; `EXPLAIN (ANALYZE, BUFFERS)` on staging for the largest tenant.
- **Dependencies:** W4-13 (first `CONCURRENTLY` migration; no `lock_timeout` by default).

**W4-07 Search via plpgsql SECURITY DEFINER SRF** — P2, Confirmed. `0011_tenant_review_search.sql:3-30` cannot be inlined (default 1,000-row estimate, full materialisation before `ORDER BY … LIMIT`), and the GIN index (`0010:14`) has no tenant column, so common terms return every tenant's postings before the tenant recheck. Measure on staging with `EXPLAIN` before choosing between a SQL-language inlinable function and a tenant-leading index; M, Medium (RLS bypass inside the function must keep its explicit tenant check).

### 4.6 W3-2 / W8-14 / W0-04 / W3-1 Live Google reads per editor open

- **Priority:** P1 (W3-2), P2 (W0-04, W3-1) · **Status:** Confirmed (R2-V2, R2-V1); W3-1 Partially confirmed
- **Location:** hours `lib/server/hours.ts:98,125-257,186,213,262-266`; profile `profile.ts:186-310`; food menus `food-menus.ts:222`; posts `posts.ts:688,703-711`; place actions `place-actions.ts:109-116`; contrast `media.ts:190-191,318-328` (5 min TTL, `refresh` bypass). Profile hook side effects `lib/queries/use-location-profile.ts:13-22`; editor re-read `profile-editor.tsx:440`. Discovery `app/api/google/accounts/route.ts:73-155`, `app/api/google/locations/route.ts:47-…`.
- **Current implementation & evidence:**
  - Hours GET: linked-location txn, token, live Google read + categories call, `ensureCanonicalResource` txn, `recordHoursObservation` txn (a row write on every read), latest-attempt txn — 4 tenant txns + token lookup per open.
  - Profile GET: 1 live Google read + 6 transactions, including `persistObservedFields` (per-field sequential upsert loop) and an observation write; `queryFn`'s `finally` invalidates `listingSummary(id)`, `listingSummaries` and `clientsAll` on every fetch, including focus refetches. Save-and-publish reads the profile from Google ≥ 4 times (PUT, editor `fetchProfile`, `prepareProfilePublish`, readback up to 3 attempts), plus the `useProfile` refetch.
  - Posts: `reconcileLocalPosts` (live list + txn) on every first page. Place actions: live metadata call per load.
  - Media is the only gated surface. Combined with §3.3, focus after 30 s repeats all of this.
  - Discovery (W3-1, P2): pages all of Google and upserts one row per account/location per request; owners/admins on connections/setup only, so rare.
- **Root cause:** reads double as observation syncs; no freshness gate; cross-surface freshness implemented as a `queryFn` side effect.
- **Recommendation:** adopt media's pattern (C2 in §5) for hours, profile, menus, place actions and posts: serve the stored observation when younger than N minutes, `refresh=1` for explicit refresh; publish preflights and readbacks keep forcing live reads. Profile: merge the four post-Google transactions and batch field upserts; return `observationChanged` and invalidate summaries only when true, in `onSuccess`, not `queryFn`; have `PUT …/profile` return fresh state so the editor skips `fetchProfile` (keep `prepareProfilePublish`'s deliberate safety re-read). Discovery: client `staleTime: Infinity` + explicit Rediscover.
- **Expected benefit:** within the TTL, 0 Google calls and 0 observation writes per editor open; save-and-publish drops at least the editor's `fetchProfile` read; fewer draws on the shared Google budget that background sync competes for (W8-06).
- **Complexity:** M. **Regression risk:** Medium (drift detection must still fire; stale observations must never feed a publish).
- **Tests/verification:** route test: second GET within TTL makes no Google call; `refresh=1` bypasses; GET with unchanged observation writes nothing; profile refetch does not invalidate `clientsAll` unless changed.
- **Dependencies:** W5-07 (client side); W4-01 (the publish path's lock transaction is a reliability fix, tracked in the reliability deliverable; do not change publish flows here without it).

### 4.7 Interaction cost model (R2-X1)

Code-derived operation counts, not timings. Source:
`raw/R2-X1-interaction-cost-model.md`, where each hop has file:line and is
labelled CONFIRMED or ESTIMATED. Key: N = loaded inbox pages, Tx = database
transactions, Ws = `app_session.last_seen_at` writes.

| Interaction | Requests | Tx | Ws | Google calls |
|---|---|---|---|---|
| Cold `/inbox`, desktop | 6 | 22 | 6 | 0 |
| Cold `/inbox`, phone | 4 | 15 | 4 | 0 |
| Select a review | 1 RSC | 5 | 1 | 0 |
| Publish reply (happy path) | N+4 | 2N+13 | N+4 | 1 |
| Idle visible tab, 10 min | 40 | 80 | 40 | 0 |
| Open Hours editor (soft navigation) | 1 | 10 | 1 | 2 |

**Corrections:**

- On a search-param-only navigation, shared layouts are reused. Only the inbox
  page re-runs on the server (Next 16.3.8 source).
- The review detail is not fetched twice; it arrives with the server response.

**New, plausible:** selecting a review may collapse the infinite list to page 1
when newer hydrated page data replaces the N loaded pages. To confirm: scroll
past row 50, click a row, and check whether the list resets.

**Cheapest multipliers, with the reduction each gives in the model:**

| Fix | Effect in the model |
|---|---|
| Throttle the session write to at most once a minute | Ws falls 75–90% |
| History API for inbox URL state | Select falls from 5 Tx to 2 |
| Patch the changed row instead of refetching every page (needs a contract change, see WP-09) | Refetch round falls from N+2 requests to 2; at N=10, a publish falls from 33 Tx to 13 |
| One consolidated shell poll | Idle tab falls from 40 requests / 80 Tx to about 10 / 20 |
| React `cache()` for duplicate loader reads, plus cached feature flags | Cold `/inbox` document falls from 9 Tx to 6; Hours open drops 1 Tx |

---

## 5. Caching

### 5.1 Inventory (from W8, condensed)

| Layer              | Location                                                                                                                                   | Scope / key                                    | TTL / invalidation                                                                      | Tenant safety                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TanStack Query     | `lib/queries/query-client.ts:4-23`; keys `lib/queries/keys.ts`                                                                             | Literal `"organisation"` scope, not the org id | `staleTime` 30 s, `retry` 1, focus refetch on, gc 5 min; 60 s shell polls, 5 s settling | Safe via `resetScopedQueries` (`scope-reset.ts:25-55`) on any scope-token change (user, org, role, publish right, fingerprint) and `queryClient.clear()` from the account menu |
| React `cache()`    | `session.ts:245`, `primary-location.ts:34`, `listing-metadata.ts:17`, `clients/[clientId]/layout.tsx:24`                                   | Per request                                    | Request lifetime                                                                        | Safe                                                                                                                                                                           |
| Next route config  | `(legal)` `force-static`; share report and design-system `force-dynamic`                                                                   | —                                              | —                                                                                       | Safe; no `unstable_cache`, `revalidate`, `'use cache'`; outbound `fetch` is `no-store`                                                                                         |
| HTTP               | `next.config.ts:109-113` share pages `private, no-store`; explicit `no-store` on a few routes                                              | —                                              | —                                                                                       | Most authenticated JSON responses set no header and rely on dynamic handlers not being cached (low-risk hypothesis)                                                            |
| DB media cache     | `lib/server/media.ts:190-191`                                                                                                              | Per location, RLS via `withTenant`             | 5 min, `refresh: true` bypass                                                           | Safe                                                                                                                                                                           |
| Process-local      | token-owner map (`credentials.ts:27-57`, 1 h, cap 2,000), refresh single-flight, pacer maps, pause snapshot (5 s), JWKS, DB pool singleton | Keyed by bearer token / connection / platform  | Per instance                                                                            | Safe                                                                                                                                                                           |
| Google rate budget | `rate-budget.ts` + `google_rate_bucket`                                                                                                    | Per API host; per location for BI edits        | 10 s / 60 s windows                                                                     | Platform-level; fails open after 2 s (W8-10)                                                                                                                                   |

W8 found **no cross-tenant leak**: no module-level server cache is keyed without an org-specific or secret key.

### 5.2 Recommended changes

| #   | Change                                                                                                                             | Invalidation implications                                                                                                                                                                                              | Tenant-safety notes                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Google-backed resource hooks: `staleTime` in minutes, `refetchOnWindowFocus: false`; discovery hooks `staleTime: Infinity` (§3.3)  | Rely on `useResourceMutation` invalidation and explicit Refresh; profile summary invalidation moves to `onSuccess` gated on `observationChanged` (§4.6)                                                                | Unchanged: keys stay under `resetScopedQueries`                                                                                                                                                                                                                                                                   |
| C2  | Server observation cache for hours, profile, menus, place actions, posts, reusing media's TTL + `refresh` pattern (§4.6)           | Any successful publish must update or invalidate the stored observation in the same flow; preflight and readback always bypass; `presence_resource_reconcile_state.last_succeeded_at` can serve as the freshness stamp | Read through `withTenant` (RLS) like media; never a module-level map                                                                                                                                                                                                                                              |
| C3  | Counts: `Cache-Control: private, max-age=30` or ETag on `/api/reviews/counts` (§4.3)                                               | A review write must not be masked: client invalidation after writes must bypass the HTTP cache (`cache: "no-store"` on the refetch, or an ETag revalidation rather than `max-age`)                                     | **Counts depend on the viewer** (visible locations, viewer-specific queues; R2-V1, W4-06). Any server-side memo must key on user + scope fingerprint, not org. A per-org memo as floated in W4-06 would leak counts across members with different visibility. Prefer ETag/private HTTP caching over a server memo |
| C4  | Default `Cache-Control: private, no-store` in `route()` (`lib/server/http.ts`) for authenticated JSON, with explicit opt-in for C3 | None                                                                                                                                                                                                                   | Hardening: removes reliance on platform defaults                                                                                                                                                                                                                                                                  |
| C5  | Settling poll and write refetches narrowed to detail (§3.1, §3.2)                                                                  | List rows patched from detail via `setQueriesData`; counts refreshed fire-and-forget                                                                                                                                   | Unchanged                                                                                                                                                                                                                                                                                                         |
| C6  | Not recommended: `experimental.staleTimes.dynamic` as a fix for W5-01                                                              | Would serve stale RSC data for all dynamic pages                                                                                                                                                                       | If ever used, the RSC cache is per browser, so not a tenant risk, but scope switches must still hard-refresh                                                                                                                                                                                                      |
| C7  | Not recommended now: `'use cache'` / `unstable_cache` for tenant data                                                              | —                                                                                                                                                                                                                      | If introduced, cache keys must include org id and the viewer's scope fingerprint; review against W8's inventory first                                                                                                                                                                                             |

---

## 6. Before/after validation

Thresholds are relative to the current code path. "Lab" = Playwright or component test against the local stack; "staging" = staging DB with `pg_stat_statements`. Production validation needs §1.2 instrumentation first.

| Rec           | Metric                                                                     | Measurement method                                                                  | Acceptance threshold                                                                                                  |
| ------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| W5-01         | RSC requests per inbox row click / listings keystroke                      | Playwright: count `?_rsc=` requests while arrowing 10 rows and typing 10 characters | 0 `_rsc` requests per row click or keystroke (≤ 1 server render per explicit navigation only)                         |
| W5-01         | Server `prefetch(inboxPrefetch)` runs per session                          | Log/span count on `InboxPage` during the same script                                | 1 per full page load, 0 per selection                                                                                 |
| W2-01         | Involuntary scrolls                                                        | Component test: scroll away, advance timers 60 s, append a page                     | 0 `scrollIntoView` calls without a `selectedId` change                                                                |
| W5-02         | `InboxView` commits while idle                                             | React Profiler, 5 min idle with inbox open                                          | 0 commits from the clock within an hour boundary (today: one per 15 s)                                                |
| W5-02         | Commit duration on ArrowDown                                               | Profiler with 50 / 200 / 500 rows                                                   | Row re-renders per selection ≤ 2 (old and new row); duration does not grow with loaded rows                           |
| W5-03/04      | Layout and page chunk bytes                                                | `route-js.mjs` / R2-W7b method B, same commit ± change                              | Strict decrease for layout, inbox, setup, posts chunks; no new route above `--max-route 400`                          |
| BUNDLE        | Within-route duplicated bytes (`/inbox`, `/listings/[id]/profile`)         | R2-W7b source-map script extended per route                                         | Quantify first; any `splitChunks` change must reduce per-route bytes without raising per-route chunk count materially |
| BUNDLE        | Lodging schema / zod presence                                              | grep chunks referenced by auth and bulk routes                                      | Lodging JSON absent from initial chunks; chunk `772` absent from `/sign-in*`, `/forgot-password`, `/reset-password`   |
| W5-06         | Avatar requests on first inbox load                                        | Network count of `googleusercontent` requests                                       | ≤ rows in viewport (+ small overscan), not rows loaded                                                                |
| W1-F2         | Requests per Publish press after scrolling k pages                         | Component test with mocked API counting requests                                    | Button settles after write + 1 detail read; list/counts reads not awaited; total list reads per press ≤ 1 page        |
| W1-F3         | Requests per visible tab per minute while one reply is `publish_requested` | Fake-timer hook test; Playwright with a parked attempt                              | ≤ 12 detail reads in the first minute, then decaying; 0 list-page refetches from the poll; 0 polling once parked      |
| W5-07         | Google-backed requests per window-focus event                              | Playwright: blur 60 s, focus, count `/api/locations/*`                              | 0 per focus event within `staleTime`                                                                                  |
| W5-07         | Shell poll requests per idle visible tab per minute                        | Playwright network log over 5 min                                                   | ≤ 1 per minute (from 5) if consolidated                                                                               |
| W1 retry      | Requests per deterministic 4xx read                                        | Unit test on default `retry`; network count on a 404 review                         | 1 request, no retry                                                                                                   |
| W0-05         | `app_session` writes                                                       | Session test; staging `n_tup_upd` on `app_session`                                  | 0 `app_session` writes for requests within N of the last write; ≤ 1 per session per N                                 |
| W4-10         | Pooled connections held per layout render                                  | Pool-wait histogram; test with `DATABASE_POOL_MAX=5`                                | ≤ 2 concurrent checkouts per render; pool wait p95 not above pre-change under concurrent navigation                   |
| W4-06         | Statements per counts request                                              | `pg_stat_statements` calls / test spy                                               | 1 aggregate scan (+ settings read) instead of 2–3                                                                     |
| W4-03         | Row versions per reconcile of an unchanged page                            | Integration test (`xmin`); staging `n_tup_upd`, `n_dead_tup` per cycle              | 0 updates to `review`, `review_media_item`, `review_reply` for unchanged reviews; statements per page ≤ ¼ of current  |
| W4-09         | Statements for first sync / no-op resync                                   | `pg_stat_statements` calls                                                          | ≤ ceil(points / 1,000) statements; 0 rows written on a no-op resync                                                   |
| W4-04         | Timeline plan                                                              | `EXPLAIN (ANALYZE, BUFFERS)` on staging, largest tenant                             | Index scan on the new index; buffers read independent of tenant audit size                                            |
| W3-2 / W8-14  | Google calls and writes per editor open within TTL                         | Route test with Google stub call counter                                            | 0 Google calls and 0 observation writes on a second open within TTL; `refresh=1` makes exactly 1                      |
| W0-04         | Live profile reads per save-and-publish                                    | Google stub counter in integration test                                             | At least 1 fewer than today (editor `fetchProfile` removed); safety re-read and readback retained                     |
| C3            | Counts responses served from cache                                         | Network panel / ETag 304 count                                                      | Badge never shows a pre-write count after the user's own write; 304 or cached responses for idle polls                |
| W7-12 (guard) | Regression gate                                                            | `perf:budgets` / `route-js.mjs` in `verify-local`                                   | Gate fails on any route exceeding committed baseline by an agreed margin                                              |

---

## Open questions / needs live measurement

1. **Production request mix.** Without the OTLP endpoint (D-41) or a log drain, per-route p95, requests per tab-minute and the real share of poll traffic are unknown. This decides whether W0-05 and C3 are worth more than W5-01.
2. **W5-01 at runtime.** Confirmed from Next source; still verify with the `_rsc` network filter on staging before and after, especially for the leave guard and back/forward.
3. **Scroll depth (k).** W1-F2, W1-F3 and W5-02 all scale with loaded pages. Need field data on pages loaded per inbox session to rank them and decide on `maxPages` or windowing.
4. **`review` write amplification magnitude.** `n_tup_upd` / `n_tup_hot_upd` / `n_dead_tup` on `review` from staging or a read-only production stats query, with owner approval.
5. **Pool wait and Fluid compute.** Whether concurrent invocations share an instance's pool of 5 (W8 inventory hypothesis) determines how much W4-10 matters.
6. **Google read latency.** The 3–5 s figure comes from `docs/architecture.md`, not from measurement. Google request histograms exist in code but are not exported.
7. **Per-route duplicated bytes.** Not quantified; needed before any `splitChunks` change (§2.4 step 1). Also check whether the lodging schema loads lazily from the profile editor.
8. **Settling poll duration in practice.** R2-V1 expects it to be short-lived; confirm how often replies sit in `publish_requested` long enough (parked reconnect/billing) to keep tabs on the 5 s poll.
9. **Counts query cost by tenant size.** `pg_stat_statements` mean time for `review-counts.ts` against the largest tenant, before choosing between single-pass, HTTP caching and materialised counts.
10. **Lab perf baseline.** `tests/perf/budgets.json` points at a `/tmp` report; rerun `perf-lab.mjs` and commit the result so the thresholds above have a stored "before".
11. **Interaction cost model.** §4.7 awaits R2-X1.
