# W2: React hooks, state management and component lifecycle

**Workstream:** W2 (custom hooks, contexts and providers, client stores, URL state, draft stashes, dirty and leave guards, hydration, lifecycle-heavy components).
**Audited:** 2026-10-14 against HEAD `d8759c74` plus the working tree as it stands. The working tree includes the user's uncommitted `components/inbox/*` and `lib/inbox/layout.ts` edits. Nothing was modified.

## Scope covered

- All 188 custom hook definitions in `app/`, `components/` and `lib/` (`export function use…`, `function use…`, `export const use… =`), plus their consumer counts.
- `lib/hooks/*`, `lib/editors/use-*`, `lib/api/draft-stash.ts`, `lib/workspace/mode.ts`, `lib/time/*`, `lib/queries/scope-reset.ts`, `lib/queries/provider.tsx` and `lib/queries/keys.ts` (the scoping contract).
- All 34 `createContext` sites and their provider values.
- URL state: `lib/inbox/url-state.ts` usage in `inbox-view.tsx`, `review-filters.tsx`, `listings-board.tsx` and `clients-index-search.ts`.
- Unsaved-changes plumbing: `useDirtyGuard`, `useLeaveGuard`, `useGuardedRouter`, `useCloseGuard`, `useEditorDraft`, the inbox `DirtyGuardProvider`, `DraftNotices`, and every editor that wires them.
- Lifecycle-heavy components: `InboxViewInner`, `ReviewList`, `ReplyComposer`, `ProfileEditor`, onboarding `DraftDetails`, `ListingsBoard`, `ClientDetailsForm`, `PolicyForm`, the administration and profile "workspace" contexts, and the reviewed-write hooks.
- Timers, listeners, observers and AbortControllers in client code. Each one was checked for cleanup.
- ESLint `react-hooks` configuration, and whether React Compiler is present.

## Commands run (all read-only)

- `rg`/`grep`/`sed` sweeps: hook definitions, `createContext`, `eslint-disable`, `useEffect`/`useLayoutEffect` counts, `setTimeout`/`setInterval`/`requestAnimationFrame`, `router.push|back`, `useGuardedRouter`, `queryKey: [` literals, `useState(<prop>.…)` seeding, `React.memo`/`memo(` (zero hits), `useEffectEvent` (one hit), `getQueryCache().subscribe`, and `history.length` in tests.
- A shell loop to count each hook's consumers: `rg -l "\bHOOK\("` over app, components and lib, excluding the defining file (`/tmp/w2-hook-consumers.tsv`).
- Node scripts (in `/tmp`, outside the repo) ranking files and components by hook calls, `useState`, effects, refs and memo/callback counts.
- Resolved eslint-config-next 16.3.8 → eslint-plugin-react-hooks **7.1.1**. Printed `configs.recommended.rules`.
- `pnpm exec eslint --max-warnings 0 components lib app` exited clean in about 25 s.
- Two `pnpm exec eslint --stdin` probes, with no file written:
  1. A minimal component calling `setS(v)` inside `useEffect` **is** flagged by `react-hooks/set-state-in-effect`.
  2. `components/inbox/reply-composer.tsx`, piped through stdin, is **not** flagged, even though it calls `setBody` synchronously in an effect at lines 153 and 169.
- `git` was not used beyond the status the harness supplied. Nothing was installed, built or run against a server.

## Not covered, and why

- **Runtime behaviour.** No browser session, React Profiler or test run, as this was a read-only static audit. Findings that depend on React's commit and batching order or on navigation latency are marked PLAUSIBLE, with the measurement each one needs.
- **React Compiler bail-out list.** Listing which components the compiler skips needs `babel-plugin-react-compiler` or `react-compiler-healthcheck`, and neither is installed. I did not install them.
- **Vendored primitives.** `components/ui/*` internals were sampled, not fully reviewed: field, overlay, sheet, select, dropdown-menu and toast.
- **`app/design-system/*`.** Excluded from the complexity ranking as a demo surface.
- **Data-fetching correctness inside `lib/api/*` and the server.** That belongs to other workstreams. Only cache-key and scoping effects on client state are covered here.

---

## Configuration facts (for every finding below)

- **No React Compiler.** `next.config.ts` has no `reactCompiler`, and there is no babel config and no `babel-plugin-react-compiler` dependency.
- **No `React.memo` or `memo(` anywhere** in app, components or lib. So `useCallback`/`useMemo` only matter where they feed a dependency array, a context value, or a `useSyncExternalStore` `subscribe`.
- **Lint.** `eslint.config.mjs` spreads `eslint-config-next/core-web-vitals`. That brings in react-hooks 7.1.1 recommended:
  - `rules-of-hooks: error`
  - `exhaustive-deps: warn`, which is effectively blocking under `lint`'s `--max-warnings 0`
  - compiler-backed rules at `error`: `set-state-in-effect`, `refs`, `purity`, `immutability`, `set-state-in-render`, `preserve-manual-memoization`, `static-components`, `use-memo`, `globals`, `error-boundaries`, `config`, `gating`
  - `incompatible-library` and `unsupported-syntax` at `warn`
- **`eslint-disable` for react-hooks: 2 in total, both justified.**
  - `components/settings/oauth-return.tsx:196`: a one-shot handling of an OAuth URL result keyed on `identity`. `next`, `params`, `router`, `toast` and `onConnectionsPage` are read on purpose without being triggers.
  - `components/ui/sheet.tsx:310`: `hasBack` is read on the run `page` changes in, not as a trigger.
  - Both are textbook `useEffectEvent` cases. React 19.3 ships it, and the repo already uses it once, at `components/clients/clients-index-search.ts:37`.
  - All the other `eslint-disable` lines in scope are `@next/next/no-img-element` or `@typescript-eslint/no-unused-vars`.
- **Totals across 363 hook-using files:** 675 `useState`, 153 `useEffect`/`useLayoutEffect`, 194 `useRef`, 55 `useMemo`, 69 `useCallback`.

## Already good (no action)

- **`useEditorDraft`** (`lib/editors/use-editor-draft.ts:76-233`). It follows the server value during render, so there is no stale frame. It raises a conflict (`incoming`) instead of overwriting, has an owner check across identity switches, reads the stash only after hydration, and adopts on a missing-to-present revision. It is the strongest state hook in the repo and should become the single draft primitive (see W2-09).
- **`useLeaveGuard`** (`lib/editors/use-leave-guard.ts`). It intercepts links in the capture phase, and its back-button sentinel tolerates stale sentinels (`onPopState` lines 150-166). `__resetLeaveGuardForTests` is provided. It is heavily commented and covered by `tests/components/use-leave-guard.test.tsx`.
- **`useSyncExternalStore` used properly for external state.** `useHydrated`, `useDeadline`, `useNow` (shared 15 s ticker that stops when unsubscribed, `lib/time/clock.ts:12-24`), `DirtyStore`/`useIsDirty`, `EditorStatus` store, `useScopeReset` (with `notifyManager.batchCalls`).
- **No effect-driven fetching duplicates TanStack Query.** The only raw `fetch` in a component is the session bootstrap, `components/app-shell/app-shell.tsx:69-98`. It has an AbortController, a 5 s timeout, a `cancelled` flag and full cleanup.
- **Timers and listeners are cleaned up.** Checked: `review-detail.tsx:783-801`, `inbox-view.tsx:443-494`, `two-step-verification-card.tsx:81-100`, `share-report-dialog.tsx:191-241`, `bulk-operation-view.tsx:618-626`, `review-list.tsx:223-235`, `app-shell.tsx:200-218`, and `reviewed-write/panel.tsx:37`.
- **Hydration of time and counts is deliberate.** Server clock via `ServerNowContext` (`lib/time/server-now.tsx`). The counts gate in `inbox-view.tsx:152-162`. `useHydratedBreakpoint` for split-view decisions.
- **`useDebouncedSearchParam`** (`components/clients/clients-index-search.ts:20-70`). It is the correct debounced-URL pattern, keeping letters typed during an in-flight write. It is only used once (see W2-06).
- **The window `CustomEvent` command bus.** Seven inbox events in `lib/inbox/events.ts`, plus `OPEN_PALETTE_EVENT` and `MFA_STEP_UP_EVENT`. It is documented and deliberate. Each listener is added and removed in an effect. Acceptable as is.

---

## Findings

### W2-01 Inbox rebuilds `reviews` on every render, which re-runs its effects and memos on every render

- **Priority:** P1
- **Status:** CONFIRMED for the code path. PLAUSIBLE for the visible scroll jump, which needs a runtime check.
- **Location:**
  - `components/inbox/inbox-view.tsx:195` (`const reviews = flattenReviews(reviewsQuery.data)`); `lib/queries/use-reviews.ts:29-33` (`data.pages.flatMap(...)`, a new array every call)
  - Dependents in `inbox-view.tsx`:
    - `:201-205` `loadMore` (deps `[reviewsQuery]`, a new result object every render, as the comment at `:420-423` admits)
    - `:224-245` `applyClientScope` (deps include `reviews`)
    - `:354-386` `onAdjacentReview` (deps `reviews`, `reviewsQuery`)
    - `:392-409` the auto-select effect (deps `[reviewsReady, reviews, state, router, readIsDirty]`)
    - `:435-442` the ref-sync effect
    - `:665-710` the `hotkeyHandlers` `useMemo`
  - In `components/inbox/review-list.tsx`:
    - `:174-182` the "keep selected row in view" effect (deps `[selectedId, reviews]`)
    - `:223-235` the IntersectionObserver effect (deps `[onReachEnd]`, which receives `loadMore`)
