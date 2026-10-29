# p3-F05 — Edit the core business profile and send it to review

Code read at `/tmp/naba-presence-p3` (branch `ux/flows-presence-p3`, head `e4123d25`). Read-only analysis.

## 1. Flow

- **ID / name:** p3-F05. Edit the core business profile and send it to review.
- **Goal:** change the name, contact details, address and related Google fields, see the exact diff, then publish, or save NabaPresence's copy only.
- **Start:** `/listings/[id]/profile`, which renders `app/(dashboard)/listings/[id]/profile/page.tsx:20-35` → `StreamedTab` → `AreaEditor area="profile"` → `ProfileTab` (`components/locations/profile/profile-editor.tsx:216`).
- **End (server-confirmed):** one of these:
  - the review sheet closes and a toast says "Business profile live on Google" or "…sent to Google", depending on the outcome (`profile-editor.tsx:600-609`);
  - the sheet stays open on per-row results when a step is held for another approver (`:463`, `:572`, `:608`);
  - "Save here" toasts "Name, description, phone and website saved here" (`:647-654`).
- **Roles:**
  - Owner and admin can edit the copy fields (`editDisabledReason`, `lib/locations/gating.ts:39-43`).
  - Publishing also needs `canPublish` (`gating.ts:67-76`). Under two-person approval, the request waits for a second approver.
  - Member and viewer get the read view (`profile-editor.tsx:250`, `:999`; `editor-frame.tsx:20-31`).

## 2. Code map

| Piece                                                     | Where                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page and stream                                           | `app/(dashboard)/listings/[id]/profile/page.tsx:27-33`                                                                                                                                                                                                                                                |
| Tab shell, unreachable state, saved work after the editor | `profile-editor.tsx:216-271`; `profile-unreachable.tsx`                                                                                                                                                                                                                                               |
| Three drafts: copy fields, Google listing, attributes     | `profile-editor.tsx:306-357` (`useEditorDraft`, `lib/editors/use-editor-draft.ts`)                                                                                                                                                                                                                    |
| Diff rows and per-field "Changed"                         | `profile-editor.tsx:390-443`, `:784-822`                                                                                                                                                                                                                                                              |
| Validation (client schema + payload issues)               | `:159-196`, `:363-371`, `:661-709`; `lib/locations/forms/profile.ts:5-10`; `lib/locations/business-information-draft.ts:263-277`                                                                                                                                                                      |
| Prepare review (server previews: change sets)             | `:711-737` → `previewBusinessInformation`, `previewBusinessAttributes`                                                                                                                                                                                                                                |
| Publish steps (save → profile → listing → attributes)     | `:465-610` (`usePublishFlow`, `lib/editors/use-publish-flow.ts`)                                                                                                                                                                                                                                      |
| Save here                                                 | `:633-659` (`saveProfile` PUT)                                                                                                                                                                                                                                                                        |
| Footer gate and labels                                    | `:757-768`, `:982-1022` → `components/editors/editor-footer.tsx` (SHARED)                                                                                                                                                                                                                             |
| Frame, read view, focus-clear                             | `components/editors/editor-frame.tsx` (SHARED)                                                                                                                                                                                                                                                        |
| Restore, incoming edits and leave guard                   | `components/editors/draft-notices.tsx:39-92`, `lib/editors/use-leave-guard.ts`                                                                                                                                                                                                                        |
| Discard                                                   | `profile-editor.tsx:1082-1096`; `components/editors/discard-dialog.tsx`                                                                                                                                                                                                                               |
| Combined review sheet                                     | `components/reviewed-write/combined-review.tsx:243-459` (SHARED), lazy via `lazy-sheets.tsx`                                                                                                                                                                                                          |
| Sections                                                  | `sections/identity-section.tsx:58-172`, `contact-section.tsx:71-133` (Contact), `:143-264` (Address), `:269-317` (Description), `:324-540` (Opening), `additional-phones-section.tsx`, `address-details-fields.tsx`, `opening-date-fields.tsx`, `chain-section.tsx`, `related-businesses-section.tsx` |
| Section nav and cards                                     | `section-nav.tsx:60-287`, `section-card.tsx:67-137`                                                                                                                                                                                                                                                   |
| Overwrite confirm                                         | `components/locations/overwrite-confirm-dialog.tsx` is **not used by this flow**. Its callers are `booking-tab.tsx:448,475`, `suggestion-list.tsx:468` and `settings/import-card.tsx:406,425`. The profile's overwrite consent is the checkbox in `combined-review.tsx:386-406`.                      |

