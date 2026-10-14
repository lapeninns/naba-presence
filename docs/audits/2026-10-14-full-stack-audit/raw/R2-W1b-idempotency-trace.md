# R2-W1b: idempotency trace for F6, F7 and intent forwarding

Round-2 follow-up to `raw/W1-mutations-queries.md` F6 and F7. This was a read-only trace: no code was run and nothing was written to the DB. Line numbers are for the working tree on 2026-10-14 (branch `feat/inbox-mail-refinement`).

---

## 1. F7: does a second bulk template or approval batch publish twice to Google?

**Verdict: in practice, no duplicate external write is possible.** The one theoretical exception is a body that differs between the two drafts, covered under Q4. Even then, Google's reply endpoint is a `PUT` upsert of the single reply per review (`lib/domain/google-contract.ts:699-702`). So the worst external effect is overwriting the reply with the same or near-same text, never a second public reply.

**Status: CONFIRMED** for the guard chain below. The residual local-state drift is **PLAUSIBLE**.

### The guard chain, per review, across batches

1. **No guard at batch creation.** `insertBatch` always inserts (`lib/server/bulk-reviews.ts:115-135`). The only uniqueness is `unique (operation_id, review_id)`, which is per batch (`supabase/migrations/0130_bulk_review_families.sql:79`). `0131` adds only a plain index (`0131_bulk_review_claim_receipts.sql:14-16`). Two batches over the same review are allowed (W1 F7 stands).
2. **Planning skip when the second batch starts late.** If batch A's child has already drafted, batch B's planning sees `hasDraft` and the row is skipped (`bulk-reviews.ts:300,324`).
3. **Dispatch-time state check.** The template child derives its draft id from its own child id (`lib/server/bulk-families/reviews.ts:44-45,349`). When the child has no draft of its own yet, it refuses if any other draft or a live reply exists (`reviews.ts:366-368,383-386`), returning `template_review_busy` or `template_has_reply`. Once A's child has written its draft, B's child is a 409 conflict with no external write. This check reads without a lock, so it does not stop two children running concurrently.
4. **Content-derived publish key, the backstop that does stop concurrency.**
   - The key is `sha256(org:review:publish_generation:bodyHash)` (`lib/server/publishing/intent.ts:214-224, 437-443`).
   - The template body is deterministic for the same rating, language and reviewer name (`lib/domain/rating-only.ts:64-86`). `publish_generation` changes only on a confirmed delete (`lib/server/publishing/settle.ts:58-71`). So two template drafts for one review produce the **same key**.
   - `publish_attempt` has `unique (organisation_id, idempotency_key)` (`supabase/migrations/0001_initial.sql:283`). `insertAttempt` uses `on conflict ... do nothing` (`lib/server/publishing/attempt.ts:242`).
   - The loser re-reads the winner (`intent.ts:452-470`):
     - If the winner is `succeeded`, its outcome is replayed (`intent.ts:233-260`).
     - If the winner is `started` or `ambiguous`, recovery runs. Within the 2-minute in-flight grace it answers `publish_in_progress` (`publishing/recover.ts:52,243-245`), which the child treats as deferred or ambiguous (`reviews.ts:107-123`).
   - Recovery reads Google back before sending anything.
5. **The race is reachable, but the key absorbs it.** `claim_due_bulk_children` allows up to 2 concurrent children per org (`0131:22`). A double-submitted one-review batch therefore queues two children with `next_attempt_at = now()`, and both can be claimed in the same tick. Both pass check 3, both call `createReviewDraft`, which has no lock and no one-draft-per-review constraint (`draft_review_idx` is a plain index, `0001_initial.sql:397`). Both reach `executePublish`, and the key in check 4 makes exactly one Google `PUT`.
6. **Approval batches.**
   - `recordApprovalDecision` requires `awaiting_approval` (`lib/server/review-approval.ts:82`). An approve does not move the workflow on the bulk path (`review-approval.ts:211-215`), so batch B's start succeeds again. It writes a **second `approval_decision` row and a second `review.approval.approved` audit row**.
   - Both children then publish the same `draftId`, so the body and key are the same as in check 4: one Google write. B's child replays A's attempt as `succeeded` (`reviews.ts:284-312`, `publishDraft`).

### Residual effects (local only)

| ID   | Effect                                                                                                                                                                                                                                                                                   | Status                  | Priority |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------- |
| F7-a | **Duplicate approval rows and audit.** A double-started bulk approve records two decisions and two audit rows for one approval.                                                                                                                                                          | CONFIRMED by trace      | P3       |
| F7-b | **Workflow drift after a late concurrent draft** (explained below).                                                                                                                                                                                                                      | PLAUSIBLE               | P3       |
| F7-c | **Wasted AI verification spend.** Each concurrent template child runs its own semantic verification (`review-drafts.ts:383-400`).                                                                                                                                                        | CONFIRMED               | P3       |
| F7-d | **Different body, second `PUT` overwrite.** Two concurrent drafts could differ if `organisation.default_language_code` (or detected language) changed between their two phase-ones. Any review change is blocked by the `update_time` gates (`reviews.ts:376-380`, `intent.ts:186-191`). | HYPOTHESIS, very narrow | P3       |

