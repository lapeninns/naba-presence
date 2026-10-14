# Mutations, queries, hooks and state: audit

**Deliverable of the 2026-10-14 full-stack audit.** Scope: client mutations and queries (TanStack Query 5, `@tanstack/query-core@5.101.4`), invalidation and polling, idempotency as seen from the client, custom hooks, client state, dirty and leave guards, and query-key hygiene.

## Scope and method

- **Snapshot.** `main` at `d8759c74`, plus the user's uncommitted work on `feat/inbox-mail-refinement`. Those edits are layout and className only. R2-V5 diffed them and found that no hook, effect, dependency array, query or mutation changed, so no verdict here depends on them. Line numbers are from the working tree.
- **Sources.**
  - `raw/W1-mutations-queries.md` (W1)
  - `raw/W2-hooks-state.md` (W2)
  - `raw/R2-W1b-idempotency-trace.md` (R2-W1b)
  - The verifiers: `raw/R2-V1-verify-W0-W1.md`, `raw/R2-V5-verify-W2.md` and `raw/R2-V2-verify-W3-W5-W6.md`
  - The client-side parts of `raw/W5-frontend-perf.md` (W5-01, W5-02, W5-07)
- **Priority and status.** `VERIFIED_FINDINGS.md` is the source of truth for priority and status. Where a raw report disagrees with it, the ledger and the verifier files win. Findings that are not in the ledger keep their raw agent's status, marked **(raw)**, meaning one agent read the code and nobody re-verified it.
- **How this was done.** Static reading only. No browser, no profiler, no database, no network, and no tests run for this document. A few citations were spot-checked in code: `lib/queries/invalidate.ts`, `use-approval-decision.ts`, `lib/inbox/settling.ts`, `review-list.tsx:174-183` and `lib/contracts/reviews.ts:403-722`.
- **No made-up numbers.** Costs are given as code-derived counts. Where a number needs a live system, the finding says what to measure.

## Summary

| ID              | Title                                                                                                         | Priority | Status                     | Section |
| --------------- | ------------------------------------------------------------------------------------------------------------- | -------- | -------------------------- | ------- |
| W1-F1           | Single-review Approve omits `draftId` and `expectedReviewUpdateTime`                                          | **P1**   | Confirmed                  | §2      |
| W2-01           | `reviews` rebuilt every render; selected-row scroll snap on every inbox re-render                             | **P1**   | Confirmed (R2-V5, widened) | §6      |
| W2-02           | Composer phantom-dirty commit: one extra Back history entry per review opened, plus Publish flicker           | **P1**   | Confirmed by trace         | §6      |
| W1-F2           | Each review write awaits a refetch of detail, every loaded page and all counts (1–3 rounds per press)         | **P1**   | Partially confirmed        | §3      |
| W5-01           | Inbox and listings URL state via `router.replace`/`push`, causing a server page re-run per click or keystroke | **P1**   | Confirmed                  | §6      |
| W1-F3           | Settling poll every 5 s with no bound, over every loaded page and the counts                                  | P2       | Partially confirmed        | §4      |
| W1-F10 (401)    | Background `/api/clients` refetch that gets a 401 hard-redirects to sign-in                                   | P2       | Confirmed                  | §4      |
| W1-F4           | `retry: 1` retries deterministic 4xx failures                                                                 | P2       | Confirmed (config)         | §4      |
| W1-F6 / F7      | Post approve and delete drop the intent; bulk batches have no dedupe. No duplicate Google write               | P2       | Confirmed                  | §5      |
| W5-02           | 15 s clock re-renders the whole inbox; no row memoisation                                                     | P2       | Confirmed                  | §6      |
| W1-F5           | One-press Publish re-enables mid-flow on the stale-evidence path                                              | P2       | Confirmed (raw)            | §2      |
| W5-07           | Google-backed tabs refetch on focus after 30 s; five independent shell polls                                  | P2       | Confirmed in config (raw)  | §4      |
| W2-07           | Dirty and leave guards wired inconsistently across editors                                                    | P2/P3    | Confirmed (+ onboarding)   | §7      |
| W2-06           | Three URL-search implementations; inbox can drop letters; listings writes the URL per keystroke               | P2       | Confirmed in code (raw)    | §6      |
| W2-09 / W2-11   | Four draft-seeding mechanisms; six hand-rolled reviewed-write machines                                        | P2       | Confirmed (raw)            | §9      |
| W1-F8           | Review-write invalidation hand-rolled in five places and drifted                                              | P3       | Confirmed (5 sites, not 6) | §3      |
| W1-F10 (volume) | One polling interval per observer                                                                             | P3       | Partially confirmed        | §4      |
| W1-F9           | Redundant refetches straight after mutations                                                                  | P3       | Confirmed (raw)            | §3      |
| W2-05 / W1-F11  | Location-scoped keys outside the cleared roots                                                                | P3       | Confirmed, mitigated       | §8      |
| W1-F12          | Counts key built in two places; dead `groupBy`                                                                | P3       | Confirmed (raw)            | §8      |
| W2-04           | `usePassedDeadlines` arms only the first timer                                                                | P3       | Confirmed                  | §9      |
| R2-W1b F7-a..d  | Residual local effects of double-started bulk batches                                                         | P3       | Confirmed / Plausible      | §5      |
| W2-03           | "Compiler-backed lint skips complex components"                                                               | —        | **Refuted** (cause)        | §9      |

---

## 1. Mutation inventory

From the W1 scripted inventory (`node -e` over every `useMutation`/`useResourceMutation`) and the R2-W1b trace. "Intent forwarded" means the client sends its own `Idempotency-Key` (`intentId`) and reuses it on retry. Without one, `apiFetch` mints a fresh UUID per call (`lib/api/client.ts:307-310`). No mutation anywhere does an optimistic `onMutate` cache write. This is a deliberate "server-confirmed only" policy (D7, `lib/inbox/actions.ts:141`), so rollback and `cancelQueries` races do not arise.

### Inbox and review

| Mutation (file:line)                                             | Endpoint                                    | Invalidation on success                                                   | Optimistic | Intent forwarded / server dedupe                                                                                                    | Double-submit guard                                                   |
| ---------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `useGenerateOrSaveDraft` `lib/queries/use-draft-mutations.ts:17` | `POST /api/reviews/{id}/drafts`             | detail + `reviews` + `review-counts` + `ai-credits`, **awaited**          | No         | **Yes**, reused after an unconfirmed failure (`:29-44`), giving the generation key (`review-drafts.ts:259`)                         | `isPending` in `saveRef`/`generateRef` (`reply-composer.tsx:245-249`) |
| `useVerifyDraft` `use-draft-mutations.ts:61`                     | `POST /api/drafts/{id}/verify`              | detail + reviews + counts, **awaited**                                    | No         | **No.** The server keys usage by `${requestId}:verification` (`verify/route.ts:109`), so a retry is a second AI call                | `verify.isPending` feeds `sending`                                    |
| `usePublishReview` `use-publish-review.ts:9`                     | `POST /api/reviews/{id}/publish`            | detail + reviews + counts, **awaited**                                    | No         | Fresh per call, but the server key is content-derived `sha256(org:review:generation:bodyHash)` (`publishing/intent.ts:215-224,438`) | `pending={sending}`, with a gap (W1-F5)                               |
| `useApprovalDecision` `use-approval-decision.ts:9`               | `POST /api/reviews/{id}/approval`           | detail + reviews + counts, **awaited**                                    | No         | Sends only `{decision, note}`; **the stale guards are unused** (W1-F1)                                                              | `approval.isPending`                                                  |
| `useDeleteReply` `use-delete-reply.ts:9`                         | `DELETE /api/reviews/{id}/reply`            | detail + reviews + counts, **awaited**                                    | No         | Server key from org + review + reply generation (`publishing/delete.ts:183`)                                                        | `remove.isPending`                                                    |
| `useBulkReviewAction` `use-bulk-review-action.ts:16`             | `POST /api/reviews/bulk`                    | reviews + counts + `clients` + each row's detail (not awaited)            | No         | **No**, and the route ignores intent (`bulk/route.ts:89-99`). Approve is protected by per-row draft and update-time CAS             | `bulk.isPending`                                                      |
| Template batch, client path `template-reply-dialog.tsx:139-232`  | raw `generateOrSaveDraft` + `publishReview` | reviews + counts + clients **at the end only**, no details                | No         | **No** on `generateOrSaveDraft(row.id, {})` (`:155`); publish is content-keyed                                                      | `phase` state                                                         |
| Template batch, engine path `queueBatch`                         | `POST /api/reviews/bulk`                    | as bulk                                                                   | No         | **No**, and there is no server support (W1-F7)                                                                                      | `phase` state                                                         |
| Sync `sync-reviews-button.tsx:29-85`                             | `POST` sync, then a counts `fetchQuery`     | reviews + counts + clients awaited, **then counts fetched again** (W1-F9) | No         | Server lock (`skipped`)                                                                                                             | local `pending`                                                       |

### Other surfaces