- **Current implementation and evidence:**
  - `reviews` is a fresh array on every render of `InboxViewInner`, so every dependency array that lists it, or anything derived from it, changes every render.
  - The auto-select effect therefore runs after **every** commit. While the desktop URL has no `selected` and the list is ready, each rerender before the URL catches up calls `router.replace(...)` again. Rerender triggers include the counts query, the health query, `useHydrated` flipping, and the `isFetching` flip of a 60 s or focus refetch.
  - In `ReviewList`, `scrollIntoNearestScroller(row)` runs on every parent render, and it smooth-scrolls when the selected row is out of view (`review-list.tsx:596-617`). An operator who scrolls the list away from the open review is pulled back on the next background refetch. That includes `refetchOnWindowFocus: true` (`lib/queries/query-client.ts:9`) and the settling poll in `use-reviews.ts:20-25`, since `isListRefreshing` reads `isFetching`. This contradicts the effect's own comment ("without fighting intentional scroll").
  - The IntersectionObserver is disconnected and recreated on every render, because `loadMore` is never stable.
  - The `useMemo` and `useCallback` wrappers on `hotkeyHandlers`, `onAdjacentReview`, `applyClientScope` and `loadMore` therefore never return a cached value.
- **Root cause:** a derived array is not memoised, and the whole query result object is used as a dependency.
- **Recommendation:**
  1. Write `const reviews = useMemo(() => flattenReviews(reviewsQuery.data), [reviewsQuery.data])`. TanStack's structural sharing keeps `data` referentially stable across identical refetches. Alternatively, use `useInfiniteQuery({ select: (d) => d.pages.flatMap(p => p.items) })` in `useReviews`, which TanStack memoises.
  2. Destructure `{ fetchNextPage, hasNextPage, isFetchingNextPage }` and depend on those, not on `reviewsQuery`.
  3. In `ReviewList`, scroll only when `selectedId` actually changes. Compare against a previous-id ref, as the focus-restore effect at `:161-170` already does, so a new `reviews` identity alone never scrolls.
  4. Key the auto-select effect on `reviewsReady`, `state.selected` and `reviews[0]?.id`, not on the whole array.
- **Expected benefit:** no scroll jump on refetch, one `router.replace` per auto-select, a stable observer, and memos that do something.
- **Complexity:** S
- **Regression risk:** Low to Medium. Auto-select and advance-after-publish depend on these values, so the existing `tests/components/inbox-view.test.tsx` cases must stay green.
- **Tests to add:**
  - Rerender `InboxView` with identical query data, then assert `router.replace` is called once and `scrollBy` is not called again.
  - Simulate a refetch that changes nothing, then assert the observer is not recreated (spy on `IntersectionObserver`).
- **Dependencies:** none. The user's uncommitted inbox edits touch the same files, so land this after them.

### W2-02 The reply composer is "dirty" for one commit on every review that has a draft or live reply

- **Priority:** P1
- **Status:** CONFIRMED that `isDirty` is true on a commit. PLAUSIBLE for the downstream effects, which depend on React's batching order and need a runtime test.
- **Location:**
  - `components/inbox/reply-composer.tsx`:
    - `:109` `useState("")`
    - `:129` `isDirty = body !== seededBody`
    - `:146-171` seeding happens in a `useEffect`
    - `:230-237` `useRegisterDirtyGuard`
  - `components/inbox/dirty-context.tsx`:
    - `:111-116` the provider's `useSyncExternalStore` plus `useLeaveGuard({ when: isDirty })`
    - `:206-214` registration in an effect
  - `lib/editors/use-leave-guard.ts:208-216` `arm()` → `pushSentinel()` → `history.pushState`
  - `lib/hooks/use-dirty-guard.ts:108-122` arms `beforeunload` on `isDirty`
- **Current implementation and evidence:**
  - The first render in which `review` exists has `body === ""` and `seededBody === draftBody ?? liveBody` (not empty), so `isDirty` is `true`.
  - That commit's passive effects:
    1. `useDirtyGuard` adds a `beforeunload` listener.
    2. The seeding effect calls `setBody(next)`.
    3. `useRegisterDirtyGuard` publishes `{ isDirty: true }` to the store.
  - The store notifies `DirtyGuardProvider`, `ActionBar` and `ReviewDetail` through `useSyncExternalStore`.
  - In the batched render that follows, the store still reports `true`, because the composer's corrected registration only runs in the _next_ passive phase.
  - So the provider commits once with `when: true`. Its `useLeaveGuard` effect arms and calls `pushSentinel()`. That is `history.replaceState` plus `history.pushState`, unless the current entry is already a sentinel.
  - The next commit disarms, but `arm()`'s disarm deliberately leaves the sentinel in history (`:216-218`).
  - Selecting the next review uses `router.replace`, which overwrites the sentinel entry with the new URL, and the phantom-dirty cycle pushes a new one. The likely result is one extra history entry per review opened. The code worked to prevent exactly that: "walking a backlog of fifty reviews used to leave fifty history entries", per `inbox-view.tsx:289-292`.
  - Other effects: the Publish bar's `useIsDirty` flickers to true (Publish disabled for a frame), and the `beforeunload` listener is added and then removed.
  - `tests/components/inbox-leave-guard.test.tsx:21-49` uses a stub `Composer` with a fixed `dirty` prop, so this sequence is not tested.
- **Root cause:** state seeded from the server in an effect, so there is a frame with an unseeded value. `useEditorDraft` already solves this by adjusting state during render.
- **Recommendation:**
  - Seed during render: `const [seededFor, setSeededFor] = useState<string|null>(null); if (review && seededFor !== reviewId) { setSeededFor(reviewId); setBody(peekStashedDraft(key) ?? seededBody) }`. Take the stash in an effect or on "restore", because render-time reads must not consume it; `peekStashedDraft` exists for exactly this.
  - Or gate `isDirty` on `seededFor === reviewId`.
  - Better: move `ReplyComposer` onto `useEditorDraft<string>` with `revision = latestDraft?.id ?? reply?.updatedAt`. That deletes the three seeding refs (`:142-145`) and the hand-written "adopt newer draft" rule (`:163-170`), which `useEditorDraft` covers with `incoming`.
- **Expected benefit:** no phantom history entries, no Publish flicker, and one fewer bespoke draft engine.
- **Complexity:** S for the gate. M to migrate to `useEditorDraft`.
- **Regression risk:** Medium. The Undo-restore and adopt-newer-draft semantics in `reply-composer.tsx:284-306` must be preserved.
- **Tests to add:** mount the real `ReplyComposer` inside `DirtyGuardProvider`, with `useReviewDetail` returning a review that has a draft. Spy on `history.pushState`, then assert:
  - zero calls;
  - `useIsDirty()` is never observed as `true`;
  - no `beforeunload` listener is added.
- **Dependencies:** W2-07 and W2-09.

### W2-03 "Lint clean" does not mean the compiler-backed hook rules checked a component

- **Priority:** P2
- **Status:** CONFIRMED (probe).
- **Location:** `eslint.config.mjs:5-8` (react-hooks 7.1.1 via eslint-config-next); `components/inbox/reply-composer.tsx:146-171`.
- **Current implementation and evidence:**
  - A minimal `useEffect(() => { if (v) setS(v) }, [v])` piped through `pnpm exec eslint --stdin` is reported as `react-hooks/set-state-in-effect`.
  - The full `reply-composer.tsx`, piped the same way with the rule forced to `error`, reports nothing, although it calls `setBody` synchronously in an effect.
  - The compiler-based rules only analyse components the compiler can compile. Components it bails out of are skipped silently. Likely causes here are refs read during render or mutation patterns.
  - The biggest components (W2-01, W2-02, W2-09) are therefore the least protected by the rules the team relies on. `lib/locations/use-reset-on-revision.ts:15-19` cites `set-state-in-effect` as a design constraint, for example.
- **Recommendation:**
  - Run `react-compiler-healthcheck`, or `babel-plugin-react-compiler` with a `logger` in a one-off script (needs a dev dependency, so it was not done here), to list bail-outs.
  - Track that list as a metric and pay it down starting with the inbox and editors.
  - Optionally enable `reactCompiler: true` in `next.config.ts` (Next 16 supports it) once bail-outs are understood. That would also make the 124 manual memos unnecessary (W2-16).
- **Expected benefit:** the lint safety net covers the components that need it most.
- **Complexity:** S to measure. M to fix the bail-outs.
- **Regression risk:** Low.
- **Tests:** none. This is a CI metric.
- **Dependencies:** W2-16.

### W2-04 `usePassedDeadlines` only ever arms a timer for the first upcoming deadline

- **Priority:** P2
- **Status:** CONFIRMED.
- **Location:** `components/locations/administration/verification-saved-workflows.tsx:16-43` (`usePassedDeadlines`), consumed at `:79`.
- **Current implementation and evidence:**
  - `subscribe` computes `next = Math.min(...future deadlines)`, sets one `setTimeout(notify, next - now)`, and returns its cleanup.
  - `useSyncExternalStore` only resubscribes when the `subscribe` identity changes. It is memoised on `times`, which does not change when a deadline passes.
  - After the first timer fires and the component rerenders, no timer exists for the second deadline. Later deadlines only show as passed if some unrelated rerender happens.
  - Saved verification workflows can therefore keep showing as current or approvable after their approval has expired. The server is still the authority.
  - `lib/editors/use-deadline.ts:14-32` is correct because it handles a single deadline.
- **Recommendation:** re-arm inside the subscription.

  ```ts
  ;(notify) => {
    let t
    const arm = () => {
      const now = Date.now()
      const next = Math.min(...times.filter((x) => x > now))
      if (Number.isFinite(next))
        t = setTimeout(
          () => {
            notify()
            arm()
          },
          Math.min(2_147_483_647, next - now)
        )
    }
    arm()
    return () => clearTimeout(t)
  }
  ```

  Alternative: render one `useDeadline` per row in a child component.

- **Expected benefit:** expired saved work is labelled on time.
- **Complexity:** S
- **Regression risk:** Low.
- **Tests to add:** use fake timers with two deadlines 1 min and 2 min out. Advance 61 s and assert one passed. Advance another 60 s and assert two passed, with no prop change in between.
- **Dependencies:** none.

### W2-05 Per-location query keys outside the documented roots escape the access-lost cache drop