**How F7-b happens:**

1. B's `createReviewDraft` phase one passes before A drafts.
2. A drafts, verifies and publishes during B's verification call.
3. B's phase three passes `assertDraftable`, because `published → drafted` is allowed (`lib/domain/workflow.ts:20`; `review-drafts.ts:111-125,416`). B then sets the review to `drafted` and then `verified` (`review-drafts.ts:474-500`).
4. B's publish replays A's attempt through `resolveExistingPublishAttempt`. That replay never restores `published` (`publish.ts:150-153` returns early; `settle` runs only on a fresh write).
5. Result: the review shows as `verified`, with a second draft, while its reply is live. The inbox would offer to publish again. A second publish would replay through the same key, so there is still no Google write.

**Minimal fix (P2 overall, because the fix is cheap and also closes F7-a, F7-b and F7-c):** refuse at plan time any review that already has a live child in another batch. In `startBulkTemplateReplies` and `startBulkReviewApprovals`, add to the review read:

```sql
exists (select 1 from bulk_listing_child c
        where c.review_id = r.id and c.status in ('queued','running','ambiguous'))
```

and skip the row with `review_busy`. Optionally back this with a partial unique index on `bulk_listing_child (review_id) where status in ('queued','running')`. Also forward an `Idempotency-Key` from `queueBatch`, recorded on `bulk_listing_operation` with `unique (organisation_id, intent_id)`, so that a retry after a lost response returns the first batch's id rather than a "skipped" list. For F7-b alone, re-check `hasReply` in `createReviewDraft`'s settle transaction when `templateOnly`.

---

## 2. F6: post approve and post delete on a network retry or double press

Client: `decidePostApproval` and `deletePost` take no `MutationOptions` (`lib/api/location-posts.ts:71-90`). The call sites drop the intent (`components/locations/posts-action-bar.tsx:192-196, 208-209`), so `apiFetch` mints a fresh `Idempotency-Key` per call (`lib/api/client.ts:307-310`). `useResourceMutation` disables the button while pending, so a true double press is unlikely. The realistic case is a **Retry after `network_error`** while the first request has either already committed or is still in flight on the server.

### Delete (`lib/server/posts.ts:1926-2047`)

| Scenario                                       | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Status             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| First request already succeeded, then Retry    | `loadPost` filters `status <> 'deleted'` (`posts.ts:630`) and throws **404 `post_not_found`** (`:635`) before `runGbpWrite`. The user sees an error for a delete that worked. No Google call, no audit.                                                                                                                                                                                                                                                                                                                                   | CONFIRMED          |
| First still in flight, then Retry (concurrent) | Both load the post. Keys differ, because `requestScopedKeyPart` falls back to the per-call request id (`posts.ts:1968-1972`; `mutation-operations.ts:131-134`). There is no per-target in-flight guard: the `mutation_operation` uniqueness is only `(organisation_id, intent_id)` (`0086:78`). **Two Google `DELETE`s** are sent. The second gets a 404, which is swallowed as success (`posts.ts:2001-2003`). Result: **two attempt rows, two `mutation_operation` receipts, two `post.deleted` audit rows**. The post is deleted once. | CONFIRMED by trace |
| Draft-only post (no Google name)               | A plain update to `deleted` (`posts.ts:1936-1944`). A retry after success returns 404 `post_not_found`.                                                                                                                                                                                                                                                                                                                                                                                                                                   | CONFIRMED          |

**Important: forwarding the intent fixes only the concurrent row.** The intent replay lives inside `runGbpWrite` (`gbp-write.ts:962-985`), and nothing checks the receipt at the route level (`loadMutationReceipt` is only used by `GET /api/mutations/{id}`). So "retry after success" still returns 404, because `loadPost` runs first.

### Approve (`app/api/locations/[id]/posts/[postId]/approval/route.ts`, `posts.ts:1340-1500`)

| Scenario                            | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| First already succeeded, then Retry | `requirePendingDecision` sees `published`, so **409 `approval_not_pending`** (`posts.ts:1290-1297`) after a successful approve-and-publish. This is an error toast for a success.                                                                                                                                                                                                                                                                                                 | CONFIRMED          |
| Concurrent                          | The row is locked (`loadPost(..., {lock:true})`, `posts.ts:1372`), but the deciding transaction does not change `status`. So the second request also passes and writes a **second `post_approval_decision` and a second `post.approval.approved` audit row** (`posts.ts:1403-1416`). Both publishes share the content-derived key (`posts.ts:1696-1702`) with `onExisting: "resume"`. Google gets one create or patch. The loser gets `POST_PUBLISH_IN_PROGRESS` 409 or a replay. | CONFIRMED by trace |

