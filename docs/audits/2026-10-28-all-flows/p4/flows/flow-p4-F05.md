# p4-F05 · Write a post and publish it, or send it for approval, from the composer

Worktree `/tmp/naba-presence-p4` at `e4123d25`. Read-only mapping: no app, browser or test run. Paths below are repo-relative. `PCS` = `components/locations/posts/post-composer-sheet.tsx`.

## 1. Start and end

- **Start (new):** `/listings/[id]/posts` → "New post" (`PCS:638-641`). The page renders it in one of two places: the empty state's action when `counts.all === 0` (`components/locations/posts-tab.tsx:342-354`), otherwise the frame header (`posts-tab.tsx:288-296,322`).
- **Start (edit):** a draft or failed post's row → "More actions for …" → "Edit" (`components/locations/posts-action-bar.tsx:272,382-392`). This opens the same sheet through `openRef` (`posts-action-bar.tsx:430-439`). The row is owned by p4-F06.
- **End states:**
  - **Draft saved:** the sheet closes and the toast says "Draft saved. Google is not affected." or "Draft updated. Google is not affected." (`PCS:418-430`).
  - **Publish or approval answered:** the sheet closes and a `publishToast` is shown (`PCS:490-496`, `post-publish.ts:46-83`).
  - **Saved but not published:** the sheet closes, the error toast is shown, and the draft is in the list (`PCS:497-511`).
  - **Discarded:** "Close without saving?" (`PCS:622-628`).

## 2. Roles and gates

| Who (caps)                                          | Composer                                                                                                           | Footer primary                                          | Source                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| Owner/admin, or member with publish (`canPublish`)  | enabled                                                                                                            | "Publish to Google" ("Retry publish" for a failed post) | `post-publish.ts:34-37`, `PCS:515-519`                                    |
| Member who can edit but not publish (`!canPublish`) | enabled                                                                                                            | "Request approval"                                      | `post-publish.ts:34-36`                                                   |
| Viewer / billing read-only (`canEdit === false`)    | trigger and fields disabled                                                                                        | none drawn; reason in the body                          | `lib/locations/gating.ts:49-55`, `posts-tab.tsx:286,291`, `PCS:1131-1139` |
| Publishing paused (`!writesEnabled`)                | New post disabled: "Publishing to Google is currently unavailable, so new posts cannot be composed." Edit stays on | —                                                       | `gating.ts:113-117`, `posts-tab.tsx:271`, `posts-action-bar.tsx:383-385`  |
| No `caps` passed                                    | drafts only                                                                                                        | Save draft is the primary                               | `PCS:514,1225,1240`                                                       |

- **Server gates:**
  - Create and update need the `edit` action (`lib/server/posts.ts:1029`). They are not paused.
  - The publish route checks `PUBLISH_ENABLED` and `mfa: "step_up"` (`app/api/locations/[id]/posts/[postId]/publish/route.ts:18,22`). The MFA check runs before the handler (`lib/server/route.ts:445`).
  - `request_approval` or `decide_approval` is checked inside the publish decision (`posts.ts:1659-1664`).
  - The two-person policy parks a publisher's own publish: `requiresPostApproval` (`posts.ts:1362-1370,1761-1785`).

## 3. Baseline steps (taps, typing not counted)

| Task                                        | Taps  | Path                                                                                               |
| ------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------- |
| Update → publish                            | **2** | New post → type summary → Publish to Google → toast "Post live on Google" or "Post sent to Google" |
| Update with a library photo → publish       | 4     | New post → Add photo → tap a photo (closes the picker, `post-photo-picker.tsx:120-123`) → Publish  |
| Event → publish                             | ~7    | New post → Event → title → Starts date (2) → Ends date (2) → Publish                               |
| Request approval (non-publisher)            | 2     | New post → Request approval → "Post submitted for approval."                                       |
| Save draft                                  | 2     | New post → Save draft                                                                              |
| Edit draft → publish                        | 3     | ⋯ → Edit → (edit) → Publish to Google                                                              |
| Unchanged draft → publish from the composer | 3     | ⋯ → Edit → Publish (no re-save, `PCS:601-606`)                                                     |

On 15 Oct this took 4 to 5 taps and a change of screen (findings.md:441). It is now 2.

## 4. States