- **Priority:** P2
- **Status:** CONFIRMED.
- **Location:**
  - **Contract:** `lib/queries/keys.ts:9-16` ("A new per-location or per-client key must live under one of them"); `lib/queries/scope-reset.ts:63-79` (`resourcePrefixesForPath` drops only `["locations", id]`, `location-capabilities`, `listing-summary` and `listing-change-requests`).
  - **Violations:**
    - `components/locations/administration/lifecycle-workspace.tsx:39` (`["lifecycle-workflows", locationId]`) and `:48` (`["lifecycle-latest-attempt", …]`)
    - `components/locations/administration/verification-saved-workflows.tsx:68` (`["verification-workflows", locationId, operation]`)
    - `lib/queries/use-google-verification-state.ts:8` (`["verification-state", locationId]`)
    - `components/locations/administration/access-workspace.tsx:49` (`["administration-access-workflows", locationId]`)
    - invalidations at `use-lifecycle.ts:34-35`, `use-verification-action.ts:40-41` and `use-administration-access.ts:24`
  - 28 inline `queryKey: [` literals exist outside `keys.ts` in total. The onboarding ones are per Google account and draft, which is a separate concern.
- **Current implementation and evidence:**
  - On a 403 or 404 read for `/api/locations/{id}/…`, `dropResourceQueries` removes or resets only the four roots.
  - Lifecycle, verification and access-workflow caches for that location survive until the session's scope token changes. If the role and fingerprint are unchanged, for example when a location is hidden, those caches stay.
  - The inline keys also bypass the factory, so typos between query and invalidation sites cannot be caught. The lifecycle invalidations happen to match by prefix.
- **Recommendation:**
  - Add factory entries under `["locations", id, …]`: `locationLifecycleWorkflows(id)`, `locationLifecycleAttempt(id, reviewId)`, `locationVerificationWorkflows(id, op)`, `locationVerificationState(id)` and `locationAccessWorkflows(id)`. Then replace the literals.
  - Add a lint guard, for example `no-restricted-syntax` on `Property[key.name="queryKey"] > ArrayExpression > Literal:first-child` outside `lib/queries/`.
- **Expected benefit:** the documented scoping guarantee holds for administration data, and invalidation is type-checked.
- **Complexity:** S
- **Regression risk:** Low, but invalidation sites must move in the same change.
- **Tests to add:** a unit test that every per-location factory key starts with an allowed root. A `dropResourceQueries` test that seeds a lifecycle key and asserts it is dropped.
- **Dependencies:** cross-lead for the data-fetching workstream.

### W2-06 Three URL-search implementations: the inbox can drop letters, and the listings board writes the URL on every keystroke

- **Priority:** P2
- **Status:** CONFIRMED in code. PLAUSIBLE for the inbox letter loss, which depends on navigation latency.
- **Location:**
  - `components/inbox/review-filters.tsx:39-63` (`useReviewSearch`)
  - `components/listings/listings-board.tsx:436-501` (local mirrors of `q`, `health`, `clientId` and `order`) and `:808` (`onSearchChange={setSearch}` → `router.replace` per keystroke at `:482`)
  - The correct version: `components/clients/clients-index-search.ts:20-70`
- **Current implementation and evidence:**
  - **Inbox.** `useReviewSearch` resets `searchDraft` to `state.search` whenever the URL value changes (`:47-51`), including when its own debounced write lands. Characters typed between the 300 ms debounce firing and `router.replace` committing are overwritten. `useDebouncedSearchParam` exists precisely to keep those ("letters typed while the navigation was in flight are kept", `:15-18`).
  - **Listings board.** `setSearch` calls `writeUrl` → `router.replace` on every character, with no debounce. `q`, `health` and `order` are seeded once from `searchParams` and never re-synced. Only `clientId` follows the URL (`:446-451`). So an external URL change such as a command palette link while mounted, or Back/Forward, leaves the chips and field out of sync with the address.
  - Two more URL-state modules exist: `lib/inbox/url-state.ts` and `lib/locations/photos-url-state.ts`.
- **Recommendation:**
  - Move `useDebouncedSearchParam` to `lib/hooks/use-debounced-search-param.ts` and use it in `useReviewSearch` and `ListingsBoard`.
  - Make the board derive `health`/`order`/`clientId` from `searchParams` (URL as source of truth, as the inbox does). Keep local state only for the search draft.
  - Target shape: `useUrlState(parse, serialize)` → `[state, update(partial, {mode})]`, with the inbox's `parseInboxState`/`serializeInboxState` as the first adopter.
- **Expected benefit:** no lost keystrokes, one navigation per pause instead of per letter, and Back/Forward-correct filters.
- **Complexity:** M
- **Regression risk:** Medium. Search focus and the phone "Cancel" path (`review-filters.tsx:58-61`) must keep working.
- **Tests to add:**
  - Type "abc", let the debounce fire, type "d" before the mock router commits, then assert the field shows "abcd".
  - Board: type five letters and assert one `router.replace` after the debounce.
  - Board: change the URL `q` externally and assert the field follows.
- **Dependencies:** none.

### W2-07 Unsaved-changes handling is spread across 2–4 hooks per editor, and they are wired inconsistently

- **Priority:** P2
- **Status:** CONFIRMED for the wiring gaps. HYPOTHESIS for the `discarded` latch, which no current call path was traced to trigger.
- **Location:** editors and the hooks they wire (scripted matrix):
  - `client-settings.tsx:979-987`: `useDirtyGuard` + `useLeaveGuard`
  - `policy-form.tsx:245-250`: `useDirtyGuard` + `useLeaveGuard`
  - `booking-tab.tsx:918-924`: `useDirtyGuard` (`stash: false`) + `useLeaveGuard`
  - `agency-name-form.tsx:79`: `useLeaveGuard` **only**
  - `onboarding-drafts.tsx:679-688`: `useLeaveGuard` without `onLeave`, plus a hand-rolled `beforeunload`
  - `reply-composer.tsx:131`: `useDirtyGuard` + inbox store
  - `useEditorDraft` editors, which get the leave guard through `DraftNotices` (`components/editors/draft-notices.tsx:40`)
  - Hooks: `lib/hooks/use-dirty-guard.ts:50-55,85-88,113,130`; `components/inbox/dirty-context.tsx:86-89,206-214`
- **Current implementation and evidence:**
  1. **`agency-name-form`** has no `beforeunload`. A reload or tab close drops an unsaved organisation name silently, though in-app links are guarded.
  2. **Onboarding `DraftDetails`** re-implements `beforeunload` and has no 401 stash, so a forced sign-out loses the whole creation draft. Its `useLeaveGuard` has no `onLeave`.
  3. **`ClientDetailsForm` and `PolicyForm`** keep the default `stash: true` but never call `restore()`. Only `useEditorDraft` and `ReplyComposer` read stashes (`rg restore()`). Every forced sign-out or unguarded unmount therefore writes an orphan `naba:draft:*` entry that nothing offers back. `use-dirty-guard.ts:50-55` itself says to pass `false` in that case.
  4. **The `discarded` latch.** `useDirtyGuard`'s `discarded` ref is set by `confirmDiscard`/`markDiscarded` and reset only when `key` changes (`:87-88`). If an editor survives a confirmed discard with the same key, later edits get no `beforeunload` (`:113`) and no unmount stash (`:102`).
  5. **The inbox store's `discard`** sets `isDirty: false` (`dirty-context.tsx:86-89`). The comment says "the composer re-registers if it is still there and edited again", but `useRegisterDirtyGuard`'s effect only reruns when `isDirty` _changes_. A composer that stays dirty never re-registers.
  6. **Programmatic navigation.** Only `command-palette-dialog.tsx` and `scope-sheet-model.tsx` use `useGuardedRouter`. For example, `client-settings.tsx:716` calls `router.push("/clients")` after archiving while `ClientDetailsForm` on the same page may be dirty, so the edits are lost without a prompt. That is arguably acceptable for an archive.
- **Recommendation:** one composite hook.

  `useUnsavedChanges({ scope, isDirty, snapshot?, restorable = false, onDiscard })` → `{ confirmDiscard, leavePrompt, forget }`

  - It wires `useDirtyGuard` with `stash: restorable` and `useLeaveGuard` with `onLeave: markDiscarded`, so there is one call site per editor.
  - Use it in all six editors above, and in onboarding with a stash and restore offer.
  - Reset `discarded` when `isDirty` goes false: `if (!isDirty) discarded.current = false` in the effect at `:77-80`.
  - In `useRegisterDirtyGuard`, include a `version` that `discard()` bumps, so the composer re-registers.

- **Expected benefit:** every editor gets the same guarantees (reload warning, link and back prompt, optional sign-out stash), with no orphan stashes.
- **Complexity:** M
- **Regression risk:** Medium, because leave-guard semantics are subtle. `tests/components/use-leave-guard.test.tsx` and `inbox-leave-guard.test.tsx` must stay green.
- **Tests to add:**
  - Per editor: a dirty edit followed by a `beforeunload` dispatch has `defaultPrevented` set.
  - `ClientDetailsForm`: after unmount while dirty, no `naba:draft:` key remains.
  - Composer: edit → leave-prompt Discard on a `run` request that keeps the page → edit again → `useIsDirty()` is true.
- **Dependencies:** W2-02 and W2-09.

### W2-08 (folded into W2-07, item 6)

### W2-09 Four draft-seeding mechanisms, and the onboarding editor mirrors about 30 payload fields into separate state

- **Priority:** P2
- **Status:** CONFIRMED.
- **Location:**
  - `lib/locations/use-reset-on-revision.ts:30-41`: effect-based. One consumer, `components/locations/administration/admins.tsx:128`, plus a doc example in `location-tab.tsx:74`.
  - `lib/editors/use-editor-draft.ts:76-233`: render-phase, with conflict and stash handling. Six consumers.
  - `components/inbox/reply-composer.tsx:138-171`: hand-rolled, with refs and an effect.
  - `components/setup/onboarding-drafts.tsx:429` (`key={draft.id}:{revision}:{reloadVersion}` remount) and `:476-520+` (32 `useState` seeded from `draft.payload`; `DraftDetails` is 717 LOC).
