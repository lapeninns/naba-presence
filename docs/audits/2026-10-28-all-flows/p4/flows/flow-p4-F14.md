# p4-F14 — Track a bulk operation (approve, execute, cancel, retry, results)

Worktree `/tmp/naba-presence-p4` @ `e4123d25`. Read-only mapping, 2026-10-28. Route `/listings/bulk/[operationId]`.
Line refs are to that worktree. "Hypothesis" marks anything not observed in a running app.

## 1. Start / end

- **Entry points:**
  - p4-F13 compose: "Preview…" → `router.push('/listings/bulk/{id}')` (`components/bulk/bulk-compose.tsx:691`).
  - Inbox bulk approve: "Follow this batch" (`components/inbox/bulk-action-bar.tsx:468`). The template-reply dialog has the same link (`components/inbox/template-reply-dialog.tsx:557`).
  - Re-preview from this page pushes to the new id (`bulk-operation-view.tsx:241`).
  - Notification `bulk_completed_with_failures` (`lib/server/bulk-listing-runner.ts:622`, copy at `lib/server/notifications/messages.ts:198`).
- **No batch list in the UI.** `GET /api/listings/bulk` (`listBulkOperations`, `lib/server/bulk-listings.ts:486`) has no consumer: `fetchBulkChanges` is only invalidated, never read. A batch can only be found again through its URL or a notification.
- **End states:**
  - `completed`, `completed_with_failures`, `cancelled` or `expired`.
  - Or the user leaves: "Back to listings" → `/listings` (`bulk-operation-view.tsx:362-367`).
  - Or a new preview → a new operation page.

## 2. Roles and gates

| Layer   | Gate                                                                                                                                                                                                                                      | file:line                                                                                                |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Page    | Feature `bulk_actions` only: off → `notFound()`. **No role gate.** `/listings/bulk` has one (owner/admin, else `AccessDeniedPage`).                                                                                                       | `app/(dashboard)/listings/bulk/[operationId]/page.tsx:13` vs `app/(dashboard)/listings/bulk/page.tsx:14` |
| GET     | Any session role reaches the handler. `readBulkOperation` returns 404 unless the user is a manager or the requester. Feature off → 404 `feature_disabled`.                                                                                | `app/api/listings/bulk/[id]/route.ts:10`; `lib/server/bulk-listings.ts:476-484`, `:85-95`                |
| approve | Route: `roles: owner, admin` + `mfa: step_up`. Server checks a manager again, the two-person rule, that the requester is still a member, and `canPublish` on every eligible listing.                                                      | `approve/route.ts:14-15`; `bulk-listings.ts:531-616`                                                     |
| execute | Route: owner, admin + step_up. Server: manager only.                                                                                                                                                                                      | `execute/route.ts:14-15`; `bulk-listings.ts:646-651`                                                     |
| cancel  | Route: owner, admin, member; **no step_up**; `entitlement: "exempt"`. Server: not a viewer, then `requireBatchControl` (a manager, or the requester of a _review_ batch).                                                                 | `cancel/route.ts:12-13`; `bulk-listings.ts:688-698`, `:452-468`; `lib/server/entitlement-policy.ts:89`   |
| retry   | Route: owner, admin, member + step_up. Server: same as cancel.                                                                                                                                                                            | `retry/route.ts:12-13`; `bulk-listings.ts:736-748`                                                       |
| UI      | `manager = owner or admin` (`bulk-operation-view.tsx:187`). All action buttons appear only for managers (`:275-342`). Non-managers see the note "Only owners and admins can approve, start, cancel or retry a bulk change." (`:432-440`). | —                                                                                                        |

- **Can the creator approve?**
  - Only when the org's two-person policy is **off**: `secondApproverSatisfied = !require || requestedBy !== deciderId` (`lib/server/authz/approval-policy.ts:129-135`).
  - When the policy is on, the creator is refused with 409 `second_approver_required` (`bulk-listings.ts:568-573`). The DB also blocks it with check `bulk_listing_operation_second_approver` (`supabase/migrations/0124_bulk_approval_policy.sql:29`).
  - The policy snapshot is checked too (`requireUnchangedTwoPersonPolicy`, `:562-566`).
  - The UI shows `canApprove` from the server (`:413-421`) and the copy "A different owner or administrator must approve." (`bulk-operation-view.tsx:454-458`).
