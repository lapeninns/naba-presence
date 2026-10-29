# p4-F06: Act on a post from the list (publish, approve or reject, delete, retry)

Worktree `/tmp/naba-presence-p4` at `e4123d25`. Mapped from the code only: no browser, tests or dev server were run. Anything not seen in a running app is marked **Hypothesis**.

## 1. Start and end

- **Start:** `/listings/[id]/posts`. `PostsTab` → `PostsList` draws one `PostCard` per post (`components/locations/posts-tab.tsx:402-468`). Each card's `actions` slot is a `PostsActionBar` (`posts-tab.tsx:436-465`).
- **Shape of a row** (`components/locations/posts-action-bar.tsx:108-115`): one visible next action, plus a "More actions for <title>" menu (`:363-428`).
  - The visible action depends on status: Publish, Publish now, Request approval or Retry publish (`:307-325`); Check Google (`:326-339`); Approve (`:340-350`); View on Google (`:351-361`).
  - The menu holds Edit, Schedule publication, Reject, a separator, then Delete or "Delete from Google".
- **End:**
  - Success toast: a Google-kind toast for Google writes, a local toast otherwise.
  - The posts query is invalidated (`invalidate` at `:158`), and the row re-renders with its new status, or disappears after a delete.
  - Alternative end: an inline `OperationReceiptNotice` follows a lost or ambiguous publish until it settles (`:450-461`).
- **Out of scope here:** Edit and Schedule (they open F05 and F07 sheets), and the Refresh / Check Google now control (F04).

## 2. Roles and gates (client, mirrors server)

| Action                                | Client gate (file:line)                                                                                                                    | Server gate                                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publish / Retry                       | `postPublishGate`, `components/locations/posts/post-publish.ts:20-39`. Reason = paused, or `resourceDisabledReason(caps,"posts")`.         | `request_approval` action plus `requiresPostApproval` (`lib/server/posts.ts:1660-1665`, `:1361-1369`). `PUBLISH_ENABLED` gives a 503 (`publish/route.ts:22-24`). `mfa:"step_up"` (`publish/route.ts:18`, `lib/server/route.ts:445`).                 |
| Request approval (`!caps.canPublish`) | Same function, `requestApproval` branch: paused or `contentEditDisabledReason` (`post-publish.ts:34-37`)                                   | The same route parks the post, 202 (`publish/route.ts:33-35`, `posts.ts:1762-1785`)                                                                                                                                                                  |
| Approve                               | `resourceDisabledReason(caps,"posts")` ?? `decideApprovalDisabledReason` (`posts-action-bar.tsx:254-256`, `lib/locations/gating.ts:60-69`) | `decide_approval` (`posts.ts:1660-1665`). Two-person rule: an own request gets 403 `second_approver_required` (`posts.ts:1689-1696`, `isOwnRequest` `:1426-1427` = requester **or** author). Revision bound (`requirePendingDecision` `:1433-1459`). |
| Reject                                | `pausedReason ?? decideReason` (`posts-action-bar.tsx:257`)                                                                                | `decide_approval` (`posts.ts:1836-1841`). Withdrawing your own request writes no decision row (`:1846-1849`). The approval route still 503s when paused (`approval/route.ts:26-28`).                                                                 |
| Delete draft                          | `pausedReason ?? editReason` (`posts-action-bar.tsx:261-263`)                                                                              | `edit` (`posts.ts:2233`). Route 503 when paused (`[postId]/route.ts:65-67`). `mfa:"step_up"` (`:62`).                                                                                                                                                |
| Delete live                           | `resourceDisabledReason(caps,"posts")` (`posts-action-bar.tsx:261-262`)                                                                    | `edit` plus `requirePublishGrant` `publish_permission_required` (`posts.ts:2270-2273`)                                                                                                                                                               |
| Check Google (ambiguous)              | No gate. It is a GET (`posts-action-bar.tsx:231-240`).                                                                                     | Read only                                                                                                                                                                                                                                            |