**Initial (new):**

- Title "New post" (`PCS:645`). Type control: Update / Event / Offer (`:97-101,661-678`).
- "Summary" counter "0 / 1,500" (`:976-987`). Textarea accessible name "Post summary" (`:996`).
- Photo row button "Add photo" (`:1053-1065`). Button select "No button" (`:1068-1100`).
- Preview: open by default; on narrow sheets a "Preview" disclosure (`:383,1146-1161`). Empty text "Your post text appears here." (`post-preview.tsx:97`). Caption "An illustration. Google decides the final layout." (`PCS:1188`).
- Footer:
  - Save reason "Write the post first." (`:528-533,1198`).
  - The consent line (see §5).
  - "Save draft keeps it here only. Google is not affected." (`:1218-1222`).
- Save and Publish are both disabled until something changes. Picking a type alone does not count as a change (`:145-154,1227,1243`).

**Initial (edit):**

- Title "Edit post". The button reads "Save changes" (`:1238`), but the footer still says "Save draft …" (`:1219-1221`).
- Save reason "No changes to save yet." (`:532`).
- Existing photos are shown as a read-only strip with "Kept as they are unless you choose another." or "Replaced by the photo you chose." (`:1001-1032`).
- A failed post's primary is "Retry publish", and its note reads "Save draft turns it back into a draft. Nothing reaches Google until you publish it." (`:517-518,1220`).

**Per-type fields:**

- **Event / Offer:**
  - Title field: "Event title" or "Offer title" (`:682-697`).
  - Starts and Ends rows, each with a date and an optional time (`:699-775`). Hint: "Optional for a draft. Times are the listing’s local time. Without a time, the post runs all day." (`:770-771`).
  - "Repeats" (`:103-108,777-921`). "Last repeat" is optional. Weekly shows "On" weekday chips; monthly shows "Each month". The hint is the recurrence text, or "Set the start date to see when it repeats." (`:916-917`).
- **Offer only:** "Voucher code" (max 100), "Redeem online link", "Terms" (`:923-968`).
- **Button:**
  - "Call now" adds the note "Call now uses the listing’s phone number on Google." (`:1101-1105`).
  - Any other action adds a "Button link" field (`:1108-1123`).

**Validation copy** (`validate`, `PCS:210-245`; shown after Save or Publish, which focuses the first `aria-invalid` field, `:404-410`):

| Rule                              | Message                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary > 1,500                   | "Google allows 1,500 characters. Remove {n}."                                                                                                                             |
| Event or offer with no title      | "Give the event a title." / "Give the offer a title."                                                                                                                     |
| Only one date set                 | "Choose both a start date and an end date."                                                                                                                               |
| End before start                  | "The end is before the start."                                                                                                                                            |
| Repeat without both dates         | "A repeating post needs its first start and end dates."                                                                                                                   |
| Series end before start           | "The last repeat is before the first one."                                                                                                                                |
| Bad redeem or button URL          | "Enter a full link, starting https://."                                                                                                                                   |
| Button with no URL                | "Add the link the button opens."                                                                                                                                          |
| Publish with no text and no photo | "Write something, or add a photo, before publishing." (`:570-576`)                                                                                                        |
| Schema fallback (inline)          | first zod issue, e.g. "Event details are required for event and offer posts." (`lib/contracts/location-posts.ts:132-141`), or "Please complete the post." (`PCS:583-587`) |

- The date and repeat errors are `role="alert"` paragraphs (`:757-764,903-910`). The other errors use `FieldError`.
- Publishing an event or offer does **not** require dates (`:568-591`). See F3.

**Photo picker** (`post-photo-picker.tsx`):

- Title "Choose a photo".
- Loading: "Loading your photos…" (`:81-84`).
- Error: "We couldn’t load your photos from Google." with "Try again" (`:85-93`).
- Empty: "No photos on Google yet" / "Add one and it appears here." (`:95-101`).
- "Show more photos" (`:152-161`). "Add a new photo" is disabled with the reason beside it (`:165-180`).
- The chosen photo appears as a FileCard: "Photo for this post", "Goes to Google with the post", "Remove the photo" (`PCS:1040-1051`).

**Saving / publishing:**

