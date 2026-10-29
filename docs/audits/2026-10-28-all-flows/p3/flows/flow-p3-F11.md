# p3-F11 — Listing lifecycle and danger-zone actions

Code: `/tmp/naba-presence-p3` @ `e4123d25` (branch `ux/flows-presence-p3`). Read-only analysis.

## 1. Flow

- **ID / name:** p3-F11, transfer a listing to another Google account, or request its deletion on Google, from the People area's danger zone.
- **Goal:** prepare a saved review, approve it (a second person if required), send it once, then read a server-confirmed outcome. If the location has left this account, say so.
- **Start:** `/listings/[id]/people` (`app/(dashboard)/listings/[id]/people/page.tsx:20-34` → `AreaEditor area="people"` → `AccessTab`, `components/locations/administration/administration-tab.tsx:391-510`). The danger zone is the last section (`administration-tab.tsx:502`, `danger-zone.tsx:87-159`).
- **End:** a `LifecycleOutcome` panel with the shared outcome notice (`lifecycle-outcome.tsx:37-103`). After an independently confirmed deletion, or a transfer that left the account, the page shows the "ended" alert (`administration-tab.tsx:278-297`) and every write is gated (`administration-tab.tsx:207-214`).
- **Roles:** owner and admin only. `canEditCanonical` is the owner/admin check (`lib/contracts/location-capabilities.ts:54`). Other roles see `AdministrationDenied` (`administration-tab.tsx:222-230`). The routes enforce `roles: ["owner","admin"]`, and approve, execute and refresh also need `mfa: "step_up"` (`app/api/locations/[id]/administration-lifecycle-reviews/route.ts:13`, `[reviewId]/route.ts:12`, `[reviewId]/execute/route.ts:13,16`). Approving and sending also need `canPublish` (`lifecycle-workspace.tsx:81`).

## 2. Code map

| Piece                                                                       | Where                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Danger zone rows and the two prepare dialogs                                | `components/locations/administration/danger-zone.tsx:26-250`                                                                                                                                   |
| Workspace: context, focus key, saved-work list, `ended` derivation          | `lifecycle-workspace.tsx:30-103` (`ended` at :44-56)                                                                                                                                           |
| State machine: preview, open, approve, execute, check, refreshReview, reset | `use-lifecycle.ts:26-110` (error and block handling in `run` at :52-62)                                                                                                                        |
| Review panel (summary, expiry, consent, typed name, send bar)               | `lifecycle-review.tsx:44-252`                                                                                                                                                                  |
| Outcome panel                                                               | `lifecycle-outcome.tsx:9-104`                                                                                                                                                                  |
| Ended derivation and copy                                                   | `lifecycle-ended.ts:15-57`                                                                                                                                                                     |
| Ended alert; lifecycle reason feeding `publishReason`                       | `administration-tab.tsx:207-214, 245, 278-297`                                                                                                                                                 |
| Per-row gate note                                                           | `context.tsx:71-74` → `components/locations/publish-gate.tsx` `GateNote`                                                                                                                       |
| API client                                                                  | `lib/api/google-lifecycle.ts:6-27`                                                                                                                                                             |
| Server preview and eligibility (one generic message for every reason)       | `lib/server/google-lifecycle-reviews.ts:17-20, 24-31`; reasons in `lib/domain/google-lifecycle.ts:16-27`                                                                                       |
| Shared pieces used (not changed)                                            | `components/reviewed-write/{panel,outcome-summary,consent,send-bar,saved-work-list,expiry}.tsx`, `components/ui/typed-confirmation.tsx`, `components/ui/dialog.tsx`, `components/ui/field.tsx` |
| Header chip for the ended state                                             | `lib/listings/area-state.ts:232-233` ("Deleted from Google" / "Moved to another account")                                                                                                      |

**Tests**