- **Role gap (UI vs server):** a member who started a review batch from the inbox **can** cancel or retry it on the server (`bulk-listings.ts:458-463`). The UI hides both buttons from them and tells them only owners/admins can (`bulk-operation-view.tsx:276`, `:432-440`).

## 3. Baseline steps per action (taps, manager)

| Action       | Visible when                                             | Taps                                                                                                                                  | Notes                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Approve      | `status==='previewed'`                                   | 1. With skipped listings, 2: tick "I understand N listings are skipped…" (`:445-452`), then "Approve this exact change" (`:321-330`). | If MFA is due: the step-up prompt opens, the error shows in FormError and the user must tap again (`lib/api/client.ts:255-283`). The button is disabled with **no reason on the button** (`:267-268`). |
| Start        | `status==='approved'`                                    | 1: "Start bulk change" (`:332-339`)                                                                                                   | step_up. Approve and Start are always two separate taps; a different person may do each.                                                                                                               |
| Cancel       | `previewed`, `approved` or `running`                     | 1: "Cancel remaining listings" (`:278-288`)                                                                                           | **No confirmation.** It cannot be undone (`bulk-listings.ts:708-710`). Same label in `previewed`, where nothing has been sent yet.                                                                     |
| Retry        | `retryable>0` and `running` or `completed_with_failures` | 1: "Retry N unsettled changes/listings" (`:290-299`)                                                                                  | step_up. N counts failed + ambiguous on the client. The server may requeue fewer (see §7 F5).                                                                                                          |
| New preview  | `canRepreview` (not review batches)                      | 1: "New preview for N listings not sent" (`:301-319`)                                                                                 | Pending label "Reading each listing…". It navigates to a new operation.                                                                                                                                |
| Receipt      | child has `mutationOperationId`                          | 1 per row: "Show receipt" / "Hide receipt" (`:641-650`)                                                                               | Fetched lazily.                                                                                                                                                                                        |
| Open listing | always                                                   | 1: the listing name link stretched over the row (`:520-530`)                                                                          | —                                                                                                                                                                                                      |

## 4. States (exact copy)

**Page and query**

- **Loading:** `QueryStates pendingLabel="bulk change"` (`bulk-operation-view.tsx:370-375`). The header title is "Bulk change" until data arrives (`:355-358`).
- **Error, including not found:** "The bulk change could not be loaded", plus the generic `describeActionError` text and "Try again" (`:373-374`; `components/ui/query-states.tsx:114-141`). A 404 `bulk_operation_not_found` (`bulk-listings.ts:52-57`) gets the **same** screen and offers "Try again". A 404 is never retried (`lib/queries/query-client.ts:11-16`).
- **Feature off:** the page `notFound()` (app 404). The API answers 404 "Bulk changes are not available for this workspace." (`bulk-listings.ts:85-90`).
- **Polling:** `refetchInterval` is 5 s only while `status==='running'` (`:195-196`). `refetchOnWindowFocus` is on and data goes stale after 30 s (`query-client.ts:22-24`). There is no "last updated" time.
  - **Background error:** if a poll fails after its one retry, `queryStatus` returns `error` because `isError` is true even with data. The whole page body is replaced by the error screen (`query-states.tsx:29-37`; `:371`).

**Operation status line** (`role="status"`, `:392-412`). The counts follow, joined by " · " in child order, e.g. "1 confirmed · 1 failed".

| status                  | Copy                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| previewed               | "Waiting for approval."                                                  |
| approved                | "Approved. Start it to queue each listing."                              |
| running                 | "Running. This page updates on its own; you can leave it."               |
| completed               | "Every eligible listing is confirmed."                                   |
| completed_with_failures | "Finished with some listings not changed."                               |
| cancelled               | "Cancelled. Listings already confirmed keep their change."               |
| expired (fallthrough)   | "This change expired. Nothing more will be sent; prepare a new preview." |