The server never uses the intent for approve: the key is content-derived and the receipt intent is ambient. So forwarding the intent here only ties the receipt to the user's action. It does not stop the duplicate decision row.

**Verdict for F6:** no duplicate external effect (Google's `DELETE` is naturally idempotent here, and approve is content-keyed). The harm is **misleading errors on retry-after-success (404 or 409)** plus **duplicate audit, decision, attempt and receipt rows** on concurrency.

**Priority: P2** (an operator-facing false error on a destructive action; audit noise).

**Minimal fix:**

1. Add `options: MutationOptions` to `decidePostApproval` and `deletePost`, and pass `{ intentId: intent.intentId }` from `posts-action-bar.tsx`, as `publishPost` already does (`:178-183`).
2. In `deleteLocalPost`, before `loadPost`, check for a receipt or attempt under the current intent and replay it. Simpler alternative: treat an already-`deleted` row as `{status:"deleted"}`, returning 200 so DELETE is idempotent.
3. In approve, return the settled publish outcome when the post is already `published` at the `expectedRevision`, the latest decision is this user's `approved` for that revision, and it was made within N minutes. Alternatively, have the client treat `approval_not_pending` plus a refetch showing `published` as success.
4. Optionally move the post to a transitional status inside the decide transaction, so a concurrent second approve sees `approval_not_pending` instead of writing a duplicate decision.

---

## 3. Other client mutations against intent-aware endpoints

Server consumers of the intent:

- `runGbpWrite` with an `operation` descriptor: hours, profile, food menus, post publish and delete, and media (`grep "operation: {" lib/server`).
- `listing-changes.ts:385` (`currentIntentId`).
- `review-drafts.ts:259` (draft generation key).
- `media.ts:661-664`.

Business info, attributes and industry dedupe on `changeSetId` instead (`business-information.ts:201-209`), so the intent is not needed there.

| Client call (file:line)                                                                       | Endpoint                                | Server uses intent?                                                          | Forwarded?                                                                                                   |
| --------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `posts-action-bar.tsx:192` `decidePostApproval`                                               | `POST .../posts/{id}/approval`          | Receipt only (key is content-derived)                                        | **No** (F6)                                                                                                  |
| `posts-action-bar.tsx:208` `deletePost`                                                       | `DELETE .../posts/{id}`                 | **Yes, the attempt key**                                                     | **No** (F6)                                                                                                  |
| `template-reply-dialog.tsx:155` `generateOrSaveDraft(row.id, {})` (non-engine template path)  | `POST /api/reviews/{id}/drafts`         | Yes, the generation key                                                      | **No.** A retry makes a second draft. The template uses no credit; the verification call is billed again. P3 |
| `template-reply-dialog.tsx` `queueBatch` → `runBulkReviewAction` (`lib/api/review-bulk.ts`)   | `POST /api/reviews/bulk`                | **No.** The route ignores the intent (`app/api/reviews/bulk/route.ts:89-99`) | No: needs server support first (F7)                                                                          |
| `use-draft-mutations.ts:61` `verifyDraft`                                                     | `POST /api/drafts/{id}/verify`          | **No.** Keyed `${requestId}:verification` (`verify/route.ts:109`)            | No: a server-side gap                                                                                        |
| `saved-listing-reviews.tsx:39`, `use-service-review.ts:67` `publishBusinessInformation`       | `.../business-information`              | No (deduped on `changeSetId`)                                                | No, harmless                                                                                                 |
| `saved-attribute-reviews.tsx:35` `publishBusinessAttributes`                                  | `.../business-information` (attributes) | No (`changeSetId`)                                                           | No, harmless                                                                                                 |
| `use-lodging-review.ts:73` `publishIndustry`                                                  | `.../industry`                          | No (`changeSetId`)                                                           | No, harmless                                                                                                 |
| `createPlaceAction`, `updatePlaceAction`, `deletePlaceAction` (`lib/api/location-booking.ts`) | `.../place-actions`                     | No receipt                                                                   | No callers (dead wrappers)                                                                                   |

These call sites do forward the intent: hours publish (`hours-tab.tsx:308`, `review-publish.tsx:244`), profile (`profile-editor.tsx:468`, `review-publish.tsx:176`), menus (`menu-tab.tsx:166`, `review-publish.tsx:288`), post publish, media add, update and delete, listing-change decisions (`listing-change-requests.tsx:52`), `profile-editor.tsx:486,508`, and the draft hook (`use-draft-mutations.ts:34`).

**Systemic fix (P3):** make `MutationOptions` a required parameter on every `lib/api` mutation wrapper whose route is intent-aware. A wrapper that forgets it then fails typecheck. Also add a test for each intent-aware route that a retry under the same key performs no second provider call.
