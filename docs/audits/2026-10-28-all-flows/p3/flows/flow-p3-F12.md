# p3-F12 — Add, change or remove a booking link

Code read at `/tmp/naba-presence-p3` (`ux/flows-presence-p3`, head `e4123d25`). Read-only analysis.

## 1. Flow

- **ID / name:** p3-F12, add, change or remove a booking link ("Reserve a table", "Order online" and similar buttons on the Google listing).
- **Goal:** prepare one exact booking-link change, get it approved, send it to Google, and read back a confirmed outcome.
- **Start:** `/listings/[id]/booking`. `app/(dashboard)/listings/[id]/booking/page.tsx:22-35` streams `<AreaEditor area="booking">` → `BookingTab` (`components/locations/booking-tab.tsx:101`).
- **End:** the approval sheet shows `OutcomeSummary` with "Accepted by Google" / "Independently confirmed" (`place-action-approval-sheet.tsx:249-256`). A confirmed outcome invalidates the booking query, so the list re-reads Google (`use-place-action-review.ts:32`). The request stays listed under "Saved booking link work" (`saved-place-action-work.tsx:87-205`).
- **Roles:** only **owner and admin** with publish rights on the listing can prepare, approve or send. The server checks this at `lib/server/place-action-review-state.ts:19`, and the client gates at `booking-tab.tsx:186-197` and `saved-place-action-work.tsx:69-70,208-211`. A second approver is needed when `requiresSecondApprover` is set (`place-action-approval-sheet.tsx:221-227`). **Member and viewer** can read the links. They see a disabled add form (`tests/components/booking-tab.test.tsx:118`).

## 2. Code map

| Piece                      | Where                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Route, streamed first read | `app/(dashboard)/listings/[id]/booking/page.tsx:26-34` (`loadingLabel="action links"` at :30). `components/listings/streamed-tab.tsx:36-55`. `lib/locations/gating.ts:136-138` (`Reading the … from Google…`)                                          |
| Tab shell, freshness       | `booking-tab.tsx:101-130` (`LocationTab loadingLabel="booking links"` :107), `PlaceActionsFreshness` :133-149                                                                                                                                          |
| List, alerts, empty states | `BookingLinks` :168-511. No-types empty :226-273. Paused alert :290-298. Last-change alerts :308-327. "No booking links yet" :331-338                                                                                                                  |
| Row actions                | `LinkActions` :519-577 (Edit; overflow: Make preferred, Remove link)                                                                                                                                                                                   |
| Remove / prefer confirms   | `OverwriteConfirmDialog` :448-473 and :475-499 (`components/locations/overwrite-confirm-dialog.tsx`)                                                                                                                                                   |
| Add form                   | `AddLinkForm` :742-933: draft :764-778, type row/sheet :843-852 and :908-930, URL field :853-874, preferred checkbox :876-883, docked `ActionBar` :888-907                                                                                             |
| Edit dialog                | `EditLinkDialog` :935-1079: close guard :982-997, "Leave without saving?" :1069-1075                                                                                                                                                                   |
| URL validation             | `lib/editors/booking-presentation.ts:55-72` (`checkBookingUrl`)                                                                                                                                                                                        |
| Workflow hook              | `components/locations/place-actions/use-place-action-review.ts:11-64` (preview/approve/send/check/restore, `preflight` codes :10, error message :23)                                                                                                   |
| Approval sheet             | `place-action-approval-sheet.tsx:31-273` (on shared `ReviewedWriteSheet`, `ConsentSlot`, `OutcomeSummary`)                                                                                                                                             |
| Saved work list            | `saved-place-action-work.tsx:62-215`                                                                                                                                                                                                                   |
| Server (read only)         | `lib/server/place-action-attempts.ts` (outcome read :20-45, refresh/confirm :46-79). `place-action-review-state.ts`, `place-action-execution.ts`, `place-action-reviews.ts`. `app/api/locations/[id]/place-actions/route.ts` (direct POST refused :40) |

**Tests:**