A disabled visible action shows its reason as a caption (`posts-action-bar.tsx:303`, `:462-466`). A disabled menu row stays focusable and carries the reason as `aria-describedby` (`components/ui/dropdown-menu.tsx:153-177`). The page banner gives the pause or viewer reason (`posts-tab.tsx:310-319`).

**Visibility gap:** `postRowSchema` (`lib/contracts/location-posts.ts:227-251`) carries no `approvalRequestedBy` or `authorId`, and `LocationCapabilities` carries no two-person flag. The client therefore cannot tell "your own request" from "someone else's", or "your publish will park".

## 3. Baseline steps (taps from the list)

| Action                                                                    | Steps                                                                                                                                 | Taps   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Publish a draft (publisher)                                               | Publish (or "Publish now" with scheduling) → AlertDialog with preview → "Publish to Google"                                           | 2      |
| Request approval (non-publisher)                                          | "Request approval" acts at once: no dialog, nothing goes to Google (`:311-315`)                                                       | 1      |
| Publish under two-person policy (publisher, e.g. the fixture "requester") | Publish → dialog says customers see it → "Publish to Google". The server parks it, and the toast reads "Post submitted for approval." | 2      |
| Retry a failed publish                                                    | "Retry publish" (with RefreshCw icon) → the same publish dialog → "Publish to Google"                                                 | 2      |
| Approve                                                                   | Approve → "Approve and publish this post?" with preview → "Approve and publish"                                                       | 2      |
| Reject                                                                    | ⋯ → Reject acts at once: no confirm, no reason field (`:399-411`)                                                                     | 2      |
| Delete a draft or live post                                               | ⋯ → Delete / "Delete from Google" → confirm → Delete / "Delete from Google"                                                           | 3      |
| Ambiguous post                                                            | Check Google (one GET), then the toast gives the verdict. If it settles failed, Retry publish appears.                                | 1 (+2) |

## 4. States and exact copy

**Publish dialog** (`posts-action-bar.tsx:467-500`)

- Title: "Publish this post to Google?"
- Description: "Customers see it on the listing as soon as Google accepts it. To change it afterwards, edit it here and it is sent again."
- If scheduled (`:479-484`): "This post is also scheduled ({rule}). Publishing it now means the scheduled publication does not run."
- `PostPreview` follows. Buttons: "Not yet" and "Publish to Google" (pending: "Publishing…").
- Escape and outside-click are blocked while the publish is pending (`:469-471`).
- A failed post gets the same dialog unchanged. Only the row button says "Retry publish" (`:293-299`).

**Request approval**

- Pending label: "Requesting…" (`:318`).
- Toast: "Post submitted for approval." (`post-publish.ts:51-52`), a local toast because `kind` is not set to google (`:78-82`).

**Publish outcome toasts** (`post-publish.ts:46-70`), all `kind:"google"`, which means no Undo (`components/ui/toast.tsx:373-392`):

- "Post live on Google"
- "Post sent to Google" with "Google is still reviewing it, so it may not show yet."
- "Google rejected this post."
- uncertain: the default outcome copy.

**Approve dialog** (`posts-action-bar.tsx:501-532`)

- Title: "Approve and publish this post?"
- Description: "Approving sends exactly this post to Google. Customers see it once Google accepts it."
- Buttons: "Not yet" and "Approve and publish" (pending: "Publishing…").
- The dialog closes `onSettled`, so it also closes on an error (`:519-522`).
- The row's Approve button shows a spinner only; it has no pending label (`:346`).

**Reject**

- While deciding, the menu row reads "Deciding…" (`:401-405`), but the menu has already closed, so this text is never seen. **Hypothesis.**
- Toast: "Sent back to draft", a plain local toast (`:205-206`).
- Afterwards the card shows only "Draft", and History says "Approved · If your policy asks" (`posts-tab.tsx:98-113`). Nothing records that it was rejected, or by whom.