- **Server-effective status:** `previewed` past 15 min, or `approved` past dispatch, reads as `expired` before the sweep records it (`bulk-listings.ts:108-111`). The same rule applies per child (`:118-126`).
- **Progress:** "{confirmed} of {total} {listings|changes} confirmed on Google" + `<Progress>` (`:413-427`). It is shown when the status is not previewed or expired. `total` = children − skipped. `confirmed` = `counts.succeeded`, computed on the server in `project()` (`bulk-listings.ts:404-406`).
- **Deadline** (`:566-615`):
  - previewed: "Approve by {time}; after that this preview expires and Google must be read again. {m:ss} left" (not a live region).
  - previewed, closed: "This preview expired at {time} and can no longer be approved. Prepare a new preview to read Google again." (`role="alert"`).
  - approved or running: "Listings not sent by {time} will not be sent." Once the window has closed: "The sending window closed at {time}; listings not sent by then were not sent."
- **Approval area:** the skipped checkbox; "A different owner or administrator must approve." (`:443-460`).
- **Action error:** `<FormError>{failure}</FormError>` (`:442`). The server message is used, e.g. "This preview expired. Prepare a new one.", "The preview changed. Review it again.", "This bulk change has already finished.", "Only a bulk change with failed listings can be retried." (`bulk-listings.ts:543-559`, `:700-706`, `:745-751`). Fallback: "That action could not be completed." (`:218`).

**Per-listing outcomes**

- **Pills** (`:47-58`): Ready, Skipped, Queued, Sending, Confirmed, Failed, Changed on Google, Outcome unknown, Cancelled, "Expired, not sent".
- **Reason lines** (`:59-162`): about 75 codes, e.g. "Interrupted; retry reads Google before anything is sent again". The fallbacks are "Google rejected the change" and "Checked on Google: the change didn't apply; retry to send it".
- **Other row text:** "Waits for the earlier changes to this listing" (`:691`). "Google shows the change" (`:692`). Rows read current → proposed (`:707-714`).
- **Partial failure:** `completed_with_failures` + Failed pills + a Retry button. Confirmed listings stay changed (`:180-184`).
- **Cancelled:** `previewed` and `queued` children → cancelled. A child that is `running` at that moment keeps sending (`bulk-listings.ts:708-710`). The runner leaves a cancelled batch's status alone (`bulk-listing-runner.ts:586-592`). The UI **stops polling** (status is not running), so that row can stay "Sending" until a reload.

## 5. Protected rules (do not change)

- **Idempotency.** It comes from row locks and the state machine, not receipts:
  - `loadForUpdate … for update` (`bulk-listings.ts:446`).
  - execute on `running` returns the view without writing (`:656`).
  - approve outside `previewed` → 409 (`:540-545`); cancel on a closed batch → 409 (`:699-706`).
  - retry never touches succeeded children or ones still in recovery or under a publish attempt (`:760-788`).
  - Every POST still sends an `Idempotency-Key`, minted per call (`lib/api/client.ts:312-316`; `lib/server/route.ts:113-120`).
- **Approve exactly what was shown.** `expectedPreviewHash` must equal `preview_hash` (`:553-558`). Skipped listings must be acknowledged (`:599-604`). There is a 15-minute window (`:547-552`) and a 24-hour dispatch window (`:622`). The approval assurance is recorded (`:617-622`).
- **Two-person approval:** §2. Route, server and DB constraint.
- **State machine:**
  - previewed → approved (approve) → running (execute) → completed or completed_with_failures (runner).
  - running or completed_with_failures → running (retry, only if anything was requeued; `:788-789`).
  - previewed, approved or running → cancelled; time → expired.