- E2E `tests/e2e/listings.spec.ts:581` "booking create journey: an owner adds a booking link".
- E2E `tests/e2e/place-actions-backend.spec.ts`, under "Reviewed booking links at {width}px":
  - :66 "reads provider-supported retail action types and prepares approval before a single independently confirmed create"
  - :134 "blocks provider metadata drift after approval without a write"
  - :173 "recovers a lost response and discovers its expired saved outcome while disconnected"
  - :273 "preserves unknown acknowledgement, blocks further writes, then confirms through a separate observation"
  - :350 "shows an observed empty action set and hands unknown future action types to Google"
  - :400 "edits, prefers and removes merchant links through separate reviews…"
  - :589 "shows a failed review preparation inside the dialog that started it"
  - :633 "a second manager approves by keyboard…"
- Unit `tests/components/booking-tab.test.tsx` (:118, :127, :140, :166, :174, :191, :236, :259) and `tests/components/place-action-review.test.tsx` (:25, :47, :67, :103-133).

## 3. Steps today

1. **Initial load (document).** The Suspense fallback shows skeleton rows and **"Reading the action links from Google…"** (`page.tsx:30` → `gating.ts:137`). On client navigation, or when the prefetch fails, `LocationTab` shows **"Reading the booking links from Google…"** instead (`booking-tab.tsx:107`). If the read fails, `TabError` shows with Retry (`location-tab.tsx:250`).
2. **Loaded.** "Checked with Google … · Check Google now" (:133-149). Links are grouped by type, with a "Preferred" tag, "Managed by Google" provider rows, and a "Managed in Google" group for unknown types (:340-435). The "How customers see it" preview sits beside them on desk and below them on a phone (:661-723).
3. **Empty.** With no supported types, the page shows "Google doesn't offer booking links for this listing" and "Check categories", or "Manage these action types in Google" (:232-265). With supported types but no links, it shows **"No booking links yet"**, "Add a booking link below. Google decides how it appears publicly." (:336-337). Every role sees the same copy.
4. **Add: input.** The add form has the caption "Review comes first. Nothing reaches Google until you approve and send it." (:835).
   - **Type.** A row that opens the "Booking link type" sheet. When Google supports only one type, it is plain text (:843-852, :908-930). The default type is Reserve a table (:759-763).
   - **Link.** The input's only format cue is the placeholder `https://…` (:866). It has no visible hint.
   - **Preferred.** A "Make this the preferred link" checkbox.
   - **Docked bar.** Once a URL is typed, a docked bar shows "Ready to review. Nothing is sent to Google yet." and the button **Review booking link** (:888-907).
5. **Validation.** Validation runs on submit and then live once an error shows (:796-803, :861-865). Focus moves to the field. The messages are "Enter the link customers should open." / "That isn't a full web address. It should look like https://book.example.co.uk" / "Use a web address that starts with https://" / "This link is already on the listing for that button." (`booking-presentation.ts:60-70`). `Field` wires the error with `aria-describedby`.
6. **Preparing (in progress).** The button reads "Preparing review…" and stays mounted and focused (:893-905). On success the form draft is **discarded** (:818) and the approval sheet opens (`use-place-action-review.ts:36`). On failure, a `FailureNote` with `role="alert"` shows the **server message verbatim** (:819, :873). Example: "Google no longer lists this action link" (asserted at `place-actions-backend.spec.ts:623`).
7. **Change.** Edit → dialog "Edit Reserve a table link" → **Review booking link change** (:1029-1066). Closing with edits asks "Close without saving?" (:991-996). An in-app link asks "Leave without saving?" (:1069-1075). For a new link, `DraftNotices` asks "Leave without saving?" with "Your edits to this booking link aren't saved…" (`components/editors/draft-notices.tsx:86-91`).
8. **Remove / prefer.** Overflow → Remove link → **"Review removing this booking link?"**, button **Prepare removal review** (:455-461). Make preferred → **Prepare preferred link review** (:488). Failures show inside the dialog (:472, :498).
9. **Approve.** The sheet "Review booking link change" shows Link/Type/Preferred before→after, the steps, and expiry within the hour (`place-action-approval-sheet.tsx:74-94`, :207-213). **Approve booking link change** (:178-184). The secondary button is **Keep editing** (:137-144).
10. **Send.** Consent "Send this exact approved booking link change to Google." → **Send approved booking link change** → "Sending to Google. The outcome appears here when the response arrives." (:169-176, :235-240, :262-269).
11. **Outcome.**
    - `OutcomeSummary` reports acceptance and confirmation separately (:249-256). The title becomes "Saved booking link outcome" (:122-123).
    - If the response is lost: "The send response is unavailable. Read the saved outcome before another write." (:241-248). The buttons are **Read saved booking link outcome** and **Refresh booking link observation** ("Refreshing observation…") (:147-165).
    - On the page, the alert "Booking link changes are paused / Read the saved outcome and refresh its observation before another booking link change." has no action (`booking-tab.tsx:290-298`).
    - A stored last change shows "The last change (create) failed." or "…(update) has no confirmed outcome" (:313, :321).