| Mutation                                                                                                                                                         | Endpoint                                   | Invalidation                                                            | Intent forwarded / server dedupe                                                    | Guard                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------ |
| Post publish `posts-action-bar.tsx:179-183`                                                                                                                      | `.../posts/{id}/publish`                   | `useResourceMutation` (not awaited, `use-resource-mutation.ts:151-156`) | **Yes**; content-keyed                                                              | `isPending`                    |
| Post approve `posts-action-bar.tsx:192-196`                                                                                                                      | `POST .../posts/{id}/approval`             | `useResourceMutation`                                                   | **No**; content-keyed publish, receipt only (W1-F6)                                 | `isPending`                    |
| Post delete `posts-action-bar.tsx:208-209`                                                                                                                       | `DELETE .../posts/{id}`                    | `useResourceMutation`                                                   | **No**, and the server **uses** it for the attempt key (W1-F6)                      | `isPending`                    |
| Hours / profile / menus publish (`hours-tab.tsx:308`, `profile-editor.tsx:468`, `menu-tab.tsx:166`, `review-publish.tsx:176,244,288`)                            | `runGbpWrite` routes                       | `useResourceMutation` / `usePublishFlow`                                | **Yes**                                                                             | `isPending`, revision CAS      |
| Media add / update / delete, listing-change decisions (`listing-change-requests.tsx:52`)                                                                         | media, listing-changes routes              | `useResourceMutation`                                                   | **Yes**                                                                             | `isPending`                    |
| Business info / attributes / industry (`saved-listing-reviews.tsx:39`, `use-service-review.ts:67`, `saved-attribute-reviews.tsx:35`, `use-lodging-review.ts:73`) | `.../business-information`, `.../industry` | hand-rolled `run()` (W2-11)                                             | No, which is harmless: deduped on `changeSetId` (`business-information.ts:201-209`) | `claim` ref                    |
| Local saves (hours, menu, profile, post create)                                                                                                                  | various                                    | `useResourceMutation`                                                   | No; revision CAS instead, which is acceptable                                       | `isPending`                    |
| Settings, billing, client, onboarding, members                                                                                                                   | plain DB writes                            | mostly `useResourceMutation`; some hand-rolled                          | No; not needed for plain writes                                                     | `isPending`                    |
| `createPlaceAction`/`updatePlaceAction`/`deletePlaceAction` (`lib/api/location-booking.ts`)                                                                      | `.../place-actions`                        | —                                                                       | —                                                                                   | **No callers** (dead wrappers) |

Defaults (`lib/queries/query-client.ts:4-24`): queries use `staleTime 30s`, `retry 1`, `refetchOnWindowFocus true` and `networkMode offlineFirst`; mutations use `retry 0`. Hydration is clock-skew aligned (`hydration-boundary.tsx:26-50`), and that part is sound.

---

## 2. Approval and publish correctness

### W1-F1: Single-review Approve skips the stale-draft and stale-review guards the server provides

- **Priority:** P1. Approval is the human checkpoint before a Google write.
- **Status:** Confirmed (coordinator). The exploit window is plausible.
- **Location:**
  - `lib/queries/use-approval-decision.ts:14-15`
  - `components/inbox/action-bar.tsx:224` (`approval.mutateAsync({ decision, note })`)
  - Server: `lib/contracts/reviews.ts:699-713`, `lib/server/review-approval.ts:113-157` (guards at `:121,149`)
- **Current implementation and evidence:**
  - `approvalInputSchema` accepts an optional `draftId` and an optional `expectedReviewUpdateTime`:
    - A stale `draftId` gets 409 `approval_draft_changed`.
    - A stale `expectedReviewUpdateTime` gets 409 `review_changed`.
  - When neither is sent, the server approves `pending_draft_id ?? latest_draft_id`, which is the draft parked _now_.
  - Bulk approve always sends both (`app/api/reviews/bulk/route.ts:238-246`). The single-review path, which is the commonest approval, sends neither.
  - The approver's pane can be at least 30 s stale (`staleTime`), and there is no settling poll while `awaiting_approval`.
  - Failure case: the author withdraws, edits and resubmits after the approver opened the review. The approver's click then approves text they never saw.
  - The contract comment says "the server-side binding protects that case on its own". That is only true for the parked-draft identity, not for what was displayed.
- **Root cause:** the hook's input type predates the guards, and the schema keeps both fields optional for backward compatibility.
- **Recommendation:**
  - Send `draftId: review.reply?.pendingDraftId ?? publishableDraft(review.drafts)?.id` and `expectedReviewUpdateTime: review.updateTime` from `ActionBar`. These are the same values `onPublish` already uses at `:160-166`.
  - Widen the `useApprovalDecision` input type to match.
  - On either 409, refetch the detail and show the existing copy (`lib/errors/action-errors.ts:205,218`).
  - Follow-up: make both fields **required** in `approvalInputSchema` once all clients send them. There is no external client, so this can ship in the same release.
  - Alternative: the server rejects an approval whose parked draft changed after the approver's last detail read. That needs read tracking, so it is not recommended.
- **Expected benefit:** an approval is bound to the text that was displayed, matching bulk. This closes the only path where approval and displayed content can diverge.
- **Complexity:** S. **Regression risk:** Low (the copy and codes exist).
- **Tests/verification:**
  - In the `action-bar` component test, assert the approval request body carries both fields.
  - Route test: a stale `draftId` gets 409 `approval_draft_changed`, and a stale update time gets 409 `review_changed`.
  - Schema test once the fields are required.
- **Dependencies:** none. Land it before the §3 response-patching work, because that work will carry `updateTime` in the mutation responses.

### W1-F5: One-press Publish re-enables the button mid-flow (stale-evidence path)

- **Priority:** P2. **Status:** Confirmed (raw, W1).
- **Location:** `components/inbox/action-bar.tsx:177-192, 274-275`; the hotkey at `:96-113`.
- **Current implementation and evidence:**
  - `sending = checking || publish.isPending`, where `checking = composerSave?.saving || verify.isPending`.
  - On `stale_draft_evidence`, after `verify` resolves the code awaits `detail.refetch()`. During that await all three flags are false, so the button and the `a` hotkey can start a second `onPublish`.
  - The Google write is deduped by the content key. The risk is a duplicate verification AI call, interleaved toasts and a duplicate draft save.
- **Root cause:** busy state is derived from per-mutation flags, not held across the whole multi-step flow.
- **Recommendation:**
  - Hold a `busy` ref and state across the entire `onPublish`, as `use-place-action-review.ts:27` does with `claim.current`.
  - Drop the `detail.refetch()` (W1-F9): `verify`'s `onSuccess` already refreshed that key, so read it with `queryClient.getQueryData(queryKeys.reviewDetail(id))`.
- **Expected benefit:** one flow per press, and one fewer detail GET on the stale path.
- **Complexity:** S. **Regression risk:** Low.
- **Tests/verification:** drive the stale path with a deferred verify. Fire a second press or the `a` key during the gap and assert that `publish`/`verify` were each called once.
- **Dependencies:** none. It is subsumed by the `useReplyActions` redesign below if that lands first.

### Cross-reference: W6-03 (user publish retry without a status check)

The ledger lists this as P2, Plausible, owned by the security deliverable. The same idempotency key means no duplicate external reply. It is noted here only because any change to `onPublish` retry behaviour should keep the key derivation intact.

---

## 3. Invalidation and refetch design

### W1-F2: Each review write blocks on a refetch of detail, every loaded page and all counts

- **Priority:** P1. Latency on the core action, plus DB load.
- **Status:** Partially confirmed (R2-V1). The mechanics are exact; the round count is 1–3, not 2–4.
- **Location:**
  - `lib/queries/invalidate.ts:13-21` (awaited `Promise.all` over detail, `reviewsAll` and `reviewCountsAll`)
  - Used as `onSuccess` by `use-publish-review.ts:16`, `use-approval-decision.ts:16`, `use-delete-reply.ts:15`, and `use-draft-mutations.ts:48-54` (which also awaits `aiCreditsAll`) and `:66`
  - `use-reviews.ts:11-26` (infinite query, no `maxPages`)
- **Current implementation and evidence:**
  - TanStack awaits `onSuccess` before `mutateAsync` resolves (`mutation.js:123`).
  - `invalidateQueries` refetches active matches with `cancelRefetch: true`.
  - An infinite refetch walks **every cached page in sequence** (`infiniteQueryBehavior.js:64-72`), and the inbox loads continuously.
  - So after k pages, each successful write holds "Publishing…" for 1 detail read, k sequential `/api/reviews` reads and one read per active counts key.
  - Rounds per press (R2-V1, from `action-bar.tsx:149-192`):

    | Path                           | Refetch rounds                |
    | ------------------------------ | ----------------------------- |
    | Verified draft, clean composer | 1                             |
    | Save then publish              | 2                             |
    | `stale_draft_evidence` path    | 3, plus one extra detail read |

- **Root cause:** list and count freshness is awaited as if it were part of the write. The mutation responses (`publishResultSchema`, `approvalResultSchema` and `deleteReplyResultSchema`, at `lib/contracts/reviews.ts:675-722`) carry only status fields, not the updated row, so the client has nothing to patch with.
- **Recommendation:** adopt the invalidation map and scoped patching below.
  - (a) The **minimal step** (S): await only the detail, and fire-and-forget lists and counts. This matches `useResourceMutation` (`use-resource-mutation.ts:151-156`).
  - (b) The **target**: patch from the response (M, needs the contract change).
  - Alternative: `maxPages` on `useReviews`. This is weaker. Without `getPreviousPageParam`, evicted pages cannot be restored on scroll-back, so the inbox would need a bidirectional cursor first.