**Delete dialog** (`posts-action-bar.tsx:533-575`)

- Title: "Delete this post from Google?" or "Delete this post?"
- Description when live: "This removes the post from your Google Business Profile. Customers stop seeing it straight away, and it can’t be undone."
- Description otherwise: "This deletes the post from NabaPresence." (when uncertain), or "This deletes the draft."
- Extra note:
  - ambiguous: "Deleting here doesn’t touch Google. If Google did receive this post, it stays there; use Check Google first to find out."
  - publishing: "…This post is still being sent, so if Google receives it, it stays there."
  - else: "Only NabaPresence has it, so Google is not affected."
- Buttons: "Keep it" and a danger button, "Delete" or "Delete from Google" (pending: "Deleting…" or "Deleting from Google…").
- Toast: "Post deleted". It is google-kind when live (`:224-228`).
- **On an error the dialog stays open:** `onError` is not set, and the error appears only as a toast. **Hypothesis:** that toast is outside the modal's focus.

**Check Google** (`:98-106`). Pending label: "Checking Google…". Toasts:

- "We couldn’t reach Google just now. Try again shortly."
- "This post is live on Google."
- "Google doesn’t have this post, so you can publish it again."
- "Google’s copy of this post is still unclear."

**Errors** are toasted through `describeActionError` with `errorContext:"post"`. Codes and copy:

| Code                       | Source                           | Copy                                                                                                                                                                                                       |
| -------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `second_approver_required` | `lib/errors/action-errors.ts:34` | "A different authorised user must approve this post."                                                                                                                                                      |
| `approval_post_changed`    | `:226`                           | "This post changed after you opened it. Read the current version before approving or rejecting it."                                                                                                        |
| `post_changed_since_saved` | `:231`                           | "This post changed after it was saved or opened, so nothing was sent to Google. Check the current version in the list, then publish it again." The client also refetches (`posts-action-bar.tsx:182-188`). |
| `post_publish_in_progress` | `:376`                           |                                                                                                                                                                                                            |
| `post_publish_uncertain`   | `:388`                           |                                                                                                                                                                                                            |

- A lost or ambiguous answer becomes `OperationReceiptNotice` inline, under the row (`posts-action-bar.tsx:450-461`).
- A failed row also shows a `role="note"` problem box. With a generic code it reads "Google didn’t accept this post, so nothing is live. Edit it or publish it again." (`posts-tab.tsx:145-158`).
- An ambiguous row reads "We couldn’t confirm whether Google has this post. Check Google before publishing again, so it isn’t posted twice." (`:160-161`).

**Focus**

- The dialogs are Base UI `AlertDialog`, opened from state, not from a trigger. On close they return focus to the element that was focused before.
- After Publish, Approve or Reject succeeds, the button that had focus unmounts when the row re-renders: Publish disappears for a published post, and Approve disappears for a draft.
- After Delete, the whole `<li>` unmounts.
- **Hypothesis:** in all three cases focus falls to `<body>`. The only announcement is the polite toast (`toast.tsx:443`).

## 5. Protected rules (do not change)

1. **No Undo on Google writes (D5).** `post-publish.ts:72-82` and `toast.tsx:234-237`, `:373-392`. Publish, approve and live delete keep their consent dialog.
2. **Two-person approval.**
   - `requiresPostApproval` (`posts.ts:1361-1369`).
   - `qualifyingApproval` excludes the author, is revision- and hash-bound, voided by a later reject or an MFA recovery (`:1389-1420`).
   - An own request or own content cannot be approved under the policy: 403 `second_approver_required` (`:1689-1696`, `isOwnRequest` `:1426-1427`).
   - Without the policy, approving your own request is a plain publish, with no decision row (`:1697-1702`).