- **Current implementation and evidence:**
  - `useResetOnRevision` clobbers in-progress edits whenever the revision moves, with no "incoming" choice, and shows one stale frame because it resets in an effect.
  - `DraftDetails` is remounted whenever the server revision changes. Unsaved field edits vanish without a prompt if a refetch brings a new revision.
  - Dirtiness is a `JSON.stringify` comparison of a rebuilt payload (`:673-677`), OR-ed with seven `*EntryDirty` flags that children push up through effects (`onboarding-hours.tsx:39-42,76,117`; `:713-715`).
- **Recommendation:**
  - Make `useEditorDraft` the single primitive:
    - replace `useResetOnRevision` in `admins.tsx`, then delete it;
    - port `ReplyComposer` (W2-02);
    - restructure `DraftDetails` around `useEditorDraft<OnboardingPayload>` with a reducer for field updates, dropping the revision-keyed remount, so a colleague's save raises `incoming` rather than wiping edits.
  - Replace the entry-dirty flag chain with child components reporting partial entries into the reducer state.
- **Expected benefit:** one tested seeding and conflict model, roughly 30 fewer `useState` calls in the largest form, and no silent loss of edits.
- **Complexity:** L for onboarding. S for `admins.tsx`.
- **Regression risk:** Medium to High for onboarding, which is a creation flow with Google validation.
- **Tests to verify:** the existing onboarding tests. Add: "refetch with new revision while dirty keeps edits and offers Load theirs".
- **Dependencies:** W2-07.

### W2-10 Children register state upward through effects: post-hydration flips and bundled contexts

- **Priority:** P2
- **Status:** CONFIRMED for the code path. PLAUSIBLE for a visible flash, which needs a Lighthouse or CLS trace and a screenshot diff of the first two frames.
- **Location:**
  - `components/app-shell/client-context.tsx:72` (`scoped` starts `null`), `:81-84` (one `RegistryContext` value bundles `scoped`, `remembered`, `setRemembered` and `handlers`), and `:99-104` (`ClientScopeProvider` sets `scoped` in an effect). Consumers: `context-health-chip.tsx:30`, `reconnect-banner.tsx:86`, `reconnect-banner-gate.tsx:32`, `google-freshness.tsx:25`.
  - `components/app-shell/page-chrome.tsx:58-85` (one context holds `override` and `set`) and `:119-147` (override set in an effect).
  - `components/locations/profile/profile-editor.tsx:660-663` (`onSavedReviews` lifted via an effect, so the saved-review queries start one commit later).
  - `components/setup/onboarding-hours.tsx:39-42,76,117` and `onboarding-drafts.tsx:713-715` (three levels of `onEntryChange`/`onDirtyChange` effects).
  - `components/editors/editor-status.tsx:67-93`.
- **Current implementation and evidence:**
  - On a client hub or listing, the shell's health chip and reconnect banner render the organisation roll-up on the server and during hydration, then switch to the client's health once `ClientScopeProvider`'s effect runs. The same applies to the phone app bar's title, back link and count via `PageChrome`.
  - Every `setScoped` also rerenders every `useRememberedClient` consumer (`SidebarNav`, `SidebarBody` and others in `app-shell.tsx:112,153,317`; `client-switcher.tsx:61`; `command-palette-dialog.tsx:104`), because they share one context value.
  - Each effect-lift costs an extra render pass, and in the profile editor a delayed query start.
- **Recommendation:**
  - Derive page scope synchronously in the shell from route params (`useParams()` or `useSelectedLayoutSegments()`), or pass `initialScoped` from the server layout that already knows `clientId` (`app/(dashboard)/clients/[clientId]/layout.tsx:128`, `listing-gate.tsx:97`). Keep the effect only as a fallback.
  - Split `RegistryContext` into `ScopeContext`, `RememberedContext` and a stable `HandlerSlot` context. Do the same for `PageChromeContext`: a stable `set` context separate from the `override` value.
  - For onboarding, use a reducer instead of dirty-flag lifting (W2-09).
- **Expected benefit:** a correct first paint for client-scoped chrome, fewer cascading renders, and narrower rerenders.
- **Complexity:** M
- **Regression risk:** Medium. The shell is on every page.
- **Tests to add:** render the shell plus a `/clients/[id]` page with `renderToString`, then assert the chip label is the client's, not the roll-up.
- **Dependencies:** none.

### W2-11 Six hand-rolled "reviewed write" state machines

- **Priority:** P2
- **Status:** CONFIRMED.
- **Location:**
  - `components/locations/administration/use-lifecycle.ts`
  - `components/locations/administration/use-administration-access.ts`
  - `components/locations/administration/use-verification-action.ts:24-47`
  - `components/locations/profile/sections/use-lodging-review.ts`
  - `components/locations/profile/sections/use-service-review.ts`
  - `components/locations/place-actions/use-place-action-review.ts:11-…`
  - Their contexts: `lifecycle-workspace.tsx:29,59-65,76`; `lodging-workspace.tsx:41`; `service-workspace.tsx:24`; `verification-workspace-actions.tsx:20-24`; `access-workspace.tsx:69`.
- **Current implementation and evidence:**
  - Each hook re-implements the same lifecycle with `useState` (`busy`, `error`, `review`, `outcome`, `uncertain`, `stale`, `open`, `revision`) plus `claim`/`unsafe` refs.
  - Each has a `run(work)` with `try/catch/finally` that releases the claim and invalidates queries, plus `accept()` and `restore()` (`rg` shows `run`/`accept`/`restore` in four files, and 3–14 `claim.current`/`unsafe.current` uses per file).
  - None uses `useMutation` or `useResourceMutation`.
  - Their contexts spread the whole hook result into a fresh object every render, so every consumer rerenders on any parent render.
  - These files share a dense one-line style. Lines over 160 characters: 104 in `components/setup`, 70 in `administration`, 94 in `profile/sections`, against 14 across 8.7k LOC in `components/inbox`. That makes the duplication harder to see and to review.
- **Recommendation:**
  - Extract `useReviewedWrite<Req, Review, Attempt>({ preview, approve, send, readOutcome, refreshOutcome, invalidate: QueryKey[], isUnresolved })`. It should return `{ busy, error, review, attempt, unresolved, stale, preview, open, approve, send, restore }`, with a single claim and unsafe guard.
  - Keep per-domain hooks as 10–20 line adapters.
  - Memoise each context value, or split it into a state context and an actions context.
- **Expected benefit:** one place to get the claim, unsafe and uncertain safety right. These guards protect Google writes.
- **Complexity:** L
- **Regression risk:** High. These guard against double writes to Google.
- **Tests to verify:** the existing per-hook tests. Add shared contract tests (double-click claim, unsafe blocks preview, uncertain after network loss) run against each adapter.
- **Dependencies:** W2-05 (keys).

### W2-12 Session-derived hooks subscribe to the entire QueryCache

- **Priority:** P3
- **Status:** PLAUSIBLE. The cost is unmeasured.
- **Location:** `lib/workspace/mode.ts:21-35` (`useWorkspaceMode`, 36 consumer files); `lib/editors/use-draft-key.ts:16-37`; `components/app-shell/scope-sheet-model.tsx:162-…`.
- **Current implementation and evidence:** `client.getQueryCache().subscribe(onChange)` fires on every cache event in the app (fetch start, success, observer added or removed). Each mounted instance then runs `getQueryData(session)`. Rerenders are avoided because the snapshot is a primitive, but the callback work grows as instances × events. No per-row usage was found: `listings-board.tsx:304,328,432` are table, skeleton and board level.
- **Recommendation:** provide `SessionContext` once from the shell, where the session query already lives, carrying `{ workspaceMode, userId, organisationId }`. Alternatively use `useQuery({ queryKey: session, enabled: false, select, notifyOnChangeProps: ["data"] })`. Measure first: count `onChange` calls during an inbox session with a temporary counter.
- **Expected benefit:** less work per cache event. It is minor unless the measurement says otherwise.
- **Complexity:** S
- **Regression risk:** Low.
- **Tests:** the existing `useWorkspaceMode` tests.
- **Dependencies:** none.

### W2-13 `useMediaQuery` resubscribes and builds a new `MediaQueryList` on every render

- **Priority:** P3
- **Status:** CONFIRMED.
- **Location:** `lib/hooks/use-media-query.ts:44-69`.
- **Current implementation and evidence:**
  - The `subscribe` argument is an inline arrow, so React's `useSyncExternalStore` unsubscribes and resubscribes on every render: `removeEventListener`, then `matchMedia(query)`, then `addEventListener`.
  - `getSnapshot` also calls `window.matchMedia(query)` on every read.
  - Consumers include `usePhoneOverlay`, which runs in every Sheet, Dialog, AlertDialog, Command, Select, Popover, Combobox and DropdownMenu popup (`components/ui/*`), plus always-mounted `more-filters.tsx:140` and `bulk-action-bar.tsx:81`.
- **Recommendation:** cache per query at module level, for example `const stores = new Map<string, { subscribe, getSnapshot }>()`, and create each entry once.
- **Expected benefit:** less listener churn on every overlay render.
- **Complexity:** S
- **Regression risk:** Low. Keep the jsdom no-`matchMedia` fallback.
- **Tests:** existing media-query tests. Add: rerender ten times and assert `addEventListener` was called once.
- **Dependencies:** none.

### W2-14 Hydration helpers are duplicated, and two editors break the documented "layout in CSS" rule

- **Priority:** P3
- **Status:** CONFIRMED in code. Latent risk only.
- **Location:**
  - A duplicate `useHydrated` in `components/reporting/presence-provenance.tsx:15-21`.
  - `useBreakpoint("desk")`, with server default `true`, selecting whole subtrees in `components/locations/profile/sections/identity-section.tsx:199,245,343` and `contact-section.tsx:356,389,497`.
  - The rule is stated in `lib/hooks/use-media-query.ts:8-34`.
- **Current implementation and evidence:**
  - Both sections render a desk tree or a phone tree from a media query that answers `true` on the server.
  - Today they mount only after a client-side fetch, because Google-backed tabs are not prefetched (`docs/architecture.md:1356-1364`). The first render therefore uses the client snapshot and nothing flashes.
  - If the profile were ever prefetched or hydrated, phones would paint the desk tree first and swap. That swap would lose focus and any local state in it.