- **Expected benefit:** press-to-outcome becomes the write round trip plus at most one detail read, instead of writes × (1 + k + counts) reads. **Measure:** a client span around `onPublish`, with an attribute counting `/api/reviews` requests per press. No such span exists today (W7-1).
- **Complexity:** S for (a); M for (b). **Regression risk:** Medium. `use-reply-pending.ts` (status line) and the footer must still agree, and the advance-after-publish listener reads the refreshed detail.
- **Tests/verification:**
  - A hook test that `mutateAsync` resolves before a deferred list refetch resolves.
  - An `inbox-view` test that the row's pill changes after publish without a list GET.
  - The existing `inbox-view` and `review-detail` suites stay green.
- **Dependencies:** W1-F1 first (shared `ActionBar` edits). W1-F3 builds on the patching helper.

### W1-F8: Review-write invalidation is hand-rolled in five places and has drifted

- **Priority:** P3. **Status:** Confirmed (5 sites, R2-V1).
- **Location:**
  - `lib/queries/invalidate.ts:13-21`: no `clientsAll`
  - `use-bulk-review-action.ts:20-26`: adds clients and details
  - `template-reply-dialog.tsx:126-130`: **no details**, so the open pane stays stale after a batch touching it
  - `sync-reviews-button.tsx:44-46`
  - `use-clients.ts:95-96`: adds `locations`
- **Evidence:** `ClientSummary.needsReply` (`lib/contracts/clients.ts:78`) drives the client badges. A single publish, approve or delete does not refresh it, so the badges lag the rail by up to the 60 s poll.
- **Root cause:** no shared module-level helper. `useInvalidateReviewWrites` is a hook bound to one review id, so non-hook and bulk sites copied its key list instead.
- **Recommendation:** replace all five sites with the single `applyReviewWrites` helper in the invalidation map below. Test that it reaches all four roots.
- **Expected benefit:** client badges, rail and list agree after any write. The F2 fix becomes a change in one place.
- **Complexity:** S. **Regression risk:** Low.
- **Dependencies:** lands with the F2 work.

### W1-F9: Redundant refetches straight after mutations

- **Priority:** P3. **Status:** Confirmed (raw).
- **Locations:**
  - `action-bar.tsx:186` `await detail.refetch()`, right after `verify`'s awaited invalidation of the same key (see W1-F5).
  - `sync-reviews-button.tsx:44-60`: an awaited invalidate of counts, then `fetchQuery({ staleTime: 0 })` on the same key.
  - `photos-library.tsx:57-74`: `setQueryData` seeds a key, then `invalidate: [locationMediaAll]` prefix-matches and refetches it.
  - `location-access-form.tsx:72-77` and `client-access-dialog.tsx:204-208`: `setQueryData(memberClientAccess)` followed by invalidating `["members"]`, which prefix-matches the seeded key (`keys.ts:144-145`).
- **Recommendation:**
  - Read with `getQueryData` after the awaited invalidation.
  - Where a key was just seeded, use an invalidation `predicate` that excludes it.
- **Complexity:** S each. **Regression risk:** Low. **Tests:** count GETs in each flow's existing test.

### Proposed per-entity invalidation map

One module, `lib/queries/invalidate.ts`, exports plain functions taking a `QueryClient`, so hooks, dialogs and bulk code all share it. Rules:

1. **Patch what the response describes.**
2. **Await only what the next frame shows.**
3. **Mark everything else stale without refetching**, unless it is cheap and on screen.

| Write (entity → event)                           | Patch from response (`setQueryData`/`setQueriesData`)       | Awaited                                         | Background invalidate (not awaited)                                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Review: draft generate or save                   | `reviewDetail(id)` ← `detail`; rows in `reviewsAll` ← `row` | none                                            | `reviewCountsAll`; `aiCreditsAll` (generate only)                                                                                         |
| Review: verify                                   | `reviewDetail(id)` ← `detail`; row ← `row`                  | none                                            | `reviewCountsAll`                                                                                                                         |
| Review: publish, approve/reject, delete reply    | `reviewDetail(id)` ← `detail`; row ← `row`                  | none                                            | `reviewCountsAll`; `clientsAll` (`needsReply`); `reviewsAll` with `refetchType: "none"` (membership is reconciled on next mount or focus) |
| Review: bulk action or template batch (engine)   | none (async)                                                | none                                            | `reviewsAll` (active), `reviewCountsAll`, `clientsAll`, `reviewDetail(id)` for each affected id that is cached                            |
| Review: template batch (client path), per row    | row and detail per row, as for publish                      | none                                            | once at the end: counts, clients                                                                                                          |
| Reviews: sync                                    | none                                                        | `reviewCountsAll` (the button shows the result) | `reviewsAll`, `clientsAll`. Drop the second `fetchQuery`                                                                                  |
| Post: publish, approve, delete                   | `locations[id].posts` row ← response when present           | none                                            | the posts list and listing summary for that location                                                                                      |
| Location resource (hours, profile, menus, media) | resource ← response (as photos do today)                    | none                                            | the resource family, **excluding the seeded key** (`predicate`)                                                                           |
| Members / client access                          | `memberClientAccess` ← response                             | none                                            | `members` with a predicate excluding the seeded key                                                                                       |
| Organisation rename                              | `queryKeys.organisations` ← response                        | none                                            | session                                                                                                                                   |

Sketch:

```ts
// lib/queries/invalidate.ts
export function applyReviewWrite(
  client: QueryClient,
  result: ReviewWriteResult
) {
  const { row, detail } = result
  if (detail) client.setQueryData(queryKeys.reviewDetail(row.id), detail)
  else
    void client.invalidateQueries({ queryKey: queryKeys.reviewDetail(row.id) })
  client.setQueriesData<InfiniteData<ReviewsPage>>(
    { queryKey: queryKeys.reviewsAll },
    (data) => data && patchRow(data, row) // replace by id; keep position; skip if cached row is newer
  )
  void client.invalidateQueries({ queryKey: queryKeys.reviewCountsAll })
  void client.invalidateQueries({ queryKey: queryKeys.clientsAll })
  void client.invalidateQueries({
    queryKey: queryKeys.reviewsAll,
    refetchType: "none",
  })
}
```

Design choices:

- **Rows that no longer match the active filter stay in place** with their new status until the next natural refetch. Rows do not jump out from under the operator. This matches how the inbox treats a just-published row today; check it against the advance-after-publish listener.
- **Ordering guard.** `patchRow` must not overwrite a row the settling poll refreshed more recently. Compare a monotonic version (see the contract below) and keep the newer one.
- **Failure.** On a non-2xx response nothing is patched (there are no optimistic writes). On 409 conflict codes, invalidate the detail so the pane shows current text.

**Server contract changes required:**

1. **Return the row.** `publishResultSchema`, `approvalResultSchema`, `deleteReplyResultSchema`, `draftResultSchema` and `verifyResultSchema` gain `review: reviewRowSchema` (`lib/contracts/reviews.ts:403-407` item shape). The route must build it with the **same projection function the list route uses**, so list and patch cannot drift. That costs one read by id after commit.
2. **Optionally return the detail.** Add `detail: reviewDetailSchema` where the route already has it, or a `detailVersion` so the client knows whether to refetch. Phase 1 can patch the row and invalidate the detail. Detail invalidation is a single GET, so the gain from returning it is small.
3. **A monotonic version on `reviewRowSchema`.** For example, the local row's `updated_at` (not Google's `updateTime`) as `rowVersion`, so patches and polls can be ordered.
4. **Keep the existing status fields** for `use-reply-pending.ts` and the toasts. They are additive, so old clients are unaffected.
5. **Posts.** Approve and delete should return the post row in the same way (they do partially; confirm per route).

---

## 4. Polling and background-refetch policy

### W1-F3: Settling poll every 5 s with no bound, over every loaded page and the counts

- **Priority:** P2 (R2-V1 downgrade from P1). **Status:** Partially confirmed.
- **Location:**
  - `lib/inbox/settling.ts:18-37` (`SETTLING_POLL_MS = 5_000`; "Deliberately unbounded")
  - `use-reviews.ts:20-25`, `use-review-counts.ts:38-43`, `use-review-detail.ts:18-19`
  - `lib/server/review-counts.ts:49-109`
- **Current implementation and evidence:**
  - The list polls every 5 s while any loaded row is `publish_requested`, and each tick refetches all k pages.
  - The counts poll keys on `byStatus` for the user's **visible** locations. That is not literally the organisation (R2-V1), but it includes colleagues' in-flight publishes.
  - The detail polls too. Three `useReviewDetail` observers per open review (`review-detail.tsx:1008`, `reply-composer.tsx:90`, `action-bar.tsx:75`) collapse to one request through in-flight dedupe.
  - Each counts request costs:
    - always: the settings read, the totals with N `count(*) filter`, and `group by workflow_status`;
    - sometimes: `requireLocationAccess` and the `groupBy` query;
    - per request: the session select and update and the billing read.
  - Mitigations: hidden tabs don't poll; publish runs inline; and the minute recovery cron settles stragglers, so in practice the poll is short-lived.