3. **Revision binding.**
   - Publish sends `expectedRevision` (`posts-action-bar.tsx:165-168`); a mismatch gives 409 `post_changed_since_saved` (`posts.ts:1732-1740`).
   - Approve and reject send `contentRevision` (`posts-action-bar.tsx:196-198`); the server checks with `requirePendingDecision` (`posts.ts:1433-1459`).
4. **Idempotency.**
   - Intents are keyed by `[post.id, contentRevision]` for publish, `[post.id, decision, revision]` for decide, and `post.id` for delete (`posts-action-bar.tsx:171`, `:201`, `:217`).
   - The server uses the receipt replay (`posts.ts:1487-1560`), the delete receipt (`:2234-2248`), and the request-scoped delete key (`:2289-2297`).
5. **No blind republish of an ambiguous post.** The client offers only Check Google (`posts-action-bar.tsx:326-339`). The server reconciles before it decides (`posts.ts:1747-1752`, `:1790-1800`). A `publishing` post gives 409 (`:1742`).
6. **Server authority.** The toast follows `operation.outcome`: "live" only on `confirmed_applied` (`post-publish.ts:56-69`).
7. **Gates.** `decide_approval` for both approve and reject (`approval/route.ts:37-41`, `posts.ts:1836-1841`). `PUBLISH_ENABLED` 503 on publish and approval. `mfa:"step_up"` on publish, approval and delete.
8. **Approval reads what goes out.** The approve dialog shows the same `PostPreview` (`posts-action-bar.tsx:153`, `:513`).

## 6. Audit status (15 Oct, `docs/audits/2026-10-15-ux-flows/`)