- **Recommendation:**
  - Import `useHydrated` from `lib/hooks` in `presence-provenance.tsx`.
  - Switch both sections to `useHydratedBreakpoint("desk")` and render the CSS-switched shape for `null`, or add a comment saying the section is client-mounted only.
- **Expected benefit:** guards against a future change re-introducing a hydration flash.
- **Complexity:** S
- **Regression risk:** Low.
- **Tests:** none required.
- **Dependencies:** none.

### W2-15 Inbox bulk selection survives queue, filter and client changes

- **Priority:** P3
- **Status:** CONFIRMED.
- **Location:** `components/inbox/selection-context.tsx:41-96`; `inbox-view.tsx:257-298` (`onFilterChange`, `onQueueChange` and `applyClientScope` never call `selection.clear()`); `bulk-action-bar.tsx:93` (`chosen = rows.filter(row => selected.has(row.id))`).
- **Current implementation and evidence:**
  - Ticked ids remain in the `Set` after the operator switches queue or client.
  - The bar only acts on visible rows (`chosen`), so nothing wrong is sent. But returning to the earlier queue resurrects old ticks.
  - The template "finished" path also re-`replace`s using the stale set (`:119`).
- **Recommendation:** clear the selection (and the select mode, by choice) in `onQueueChange` and `applyClientScope`, and probably in `onFilterChange`. Or key `SelectionProvider` on `queue + clientId`.
- **Complexity:** S
- **Regression risk:** Low.
- **Tests to add:** tick two rows, change queue, return, and assert nothing is ticked.
- **Dependencies:** none.

### W2-16 Manual memoisation is mostly a no-op

- **Priority:** P3
- **Status:** CONFIRMED.
- **Location:** repo-wide. Examples: `inbox-view.tsx:201,224,354,665` (deps change every render, see W2-01); `components/inbox/inbox-hotkeys.tsx:43-46` (already uses a latest-ref, so the parent memo is unnecessary); `lib/editors/use-publish-flow.ts:179-300` (`publish` depends on inline `steps`/`successToast`/`onSuccess` from consumers, so it is new every render).
- **Current implementation and evidence:** there is no `React.memo` anywhere and no compiler. A `useCallback` or `useMemo` passed as a prop to a non-memoised component does nothing. It only matters in dependency arrays and context values, where several (W2-01) are invalidated anyway.
- **Recommendation:** either enable React Compiler after W2-03's bail-out measurement and drop manual memos, or keep memos only where they feed effects or contexts and fix their dependencies. Replace "latest-ref via effect" patterns with `useEffectEvent`: `app-shell.tsx:202`, `page-chrome.tsx:114`, `client-context.tsx:145`, `chip.tsx:402`, `use-leave-guard.ts:274`, `use-close-guard.ts:35`, `use-dirty-guard.ts:77`, `reply-composer.tsx:182,243`, `inbox-view.tsx:435`.
- **Complexity:** M
- **Regression risk:** Low to Medium.
- **Tests:** the existing suites.
- **Dependencies:** W2-03.

### W2-17 Dead hooks and name collisions

- **Priority:** P3
- **Status:** CONFIRMED (no references, by `rg`).
- **Location:**
  - **Dead:**
    - `lib/motion/use-reveals.ts:12` `useReveals` (also flagged in `docs/audits/2026-10-13-mobile-first-audit.md:107`)
    - `lib/queries/use-clients.ts:64` `useClientHealth`
    - `lib/queries/use-import-review.ts:22` `useImportReviewCounts`
    - `lib/queries/use-location-activity.ts:14` `useLocationActivity`
    - `components/app-shell/viewport-insets.tsx:131` `useKeyboardInset` (tests only)
  - **Deprecated alias still used:** `components/locations/administration/use-verification-expiry.ts:12`, by `place-action-approval-sheet.tsx:60` and `editors/change-diff.tsx:98`.
  - **Name collisions with different semantics:**
    - `useNow` in `lib/time/server-now.tsx:26` (hydration-safe 15 s) and `components/bulk/bulk-operation-view.tsx:618` (1 s local interval)
    - `useSelection` in `components/inbox/selection-context.tsx:105` and `components/ui/segmented-control.tsx:254`
  - **Duplicated helpers:** `untilMounted` (`hours-editor.tsx:189-202`) and `whenMounted` (`menu-editor.tsx:226-236`).
- **Recommendation:**
  - Delete the dead hooks.
  - Migrate the two alias consumers to `useDeadline`, then delete the alias.
  - Rename the local `useNow` to `useTicker(activeMs)`, possibly built on `subscribeClock` with a faster interval.
  - Share one `waitForElement(id, frames)` helper.
- **Complexity:** S
- **Regression risk:** Low.
- **Tests:** `tests/components/viewport-insets.test.tsx` uses `useKeyboardInset`. Keep the hook or adjust the test.
- **Dependencies:** none.

---

## Complexity ranking (scripted)

Per component (top-level capitalised function in `.tsx`, excluding `app/design-system`). "hook calls" counts every `useX(` / `useX<` token in the component's span, so a few hooks referenced in comments are included. Spans run to the next top-level component, so trailing lowercase helper hooks in the same file are attributed to the preceding component. This inflates `DirtyGuardProvider` and `ClientScopeProvider`.

| Component                             | Location                                               | LOC  | hook calls | useState | effects | useRef | memo/cb |
| ------------------------------------- | ------------------------------------------------------ | ---- | ---------- | -------- | ------- | ------ | ------- |
| InboxViewInner                        | components/inbox/inbox-view.tsx:118                    | 957  | 51         | 2        | 6       | 14     | 12      |
| DraftDetails                          | components/setup/onboarding-drafts.tsx:457             | 717  | 38         | 32       | 2       | 0      | 0       |
| BulkCompose                           | components/bulk/bulk-compose.tsx:303                   | 1531 | 31         | 20       | 0       | 2      | 0       |
| ProfileEditor                         | components/locations/profile/profile-editor.tsx:237    | 786  | 30         | 9        | 2       | 2      | 10      |
| ReplyComposer                         | components/inbox/reply-composer.tsx:89                 | 671  | 30         | 8        | 5       | 7      | 1       |
| DirtyGuardProvider (+ trailing hooks) | components/inbox/dirty-context.tsx:101                 | 166  | 24         | 2        | 1       | 1      | 4       |
| MenuEditor                            | components/locations/menu-editor.tsx:370               | 955  | 22         | 17       | 1       | 3      | 0       |
| PolicyForm                            | components/settings/policy-form.tsx:180                | 526  | 22         | 6        | 0       | 1      | 3       |
| PostComposerSheet                     | components/locations/posts/post-composer-sheet.tsx:348 | 766  | 18         | 5        | 1       | 1      | 0       |
| SetupWizard                           | components/setup/setup-wizard.tsx:88                   | 418  | 18         | 6        | 1       | 3      | 1       |
| AddPhotoDialog                        | components/locations/photos/add-photo-dialog.tsx:139   | 518  | 17         | 6        | 3       | 5      | 0       |
| HoursForm                             | components/locations/hours-tab.tsx:161                 | 423  | 17         | 7        | 0       | 2      | 5       |
| MenuForm                              | components/locations/menu-tab.tsx:75                   | 347  | 16         | 7        | 0       | 2      | 4       |
| ListingsBoard                         | components/listings/listings-board.tsx:400             | 635  | 15         | 6        | 0       | 0      | 0       |
| ImportCard                            | components/settings/import-card.tsx:43                 | 408  | 15         | 6        | 0       | 0      | 0       |
| InviteForm                            | components/settings/invitations-panel.tsx:412          | 279  | 15         | 8        | 1       | 1      | 0       |
| ShareReportDialog                     | components/clients/share-report-dialog.tsx:164         | 196  | 15         | 5        | 1       | 2      | 0       |
| ActionBar                             | components/inbox/action-bar.tsx:74                     | 428  | 14         | 3        | 1       | 1      | 0       |
| SignInForm                            | components/auth/sign-in-form.tsx:105                   | 424  | 14         | 9        | 1       | 2      | 0       |
| NotificationsCard                     | components/settings/notifications-card.tsx:53          | 349  | 14         | 7        | 0       | 1      | 0       |
| HoursEditor                           | components/locations/hours-editor.tsx:249              | 758  | 13         | 8        | 0       | 1      | 0       |

Largest `.tsx` files by LOC: `bulk-compose.tsx` 1884, `menu-editor.tsx` 1323, `hours-editor.tsx` 1290, `onboarding-drafts.tsx` 1275, `review-detail.tsx` 1139, `client-settings.tsx` 1132, `post-composer-sheet.tsx` 1112, `invitations-panel.tsx` 1105, `inbox-view.tsx` 1102 and `booking-tab.tsx` 1036. The top two by hook density are `InboxViewInner` and `DraftDetails`; both are covered by W2-01, W2-02, W2-09 and W2-10.

**Split suggestions for the top two:**

- **`InboxViewInner` (957 LOC).** Extract:
  - `useInboxUrlState()`: `state`, `updateState`, `onFilterChange`, `onQueueChange`, `onClearFilters`, `applyClientScope`
  - `useInboxNavigation(reviews)`: `onSelect`, `onBackToList`, `onAdjacentReview`, the auto-select effect, the advance-after-publish listener, focus and scroll restoration
  - `useInboxHotkeyHandlers(...)`

  The component then only composes queries and layout.

- **`DraftDetails` (717 LOC, 32 `useState`).** Use one `useEditorDraft<OnboardingPayload>` plus a field reducer (W2-09), and move the derived validation (`:600-677`) into a pure `evaluateOnboardingDraft(payload)` in `lib/`, as the inbox's "pure evaluator + thin renderer" pattern does (`docs/architecture.md:1321-1330`).

---

## Custom hook inventory (188 definitions)

Consumer count = files outside the defining file that call `hook(`, from `rg -l`. Hooks passed by reference (`useResource={useX}`) show 0 calls; this is noted where it applies. Thin `lib/queries/*` wrappers are labelled as such and were spot-checked, not individually reviewed.