- **Root cause:** settling is detected from list data, so the list must poll to notice a change. The "never stop" rule was chosen so a stuck publish visibly turns `failed`.
- **Recommendation:**
  1. **Track in-flight ids, not statuses.** A small session store (`pendingPublishIds`) is filled from publish and approve responses (`status === "publish_requested"`) and from a detail fetched in that state.
  2. **Poll the detail only** for those ids. Patch the list row with `applyReviewWrite`'s `patchRow`. Remove `refetchInterval` from `useReviews`.
  3. **Bound it with back-off:** 5 s → 15 s → 60 s, then stop after a cap and show "Still sending: refresh to check". This copies `use-mutation-receipt.ts:19-28`. The server cron still settles the row, and the next focus or mount shows `failed`. That preserves the intent of the `settling.ts` comment without polling forever. The cap is a product decision (see Open questions).
  4. **Counts poll** only while `pendingPublishIds` is non-empty, not on `byStatus`.
  5. Server lead (W4-06): fold the `byStatus` aggregate into the totals scan.
- **Expected benefit:** steady-state reads while settling fall from k list pages + counts + detail per 5 s tick to one detail read per in-flight review per tick, and polling ends. **Measure:** `/api/reviews` and `/api/reviews/counts` request rate per session from route spans, before and after.
- **Complexity:** M. **Regression risk:** Medium. The settling UX has regressed before (`settling.ts` header).
- **Tests/verification:**
  - A unit test of the back-off schedule and cap.
  - An inbox test that a settled detail updates the list row with no list GET.
  - A test that a colleague's `publish_requested` row does not start the counts poll.
- **Dependencies:** W1-F2 (the patch helper and the `rowVersion` contract).

### W1-F10 (401): A background refetch that gets a 401 redirects to sign-in

- **Priority:** P2. **Status:** Confirmed (R2-V1).
- **Location:**
  - `lib/queries/use-clients.ts:20-29` (`queryFn: ({ signal }) => fetchClients(signal)`), `lib/api/clients.ts:14-18`
  - `lib/api/client.ts:351-355`
  - Same gap in `use-ai-credits.ts:11,18` (no signal either), `account-menu.tsx:137` and `use-report-shares.ts:13`
- **Evidence:** without `background: true`, `apiFetch` treats the 60 s poll or a focus refetch as foreground. A 401 then runs `handleUnauthorized()`, which stashes drafts and hard-navigates. This contradicts the documented rule (`client.ts:288-301`, `request-options.ts:6-17`).
- **Root cause:** these readers predate `requestOptions(ctx)`, which derives `background` from "the query already holds data".
- **Recommendation:**
  - Every `queryFn` passes `requestOptions(ctx)`.
  - Change the `lib/api` reader signatures from `(signal)` to `(options?: RequestOptions)` so the type system enforces it.
  - Optionally add a lint rule that `queryFn` must reference `requestOptions`.
- **Expected benefit:** an expired session on an idle tab no longer yanks the operator to sign-in mid-edit. The foreground path still does.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** a refetch of `useClients` passes `background: true`, and a mocked 401 does not call `handleUnauthorized`.

### W1-F4: `retry: 1` retries deterministic 4xx failures

- **Priority:** P2. **Status:** Confirmed (config, R2-V1).
- **Location:** `lib/queries/query-client.ts:8`; `lib/api/client.ts:348-364`.
- **Evidence:**
  - A 400/403/404/409/422 read is re-sent after 1 s, so error states for a deleted review or a hidden location appear 1 s late.
  - Each failed attempt runs `reportAccessLost`.
  - R2-V1: a foreground 401 hard-navigates on attempt one, so the double side effect rarely matters.
  - The two observers of the org counts key carry different `retry` options (W1-F12), so the effective policy depends on which one fetched last.
- **Recommendation:** `retry: (n, e) => n < 1 && !(e instanceof ApiClientError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429)`.
- **Expected benefit:** immediate error states, and no duplicate `reportAccessLost`.
- **Complexity:** S. **Regression risk:** Low.
- **Tests:** unit-test `makeQueryClient().getDefaultOptions().queries.retry` with 404 → false, 503 → true and 429 → true.

### W1-F10 (volume) and W5-07: Shell polls and focus refetch of Google-backed tabs

- **Priority:** P3 for per-observer volume (R2-V1). W5-07 is P2 (raw).
- **Status:** Partially confirmed (volume) / Confirmed in config (raw).
- **Location:**
  - Five 60 s shell polls: `use-clients.ts:28`, `use-connections-query.ts:19`, `use-connection-health.ts:28`, `use-needs-reply-count.ts:25`, `notifications-link.tsx:28`.
  - Google-backed hooks with default `staleTime` and focus refetch: `use-location-hours.ts:11`, `use-location-profile.ts:11`, `use-location-menu.ts:11`, `use-location-booking.ts:10`, `use-location-media.ts:39`, `use-location-posts.ts:29`, `use-location-business-information.ts:16,24`.
- **Evidence:**
  - Each observer owns its own interval (`queryObserver.js:208-218`). In-flight dedupe collapses observers that mounted in the same commit. Extra requests equal the number of distinct mount moments (navigation, palette or sheet opened), not about 13 (R2-V1).
  - The five shell queries are distinct keys, so an idle visible tab makes about 5 API requests a minute. Each one goes through `getSession()` and its `last_seen_at` UPDATE (W0-05).
  - Google-backed tabs "cost 3–5 s per request" (`docs/architecture.md:1360-1366`). After 30 s away, a focus triggers a live Google read for each mounted one (W3-2).
- **Recommendation:**
  - **Shell:** one `useShellStatus` poller mounted once in the shell. Phase 1 puts a single observer on each key with `refetchInterval`, and the others subscribe without it. Phase 2 merges the five into one `GET /api/shell-status` (clients summary, connection health, needs-reply count, unread notifications). That needs a new route plus a contract, and the per-key caches are seeded from it with `setQueryData`.
  - **Google-backed tabs:** `staleTime: 5 min` and `refetchOnWindowFocus: false`, relying on the explicit invalidation after writes, which `useResourceMutation` already does. Check that editors do not reseed on background refetch (`useEditorDraft` raises `incoming`, which is correct).
- **Expected benefit:** about 5 → 1 shell request per minute per visible tab in phase 2 (a code-derived count), and no live Google read per focus. **Measure:** `/api/*` requests per session-minute; Google-call counters per focus event.
- **Complexity:** S (Google tabs, phase 1 shell); M (phase 2). **Regression risk:** Low–Medium (freshness expectations on the connections page).
- **Tests:** query-defaults unit tests per hook; a shell test asserting one interval owner.
- **Dependencies:** W0-05 (the session write) reduces the per-request cost independently.

### Policy summary

| Concern           | Policy                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Settling          | Detail-only poll for in-flight ids; back-off 5/15/60 s; a cap, then a stale label; list patched, never polled |
| Shell             | One poller (phase 1), one endpoint (phase 2); hidden tabs paused (the existing default)                       |
| Google-backed     | `staleTime` 5 min, no focus refetch; invalidated by writes                                                    |
| Background errors | Every `queryFn` goes through `requestOptions(ctx)`; a background 401 never navigates                          |
| Retry             | 0 for 4xx except 408 and 429; 1 otherwise; mutations stay `retry: 0`                                          |

---

## 5. Idempotency gaps

**Overall verdict (R2-W1b, ledger C):** there are **no duplicate Google writes**. The layers that stop them:

- the content-derived publish keys;
- the unique `(organisation_id, idempotency_key)` on `publish_attempt` (`0001_initial.sql:283`);
- `insertAttempt ... on conflict do nothing` (`attempt.ts:242`);
- Google's reply `PUT` upsert.

The remaining harm is false errors on retry-after-success, plus duplicate local rows.

### W1-F6: Post approve and post delete don't forward the intent

- **Priority:** P2. **Status:** Confirmed (coordinator, R2-W1b).
- **Location:**
  - `components/locations/posts-action-bar.tsx:192-196, 208-209`
  - `lib/api/location-posts.ts:71-90` (no `MutationOptions`)
  - Server: `lib/server/posts.ts:1290-1297, 1372, 1403-1416, 1926-2047`
- **Evidence (R2-W1b):**

  | Scenario            | Delete                                                                                                                                             | Approve                                                                                                                                     |
  | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
  | Retry after success | `loadPost` filters `status <> 'deleted'` (`:630`), so **404 `post_not_found`** for a delete that worked                                            | `requirePendingDecision` returns **409 `approval_not_pending`** after a successful approve-and-publish                                      |
  | Concurrent retry    | Two keys, so **two Google DELETEs**. The second gets a 404 that is swallowed as success. Two attempt rows, two receipts, two `post.deleted` audits | Row locked, but status unchanged in the decide transaction, so a **second decision and a second audit row**. One Google write (content key) |
  | Draft-only post     | Plain update; retry gives 404                                                                                                                      | —                                                                                                                                           |