- e2e `tests/e2e/lifecycle-backend.spec.ts`: "separate review, approval and transfer/deletion send with saved recovery" (:131); "accepted deletion with forbidden read stays unresolved until independent recovery" (:136); "keeps transfer acknowledgement unknown after an independently confirmed applied write" (:179); "blocks destination role drift after approval without sending" (:205); "restores a lost lifecycle response from the database without a resend" (:232); "blocks expired approval before a provider write" (:268); "fits the prepare dialog, review, approval, outcome and saved outcome" at each `LAYOUT_WIDTHS` (:300).
- e2e `tests/e2e/listings.spec.ts:778`: "access danger zone: a reviewed deletion stays unsendable until approved, named and consented".
- e2e `tests/e2e/gbp-management-tabs.spec.ts:1289`: "Access tab humanises admin roles and gates delete behind a separate review".
- e2e `tests/e2e/administration-access-recovery.spec.ts:69-72` (danger buttons disabled while access is unresolved); `administration-access-backend.spec.ts:111` (captures `danger-zone-heading`).
- Unit: `tests/components/lifecycle-workflow.test.tsx` (:46-199), `tests/components/access-tab.test.tsx` (:135, :158, :177, :240, :340, :356, :369), `tests/components/administration-sections.test.tsx` (:389-453), `tests/listing-lifecycle-ended.test.ts`.

## 3. Steps today

1. **Initial.** The People page loads the roster. At the bottom is "Danger zone" with the description "Review an exact lifecycle request before approval and sending. Google may reject a request, and NabaPresence cannot undo an accepted deletion." (`danger-zone.tsx:95`). It has three rows:
   - "Transfer this location", button "Transfer this location"
   - "Remove from NabaPresence", a link to Connections with no button
   - "Request deletion on Google", button **"Delete this location"** (`:98-158`)
     Buttons are disabled when `writeBlocked`, when the name is missing, or while busy or unresolved (`:50-55`). Only `publishReason` is explained (`SectionGateNote`).