**Tests**

- e2e `tests/e2e/listings.spec.ts`:
  - "publish journey: an owner edits the business name, reviews the diff, then publishes" (:406)
  - "listing publish journey: a Google-only field goes out through the same review sheet" (:638)
  - "read-only views: a member sees read rows…" (:529)
  - "profile section headings at 390…" (:822)
  - "profile section nav focus at 390" (:873)
- e2e `tests/e2e/gbp-management-tabs.spec.ts`: the per-section review specs (:103-:945), "Business profile editor renders live Google data with humanised fields" (:946) and "The browser's back button asks before throwing away unsaved profile edits" (:991).
- e2e `tests/e2e/touch-critical.spec.ts:1138` ("listings: open a listing, edit its profile, and review the change in the sheet") and `tests/e2e/accessibility.spec.ts:684` ("listing overview and the profile editor").
- Unit: `tests/components/profile-editor.test.tsx` (save and review boundaries :1081, one review sheet L14 :1433, section nav :1295), `combined-review.test.tsx`, `editor-footer.test.tsx`, `section-nav.test.tsx` and `profile-section-card.test.tsx`.

## 3. Steps today

1. **Open.** The page streams and the copy fields show first. While Google's half loads, a `role="status"` line says "Reading categories, address and attributes from Google…" (`:900-911`).
   - If that read fails, an info banner says the four fields are still editable (`:912-918`).
   - A clean editor draws no footer (`:993`, `editor-footer.tsx:171-172`).
   - On a phone the section nav is a sticky strip; on desk it is a rail (`section-nav.tsx:215-285`).
2. **Edit.** The user types in any section. A "Changed" word appears on each row whose value differs from Google (`:788-822`), and the nav shows a dot or "Changed" (`section-nav.tsx:266-279`). The footer arrives showing "N changes not on Google · unsaved edits", with "Review changes" as the primary and "Save here" / "Discard edits" as secondaries (`editor-footer.tsx:176-234`).
   - Choosing "Permanently closed" opens a confirm dialog with an acknowledgement checkbox (`contact-section.tsx:490-537`).
3. **Validation.**
   - **Copy fields** (name, description, phone, website) show errors only after Review or Save is tried. `check()` then fills `ValidationSummary` and focuses it (`:698-716`, `:1073-1076`).
   - **Google-only fields** (address, opening date, phones, chain…) show their error inline straight away. They also disable "Review changes" with the note "Fix the highlighted fields before publishing." (`:759-760`). The summary never appears for them, because `attempts` only rises inside `check()`.
4. **Save here** (optional). This saves the four copy fields only. With only Google-field edits, Save here is left out and a 37-word note explains why (`:982-986`).
5. **Review changes.**
   - While `prepareReview` runs, the button greys and the note says "Preparing the exact review." (`:758`). There is no spinner or announcement.
   - On success the combined sheet opens with one plain route line, the diff and "Publish to Google" (`combined-review.tsx:322-367`).
   - If the preview fails, a toast shows the error (`use-resource-mutation.ts:163-191`).
6. **Conflict.** A field changed on Google shows a warning banner above the form (`:1058-1064`). In the sheet, publishing stays off until the user ticks "I've read what Google has now and want to replace it." (`combined-review.tsx:386-406`).
7. **Publish.** Rows show "Saving…" then "Sending to Google…" (`combined-review.tsx:133-139`). On a failure the user sees an error line, "Try again" and "Nothing after it was sent." (`:432-447`). If the answer was lost, a receipt notice shows instead (`:423-430`). Two-person mode keeps Publish off, and the same reason appears twice in the sheet (`combined-review.tsx:87-88` and `profile-editor.tsx:1113`).
8. **Leave.** An in-app link or Back with unsaved drafts opens "Leave without saving?" (`draft-notices.tsx:41-44,86-92`). `beforeunload` covers closing the tab. A later visit offers "Restore".

## 4. Protected rules (must not change)

- **Who can edit:** only owners and admins edit the copy, and fields stay disabled until the role is known (`gating.ts:42`; `profile-editor.tsx:248-252`). Billing read-only blocks all edits (`gating.ts:41`).
- **Publishing:** needs `canPublish` and writes enabled (`gating.ts:67-76`). Lodging work blocks other profile writes (`profile-editor.tsx:296-299`).
- **Review before publish:**
  - Nothing goes to Google except from the sheet's "Publish to Google" (`editor-footer.tsx:46-49`).
  - Google-field changes are server-prepared change sets: `previewBusinessInformation` and `previewBusinessAttributes` (`:718-737`). They are approved, then sent hash-pinned (`:530-562`).
