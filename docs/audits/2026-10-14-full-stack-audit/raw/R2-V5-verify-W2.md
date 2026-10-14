# R2-V5: adversarial verification of W2 (hooks and state)

**Verifier:** R2-V5, read-only. **Date:** 2026-10-14, HEAD `d8759c74` plus the working tree.
**The only file written:** this one. Two lint probes were piped through `pnpm exec eslint --stdin`. A probe fixture was written to `/tmp`, outside the repo.

**The user's in-progress edits.** Checked with `git diff HEAD`:

- `inbox-view.tsx`: only the controls block moves and classNames change, all after line 746.
- `review-list.tsx`: `ROW_CLASS` plus classNames, which shifts lines by +2 after line 24.
- `reply-composer.tsx`: classNames and the button variant only.

No hook, effect or dependency array changed, so **no verdict below depends on HEAD vs the working tree.** Line numbers are working-tree; HEAD values are given where they differ.

## Verdicts

| ID                 | Verdict                                                                            | Priority       |
| ------------------ | ---------------------------------------------------------------------------------- | -------------- |
| W2-01              | CONFIRMED. The auto-select sub-claim is overstated. Memoising alone is not enough. | P1             |
| W2-02              | CONFIRMED by trace. Needs a runtime test.                                          | P1             |
| W2-03 (lint probe) | **REFUTED as to its cause**                                                        | P3 (note only) |
| W2-04              | CONFIRMED                                                                          | P2 → P3        |
| W2-05              | CONFIRMED, with mitigation noted                                                   | P2 → P3        |
| W2-07              | CONFIRMED, with one addition                                                       | P2 / P3        |

### W2-01: `reviews` identity changes on every render

- **The new array.** `flattenReviews` (`lib/queries/use-reviews.ts:29-33`) is a bare `pages.flatMap`, so it returns a new array on every call. It is used unmemoised at `inbox-view.tsx:195`, in HEAD and in the working tree.
- **`reviewsQuery` is also new on every render.** `useBaseQuery` returns `observer.trackResult(result)` (`@tanstack/react-query/src/useBaseQuery.ts:171`), and `trackResult` returns a `new Proxy(...)` (`query-core@5.101.4/src/queryObserver.ts:267`). So `loadMore` (`:201-205`) is new every render, and the IntersectionObserver (`review-list.tsx:224-236`) is torn down and rebuilt on every render. That part is confirmed. Each rebuilt observer's first callback can call `onReachEnd`, which is guarded by `hasNextPage` and `!isFetchingNextPage`.
- **Auto-select (`:392-409`): overstated.** `autoSelectId` returns `null` as soon as `selected` is set (`lib/inbox/url-state.ts:292`), and also when dirty or not on desktop. Repeat `router.replace` calls can only happen during the short window before the URL commits, and they go to the same href. That is harmless, not a loop.
- **Scroll snap: confirmed and worse than W2 stated.**
  - The effect at `review-list.tsx:174-183` (HEAD `:172-181`) depends on `[selectedId, reviews]`, and `ReviewList` is not memoised. So the effect runs on every `InboxViewInner` render.
  - `scrollIntoNearestScroller` (`:599-621`) smooth-scrolls whenever the selected row is outside the scroller.
  - `InboxViewInner` calls `useNow()` itself (`:139`), which is the 15 s shared tick (`lib/time/clock.ts:7`). So **a desktop operator who scrolls the list away from the selected row is pulled back within ≤15 s, unconditionally.** Desktop always auto-selects row 1, so in practice they are pulled back to the top.
  - It happens within ≤5 s while any row is `publish_requested`: the settling poll (`lib/inbox/settling.ts:18`) flips `isFetching` at `:502`.
  - It also happens on every focus refetch and on counts or health updates.
  - It happens when infinite scroll loads the next page. In that case `reviews` really does change, so **W2's fix 1 (`useMemo`) alone does not stop it.** Fix 3 (scroll only when `selectedId` changes, using a previous-id ref) is required.
  - On a phone the list is hidden while a review is open, so there is no effect there.

### W2-02: phantom dirty commit