- **Progress truthfulness:** counts, status and expiry come only from the server (`project()`, `:380-428`). The client only counts down using the server clock offset (`:222-231`); the server still decides at approval.
- **Role gates:** §2. The UI must never show an action the server would refuse. Widening the UI to match `requireBatchControl` is allowed; server rules are not to be changed.
- **Out of scope:** migrations, dependencies and feature flags; `bulk_actions` stays dark.

## 6. Audit status (15 Oct UX audit)

- Bulk edit was **not exercised**: "the `bulk_actions` feature is off for the seeded organisation" (`docs/audits/2026-10-15-ux-flows/findings.md:747`). There are no bulk-specific findings.
- **L02 is still open.** The activity cursor regex is `/^(management|hours|profile|menus|links|media|posts|reviews):…/` (`lib/contracts/location-activity.ts:41`), but the projection emits `'bulk:' || c.id` (`lib/server/location-activity-projection.ts:52`). Paging past a bulk row on a listing's activity may return `invalid_cursor` (`results.md:526`). This is a shared contract outside this page; flag it to the owner of the listings/activity flow.

## 7. Friction

| #   | P   | Friction                                                                                                                                                                                                                                                                                                                        | Evidence                                                                                      |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| F1  | P1  | A failed background poll replaces the whole running batch (progress, rows, actions) with "The bulk change could not be loaded". **Hypothesis:** a network blip during a run looks like the batch is lost.                                                                                                                       | `queryStatus` (`query-states.tsx:29-37`) used at `:371`; retry once (`query-client.ts:11-16`) |
| F2  | P1  | "Cancel remaining listings" fires at once and cannot be undone. On a phone it sits in the docked bar beside the primary. In `previewed` it discards a preview that sent nothing, under a label that implies sending.                                                                                                            | `:278-288`, `:464-471`; `bulk-listings.ts:708-710`                                            |
| F3  | P2  | Polling stops at `cancelled` (and at `approved` after another person starts it) even while children are `running`/`queued`. A "Sending" pill freezes, and the "can leave it" promise does not hold after cancelling.                                                                                                            | `:195-196`; `bulk-listing-runner.ts:586-592`                                                  |
| F4  | P2  | After a 409 (another admin already approved, cancelled or started; preview hash stale) the error shows but the data is **not refreshed**, so stale buttons stay. The FormError sits at `:442`, far above the docked bar on a long list. The disabled Approve gives no reason in the bar. **Hypothesis:** off-screen on a phone. | `:209-219`, `:442`, `:267-268`                                                                |
| F5  | P2  | The Retry label counts failed + ambiguous children. The server skips "stuck" dependants, children still in recovery and review publishes in flight (`bulk-listings.ts:760-788`). With 0 requeued the status does not change and **nothing says so**. Some copy is unclear: "unsettled" is jargon.                               | `:262-265`, `:298`                                                                            |
| F6  | P2  | A not-found or not-yours batch gets a retryable generic error. "Back to listings" is the only way out and there is no batch list.                                                                                                                                                                                               | `:373-374`; §1                                                                                |
| F7  | P2  | A member who requested a review batch is told only owners/admins can cancel or retry, which is false for them.                                                                                                                                                                                                                  | `:432-440`; `bulk-listings.ts:458-463`                                                        |
| F8  | P3  | When Approve/Start succeeds, the pressed button unmounts and focus falls to `<body>`. **Hypothesis** for keyboard and screen-reader users.                                                                                                                                                                                      | `:321-340`                                                                                    |
| F9  | P3  | The `role="status"` line contains every count, so each 5 s poll that changes a count re-announces the whole sentence. The count order follows the child sort, not the lifecycle.                                                                                                                                                | `:392-412`, `bulk-listings.ts:404-406`                                                        |
| F10 | P3  | The page has no role gate, unlike `/listings/bulk`. A viewer lands on the generic error rather than an `AccessDeniedPage`.                                                                                                                                                                                                      | `page.tsx:13` vs `bulk/page.tsx:14`                                                           |

## 8. Proposed changes (all in `components/bulk/bulk-operation-view.tsx` unless noted; shared files are only consumed)