- Save shows the pending label "Saving…". Publish shows "Publishing…", or "Requesting…" for an approval request (`PCS:1235-1236,1246-1249`).
- While one is pending, the other button is disabled (`:1227,1243`).
- On publish, the composer saves first (create, or update with `post.updatedAt`) and then publishes with `expectedRevision` and an intent id (`:439-475`).

**Errors and retry:**

- **Save failed:** the error appears inline as `role="alert"` (`:1126-1130`) **and** as an error toast (`lib/queries/use-resource-mutation.ts:190-194`). The sheet stays open and the edits are kept.
- **Save 409 `post_changed`:** the server says "Someone else changed this post after you opened it. Reload it before saving." (`posts.ts:1067`). There is no client mapping, so the 409 fallback is shown: "This changed since you loaded it. Refresh and try again." (`lib/errors/action-errors.ts:572`). Nothing is refetched, so the "Someone else saved this post while you were editing" notice (`components/editors/draft-notices.tsx:56-80`) waits for the next list refetch.
- **Publish failed after the save** (`savedBeforeFailure`):
  - The sheet closes and the toast reads `{reason} The post is kept in NabaPresence, not lost.` (`PCS:481-489,497-511`).
  - No suffix is added when the answer was lost or unconfirmed (`isUnconfirmedFailure`, `action-errors.ts:798-801`).
- **Publish 409 refusals:**

  | Code                       | Copy                                                                                                                                                                        |
  | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `post_changed_since_saved` | "This post changed after it was saved or opened, so nothing was sent to Google. Check the current version in the list, then publish it again." (`action-errors.ts:231-232`) |
  | `post_publish_in_progress` | "This post is already being published. Wait a moment and try again." (`:376-377`)                                                                                           |
  | `post_publish_uncertain`   | "Google has not confirmed whether this post went live. Refresh the posts list before changing it." (`:388-389`)                                                             |

- **Publish 403 `mfa_step_up_required`** (owner or admin without a code from the last 15 minutes):
  - The post is created, then the publish is refused before the handler runs. The "Confirm it’s you" dialog opens (`lib/api/client.ts:254-282`, `components/auth/mfa-step-up-prompt.tsx:218-222`).
  - The toast falls back to **"You do not have permission to do that. The post is kept in NabaPresence, not lost."** (`action-errors.ts:570`, with no `mfa_*` entry). The sheet closes. See F1.
- **Network error:** "We couldn’t reach NabaPresence. Check your connection and try again." (`action-errors.ts:579-580`).

**Success** (`post-publish.ts:46-70`):

- "Post live on Google"
- "Post sent to Google" with "Google is still reviewing it, so it may not show yet."
- "Google rejected this post."
- "Post submitted for approval." (local toast)
- Google results are never offered Undo (`:72-83`).
- An edit to a post that is already live returns from the save itself (`PCS:457-459`, `app/api/locations/[id]/posts/[postId]/route.ts:41-55`).

## 5. Protected rules (do not change)

- **D4 consent:**
  - The consent line `data-slot="publish-consent"` is drawn by the same `gate` condition as the button and is the button's `aria-describedby` (`PCS:1199-1217,1240-1254`).
  - Consent copy: "{Publish to Google|Retry publish} sends this {update|event|offer}[, with its photo,] to your Google listing now. Customers see it as soon as Google accepts it."
  - Approval copy: "Request approval saves this post and asks an approver. Nothing reaches Google until they approve it." (`:1207-1215`).
- **Bound to the saved revision:** `expectedRevision` comes from the save's own `contentRevision` (`PCS:448-472`). The server refuses with 409 `post_changed_since_saved` (`posts.ts:1733-1741`). PATCH republishes a live post at `post.contentRevision` (`[postId]/route.ts:53`).
- **Stale edit:** PATCH carries `expectedUpdatedAt` (`lib/api/location-posts.ts:52-57`, `posts.ts:1064-1068`).
- **Idempotency:**
  - `intentKey: [post?.id ?? "new", input]`. An edit never reuses an earlier attempt's intent (`PCS:476-478`).
  - The intent is resent only after an unconfirmed failure (`use-resource-mutation.ts:134-143,183-188`).
