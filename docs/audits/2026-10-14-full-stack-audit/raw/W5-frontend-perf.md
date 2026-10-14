# W5: Frontend performance (rendering, bundles, loading, assets, memory)

**Scope covered:** `app/**` (pages, layouts, `loading.tsx`, error boundaries), `components/**`, the client-side `lib/queries/**`, `lib/time/**` and `lib/format/**` helpers they call, `next.config.ts`, `app/globals.css`, `public/`, and the existing production build output in `.next/` (read-only).

**Checkout evaluated:** HEAD `d8759c74` (committed 2026-10-14 11:37 +0100) plus the uncommitted working tree (`components/inbox/*`, `lib/inbox/layout.ts`). No file was modified except this one.

**Commands run (all read-only):**

- `rg`/`grep`/`find`/`wc` sweeps: `"use client"` counts, library import sites, `next/dynamic` sites, `<img>` sites, `router.replace` sites, `setInterval`/`addEventListener`/`createObjectURL` sites, `useNow` consumers, `staleTime`/`refetch*` overrides.
- `.next` build inspection with Node one-liners: `/tmp/w5-routes3.js` loads each `server/app/**/page_client-reference-manifest.js` and sums gzip sizes of the chunks reachable from that page's own entry and its layout chain. I also listed per-entry chunk sizes under `.next/static/chunks/app`, read `.next/build-manifest.json` and `.next/react-loadable-manifest.json`, and checked CSS/media sizes. Chunks were gzipped in memory and nothing was written to `.next`.
- Next 16 internals and docs: `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md` (§ native History API), `.../05-config/01-next-config-js/{staleTimes,reactCompiler,optimizePackageImports}.md`, `node_modules/next/dist/esm/client/components/segment-cache/vary-path.js:68-69`, `node_modules/next/dist/esm/shared/lib/segment.js:11-18`, `node_modules/next/dist/server/config.js:1121-1143` (the default `optimizePackageImports` list).
- `node_modules/@base-ui/react/avatar/image/useImageLoadingStatus.mjs` (how Avatar images load).

**Not covered, and why:**

- **No fresh build or bundle analyzer.** The rules forbid it in this checkout. I used the existing `.next` webpack production build (BUILD_ID `kgpptf8typ2LaN40JBCHE`, files dated 2026-10-14 12:38–12:39). It may or may not include the current uncommitted inbox edits.
- **Route sizes are approximate.** Webpack's client-reference manifest records chunk membership for only one entry per shared module, so per-route totals below are a **lower bound** for pages whose components are shared (e.g. every `listings/[id]/*` tab reports the same 199 kB). The root-main, layout-entry and page-entry chunk sizes are exact.
  - To measure precisely, run this in a separate worktree: `git worktree add ../np-bundle HEAD && cd ../np-bundle && pnpm install --frozen-lockfile && ANALYZE=1 pnpm build`, with `@next/bundle-analyzer` wired temporarily into `next.config.ts` (or `pnpm exec next experimental-analyze` if the installed 16.3.8 exposes it). Then compare the "First Load JS" column per route.
- **No runtime profiling.** I did not run React Profiler, Lighthouse, Web Vitals or a network waterfall, and did not use the dev server (the user may be running it). Each finding states how it would be measured.
- **No production data volumes** (locations per org, reviews scrolled per session), so list-scale findings depend on scale.

---

## Measured baseline (from the existing `.next` build)

Exact sizes:

| Item                                                             | Raw               | Gzip                        |
| ---------------------------------------------------------------- | ----------------- | --------------------------- |
| Root main files (`webpack`, `a3c2aa7f`, `860`, `main-app`)       | 438 kB            | **130 kB**                  |
| `app/layout` entry tree (ThemeProvider, Toaster, ViewportInsets) | —                 | 42 kB                       |
| `app/(dashboard)/layout` entry tree (QueryProvider + AppShell)   | 76 kB entry chunk | **194 kB** incl. its chunks |
| Global CSS `static/css/9f0527327c664ef7.css` (every route)       | 236 kB            | 37.7 kB                     |
| Fonts: two JetBrains Mono Latin WOFF2 subsets                    | 21 + 23 kB        | —                           |

Largest page-entry chunks (page-specific code only):

| Page                  | Raw    | Gzip  |
| --------------------- | ------ | ----- |
| setup                 | 199 kB | 54 kB |
| inbox                 | 189 kB | 59 kB |
| listings/[id]/profile | 166 kB | 49 kB |
| listings/[id]/posts   | 105 kB | 32 kB |
| settings/privacy      | 89 kB  | 25 kB |

