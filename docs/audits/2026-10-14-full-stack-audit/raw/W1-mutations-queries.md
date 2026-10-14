# W1 — Mutations, queries, data fetching, optimistic updates

**Workstream:** W1 (read-only audit, 2026-10-14)
**Evaluated:** `HEAD` (d8759c74) plus the working tree. The uncommitted changes in `components/inbox/*`, `lib/inbox/layout.ts` and `app/(dashboard)/inbox/*` are UI/layout only. `git diff -U0` shows no changes to query, mutation or invalidation code, so none of the findings below depend on them.

## Scope covered

- QueryClient defaults: `lib/queries/query-client.ts`, `provider.tsx`, `scope-reset.ts`, `request-options.ts`, `hydration-boundary.tsx`, `keys.ts`, `invalidate.ts`, `paged-list.ts`.
- Every `useMutation` / `useResourceMutation` / `useQuery` / `useInfiniteQuery` call site in `app/`, `components/` and `lib/`. I built the mutation inventory with a script and read every inbox call site by hand.
- The client fetch layer: `lib/api/client.ts` (`apiFetch`, intent IDs, the 401/403/202 handling) and the inbox wrappers (`reviews`, `review-counts`, `drafts`, `publish`, `approval`, `reply`, `review-bulk`, `mutations`).
- Inbox flows: `components/inbox/action-bar.tsx`, `reply-composer.tsx`, `bulk-action-bar.tsx`, `template-reply-dialog.tsx`, `sync-reviews-button.tsx`, `inbox-view.tsx`, `lib/inbox/settling.ts`, `lib/inbox/template-batch.ts`, `components/app-shell/use-needs-reply-count.ts`.
- Server prefetch and hydration: `lib/server/prefetch.ts`, `app/(dashboard)/inbox/page.tsx`, `app/(dashboard)/layout.tsx`.
- Server-side idempotency: `lib/server/route.ts` (intent header), `lib/server/mutation-operations.ts` (ledger), `lib/server/publishing/intent.ts` (publish key), `lib/server/posts.ts` (post publish/delete keys), `app/api/reviews/{[id]/publish,[id]/approval,[id]/reply,bulk}`, `app/api/drafts/[id]/verify`, `lib/server/review-approval.ts`, `lib/server/bulk-reviews.ts` (batch insert), `lib/server/review-counts.ts`, `app/api/mutations/[operationId]`. I read only the header and structure of `lib/server/mutation-recovery.ts`.
- TanStack internals checked directly in the installed `@tanstack/query-core@5.101.4`:
  - `mutation.js:123`: `await this.options.onSuccess?.(…)`.
  - `infiniteQueryBehavior.js:64-72`: a refetch loops over every cached page in turn.
  - `queryObserver.js:214`: each observer runs its own `setInterval`.

## Commands run (all read-only)

`rg` / `rg -c` / `rg -n` inventories over `app components lib`; a `node -e` script to extract every `useMutation({…})` and `useResourceMutation({…})` block with its `mutationFn`, intent forwarding and invalidation keys; `sed -n`, `cat -n` and `wc -l` on the files listed above; `git diff --stat` / `git diff -U0` (read-only); `jq` on `package.json` for versions; `rg` in `node_modules/.pnpm/@tanstack+query-core@5.101.4/.../build/modern` to confirm library semantics.

## Not covered, and why

- **No runtime measurement.** I started no dev server, browser or database, so the cost figures below are derived from code paths, not observed. Where measurement is needed I name the instrumentation.
- I sampled the settings, setup/onboarding, bulk-listing and administration mutations through the scripted inventory but did not trace each one end to end. The inbox flows got the deep pass.
- I did not trace `lib/server/mutation-recovery.ts` line by line. Its header shows compare-and-set settles and "never re-sends", which looks right; W-jobs should own it.
- Server-side authorisation (W6) and SQL/index cost (W2/W3) appear only as leads.
- No tests were run (read-only mandate).

---

## Inventory: inbox and review mutations