| Hook                                    | Defined at                                                                | Files using it (excl. own) | Calls in own file | Notes                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------- | -------------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| useAccount                              | components/app-shell/account-menu.tsx:125                                 | 0                          | 2                 |                                                                                             |
| useViewCount                            | components/app-shell/app-bar.tsx:174                                      | 0                          | 1                 |                                                                                             |
| useCompactTitle                         | components/app-shell/app-bar.tsx:98                                       | 0                          | 1                 |                                                                                             |
| useCloseAtDesk                          | components/app-shell/app-shell.tsx:200                                    | 0                          | 2                 | matchMedia listener with cleanup; good                                                      |
| useSessionReady                         | components/app-shell/app-shell.tsx:69                                     | 0                          | 1                 | bootstrap fetch with abort and timeout; good                                                |
| useShellTrail                           | components/app-shell/breadcrumbs-context.tsx:25                           | 0                          | 2                 |                                                                                             |
| useShellBack                            | components/app-shell/breadcrumbs-context.tsx:43                           | 2                          | 0                 |                                                                                             |
| useClientScope                          | components/app-shell/client-context.tsx:113                               | 4                          | 0                 | registry `scoped` set in effect, so it flips after hydration (W2-10)                        |
| usePageClientScope                      | components/app-shell/client-context.tsx:120                               | 2                          | 0                 |                                                                                             |
| useRememberedClient                     | components/app-shell/client-context.tsx:130                               | 4                          | 0                 | bundled in the same Registry context (W2-10)                                                |
| useClientScopeHandler                   | components/app-shell/client-context.tsx:142                               | 1                          | 0                 | latest-ref handler slot                                                                     |
| usePageScopeHandler                     | components/app-shell/client-context.tsx:158                               | 1                          | 0                 |                                                                                             |
| useCommandPalette                       | components/app-shell/command-palette.tsx:155                              | 1                          | 0                 |                                                                                             |
| useShortcutHint                         | components/app-shell/command-palette.tsx:191                              | 1                          | 1                 |                                                                                             |
| useSyncPlatform                         | components/app-shell/command-palette.tsx:195                              | 0                          | 1                 |                                                                                             |
| useContextHealth                        | components/app-shell/context-health-chip.tsx:26                           | 1                          | 2                 |                                                                                             |
| useMoreOpen                             | components/app-shell/nav.tsx:118                                          | 0                          | 1                 |                                                                                             |
| useUnreadNotificationCount              | components/app-shell/notifications-link.tsx:19                            | 2                          | 1                 |                                                                                             |
| usePageChromeOverride                   | components/app-shell/page-chrome.tsx:156                                  | 2                          | 0                 | effect-registered override (W2-10)                                                          |
| useCachedDirectory                      | components/app-shell/scope-sheet-model.tsx:162                            | 0                          | 1                 | uSES on the whole QueryCache (W2-12)                                                        |
| useClientSwitch                         | components/app-shell/scope-sheet-model.tsx:191                            | 3                          | 1                 |                                                                                             |
| useLocationSwitch                       | components/app-shell/scope-sheet-model.tsx:270                            | 1                          | 0                 |                                                                                             |
| useAgencyScopeLabel                     | components/app-shell/scope-sheet-model.tsx:348                            | 0                          | 2                 |                                                                                             |
| useScopeLabel                           | components/app-shell/scope-sheet-model.tsx:368                            | 2                          | 0                 |                                                                                             |
| useClientScopeLabel                     | components/app-shell/scope-sheet-model.tsx:397                            | 1                          | 0                 |                                                                                             |
| useSheetQuery                           | components/app-shell/scope-sheet.tsx:81                                   | 0                          | 2                 |                                                                                             |
| useShellNavigation                      | components/app-shell/shell-navigation.tsx:16                              | 1                          | 0                 |                                                                                             |
| useNeedsReplyCount                      | components/app-shell/use-needs-reply-count.ts:19                          | 3                          | 0                 |                                                                                             |
| useKeyboardInset                        | components/app-shell/viewport-insets.tsx:131                              | 0                          | 0                 | tests only (W2-17)                                                                          |
| useNow (local)                          | components/bulk/bulk-operation-view.tsx:618                               | 0                          | 1                 | private 1 s ticker; same name as the lib/time `useNow` (W2-17)                              |
| useDebouncedSearchParam                 | components/clients/clients-index-search.ts:20                             | 1                          | 0                 | correct pattern; should be shared (W2-06)                                                   |
| useReportEditorStatus                   | components/editors/editor-status.tsx:67                                   | 2                          | 0                 | effect-registered store                                                                     |
| useEditorStatus                         | components/editors/editor-status.tsx:96                                   | 1                          | 0                 | uSES                                                                                        |
| useAskDiscardConfirm                    | components/inbox/dirty-context.tsx:186                                    | 1                          | 0                 |                                                                                             |
| useRegisterDirtyGuard                   | components/inbox/dirty-context.tsx:196                                    | 1                          | 0                 | effect-registered store; phantom dirty commit (W2-02); no re-register after discard (W2-07) |
| useDirtyGate                            | components/inbox/dirty-context.tsx:219                                    | 1                          | 0                 |                                                                                             |
| useReadIsDirty                          | components/inbox/dirty-context.tsx:230                                    | 1                          | 0                 |                                                                                             |
| useIsDirty                              | components/inbox/dirty-context.tsx:237                                    | 2                          | 0                 | uSES on DirtyStore                                                                          |
| useComposerSave                         | components/inbox/dirty-context.tsx:248                                    | 2                          | 0                 |                                                                                             |
| useReviewSearch                         | components/inbox/review-filters.tsx:39                                    | 1                          | 0                 | overwrites in-flight letters (W2-06)                                                        |
| useSelection                            | components/inbox/selection-context.tsx:105                                | 4                          | 0                 | memoised value; not cleared on queue or filter change (W2-15)                               |
| useProfileReview                        | components/listings/review-publish.tsx:130                                | 0                          | 1                 |                                                                                             |
| useHoursReview                          | components/listings/review-publish.tsx:188                                | 0                          | 1                 |                                                                                             |
| useMenuReview                           | components/listings/review-publish.tsx:258                                | 0                          | 1                 |                                                                                             |
| useActivityPages                        | components/locations/activity-panel.tsx:26                                | 0                          | 0                 | passed by reference as `useResource` to LocationTab                                         |
| useAdministrationAccess                 | components/locations/administration/access-workspace.tsx:29               | 3                          | 1                 | context value is a new object each render (W2-11)                                           |
| useAdministrationWithCachedData         | components/locations/administration/administration-tab.tsx:171            | 0                          | 0                 | passed by reference as `useResource`                                                        |
| useAdministrationSection                | components/locations/administration/context.tsx:56                        | 7                          | 2                 |                                                                                             |
| useAdministrationAccessController       | components/locations/administration/use-administration-access.ts:12       | 1                          | 0                 | hand-rolled reviewed-write machine (W2-11); inline query key (W2-05)                        |
| useLifecycle                            | components/locations/administration/use-lifecycle.ts:26                   | 1                          | 0                 | hand-rolled reviewed-write machine (W2-11); inline keys (W2-05)                             |
| useLifecycleContext                     | components/locations/administration/lifecycle-workspace.tsx:30            | 2                          | 1                 | context = whole useLifecycle result, new object each render                                 |
| useVerificationAction                   | components/locations/administration/use-verification-action.ts:24         | 2                          | 0                 | hand-rolled reviewed-write machine (W2-11)                                                  |
| useVerificationExpiry                   | components/locations/administration/use-verification-expiry.ts:12         | 2                          | 0                 | @deprecated alias of useDeadline (W2-17)                                                    |
| usePassedDeadlines                      | components/locations/administration/verification-saved-workflows.tsx:16   | 0                          | 1                 | **bug: arms only the first deadline** (W2-04)                                               |
| useVerificationWorkspaceActions         | components/locations/administration/verification-workspace-actions.tsx:27 | 1                          | 1                 | context literal, new object each render                                                     |
| useCategorySearch                       | components/locations/business-information/category-search.tsx:28          | 0                          | 2                 |                                                                                             |
| usePhotosUrlState                       | components/locations/photos-tab.tsx:18                                    | 0                          | 2                 | URL state                                                                                   |
| useMediaPage                            | components/locations/photos-tab.tsx:29                                    | 0                          | 0                 | passed by reference as `useResource`                                                        |
| usePlaceActionReview                    | components/locations/place-actions/use-place-action-review.ts:11          | 1                          | 0                 | hand-rolled reviewed-write machine (W2-11)                                                  |
| useLodgingReview                        | components/locations/profile/sections/use-lodging-review.ts:15            | 2                          | 0                 | hand-rolled reviewed-write machine (W2-11)                                                  |
| useLodgingWorkspace                     | components/locations/profile/sections/lodging-workspace.tsx:45            | 3                          | 1                 | context = spread hook result, new object each render                                        |
| useServiceReview                        | components/locations/profile/sections/use-service-review.ts:14            | 2                          | 0                 | hand-rolled reviewed-write machine (W2-11)                                                  |
| useServiceWorkspace                     | components/locations/profile/sections/service-workspace.tsx:19            | 1                          | 1                 | context = spread hook result, new object each render                                        |
| useHydrated (copy)                      | components/reporting/presence-provenance.tsx:15                           | 0                          | 1                 | duplicate of lib/hooks/use-hydrated (W2-14)                                                 |
| useOverflowsX                           | components/reporting/report-bar-chart.tsx:79                              | 0                          | 1                 |                                                                                             |
| useClaimFocus                           | components/reviewed-write/panel.tsx:20                                    | 0                          | 1                 | timer cleaned up                                                                            |
| useBillingScreensEnabled                | components/settings/billing-screens.tsx:27                                | 1                          | 0                 |                                                                                             |
| useCanShareLink                         | components/settings/invitations-panel.tsx:144                             | 0                          | 2                 |                                                                                             |
| useEmailDelivery                        | components/settings/invitations-panel.tsx:196                             | 0                          | 2                 |                                                                                             |
| useVisibleSettingsAreas                 | components/settings/settings-areas.tsx:91                                 | 2                          | 0                 |                                                                                             |
| useSettingsFeatures                     | components/settings/settings-features.tsx:28                              | 1                          | 0                 |                                                                                             |
| useCurrentTabInView                     | components/settings/settings-nav.tsx:28                                   | 0                          | 1                 |                                                                                             |
| useFieldContext                         | components/ui/field.tsx:44                                                | 7                          | 5                 |                                                                                             |
| useFormErrorScope                       | components/ui/field.tsx:198                                               | 1                          | 1                 |                                                                                             |
| useFieldTriggerProps                    | components/ui/field.tsx:450                                               | 2                          | 0                 |                                                                                             |
| useMenuSheet (alias of usePhoneOverlay) | components/ui/menu-surface.tsx:64                                         | 4                          | 0                 | alias                                                                                       |
| useMenuActions                          | components/ui/menu-surface.tsx:124                                        | 4                          | 0                 |                                                                                             |
| usePhoneOverlay                         | components/ui/overlay.tsx:47                                              | 2                          | 1                 | `useMediaQuery(phoneOverlay, false)`; reached by every overlay (W2-13)                      |
| useOverlayPresentation                  | components/ui/overlay.tsx:60                                              | 3                          | 1                 | adjust-during-render hold; good                                                             |
| useOverlayRoot                          | components/ui/overlay.tsx:85                                              | 2                          | 1                 |                                                                                             |
| useReportSwipeDirection                 | components/ui/overlay.tsx:216                                             | 2                          | 0                 |                                                                                             |
| useOverlayChrome                        | components/ui/overlay.tsx:468                                             | 2                          | 1                 |                                                                                             |
| useOverlayHeader                        | components/ui/overlay.tsx:590                                             | 2                          | 0                 |                                                                                             |
| useSegmentedOverflow                    | components/ui/segmented-control.tsx:167                                   | 0                          | 3                 |                                                                                             |
| useRevealSelected                       | components/ui/segmented-control.tsx:227                                   | 0                          | 3                 |                                                                                             |
| useSelection (local)                    | components/ui/segmented-control.tsx:254                                   | 0                          | 3                 | private; name collides with the inbox `useSelection` (W2-17)                                |
| useScrollsHorizontally                  | components/ui/table.tsx:181                                               | 0                          | 1                 |                                                                                             |
| useScrollFade                           | components/ui/tabs.tsx:56                                                 | 1                          | 2                 |                                                                                             |
| useCurrentInView                        | components/ui/tabs.tsx:112                                                | 0                          | 2                 |                                                                                             |
| useModalFooterClearance                 | components/ui/toast.tsx:66                                                | 0                          | 1                 |                                                                                             |
| useToastManager                         | components/ui/toast.tsx:462                                               | 30                         | 4                 | toast API                                                                                   |
| useOutcomeToast                         | components/ui/toast.tsx:727                                               | 7                          | 0                 |                                                                                             |
| useCloseGuard                           | lib/editors/use-close-guard.ts:19                                         | 1                          | 0                 | latest-ref plus prompt; correct                                                             |
| useDeadline                             | lib/editors/use-deadline.ts:14                                            | 7                          | 0                 | single-deadline timer via uSES; correct                                                     |
| useDraftIdentity                        | lib/editors/use-draft-key.ts:16                                           | 0                          | 1                 | uSES on the whole QueryCache (W2-12)                                                        |
| useDraftKey                             | lib/editors/use-draft-key.ts:40                                           | 4                          | 0                 | identity plus scope key                                                                     |
| useEditorDraft                          | lib/editors/use-editor-draft.ts:76                                        | 5                          | 0                 | render-phase seed, follow, conflict and stash; best in repo (W2-09)                         |
| useKeepFocusClear                       | lib/editors/use-keep-focus-clear.ts:53                                    | 4                          | 0                 | rAF plus listeners, with cleanup                                                            |
| useLeaveGuard                           | lib/editors/use-leave-guard.ts:260                                        | 8                          | 0                 | link, back and programmatic leave prompt; solid                                             |
| useGuardedRouter                        | lib/editors/use-leave-guard.ts:375                                        | 1                          | 0                 | only 2 consumers (W2-07)                                                                    |
| usePublishFlow                          | lib/editors/use-publish-flow.ts:148                                       | 6                          | 0                 | multi-step publish state machine; callbacks never stable (W2-16)                            |
| useDirtyGuard                           | lib/hooks/use-dirty-guard.ts:36                                           | 5                          | 0                 | `discarded` latch; stash default (W2-07)                                                    |
| useHydrated                             | lib/hooks/use-hydrated.ts:13                                              | 9                          | 0                 | uSES hydration flag                                                                         |
| useMediaQuery                           | lib/hooks/use-media-query.ts:44                                           | 3                          | 1                 | resubscribes every render (W2-13)                                                           |
| useBreakpoint                           | lib/hooks/use-media-query.ts:77                                           | 2                          | 2                 | server default true; used to pick trees (W2-14)                                             |
| useHydratedBreakpoint                   | lib/hooks/use-media-query.ts:89                                           | 5                          | 1                 | null until hydrated; correct                                                                |
| useResetOnRevision                      | lib/locations/use-reset-on-revision.ts:30                                 | 1                          | 0                 | effect reseed, overlaps useEditorDraft (W2-09)                                              |
| useReveals                              | lib/motion/use-reveals.ts:12                                              | 0                          | 0                 | **dead** (W2-17)                                                                            |
| useInvalidateReviewWrites               | lib/queries/invalidate.ts:13                                              | 4                          | 0                 | query helper                                                                                |
| usePagedResource                        | lib/queries/paged-list.ts:44                                              | 3                          | 0                 | query helper                                                                                |
| useScopeReset                           | lib/queries/scope-reset.ts:156                                            | 1                          | 0                 | relies on key roots (W2-05)                                                                 |
| useAiCredits                            | lib/queries/use-ai-credits.ts:8                                           | 2                          | 0                 | thin TanStack Query wrapper                                                                 |
| useAiCreditsDaily                       | lib/queries/use-ai-credits.ts:15                                          | 1                          | 0                 | thin wrapper                                                                                |
| useAnalyticsKeywords                    | lib/queries/use-analytics-keywords.ts:9                                   | 2                          | 0                 | thin wrapper                                                                                |
| useAnalyticsOverview                    | lib/queries/use-analytics-overview.ts:9                                   | 2                          | 0                 | thin wrapper                                                                                |
| useAnalyticsPresence                    | lib/queries/use-analytics-presence.ts:9                                   | 2                          | 0                 | thin wrapper                                                                                |
| useApprovalDecision                     | lib/queries/use-approval-decision.ts:9                                    | 1                          | 0                 | thin wrapper                                                                                |
| useBackfill                             | lib/queries/use-backfill.ts:15                                            | 1                          | 0                 | thin wrapper                                                                                |
| useBilling                              | lib/queries/use-billing.ts:24                                             | 4                          | 0                 | thin wrapper                                                                                |
| useStartCheckout                        | lib/queries/use-billing.ts:64                                             | 1                          | 0                 | thin wrapper                                                                                |
| useOpenBillingPortal                    | lib/queries/use-billing.ts:78                                             | 1                          | 0                 | thin wrapper                                                                                |
| useChangePlan                           | lib/queries/use-billing.ts:89                                             | 2                          | 0                 | thin wrapper                                                                                |
| useCancelSubscription                   | lib/queries/use-billing.ts:99                                             | 1                          | 0                 | thin wrapper                                                                                |
| useBulkReviewAction                     | lib/queries/use-bulk-review-action.ts:16                                  | 1                          | 0                 | thin wrapper                                                                                |
| useClients                              | lib/queries/use-clients.ts:20                                             | 19                         | 2                 | thin wrapper (60 s poll)                                                                    |
| useArchivedClients                      | lib/queries/use-clients.ts:33                                             | 1                          | 0                 | thin wrapper                                                                                |
| useClient                               | lib/queries/use-clients.ts:41                                             | 3                          | 0                 | thin wrapper                                                                                |
| useClientSetup                          | lib/queries/use-clients.ts:49                                             | 1                          | 0                 | thin wrapper                                                                                |
| useClientHealth                         | lib/queries/use-clients.ts:64                                             | 0                          | 0                 | **dead** (W2-17)                                                                            |
| useOrgHealth                            | lib/queries/use-clients.ts:78                                             | 1                          | 0                 | thin wrapper                                                                                |
| useClientMutations                      | lib/queries/use-clients.ts:87                                             | 6                          | 0                 | thin wrapper                                                                                |
| useConnectionHealth                     | lib/queries/use-connection-health.ts:24                                   | 2                          | 0                 | thin wrapper (60 s poll)                                                                    |
| useStartGoogleConnect                   | lib/queries/use-connection-workspace.ts:14                                | 2                          | 0                 | thin wrapper                                                                                |
| useConnectionWorkspace                  | lib/queries/use-connection-workspace.ts:21                                | 8                          | 0                 | thin wrapper (60 s poll)                                                                    |
| useConnectionsQuery                     | lib/queries/use-connections-query.ts:15                                   | 2                          | 0                 | thin wrapper                                                                                |
| useDeleteReply                          | lib/queries/use-delete-reply.ts:9                                         | 1                          | 0                 | thin wrapper                                                                                |
| useGenerateOrSaveDraft                  | lib/queries/use-draft-mutations.ts:17                                     | 1                          | 0                 | thin wrapper                                                                                |
| useVerifyDraft                          | lib/queries/use-draft-mutations.ts:61                                     | 1                          | 0                 | thin wrapper                                                                                |
| useGoogleAccounts                       | lib/queries/use-google-accounts.ts:13                                     | 4                          | 0                 | thin wrapper                                                                                |
| useGoogleLocations                      | lib/queries/use-google-locations.ts:9                                     | 1                          | 0                 | thin wrapper                                                                                |
| useGoogleVerificationState              | lib/queries/use-google-verification-state.ts:7                            | 2                          | 0                 | inline key outside the roots (W2-05)                                                        |
| useImportReview                         | lib/queries/use-import-review.ts:15                                       | 1                          | 0                 | thin wrapper                                                                                |
| useImportReviewCounts                   | lib/queries/use-import-review.ts:22                                       | 0                          | 0                 | **dead** (W2-17)                                                                            |
| useInvalidateImportReview               | lib/queries/use-import-review.ts:30                                       | 0                          | 2                 | private helper                                                                              |
| useRefreshImportReview                  | lib/queries/use-import-review.ts:41                                       | 1                          | 0                 | thin wrapper                                                                                |
| useDecideImportProposal                 | lib/queries/use-import-review.ts:50                                       | 1                          | 0                 | thin wrapper                                                                                |
| useInvitations                          | lib/queries/use-invitations.ts:9                                          | 1                          | 0                 | thin wrapper                                                                                |
| useResendInvitation                     | lib/queries/use-invitations.ts:17                                         | 1                          | 0                 | thin wrapper                                                                                |
| useListingChangeRequests                | lib/queries/use-listing-change-requests.ts:10                             | 1                          | 0                 | thin wrapper                                                                                |
| useListingSummary                       | lib/queries/use-listing-summary.ts:13                                     | 5                          | 0                 | thin wrapper                                                                                |
| useListingSummaries                     | lib/queries/use-listing-summary.ts:23                                     | 1                          | 0                 | thin wrapper                                                                                |
| useLocationActivity                     | lib/queries/use-location-activity.ts:14                                   | 0                          | 0                 | **dead** (W2-17)                                                                            |
| useLocationActivityPages                | lib/queries/use-location-activity.ts:37                                   | 1                          | 0                 | thin wrapper                                                                                |
| useAdministration                       | lib/queries/use-location-administration.ts:9                              | 1                          | 0                 | thin wrapper                                                                                |
| usePlaceActions                         | lib/queries/use-location-booking.ts:9                                     | 0                          | 0                 | passed by reference as `useResource`                                                        |
| useBusinessInformation                  | lib/queries/use-location-business-information.ts:15                       | 1                          | 0                 | thin wrapper                                                                                |
| useBusinessInformationMetadata          | lib/queries/use-location-business-information.ts:23                       | 2                          | 0                 | thin wrapper                                                                                |
| useLocationCapabilities                 | lib/queries/use-location-capabilities.ts:9                                | 13                         | 0                 | thin wrapper                                                                                |
| useHours                                | lib/queries/use-location-hours.ts:9                                       | 3                          | 0                 | thin wrapper                                                                                |
| useLocationImport                       | lib/queries/use-location-import.ts:35                                     | 1                          | 0                 | thin wrapper                                                                                |
| useIndustry                             | lib/queries/use-location-industry.ts:10                                   | 1                          | 0                 | thin wrapper                                                                                |
| useMedia                                | lib/queries/use-location-media.ts:28                                      | 2                          | 0                 | thin wrapper                                                                                |
| useFoodMenus                            | lib/queries/use-location-menu.ts:9                                        | 1                          | 0                 | thin wrapper                                                                                |
| usePosts                                | lib/queries/use-location-posts.ts:28                                      | 2                          | 0                 | thin wrapper                                                                                |
| useProfileEditor                        | lib/queries/use-location-profile-editor.ts:30                             | 0                          | 0                 | passed by reference as `useResource`                                                        |
| useProfile                              | lib/queries/use-location-profile.ts:9                                     | 3                          | 0                 | thin wrapper                                                                                |
| useLocationDirectory                    | lib/queries/use-locations.ts:28                                           | 18                         | 0                 | thin wrapper                                                                                |
| useMembers                              | lib/queries/use-members.ts:9                                              | 3                          | 0                 | thin wrapper                                                                                |
| useClientAccess                         | lib/queries/use-members.ts:18                                             | 1                          | 0                 | thin wrapper                                                                                |
| useMutationReceipt                      | lib/queries/use-mutation-receipt.ts:38                                    | 1                          | 0                 | thin wrapper (conditional poll)                                                             |
| useNotificationSetting                  | lib/queries/use-notification-setting.ts:9                                 | 1                          | 0                 | thin wrapper                                                                                |
| usePrivacyRequests                      | lib/queries/use-privacy.ts:13                                             | 1                          | 0                 | thin wrapper                                                                                |
| useLegalHolds                           | lib/queries/use-privacy.ts:20                                             | 1                          | 0                 | thin wrapper                                                                                |
| useRetentionStatus                      | lib/queries/use-privacy.ts:27                                             | 1                          | 0                 | thin wrapper                                                                                |
| usePublishReview                        | lib/queries/use-publish-review.ts:9                                       | 1                          | 0                 | thin wrapper                                                                                |
| useReplyPending                         | lib/queries/use-reply-pending.ts:21                                       | 1                          | 0                 | thin wrapper                                                                                |
| useReportShares                         | lib/queries/use-report-shares.ts:10                                       | 1                          | 0                 | thin wrapper                                                                                |
| useResourceMutation                     | lib/queries/use-resource-mutation.ts:106                                  | 9                          | 0                 | useMutation plus invalidate, toast and error mapping; good                                  |
| useReviewCounts                         | lib/queries/use-review-counts.ts:21                                       | 2                          | 0                 | thin wrapper                                                                                |
| useReviewDetail                         | lib/queries/use-review-detail.ts:10                                       | 4                          | 0                 | thin wrapper (settling poll)                                                                |
| useReviews                              | lib/queries/use-reviews.ts:10                                             | 2                          | 0                 | consumer flattens to a new array every render (W2-01)                                       |
| useSession                              | lib/queries/use-session.ts:9                                              | 6                          | 1                 | thin wrapper                                                                                |
| useSessionRole                          | lib/queries/use-session.ts:16                                             | 21                         | 0                 | thin wrapper                                                                                |
| useSettingsCapabilities                 | lib/queries/use-settings-capabilities.ts:9                                | 3                          | 0                 | thin wrapper                                                                                |
| useSettings                             | lib/queries/use-settings.ts:9                                             | 2                          | 0                 | thin wrapper                                                                                |
| useNow                                  | lib/time/server-now.tsx:26                                                | 9                          | 0                 | hydration-safe shared clock; good                                                           |
| useWorkspaceMode                        | lib/workspace/mode.ts:21                                                  | 36                         | 1                 | uSES on the whole QueryCache (W2-12)                                                        |
| useWorkspaceTerms                       | lib/workspace/mode.ts:38                                                  | 4                          | 0                 | returns a new object each call (harmless without memo consumers)                            |