1. **Keep the batch on screen when a refresh fails** (F1).
   - Change: `status={queryStatus({ isPending: query.isPending, isError: query.isError && !query.data })}` at `:371`. When `query.isRefetchError`, add a muted line in the summary card (`:387-441`): "Couldn't refresh at {time}. Showing the last known state; trying again." Polling continues because `data` is kept.
   - Benefit: progress stays truthful (last server state, labelled as such).
   - Principles: Nielsen #1 Visibility of system status; WCAG 2.2 SC 4.1.3 Status Messages.
   - Shared: no; `queryStatus` is consumed as is.
2. **Confirm Cancel, and name it per state** (F2).
   - Change: wrap the cancel button (`:278-288`) in `AlertDialog`, as `components/settings/invitations-panel.tsx:1124-1130` does.
   - previewed: label "Discard this preview"; dialog "Discard this preview? Nothing has been sent to Google."
   - approved or running: label "Stop listings not yet sent"; dialog "Stop {n} listings not yet sent? {confirmed} confirmed keep their change. Listings already sending finish. This can't be undone."
   - `n` = `counts.previewed + counts.queued` from the server. Confirm button `variant="destructive"`; Cancel is the default focus.
   - Benefit: no accidental irreversible stop.
   - Principles: Nielsen #5 Error prevention; HIG destructive actions (confirm, clear consequence); WCAG 2.2 SC 3.3.4 Error Prevention.
   - Shared: consumes `components/ui/alert-dialog.tsx`, unchanged.
3. **Poll while anything is still moving** (F3).
   - Change at `:195-196`: `refetchInterval: ({ state }) => { const d = state.data; return d && (d.status === "running" || d.children.some(c => c.status === "queued" || c.status === "running")) ? 5_000 : false }`. For `cancelled` with running children, add "One listing is still finishing; this page updates on its own." under the status line.
   - Benefit: the last pill settles without a reload; counts stay server-sourced.
   - Principle: Nielsen #1. Read-only; no server change.
4. **Errors where the action is; refresh after a conflict; an honest retry result** (F4, F5).
   - Change, `onError` (`:214-219`): if `ApiClientError` with status 409, `void query.refetch()`.
   - Change, ActionBar (`:464-471`): pass `status={failure ?? approveBlockedReason}`. `ActionBar.status` is announced politely (`components/ui/action-bar.tsx:50-53`). `approveBlockedReason` = "Tick the skipped-listings box to approve" or "A different owner or administrator must approve". Keep `<FormError>` for desktop, or drop it to avoid a double announcement.
   - Change, `onSuccess` for retry: compare `retryable` before and after. If nothing moved to queued, set the note "Nothing could be retried yet: these listings need a new preview or are still being checked on Google."
   - Change, copy: "Retry {n} unsettled …" → "Retry {n} failed {unit}".
   - Principles: Nielsen #9 Help users recognize, diagnose, recover; WCAG 2.2 SC 3.3.1 Error Identification and 4.1.3.
   - Shared: no; consumes ActionBar.
5. **A real not-found state** (F6, F10).
   - Change at `:373-374`: when `query.error` is an `ApiClientError` with status 404, render `QueryError` without `onRetry`, titled "This bulk change wasn't found", with description "It may belong to someone else or the link is wrong." and a link "Back to listings". Keep the current copy and retry for other errors.
   - Optional F10, which touches the page file (area-owned): mirror the `/listings/bulk` viewer gate with `AccessDeniedPage` in `page.tsx:13`. Non-managers must still reach their own review batches, so gate only `viewer`.
   - Principle: Nielsen #9 (no retry that cannot succeed); HIG clear error states.
6. **Match the UI to `requireBatchControl`** (F7).
   - Change: `const userId = useSession().data?.session?.userId`; `canControl = manager || (isBulkReviewOperation(op.operation) && op.requestedBy === userId)`. Use `canControl` for the Cancel and Retry buttons (`:276-300`). Approve and Start stay manager-only.
   - Change, note (`:432-440`): show it only when `!canControl`. If `canControl && !manager`: "Only owners and admins can approve or start a bulk change."
   - Benefit: requesters can stop their own reply batch.
   - Principle: Nielsen #4 Consistency (UI and server rules agree).
   - Server is unchanged. `useSession` comes from `lib/queries/use-session.ts:9` (shared, consumed).