- **Never claim a publish before the server answers:** the toast is shown only after `publishPost` resolves (`PCS:490-496`), and the outcome is mapped from `operation.outcome` (`post-publish.ts:53-69`).
- **Approval policy:** `postPublishGate` must not use `resourceDisabledReason` for requesters (`post-publish.ts:13-18`). The server decides parked versus published (`posts.ts:1761-1785`). Two-person approvals of one's own post are refused (`posts.ts:1689-1696`).
- **Role gates:** `contentEditDisabledReason`, `composeDisabledReason`, `resourceDisabledReason(caps,"media")` for adding a photo (`PCS:522`), and route `mfa: "step_up"` on publish.
- **Google pause:** publish and PATCH of a live post return 503 `publishing_paused` (`publish/route.ts:22-24`, `[postId]/route.ts:42-44`).

## 6. Audit status (15 Oct)

| ID                                                     | Status in the 15 Oct audit | Status now                                                                                                                                                                                                                                                                                                                               | Evidence                                                                         |
| ------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| LST-11                                                 | fixed                      | **Fixed.** Publish from the footer with the consent line; no separate confirm.                                                                                                                                                                                                                                                           | `PCS:1195-1255`. Test: `tests/components/post-composer-publish.test.tsx:121-152` |
| LST-12                                                 | fixed                      | **Fixed.** Photo row, picker and FileCard; consent says ", with its photo,".                                                                                                                                                                                                                                                             | `PCS:1034-1067,1257-1266`. Test: `:168-190`                                      |
| LST-25                                                 | fixed                      | **Mostly fixed.** The draft note is said once; inputs are the default `Input`/`Textarea`. The footer still stacks up to three notes (save reason, consent, draft note). The "Preview" name is still announced up to three times by screen readers: button `:1153`, `aside aria-label` `:1164`, sr-only figcaption `post-preview.tsx:61`. | —                                                                                |
| L10 note: lost save → second draft                     | carried                    | **Remaining.** `createPost` has no intent; a lost 201 followed by Publish again creates a second draft. Acknowledged at `PCS:433-437`. Fixing it needs server dedupe in `createLocalPostDraft` (server lane, out of scope).                                                                                                              | —                                                                                |
| L10 note: false-positive 409 after a reconcile         | carried                    | **Remaining, accepted.** The copy tells the person to check the list and publish again.                                                                                                                                                                                                                                                  | `posts.ts:1727-1741`                                                             |
| L10 note: no test that PATCH passes `expectedRevision` | carried                    | **Remaining.** A grep of `tests/` finds the publish and approval routes bound to the revision (`tests/integration/routes/post-two-person.test.ts:340,355`, `tests/server/post-publish-revision-bind.test.ts`), but no PATCH republish test asserting `expectedRevision`.                                                                 | —                                                                                |

## 7. Friction