2. **Transfer input.** The dialog reads "Choose an exact destination account, then review current access and the frozen transfer. This step sends no provider write." (`:170-171`). One field, "Destination Google account", placeholder `accounts/…`. As soon as anything typed fails to parse, the field shows "Select an exact Google account resource, such as accounts/123." (`:182-186`). A bare `123456789` is rejected (`normaliseAccountName` only fixes the prefix's case, `lib/locations/forms/administration.ts:31-36`). The dialog warns before discarding a typed value (`dirty`, `:163`). Submit: "Continue to transfer review".
3. **Deletion dialog.** Title "Review managed-location deletion" (the review panel uses the same title). It does not name the listing. It says no deletion is sent at this step and has one button, "Prepare deletion review" (`:218-247`).
4. **In progress.** The button shows `pending={workflow.busy}`. `run()` claims a single in-flight action (`use-lifecycle.ts:52-55`).
5. **Preview error.** Every eligibility failure returns the same text: "Google has not confirmed the access, exact account membership or eligibility needed for this lifecycle request. Refresh before reviewing again." (`google-lifecycle-reviews.ts:19`). This includes `destination_matches_source`, `deletion_eligibility_unproven` and `source_ownership_required`. The dialog shows `workflow.error` (`danger-zone.tsx:201-205, 229-233`), and the same `role="alert"` also appears at the top of the page behind the modal (`lifecycle-workspace.tsx:79`). The failure also sets `block` (`use-lifecycle.ts:58`).
6. **Review.** The dialog closes and focus moves to the review panel at the top of the page (`lifecycle-workspace.tsx:59-67, 78-81`). The panel shows the summary, expiry, a deletion caveat, a second-approver note and "Approve lifecycle request". "Keep this location unchanged" resets (`lifecycle-review.tsx:139-249`).
7. **Send.** After approval, the panel shows the consent checkbox "Send this exact approved lifecycle request to Google." and the typed listing name. The SendBar status explains readiness (`:125-137, 193-223`). "Send approved transfer/deletion" is enabled only when the request is approved, the name matches exactly, the box is ticked, and nothing is stale, expired or unresolved.
8. **Stale or expired.** The panel says why ("destination's access changed…", "has expired…") and offers "Start a fresh review" (`:27-42, 165-180`).
9. **Unknown response.** "The send response is unavailable. Read the saved outcome before another lifecycle write." The only action is "Read saved lifecycle outcome" (`:187-192, 225-232`).
10. **Server-confirmed outcome.** The panel is titled "Saved lifecycle outcome". The shared notice shows Google's answer, the independent check and the time checked, followed by the observed effect (`lifecycle-outcome.tsx:9-15`). Actions are "Read saved lifecycle outcome", "Refresh lifecycle observation" and "Review another lifecycle action" (`:72-92`).
11. **Ended.** A destructive alert "This location was deleted from Google" or "…moved to another Google account", plus the reason and a stale-roster note (`administration-tab.tsx:286-294`). The same long reason repeats under both danger rows through `SectionGateNote` (`danger-zone.tsx:105,145`, fed by `administration-tab.tsx:208-209,245`). The alert has no actions.
12. **Saved work (empty, loading, error).** "Saved lifecycle work" list with load, error, reload and load-more states (`lifecycle-workspace.tsx:84-101`). The error copy separates network failures from 403s (`:23-28`).

## 4. Protected rules for this flow

- Owner/admin only, on the client (`lifecycle-workspace.tsx:39`, `administration-tab.tsx:222`) and on the server (routes above). Approve, execute and refresh need MFA step-up.
- Preview never writes to Google. Approval is a separate step. A second approver applies when `requiresSecondApprover` is set, and Approve is disabled unless `canApprove` (`lifecycle-review.tsx:181-186, 235`).
- Sending needs approval, the exact typed name and consent. The typed name is client-side friction only (`lifecycle-review.tsx:88-91`). The server binds the send to `payloadHash` (`use-lifecycle.ts:80,85`).
- One action at a time (`claim`). An outcome that is unresolved, pending or still being reconciled locks out another write (`use-lifecycle.ts:32,48,67,73`). A resend is never offered while the answer is unknown.
- "Ended" counts only an independently **confirmed** postcondition (`lifecycle-ended.ts:18-41`). An unknown answer is "not confirmed", never "failed" (`outcome-summary.tsx:32-47`).
- A confirmed outcome invalidates the listing summaries and capabilities (`use-lifecycle.ts:41-51`).

## 5. Prior audit status

- No LST/DSK finding covers the danger zone or lifecycle screens directly. LST-26 (invite flow) belongs to the access flow, not this one.
- **RC-COPY** (`findings.md:142-146`) names "lifecycle" as internal vocabulary. The only member fixed for that word is LST-24 (posts timeline, `results.md:231`). Here "lifecycle" is still in the section description, the Approve button, the consent label, the outcome title and actions, the saved-work list and the gate reasons. **Open** (see F8).
- P09 `TypedConfirmation` input hints: done. A test asserts the identifier hints (`lifecycle-workflow.test.tsx:68`).
- Follow-up 29 (People mobile LCP and JS over budget, `results.md:523,665-666`) is performance work and out of scope here.

## 6. Friction

| #   | Problem                                                                                                                                                                                                                                                                                                                                        | Evidence                                                                                                                                                                             | Sev | Heuristic / WCAG                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | --------------------------------------------------- |
| F1  | A failed preview never says why or what to do. Typing the source account itself, lacking source ownership, or Google refusing deletion all show one generic sentence that ends "Refresh before reviewing again", and the dialog has no refresh control.                                                                                        | `google-lifecycle-reviews.ts:19`; codes in `google-lifecycle.ts:17-25`; shown verbatim via `use-lifecycle.ts:59` → `danger-zone.tsx:201-205,229-233`                                 | P1  | N9 recover from errors; WCAG 3.3.3 error suggestion |
| F2  | A failed preview of a _new_ request marks the _currently open_ review stale with a wrong reason. With a deletion review open, a transfer preview that fails with `destination_access_unproven` makes the deletion panel say "The destination account's access on Google changed…" and blocks its send.                                         | `use-lifecycle.ts:58` sets `block` for any `run`, preview included; `lifecycle-review.tsx:35-41,165-180`; the dialog stays openable while a review is open (`danger-zone.tsx:50-55`) | P2  | N1 system status; N5                                |
| F3  | Dialog errors are not tied to the dialog's own attempt. Reopening a dialog shows an earlier, unrelated error. The same `role="alert"` also sits behind the modal and stays after it closes. A destination error is not tied to the field.                                                                                                      | `danger-zone.tsx:201,229` render `workflow.error` (cleared only at the next `run` or `reset`, `use-lifecycle.ts:54,108`); `lifecycle-workspace.tsx:79`                               | P2  | N1; WCAG 3.3.1, 4.1.3                               |
| F4  | The button says "Delete this location" on a row titled "Request deletion on Google" and opens a step that deletes nothing. Neither dialog names the listing it acts on.                                                                                                                                                                        | `danger-zone.tsx:138,155,168,221`                                                                                                                                                    | P2  | N2 match; N5 error prevention                       |
| F5  | The destination field asks for a raw `accounts/…` resource. A bare ID fails, and the error says "Select" for a text box and fires on the first keystroke. The copy uses jargon ("frozen transfer", "provider write").                                                                                                                          | `danger-zone.tsx:170-171,184,195`; `lib/locations/forms/administration.ts:31-36`                                                                                                     | P2  | N2; N5; WCAG 3.3.2                                  |
| F6  | The ended state is a dead end: the alert has no next step (unlink in Connections, open the saved outcome). The deletion title drops the caveat the outcome states ("Search/Maps removal … not confirmed"). The long reason appears three times on the page.                                                                                    | `administration-tab.tsx:286-294` (no `AlertActions`); `lifecycle-outcome.tsx:13`; `danger-zone.tsx:105,145` via `administration-tab.tsx:208-209,245`                                 | P2  | N3 user control; N8; N9                             |
| F7  | Some disabled states give no reason or the wrong one. The danger buttons are disabled silently when the listing name hasn't loaded, although the code comment says "Each blocked row says why". The SendBar says "Sending is paused until the other Google change is resolved." when the cause is `!canPublish` or capabilities still loading. | `danger-zone.tsx:52,86`; `lifecycle-workspace.tsx:81` (`disabled={!canPublish \|\| accessBlocked}`) → `lifecycle-review.tsx:129-130`                                                 | P3  | N1; N9                                              |
| F8  | Internal word "lifecycle" at the point of consent, plus two near-identical outcome actions ("Read saved lifecycle outcome" vs "Refresh lifecycle observation") whose difference (reload the saved record vs ask Google again) is not stated.                                                                                                   | `danger-zone.tsx:95`; `lifecycle-review.tsx:195,239`; `lifecycle-outcome.tsx:14,41,77,84,91`; `lifecycle-workspace.tsx:24,73,86-87`; `administration-tab.tsx:211-213`                | P3  | N2; RC-COPY                                         |
| H1  | **Hypothesis:** the review opens at the top of the page while its trigger sits at the very bottom. Focus follows (`focusKey`), but sighted users at 320px may lose their place.                                                                                                                                                                | `lifecycle-workspace.tsx:78-83` vs `administration-tab.tsx:502`                                                                                                                      | —   | HIG preserved context                               |

## 7. Proposed changes

### C1 — Explain a failed preview inside its dialog, next to the field, without touching the open review (F1, F2, F3) — P1

- **`use-lifecycle.ts`** (area-local):
  - `run(work, { scoped = false } = {})`. When `scoped`, skip `setError` and `setBlock`/`setBlockedAt` in the catch. Still rethrow, still `setBusy(false)` and `invalidate()`.
  - `preview(request, options?: { scoped?: boolean })` passes `options` to `run`.
  - `refreshReview` stays unscoped, so "Start a fresh review" keeps today's in-panel behaviour.
- **`lifecycle-workspace.tsx:62`**: the wrapper forwards the option: `preview: async (request, options) => { await workflow.preview(request, options); setOpened(...) }`.
- **`danger-zone.tsx`**:
  - Add local `const [problem, setProblem] = useState<{ field?: string; message?: string } | null>(null)`. Clear it when either dialog opens and on every destination change.
  - Call `workflow.preview(req, { scoped: true })`. In each `catch`, call `setProblem(previewProblem(error, parsed.data))`.
  - Delete both `workflow.error` blocks (`:201-205`, `:229-233`). Render `problem.field` through `<Field error>`, which wires `aria-invalid` and `aria-describedby`. Render `problem.message` as `<p role="alert">`.
  - Add a local `previewProblem` map. Each 409 code appends " No review was saved, and nothing was sent to Google." (true: `requireEligibility` throws before `saveGbpChangeSet`, `google-lifecycle-reviews.ts:24-31`).

  | Code                                                   | Shown as | Copy                                                                                                                          |
  | ------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
  | `destination_matches_source`                           | field    | "This is the account the location is in now. Enter the account it should move to."                                            |
  | `destination_access_unproven`                          | field    | "The connected Google login couldn’t fully read {dest}. Check the account ID and that the login can open that account."       |
  | `destination_management_required`                      | field    | "The connected Google login needs owner or manager access to {dest} before the location can move there."                      |
  | `destination_already_contains_location`                | field    | "{dest} already holds this location."                                                                                         |
  | `source_ownership_required`                            | message  | "Only an owner of the Google account that holds this location can transfer it, and the connected login isn’t an owner there." |
  | `deletion_eligibility_unproven`                        | message  | "Google doesn’t list this location as one the connected login can delete."                                                    |
  | `source_access_unknown` / `source_membership_unproven` | message  | "Google didn’t confirm that the connected login manages this location’s account."                                             |
  | anything else                                          | message  | `ApiClientError.message`, or "We couldn’t prepare the review. Nothing was sent to Google. Try again."                         |

- **Benefit:** a specific, fixable reason in the place the user is looking. The open review stays truthful, and errors don't go stale.
- **Principle:** N9, N1; WCAG 3.3.1, 3.3.3.
- **Risk to protected behaviour:** none. Server checks, the single-flight claim, invalidation, and the error and block handling for approve, execute, check, open and refreshReview are unchanged. Only how preview errors are presented changes.
- **Tests:**
  - Add to `tests/components/lifecycle-workflow.test.tsx`: "explains a destination the connected login can’t manage against the field, and leaves an open deletion review sendable". Stub preview with 409 `destination_management_required`, assert the field has `aria-invalid` and the copy, and assert the review panel has no "changed since this review".
  - Add a case for `deletion_eligibility_unproven`.

### C2 — Name the destructive actions honestly and make the destination field forgiving (F4, F5) — P2

All changes are in `danger-zone.tsx`.

Copy:

| Where                          | Before                                                           | After                                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deletion row button (`:155`)   | "Delete this location"                                           | "Request deletion"                                                                                                                                                                                                                                |
| Deletion dialog title (`:221`) | "Review managed-location deletion"                               | `Request deletion of ${section.locationName}`                                                                                                                                                                                                     |
| Deletion dialog description    | (current text)                                                   | "NabaPresence checks with Google that this location can be deleted, then saves a review for approval. Nothing is deleted or sent to Google at this step. Even after deletion, the business and its customer reviews may stay on Search and Maps." |
| Transfer dialog title (`:168`) | "Transfer this location"                                         | `Transfer ${section.locationName} to another Google account`                                                                                                                                                                                      |
| Transfer dialog description    | (current text)                                                   | "Enter the Google Business Profile account to move this location to. NabaPresence checks access in both accounts and saves a review for approval. Nothing is sent to Google at this step."                                                        |
| Section description (`:95`)    | (current text)                                                   | "Each request is checked with Google, saved as a review, approved, and only then sent. Google may reject a request, and NabaPresence can’t undo an accepted deletion."                                                                            |
| Field error                    | "Select an exact Google account resource, such as accounts/123." | "Enter an account ID such as accounts/123456789 or 123456789."                                                                                                                                                                                    |

Field behaviour:

- Add `<FieldDescription>`: "The account ID, for example accounts/123456789 or just 123456789."
- Before `googleAccountNameSchema.safeParse`, map a bare `/^[A-Za-z0-9_-]+$/` to `accounts/${value}`. The payload is still validated by the same schema and has the same shape.
- Show the format error only after blur or a submit attempt (local `touched` state).

Unchanged: "Prepare deletion review", "Continue to transfer review", and the review-panel title "Review managed-location deletion" (`lifecycle-review.tsx:142`).

- **Benefit:** the control says what it does. The listing name is in the dialog title as a wrong-listing guard. The field accepts the ID people actually copy.
- **Principle:** N2, N5; WCAG 3.3.2.
- **Risk to protected behaviour:** none. Copy and local parsing only, and the contract schema is unchanged.
- **Tests to update:**
  - "Delete this location": `access-tab.test.tsx:353`, `administration-access-workflow.test.tsx:124,149`, `administration-sections.test.tsx:389,398`, `lifecycle-workflow.test.tsx:34,79,169`, `e2e/listings.spec.ts:792`, `e2e/gbp-management-tabs.spec.ts:1309`, `e2e/administration-access-recovery.spec.ts:72`, `e2e/lifecycle-backend.spec.ts:37`.
  - Dialog name: `gbp-management-tabs.spec.ts:1310`.
  - Error copy: `administration-sections.test.tsx:442,453`.
  - Add a test that `123456789` enables "Continue to transfer review" and previews `accounts/123456789`.

### C3 — Give the ended state a way forward and say it once (F6, F7 first half) — P2

**`administration-tab.tsx` `AccessNotice` (:286-294)**, when `ended`:

- For deletions only, add after the reason: "It may still appear on Search or Maps."
- Add `<AlertActions>` with two links:
  - `<Link href="/settings/connections" className={buttonVariants({ variant: "outline", size: "sm" })}>Remove from NabaPresence</Link>`. This is the same destination as the danger row's link.
  - `<a href="#lifecycle-saved-work" className={buttonVariants({ variant: "ghost", size: "sm" })}>See the saved outcome</a>`. `SavedWorkList` already renders a heading with that id.
- Keep `lifecycleEndedTitle`, which matches the header chip at `lib/listings/area-state.ts:232`.

**`danger-zone.tsx`**: replace both `<SectionGateNote />` calls with a local `DangerGateNote`:

- `workflow?.ended` → `<GateNote reason="Not available: this account no longer manages this location." />`
- `!section.locationName` → `<GateNote reason="Not available until the listing name loads. Reload the page if this stays." />`
- otherwise `<SectionGateNote />`

- **Benefit:** a clear next step after an irreversible outcome. The caveat matches the outcome panel, the page loses two repeated paragraphs, and no button is disabled without a reason.
- **Principle:** N3, N9, N8; HIG consistent feedback.
- **Risk to protected behaviour:** none. Navigation links only; every gate and `publishReason` is unchanged.
- **Tests:**
  - Extend `access-tab.test.tsx:340` "explains a confirmed deletion…": assert the "Remove from NabaPresence" link goes to `/settings/connections`, the "See the saved outcome" link goes to `#lifecycle-saved-work`, `getAllByText(/independently confirmed that this location was deleted/)` has length 1, and the row note is visible.
  - Add a case where the name is empty and the note shows.

### C4 — Accurate send-paused reason and plain outcome wording (F7 second half, F8) — P3

**`lifecycle-review.tsx`**: add the prop `disabledReason?: string | null` and use it in `sendStatus` instead of the fixed "Sending is paused…" line.

**`lifecycle-workspace.tsx:81`** passes the reason:

| Condition                  | Reason                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `accessBlocked`            | "Sending is paused until the access change above is resolved."                     |
| capabilities still loading | "Checking your permissions…"                                                       |
| `!canPublish`              | "Your current permissions don’t allow sending changes to Google for this listing." |

Copy:

| Where                                                     | Before                                                  | After                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `lifecycle-review.tsx:239`                                | "Approve lifecycle request"                             | `Approve ${transfer ? "transfer" : "deletion"} request`                             |
| `lifecycle-review.tsx:195`                                | "Send this exact approved lifecycle request to Google." | `Send this approved ${op} request to Google.`                                       |
| `lifecycle-outcome.tsx:41`                                | "Saved lifecycle outcome"                               | `${transfer ? "Transfer" : "Deletion"} outcome`                                     |
| `lifecycle-outcome.tsx:77` and `lifecycle-review.tsx:231` | "Read saved lifecycle outcome"                          | "Reload saved outcome"                                                              |
| `lifecycle-outcome.tsx:84`                                | "Refresh lifecycle observation"                         | "Check Google again"                                                                |
| `lifecycle-outcome.tsx:91`                                | "Review another lifecycle action"                       | "Back to people" (parallels access "Back to access")                                |
| `lifecycle-outcome.tsx:14`                                | (current text)                                          | "Google hasn’t confirmed the result yet. Check Google again before another change." |
| `lifecycle-workspace.tsx:86`                              | "Saved lifecycle work"                                  | "Saved transfer and deletion requests"                                              |
| `lifecycle-workspace.tsx:73`                              | "Open lifecycle outcome/review"                         | "Open outcome" / "Open review" (the row title already names the operation)          |
| `lifecycle-workspace.tsx:24`                              | "Saved lifecycle work could not be loaded."             | "Saved transfer and deletion requests couldn’t be loaded."                          |
| `administration-tab.tsx:211`                              | "A lifecycle action…"                                   | "A transfer or deletion request is in progress…"                                    |
| `administration-tab.tsx:213`                              | (current text)                                          | "Check the saved transfer or deletion outcome before another Google change."        |

- **Benefit:** the stated reason matches the real blocker, the consent wording is plain, and the two outcome actions are distinguishable.
- **Principle:** N2, N1; RC-COPY.
- **Risk to protected behaviour:** none. Labels only; handlers and enablement are unchanged.
- **Tests:** string updates in `lifecycle-workflow.test.tsx`, `access-tab.test.tsx`, `administration-sections.test.tsx:407`, `e2e/lifecycle-backend.spec.ts` (:61, :117, :158, :168, :257), `e2e/listings.spec.ts:800-810`. Add one case: `canPublish:false` shows the permissions reason.
- **Do C4 last.** It has the most test churn and the lowest severity, and can be dropped if the integrator wants a smaller PR.

### Follow-ups (out of scope)

- Server: return the specific preflight message per code (`google-lifecycle-reviews.ts:19`). This is an API change, so C1 maps the codes client-side for now.
- Pick the destination from the connected Google accounts instead of typing an ID (needs a read endpoint or contract change).
- H1: open the review in place beside the danger zone, or in a sheet. This is a layout decision that also affects the access flow.

## 8. Screenshots to capture

1. `/listings/{loc}/people` (owner, widths 320 and 1280, full page, no interaction): danger-zone rows, the C2 labels and the section description.
2. The same route with the deletion dialog open (owner, 390): interaction needed (click "Request deletion"). Shows the listing name in the title and the honest description.
3. The same route with the transfer dialog after a 409 `destination_management_required` (owner, 390): interaction plus a stubbed fixture. Shows the C1 field error.
4. The ended state (owner, 390): needs a fixture with a confirmed deletion attempt, as in `access-tab.test.tsx:340`. Shows the C3 alert actions and the short row notes. If the visual fixture can't reach it, capture it from the e2e `lifecycle-backend` journey instead.

## 9. Files touched

components/locations/administration/danger-zone.tsx
components/locations/administration/use-lifecycle.ts
components/locations/administration/lifecycle-workspace.tsx
components/locations/administration/lifecycle-review.tsx
components/locations/administration/lifecycle-outcome.tsx
components/locations/administration/administration-tab.tsx
tests/components/lifecycle-workflow.test.tsx
tests/components/access-tab.test.tsx
tests/components/administration-sections.test.tsx
tests/components/administration-access-workflow.test.tsx
tests/e2e/lifecycle-backend.spec.ts
tests/e2e/listings.spec.ts
tests/e2e/gbp-management-tabs.spec.ts
tests/e2e/administration-access-recovery.spec.ts

No shared files change (`components/ui/*`, `components/reviewed-write/*`, `lib/*` are only imported). `administration-tab.tsx` is also part of the People-access flow, so check it for overlap with that flow's proposal.