**Not proposed, P3, for later:**

- F8: after Approve/Start succeeds, move focus to the status line (`tabIndex=-1`) — WCAG 2.4.3 Focus Order.
- F9: take the counts out of the `role="status"` element into a sibling, and order them by lifecycle.
- A batch list: there is a contract and API for it, but it needs a product decision.

## 9. Tests

- **Existing:** `tests/components/bulk-operation-view.test.tsx` (812 lines). It mocks `useSessionRole` (`:26-29`) and `fetch` via `serve()` (`:185`, `:765`).
- **Copy pinned there:**
  - the role note `:776-812`. Change 6 keeps the string for managers-only, so the existing three-row `it.each` still passes. The mock must add `useSession` returning `{ data: { session: { role, userId } } }`.
  - "Approve this exact change" `:451-489`
  - "New preview for 1 listing not sent" `:465`, `:577`
  - "Approve by" `:146`
  - "1 expired, not sent" via `getByRole("status")` `:179`
- **e2e:** `tests/e2e/operations-features.spec.ts` pins "Waiting for approval.", "Approve this exact change", "Start bulk change", "Running.", "Every eligible listing is confirmed.", "Confirmed" ×2 and "This change expired." (`:585-660`).
- **Unchanged and not referenced by tests:** "Cancel remaining listings", "Retry … unsettled", "That action could not be completed.", "The bulk change could not be loaded" (the hits for that string are in other components). Changes 2 and 4 break no assertion.
- **Focused tests to add** (same file, existing harness):
  1. A running batch whose second fetch rejects keeps its rows and shows "Couldn't refresh". Use fake timers and the poll at 5 s.
  2. Cancel opens a dialog with server-derived counts; dismissing sends no POST; confirming POSTs `/cancel` once.
  3. A cancelled batch with a `running` child re-fetches after 5 s; a cancelled batch with none does not.
  4. A 409 on approve triggers a refetch; the message appears in the "Bulk change actions" toolbar status.
  5. A 404 shows "This bulk change wasn't found" and no "Try again".
  6. A member requester of a `review_approval` batch sees Cancel and Retry; a member on a listing batch does not.
- **Server regression:** `pnpm exec vitest run tests/integration/routes/bulk-listings.test.ts`. It covers two-person (`:768`), cancel (`:357`), retry with recovery (`:903`) and prerequisite chains (`:1768`). None changes; run it as a guard.
- **Checks to run:** `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest run tests/components/bulk-operation-view.test.tsx`.

## 10. Screenshot states reachable in the visual fixture

- `tests/visual/nm-capture.mjs:113-114,132` captures `/listings/bulk`, `/listings/bulk/00000000-0000-4000-8000-000000000000` and `viewer:/listings/bulk`. Nothing in `tests/visual/` enables `bulk_actions`; only the e2e helper does (`tests/e2e/helpers/operations-backend.ts:153`). So the operation route renders the **app 404** (`page.tsx:13` `notFound()`). That is the only F14 state reachable in the visual fixture.
- If the fixture turned the feature on (a fixture change, not a flag change), the zero UUID would show the generic "The bulk change could not be loaded" + "Try again" screen. That is the before-shot for change 5.
- Every other state (previewed with countdown, expired preview, approved, running with progress, completed, completed_with_failures with Retry, cancelled, receipts, role note) is reachable only through the e2e backend. Existing captures: "bulk-preview", "bulk-confirmed", "bulk-preview-countdown", "bulk-preview-expired" (`operations-features.spec.ts:595`, `:609`, `:650`, `:658`), plus "bulk-receipt" (`:698`). Also through component tests with `serve()` fixtures. Add e2e captures for cancelled, completed_with_failures and the cancel dialog to get before/after evidence.