| Mutation (file:line)                                               | Endpoint                                               | Invalidation on success                                                      | Optimistic?        | Rollback | Idempotency (client → server → DB)                                                                                                                                                                                                                                                         | Double-submit guard                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `useGenerateOrSaveDraft` (`lib/queries/use-draft-mutations.ts:17`) | `POST /api/reviews/{id}/drafts`                        | detail + `["reviews"]` + `["review-counts"]` + `["ai-credits"]`, **awaited** | No (by design, D7) | n/a      | Intent reused after an unconfirmed failure (`:29-44`) → `requestScopedKeyPart` → generation key (`lib/server/review-drafts.ts:259`). End to end ✔                                                                                                                                          | `isPending` checked in `saveRef` / `generateRef` (`reply-composer.tsx:245-249`); buttons disabled |
| `useVerifyDraft` (`use-draft-mutations.ts:61`)                     | `POST /api/drafts/{id}/verify`                         | detail + reviews + counts, **awaited**                                       | No                 | n/a      | No intent. Server keys usage by `${requestId}:verification` (`app/api/drafts/[id]/verify/route.ts:109`), so a retry is a second AI call                                                                                                                                                    | `verify.isPending` feeds `sending`                                                                |
| `usePublishReview` (`use-publish-review.ts:9`)                     | `POST /api/reviews/{id}/publish`                       | detail + reviews + counts, **awaited**                                       | No                 | n/a      | Fresh intent on every call; no ledger receipt (publishing doesn't pass an `operation` to `runGbpWrite`). Server key is derived from content: `sha256(org:review:generation:bodyHash)` (`lib/server/publishing/intent.ts:215-224, 438`) with a unique key in `attempt.ts:242`. End to end ✔ | `pending={sending}`, but gap: see F5                                                              |
| `useApprovalDecision` (`use-approval-decision.ts:9`)               | `POST /api/reviews/{id}/approval`                      | detail + reviews + counts, **awaited**                                       | No                 | n/a      | Sends **only** `{decision, note}`. The server's `draftId` / `expectedReviewUpdateTime` guards are unused (F1)                                                                                                                                                                              | `approval.isPending` disables buttons                                                             |
| `useDeleteReply` (`use-delete-reply.ts:9`)                         | `DELETE /api/reviews/{id}/reply`                       | detail + reviews + counts, **awaited**                                       | No                 | n/a      | Server key derived from org + review + reply generation (`lib/server/publishing/delete.ts:183`). ✔                                                                                                                                                                                         | `remove.isPending`                                                                                |
| `useBulkReviewAction` (`use-bulk-review-action.ts:16`)             | `POST /api/reviews/bulk`                               | reviews + counts + `["clients"]` + each row's detail (fire-and-forget)       | No                 | n/a      | No intent and no `x-request-id` from the browser, so `clientRequestId` is always null. Approve is protected by the per-row draft and update-time CAS. Engine template batches have **no dedupe** (F7)                                                                                      | `bulk.isPending` disables the bar                                                                 |
| Template batch, client path (`template-reply-dialog.tsx:139-232`)  | Raw `generateOrSaveDraft` + `publishReview`, pool of N | reviews + counts + clients **only at the end**, no details                   | No                 | n/a      | Inherits the per-call server keys above. Calls bypass the hooks, so they have no `mutationKey`                                                                                                                                                                                             | `phase` state                                                                                     |
| Sync (`sync-reviews-button.tsx:29-85`)                             | `POST` sync, then a counts `fetchQuery`                | reviews + counts + clients, awaited, **then refetches counts again** (F10)   | No                 | n/a      | Server lock (`skipped`)                                                                                                                                                                                                                                                                    | local `pending`                                                                                   |

Other surfaces (script output, summarised):

- `useResourceMutation` forwards the intent only where the wrapper accepts `MutationOptions`: post publish, photo add and photo delete.
- The local saves (hours, menu, profile, post create) don't forward it but use revision CAS, which is acceptable.
- Post **approve** and post **delete** don't forward it (F6).
- Apart from these, no settings, billing, client or onboarding mutation sends an intent. They are mostly plain DB writes.
- There are no optimistic `onMutate` cache writes anywhere. `notification-preferences.tsx:72` uses `onMutate` only for local status. This is a deliberate "server-confirmed only" policy (D7, `lib/inbox/actions.ts:141`), so rollback and `cancelQueries` races don't apply.

## Inventory: inbox queries

| Hook                                                                                                    | Key                                                                            | staleTime | Poll                                                | Prefetched?                                                   |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------- | --------------------------------------------------- | ------------------------------------------------------------- |
| `useReviews` (`use-reviews.ts:10`)                                                                      | `["reviews","organisation",filters]` infinite, 50 rows/page, **no `maxPages`** | 30 s      | 5 s while any loaded row is `publish_requested`     | First page, when no age preset (`prefetch.ts:38-44`)          |
| `useReviewCounts` (`use-review-counts.ts:21`)                                                           | `["review-counts","organisation[:clientId]"]`                                  | 30 s      | 5 s while org-wide `byStatus.publish_requested > 0` | Org key in the dashboard layout; client key in the inbox page |
| `useNeedsReplyCount` (`use-needs-reply-count.ts:19`)                                                    | the same org counts key                                                        | 30 s      | 60 s, `retry:false`, `background:true`              | layout                                                        |
| `useReviewDetail` ×3 observers (`review-detail.tsx:1008`, `reply-composer.tsx:90`, `action-bar.tsx:75`) | `["review-detail",id]`                                                         | 30 s      | 5 s while `publish_requested`                       | yes                                                           |
| `useClients` ×~13 observers in the shell and inbox                                                      | `["clients","list"]` (carries `needsReply`)                                    | 30 s      | 60 s **per observer**                               | layout                                                        |

Defaults (`lib/queries/query-client.ts:4-24`): `staleTime 30s`, `retry 1`, `refetchOnWindowFocus true`, `networkMode offlineFirst`; mutations use `retry 0`. Hydration is clock-skew aligned (`hydration-boundary.tsx:26-50`), which is well done.

---

## Findings

### F1 Single-review Approve/Reject skips the stale-draft and stale-review guards the server provides

- Priority: **P1** (approval is the human boundary in front of a Google write)
- Status: **CONFIRMED** (client omission). Exploit window: PLAUSIBLE.
- Location:
  - `lib/queries/use-approval-decision.ts:14-15` (`mutationFn: (input: { decision; note? }) => decideApproval(reviewId, input)`)
  - `components/inbox/action-bar.tsx:224` (`approval.mutateAsync({ decision, note })`)
  - Server: `lib/contracts/reviews.ts:699-709`, `lib/server/review-approval.ts:113-157`
- **Evidence:**
  - `approvalInputSchema` accepts an optional `draftId`, which the server checks with 409 `approval_draft_changed` ("This reply changed after you opened it"), and an optional `expectedReviewUpdateTime`, which it checks with 409 `review_changed`.
  - The server otherwise approves `record.pending_draft_id ?? record.latest_draft_id`, the draft parked **now**.
  - Bulk approve always sends both fields (`app/api/reviews/bulk/route.ts:238-246`).
  - The single-review path sends neither, so the guard written for exactly this case never runs on the most common approval path.
  - The approver's pane may be up to 30 s stale (staleTime), and longer without focus or polling, because there is no settling poll while `awaiting_approval`.
  - If the author withdraws, edits and resubmits, the approver's click approves text they never saw.
- **Root cause:** the hook's input type predates the guards.
- **Recommendation:** pass `draftId: review.reply?.pendingDraftId ?? publishableDraft(review.drafts)?.id` and `expectedReviewUpdateTime: review.updateTime` from `ActionBar` (the same values `onPublish` already uses at `:160-166`). Map 409 `approval_draft_changed` / `review_changed` to a refetch and "read the current draft" copy. Alternative: make both fields required in `approvalInputSchema` once every client sends them.
- **Benefit:** approvals become bound to what was displayed, matching bulk.
- Complexity S / Regression risk Low. Both 409 codes already have copy in `lib/errors/action-errors.ts:205,218`.
- **Tests:**
  - `tests/components/action-bar*`: assert the approval body carries `draftId` and `expectedReviewUpdateTime`.
  - Route test: a stale `draftId` gets 409.
- Dependencies: none.

### F2 Every review write blocks the button on a full refetch of every loaded inbox page plus all counts

- Priority: **P1** (latency on the core action, and DB load)
- Status: **CONFIRMED** for the mechanics. Magnitude is unmeasured.
- Location:
  - `lib/queries/invalidate.ts:13-21` (awaited `Promise.all` of 3 invalidations)
  - `use-draft-mutations.ts:48-54`, `use-publish-review.ts:16`, `use-approval-decision.ts:16`, `use-delete-reply.ts:15` (`onSuccess: invalidate`, which returns the promise)
  - `use-reviews.ts:11-26` (infinite, no `maxPages`)
- **Evidence:**
  - TanStack awaits `onSuccess` before `mutateAsync` resolves (`query-core/build/modern/mutation.js:123`).
  - Invalidating `["reviews"]` refetches the active infinite query, and an infinite refetch walks **all** cached pages one after another (`infiniteQueryBehavior.js:64-72`).
  - The inbox loads continuously: "No page state: the list loads continuously" (`inbox-view.tsx:197-205`).
  - So after scrolling k pages, one Publish press (`action-bar.tsx:149-205`) runs:
    1. Save: `POST /drafts`.
    2. Wait for the detail refetch + k sequential `/api/reviews` pages + org and client counts + AI credits.
    3. `POST /publish`.
    4. Wait for detail + k pages + counts again.
    5. On `stale_draft_evidence`: verify, wait for the refetch again, then `detail.refetch()` (a duplicate, see F9), then publish, then wait for the refetch again.
  - "Publishing…" stays on screen through all of it.
- **Root cause:** list and count freshness is awaited as if it were part of the write.
- **Recommendation:**
  - (a) Await only `reviewDetail(id)`. Fire-and-forget `reviewsAll` / `reviewCountsAll`, as `useResourceMutation` already does (`use-resource-mutation.ts:151-156`).
  - (b) Set `maxPages` (for example 5–10) on `useReviews`, or switch the list invalidation to `refetchType: "none"` and rely on the settling poll.
  - (c) Seed the detail from the mutation response where it carries the new state (`publishResultSchema` returns `status` / `googleReplyState`), with `setQueryData` patching `workflowStatus`, so the pane flips without waiting.
- **Benefit:** press-to-outcome latency becomes the write's own RTT instead of (writes × (1 + k) reads).
- **Measure:** an OTel span around `onPublish`, plus a request-count attribute for `/api/reviews` per press. Today there is no client-side span (lead for W-observability).
- Complexity S (a) / M (b, c) / Regression risk Med: the status line and footer must still agree (`use-reply-pending.ts`), and the pane relies on the refetched detail.
- **Tests:** a hook test that `mutateAsync` resolves before the list refetch resolves; the `inbox-view` test that the row still updates.
- Dependencies: F3.

### F3 The settling poll refetches every loaded page every 5 s, and the org-wide counts poll at 5 s while any review in the organisation is publishing

- Priority: **P1**
- Status: **CONFIRMED** (code). Cost is a HYPOTHESIS until measured.
- Location: `use-reviews.ts:20-25`, `use-review-counts.ts:38-43`, `use-review-detail.ts:18-19`, `lib/inbox/settling.ts:27-37` ("Deliberately unbounded"), `lib/server/review-counts.ts:49-109`
- **Evidence:**
  - `refetchInterval` returns 5 000 ms while any row on any loaded page is `publish_requested`, and each tick refetches all k pages in turn (F2 mechanics).
  - The counts poll keys on `byStatus`, which is **organisation-wide** (or client-wide). So a colleague's in-flight publish, or one stuck row anywhere, puts every open inbox tab on a 5 s counts poll with no upper bound.
  - Each counts request makes 3–4 sequential aggregate queries: the settings read, the totals with N `count(*) filter`, the `group by workflow_status`, and the optional `groupBy`.
  - Hidden tabs don't poll (`refetchIntervalInBackground` defaults to false). That's good.
- **Recommendation:**
  - Poll the **detail** of the row(s) in flight, not the list.
  - Patch list rows from the detail result with `setQueriesData({queryKey: reviewsAll}, …)`, or refetch only page 1.
  - Bound the poll: back off 5 s → 15 s → 60 s and stop after N minutes, as `use-mutation-receipt.ts:19-28` already does.
  - Drive the counts poll from "this session has a pending publish" rather than `byStatus`.
  - Server side, fold the `byStatus` aggregate into the totals scan (one pass) (W2).
- **Benefit:** steady-state reads drop from O(k pages × 12/min) to O(1 detail × 12/min).
- **Measure:** per-route request rate for `/api/reviews` and `/api/reviews/counts`, by session, from the existing route spans.
- Complexity M / Regression risk Med (the settling UX regressed before, see the `settling.ts` header).
- **Tests:** a `settlingInterval` back-off unit test; an inbox test that a settled row updates in the list.
- Dependencies: F2.

### F4 Default `retry: 1` retries deterministic 4xx failures, so a 401 redirect and AccessLost handling fire twice

- Priority: P2
- Status: **CONFIRMED** (config). The double side effect is PLAUSIBLE.
- Location: `lib/queries/query-client.ts:8`; `lib/api/client.ts:348-364`
- **Evidence:**
  - `retry: 1` is unconditional, so 400/403/404/409/422 reads are re-sent after the default 1 s delay.
  - Each failed attempt runs `reportAccessLost` (which removes or resets queries and invalidates the session) and, for foreground requests, `handleUnauthorized()` (stash drafts + hard navigate) or `requestStepUp`.
  - Only `useMutationReceipt` (`use-mutation-receipt.ts:43-44`) and a few setup queries override `retry`.
  - Error states also appear 1 s late on every 404 (deleted review, hidden location).
- **Recommendation:** default to `retry: (n, e) => n < 1 && !(e instanceof ApiClientError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429)`.
- Complexity S / Regression risk Low / Tests: a unit test on `makeQueryClient().getDefaultOptions().queries.retry`.

### F5 One-press Publish re-enables the button mid-flow (stale-evidence path)

- Priority: P2
- Status: **CONFIRMED**
- Location: `components/inbox/action-bar.tsx:177-192, 274-275`
- **Evidence:**
  - `sending = checking || publish.isPending`, where `checking` is `composerSave?.saving || verify.isPending`.
  - After the first publish rejects (`stale_draft_evidence`) and `verify` resolves, the code awaits `detail.refetch()`. During that window all three flags are false, so the button is live and the `a` hotkey (`:96-113`) can start a second `onPublish`.
  - The server's content-derived publish key (`publishing/intent.ts:438`) dedupes the Google write. The risk is a duplicate verify AI call, interleaved toasts and a duplicate draft save if the composer is dirty.
- **Recommendation:**
  - Hold a `useRef` "in flight" flag (or a local `busy` state) across the whole `onPublish`, as `use-place-action-review.ts:27` does with `claim.current`.
  - Drop the `detail.refetch()` (F9).
- Complexity S / Risk Low / Tests: the second press during the stale path is ignored.

### F6 Post approve and post delete don't forward the mutation intent, so the server's retry-replay can't work

- Priority: P2
- Status: **CONFIRMED**
- Location:
  - `components/locations/posts-action-bar.tsx:192-196` (`decide`) and `:208-209` (`remove`)
  - `lib/api/location-posts.ts:71-90` (`decidePostApproval` and `deletePost` take no `MutationOptions`)
  - Server: `lib/server/posts.ts:1963-1971`
- **Evidence:**
  - The server derives the delete attempt key from `requestScopedKeyPart(requestId)`, which is the intent when one is sent: "so a retry of the same delete replays instead of deleting again".
  - The client never sends one, so `apiFetch` mints a fresh UUID per call (`client.ts:307-310`), and `useResourceMutation`'s unconfirmed-intent reuse (`use-resource-mutation.ts:136-145`) is computed and then discarded.
  - After a network drop on a live-post delete, Retry sends a second Google DELETE under a new key.
  - Approve publishes. Its Google write is content-keyed (`posts.ts:1693-1699`), so that path is safe, but the decision record and receipt are not replayed.
- **Recommendation:** add `options: MutationOptions` to both wrappers and pass `intent.intentId`, as `publishPost` does (`posts-action-bar.tsx:179-183`). Consider a lint rule or type that forbids a `useResourceMutation` `mutationFn` ignoring its second argument when the wrapper accepts `MutationOptions`.
- Complexity S / Risk Low / Tests: the retry after a `network_error` reuses the `Idempotency-Key` (mirror the existing publish test).

### F7 Bulk template-reply batches on the engine have no submission dedupe

- Priority: P2
- Status: PLAUSIBLE. Batch creation is CONFIRMED; whether the runner then double-publishes is not traced.
- Location: `components/inbox/template-reply-dialog.tsx:180-198` (`queueBatch`), `lib/server/bulk-reviews.ts:102-150, 276-353`, `app/api/reviews/bulk/route.ts:89-92`
- **Evidence:**
  - No intent is sent, and `clientRequestId` is null because the browser never sets `x-request-id`.
  - `insertBatch` always inserts a new `bulk_listing_operation`.
  - Eligibility is checked against `hasDraft` / `hasReply` / `workflowStatus`, which the first batch hasn't changed yet because its children are only `queued`.
  - A retry after a lost response (the 120 s `maxDuration` makes timeouts realistic) or a second tab therefore creates a second batch over the same reviews.
  - The per-review publish key may dedupe the Google write if the template body is identical; I didn't verify this in the runner.
- **Recommendation:**
  - Send `Idempotency-Key` from `queueBatch` and record it on `bulk_listing_operation`, with a unique `(organisation_id, intent_id)`.
  - Or refuse rows that already have a queued or running child (`bulk_listing_child.review_id`, status in `queued`/`running`).
- Complexity M / Risk Low / Tests: two identical starts give one batch.
- Dependencies: W2/W-jobs (runner).

### F8 Review-write invalidation is hand-rolled in six places and has drifted

- Priority: P2
- Status: **CONFIRMED**
- Location and evidence:
  - `lib/queries/invalidate.ts:13-21`: detail + reviews + counts, **no `clientsAll`**.
  - `use-bulk-review-action.ts:20-27`: reviews + counts + **clients** + details.
  - `template-reply-dialog.tsx:126-130`: reviews + counts + clients, **no details**. The open pane stays stale after a batch touching it.
  - `sync-reviews-button.tsx:44-48`, and `use-clients.ts:92-97` (also adds `locations`).
- **Consequence:** `ClientSummary.needsReply` (`lib/contracts/clients.ts:78`, `lib/server/clients.ts:139,174`) drives the client badges. A single publish, approve or delete doesn't refresh it, so the badges disagree with the rail for up to 60 s. That is the "disagreement the counts rework exists to prevent" (`use-bulk-review-action.ts:11-14`).
- **Recommendation:** one module-level `invalidateReviewSurfaces(client, { reviewIds?, await?: "detail" | "none" })` in `lib/queries/invalidate.ts` that every surface above calls, with `clientsAll` included. This also makes F2 (a) a one-place change.
- Complexity S / Risk Low / Tests: a unit test that the helper hits all four roots.

### F9 Redundant refetches right after mutations that already refreshed the same data

- Priority: P3
- Status: **CONFIRMED**
- Locations and evidence:
  - `action-bar.tsx:186` `await detail.refetch()`: `verify`'s `onSuccess` already awaited invalidation of the same active `reviewDetail` key, so this is a second identical GET. Use `queryClient.getQueryData(queryKeys.reviewDetail(id))`.
  - `sync-reviews-button.tsx:44-60`: awaits invalidation of `["review-counts"]` (the org key is always active through the shell badge), then `fetchQuery({ staleTime: 0 })` on the same key, a second GET. Read `getQueryData` after the awaited invalidate instead.
  - `photos-library.tsx:57-74`: `setQueryData` seeds the view with the fresh first page, then `invalidate: [locationMediaAll]` (run after `onSuccess`, `use-resource-mutation.ts:150-156`) prefix-matches the just-seeded key and refetches it at once. Use a predicate that excludes the seeded key.
  - `location-access-form.tsx:72-77` and `client-access-dialog.tsx:204-208`: `setQueryData(memberClientAccess)` and then invalidate `["members"]`, which prefix-matches `["members", userId, "client-access"]` (`keys.ts:144-145`), so it refetches what was just set.
- Complexity S each / Risk Low.

### F10 Shell polling: ~13 `useClients` observers each run their own 60 s interval, and background refetches redirect on 401

- Priority: P2
- Status: CONFIRMED for the 401 semantics. The extra request volume is PLAUSIBLE.
- Location: `lib/queries/use-clients.ts:20-29` (`queryFn: ({ signal }) => fetchClients(signal)` with no `background`), `lib/api/clients.ts:14-18`; observers listed by `rg 'useClients\('` (app-shell ×8, inbox ×2, …)
- **Evidence, (a) polling:**
  - `queryObserver.js:214` starts one `setInterval` per observer.
  - Observers mounted in different commits (the inbox view after navigation, the command palette or scope sheet when opened) tick at different offsets.
  - In-flight dedupe only collapses ticks that land within one request's duration.
  - The same pattern applies to `connections` (`use-connections-query.ts`, `use-connection-health.ts`, `use-connection-workspace.ts`, each with 60 s).
- **Evidence, (b) 401 handling:**
  - `apiFetch` treats a request without `background:true` as foreground.
  - A 401 on the 60 s poll or a focus refetch of `/api/clients` calls `handleUnauthorized()` (stash drafts, hard navigate). This contradicts the documented 401 rule (`client.ts:288-301`, `request-options.ts:6-17`).
  - Same gap in `useAiCredits` / `useAiCreditsDaily` (`use-ai-credits.ts:11,18`, which also forward no signal), `account-menu.tsx:137`, `use-report-shares.ts:13`, and the `lib/api/clients.ts` readers in general.
- **Recommendation:**
  - Route every `queryFn` through `requestOptions(ctx)`. Change the `fetchClients(signal)` signatures to `(options?: RequestOptions)`.
  - Put the 60 s interval on one shell-level observer only, and have the others subscribe without `refetchInterval`. Alternatively, use `queryClient.setQueryDefaults(queryKeys.clients, { refetchInterval: 60_000 })` with observers that don't override it. Note that per-observer timers still apply then, so the single-poller pattern is the real fix.
- **Measure:** `/api/clients` requests per session per minute.
- Complexity S–M / Risk Low / Tests: a `fetchClients` call from a refetch passes `background: true`.

### F11 Location-scoped keys outside the documented roots escape AccessLost cleanup

- Priority: P2
- Status: **CONFIRMED** (contract violation). Impact is PLAUSIBLE: a later scope-token change clears everything anyway.
- Location: `lib/queries/keys.ts:9-16` ("A new per-location … key must live under one of them"). Violations:
  - `["verification-state", id]` (`use-google-verification-state.ts:8`)
  - `["verification-workflows", id, op]` (`verification-saved-workflows.tsx:68`)
  - `["lifecycle-workflows", id]` and `["lifecycle-latest-attempt", id, …]` (`lifecycle-workspace.tsx:39,48`)
  - `["administration-access-workflows", id]` (`access-workspace.tsx:49`)
- **Consequence:** `resourcePrefixesForPath` (`scope-reset.ts:63-79`) drops only `["locations",id]` and its siblings, so after a 403/404 on `/api/locations/{id}/…` these caches stay readable until the session fingerprint changes.
- **Recommendation:** move them into `queryKeys` under `["locations", id, …]`. That also fixes the string-literal drift: the invalidations in `use-verification-action.ts:40-41`, `use-lifecycle.ts:34-35` and `use-administration-access.ts:24` repeat the literals by hand.
- Complexity S / Risk Low (the keys change and the invalidations follow) / Tests: a `resourcePrefixesForPath` test covering a verification key.

### F12 Counts key derivation duplicated between the server prefetch and the hook; dead `groupBy` and positional-string API

- Priority: P3
- Status: **CONFIRMED**
- Location: `use-review-counts.ts:21-30` (string join with `filter(Boolean)`), `lib/server/prefetch.ts:48` (hand-built `` `organisation:${clientId}` ``), `use-needs-reply-count.ts:22`
- **Evidence:**
  - Two places build the same string, so any change to the join silently breaks hydration and doubles the first fetch.
  - `groupBy: "client"` has no caller (`rg groupBy` finds only plumbing), and neither does the legacy positional `string` scope.
  - A `{clientId:"client"}` scope and a `{groupBy:"client"}` scope would collide. That's theoretical, since IDs are UUIDs.
  - The two observers of the org key carry different `retry` and `queryFn` options (`background:true` vs `requestOptions`), so the effective retry policy depends on which observer fetched last.
- **Recommendation:** `queryKeys.reviewCounts({ locationId, clientId })` returning a tuple. Import it in `prefetch.ts`. Delete `groupBy` and the string overload. Have `useNeedsReplyCount` call `useReviewCounts` with `select`.
- Complexity S / Risk Low.

### F13 Minor hook-hygiene items in the inbox view

- Priority: P3. Status: CONFIRMED.
- `inbox-view.tsx:201-205`: `loadMore`'s `useCallback` depends on the whole `reviewsQuery` object, which changes on every render, so the memo is a no-op. Same for `:355-376`. Depend on `hasNextPage` / `isFetchingNextPage` / `fetchNextPage`.
- `inbox-view.tsx:195`: `flattenReviews(reviewsQuery.data)` builds a new array on every render. Use `useMemo` or `select`.
- `["organisations"]` is a literal in 3 places (`account-menu.tsx:136`, `agency-name-form.tsx:91`, `policy-form.tsx:289`), and the `renameOrganisation` mutation is duplicated in the last two. Add `queryKeys.organisations` and a shared hook.
- `use-draft-mutations.ts:61-67` `useVerifyDraft` shares `mutationKey` kind `"draft"` with generate, so `useReplyPending` reports a verify as "draft". This is probably intended, but `ReplyMutationKind` has no `"verify"`.

### What is already good (brief)

- **Intent / idempotency design:**
  - Client UUID → `Idempotency-Key` → `parseIntentHeader` → ambient intent → `mutation_operation` with unique `(organisation_id, intent_id)` and payload-hash conflict detection (`mutation-operations.ts:215-275`).
  - `useResourceMutation`'s reuse of unconfirmed intents.
  - Content-derived publish keys for replies and posts. The approach is sound wherever the client actually forwards the intent.
- `AbortSignal` is forwarded through `requestOptions` on nearly all `lib/queries` reads. Superseded inbox searches are cancelled.
- Prefetch writes byte-identical data through `throughWire`, hydration is skew-aligned, and the age-preset key is deliberately not prefetched (`prefetch.ts:38`), so the server and client keys agree.
- No optimistic writes means no rollback or `cancelQueries` race class. Mutations have `retry: 0` and `networkMode: offlineFirst`.
- The receipt poll (`use-mutation-receipt.ts`) is bounded with back-off. Use it as the model for F3.

---

## Top 5 for this workstream

1. **F1 (P1)**: single-review Approve doesn't send `draftId` / `expectedReviewUpdateTime`, so it can approve a draft the approver never saw.
2. **F2 (P1)**: review mutations await a full multi-page list refetch plus counts before resolving. One-press Publish is a 2–4× read waterfall.
3. **F3 (P1)**: the unbounded 5 s settling poll refetches every loaded page and the org-wide counts.
4. **F6 + F7 (P2)**: the intent isn't forwarded for post approve and delete, and bulk template batches have no dedupe, so the server's idempotency design is bypassed.
5. **F8 + F10 (P2)**: drifting hand-rolled invalidations (client `needsReply` goes stale), and shell polls without `background:true` that redirect to sign-in on a 401.

## Cross-layer leads for other workstreams

- **W2/DB:** `lib/server/review-counts.ts:49-109` makes 3–4 sequential aggregate scans per counts call (status breakdown could fold into the totals scan). It is hit every 5–60 s per tab.
- **W2/DB:** `lib/server/bulk-reviews.ts:276-353` runs a per-review `select` inside a loop (N+1) for template batches, and `insertBatch` (`:126-133`) inserts children one row at a time.
- **W6/authz:** `app/api/reviews/bulk/route.ts:66-69`: the assign/triage path has no `mfa` / step-up, while approve does (`:70-76`). Confirm this is intended.
- **W6/authz:** `app/api/drafts/[id]/verify/route.ts:86-90` uses `requireLocationAccess` (read access) rather than an edit action check before spending AI tokens.
- **Observability:** the browser starts no span around user actions like `onPublish` (`components/inbox/action-bar.tsx:149`), so the waterfall in F2 can't be measured in production.
- **Observability/route:** the browser never sends `x-request-id`, so `clientRequestId` in audits (`lib/server/route.ts:410`) is always null for UI requests.
- **Jobs:** check that the bulk runner dedupes a review that appears in two concurrent `review_template_reply` batches (`lib/server/bulk-reviews.ts:102`).
- **Frontend perf:** `useReviewDetail` is observed three times per open review (`review-detail.tsx:1008`, `reply-composer.tsx:90`, `action-bar.tsx:75`), each with its own 5 s settling timer.