---

## Top 5 for this workstream

1. **W2-01 (P1).** Memoise `reviews` and stop depending on the whole infinite-query result in `inbox-view.tsx`. This fixes scroll-jump on refetch, repeated auto-select `router.replace` calls, observer churn, and memos that never return a cached value.
2. **W2-02 (P1).** Seed `ReplyComposer` during render, or move it onto `useEditorDraft`, so opening a review with a draft is never "dirty" for a commit. That commit likely pushes a leave-guard history entry per review and flickers Publish.
3. **W2-07 (P2).** Add one `useUnsavedChanges` composite and close the wiring gaps:
   - `agency-name-form` has no `beforeunload`;
   - onboarding has no stash;
   - `ClientDetailsForm` and `PolicyForm` stash without ever restoring;
   - the `discarded` latch and the store `discard()` never re-register.
4. **W2-04 / W2-05 (P2).** Fix `usePassedDeadlines` re-arming, and move the administration query keys under `["locations", id]` so access-lost drops them.
5. **W2-09 + W2-11 (P2).** Converge on `useEditorDraft` for all drafts (delete `useResetOnRevision`; restructure onboarding `DraftDetails`), and extract `useReviewedWrite` from the six copy-pasted reviewed-write state machines.

## Cross-layer leads for other workstreams

