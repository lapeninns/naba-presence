# R2-V2 — Adversarial verification of W3-01..04, W5-01/02, W6-05, and the W3/W0-03 contradiction

Read-only. Re-traced from source at HEAD plus the working tree (`feat/inbox-mail-refinement`). The relevant inbox lines are unchanged from HEAD. Next.js is **16.3.8**. `next.config.ts` sets no `experimental`, `cacheComponents` or `staleTimes`.

| ID          | Verdict                                                                        | Priority           |
| ----------- | ------------------------------------------------------------------------------ | ------------------ |
| W3-01       | PARTIALLY CONFIRMED (mechanics are exact, but realistic frequency is low)      | P1 → **P2**        |
| W3-02       | CONFIRMED                                                                      | P1 (keep)          |
| W3-03       | CONFIRMED (correct the count's composition)                                    | P1 (keep)          |
| W3-04       | CONFIRMED, including credits charged without a draft                           | P1 (keep)          |
| W5-01       | CONFIRMED. The pages' own comments are wrong about Next 16.                    | P1 (keep)          |
| W5-02       | CONFIRMED                                                                      | P2 (W5 said P1/P2) |
| W6-05       | CONFIRMED                                                                      | P2 (keep)          |
| W3 vs W0-03 | **Both are partly right.** No data txn spans Google, but a lock-only txn does. | W0-03 P1 stands    |

## W3-01 — discovery GETs

- **Mechanics confirmed.** In `app/api/google/accounts/route.ts:73-155`, GET runs `discoverAccounts` (pages until there is no `nextPageToken`) and then makes one `insert … on conflict do update` per account inside one `tenant` txn (`:110-151`). `app/api/google/locations/route.ts:47-…` loops every active account × every page, then upserts one row per location. Neither route has `maxDuration` (grep shows none in either file) or `limits:` (no abuse limit). Google I/O stays outside the txns (comments at accounts `:102-104` and locations `:83-86`).
- **Hook defaults confirmed.** In `lib/queries/query-client.ts:7-9`: `staleTime: 30_000`, `retry: 1`, `refetchOnWindowFocus: true`. `use-google-accounts.ts:18-21` and `use-google-locations.ts:10-14` add no overrides.
- **Where the hooks mount:**
  - `/settings/connections`: `NotificationsCard`, when a connection exists (`connections-workspace.tsx:99`, `notifications-card.tsx:73`).
  - Setup step-account: `AccountPickerCard` (`step-account.tsx:40`, `account-picker-card.tsx:57`).
  - Setup step-locations: `ImportCard` and `OnboardingDrafts` (`step-locations.tsx:34-35`). They share one key, so the request is deduped. `useGoogleLocations` is used only in `import-card.tsx:72`.
  - Routes are owner/admin-only.
- **How often they realistically fire:** once per visit to those screens, plus once per tab-refocus after 30 s, plus one retry on failure. Only a few admins see these screens, and they are not on any daily path. Each call is heavy, but calls are rare. **P2.** Fix with `staleTime: Infinity`, `refetchOnWindowFocus: false`, and an explicit "Rediscover" action.

## W3-02 — editor GETs read Google live

- **Hours.** `readHoursResponse` → `getHoursState` (`hours.ts:262`) → `readLiveHours` (`:125-257`). The steps are:
  1. The linked-location txn (`:98`).
  2. A token.
  3. A live Google read (`:132`), plus a categories call (`:153`).
  4. `ensureCanonicalResource` txn (`:186`).
  5. `recordHoursObservation` txn (`:213`). This is a **row write on every read**.
  6. The latest-attempt txn (`:266`).

  That is 4 tenant txns plus the token lookup. "≥5" holds if the token refresh path counts. There is no freshness gate.

- **Profile.** `getProfileState` (`profile.ts:242`) → live `fetchGoogleProfile` (`:201`), `persistObservedFields` (writes), an observation txn, and a latest-attempt txn. There is no gate.
- **Posts.** `listLocalPosts` (`posts.ts:703-711`) runs `reconcileLocalPosts` (a live Google list plus a txn) on every first page. There is no gate.
- **Place actions.** `loadPlaceActions` (`place-actions.ts:114-115`) makes a live metadata call on every load.
- **Media is the only one gated:** `shouldSyncMediaCache` (`media.ts:318-328`, TTL plus `refresh=1`).
- No short-circuit was found. **CONFIRMED.**

## W3-03 — ZodError → 400 with no log

- In `lib/server/http.ts:139-150`, the `ZodError` branch returns `400 invalid_request` with `details: error.issues` and **no log**. Only unknown errors are logged (`:151` `log.error("api.unhandled_error")`).
- `route.ts:387-398` parses params, query and body with the same `.parse()`. Input validation and internal invariants are therefore indistinguishable at `mapError`.
- **Count:** `grep -oE "[a-zA-Z]Schema\.parse\("` finds **89 in `lib/server`** and 33 more in `app/api`. Correction: these are not all invariants. Some are deliberate in-handler input parses, for example `backfillStartSchema.parse` at `sync/backfill/route.ts:104`. Most are provider or stored data, for example:
  - `google/locations.ts:298` (Google response)
  - `password-auth.ts:145`, `:215`, `:314`, `:559`, `:604`, `:622` (auth-provider payloads)
  - `publication-schedules.ts:212`, `:238` (DB rows)
- Echoing `issues` to the client is a minor information leak. **P1 stands**, because silent mis-attribution hides provider contract drift.

## W3-04 — long synchronous work

- **Manual backfill.** `sync/backfill/route.ts:127-138` runs up to 50 locations (`contracts/sync.ts:43`) × up to 20 pages, sequentially, under `maxDuration = 60` (`:20`). It passes no `deadline`, although `syncLinkedLocation` accepts one (`reviews.ts:455-456`). **Confirmed.**
- **Bulk approve without the bulk engine.** `reviews/bulk/route.ts:103-113` runs a sequential `approveRow` → `completeApproval` (publish) for up to 100 approvals (`contracts/reviews.ts:557`), under `maxDuration = 120` (`:30`). It has no budget check. **Confirmed.**
- **AI draft.** `reviews/[id]/drafts/route.ts:8` sets `maxDuration = 60`. `OPENAI_TIMEOUT_MS` defaults to 30 000 and is capped at 55 000 (`env.ts:241-246`). In `review-drafts.ts` the order is:
  1. Phase 1 reserves the credit (`:286`).
  2. `generateReply`, the first OpenAI call (`:347`).
  3. **`settleDraftCredit` commits the charge (`:369-376`).**
  4. `runSemanticVerification`, the second OpenAI call (`:387`).
  5. Phase 3 inserts the draft (`:417-438`).

  If the function is killed during step 4 or before step 5, the customer **is charged and gets no draft**. A same-key retry returns `generation_in_progress` for 120 s and then `generation_not_repeatable` (`:128-131`, `:196-212`). There is no refund path. The comment at `:367-368` makes the charge-first ordering deliberate, but it does not cover the timeout case. **Confirmed.**

## W5-01 — query-string navigation makes an RSC round trip

- **Call sites:**
  - `inbox-view.tsx:212-213` (`updateState`: push/replace)
  - `inbox-view.tsx:314` (clear filters)
  - `inbox-view.tsx:404` (auto-select on load)
  - `listings-board.tsx:482-484` (`writeUrl`)
- **What Next 16.3.8 does:**
  - The page segment key always embeds the search, whether or not the page reads `searchParams`: `shared/lib/segment.js:61-68` (`addSearchParamsIfPageSegment`), used by `server/app-render/create-flight-router-state-from-loader-tree.js:30` and `client/route-params.js:187`.
  - In `client/components/router-reducer/ppr-navigations.js:158-176`: _"A search-param-only change is treated as a refresh of the page segment"_ (`segmentMatchKind === 2`). The node goes through `createCacheNodeForSegment`. That function only reuses data via BFCache when `staleTimes.dynamic` is configured (`:558-573`), and the default is `dynamic: 0` (`server/config-shared.js:260-261`).
  - `varyParams` defaults to true (`config-shared.js:207`), but it only shapes cache keys for cached and prefetched segments. It does not skip the dynamic request.
- **Both pages are dynamic.** `getSession()` reads `cookies()` (`session.ts:246`), and the inbox also calls `headers()` via `requestSearch()`.
- **Consequence:** every inbox filter change, row selection and the load-time auto-select re-runs `InboxPage` on the server. That includes `prefetch(session, inboxPrefetch(search))`, which runs DB queries for list, counts and the selected review (`inbox/page.tsx:30-40`), duplicating the client's own fetch. On listings it re-runs `getSession` and `bulkActionsEnabled`.
- The comments at `inbox/page.tsx:16-22` and `listings/page.tsx:11-12` ("Next tracks which segments read searchParams") are **incorrect** for this version.
- **Debounce:** listings search is **un-debounced**. `setSearch` → `writeUrl` runs on every keystroke (`listings-board.tsx:486-489`, `:808`), and the `components/ui/toolbar.tsx:142` toolbar calls `onSearchChange` directly. Inbox search _is_ debounced (`inbox-toolbar.tsx:107`, `:194`; draft hook).
- **Fix:** `window.history.replaceState`/`pushState`, which Next 14.1+ syncs with `useSearchParams`. **P1.**

## W5-02 — 15 s clock re-renders the inbox

- `inbox-view.tsx:139`: `const hour = Math.floor(useNow() / 3_600_000)`.
- `useNow` is a `useSyncExternalStore` over `lib/time/clock.ts`, which ticks every 15 s (`TICK_MS = 15_000`, `:7`). `readClock` returns a new value each tick (`:62-66`), so the whole `InboxView` re-renders every 15 s even though only `hour` is used.
- `components/inbox/` contains no `memo(`, and there is no React Compiler, so `ReviewList` (`:595`), `InboxToolbar` (`:753`) and `ReviewDetail` (`:875`) and all their rows re-render with it.
- **Fix:** an hour-granular subscription. **Confirmed.** Cost scales with loaded rows. **P2**, or P1 only if long scroll sessions are common.

## W6-05 — /auth/confirm

- `app/auth/confirm/route.ts:18-52`: a plain GET with `type=email` calls `verifyEmailToken` (provider `/verify`, which consumes the single-use token, `password-auth.ts:309-315`) and then `completeEmailAuthentication`. That sets the session or MFA-ticket cookie and redirects to `/inbox`.
- There is no interstitial and no POST. Only `type=recovery` goes to an interstitial (`/reset-password`, `:31-35`). `proxy.ts`/`middleware.ts` do not intercept the route.
- The only gate is the per-IP abuse budget (`:24`).
- **Login CSRF:** an attacker who registers gets a fresh confirmation link that signs any victim browser into the attacker's org.
- **Link-scanner burn:** a mail scanner that pre-fetches the link consumes the token, and the user then sees `invalid_email_link`.
- **Confirmed. P2** is right.

## Contradiction: W3 ("Google outside DB txns") vs W0-03 ("txn held across Google")

**W0-03 is right on substance. W3 is right only about data txns.**

- `publishProfileToGoogle` (`profile.ts:640-647`), `publishCanonicalHours` (`hours.ts:737-742`) and food menus (`food-menus.ts:460-463`) all follow the same pattern: `withSessionConnection(c => c.begin(async lock => { pg_advisory_xact_lock(...); <live Google read → validateOnly → PATCH → readback> }))`.
- The same pattern appears in `business-information.ts:203`, `:216` and `:510`, `industry-management.ts:68` and `:119`, `google-account-change-lock.ts:9` and `bulk-listing-runner.ts:384`.
- So a BEGIN'd transaction, holding only the advisory lock and touching no rows, sits idle-in-transaction on a dedicated session-pooler connection for the whole provider round trip. The inner data writes use separate pooled `withTenant` txns, which is what W3 saw.
- The dedicated client (`db.ts:62-77`) sets **no** `statement_timeout` or `idle_in_transaction_session_timeout`. The pooled client sets 30 s and 60 s (`db.ts:38-43`).
- Risk: holding a session-pooler slot, and the lock lingers if the function is frozen or killed.
- **W3's "kept outside DB transactions" claim should be narrowed to "outside data/RLS transactions".**