Approximate first-load JS (gzip, lower bound as explained above):

| Route                       | First-load JS |
| --------------------------- | ------------- |
| setup                       | ~492 kB       |
| inbox                       | ~482 kB       |
| settings                    | ~426 kB       |
| reports                     | ~423 kB       |
| any dashboard route (floor) | ~329 kB       |
| sign-in                     | ~216 kB       |
| legal / share               | ~172–176 kB   |

What these numbers show:

- **Every authenticated page pays about 329 kB gzip before any page code** (framework + root layout + dashboard shell).
- **What is already good:**
  - All 49 `page.tsx` files are server components; only error and not-found boundaries in `app/` are client components.
  - `QueryProvider` is in the dashboard layout, not the root, so auth, legal and share pages don't ship TanStack Query.
  - Shell-level `next/dynamic` is already used for the command palette, the client switcher search, the reconnect banner, the OAuth return, the MFA step-up prompt, the listings board and two profile sheets (`.next/react-loadable-manifest.json`).
  - `lucide-react` is in Next's default `optimizePackageImports` list (`node_modules/next/dist/server/config.js:1125`), and `@base-ui/react` is always imported by subpath (22 sites).
  - No chart, carousel or date library reaches the client.
  - `tinyld` (≈0.6–2 MB) is server-only: `lib/contracts/reviews.ts:11` imports `lib/domain/verification` as **type-only**, and grepping the client chunks for `tinyld` finds nothing.

---

## Findings

### W5-01 URL-state changes made with `router.replace`/`router.push` probably re-render the server page on every change: every inbox row click, and every listings-search keystroke

- Priority: **P1**
- Status: **PLAUSIBLE.** Next's own code shows a page segment's cache key varies with the search string, but I did not observe it at runtime.
- Location:
  - `components/inbox/inbox-view.tsx:207-216` (`updateState` → `router.replace(href)` / `router.push(href)`), called by `onSelect` at `:301-311` for every row selection and arrow-key move.
  - `components/listings/listings-board.tsx:460-488` (`writeUrl` → `router.replace(...)`, called by `setSearch` on every keystroke with no debounce).
  - The same pattern appears in `components/notifications/notifications-view.tsx:160`, `components/performance/performance-view.tsx:146`, `components/calendar/publication-calendar.tsx:143`, `components/locations/photos-tab.tsx:52` and `components/clients/clients-index.tsx` (31 `router.replace|push` sites in total).
- Current implementation / Evidence / Root cause:
  - The comments in `app/(dashboard)/inbox/page.tsx:16-22` and `app/(dashboard)/listings/page.tsx:10-12` assume that a page with no `searchParams` prop is "reused" when only the query string changes.
  - Next 16's client segment cache says otherwise: `segment-cache/vary-path.js:68-69` — _"Unlike layouts, a page segment's vary path also includes the search string."_ The server side does the same (`shared/lib/segment.js:11-18` `addSearchParamsIfPageSegment`).
  - `staleTimes.dynamic` defaults to 0 since v15 (`docs/.../staleTimes.md:42`), and every dashboard page is dynamic (cookies/headers).
  - So each `router.replace('/inbox?…selected=X')` should issue an RSC request that re-runs the page:
    - **Inbox (`InboxPage`, `page.tsx:30-43`):** `getSession()`, `resolvePrimaryLocation()`, `requestSearch()`, then `prefetch(inboxPrefetch(search))`. Because the URL now names a review, that prefetch reads the first reviews page and the review detail, which the client is fetching through `useReviewDetail` at the same moment. It also runs `bulkActionsEnabled()`.
    - **Listings (`ListingsPage`):** `getSession()` plus `bulkActionsEnabled()`.
  - **Every one of these requests writes to the database.** `getSession()` runs an `UPDATE app_session SET last_seen_at…` on every request (`lib/server/session.ts:216-230`). It is `cache()`d per request (`:245`) but not across requests.
  - `router.replace` is a transition: `useSearchParams` and the selected row don't commit until the RSC response arrives. **So selection latency includes a server round trip plus several database reads.**
  - The project already uses the right tool once: `components/settings/team-view.tsx:92` calls `window.history.replaceState`. Next documents that `pushState`/`replaceState` sync with `useSearchParams` without a server request (`docs/01-app/01-getting-started/04-linking-and-navigating.md:345-347`).