- `ReviewDetail` and `ReplyComposer` remount on each selection (`key={state.selected}`, `inbox-view.tsx:874-876`). `body` starts as `""` (`reply-composer.tsx:109`), and `isDirty = body !== seededBody` (`:129`).
- Seeding happens in an effect (`:146-171`), so whenever the review has a draft or a live reply, one commit has `isDirty` true. That holds whether the detail was cached at mount or arrives later.
- **Effect order in that commit:**
  1. `beforeunload` is added (`use-dirty-guard.ts:108-122`).
  2. The seeding effect calls `setBody`.
  3. `useRegisterDirtyGuard` sets the store to dirty and notifies its listeners synchronously (`dirty-context.tsx:86-98,206-214`).
- **The provider renders dirty either way.** Its `useSyncExternalStore` read (`:111-116`) still returns `true`, whether or not React batches it with the `setBody` render, because the composer's corrected registration only runs in a later passive phase. So `useLeaveGuard({when:true})` arms, and `arm()` calls `pushSentinel()` (`use-leave-guard.ts:104-117,208-216`).
- **What the history ends up holding.**
  - The next selection's `router.replace` goes through `kept`. Because the address differs, it drops the markers (`keepMarkers`, `:135-147`), so the sentinel entry becomes the next review's URL.
  - The next phantom arm then pushes again.
  - The net effect is one extra history entry per review opened. Back walks through earlier reviews, because `onPopState` (`:150-166`) only skips the stale sentinel hop.
- **Publish flicker.** `ActionBar` reads `useIsDirty` (`action-bar.tsx:86`) and sees `true` for one commit.
- **Test coverage.** The test stub (`tests/components/inbox-leave-guard.test.tsx:21-49`) uses a fixed `dirty` prop, so this sequence is not tested.

### W2-03 (lint probe): its cause is refuted

- **Probe A.** A ref-guarded `setState` in an effect is not flagged.
- **Probe B.** A plain `if (v) setS(v)` is flagged.
- **Probe C.** The same `reply-composer.tsx`, with only `seededReviewRef.current !== reviewId` replaced, is flagged at `:153` (`set-state-in-effect`).
- **Conclusion.** The compiler _does_ analyse `ReplyComposer`, so this is not a silent bail-out. The rule deliberately exempts `setState` in ref-controlled blocks: `enableAllowSetStateFromRefsInEffects` defaults to `true` (plugin `cjs/…development.js:31649`, `getSetStateCall` `:46430-46530`).
- Bail-outs on unsupported syntax are real compiler behaviour, but W2 gave no evidence that one happens here. Recommend dropping W2-03's claim. Keep a note that the ref-guard idiom exempts code from the rule.

### W2-04: `usePassedDeadlines` arms only one timer

- Confirmed at `verification-saved-workflows.tsx:22-31`. `subscribe` is memoised on `times` and arms a single `setTimeout`, with no re-arm.
- The result drives the stage at `:85`. The server is still authoritative, so this is P3.

### W2-05: inline query keys escape the access-lost drop

- **Confirmed.** These keys sit outside the roots that are dropped:
  - `lifecycle-workspace.tsx:39,48`
  - `verification-saved-workflows.tsx:68`
  - `use-google-verification-state.ts:8`
  - `access-workspace.tsx:49`
- `resourcePrefixesForPath` (`scope-reset.ts:63-79`) only drops the four roots.
- **Mitigation.** A change of scope token runs `resetScopedQueries` over everything. There is no `gcTime` override (`query-client.ts`), so unobserved entries are garbage-collected after 5 min. The real exposure is a mounted or recent workspace, so this is P3.

### W2-07: inconsistent dirty handling

- **Confirmed:**
  - `agency-name-form.tsx:79` uses `useLeaveGuard` only, with no `beforeunload`.
  - `onboarding-drafts.tsx:679-687` hand-rolls `beforeunload` and passes no `onLeave`.
  - `client-settings.tsx:979` and `policy-form.tsx:245` keep the default `stash: true`, but nothing calls `restore`/`take` for those keys. Only `reply-composer.tsx:150` and `use-editor-draft.ts` read stashes.
- **Addition.** The onboarding handler ignores `draftsAbandoned()`, unlike `use-dirty-guard.ts:116`, so a forced sign-out still shows "Leave site?".
- **Severity.** The orphan stashes are tab-scoped `sessionStorage` and are cleared by `clearAllStashedDrafts`/`purgeForeignDrafts`, so their impact is low.