- **LST-11** (P1, publish only via list dialog): **fixed**, per `results.md:219` (#151, #174). The composer now publishes with a consent line. The list's own publish dialog remains on purpose, as the list path (D5 consent).
- **D5 (no Undo on Google writes):** enforced in code (§5.1). The audit's `posts-action-bar.tsx:122` reference has moved to `post-publish.ts:73-77`. RC-CONFIRM (Undo for local actions) was never applied to post Reject or draft Delete. Both need a server undo, which is an owner decision (`findings.md:109-110`).
- **Raw failure code on a failed post** (follow-up 17, `results.md:363`, `:485`): **fixed** in F9 (#222). `posts-tab.tsx:145-158` now uses `describeErrorCode` plus `SupportDetails`.
- **LST-24** (every row "Update"; "Lifecycle"): fixed (`results.md:231`).
- **"Posts awaiting approval" never captured** (`findings.md:752`): **remains a gap in the evidence.** The fixture can reach it now (§10).
- **"Schedule publication" in the overflow not reachable** (`findings.md:748`): F07's concern.
- **Not in the audit, found here:** F1–F5 below.

## 7. Friction

| #   | P   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                  | Evidence                                                                                                                                                                                              |
| --- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | P1  | Under two-person approval, a publisher's Publish dialog promises "Customers see it on the listing as soon as Google accepts it". The server then parks the post and the toast says "Post submitted for approval." The consent copy is untrue for this role. Inbox solved the same case with "Submit for approval" (plan D1/D2, `components/inbox/action-bar.tsx:297-301`).                                                               | `posts-action-bar.tsx:474-478`. Server parks at `posts.ts:1760-1785`. Fixture requester is member `can_publish=true` with `require_two_person_approval` (`tests/e2e/helpers/stub-bridge.ts:766-820`). |
| F2  | P1  | The requester (or author) of an awaiting post who holds publish authority sees **Approve** enabled. They tap it, read the dialog, tap "Approve and publish", and only then get 403 "A different authorised user must approve this post." That is two taps to a dead end. Inbox hides Approve via the server-set `canApprove` (`components/inbox/action-bar.tsx:285-296`). Posts rows carry no such field.                                | `posts-action-bar.tsx:340-350`, `:254-256`. `isOwnRequest` at `posts.ts:1426`. The fixture requester can do exactly this.                                                                             |
| F3  | P2  | "Reject" is one tap from the menu, with no confirmation. It writes a permanent decision row that voids earlier approvals (`posts.ts:1405-1412`). Its label is the same word the page uses for Google's verdict ("Google rejected this post", History meta "Rejected", `posts-tab.tsx:121`, `:141`). The toast's own words are "Sent back to draft". For the person's own request the action is really "withdraw" (`posts.ts:1846-1849`). | `posts-action-bar.tsx:399-411`, `:205-206`                                                                                                                                                            |
| F4  | P2  | After a reject the requester gets no trace: the card reads "Draft", and History reads "If your policy asks". **Hypothesis**, since no row field carries the decision. A fix needs server data; this is a follow-up only.                                                                                                                                                                                                                 | `posts-tab.tsx:98-113`, `postRowSchema`                                                                                                                                                               |
| F5  | P2  | When an action succeeds, its own control unmounts (Publish, Approve, or the whole row on Delete). **Hypothesis:** focus drops to `<body>`, and a keyboard or switch user restarts from the top of the page. That fails WCAG 2.2 SC 2.4.3 Focus Order and the HIG's "preserve context".                                                                                                                                                   | `posts-action-bar.tsx:175`, `:221`, `:307-350`. Row key at `posts-tab.tsx:422`.                                                                                                                       |
| F6  | P2  | A non-decider's awaiting post (the requester without publish authority) shows a **disabled Approve** with "Only someone who can publish this location can approve or reject requests." It reads as an error rather than as status ("Waiting for an approver" is hidden in History).                                                                                                                                                      | `posts-action-bar.tsx:303`, `:340-350`; `gating.ts:66-68`; `posts-tab.tsx:108-109`                                                                                                                    |
| F7  | P3  | The Retry dialog is identical to a first publish. It does not say a previous attempt failed, or that a retry is safe.                                                                                                                                                                                                                                                                                                                    | `posts-action-bar.tsx:474-478` vs `:293-299`                                                                                                                                                          |
| F8  | P3  | A failed delete leaves the modal open and reports the error only in a toast, far from the dialog (RC-FEEDBACK). The approve error closes its dialog, so the copy differs by action. **Hypothesis.**                                                                                                                                                                                                                                      | `posts-action-bar.tsx:212-230`, `:519-522`                                                                                                                                                            |
| F9  | P3  | Reject's progress ("Deciding…") lives in a menu that has already closed, and the Approve button's spinner has no `pendingLabel`. Neither has a visible or announced in-progress text.                                                                                                                                                                                                                                                    | `:346`, `:401-405`                                                                                                                                                                                    |

## 8. Proposed changes (6; all in flow-owned files unless flagged)

**C1 (F1). True consent copy when the publish may park.**

- **Change:** the publish dialog description should cover both outcomes. In `components/locations/posts-action-bar.tsx:475-478`, replace it with: "Customers see it on the listing as soon as Google accepts it. If your organisation needs a second approver, it waits for them first and nothing goes to Google yet. To change it afterwards, edit it here and it is sent again."
- **Better, with a shared flag:** add `requireTwoPersonApproval` to the posts list response (`lib/contracts/location-posts.ts`, `lib/server/posts.ts` list read, which already selects `o.require_two_person_approval` at `posts.ts:711-713`). The label then becomes "Request approval" and the dialog is skipped, exactly as for a non-publisher (`post-publish.ts:34`).
- **Benefit:** consent matches the outcome. It meets server authority.
- **Principle:** Nielsen #1 and #2; WCAG 3.3.4 Error Prevention.
- **Shared:** the preferred variant touches `lib/` (shared). The copy-only variant is local.

**C2 (F2). Don't offer Approve to someone the server will refuse.**

- **Change:** add a read-only per-row `canApprove: boolean` to `postRowSchema` (optional, so an older server still parses). The server computes it with the existing `isOwnRequest` and `requireTwoPersonApproval` (no rule change).
- In `posts-action-bar.tsx:340`, render Approve only when `post.canApprove !== false`. Otherwise show the caption "Waiting for another approver". Rename Reject to "Withdraw request" for your own request.
- **Benefit:** removes a two-tap dead end. Matches Inbox's pattern.
- **Principle:** Nielsen #5 Error prevention and #4 Consistency; HIG consistency.
- **Shared and protected-adjacent:** this touches `lib/contracts`, `lib/server/posts.ts` (shared, server). It is display only, and the 403 stays authoritative. If out of bounds, record it as a follow-up and ship C1 only.

**C3 (F3, F9). Say what Reject does, and show it working.**

- **Change:** in `posts-action-bar.tsx:407-409`, change the label "Reject" to "Send back to draft", which matches the toast at `:206` and avoids "Google rejected". Add a caption under the row: "The author can change it and ask again."
- Add `pendingLabel="Approving…"` to Approve at `:346`.
- Keep no-confirm: the action is local and recoverable by asking again.
- **Benefit:** a clear consequence, and no collision with Google's "rejected".
- **Principle:** Nielsen #2 Match the real world; WCAG 2.4.6 Headings and Labels; WCAG 4.1.3 Status Messages (pending).

**C4 (F5). Keep focus on the post after an action.**

- **Change:** in `components/locations/posts/post-card.tsx:93-98`, give the `<h3>` `tabIndex={-1}` plus an `outline-none focus-visible:focus-halo`.
- In `posts-action-bar.tsx`, after Publish, Approve or Reject succeeds (`:174-177`, `:208-210`), focus `document.getElementById(\`post-${post.id}-title\`)`once the dialog closes. Use AlertDialog`finalFocus`if the primitive exposes it, or else`requestAnimationFrame`.
- For Delete, `PostsList` (`posts-tab.tsx:398-470`) passes an `onRemoved` callback. It moves focus to the next row's heading, or to the "Filter posts by status" group when the list empties.
- **Benefit:** keyboard and screen-reader users keep their place.
- **Principle:** WCAG 2.4.3 Focus Order and 2.4.11 Focus Not Obscured; HIG "preserve context".
- **Shared:** none. Check whether `components/ui/alert-dialog.tsx` forwards `finalFocus`; if it doesn't, use the rAF route and avoid a shared edit.

**C5 (F6). Show "waiting" as status, not a disabled decision.**

- **Change:** in `posts-action-bar.tsx:340-350` and `:303`, when `awaiting && decideReason` (no authority, and not paused or billing), render the caption "Waiting for an approver. Only someone who can publish this listing can approve it." in place of a disabled Approve.
- Keep the disabled Approve, with its reason, when the cause is pause or billing.
- **Benefit:** status reads as status.
- **Principle:** Nielsen #1 Visibility of system status; HIG clarity.
- **Tests:** a test expects a disabled Approve for `MEMBER` and `VIEWER` (§9). Update it to assert the caption and the absence of Approve.

**C6 (F7, F8). Retry and delete-error copy close to the action.**

- **Change:** when `post.status === "failed"`, the publish dialog title at `:474` becomes "Publish this post to Google again?". Add the line: "The last attempt didn’t go live, so sending it again won’t make a second post." That is true: a `failed` row is a settled non-live create, or an update that is safe to PATCH (`action-errors.ts:382-386`, `posts.ts:2094-2108`).
- In the delete dialog, add `onError` that keeps it open and renders `errorOutcome(remove.error)` as an inline `role="alert"` line above the footer, using `errorOutcome` (already imported, `:61`).
- **Benefit:** recovery is explained where the person is looking.
- **Principle:** Nielsen #9 Help users recognise and recover from errors; WCAG 3.3.1 Error Identification.
- **Not proposed (owner decisions):** Undo for Reject and for draft Delete (needs a server undo; RC-CONFIRM, D3-like). A reject reason field, and showing the rejecter (F4; needs schema).

## 9. Tests

**Existing assertions on copy these changes touch:**

`tests/components/posts-action-bar.test.tsx`:

- `:181` "Approve and publish this post?" is unchanged.
- `:193`, `:278`, `:291`, `:301`, `:318` use `menuItem(/^Reject/)`. **C3 breaks these:** change them to `/^Send back to draft/`.
- `:194` "Sent back to draft" toast stays.
- `:276`, `:286`, `:317` assert `button "Approve"` is disabled for paused, `MEMBER` and `VIEWER`. **C5 changes `:286` and `:317`.** Keep `:276`, which is the paused case.
- `:135-137` clicks "Retry publish" then "Publish to Google". Keep the button name in C6.

`tests/components/posts-tab.test.tsx`:

- `:524` expects the Approve button.
- `:532` uses `menuitem { name: "Reject" }`. **C3 breaks this.**

Elsewhere:

- `tests/components/post-composer-publish.test.tsx:317-349`: Retry publish in the composer, F05. Not touched.
- e2e: `tests/e2e/listings.spec.ts:511` (Review & publish wording, not posts). No e2e asserts the post dialog copy. Re-grep `tests/e2e/operations-features.spec.ts` for "Publish to Google" before merging.

**New focused tests** (vitest, in `posts-action-bar.test.tsx`):

1. The publish dialog mentions the second approver (C1). If C1's preferred variant ships: when `requireTwoPersonApproval` is set, the label is "Request approval" and no dialog appears.
2. With `canApprove:false`, there is no Approve button, the caption reads "Waiting for another approver", and the menu offers "Withdraw request" (C2).
3. Reject is labelled "Send back to draft", and the same `decidePostApproval(..., "reject", rev)` call still goes out (C3).
4. After a publish succeeds, `document.activeElement` is `#post-p1-title` (C4). In `posts-tab.test.tsx`, after a delete, focus lands on the next row's heading.
5. `MEMBER` on an awaiting post sees the caption and no Approve. When paused, Approve is still disabled with its reason (C5).
6. A failed post's dialog title reads "…again?". A delete error shows an inline alert, and the dialog stays open (C6).

Keep every intent and revision assertion (`:187`, `:195`, `:222-258`) unchanged. They guard §5.3–4.

## 10. Screenshots reachable in the visual fixture

The fixture is `tests/visual/fixture-server.ts` → `startJourneyBridge` (`tests/e2e/helpers/stub-bridge.ts`). The Google stub lists no Google posts (`:410-412`), so every post state is created through the UI in that session.

**Primary org (owner cookie, `/listings/{primaryLocationId}/posts`):**

- New post → draft row: Publish button and menu (Edit, Delete).
- Publish dialog with preview.
- The stub refuses publish (`results.md:414`), which gives the **failed** row: problem note, "Retry publish", and the delete dialog "Delete this post?".
- Viewer cookie (`viewerCookie`): disabled "Request approval" with "Your role can view this location but not change it." plus the banner.

**Approval org (`approval.requesterCookie` and `approval.approverCookie`, the approval-tenant location, `stub-bridge.ts:766-820`, `:961-972`). Two-person policy on; the requester is member `can_publish=true`:**

- Requester: draft → Publish → dialog (**F1 before**) → toast "Post submitted for approval." → "Awaiting approval" row with **Approve enabled** (**F2 before**). Tapping it gives the 403 toast.
- Approver (owner): the same row, the approve dialog with preview, the ⋯ menu with Reject, and the "Sent back to draft" toast.

**Not reachable without seeding:**

- ambiguous (Check Google), publishing, published with "View on Google" and "Delete from Google". These need a stub accept, or DB seeding under `uxp-p4-`.
- A pure non-publisher requester (C5). The fixture has `member` with `can_publish=false` only in the primary org's `seedUser` (`stub-bridge.ts:308-317`), with no approval policy there.
- Capture at 390 light, 390 dark and 1280, under `mkdir /tmp/naba-presence-visual.lock`.