12. **Saved work.** "Saved booking link work" shows its own loading, error (with Retry), and empty states, plus "Open booking link review/outcome" (`saved-place-action-work.tsx:114-197`). Each row says only "Request outcome recorded" (:160), not the result.

## 4. Protected rules for this flow

- Only owner or admin with publish rights can write (`place-action-review-state.ts:19`). The UI keeps saved work and the sheet behind `canEditCanonical`/`canPublish` (`saved-place-action-work.tsx:69-70,208-211`).
- There is no direct write. The POST returns "review required" (`app/api/locations/[id]/place-actions/route.ts:40`). Every change is preview → approve → consented send (`use-place-action-review.ts:34-59`). The confirms only prepare a review (`booking-tab.tsx:199-224`).
- A second approver is required when policy says so (`place-action-approval-sheet.tsx:221-227`). Expired or stale reviews cannot be sent (:95-101). After a lost or unknown response, all writes are blocked until it is read (`use-place-action-review.ts:16,35,53`; `booking-tab.tsx:186`).
- Nothing is called "done" before the server confirms. "Removed" appears only when `phase === "confirmed"` (`place-action-approval-sheet.tsx:72-94`). A confirmed outcome is settled. Refresh writes audit and notification events only on transition (`place-action-attempts.ts:49,57-77`).
- Preflight error codes drive state (`use-place-action-review.ts:10,57`). **Codes must not change. Only the displayed words may.**

## 5. Prior audit status