- **Root cause:** the wrappers don't accept `MutationOptions`, and `useResourceMutation`'s reused intent is computed and then discarded. Even with the intent, the replay lives inside `runGbpWrite` (`gbp-write.ts:962-985`). It is not checked at the route level, so retry-after-success still fails before the replay check runs.
- **Recommendation:**
  1. Add `options: MutationOptions` to `decidePostApproval` and `deletePost`, and pass `{ intentId }` (as `publishPost` does at `:178-183`).
  2. Implement **"already done = success" semantics** (below) for both routes.
  3. Optionally move the post to a transitional status inside the decide transaction, so a concurrent second approve gets `approval_not_pending` rather than writing a duplicate decision.
- **Expected benefit:** no error toast for a destructive action that succeeded; one audit and decision row per user action.
- **Complexity:** S (client) + S–M (server). **Regression risk:** Low.
- **Tests:**
  - A retry after `network_error` reuses the `Idempotency-Key` (mirror the existing publish test).
  - Route: deleting an already-deleted post under the same intent returns 200 with `{status:"deleted"}`.
  - Route: approve-after-approve by the same user and revision returns the settled outcome.
- **Dependencies:** none.

### W1-F7: Bulk template and approval batches have no submission dedupe

- **Priority:** P2. **Status:** Confirmed (no duplicate Google write; the residuals are below).
- **Location:**
  - `template-reply-dialog.tsx:180-198` (`queueBatch`)
  - `lib/server/bulk-reviews.ts:115-135, 276-353`
  - `app/api/reviews/bulk/route.ts:89-99`
  - `0130_bulk_review_families.sql:79` (unique per batch only)
- **Evidence:** `insertBatch` always inserts. A retry after a lost response (120 s `maxDuration`) or a second tab creates a second batch over the same reviews. The guard chain:
  - the planning skip;
  - the dispatch-time `template_review_busy`/`template_has_reply`;
  - the content key.

  This chain absorbs the Google side, even for two children claimed in the same tick (`claim_due_bulk_children` allows 2 per org, `0131:22`).

- **Residual local effects (R2-W1b):**

  | ID   | Effect                                                                                                                           | Status             | Priority |
  | ---- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------- |
  | F7-a | A double-started bulk approve writes two `approval_decision` rows and two audit rows                                             | Confirmed by trace | P3       |
  | F7-b | Review left `verified` with a second draft while its reply is live (the replay never restores `published`, `publish.ts:150-153`) | Plausible          | P3       |
  | F7-c | Each concurrent template child pays for its own AI verification (`review-drafts.ts:383-400`)                                     | Confirmed          | P3       |
  | F7-d | Bodies differ if the default language changed between phase ones, giving a second `PUT` overwrite                                | Hypothesis, narrow | P3       |

- **Root cause:** batch creation has no submission identity, and children have no per-review exclusivity across batches.
- **Recommendation:**
  - At plan time in `startBulkTemplateReplies` and `startBulkReviewApprovals`, skip any review with a live child elsewhere (`exists (… bulk_listing_child c where c.review_id = r.id and c.status in ('queued','running','ambiguous'))`), giving `review_busy`. Optionally back this with a partial unique index on `bulk_listing_child(review_id) where status in ('queued','running')`.
  - Forward `Idempotency-Key` from `queueBatch` and store it on `bulk_listing_operation` with `unique (organisation_id, intent_id)`. A retry then returns the **first batch's id**, not a "skipped" list.
  - For F7-b alone, re-check `hasReply` in `createReviewDraft`'s settle transaction when `templateOnly`.
- **Expected benefit:** closes F7-a, F7-b and F7-c in one change.
- **Complexity:** M (migration plus route). **Regression risk:** Low.
- **Tests:** two identical starts give one batch id; a review in a running batch is reported `review_busy` by a second batch.
- **Dependencies:** the jobs runner owner (W8).

### Other intent gaps (R2-W1b §3)

| Client call                                                       | Server uses intent?                  | Forwarded? | Action                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------- |
| `template-reply-dialog.tsx:155` `generateOrSaveDraft(row.id, {})` | Yes (generation key)                 | **No**     | Forward the intent. A retry today makes a second draft and a second billed verification (P3)       |
| `use-draft-mutations.ts:61` `verifyDraft`                         | **No** (`${requestId}:verification`) | No         | Server: key verification usage on the intent or on `(draftId, evidenceHash)`, then forward it (P3) |
| `queueBatch` → `POST /api/reviews/bulk`                           | **No**                               | No         | W1-F7                                                                                              |
| Business info, attributes, industry                               | No (`changeSetId`)                   | No         | None; harmless                                                                                     |
| Place-action wrappers                                             | —                                    | —          | Delete (no callers)                                                                                |

### "Already done = success" semantics

Rule for every intent-aware route: **a retry that finds the requested end state already reached, by the same intent or by an equivalent action, returns 2xx with the settled outcome, never a 404 or 409.**