- Recommendation:
  - For URL changes that only change client state (inbox `selected`/queue/filters, listings `q`/`health`/`order`/`clientId`, photos/notifications/calendar/reports filters), use `window.history.replaceState(null, "", href)` or `pushState`.
  - Keep `router.push` only where a server re-render is actually wanted.
  - Debounce the listings search (the inbox's `review-filters.tsx:54` debounce is 300 ms).
  - **Keep** the first-load prefetch: it keys on the request header, and a history-API change never reaches the server.
  - Alternatives:
    - (a) Keep `router.replace` but add `experimental.staleTimes.dynamic` > 0. This is weaker and caches stale data.
    - (b) Move the URL state into a parallel route or client-only segment. This is heavier.
  - Expected benefit: removes one RSC round trip and its database reads per row selection or keystroke, cuts click-to-highlight latency in the inbox, and removes per-keystroke `app_session` writes.
- **How to confirm first:** in the DevTools Network tab, filter on `_rsc` and arrow through inbox rows. Or count OTel spans for `prefetch`/`getSession` per inbox interaction.
- Complexity: **S–M** (one helper, used by about 8 call sites).
- Regression risk: **Medium.**
  - Back/forward behaviour: inbox `openedByPushRef` (`inbox-view.tsx:299-310`) relies on push semantics.
  - Focus management: `RouteFocus` and the leave guard. `lib/editors/use-leave-guard.ts:176-202` monkey-patches `history.pushState`/`replaceState`, so check it still works.
- Tests to add or verify:
  - Playwright: assert no `?_rsc=` request when selecting rows or typing in listings search.
  - Existing tests: `tests/components/inbox-view.test.tsx`, and the inbox back-button e2e.
- Dependencies: W-backend (getSession write amplification).

### W5-02 The inbox list re-renders every row on every 15 s clock tick, every selection and every list refetch, with no row memoisation and 7–11 `Intl.DateTimeFormat` constructions per row

- Priority: **P1** (scales with how far an operator scrolls; P2 if sessions rarely exceed ~100 rows)
- Status: **CONFIRMED** (code path read end to end; cost not measured)
- Location:
  - `components/inbox/inbox-view.tsx:139` (`const hour = Math.floor(useNow() / 3_600_000)`)
  - `components/inbox/inbox-view.tsx:195` (`flattenReviews` creates a new array every render)
  - `components/inbox/inbox-view.tsx:595-620` (`<ReviewList>` gets an inline `selection` object and an inline `onMovePastEnd`)
  - `components/inbox/review-list.tsx:266-300` (row body)
  - `lib/format/date.ts:3-32`
  - `lib/time/server-now.tsx:26-33`
  - `lib/time/clock.ts:7-41`
- Current implementation / Evidence / Root cause:
  - **15 s re-renders:** `useNow()` is `useSyncExternalStore(subscribeClock, readClock)`, and `readClock()` returns a new number on every 15 s tick (`clock.ts:7,14-16,37-41`). `InboxView` only needs the hour, but the snapshot is the millisecond clock, so **the 1,100-line `InboxView` re-renders every 15 s**.
  - **No memoisation:** `ReviewList` is a plain function component and each row is inline JSX in `reviews.map`, so every `InboxView` render re-runs every row. That includes the 15 s tick, every `selectedId` change, `isRefreshing`/`isFetchingNextPage` flips, the 60 s counts poll and the settling poll (`use-reviews.ts:20-25`).
  - **Per-row work on every render:**
    - `deriveReplyStatus(replyStateFromRow(...))`
    - `parseReviewText(...)`
    - `formatDateTime` 1–2 times. Each call constructs 4 `Intl.DateTimeFormat` objects: 2× `yearIn`, 1× `datePart`, 1× time (`date.ts:3-32`).
    - `formatDate` once, eagerly, in `ListTime`'s prop (`review-list.tsx:67`). That is 3 more.
  - The list is unbounded: infinite scroll appends 50-row pages (`lib/contracts/reviews.ts:201`, `IntersectionObserver` at `review-list.tsx:224-236`), and there is no virtualisation.
  - The two `[selectedId, reviews]` effects (`review-list.tsx:154-178`) also re-run on every render, because `reviews` is a new array each time. Each run does a `querySelectorAll` and a `findIndex`.
- Recommendation:
  1. Add `useNowHour()`: `useSyncExternalStore(subscribeClock, () => Math.floor(readClock() / 3_600_000))`. A primitive snapshot that only changes hourly stops the 15 s re-render. Apply the same idea in `listings-board.tsx:408`, `listing-overview.tsx:208`, `area-cards.tsx:193`, `health-strip.tsx:114` and `area-frame.tsx:601`, wherever only a threshold matters.
  2. Cache `Intl.DateTimeFormat` instances in a module-level `Map` keyed by `timeZone` and options.
  3. Extract a `ReviewRow` component wrapped in `React.memo`, with props `(review, selected, isTabStop, checked, showControl, queue, timezone)` and stable callbacks: pass `onSelect(id)` and `selection.toggle` directly rather than inline lambdas. Memoise `reviews` with `useMemo(() => flattenReviews(data), [data])`.
  4. Alternative to 3: enable `reactCompiler: true` (stable in Next 16; `docs/.../reactCompiler.md`, needs `babel-plugin-react-compiler`). It auto-memoises across the app, but the build cost and behaviour change are app-wide.
  5. If sessions reach hundreds of rows, add windowing (e.g. `@tanstack/react-virtual`) or `content-visibility: auto` on rows. The roving tab-index and `focusRow` (`review-list.tsx:146-152`) would need to change to index-based scrolling.
  - Expected benefit: removes the periodic full-list re-render and most per-keystroke and per-click row work.
  - To measure: React Profiler "commit duration" on InboxView with 50/200/500 rows loaded, before and after; Chrome Performance panel long tasks on ArrowDown.
- Complexity: steps 1–2 **S**; step 3 **M**; step 5 **L**.
- Regression risk: **Low** for 1–2; **Medium** for 3 (keyboard roving and selection tests).
- Tests to add or verify:
  - `tests/components/review-list.test.tsx` (modified in the working tree)
  - A unit test that `useNowHour` doesn't notify within an hour
  - A `lib/format` formatter-cache test (same output)
- Dependencies: none.

### W5-03 The dashboard shell costs about 194 kB gzip on every authenticated route; phone-only sheets and rarely-opened shell UI are statically bundled

- Priority: **P2**
- Status: **CONFIRMED** for the size (build output); **PLAUSIBLE** for the split-out saving, which needs an analyzer to quantify
- Location:
  - `app/(dashboard)/layout.tsx:147-152` → `components/app-shell/app-shell.tsx:21-39` (static imports)
  - `app-shell.tsx:427-447` (`MoreSheet`, `ClientScopeSheet` mounted closed)
  - `components/app-shell/client-switcher.tsx:390` → `scope-sheet.tsx` (666 lines), `scope-sheet-model.tsx` (404 lines)
  - `more-sheet.tsx` (287 lines), `account-menu.tsx` (598 lines)
- Current implementation / Evidence / Root cause:
  - The `app/(dashboard)/layout` entry pulls 27 chunks totalling about 194 kB gzip (`.next/static/chunks/app/(dashboard)/layout-8e10b285d9e33121.js` is 76 kB raw by itself).
  - `MoreSheet` and `ClientScopeSheet` are phone-only (the comments in `useCloseAtDesk`, `app-shell.tsx:203-226`, close them at ≥768 px), yet they are imported statically and mounted (closed) on desktop too.
  - The command palette dialog and the switcher search are already dynamic, which shows the pattern works here.
- Recommendation:
  - Load `MoreSheet`, the `ClientScopeSheet` body (`scope-sheet.tsx`) and the account menu's popup content through `next/dynamic` with `ssr: false`. Mount them only after first open, or preload on pointer/focus intent the way `ShellLink` already does.
  - Keep the closed trigger buttons static.
  - Expected benefit: lower first-load JS and parse/compile time on every dashboard page, most noticeable on phones.
  - To measure: an analyzer treemap of `app/(dashboard)/layout` before and after.
- Complexity: **S–M**
- Regression risk: **Low–Medium.** Focus return when a sheet first opens, and the `finalFocus`/handoff logic (`app-shell.tsx:331-345`).
- Tests to add or verify: the touch-390 e2e project (`pnpm test:e2e:touch`) More-sheet and client-scope flows; a11y spec.
- Dependencies: none.

### W5-04 Large, rarely-opened dialogs and sheets are statically bundled into heavy routes

- Priority: **P2**
- Status: **CONFIRMED** (static imports read; per-dialog byte share not measured)
- Location:
  - Inbox: `components/inbox/bulk-action-bar.tsx:14,110` statically imports `TemplateReplyDialog` (555 lines). The bulk bar is statically imported by `inbox-view.tsx`.
  - Posts: `components/locations/posts-tab.tsx:11,272` and `posts-action-bar.tsx:25,33` import `PostComposerSheet` (1,112 lines) and `SchedulePostSheet` (757 lines).
  - Photos: `components/locations/photos/photos-library.tsx` imports `AddPhotoDialog`; `photos-grid.tsx` imports `DeletePhotoDialog` and `PhotoPreview`.
  - Setup: `components/setup/setup-wizard.tsx:41-48` imports all 8 steps statically. `app/(dashboard)/setup/page.tsx:10` imports the wizard even on the no-client "pick a client" branch (`:121-160`), which renders no wizard.
- Current implementation / Evidence / Root cause:
  - The inbox page entry chunk is 189 kB raw / 59 kB gzip, setup 199 kB / 54 kB, posts 105 kB / 32 kB (sizes from `.next/static/chunks/app`).
  - These dialogs only render after a user action: bulk select, "New post", "Add media".
- Recommendation:
  - Use `next/dynamic` for `TemplateReplyDialog`, `PostComposerSheet`, `SchedulePostSheet` and `AddPhotoDialog`. Render them only when open, or prefetch on hover/focus of their trigger.
  - Split setup steps with `dynamic()` per step, so only the current step loads.
  - Expected benefit: smaller page chunks on the heaviest routes (inbox, setup, posts).
  - To measure: an analyzer per-route diff.
- Complexity: **S** per dialog.
- Regression risk: **Low.** Watch the first-open delay; provide a spinner fallback, and preload on intent.
- Tests to add or verify: the existing component tests that open these dialogs must `await` the lazy import (`findBy*`).
- Dependencies: none.

### W5-05 The listings board recomputes everything on each keystroke and clock tick: O(clients × rows) chip counts, unwindowed rows, an unbounded directory

- Priority: **P2**
- Status: **CONFIRMED** for the code path; scale impact is a **HYPOTHESIS** (needs production row counts)
- Location:
  - `components/listings/listings-board.tsx:408` (`useNow()`, a 15 s re-render)
  - `:486-489` (`setSearch` sets state and writes the URL on every keystroke, no debounce)
  - `:524-640` (rows map; filter/sort chain; `clientChips` does `rows.filter(...)` per client at `:603-617`; `visibleIds`)
  - `lib/server/location-directory.ts:16-48` (no `limit`)
  - `app/(dashboard)/layout.tsx:66-140` (the directory and client list are hydrated into every full dashboard load)
- Current implementation / Evidence / Root cause:
  - Nothing is memoised. Every keystroke rebuilds all rows, re-filters, re-sorts and recomputes per-client counts in O(C·R), then re-renders every row.
  - Combined with W5-01, every keystroke is also a server round trip.
  - The location directory and the client list are fetched without a cap and serialised into the RSC payload of every full dashboard load.
- Recommendation:
  - Wrap the derivations in `useMemo` keyed by `[directory.data, summaries.data, search, health, clientFilter, order]`.
  - Compute chip counts in one pass with a `Map<clientId, count>`.
  - Use `useDeferredValue(search)` for filtering.
  - Debounce the URL write (or use the history API, per W5-01).
  - Swap `useNow()` for an hour/threshold selector (W5-02).
  - If agencies exceed about 300 listings, add windowing. The backend could also page the directory, though the sidebar only needs clients.
  - Expected benefit: smooth typing on large agencies.
  - To measure: Profiler while typing in the search with a seeded 500-location org.
- Complexity: **S** (memo and single pass), **M** (windowing)
- Regression risk: **Low**
- Tests to add or verify: the listings-board component tests (filter, sort, chip counts).
- Dependencies: W-backend/W-DB for actual location counts per org.

### W5-06 Reviewer avatars in the inbox list load eagerly via Base UI `Avatar.Image`, bypassing lazy loading and adding layout-effect re-renders per row

- Priority: **P2**
- Status: **CONFIRMED**
- Location:
  - `components/inbox/review-avatar.tsx:52-53` (`<AvatarImage src={photoUrl} referrerPolicy="no-referrer" />`), rendered per row from `review-list.tsx` (`leading`)
  - `node_modules/@base-ui/react/avatar/image/useImageLoadingStatus.mjs:14-50`
- Current implementation / Evidence / Root cause:
  - Base UI preloads each `src` with `new window.Image()` inside `useIsoLayoutEffect`, then calls `setLoadingStatus('loading')` and `'loaded'`.
  - So every row's avatar is downloaded as soon as the row mounts, whatever its viewport position; `loading="lazy"` can't apply.
  - Each avatar also does a synchronous layout-phase state update.
  - With infinite scroll, every appended page fires up to 50 Google CDN requests at once.
  - By contrast, the media thumbnails correctly use `loading="lazy"` and fixed aspect boxes (`review-detail.tsx:563-568`, `media-card.tsx:110-115`, `post-card.tsx:74-78`).
- Recommendation:
  - For list rows, render a plain `<img loading="lazy" decoding="async" width/height>` with an `onError` fallback to initials, instead of `Avatar.Image`.
  - Alternatively, mount `AvatarImage` only once the row is near the viewport.
  - Keep Base UI Avatar for the single detail-pane avatar.
  - Expected benefit: fewer image requests and less main-thread work when a page of rows appends.
  - To measure: DevTools Network count of `googleusercontent` requests on first inbox load; Performance panel during "load more".
- Complexity: **S**
- Regression risk: **Low**
- Tests to add or verify: review-list avatar fallback test; the CSP remote-thumbnail e2e mentioned in `next.config.ts:9-16`.
- Dependencies: none.

### W5-07 Google-backed tab queries refetch on window focus after 30 s (each refetch is a live Google read of several seconds); the shell runs five independent 60 s polls

- Priority: **P2** (front-end cost; backend and quota impact goes to W-integrations)
- Status: **CONFIRMED** (config read; request counts not measured)
- Location:
  - `lib/queries/query-client.ts:6-9` (`staleTime: 30_000`, `refetchOnWindowFocus: true` as global defaults)
  - Hooks with no override: `lib/queries/use-location-hours.ts:11`, `use-location-profile.ts:11`, `use-location-menu.ts:11`, `use-location-booking.ts:10`, `use-location-media.ts:39`, `use-location-posts.ts:29`, `use-location-business-information.ts:16,24`
  - Shell polls: `lib/queries/use-clients.ts:28`, `use-connections-query.ts:19`, `use-connection-health.ts:28`, `components/app-shell/use-needs-reply-count.ts:25`, `components/app-shell/notifications-link.tsx:28` (all `refetchInterval: 60_000`)
- Current implementation / Evidence / Root cause:
  - `docs/architecture.md:1360-1366` notes that Google-backed tabs "read live and cost 3-5s per request".
  - With the global defaults, an operator who alt-tabs away for more than 30 s and returns triggers a live Google read for every mounted Google-backed query.
  - The shell's five polls are not aligned, so an idle visible tab makes about 5 API requests a minute. Each one goes through `getSession()` and its `UPDATE` (see W5-01).
  - TanStack pauses intervals while the document is hidden (the `refetchIntervalInBackground` default is false), so hidden tabs are fine.
- Recommendation:
  - Give Google-backed resource hooks a longer `staleTime` (e.g. 5 min) and `refetchOnWindowFocus: false`, relying on explicit invalidation after writes. `useResourceMutation` already invalidates through `queryKeys`.
  - Consolidate the shell polls into one `/api/shell-status` query, or stagger them.
  - Expected benefit: fewer Google calls, fewer spinners and less flicker on focus.
  - To measure: count `/api/locations/*` requests per focus event; OTel Google-call counters.
- Complexity: **S**
- Regression risk: **Low–Medium** (data freshness expectations; check that editors don't reseed on background refetch)
- Tests to add or verify: a query-defaults unit test per hook.
- Dependencies: W-integrations (Google quota), W-backend (session write per request).

### W5-08 The every-route CSS bundle is 236 kB raw / 37.7 kB gzip, and the Tailwind scan includes about 4,000 lines of design-system demo source

- Priority: **P3**
- Status: **PLAUSIBLE** (size confirmed; the design-system share is a hypothesis)
- Location: `app/globals.css:1-7` (`@source "./"` covers all of `app/`, including `app/design-system/*`, 14 files and 3,970 lines); `.next/static/css/9f0527327c664ef7.css`
- Current implementation / Evidence / Root cause:
  - One render-blocking stylesheet serves every route, including the sign-in, legal and share pages.
  - The `/design-system` route is gated by `DESIGN_SYSTEM_EVIDENCE_ENABLED` (`app/design-system/page.tsx:484-487`), but its classes are still compiled into the production CSS.
- Recommendation: add `@source not "./design-system";` (Tailwind v4 syntax) when the evidence flag is off, or move the demos outside `app/`. Measure by diffing the CSS size in a worktree build.
- Complexity: **S**
- Regression risk: **Low.** The design-system page would lose its styles unless built with the scan enabled; document that.
- Tests to add or verify: `pnpm check:design`; visual check of `/design-system` in evidence builds.
- Dependencies: none.

### W5-09 Unused runtime dependencies and unreferenced public assets

- Priority: **P3**
- Status: **CONFIRMED**
- Location:
  - `package.json` dependencies with zero import sites in `app/`, `components/`, `lib/`, `tests/` and `scripts/`:
    - `recharts`
    - `embla-carousel-react`
    - `react-day-picker`
    - `input-otp`
    - `react-resizable-panels`
    - `geist`
    - `date-fns` (kept only as an _optional_ peer of `@base-ui/react@1.9.0`)
  - Public assets:
    - `public/brand/concepts/naba-presence-identity-board-v1.png` (1.32 MB, no references)
    - `public/fonts/jetbrains-mono/JetBrainsMono[wght].ttf` and `JetBrainsMono-Italic[wght].ttf` (187 + 192 kB; only the README mentions them, and `app/layout.tsx:21-44` now uses the WOFF2 subsets)
- Current implementation / Evidence / Root cause:
  - These packages aren't in client bundles because they're tree-unused, so there's no bundle cost.
  - The cost is install time, supply-chain surface and confusion; the shadcn scaffold left them behind.
  - The 2026-10-13 mobile audit's font finding (preloaded TTFs) is fixed: only the upright WOFF2 subset is preloaded (`app/layout.tsx:21-30`, `.next/static/media/25033a4dc0627793.p.woff2`).
- Recommendation: remove the unused packages in a dedicated dependency PR; the user's rules forbid changing dependencies unasked. Move the identity board PNG out of `public/` (it is publicly served) and keep the TTF masters outside `public/`.
- Complexity: **S**
- Regression risk: **Low**
- Tests to add or verify: `pnpm build` and `pnpm typecheck` after removal.
- Dependencies: owner approval for dependency changes.

### W5-10 `formatDateTime`/`formatDate` construct `Intl` formatters per call across the app

- Priority: **P3** (the hot inbox case is covered by W5-02)
- Status: **CONFIRMED**
- Location: `lib/format/date.ts:3-32`. There are 33 `new Intl.DateTimeFormat|NumberFormat|RelativeTimeFormat` sites in `lib` and `components`, and `formatRelativeTime` at `date.ts:57` builds a new `RelativeTimeFormat` per call.
- Recommendation: one module-level memoised `getFormatter(locale, options)` helper used by every site.
- Complexity: **S**
- Regression risk: **Low**
- Tests to add or verify: the existing `lib/format` tests.
- Dependencies: none.

### W5-11 Some `"use client"` files have no client behaviour and could be server components

- Priority: **P3**
- Status: **PLAUSIBLE.** A heuristic found no hooks, handlers, `window` or Base UI usage; I did not check each file's importers.
- Location:
  - `components/share/shared-client-report.tsx` (249 lines, on the public share page)
  - `components/locations/administration/verification-observation.tsx` (183)
  - `components/ui/chart.tsx` (148)
  - `components/setup/step-done.tsx` (139)
  - `components/inbox/activity-timeline.tsx` (100)
  - `components/locations/administration/admins-table.tsx` (88)
  - `components/locations/section-panel.tsx` (82)
  - `components/locations/profile/profile-unreachable.tsx` (76)
- Current implementation / Evidence / Root cause: 337 of 413 component files are client modules. Most legitimately need client behaviour; these candidates don't appear to.
- Recommendation: drop `"use client"` where every importer is a server component. Where importers are client components, the directive is redundant but harmless.
  - The share page is the best candidate: it is already small (~172 kB first load), but making it server-only removes hydration for an external, unauthenticated audience.
- Complexity: **S**
- Regression risk: **Low.** Watch for non-serialisable props.
- Tests to add or verify: the share-report e2e.
- Dependencies: none.

### Already good (brief)

- **Loading coverage:** `app/(dashboard)/loading.tsx` covers every dashboard page, with segment-specific skeletons for inbox, clients, listings/[id], reports, settings, setup and team.
- **Streaming:** Google-backed listing tabs stream behind `StreamedTab` while the DB-only data is awaited (e.g. `app/(dashboard)/listings/[id]/hours/page.tsx:27-45`).
- **Layout reads:** the dashboard layout's five reads run in parallel (`layout.tsx:66-75`).
- **Link prefetch:** links are intent-gated (`components/app-shell/shell-link.tsx:6-42`), so shell links don't viewport-prefetch dynamic pages.
- **Context providers:** values are memoised (`page-chrome.tsx:73-81`, `client-context.tsx:81`, `selection-context.tsx:48`); the dirty store is a stable instance (`dirty-context.tsx:105`).
- **Composer typing:** draft state is local to `ReplyComposer` (`reply-composer.tsx:109,616-618`), so typing doesn't re-render the inbox.
- **Memory hygiene:**
  - Object URLs are revoked (`add-photo-dialog.tsx:104-107,177`; `privacy-export-form.tsx:44-51`; `lib/reporting/csv.ts:36-62`).
  - Intervals are cleared (`billing-confirming.tsx:64-68`, `bulk-operation-view.tsx:622-623`).
  - The shared clock stops when it has no subscribers (`lib/time/clock.ts:12-24`).
  - Media-query listeners are removed (`lib/hooks/use-media-query.ts:54-56`).
  - Query `gcTime` is the default 5 min, which is reasonable.
- **Rendering mode:** everything authenticated is dynamic, as expected (cookies). Legal pages are `force-static`. No `unstable_cache`/`"use cache"` is used, which is appropriate for per-tenant data.

---

## Top 5 for this workstream

1. **W5-01 (P1):** switch client-only URL state from `router.replace`/`push` to `window.history.replaceState`/`pushState`. This likely removes an RSC round trip and its DB reads, including an `app_session` UPDATE, on every inbox row click and every listings-search keystroke. Verify first with the `_rsc` network filter.
2. **W5-02 (P1):** stop `InboxView` re-rendering every 15 s (an hour-granular `useNow` selector), cache `Intl` formatters, and memoise review rows. Consider windowing for long sessions.
3. **W5-03/W5-04 (P2):** lazy-load the phone-only shell sheets and the large on-demand dialogs (template reply, post composer, schedule sheet, add photo, setup steps). The dashboard shell alone is about 194 kB gzip on every route.
4. **W5-07 (P2):** stop focus-triggered live Google reads (longer `staleTime`, no `refetchOnWindowFocus` on Google-backed hooks) and consolidate the five 60 s shell polls.
5. **W5-06/W5-05 (P2):** lazy reviewer avatars instead of Base UI eager preload; memoise and debounce the listings board.

## Cross-layer leads for other workstreams

- **W-backend / DB:** `getSession()` issues `UPDATE app_session SET last_seen_at, expires_at` on every request (`lib/server/session.ts:216-230`). Throttle it, e.g. only when `last_seen_at < now() - 1 min`. Every poll, RSC navigation and API call writes today.
- **W-security:** the dashboard layout passes the full server `Session`, including `sessionId`, `access` and `entitlementEnforced`, as a client prop (`app/(dashboard)/layout.tsx:148-149`; type at `components/app-shell/app-shell.tsx:44-57`). It is serialised into the RSC payload/HTML, contrary to the intent stated at `layout.tsx:110-116`. `sessionId` is not the bearer credential (lookup is by token hash, `lib/server/session.ts:127-154`), so this is low risk, but trim it to the display fields.
- **W-backend / DB scale:** `listLocationDirectoryRows` (`lib/server/location-directory.ts:16-48`) and `listClientSummaries` (`lib/server/clients.ts:111`) have no limit and run on every full dashboard load (`app/(dashboard)/layout.tsx:66-75`).
- **W-integrations:** Google-backed reads triggered by focus refetch (W5-07): `lib/queries/query-client.ts:6-9` plus the `lib/queries/use-location-*.ts` hooks.
- **W-backend:** the inbox server prefetch re-reads the review detail that `useReviewDetail` fetches concurrently when a selection change goes through the router (`lib/server/prefetch.ts:381-388`, `app/(dashboard)/inbox/page.tsx:38-41`).
- **W-docs:** the comments in `app/(dashboard)/inbox/page.tsx:16-22` and `app/(dashboard)/listings/page.tsx:10-12` claim the page segment is reused when only the query changes. Next 16's `segment-cache/vary-path.js:68-69` says page segments vary by search string. Correct the comments once W5-01 is verified.
- **W-tooling:** no bundle-size budget or analyzer exists in CI (`docs/ci.md`; no `@next/bundle-analyzer` in `package.json`). Add a size check on `.next/static/chunks/app/**` page and layout entries.