| #   | P                                                                                                                 | Issue                                                                                                                                                                                                                                                                                                                                                                                                                       | Evidence                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| F1  | P1 (Hypothesis: stale step-up is common for owners)                                                               | When the MFA step-up fires on publish from the composer, the toast says "You do not have permission to do that. The post is kept in NabaPresence, not lost." That is wrong: an owner does have permission. The sheet closes while "Confirm it’s you" opens, and the person must find the new draft in the list and publish it again, through the list's confirm dialog.                                                     | `action-errors.ts:570` (no `mfa_step_up_required` entry), `PCS:481-489,497-511`, `route.ts:445` |
| F2  | P2                                                                                                                | A save 409 (`post_changed`) shows the generic "This changed since you loaded it. Refresh and try again." It does not say who changed what, and "Refresh" risks the edits. The composer has a better tool, the Load theirs / Keep mine notice, but does not trigger it, because there is no invalidate on error.                                                                                                             | `posts.ts:1067`, `PCS:412-431,497-500`, `draft-notices.tsx:56-80`                               |
| F3  | P2 (Hypothesis: Google requires `event.schedule` for EVENT/OFFER; check Google's LocalPost reference or the stub) | An event or offer with no dates passes client validation for publish. The save succeeds, then Google refuses, so the sheet closes with an error toast and the person reopens the post via ⋯ → Edit. The hint only says "Optional for a draft".                                                                                                                                                                              | `PCS:210-231,568-591,770`                                                                       |
| F4  | P2                                                                                                                | The button is "Save changes" when editing, but the footer says "Save draft keeps it here only…" or "Save draft turns it back into a draft…". The name does not match the control.                                                                                                                                                                                                                                           | `PCS:1218-1222` vs `:1238`                                                                      |
| F5  | P2 (needs owner)                                                                                                  | Under the two-person policy a publisher sees "Publish to Google" and the consent "…to your Google listing now", but the server parks the post for approval (the toast "Post submitted for approval." is truthful). The consent overstates. `caps` has no reliable posts-policy signal: `listingChangeApprovals` is for listing writes, and its equivalence to the posts policy is unproven. This is protected consent copy. | `post-publish.ts:34`, `posts.ts:1362-1370`, `lib/contracts/location-capabilities.ts:81-89`      |
| F6  | P3                                                                                                                | A server error appears twice, inline as `role="alert"` and as a toast. Inline, it sits at the end of the fields (`PCS:1126`), far from the footer button on a phone.                                                                                                                                                                                                                                                        | `PCS:1126-1130`, `use-resource-mutation.ts:194`                                                 |
| F7  | P3                                                                                                                | A disabled Publish on an untouched new post has no reason linked to it. "Write the post first." is described only for Save (`:1228-1234`); Publish's `aria-describedby` is the consent alone.                                                                                                                                                                                                                               | `PCS:1243-1245`                                                                                 |
| F8  | P3                                                                                                                | "Preview" is announced up to three times (LST-25 remainder).                                                                                                                                                                                                                                                                                                                                                                | §6                                                                                              |
| F9  | P3 (Hypothesis)                                                                                                   | On 320–390 px the sticky footer holds up to three caption lines plus two buttons. This needs a screenshot measurement. The consent line must stay.                                                                                                                                                                                                                                                                          | `PCS:1195-1223`, `components/ui/sheet.tsx:448-455`                                              |
| F10 | P3 (owner decision)                                                                                               | While publishing is paused, New post is off ("…so new posts cannot be composed."). But creating a draft is not paused on the server, and editing drafts stays on.                                                                                                                                                                                                                                                           | `gating.ts:113-117` (shared), `posts.ts:1029`                                                   |
| F11 | P3                                                                                                                | A saved post's existing photos cannot be removed, only replaced.                                                                                                                                                                                                                                                                                                                                                            | `PCS:189-196,256-258,1026-1030`                                                                 |

## 8. Proposed changes (all in this flow's own files unless flagged)

1. **Step-up copy on composer publish (F1).**
   - **Problem:** an owner is told "You do not have permission".
   - **Change:** in the `publish` mutation's `errorToast` (`PCS:481-489`), check `isMfaStepUpError(error)` first (import from `@/lib/api/client`). When true, return "Publishing needs you to confirm it’s you first, so nothing was sent to Google. The post is saved as a draft: publish it from the list once you’ve confirmed." when `savedBeforeFailure.current`, else "Confirm it’s you, then publish again. Nothing was sent to Google."
   - **Benefit:** the error is true, and it says what to do next.
   - **Principle:** Nielsen #9 (help users recognise and recover from errors); WCAG 2.2 SC 3.3.3 (Error Suggestion).
   - **Protected rules:** the copy is truthful because the MFA gate runs before the handler (`route.ts:445`). No gate changes.
   - **Shared:** none (`lib/api/client.ts` is only imported).
2. **Save 409 says what happened and offers the choice (F2).**
   - **Change:** in the `create` mutation (`PCS:412-431`), add `errorToast: (e) => e instanceof ApiClientError && e.code === "post_changed" ? "Someone else saved this post while you were editing. Your edits are still here: choose whose version to keep, then save again." : describeActionError(e, { context: "post" })`.
   - In `onError`, on that code, `void queryClient.invalidateQueries({ queryKey: queryKeys.locationPosts(locationId) })`. The refetched post then raises the DraftNotices "incoming" alert.
   - Apply the same to the `publish` mutation's `!savedBeforeFailure` branch (`:498-500`).
   - **Benefit:** no blind refresh, and the person keeps their edits.
   - **Principle:** Nielsen #1 (visibility of system status) and #9; WCAG 3.3.3.
   - **Protected rules:** `expectedUpdatedAt` is unchanged.
   - **Shared:** none. A global alternative is a `post_changed` entry in `lib/errors/action-errors.ts` COPY; that file is shared, so flag it if chosen.
3. **Require dates before publishing an event or offer (F3; verify the hypothesis first).**
   - **Change:** in `parsedInput(needsText)` (`PCS:568-577`), add `if (needsText && values.topicType !== "STANDARD" && (!values.startDate || !values.endDate)) found.dates ??= "Choose a start and end date before publishing."`.
   - Change the hint at `:770` to "Needed to publish, optional for a draft. Times are the listing’s local time. Without a time, the post runs all day."
   - **Benefit:** the error is caught before the save-then-fail round trip.
   - **Principle:** Nielsen #5 (error prevention); WCAG 3.3.1 (Error Identification) and 3.3.2 (Labels or Instructions).
   - **Protected rules:** client-side only; the server's behaviour is unchanged.
   - **Shared:** none.
4. **Name the real button in the footer note (F4).**
   - **Change:** at `PCS:1218-1222`, use `const saveLabel = editing ? "Save changes" : "Save draft"` and render `` `${saveLabel} turns it back into a draft. Nothing reaches Google until you publish it.` `` or `` `${saveLabel} keeps it here only. Google is not affected.` ``. Reuse `saveLabel` at `:1238`.
   - **Principle:** Nielsen #4 (consistency and standards); WCAG 3.2.4 (Consistent Identification).
   - **Shared:** none.
5. **Put the error and the reason beside the action (F6, F7).**
   - **Change:** move the `serverError` alert from `PCS:1126-1130` into the footer status column at the top of `:1197`, with the same `role="alert"`.
   - Give Publish `aria-describedby={[consentId, !post && !isDirty ? saveReasonId : null].filter(Boolean).join(" ")}`. The consent stays first and stays linked.
   - **Benefit:** the error shows next to the button that was pressed, on a phone too.
   - **Principle:** WCAG 3.3.1, 1.3.1 (Info and Relationships) and 4.1.2 (Name, Role, Value); Nielsen #1.
   - **Shared:** none. Check F9 in screenshots after the move.
6. **One "Preview" name (F8).**
   - **Change:** at `PCS:1162-1169`, replace `<aside aria-label="Preview">` with a plain `<div>`, so the toggle (`:1146-1161`) and the figure caption carry the name. Leave `post-preview.tsx` unchanged: the publish confirm in F06 uses it too.
   - **Principle:** WCAG 1.3.1; Nielsen #8 (aesthetic and minimalist design).
   - **Shared:** none.

**Not proposed (record only):**

- F5 needs an owner decision and a capability signal, and it would change consent copy.
- F10 changes the pause semantics in shared `lib/locations/gating.ts` and needs an owner decision.
- The second draft after a lost save needs a server idempotency change.
- F11 changes the meaning of `media`.

## 9. Tests

**Existing assertions on copy or attributes these changes touch:**

- `tests/components/posts-tab.test.tsx:309-310`: Save `toHaveAccessibleDescription("Write the post first.")`. Unaffected; change 5 only adds the reason to Publish.
- `posts-tab.test.tsx:315`: `/Save draft keeps it here only/` on a new post. Unaffected, because a new post's label stays "Save draft". `:381` and `tests/components/posts-action-bar.test.tsx:150-154` use the "Save changes" and "Edit post" names, which are unchanged.
- `tests/components/post-composer-publish.test.tsx`:
  - `:154-166` asserts Publish `toHaveAccessibleDescription(consent.textContent)` exactly. **Change 5 breaks this for an untouched new post only;** the test types first, so it should still pass. Re-run it.
  - `:227-243` asserts `/kept in NabaPresence, not lost/` for a 422. Unaffected.
  - `:245-262` asserts the `post_changed_since_saved` copy. Unaffected.
  - `:352-365` asserts the paused reason on Publish. Keep it.
  - `:367-377` asserts that an empty publish is disabled.
- `tests/components/use-resource-mutation.test.tsx:150-155` and `tests/components/friction-primitives.test.tsx:145` assert "You do not have permission to do that.". These are unaffected, because change 1 is local.
- No test asserts "Optional for a draft" or the 409 fallback in the posts context. `tests/components/hours-tab.test.tsx:483` and `tests/components/onboarding-match-link.test.tsx` assert the fallback for other surfaces; they are only touched if the shared COPY route is chosen.

**Focused new tests** (in `post-composer-publish.test.tsx`):

1. `publishPost` rejects `ApiClientError(403,"mfa_step_up_required")` after `createPost` resolves. Expect `/confirm it’s you/i` and `/saved as a draft/`, and no "permission" text.
2. Editing: `updatePost` rejects `ApiClientError(409,"post_changed")`. Expect the new copy. Expect the sheet to stay open with the typed text, and `invalidateQueries` to be called with `locationPosts`.
3. Event with a title and no dates → Publish. Expect "Choose a start and end date before publishing.", the date input `aria-invalid`, and `createPost` not called. Save draft still succeeds.
4. Edit a failed post: the footer reads "Save changes turns it back into a draft…".
5. Server error after Save: the alert sits inside the footer (`closest('[data-slot="sheet-footer"]')`; the slot is set at `components/ui/sheet.tsx:452`).
6. Only one element is named "Preview" besides the toggle (`getAllByRole("complementary")` has length 0).
7. Optional server-lane test for the L10 note: PATCH of a published post passes `expectedRevision === post.contentRevision` to `requestOrPublishLocalPost`, in `tests/integration/routes/local-posts.test.ts`.

**Checks to run after the change:** `pnpm exec vitest run tests/components/post-composer-publish.test.tsx tests/components/posts-tab.test.tsx tests/components/posts-action-bar.test.tsx`, plus the repo's typecheck and lint scripts.

## 10. Screenshot states in the visual fixture

**Setup and limits:**

- The fixture's Google stub answers `GET /localPosts` with `[]` and `GET /media` with `[]` (`tests/e2e/helpers/stub-bridge.ts:402-413`). It has no `POST /localPosts` handler, so **never press Publish**.
- `visual-app` sets `GBP_POSTS_ENABLED=true`, and `PUBLISH_ENABLED` defaults to true (`lib/server/env.ts:315`), so the gate is on.
- `tests/visual/shoot.mjs` captures a route but cannot click. The states below need a small Playwright step (or an `nm-capture.mjs` state) on `/listings/{loc}/posts`, with `--role owner`, widths 320, 390, 768 and 1280.
- Take the machine lock first (`mkdir /tmp/naba-presence-visual.lock`).

**How to open the composer:** the list is empty, so the page shows "No posts yet" with a "New post" button inside the empty state. Click `getByRole("button",{name:"New post"})` and wait for `getByRole("dialog",{name:"New post"})`.

**States:**

| #   | State                    | Steps                                                                                                                                                                                                            |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Untouched composer       | Footer shows "Write the post first.", the consent line and the draft note; Save and Publish disabled; preview open, or the "Preview" toggle at narrow widths                                                     |
| S2  | Typed update             | Summary typed; consent line and Publish enabled; preview filled                                                                                                                                                  |
| S3  | Event fields             | Type → Event; Starts and Ends rows; Repeats → Every week (weekday chips)                                                                                                                                         |
| S4  | Offer fields             | Voucher code, Redeem online link, Terms                                                                                                                                                                          |
| S5  | Validation               | Event with no title, Button = a link type with no URL, end date before start → Save draft. Shows "Give the event a title.", "Add the link the button opens.", "The end is before the start."; focus on the title |
| S6  | Counter over the limit   | Paste 1,501 characters: "Google allows 1,500 characters. Remove 1."                                                                                                                                              |
| S7  | Photo picker empty state | Add photo → "Choose a photo" with "No photos on Google yet". Do not press "Add a new photo", which writes to Google                                                                                              |
| S8  | Discard prompt           | Type, then press Escape → "Close without saving?"                                                                                                                                                                |
| S9  | Edit composer            | Save draft is a local fixture-DB write only. Then the row's ⋯ → Edit shows "Edit post", "No changes to save yet.", "Save changes" (and F4's mismatched footer note in the BEFORE capture)                        |
| S10 | Request approval         | `--role requester` on `{loc2}`: "Request approval" and its consent. Viewer at `{loc}`: banner "You can look, but not change these posts" and New post disabled                                                   |

Not reachable in the fixture without new stubs: success toasts, the 409s, step-up, Google rejected, and the photo FileCard (no media items).