- **Two-person approval:** `waitsForApprover` disables the whole publish (`:131-135`, `:1113`). A server-held step stays "awaiting approval", never "sent" (`combined-review.tsx:161-167`).
- **Overwrite consent:** `confirmOverwriteGoogleChanges: needsAck` (`:516`). The tick resets when the sheet reopens or the set of conflicts changes (`combined-review.tsx:269-285`).
- **Idempotency:** every step sends `intentId: intent.idFor(body)` (`:519,537,559`).
- **Concurrency:**
  - `expectedCanonicalRevision`, `expectedCanonicalHash` and `expectedGoogleHash` (`:477,513-515`) guard the writes.
  - A stale review fingerprint blocks publishing (`:455-458,1104,1113`).
  - A colleague's save offers "Load theirs" or "Keep mine" (`draft-notices.tsx:58-84`).
- **Server authority:**
  - Only steps marked `verified` read Google back (`:498,528,550`).
  - The toast says "live on Google" only for `confirmed_applied` (`:600-606`).
  - Saved-here detail reads "NabaPresence's copy. Not on Google by itself." (`combined-review.tsx:110`).

## 5. Prior audit status

| ID                                               | Status              | Evidence                                                                                                                                                                      |
| ------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LST-04 (+DSK-02) three-button bar, idle desk bar | fixed (#131)        | `editor-footer.tsx:171-172` (no bar when clean), `:207-234` (one primary, secondaries in overflow)                                                                            |
| LST-06 (+DSK-20) header rows                     | fixed for this flow | Profile part done in F3 (#205): `section-card.tsx:115-116` `quietOnPhone`, `identity-section.tsx:83,103-107`. The remainder (Hours time zone, follow-up 26) is not this flow. |
| LST-08 two write models in one form              | fixed (#157)        | `combined-review.tsx:77-101,243`; used at `profile-editor.tsx:1098-1114`; `SaveModelTag` is gone                                                                              |
| LST-13 failure said three times                  | fixed (#147)        | One `role=alert` line plus PublishSteps, with the code under support details (`combined-review.tsx:432-447`)                                                                  |
| LST-14 fetch after hydration                     | fixed (#156, #212)  | `profile/page.tsx:27-33` `StreamedTab`                                                                                                                                        |
| LST-27 greyed read view                          | fixed (#147, #212)  | `readView` at `profile-editor.tsx:999`, `editor-frame.tsx:20-31`                                                                                                              |
| DSK-15 status words                              | fixed (#152)        | `editor-footer.tsx:23` uses `syncStatusLabel`                                                                                                                                 |
| DSK-18 short fields span desk                    | fixed (#139)        | `identity-section.tsx:93,120` `measure="short"`                                                                                                                               |
| LST-02, LST-21, DSK-01                           | fixed               | Activity, info sheet and tabs are frame-level; not re-opened here                                                                                                             |

No LST or DSK finding for this flow is still open. Everything below is new.

## 6. Friction

| #   | Problem                                                                                                                                                                                                                                                                                                             | Evidence                                                                                                                                                                              | Sev | Heuristic / WCAG                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------- |
| 1   | An error in a Google-only field disables "Review changes" and only says "Fix the highlighted fields before publishing." No summary appears and nothing links to the field, which may be sections away on a 14-section page. The disabled button is not focusable and the reason isn't tied to it.                   | `profile-editor.tsx:759-760` → `:1017` → `editor-footer.tsx:221` (`disabled=`, not `disabledReason`); summary gated on `attempts > 0` at `:1074`, raised only in `check()` `:698-709` | P2  | Nielsen 9 (recover), 5; WCAG 3.3.1, 3.3.3                                         |
| 2   | Two summary links don't land focus: "Opening date" targets a `<fieldset>` and "Additional address details" targets the `<details>` element. Neither is focusable, and `moveTo` only scrolls.                                                                                                                        | `profile-editor.tsx:687,690`; `opening-date-fields.tsx:67-68`; `address-details-fields.tsx:28`; `validation-summary.tsx:46-49,115-121`                                                | P3  | WCAG 2.4.3, 3.3.1                                                                 |
| 3   | While the review is being prepared (a server round trip), the primary only greys out. The muted note "Preparing the exact review." is `role="note"` and not live, so nothing is announced. "Exact" is internal jargon.                                                                                              | `profile-editor.tsx:758`; `editor-footer.tsx:221,296-303`                                                                                                                             | P2  | Nielsen 1; WCAG 4.1.3                                                             |
| 4   | Every row whose value differs from Google says "Changed", including fields the user never touched that changed on Google (`google_dirty`, `conflict`) or were saved here and not yet published (`core_dirty`). The user can't tell their edit from Google's.                                                        | `profile-editor.tsx:788-792` (compares with `googleValue`); `identity-section.tsx:91`; `contact-section.tsx:88,110,288`; statuses in `lib/domain/profile-vocabulary.ts:39-44,120-134` | P2  | Nielsen 1, 2 (match), 5                                                           |
| 5   | Save here's absence note is 37 words. It makes the docked phone bar wrap to a second row (`max-md:flex-wrap`).                                                                                                                                                                                                      | `profile-editor.tsx:985`; `editor-footer.tsx:191-192,256-257`                                                                                                                         | P3  | Nielsen 8 (minimalist); WCAG 2.4.11 risk from a taller dock (Hypothesis at 320px) |
| 6   | Jargon in the review and section copy: "The draft or Google baseline changed…"; "Local checks validate format only; provider validation and confirmation are separate."; "Preserve the existing value unless you intend to change it."; "Existing values are shown so they can be preserved or explicitly cleared." | `profile-editor.tsx:1113`; `related-businesses-section.tsx:75`; `contact-section.tsx:256`; `address-details-fields.tsx:45`                                                            | P3  | Nielsen 2 (plain language)                                                        |
| 7   | With an approver needed, the sheet says it twice: the route line ("…needs a different authorised user to approve it before anything is sent.") and the footnote ("A different authorised user must approve this saved review.").                                                                                    | `combined-review.tsx:87-88,452-456`; `profile-editor.tsx:1113`                                                                                                                        | P3  | Nielsen 8                                                                         |
| 8   | The description counter is `aria-live="polite"` and is also the textarea's description, so a screen reader reads "123 / 750" on every keystroke.                                                                                                                                                                    | `contact-section.tsx:289-298`; `settings-row.tsx:502-508`                                                                                                                             | P3  | WCAG 4.1.3 (noise); Nielsen 8                                                     |
| 9   | Naming and markup slips. The nav says "Additional phones" but the section title is "Additional phone numbers". The chain results wrapper is a `div` with `aria-label` and no role, so the name is ignored.                                                                                                          | `profile-editor.tsx:872` vs `additional-phones-section.tsx:22`; `chain-section.tsx:57`                                                                                                | P3  | Nielsen 4 (consistency); WCAG 1.3.1 / 4.1.2                                       |
| 10  | **Hypothesis:** the leave guard and "Restore" cover only the three profile drafts, not the Services or Lodging drafts on the same page.                                                                                                                                                                             | `draft-notices.tsx:40-44` given `[valuesDraft, listingDraft, attributesDraft]` at `profile-editor.tsx:1039-1042`; no `useLeaveGuard` under `sections/service-*` or `lodging-*` (grep) | —   | out of this flow's section scope; follow-up                                       |

## 7. Proposed changes

### C1 — Review always shows what to fix (#1, #2) · area-local

**Change in `profile-editor.tsx`:**

- **`blocked` (`:757-768`):** remove the `Object.keys(listingIssues).length > 0 ? "Fix the highlighted fields before publishing."` clause, so "Review changes" stays enabled and `review()` runs `check()`. C3 removes the "Preparing" part. The result is `publishReason ?? (!googleReady ? null : rows.length === 0 ? "Everything already matches Google." : null)`.
- **`issues` (`:661-696`):** add a catch-all after the mapped keys. Each `listingIssues` key not already listed (`title`, `description`, `primaryPhone`, `websiteUri`) is pushed with fieldId `PROFILE_FIELD_IDS.name` / `.description` / `.phone` / `.website`. This lets `check()` never pass while `listingIssues` is non-empty. Also make `check()` return `issues.list.length === 0 && Object.keys(listingIssues).length === 0` as a second guard.
- **Address details:** change its fieldId from `"profile-address-details"` to `"profile-address-language"`. That is the field that carries the error (`address-details-fields.tsx:48-53`).
- **Summary navigation:** pass `onNavigate` to `ValidationSummary` (`:1073`). It should:
  - open the enclosing `<details>` (`document.getElementById(id)?.closest("details")`, then `open = true`);
  - if the target isn't a form control, focus its first enabled `input, textarea, button` (opening date → its Day input).

**Benefit:** one consistent submit-then-summary pattern for every field. The bar no longer blocks without saying where the problem is.

**Risk:** none. `review()` already returns before `prepareReview` when `check()` fails (`:711-716`), so no preview is made with invalid data. The server schema and `businessInformationPayloadSchema.parse` (`:722`) are unchanged.

**Test:**

- Update `profile-editor.test.tsx`: set an invalid opening month (13). Expect "Review changes" to be enabled. Click it and expect `role=alert` "Fix 1 problem" with the link "Opening date: …". Clicking the link focuses the Day input. No POST to `/business-information`.
- Add the same check for address language inside a closed `<details>`.

### C2 — Field marks say whose change it is (#4) · area-local

**Change in `profile-editor.tsx`, after `:792`:** add `fieldMark(key)` for `name | description | phone | website`:

- local edit (`values[key] !== initialValues[key]`) and different from Google → `"Changed"`;
- otherwise status `google_dirty` or `conflict` → `"Changed on Google"`;
- `core_dirty` → `"Not on Google yet"`;
- otherwise `undefined`.

These words already exist in `editor-footer.tsx:24-29`.

**Wiring:**

- Pass `marks={{ name: fieldMark("name") }}` to `IdentitySection`, `marks={{ phone, website }}` to `ContactSection`, and `mark={fieldMark("description")}` to `DescriptionSection`.
- In `identity-section.tsx:91`, `contact-section.tsx:88,110` and `:288`, render `changed={marks.x}` and `changed={mark}` instead of `changed.x ? "Changed" : undefined`.
- The boolean `changed` props stay for section and nav marks.

**Benefit:** the operator can tell a Google-side change from their own before opening the sheet. This matches the conflict banner at `:1058`.

**Risk:** presentation only. The diff rows, `needsAck` and the publish body are unchanged.

**Test:** unit test where the stub profile has `name.status = "google_dirty"` and no edit. The Business name row's description contains "Changed on Google". After typing, it shows "Changed".

### C3 — Visible, announced progress while the review is prepared (#3) · SHARED opt-in

**Change in `components/editors/editor-footer.tsx` (SHARED):**

- Add an opt-in prop `reviewPending?: boolean` (default `false`).
- The primary becomes `<Button onClick={onReview} disabled={Boolean(disabledReason)} pending={reviewPending} pendingLabel="Preparing review…">`.
- In the status (`:267-277`), lead with `<strong>Preparing review…</strong>` when `reviewPending`, exactly as `saving` does. The ActionBar status is `aria-live="polite"` (`components/ui/action-bar.tsx:159`), so it is announced.

**Change in `profile-editor.tsx`:**

- Pass `reviewPending={prepareReview.isPending}`.
- Delete the `"Preparing the exact review."` branch from `blocked` (`:758`).

**Other callers:** `components/locations/hours-tab.tsx:456`, `components/locations/menu-tab.tsx:293`, `app/design-system/ux-p02-demo.tsx:80`. None passes the prop, so they are unchanged.

**Risk:** none. `Button` `pending` blocks activation (`button.tsx:232,280`), so double-submit is still impossible.

**Test:**

- `editor-footer.test.tsx`: with `reviewPending`, the primary has `aria-busy="true"` and reads "Preparing review…", and the status starts "Preparing review…".
- `profile-editor.test.tsx`: hold the preview fetch and assert the same.

### C4 — Plain, shorter copy (#5, #6, #7, #9) · area-local

| File:line                            | Before → after                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profile-editor.tsx:985`             | "Additional phones, categories, related businesses, address, service areas, opening state and attributes go to Google when you publish. Only the name, description, primary phone and website are saved here." → "Only the name, description, primary phone and website are saved here. Your other edits go to Google when you review and publish." (keeps the phrase the unit test at `profile-editor.test.tsx:1094` matches) |
| `profile-editor.tsx:1113` (stale)    | "The draft or Google baseline changed. Close this review and review again." → "Google or your edits changed since this review opened. Close it and choose Review changes again."                                                                                                                                                                                                                                               |
| `profile-editor.tsx:1113` (approver) | "A different authorised user must approve this saved review." → "Publishing unlocks once they approve." (the route line already says who). Update `profile-editor.test.tsx:1570-1572`.                                                                                                                                                                                                                                         |
| `related-businesses-section.tsx:75`  | "…Local checks validate format only; provider validation and confirmation are separate." → "Use an existing Google place ID. We check its format here; Google checks the place when you publish."                                                                                                                                                                                                                              |
| `contact-section.tsx:256`            | "Not required for a UK postal address. Preserve the existing value unless you intend to change it." → "Not needed for a UK address. Leave it as it is unless it's wrong."                                                                                                                                                                                                                                                      |
| `address-details-fields.tsx:45`      | "…It is not a UK postcode. Existing values are shown so they can be preserved or explicitly cleared." → "…It is not a UK postcode. Clear it to remove it from Google."                                                                                                                                                                                                                                                         |
| `additional-phones-section.tsx:22`   | title "Additional phone numbers" → "Additional phones" (matches the nav at `profile-editor.tsx:872` and the summary prefix at `:688`)                                                                                                                                                                                                                                                                                          |
| `chain-section.tsx:58`               | "Searching Google chains..." → "Searching Google chains…"                                                                                                                                                                                                                                                                                                                                                                      |

**Risk:** copy only. **Test:** adjust the two assertions noted in the table. No e2e asserts these strings (grep of `tests/`).

### C5 — Quieter description counter; named chain results (#8, #9) · area-local

**Description counter, `contact-section.tsx:289-298`:**

- Remove `aria-live="polite"` from the visible counter, which stays as the description.
- Add `<span role="status" className="sr-only">{over ? "Over Google's 750-character limit." : ""}</span>` inside the SettingsRow control after `<FieldError />`, so the limit is announced once when it is crossed.

**Chain results, `chain-section.tsx:57`:** add `role="group"` to the results `div` so its `aria-label` "Chain search results" applies.

**Risk:** none. **Test:** unit test that the description textarea's described-by node has no `aria-live`, and that the status reads the limit message only past 750.

## Follow-ups (out of scope)

- **"Use Google's version":** the contract already has `from_google` (`lib/contracts/location-profile.ts:47,53`) but the profile has no UI for it. Today the only way to resolve a conflict is to overwrite Google. This would be a new write path, so it needs an owner decision.
- **Leave guard for Services and Lodging drafts** (#10): verify first, then reuse `useLeaveGuard`.
- **"Leave without saving?" wording:** for Google-only edits, which have no save, the shared `draft-notices.tsx:88-91` copy needs an opt-in noun or description prop. Low value, and the file is shared.
- **Save-here toast:** it lists all four fields even when one changed (`profile-editor.tsx:649`). It could list only the changed ones using the `listOf` helper, if `combined-review.tsx` exported it (shared).

## 8. Screenshots to capture

1. `/listings/{loc}/profile`, owner, 390×844, no interaction. A clean editor: the baseline for the header, the section strip and no footer.
2. `/listings/{loc}/profile`, owner, 390×844 and 1280. **Interaction:** set the Opening date month to 13. Before: Review is disabled with "Fix the highlighted fields…" in the docked bar. After: Review is enabled, then the "Fix 1 problem" summary appears (C1).
3. `/listings/{loc}/profile`, owner. **Interaction:** edit Store code only to show the Save-here note height on the docked bar (C4). Then click Review with the preview held to show "Preparing review…" (C3; needs a route stub).
4. `/listings/{loc}/profile` with a seeded listing whose name drifted on Google (`google_dirty`), owner, no interaction. Shows "Changed on Google" on Business name next to the warning banner (C2). Use it only if the harness seed has drift; otherwise it needs a stub.

## 9. Files touched

- components/locations/profile/profile-editor.tsx
- components/locations/profile/sections/identity-section.tsx
- components/locations/profile/sections/contact-section.tsx
- components/locations/profile/sections/additional-phones-section.tsx
- components/locations/profile/sections/address-details-fields.tsx
- components/locations/profile/sections/chain-section.tsx
- components/locations/profile/sections/related-businesses-section.tsx
- components/editors/editor-footer.tsx (SHARED, opt-in `reviewPending`; callers: hours-tab.tsx, menu-tab.tsx, app/design-system/ux-p02-demo.tsx)
- tests/components/profile-editor.test.tsx
- tests/components/editor-footer.test.tsx