- **Data / Query:** 28 inline `queryKey: [` literals bypass `lib/queries/keys.ts`. The onboarding keys (`components/setup/onboarding-drafts.tsx:235,248,256`, `onboarding-services.tsx:24`, `onboarding-chain.tsx:24`, `onboarding-categories.tsx:39`, `onboarding-more-hours.tsx:34`, `onboarding-match-link.tsx:34`) and `["organisations"]` (`account-menu.tsx:136`, `agency-name-form.tsx:91`, `policy-form.tsx:289`) are not reset per account by `dropResourceQueries`.
- **Data / Query:** `components/locations/listing-change-requests.tsx:71` invalidates `["locations", locationId]`, the whole per-location subtree, which prefix-matches every tab cache for that location. Check whether that breadth is intended.
- **Performance:** `components/listings/listings-board.tsx:482-488` calls `router.replace` on every search keystroke (W2-06). Each one is a soft navigation.
- **Performance:** `lib/queries/use-clients.ts:28`, `use-connection-health.ts:28`, `use-connection-workspace.ts:27` and `use-connections-query.ts:19` each poll every 60 s while the shell is mounted. Several mount together in the shell (chip, sidebar and banner). Check request volume per open tab.
- **Security / UX:** `lib/editors/use-leave-guard.ts:172-206` permanently monkey-patches `history.pushState` and `history.replaceState` for the life of the page. Any Next.js router upgrade should re-run `tests/components/use-leave-guard.test.tsx` and the back-gesture e2e.
- **A11y / Frontend:** `components/inbox/review-list.tsx:174-182` uses smooth `scrollBy` on rerender, which fights the user's scroll (W2-01). There is no `prefers-reduced-motion` check at that call site.
- **Code style / maintainability:** dense one-line JSX and logic in `components/setup` (104 lines over 160 chars), `components/locations/administration` (70) and `components/locations/profile/sections` (94). Examples: `lifecycle-workspace.tsx:39-80`, `use-place-action-review.ts:10-40`. These files appear to be outside Prettier's normal output; check the format config.
- **Testing:** `tests/components/inbox-leave-guard.test.tsx:21-49` uses a stub composer, so the real `ReplyComposer` seeding sequence through `DirtyGuardProvider` is untested (W2-02).