| ID                                                                              | Status                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LST-10 (P1) one-off sheet, inline primary                                       | fixed (L08 #150)            | `place-action-approval-sheet.tsx:119` `ReviewedWriteSheet`; `booking-tab.tsx:888-907` docked `ActionBar`                                                                                                                                                                                                                                                                                                             |
| LST-31 (P2) "action link" jargon                                                | **partly regressed / open** | Client copy is clean. But L16 (`c54117ba`, after L08) added `loadingLabel="action links"` (`page.tsx:30`). Server strings that reach the UI still say "action link" / "Place Action" (`place-action-attempts.ts:34,43`; `place-action-review-state.ts:19,25,44,49,51`; `place-action-execution.ts:19,73,80,82`; `place-action-reviews.ts:12-18,51`). results.md:237 already lists the server strings as out of scope |
| SET-13 follow-up: single-type picker                                            | fixed                       | `booking-tab.tsx:843-852`                                                                                                                                                                                                                                                                                                                                                                                            |
| LST-14 (P1) area fetch after hydration                                          | fixed (L16)                 | `StreamedTab` on booking (`page.tsx:27-34`)                                                                                                                                                                                                                                                                                                                                                                          |
| LST-27 (P2) read-only roles see a greyed editor; empty state tells them to edit | **open for booking**        | `readView` covers only hours/menu/profile (results.md:234). Booking still renders the disabled add form for member/viewer (`booking-tab.tsx:437-442`; asserted at `booking-tab.test.tsx:118-124`). "Add a booking link below" shows to every role (:337)                                                                                                                                                             |
| LST-04/05 (action bar)                                                          | fixed                       | the booking bar is docked and appears only once a URL is entered (:896)                                                                                                                                                                                                                                                                                                                                              |
| DSK-14 (empty state carries its action)                                         | n/a here                    | the add form sits directly under the empty card                                                                                                                                                                                                                                                                                                                                                                      |

## 6. Friction

| #   | Problem                                                                                                                                                                                  | Evidence                                                                                                                                                          | Sev | Heuristic / WCAG                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------- |
| 1   | The streamed pending line uses jargon, and its text changes when `LocationTab` takes over. This breaks the `StreamedTab` contract ("LocationTab's `loadingLabel` for the same tab")      | `page.tsx:30` "action links" vs `booking-tab.tsx:107` "booking links"; `streamed-tab.tsx:43`                                                                      | P2  | Consistency; plain language; LST-31 regression           |
| 2   | Server error text with "action link" / "Place Action writes are paused." is shown word for word where the operator acts                                                                  | `use-place-action-review.ts:23` → `booking-tab.tsx:472,498,819,873,1023`, sheet :257-261, saved work :109-113; e2e :623 "Google no longer lists this action link" | P2  | Plain language; error recovery                           |
| 3   | Member/viewer see a greyed, unusable add form. The empty state tells them to "Add a booking link below"                                                                                  | `booking-tab.tsx:437-442,337`; `booking-tab.test.tsx:118-124`                                                                                                     | P2  | LST-27; aesthetic/minimalist; match                      |
| 4   | The sheet's "Keep editing" returns to nothing. The add draft was already discarded (:818) and the edit dialog closed (:1024-1025). In the recorded state there is nothing to edit at all | `place-action-approval-sheet.tsx:137-144`                                                                                                                         | P2  | Match system/real world; user control                    |
| 5   | The "paused" alert gives an instruction but no way to act on it. Saved work sits at the bottom of the page, outside the frame                                                            | `booking-tab.tsx:290-298`; `booking-tab.tsx:127`                                                                                                                  | P2  | Recovery; preserved context                              |
| 6   | Raw enum words and internal terms appear in outcome copy: "(create)", "refresh its observation", "Refresh booking link observation", "Refreshing observation…"                           | `booking-tab.tsx:294-295,313,321`; sheet :161,164                                                                                                                 | P3  | Plain language                                           |
| 7   | The URL format is shown only as a placeholder `https://…`, which disappears on typing. The edit dialog has no cue at all                                                                 | `booking-tab.tsx:866`; :1041-1053                                                                                                                                 | P3  | WCAG 3.3.2 labels or instructions; error prevention      |
| 8   | Confirm titles and buttons are noun-stacked and differ from the rest of the flow ("Review booking link", "Review booking link change")                                                   | "Review removing this booking link?" / "Prepare removal review" :455,461; "Prepare preferred link review" :488                                                    | P3  | Consistency; plain language                              |
| 9   | Saved rows say "Request outcome recorded" whatever the result                                                                                                                            | `saved-place-action-work.tsx:160`. The item has only `attemptId` (`lib/server/place-action-workflows.ts:38`)                                                      | P3  | Visibility of status. **Needs an API field → follow-up** |
| 10  | **Hypothesis:** "Leave without saving?" on the add form reads oddly, because booking never "saves" (`savesHere: false`, :196)                                                            | `draft-notices.tsx:88` (SHARED)                                                                                                                                   | P3  | Match. No change proposed (shared)                       |

## 7. Proposed changes

### C1 — Streamed loading label says "booking links" (#1)

- `app/(dashboard)/listings/[id]/booking/page.tsx:30`: `loadingLabel="action links"` → `loadingLabel="booking links"`. The line now reads "Reading the booking links from Google…" in both phases.
- **Benefit:** no jargon and no text swap during load. Completes LST-31. **Principle:** consistency, plain language.
- **Risk:** none. It is a presentation string; the prefetch entries are unchanged.
- **Test:** add `"booking links"` to the label loop in `tests/server/streamed-tab.test.ts:55`. Optionally, add a test that reads each `app/(dashboard)/listings/[id]/*/page.tsx` source and checks that its `loadingLabel` equals the matching tab's.

### C2 — Read-only roles see the links, not a disabled form (#3, LST-27)

- `booking-tab.tsx` `BookingLinks`: add `const readOnly = caps !== undefined && !caps.canEditCanonical`. This mirrors the server's owner/admin rule at `place-action-review-state.ts:19`.
  - Render `<AddLinkForm>` (:437-442) only when `!readOnly`.
  - Empty description at :337 becomes `readOnly ? "Google shows no booking buttons on this listing. An owner or administrator can add one." : "Add a booking link below. Google decides how it appears publicly."`
  - Keep the `CapabilityBanner` as the reason.
- Owners or admins blocked only by a publish or pause reason still see the disabled form plus the banner. That keeps the behaviour unchanged for them.
- **Benefit:** members and viewers get a clean read view, with no dead controls. **Principle:** LST-27 fix pattern, minimalist design.
- **Risk:** none. It hides UI only; server gates are untouched; `LinkActions` already render only for editable links and are disabled.
- **Test:** rewrite `booking-tab.test.tsx:118` so that, with `canEditCanonical:false`, there is no `textbox "Link"` and no `button /^Type/`, the banner text is present, and the read-only empty copy shows when `links: []`.

### C3 — Booking-link words for server errors, client side only (#2)

- `use-place-action-review.ts`: add `bookingLinkMessage(failure: ApiClientError): string`, used at :23 in place of `failure.message`. It maps by `failure.code` and falls back to the server message for unknown codes. Codes and the `preflight` logic stay unchanged.
  - `place_action_target_missing` → "Google no longer lists this booking link. Check Google now, then try again."
  - `place_action_already_present` → "Google already lists this booking link."
  - `place_action_no_change` → "Google already shows this link with these settings."
  - `place_actions_paused` → "Booking link changes are paused for now. Nothing was sent to Google."
  - `google_baseline_stale` → "Google's booking links changed after this review. Check Google now and review again."
  - `google_target_changed` → "The linked Google account or listing changed. Reconnect it, then prepare a fresh review."
  - `publish_not_allowed` → "Only an owner or administrator who can publish this listing can change its booking links."
  - `place_action_review_unreadable` → "This saved booking link review can't be restored safely. Prepare a fresh one."
  - `place_action_attempt_not_found` → "No send is recorded for this booking link review."
  - `place_action_attempt_unreadable` → "This booking link outcome needs a check by support before another change."
  - `place_action_not_ready` → "This interrupted send can be checked five minutes after it started."
  - `place_action_observation_unreadable` → "Google returned booking links we can't read safely. Check Google now, or manage them in Google."
  - `google_confirmation_unresolved` → "A booking link change on this Google account is waiting for its outcome. Open its saved outcome first."
- **Benefit:** one vocabulary at the point of action, with a next step in each message. **Principle:** plain language, error recovery.
- **Risk:** none to contracts. Only the display string changes; `ApiError` codes, statuses and server messages (also used by bulk and logs) are untouched. Unmapped codes keep today's text.
- **Tests:**
  - Update `place-actions-backend.spec.ts:623` to "Google no longer lists this booking link".
  - Add a case to `place-action-review.test.tsx`: a preview rejected with `place_action_target_missing` shows the mapped text, and an unknown code shows the server text.
  - `booking-tab.test.tsx:160` ("google_unavailable") stays as it is (fallback).

### C4 — Outcome and recovery: honest dismiss, plain check, actionable alerts (#4, #5, #6)

- **Dismiss button** (`place-action-approval-sheet.tsx:143`): "Keep editing" → `{recorded ? "Done" : "Close"}`. This follows `combined-review.tsx:339` (`finished ? "Done" : "Keep editing"`). When `!recorded && !sending`, add `<p className="text-ui text-ink-muted">Closing keeps this review in Saved booking link work.</p>` after `SupportDetails` (:204).
- **Refresh button** (:161, :164): "Refresh booking link observation" / "Refreshing observation…" → **"Check this change on Google"** / "Checking Google…". The handler is still `workflow.check(true)`.
- **Paused alert** (`booking-tab.tsx:292-296`):
  - Description becomes "Open the saved outcome and check it on Google before another booking link change."
  - When `workflow.review` exists, add `<AlertActions><Button size="sm" variant="secondary" onClick={() => workflow.setOpen(true)}>Open saved outcome</Button></AlertActions>`. `AlertActions` comes from `components/ui/alert.tsx:184`, already exported; this is not a shared edit.
- **Last-change alerts** (:313, :321): replace `latest.operation.toLowerCase()` with a local map `{ create: "adding a link", update: "changing a link", delete: "removing a link" }[latest.operation] ?? "a booking link change"`. Example: "The last change (removing a link) failed."
  - For the "needs a check" alert, when `caps?.canEditCanonical`, add a link `<a href="#saved-booking-link-work" className={buttonVariants({ variant: "secondary", size: "sm" })}>Go to saved booking link work</a>`.
  - In `saved-place-action-work.tsx:87`, pass `id="saved-booking-link-work"` to `SettingsGroup`. This uses the existing `id` prop; keep the `aria-label` the e2e relies on.
- **Benefit:** the button labels describe what actually happens, and every blocking state carries its own next step. **Principle:** Nielsen 3 and 9, HIG preserved context.
- **Risk:** none. Handlers, the consent and send gating (:95-101, :169-176), and the uncertain and stale logic are unchanged. `setOpen(true)` only reopens an already-loaded review, which is the same as "Open booking link outcome".
- **Tests:**
  - Rename button lookups: "Keep editing" → "Close"/"Done" at `place-actions-backend.spec.ts:219,304,524,551` (choose by state) and `place-action-review.test.tsx:88`; "Refresh booking link observation" at :336 and :489.
  - Add a unit test: an unresolved workflow shows "Open saved outcome", and clicking it opens the sheet.

### C5 — URL hint and confirm labels (#7, #8)

- **URL hint.** In `AddLinkForm` (:856-871) and `EditLinkDialog` (:1041-1054), add `<FieldDescription>The full address of your booking page, starting with https://</FieldDescription>` after `<Input>`, following the repo's convention (`address-details-fields.tsx:36`). Import `FieldDescription` from `@/components/ui/field`. Keep the placeholder.
- **Removal dialog:**
  - Title (:455) becomes `deleteTarget ? \`Remove this ${actionTypeLabel(deleteTarget.placeActionType)} link?\` : "Remove this booking link?"`.
  - Description gets this sentence appended: " You review and approve the removal before it's sent."
  - `confirmLabel` (:461): "Prepare removal review" → **"Review removal"**.
- **Prefer dialog:** `confirmLabel` (:488): "Prepare preferred link review" → **"Review preferred link"**.
- `pendingLabel` "Preparing review…" stays.
- **Benefit:** the format is known before the error, and is announced through `aria-describedby`. The confirm verbs now match "Review booking link". **Principle:** WCAG 3.3.2, consistency.
- **Risk:** none. Copy only; the confirm still calls `workflow.preview` only.
- **Tests:** update `booking-tab.test.tsx:254,256` and `place-actions-backend.spec.ts:509,564,615,620`. Add an assertion that the Link textbox has the description "The full address of your booking page, starting with https://".

### Follow-ups (out of scope)

- Server `ApiError` messages still say "action link" / "Place Action" (C3 covers them on screen only). Rewriting them touches shared server code, bulk and logs.
- Saved rows show the real result (accepted, rejected, unconfirmed) (#9). This needs `executionState`/`confirmationState` on `placeActionWorkflowsResponseSchema` (contract change).
- `DraftNotices` "Leave without saving?" wording for review-only editors (#10). This needs an opt-in `verb` prop on SHARED `components/editors/draft-notices.tsx`, which every editor calls.

## 8. Screenshots to capture

| Route                                                               | Role                | Interaction                               | Shows                                                                                           |
| ------------------------------------------------------------------- | ------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/listings/{loc}/booking` (document load, slow Google stub)         | owner               | none (fallback paint)                     | C1: "Reading the booking links from Google…"                                                    |
| `/listings/{loc}/booking`                                           | member (and viewer) | none                                      | C2: read view with no greyed form; empty copy by role when the listing has no links             |
| `/listings/{loc}/booking`                                           | owner               | type `notaurl`, press Review booking link | C5: hint plus error under Link; docked bar                                                      |
| `/listings/{loc}/booking` after a lost send (e2e stub :173 fixture) | owner               | needs interaction                         | C4: paused alert with "Open saved outcome"; sheet with "Done" and "Check this change on Google" |

## 9. Files touched

```
app/(dashboard)/listings/[id]/booking/page.tsx
components/locations/booking-tab.tsx
components/locations/place-actions/place-action-approval-sheet.tsx
components/locations/place-actions/saved-place-action-work.tsx
components/locations/place-actions/use-place-action-review.ts
tests/server/streamed-tab.test.ts
tests/components/booking-tab.test.tsx
tests/components/place-action-review.test.tsx
tests/e2e/place-actions-backend.spec.ts
```

None of these are shared. `components/ui/alert.tsx` (`AlertActions`), `components/ui/field.tsx` (`FieldDescription`) and `components/ui/settings-row.tsx` (`id` prop) are used as they are, not edited. `lib/server/place-action-attempts.ts` is not changed.