| Route                            | "Already done" condition                                                                                      | Response                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Post delete                      | A receipt or attempt exists under this intent, **or** the row is `deleted` (check before `loadPost`'s filter) | 200 `{ status: "deleted" }`          |
| Post approve                     | Post `published` at `expectedRevision`, and the latest decision is this user's `approved` for that revision   | 200 with the settled publish outcome |
| Review approve (single and bulk) | `pending_draft_id` already approved by this user for the same `draftId`                                       | 200 `{ status, idempotent: true }`   |
| Review publish                   | Same content key `succeeded` (already the case: `intent.ts:233-260`)                                          | unchanged                            |
| Bulk start                       | Same `(organisation_id, intent_id)`                                                                           | 200 with the first batch's id        |

Client fallback where the server cannot tell: on `approval_not_pending`/`post_not_found` after a `network_error` retry, refetch, and if the state matches the intended end state, show success.

**Systemic fix (P3):** make `MutationOptions` a **required** parameter on every `lib/api` wrapper whose route is intent-aware, so a forgotten intent fails typecheck. Add one route test per intent-aware route proving that a same-key retry makes no second provider call.

---

## 6. Hooks inventory summary and the inbox render/scroll cluster

### Inventory summary (from W2)

- **Counts.** 188 custom hook definitions across `app/`, `components/` and `lib/`; about 77 are in `lib/queries`, most of them thin TanStack wrappers.
- **Totals over 363 hook-using files:** 675 `useState`, 153 effects, 194 `useRef`, 55 `useMemo` and 69 `useCallback`.
- **No `React.memo`, and no React Compiler.** Manual memos matter only in dependency arrays, context values and `useSyncExternalStore` subscribe functions.
- **Lint.** `react-hooks` 7.1.1 is recommended at error level (exhaustive-deps is blocking under `--max-warnings 0`). There are two `eslint-disable` lines for hooks, both justified and both natural `useEffectEvent` cases.
- **Strong primitives to standardise on:**
  - `useEditorDraft` (render-phase seed, conflict `incoming`, stash)
  - `useLeaveGuard`
  - `useNow`/`useDeadline`/`useHydrated` (`useSyncExternalStore`)
  - `useDebouncedSearchParam`
  - `useResourceMutation`
- **Dead or duplicate code:**
  - Dead hooks: `useReveals`, `useClientHealth`, `useImportReviewCounts`, `useLocationActivity`, plus `useKeyboardInset` (used only in tests).
  - The deprecated `useVerificationExpiry` alias.
  - Name collisions: `useNow` (×2) and `useSelection` (×2).
- **Hotspots by hook density:** `InboxViewInner` (957 LOC, 51 hook calls, 14 refs) and `DraftDetails` (717 LOC, 32 `useState`).

### W2-01: `reviews` rebuilt every render, so the selected row scroll-snaps on every inbox re-render

- **Priority:** P1. **Status:** Confirmed. R2-V5 widened the user-visible consequence and narrowed the auto-select sub-claim.
- **Location:**
  - `components/inbox/inbox-view.tsx:195` (`flattenReviews(reviewsQuery.data)`), `lib/queries/use-reviews.ts:29-33` (bare `flatMap`)
  - `inbox-view.tsx:201-205` (`loadMore` deps `[reviewsQuery]`), `:224-245`, `:354-386`, `:392-409`, `:665-710`
  - `review-list.tsx:174-183` (scroll effect, deps `[selectedId, reviews]`), `:224-236` (IntersectionObserver), `:599-621` (`scrollIntoNearestScroller`)
- **Current implementation and evidence:**
  - `reviews` is a new array on every render. `reviewsQuery` is also new every render, because `useBaseQuery` returns `trackResult`, which is a new `Proxy` (`queryObserver.ts:267`). So:
    - `loadMore` changes on every render;
    - the IntersectionObserver is torn down and rebuilt on every render;
    - every memo listed above recomputes.
  - **The user-visible bug is the scroll snap.** The scroll effect reruns on every `InboxViewInner` render and smooth-scrolls whenever the selected row is outside the scroller. Desktop always auto-selects row 1, so an operator who scrolls the list away is pulled back to the top on each of these:
    - within ≤15 s, unconditionally, from `useNow()` at `:139`, the shared 15 s tick;
    - within ≤5 s while any row is `publish_requested`, from the settling poll flipping `isFetching`;
    - on every focus refetch and every counts or health update;
    - **on every next-page load.** Here `reviews` genuinely changes, so memoising alone does not fix it.
  - The page contradicts its own comment ("without fighting intentional scroll while paging").
  - It does not happen on a phone, because the list is hidden while a review is open.
  - **Auto-select overstated (R2-V5).** `autoSelectId` returns `null` once `selected` is set (`lib/inbox/url-state.ts:292`). Repeat `router.replace` calls happen only before the URL commits and go to the same href. That is harmless, not a loop.
- **Root cause:**
  - The derived array is not memoised.
  - The whole query result is used as a dependency.
  - The scroll effect is keyed on list identity rather than on a change of selection.
- **Recommendation:** both of these are required:
  - (a) memoise `reviews`;
  - (b) scroll only when `selectedId` changes.

  Also destructure the query fields. See the sketch below.

- **Expected benefit:** the list stays where the operator put it. There is one IntersectionObserver per list mount, not per render, and the memos become effective.
- **Complexity:** S. **Regression risk:** Low–Medium. Deep link, keyboard navigation and advance-after-publish must still scroll the newly selected row into view.
- **Tests/verification:**
  - Rerender `ReviewList` with a new `reviews` array and the same `selectedId`, and assert `scrollBy` is not called. Append a page and assert it is not called.
  - Change `selectedId` and assert one call.
  - Deep link to a row that arrives with page 2, and assert one call once it renders.
  - Spy on the `IntersectionObserver` constructor across an identical refetch.
- **Dependencies:** land after the user's in-progress inbox layout edits (same files).

### W5-02: The 15 s clock re-renders the whole inbox; no row memoisation

- **Priority:** P2 (R2-V2). **Status:** Confirmed.
- **Location:**
  - `inbox-view.tsx:139` (`Math.floor(useNow() / 3_600_000)`), `lib/time/clock.ts:7,62-66`
  - `review-list.tsx:266-300` (inline rows)
  - `lib/format/date.ts:3-32`
- **Evidence:**
  - `useNow` snapshots the millisecond clock, so `InboxView` re-renders every 15 s although it only uses `hour`. `ReviewList`, `InboxToolbar` and `ReviewDetail` and all their rows re-render with it.
  - Each row does this on every render:
    - `deriveReplyStatus`
    - `parseReviewText`
    - 1–2 `formatDateTime` calls (4 `Intl.DateTimeFormat` constructions each)
    - one eager `formatDate` (3 more)
  - The list grows by 50-row pages with no windowing.
- **Root cause:** a high-frequency snapshot is used for a low-frequency value, and nothing is memoised.
- **Recommendation:**
  1. Add `useNowHour()`, a primitive hourly snapshot, and reuse the pattern in `listings-board.tsx:408`, `listing-overview.tsx:208`, `area-cards.tsx:193`, `health-strip.tsx:114` and `area-frame.tsx:601`.
  2. Cache `Intl.DateTimeFormat` per `(timeZone, options)`.
  3. Extract `ReviewRow` wrapped in `React.memo`, with stable callbacks.
  4. Windowing only if sessions reach hundreds of rows (measure first).
- **Expected benefit:** removes the periodic full-tree render. Per-render row cost falls to the changed rows. **Measure:** React Profiler commit duration with 50, 200 and 500 rows loaded; long tasks on ArrowDown.
- **Complexity:** S (1–2); M (3). **Regression risk:** Low; Medium for 3 (roving tab index, selection).
- **Tests:** `useNowHour` does not notify within the hour; formatter cache output parity; the existing `review-list` suite.
- **Dependencies:** W2-01 (stable `reviews` is a prerequisite for row memoisation to pay off).

### W2-02: Composer phantom-dirty commit causes an extra Back history entry per review opened and a Publish flicker

- **Priority:** P1. **Status:** Confirmed by trace (R2-V5). It needs a runtime test, because the existing test uses a stub composer.
- **Location:**
  - `components/inbox/reply-composer.tsx:109` (`useState("")`), `:129` (`isDirty = body !== seededBody`), `:146-171` (seed in effect), `:230-237`
  - `components/inbox/dirty-context.tsx:86-98, 111-116, 206-214`
  - `lib/editors/use-leave-guard.ts:104-117, 135-147, 150-166, 208-216`
  - `lib/hooks/use-dirty-guard.ts:108-122`
  - `components/inbox/action-bar.tsx:86`
  - `inbox-view.tsx:874-876` (`key={state.selected}`)
- **Current implementation and evidence:**
  - The composer remounts per selection. Whenever the review has a draft or live reply, the first commit has `body === ""` against a non-empty `seededBody`, so `isDirty === true`. Effects in that commit, in order:
    1. `beforeunload` is added.
    2. `setBody` runs (the seed).
    3. `useRegisterDirtyGuard` publishes dirty and notifies synchronously.
  - The provider's `useSyncExternalStore` read stays `true` through the next render, whether batched or not, because the corrected registration runs only in a later passive phase.
  - So `useLeaveGuard({ when: true })` arms, and `pushSentinel()` pushes a history entry.
  - The next selection's `router.replace` drops the markers (`keepMarkers`), so the sentinel becomes that review's URL. The next phantom arm pushes again.
  - **Net effect: one extra history entry per review opened.** Back walks through earlier reviews, which is exactly what `inbox-view.tsx:289-292` was written to prevent.
  - `ActionBar` sees dirty for one commit, so Publish flickers disabled.
  - `tests/components/inbox-leave-guard.test.tsx:21-49` uses a stub `Composer` with a fixed `dirty` prop.
- **Root cause:** server-seeded state is initialised in an effect, so there is always a commit with the unseeded value. `useEditorDraft` already avoids this by adjusting state during render.
- **Recommendation:**
  - Short term (S): seed during render and gate `isDirty` on the seed (sketch below).
  - Target (M): move `ReplyComposer` onto `useEditorDraft<string>` with `revision = latestDraft?.id ?? reply?.updatedAt`. This deletes the three seeding refs and the hand-written adopt-newer-draft rule.
- **Expected benefit:** Back returns to the list, not to earlier reviews. Publish no longer flickers, and `beforeunload` no longer churns.
- **Complexity:** S / M. **Regression risk:** Medium. The Undo-restore and adopt-newer-draft behaviour (`reply-composer.tsx:284-306`) must be preserved.
- **Tests/verification:** mount the **real** `ReplyComposer` inside `DirtyGuardProvider`, with a review that has a draft. Assert:
  - `history.pushState` is called zero times;
  - `useIsDirty()` is never observed `true`;
  - no `beforeunload` listener is added.

  Plus an e2e check: open five reviews, press Back once, and land on the list.

- **Dependencies:** §7 (the composite guard hook) and W2-09.

### W5-01: URL state via `router.replace`/`push` re-runs the server page per click or keystroke

- **Priority:** P1. **Status:** Confirmed (coordinator, R2-V2).
- **Location:** `inbox-view.tsx:212-213, 314, 404`; `listings-board.tsx:482-489` (no debounce); comments at `app/(dashboard)/inbox/page.tsx:16-22` and `listings/page.tsx:11-12` (incorrect for Next 16.3.8).
- **Evidence:**
  - In Next 16.3.8, a search-only change refreshes the page segment (`ppr-navigations.js:158-176`), and `staleTimes.dynamic` is 0.
  - Every row selection, filter change and auto-select therefore re-runs `InboxPage`:
    - `getSession()`, including the `last_seen_at` UPDATE;
    - `inboxPrefetch` reads of the list, counts and the selected review, which the client is fetching at the same moment;
    - `bulkActionsEnabled()`.
  - On listings, every keystroke re-runs `getSession` and `bulkActionsEnabled`.
  - `router.replace` is a transition, so the highlighted row waits for that round trip.
- **Root cause:** client-only URL state goes through the App Router.
- **Recommendation:**
  - Use `window.history.replaceState`/`pushState` for client-only state: inbox `selected`/queue/filters, and listings `q`/`health`/`order`/`clientId`. Next syncs this with `useSearchParams` and never reaches the server. There is a precedent at `team-view.tsx:92`.
  - Keep the first-load prefetch.
  - Debounce listings search through the shared `useDebouncedSearchParam` (W2-06).
  - Alternative: `staleTimes.dynamic > 0`, which is weaker and serves stale data.
- **Expected benefit:** removes one RSC round trip and its DB reads and write per selection or keystroke. **Measure:** `?_rsc=` requests in DevTools while arrowing through rows.
- **Complexity:** S–M. **Regression risk:** Medium:
  - `openedByPushRef` (`inbox-view.tsx:299-310`) relies on push semantics.
  - `use-leave-guard.ts:172-206` monkey-patches `pushState`/`replaceState`.
  - The sentinel logic in W2-02 interacts with this, so fix W2-02 first.
- **Tests:** Playwright asserts no `_rsc` request on row selection or listings typing; the existing back-button e2e and `use-leave-guard` tests.
- **Dependencies:** W2-02, W2-06; W0-05 (the per-request session write).

### W2-06 (related): Three URL-search implementations

The inbox `useReviewSearch` (`review-filters.tsx:39-63`) resets the draft when its own debounced write lands, so letters typed in flight can be lost (plausible; depends on navigation latency). The listings board writes per keystroke and never re-syncs `q`/`health`/`order` from the URL. **P2 (raw).**

Fix: move `useDebouncedSearchParam` (`clients-index-search.ts:20-70`) to `lib/hooks/`, use it in both places, and make the board derive its filters from `searchParams`. Target shape: `useUrlState(parse, serialize)` built on the history API from W5-01. Complexity M.

### Fix sketch for the inbox cluster

```ts
// lib/time/server-now.tsx: hourly primitive snapshot (W5-02)
export function useNowHour() {
  const serverNow = useContext(ServerNowContext)
  return useSyncExternalStore(
    subscribeClock,
    () => Math.floor(readClock() / 3_600_000),
    () => Math.floor(serverNow / 3_600_000)
  )
}

// components/inbox/inbox-view.tsx (W2-01)
const hour = useNowHour()
const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = reviewsQuery
const reviews = useMemo(() => flattenReviews(data), [data]) // structural sharing keeps `data` stable
const loadMore = useCallback(() => {
  if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
}, [hasNextPage, isFetchingNextPage, fetchNextPage])
// auto-select keyed on [reviewsReady, state.selected, reviews[0]?.id, isDesk]

// components/inbox/review-list.tsx: scroll on selection change only (W2-01)
const scrolledFor = useRef<string | null>(null)
useEffect(() => {
  if (!selectedId || scrolledFor.current === selectedId) return
  const index = reviews.findIndex((r) => r.id === selectedId)
  const row = containerRef.current?.querySelectorAll<HTMLElement>(
    '[data-slot="review-row"]'
  )[index]
  if (!row) return // deep link: row not loaded yet; retry when `reviews` changes
  scrolledFor.current = selectedId
  scrollIntoNearestScroller(row) // honour prefers-reduced-motion here
}, [selectedId, reviews])

// rows: const ReviewRow = memo(function ReviewRow(props: RowProps) { ... }) with onSelect(id) passed by reference

// components/inbox/reply-composer.tsx: seed during render (W2-02, short-term)
const [seededFor, setSeededFor] = useState<string | null>(null)
if (review && seededFor !== reviewId) {
  setSeededFor(reviewId)
  setBody(peekStashedDraft(stashKey) ?? seededBody) // peek only; take() stays in the restore path
}
const isDirty = seededFor === reviewId && body !== seededBody
```

---

## 7. Dirty-state and leave-guard consolidation

### W2-07: Unsaved-changes handling is spread over 2–4 hooks per editor and wired inconsistently

- **Priority:** P2/P3 (R2-V5). **Status:** Confirmed, with R2-V5's onboarding addition. The `discarded` latch is a hypothesis: no current path was traced that triggers it.
- **Location:** `lib/hooks/use-dirty-guard.ts:50-55, 77-88, 102, 108-122`; `components/inbox/dirty-context.tsx:86-89, 206-214`; `lib/editors/use-leave-guard.ts`. Current wiring:

  | Editor                          | `useDirtyGuard` (beforeunload / stash) | `useLeaveGuard`       | Gap                                                                                                                                        |
  | ------------------------------- | -------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
  | `client-settings.tsx:979`       | yes, `stash: true`                     | yes                   | Stash is never restored, so orphan `naba:draft:*` entries pile up                                                                          |
  | `policy-form.tsx:245`           | yes, `stash: true`                     | yes                   | as above                                                                                                                                   |
  | `booking-tab.tsx:918`           | yes, `stash: false`                    | yes                   | none                                                                                                                                       |
  | `agency-name-form.tsx:79`       | **no**                                 | yes                   | A reload or tab close loses the edit silently                                                                                              |
  | `onboarding-drafts.tsx:679-687` | hand-rolled `beforeunload`             | yes, **no `onLeave`** | No 401 stash; **ignores `draftsAbandoned()`**, so a forced sign-out still shows "Leave site?" (R2-V5)                                      |
  | `reply-composer.tsx:131`        | yes, plus the inbox store              | via provider          | Phantom dirty (W2-02); a store `discard()` is never followed by a re-register (`useRegisterDirtyGuard` reruns only on an `isDirty` change) |
  | `useEditorDraft` editors        | yes                                    | via `DraftNotices`    | none                                                                                                                                       |

  Also:
  - Programmatic navigation is guarded only in `command-palette-dialog.tsx` and `scope-sheet-model.tsx` (`useGuardedRouter`). For example, `client-settings.tsx:716` `router.push("/clients")` after an archive skips the prompt; that is arguably acceptable.
  - The orphan stashes are tab-scoped `sessionStorage`, cleared by `clearAllStashedDrafts`/`purgeForeignDrafts`, so their impact is low.

- **Root cause:** no composite primitive exists. Each editor picks the pieces it needs, and the defaults (`stash: true`) assume a restore path that most editors don't have.
- **Recommendation:** one composite hook, used by every editor:

  ```ts
  useUnsavedChanges({
    scope,            // stash and leave-guard identity
    isDirty,
    snapshot,         // only when restorable
    restorable = false,
    onDiscard,
  }): { confirmDiscard, leavePrompt, forget, restored }
  ```

  It internally:
  - wires `useDirtyGuard` with `stash: restorable`;
  - wires `useLeaveGuard` with `onLeave: markDiscarded`;
  - honours `draftsAbandoned()`;
  - resets `discarded` when `isDirty` goes false;
  - returns `restored` only when `restorable`.

  Migration:
  - `agency-name-form` and onboarding move onto it. Onboarding sets `restorable: true` and offers a restore.
  - `client-settings` and `policy-form` use `restorable: false`.
  - The inbox store's `discard()` bumps a `version` that `useRegisterDirtyGuard` depends on.
  - `useEditorDraft` editors get it through `DraftNotices`, unchanged for callers.

- **Expected benefit:** every editor gets a reload warning, link and Back prompts, and an optional sign-out stash. No orphan stashes, and one place to fix guard bugs.
- **Complexity:** M. **Regression risk:** Medium. `tests/components/use-leave-guard.test.tsx` and `inbox-leave-guard.test.tsx` must stay green.
- **Tests:**
  - Per editor, dispatching `beforeunload` while dirty sets `defaultPrevented`.
  - `ClientDetailsForm` unmounted while dirty leaves no `naba:draft:` key.
  - Onboarding under `draftsAbandoned()` shows no prompt.
  - Composer: edit → Discard on a `run` request that keeps the page → edit again → `useIsDirty()` is true.
- **Dependencies:** W2-02 (the composer seed), W2-09 (draft primitive convergence).

---

## 8. Query-key hygiene

### W2-05 / W1-F11: Location-scoped keys outside the cleared roots

- **Priority:** P3 (R2-V5; W1 said P2). **Status:** Confirmed, with mitigation.
- **Location:**
  - The contract: `lib/queries/keys.ts:9-16`. `resourcePrefixesForPath` (`lib/queries/scope-reset.ts:63-79`) drops only `["locations", id]`, `location-capabilities`, `listing-summary` and `listing-change-requests`.
  - Violations:
    - `lifecycle-workspace.tsx:39,48`
    - `verification-saved-workflows.tsx:68`
    - `use-google-verification-state.ts:8`
    - `access-workspace.tsx:49`
  - Hand-typed invalidations: `use-lifecycle.ts:34-35`, `use-verification-action.ts:40-41`, `use-administration-access.ts:24`.
- **Evidence:**
  - A 403 or 404 on `/api/locations/{id}/…` leaves lifecycle, verification and access-workflow caches readable.
  - Mitigation (R2-V5): a scope-token change runs `resetScopedQueries` over everything, and unobserved entries are garbage-collected after the 5-min default `gcTime`. So the real exposure is a mounted or recently viewed workspace.
- **Root cause:** inline literal keys bypass the key factory. There are 28 `queryKey: [` literals outside `keys.ts`.
- **Recommendation:**
  - Add factory entries under `["locations", id, …]`: `locationLifecycleWorkflows`, `locationLifecycleAttempt`, `locationVerificationWorkflows`, `locationVerificationState` and `locationAccessWorkflows`. Move the query and invalidation sites in the same change.
  - Add a lint guard (`no-restricted-syntax` on array-literal `queryKey` outside `lib/queries/`).
  - Same treatment for:
    - `["organisations"]` (`account-menu.tsx:136`, `agency-name-form.tsx:91`, `policy-form.tsx:289`), where the `renameOrganisation` mutation is also duplicated in the last two;
    - the onboarding keys (`onboarding-drafts.tsx:235,248,256` and siblings), which are per Google account and are not dropped on account change.
- **Expected benefit:** the documented scoping guarantee holds, and invalidations are type-checked.
- **Complexity:** S. **Regression risk:** Low. Query and invalidation sites must move together.
- **Tests:** every per-location factory key starts with an allowed root; `dropResourceQueries` drops a seeded lifecycle key.

### W1-F12: Counts key built in two places; dead `groupBy`

- **Priority:** P3. **Status:** Confirmed (raw).
- **Location:** `use-review-counts.ts:21-30` (string join), `lib/server/prefetch.ts:48` (hand-built `` `organisation:${clientId}` ``), `use-needs-reply-count.ts:22`.
- **Evidence:**
  - A change to the join silently breaks hydration and doubles the first fetch.
  - `groupBy: "client"` and the positional-string overload have no callers.
  - The two observers of the org key carry different `retry` and `queryFn` options.
- **Recommendation:**
  - Make `queryKeys.reviewCounts({ locationId, clientId })` return a tuple, imported by `prefetch.ts`.
  - Delete `groupBy` and the string overload.
  - `useNeedsReplyCount` becomes `useReviewCounts` with `select`.
- **Complexity:** S. **Regression risk:** Low. **Tests:** prefetch key equals the hook key; hydration produces no client fetch.

### Broad invalidation to check

`components/locations/listing-change-requests.tsx:71` invalidates `["locations", locationId]`, which refetches every mounted tab for that location, including Google-backed ones (W3-2). Confirm whether that breadth is intended; if not, narrow it to the affected resources.

---

## 9. Other hook and state findings (brief)

| ID     | Finding                                                                                                                                            | Priority | Status               | Action                                                                                                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W2-03  | "Compiler-backed lint silently skips complex components"                                                                                           | —        | **Refuted** (R2-V5)  | The compiler does analyse `ReplyComposer`. `set-state-in-effect` deliberately exempts ref-guarded `setState` (`enableAllowSetStateFromRefsInEffects`). Record only that the ref-guard idiom escapes the rule |
| W2-04  | `usePassedDeadlines` (`verification-saved-workflows.tsx:22-31`) arms one timer and never re-arms                                                   | P3       | Confirmed            | Re-arm inside `subscribe`, or use one `useDeadline` per row. Fake-timer test with two deadlines                                                                                                              |
| W2-09  | Four draft-seeding mechanisms (`useResetOnRevision`, `useEditorDraft`, composer refs, onboarding remount with 32 `useState`)                       | P2       | Confirmed (raw)      | Converge on `useEditorDraft`; see the redesigns                                                                                                                                                              |
| W2-10  | Child-to-parent registration via effects (`client-context.tsx:99-104`, `page-chrome.tsx:119-147`) means client-scoped chrome flips after hydration | P2       | Confirmed path (raw) | Derive scope from route params or server props; split the bundled contexts                                                                                                                                   |
| W2-11  | Six hand-rolled reviewed-write state machines; context values are new objects every render                                                         | P2       | Confirmed (raw)      | `useReviewedWrite`; see the redesigns                                                                                                                                                                        |
| W2-12  | `useWorkspaceMode` (36 consumers) and friends subscribe to the whole QueryCache                                                                    | P3       | Plausible            | Measure `onChange` calls first; then use a `SessionContext`                                                                                                                                                  |
| W2-13  | `useMediaQuery` resubscribes on every render (inline `subscribe`), and every overlay reaches it                                                    | P3       | Confirmed (raw)      | A module-level store per query                                                                                                                                                                               |
| W2-14  | Duplicate `useHydrated`; `useBreakpoint("desk")` picks whole subtrees in profile sections                                                          | P3       | Confirmed, latent    | Import the shared hook; use `useHydratedBreakpoint`                                                                                                                                                          |
| W2-15  | Inbox bulk selection survives queue, client and filter changes                                                                                     | P3       | Confirmed (raw)      | Clear on change, or key `SelectionProvider` on `queue + clientId`                                                                                                                                            |
| W2-16  | Manual memoisation mostly a no-op; latest-ref-via-effect patterns                                                                                  | P3       | Confirmed (raw)      | Fix memos that feed dependencies; use `useEffectEvent` in the 10 listed sites                                                                                                                                |
| W2-17  | Dead hooks, a deprecated alias, name collisions, duplicate `untilMounted`/`whenMounted`                                                            | P3       | Confirmed (raw)      | Delete or rename                                                                                                                                                                                             |
| W1-F13 | `["organisations"]` literal ×3; `useVerifyDraft` shares the `"draft"` mutation kind                                                                | P3       | Confirmed (raw)      | Folded into §8; add `"verify"` to `ReplyMutationKind` if the status line should tell them apart                                                                                                              |

---

## Recommended redesigns

**Remove**

- Dead hooks: `useReveals`, `useClientHealth`, `useImportReviewCounts`, `useLocationActivity`. Remove `useKeyboardInset` or adjust its test.
- The `useVerificationExpiry` alias, after migrating its two consumers to `useDeadline`.
- `useResetOnRevision`, after porting `admins.tsx` to `useEditorDraft`.
- Dead `createPlaceAction`/`updatePlaceAction`/`deletePlaceAction` wrappers.
- `groupBy` and the string overload in `useReviewCounts`.
- `refetchInterval` on `useReviews` (it is replaced by the detail-only settling poll).
- The extra `detail.refetch()` in `ActionBar` and the second counts `fetchQuery` in sync.

**Merge**

- `useInvalidateReviewWrites` plus the four other hand-rolled sites become one module-level `applyReviewWrite`/`applyReviewWrites` (§3).
- `useDirtyGuard` + `useLeaveGuard` + the onboarding `beforeunload` become `useUnsavedChanges` (§7).
- `useNeedsReplyCount` becomes `useReviewCounts` with `select`.
- The five shell polls become one `useShellStatus` (phase 2: `/api/shell-status`).
- The six reviewed-write hooks become `useReviewedWrite` plus 10–20-line adapters (W2-11, L, high regression risk: they guard Google writes, so do this last and behind shared contract tests).
- The three URL-search implementations become `useDebouncedSearchParam` in `lib/hooks`, then `useUrlState(parse, serialize)` on the history API.

**Split**

- `InboxViewInner` (957 LOC) into:
  - `useInboxUrlState()`
  - `useInboxNavigation(reviews)`: selection, auto-select, advance-after-publish, focus and scroll
  - `useInboxHotkeyHandlers()`
- `ReviewList` rows into a memoised `ReviewRow`.
- `RegistryContext` into scope, remembered-client and handler contexts; `PageChromeContext` into value and setter contexts.

**Redesign**

- **Review mutations: `useReplyActions(reviewId)`.** One hook owning the save → (verify) → publish and approve flows, with:
  - a single busy latch (W1-F5);
  - the guard fields always sent (W1-F1);
  - response patching through `applyReviewWrite` (W1-F2);
  - registration of in-flight ids for the bounded settling poll (W1-F3).

  `ActionBar` becomes a renderer.

- **`ReplyComposer`** onto `useEditorDraft<string>` (W2-02/W2-09).
- **Onboarding `DraftDetails`** onto `useEditorDraft<OnboardingPayload>` plus a reducer and a pure `evaluateOnboardingDraft` (L).
- **Every `lib/api` reader takes `RequestOptions`.** Every intent-aware writer **requires** `MutationOptions`.
- **Query defaults:** a 4xx-aware `retry`; Google-backed resources with a 5-min `staleTime` and no focus refetch.

### Suggested order

1. W1-F1
2. W2-01 and W2-02 short-term fixes (after the user's inbox edits land)
3. W1-F2 (a), W1-F4, W1-F10 (401)
4. W5-01
5. Contract change and `applyReviewWrite`, then W1-F3
6. W1-F6/F7 and "already done = success"
7. W2-07 composite hook
8. Key hygiene
9. Redesigns (`useReplyActions`, the `useEditorDraft` migrations, then `useReviewedWrite`)

---

## Open questions / needs live measurement

- **Publish latency (W1-F2).** Press-to-outcome time and `/api/reviews` requests per Publish press against pages loaded (k). This needs a client span around `onPublish`; none exists (W7-1).
- **Typical pages loaded per inbox session.** This decides whether `maxPages`/windowing (W5-02 step 4) is worth doing, and how much W1-F2 and W1-F3 cost in practice.
- **Settling duration in production.** How long rows stay `publish_requested`, and how often the poll outlives the recovery cron. It sets the cap in W1-F3. Product owner: is "Still sending: refresh to check" after N minutes acceptable?
- **Counts poll fan-out.** `/api/reviews/counts` rate per session while a colleague publishes (visible-locations scope).
- **Shell request volume.** `/api/*` requests per session-minute on an idle visible tab, and per focus event on Google-backed tabs (W5-07). Google-call counters per focus.
- **Scroll snap and history entries.** Confirm in a browser: (a) the list snaps back within ≤15 s after the user scrolls away from the selection (W2-01); (b) `history.length` grows by one per review opened, and Back walks through reviews (W2-02).
- **RSC round trips on selection (W5-01).** Count `?_rsc=` requests while arrowing through rows, and the click-to-highlight delay.
- **Inbox letter loss (W2-06).** Does the inbox search drop characters under realistic navigation latency?
- **Render cost.** React Profiler commit duration for `InboxView` at 50, 200 and 500 rows, before and after `useNowHour` and row memoisation.
- **QueryCache subscriber cost (W2-12).** `onChange` calls per inbox session.
- **Bulk double-start rate (W1-F7).** How often duplicate `bulk_listing_operation` rows over the same reviews occur (a read-only query on staging data).
- **Server contract.** Can the publish, approve, delete and draft routes return the post-write `reviewRow` from the list projection without an extra transaction? Is the local `updated_at` a reliable `rowVersion`?
