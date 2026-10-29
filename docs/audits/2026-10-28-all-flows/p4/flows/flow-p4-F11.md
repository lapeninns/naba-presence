# p4-F11: Start a verification (method, context, review, request)

Worktree `/tmp/naba-presence-p4` at `e4123d25`. I only read the code. I ran nothing: no dev server, browser or tests. Paths are relative to the repo. `adm/` = `components/locations/administration/`.

## 1. Start / end

- **Start:** `/listings/[id]/verification` (`app/(dashboard)/listings/[id]/verification/page.tsx:20-35`, `StreamedTab` + `AreaEditor area="verification"`), section "Start a new verification" (`adm/verification-tab.tsx:58-61`).
- **End (success):** the `ReviewedWritePanel` titled "Verification request outcome" with `VerificationAttemptStatus` ("Accepted by Google" / "Confirmed on Google", `adm/verification-start.tsx:47-50`, `adm/verification-attempt-status.tsx:35-47`). The PIN step that follows is p4-F12.
- **End (handoff):** an external or partner method shows "This method must be completed through Google…", and "Open Google Business Profile" is the only action (`adm/verification-start-form.tsx:72,74`).

## 2. Roles and gates

- **Page:** owner or admin only. Otherwise `AdministrationDenied` (`adm/verification-tab.tsx:25`), and the area nav hides Verification for member and viewer (`tests/e2e/listings.spec.ts:300`).
- **Write gate (`writeReason`, `adm/verification-tab.tsx:32-42`):** needs `canEditCanonical && canPublish`, `resources.administration`, `resourceDisabledReason` and a readable Google state. When closed:
  - a top Alert "Verification changes are paused" shows (`:80`);
  - `SectionGateNote` sits under the form (`adm/verification-start.tsx:76`);
  - discovery still works but "Review verification request" is disabled (`adm/verification-start-form.tsx:72`, `blocked`).
- **API:** every route requires `roles: ["owner","admin"]`: `app/api/locations/[id]/verification-options/route.ts:13,20`, `verification-reviews/route.ts:10`, `[reviewId]/route.ts:9,12`, `[reviewId]/execute/route.ts:9,12,15`.
- **Step-up MFA:** `mfa: "step_up"` applies only to approve (`[reviewId]/route.ts:12`) and to execute and refresh (`execute/route.ts:12,15`). The client gets a 403 and `MFA_STEP_UP_EVENT` opens the prompt (`lib/api/client.ts:260-283`).
- **Two-person:** `requiresSecondApprover` and `canApprove` come from `secondApproverSatisfied` (`lib/server/gbp-change-sets.ts:50-51`, `lib/server/authz/approval-policy.ts:129,137`). The server enforces it at `gbp-change-sets.ts:153`.
- **Workspace mutex:** only one verification workflow (start or PIN) can be active; `use-verification-action.ts:31,45-46`. It adds the "Continue approved verification start" step (`adm/verification-start-review.tsx:169-177`).

## 3. Baseline steps (visual fixture: owner, verified listing, single approver, one EMAIL option)

0. Open the page. The status card leads; the start form sits inside the closed "Verification tools" disclosure (`adm/verification-tab.tsx:81-89`).
1. Tap **Verification tools**.
2. Scroll past the PIN section, then tap **Check available methods** (`verification-start-form.tsx:51`).
3. Tap the **Email** choice card (`:58-65`). The username is prefilled and editable (`:60,66`).
4. Tap **Review verification request** (`:72`). This POST creates and audits a change set, and focus moves to the review panel (`verification-start.tsx:47-49`).
5. Tap **Approve verification request** (`verification-start-review.tsx:161-167`). Step-up MFA may add about 2 more actions plus a repeat Approve.
6. Tick **Send this exact approved verification request to Google.** (`:185-190`).
7. Tap **Send approved verification request** (`:205-210`).

That is **7 taps minimum** (10+ with MFA). With a private service-business address, add 1 tick and 3+ typed fields, then a second "Check available methods".

## 4. States (file:line)

**Methods offered** (`lib/contracts/google-verification-options.ts:24-30`):

- `email` (EMAIL): username editable only if Google allows it. Hint "Google fixes the domain to @{domain}. You may change the username." or "…Google has not allowed username edits." (`verification-start-form.tsx:66`).
- `phone` (PHONE_CALL, SMS): read-only "Eligible phone destination", hint "Use this exact Google-offered destination. Correct the business profile first if it is wrong." (`:67`).
- `address` (ADDRESS): "Postcard contact name", hint "Who should receive Google's postcard at the displayed address?", plus "Google estimates N days for delivery." or "Google has not supplied a delivery estimate." (`:68-71`).
- `auto` (AUTO): destination text "Google offers automatic verification for this listing." (`lib/locations/forms/verification.ts:30`).
- `external`: handoff only (`:72`).
- An unknown method is named "Another Google method" and shows "Google method code: X" (`verification-method.tsx:13,33-44`).

**Before discovery:**

- Intro: "Check the methods Google currently offers, review the exact destination, then approve before sending a request." (`:45`).
- Checkbox "Provide a private service-business address" (`:46`). Ticking it shows a Fieldset with 10 fields (`verification-context-fields.tsx:94-188`):
  - Street address (textarea, "One address line per line; up to five.")
  - Town or city, County or region, Postcode, Neighbourhood, Organisation
  - Address recipients ("Optional; one recipient per line.")
  - Country code ("United Kingdom. Two-letter country code.")
  - Address language, Sorting code
- "Verification language" is a free-text BCP-47 tag with hint "Google writes its message in British English. Change the language tag only if needed, for example en-GB or cy." (`:48-49`).

**Validation (exact copy):**

- Any invalid input (including the empty street line right after ticking the box, because the default is `addressLines: [""]`, `:46`, and the schema needs `min(1)`, contracts `:13`) shows a status line: "Enter a valid language and, if supplied, country and street address before checking methods." (`:50`). It names no field, sets no `aria-invalid`, and appears immediately.
- Disabled "Review verification request" gives no reason when the username is empty, the postcard contact is empty, `needsContext` is true or `blocked` is true (`:72`).
- `needsContext` (`:33`) adds the status "Google has not confirmed that a private service-business address is unnecessary. Provide the address and check methods again before reviewing a request." (`:55`).
- No methods: "Google returned no methods for this check. Use Google Business Profile for further instructions or check again later." (`:56`).

**Discovering:** button pending "Checking methods…" (`:51`), and all inputs are locked (`:28`). Failure: "Verification methods could not be checked. Reconnect if needed, then try again. No verification request was sent." (`:41`). The same generic copy is used for every error code.

**Review** (`verification-start-review.tsx`):

- Lead line: "Review this exact request. Approval does not send it to Google. A successful start request does not mean verification is complete." (`:136-139`).
- Summary rows: Listing, Method, Destination, Postcard contact, Private service-business address, Message language, plus a technical tag (`:99-133`). Then `Expiry` (`:141-146`).
- Unapproved: "Approve the exact destination and context before sending." or, for two-person, "A different authorised owner or admin must approve this exact request. They can find it under Saved verification requests." (`:157-159`).
- Approved: "This request is approved." (`:183`). SendBar statuses (`:194-203`):
  - "Confirm the exact approved request before sending."
  - "Send only this exact approved request to Google."
  - "Sending is unavailable. Resolve the review or access issue before continuing."
- Secondary actions: "Check saved request outcome", "Back to methods" (`:220-227`), and "Refresh exact review" (`verification-start.tsx:70`).

**Submitting:** "Request action in progress. Wait for a response." (`:195`).

**Error and retry:**

- Expired: "This approval has expired and the request can no longer be sent." or "This review has expired.", followed by "Check available methods and create a fresh review." (`:147-153`).
- Unknown send: "The result of sending this approved request is unknown. Check the saved outcome before any other action." (`:181-182`) and "The response was unavailable. Check the saved outcome before taking another action; do not start a replacement request." (`:214-219`).
- Fresh review needed: "This request needs a fresh review. Check its saved outcome before replacing an uncertain send; otherwise return to methods." (`verification-start.tsx:69`).
- Mapped codes are in `use-verification-action.ts:9-21`. Anything else shows "This action could not finish. Check access, connection and the exact saved review or outcome before trying again." (`:36`).

**Success:** "Confirmed on Google". The effect line is "An independent read of Google matches this exact request. Its phase and your merchant standing are below." Rows are "Verification request phase" and "Merchant standing", and the note reads "Request phase and merchant standing are separate…" (`verification-attempt-status.tsx:35-47,69-100`).

## 5. Protected rules (do not change)

- **Server authority on eligibility:** preview re-discovers options and rejects a changed choice (`lib/server/google-verification-reviews.ts:19-36`); context is required only when `customerLocationOnly === true` (`:24`) and rejected unless it is true (`lib/server/google-verification-options.ts:37-40`).
- **Baseline hash.** One eligibility and state baseline is shared by approve and execute (`google-verification-reviews.ts:32,73-80`). The private address is encrypted and never cached or audited (`:33`, `google-verification-options.ts:19`).
- **Idempotency.** There is one durable claim per approved review, and "No retry path sends a second provider request" (`lib/server/google-verification-execution.ts:123-147`): an existing attempt returns as idempotent (`:126-130`); `withVerificationLock` and `verification_in_progress` apply (`:90-95`); `blockUnresolved: true` is set (`:143`). The client mints `Idempotency-Key` intent ids (`lib/api/client.ts:312-318`, header at `:318`).
- **Pre-send refusals:** `verification_already_pending`, `verification_not_required` (verified listing) and `verification_state_unknown` (`execution.ts:136-138`).
- **Uncertain-send discipline on the client:** any send error is held as a "lost send" until the outcome is checked (`verification-start.tsx:52-57`); Back (`verification-start-review.tsx:224`) and Send (`:206`) are disabled while uncertain.
- **Two-person review and step-up MFA:** §2. The client's `canApprove` only mirrors the server.
- **Audit writes:** `google.change_set.reviewed` (`gbp-change-sets.ts:124`), `google.change_set.approved` (`:158`), `google.verification.requested`, `.rejected` and `.observed` (`execution.ts:145,158,119`).
- **Expiry:** `approval_expired` (`gbp-change-sets.ts:66`) and the client deadline (`verification-start-review.tsx:92-93`).

## 6. Audit status (15 Oct UX audit)

- **LST-09 (P1): fixed** in #119.
  - `verifiedAtRest` puts the PIN, start and history sections behind "Verification tools" (`adm/verification-tab.tsx:71-90`).
  - The headline reads "Verified. Google confirms you manage this listing." (`adm/verification-observation.tsx:57-61`).
- **Remaining (results.md, Phase 2 item 9):** "merchant standing" copy is still in `adm/verification-attempt-status.tsx:42,86,98`, which is this flow's success state. **Still open.**
- **Not covered by the audit:**
  - the start form is still fully usable on a verified listing inside the disclosure (see F2);
  - the `null` business-type dead end (F1).

## 7. Friction

**F1 (P1): an unknown business type is a dead end.**

- Evidence:
  - The client demands an address whenever `customerLocationOnly !== false` (`verification-start-form.tsx:33,55,72`).
  - The server sets it to `null` when `serviceArea.businessType` is absent or unspecified (`google-verification-options.ts:37`).
  - The server rejects any context unless it is `true`: 400 `verification_context_not_allowed` (`:38-40`; integration test `tests/integration/routes/standalone-verification-options.test.ts:99-106`).
  - So the user ticks the address box, checks again and gets the generic "could not be checked… Reconnect" error (`:41`). Review is never enabled.
  - Preview without context would be accepted for `null` (`google-verification-reviews.ts:24`).
  - The unit test enshrines the client behaviour (`tests/components/verification-start-form.test.tsx:48`, `it.each([true, null])`).
- Hypothesis: storefront pubs without a service area are the `null` case, so this may be the common real-world path.

**F2 (P1): a verified listing still walks the full start flow and fails at the last tap.**

- Inside "Verification tools", discovery, review and approve (with step-up MFA) all work. Execute then refuses with `verification_not_required` (`execution.ts:137`).
- The code is unmapped, so the user sees the generic "This action could not finish…" (`use-verification-action.ts:36`).
- The client also marks the send as uncertain: "The result of sending this approved request is unknown…" (`verification-start.tsx:53-55`). Back is disabled until "Check saved request outcome" is pressed.
- The e2e journey deliberately stops before Send for this reason (`tests/e2e/listings.spec.ts:772-776`).
- The page already knows the standing (`verification-tab.tsx:73-74`), but it does not pass it to `ReviewedStartVerification` (`:60`).

**F3 (P2): server refusals and the MFA prompt read as generic failure.**

- These codes are unmapped (`use-verification-action.ts:9-21`):
  - `verification_already_pending`, `verification_state_unknown`, `verification_in_progress`, `verification_context_required`
  - `mfa_step_up_required`, `mfa_enrollment_required`
- On approve, the MFA prompt says "Try that again" while the inline alert says "Check access, connection…". The two messages conflict.
- Discovery maps nothing: `verification_context_not_allowed` and `verification_business_type_unavailable` both show "Reconnect if needed" (`verification-start-form.tsx:41`).

**F4 (P2): disabled Review with no reason, and a premature, non-specific validation line.**

- Evidence: `verification-start-form.tsx:50,72`.
- `VerificationTextField` never passes `error` to `Field`, although `Field` supports it (`components/ui/field.tsx:74-107`).
- WCAG 3.3.1 and 3.3.3 are not met for the email username and postcard contact.

**F5 (P3): ten address fields and a raw language tag up front.**

- Codes (Country code, Address language, Sorting code) sit at the same level as the street address (`verification-context-fields.tsx:72-186`).
- The message-language tag field sits above the main action (`verification-start-form.tsx:48-49`).
- Hypothesis: almost every UK user keeps `en-GB` and needs only street, town and postcode.

**F6 (P3): the success state still says "merchant standing"** (`verification-attempt-status.tsx:42,86,98`). This is the audit residual.

**F7 (P3, protected, no change proposed):** 3 taps between review and send (Approve, consent, Send), plus "Continue approved verification start" when the other workflow was last active. This is the reviewed-write pattern. Leave it.

## 8. Proposed changes

**C1 (F1): align the client with the server on when an address is required.**

- Problem: an unknown business type blocks Review, and the server forbids the address that would unblock it.
- Change, in `adm/verification-start-form.tsx`:
  - `:33` becomes `const needsContext = options?.customerLocationOnly === true && !input.context`.
  - `:55` copy becomes "Google lists this business as visiting customers only. Add the private address and check methods again before reviewing a request."
  - In `discover()` (`:39-41`), map `ApiClientError` code `verification_context_not_allowed` to "Google doesn't need a private address for this business. Untick the address and check methods again. No verification request was sent."
- Benefit: removes the dead end. The server still decides (preview checks `=== true`).
- Principles: Nielsen #5 and #9; WCAG 2.2 SC 3.3.3.
- Not shared. **Needs an owner decision:** the existing test treats `null` as "requires address".

**C2 (F2): say up front that a verified or pending listing cannot start a new request.**

- Change:
  - `adm/verification-tab.tsx:60` passes `standing={verifiedAtRest ? "verified" : pendingRequest ? "pending" : null}`.
  - `adm/verification-start.tsx` forwards it to `VerificationStartForm`.
  - The form renders a `role="status"` line above "Check available methods":
    - verified: "Google already confirms you manage this listing, so it would refuse a new verification request."
    - pending: "A verification request is already pending. Enter its PIN or check it before starting another."
  - The form adds `standing !== null` to the Review `disabled` condition (`:72`). Discovery stays available, read-only.
- Benefit: no wasted approve, MFA and send sequence, and no false "result unknown".
- Principles: Nielsen #5; HIG Feedback.
- Not shared. This is a client hint only; the server check at `execution.ts:136-137` stays authoritative.

**C3 (F3): plain messages for the remaining codes.**

- Change: add to `messages` in `adm/use-verification-action.ts:9-21`:

  | Code                            | Message                                                                                                              |
  | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
  | `verification_not_required`     | "Google already confirms you manage this listing. No new request is needed."                                         |
  | `verification_already_pending`  | "A verification request is already pending with Google. Enter its PIN or check it first."                            |
  | `verification_state_unknown`    | "Google hasn't said a new verification can start here. Refresh Google state or continue in Google Business Profile." |
  | `verification_in_progress`      | "Another verification request is being checked or sent. Check its saved status."                                     |
  | `verification_context_required` | "Add the private service-business address, then check methods again."                                                |
  | `mfa_step_up_required`          | "Enter your two-step code, then try this action again."                                                              |
  | `mfa_enrollment_required`       | "Set up two-step sign-in, then try this action again."                                                               |

- Uncertain-send state logic stays unchanged (protected).
- Principle: Nielsen #9.
- **Shared with F12.** The PIN completion uses the same hook (`verification-completion.tsx`).

**C4 (F4): field-level errors and a visible reason for the disabled Review.**

- Change:
  - Add `error?: string` to `VerificationTextField` and pass it to `<Field error>` (`verification-context-fields.tsx:18-49`).
  - In the form, show errors after blur or after an attempted check:
    - "Enter an email username." on the username field (`:66`);
    - "Enter who should receive the postcard." on the postcard contact field (`:69`);
    - "Enter a language tag such as en-GB." on the language field (`:48`).
  - For the street address `Field`, pass `error="Enter the first line of the address."` when line 1 is empty after blur (`verification-context-fields.tsx:101`).
  - Replace the `:50` line with an error that names the field.
  - Add a caption with an id under the Review button for the active reason, referenced by `aria-describedby`. Keep the button disabled, as tests rely on that.
- Principles: WCAG 2.2 SC 3.3.1, 3.3.3 and 4.1.2; Nielsen #9.
- Flow-local. `Field` is used, not edited.

**C5 (F5): progressive disclosure for codes.**

- Change:
  - In `verification-context-fields.tsx:119-186`, keep Street, Town or city, County or region and Postcode visible.
  - Move Neighbourhood, Organisation, Address recipients, Country code, Address language and Sorting code into `<TechnicalDetails summary="More address details" list={false}>` (from `components/reviewed-write`).
  - Wrap the language field (`verification-start-form.tsx:48-49`) in `TechnicalDetails summary="Message language: British English"`.
- Principles: HIG progressive disclosure; Nielsen #8.
- Not shared. Check that the hidden inputs still work in tests (see §9).

**C6 (F6): remove "merchant standing" from the success state.**

- Change, in `verification-attempt-status.tsx`:
  - `:42` becomes "An independent read of Google matches this request. Its progress and whether Google confirms you manage the listing are below."
  - `:86` label becomes "Listing verification".
  - `:98` becomes "Request progress and listing verification are separate. Neither shows what customers see on Search or Maps."
- Principle: Nielsen #2.
- **Shared with F12** (PIN outcome).

## 9. Tests

**Existing assertions that the changes touch:**

- **C1:** `tests/components/verification-start-form.test.tsx:48-62` (`it.each([true, null])`) must split. `true` still requires the address. `null` should allow Review without it and show the not-allowed copy when context is sent. `:52` still asserts that radios clear on tick.
- **C2:** `tests/e2e/listings.spec.ts:725-777` reviews and approves on the verified journey listing. It would have to assert the new status line and a disabled "Review verification request" instead, and the `captureVerificationStart` journeys stay in `verification-start-backend.spec.ts` (unverified fixtures). `tests/components/verification-start.test.tsx` renders without `standing`, so no change if the prop is optional.
- **C3:** no test asserts the generic fallback text for these codes.
- **C4:** `tests/components/verification-start-form.test.tsx:43,51` assert `toBeDisabled()` and still pass. `tests/components/verification-start.test.tsx:203` types into "Verification language".
- **C5:**
  - `tests/components/verification-start-form.test.tsx:57` types into "Address recipients";
  - `:72-77` queries "Country code" by label and checks document order, and still passes;
  - `tests/e2e/verification-start-backend.spec.ts:31-39` fills Street, Town and Postcode, which stay visible;
  - the e2e test never touches the language field.
  - Verify that user-event typing works inside a closed `<details>` in jsdom. If it does not, open the disclosure in those two tests.
- **C6:** no test asserts "Merchant standing" or ":42/:98" copy. `tests/e2e/verification-pin-backend.spec.ts:82` asserts "Verification request phase", which stays.

**Copy left untouched (heavily asserted):** "Check available methods", "Review verification request", "Approve verification request", "Send approved verification request", the consent label "Send this exact approved verification request to Google.", "Approved verification request actions", "Check saved request outcome", "Refresh exact review", "Back to methods", /The response was unavailable/, /different authorised owner or admin/, /This method must be completed through Google/, "Open saved outcome", "Refresh saved outcome".

Sources: `verification-start-backend.spec.ts:28-519`, `verification-start.test.tsx:38-223`.

**New focused tests:**

- (a) form: `customerLocationOnly: null` enables Review with no address.
- (b) form: `verification_context_not_allowed` on discovery shows the untick copy.
- (c) start: `standing="verified"` shows the status line, keeps discovery enabled and disables Review.
- (d) hook: each new code maps to its message, and an MFA 403 on approve shows the two-step copy.
- (e) form: blur on an empty postcard contact gives `aria-invalid` and the error text; the Review caption is referenced by `aria-describedby`.
- (f) context fields: More address details is collapsed by default and the values are kept when it is expanded.

## 10. Screenshot states reachable in the visual fixture

- **Fixture facts:** owner session; `require_two_person_approval = false` (`tests/e2e/helpers/stub-bridge.ts:145`); `hasVoiceOfMerchant: true` (`:623-628`); `verifications: []` (`:632-638`); `businessType: CUSTOMER_AND_BUSINESS_LOCATION` (`:755-761`); one EMAIL option, `user: owner`, `@riverside.example`, editable (`:640-656`).
- **On load:** the listing is verified at rest, so the start form is **not visible**. It sits inside the collapsed "Verification tools" disclosure (`adm/verification-tab.tsx:81-89`) after the status card.

| #   | State                                                      | How to reach it                                                                                              |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | Status card plus closed disclosure                         | Load the page                                                                                                |
| 2   | Start form before discovery                                | Tap **Verification tools**; the start section is below the PIN section                                       |
| 3   | Address context Fieldset and the premature validation line | Tick the address box (no network needed)                                                                     |
| 4   | Methods checked: one Email card, editable username         | Check available methods; there is no `needsContext` note because the value is `false`                        |
| 5   | Review panel, unapproved                                   | Review verification request                                                                                  |
| 6   | Approved: consent unticked or ticked, SendBar status       | Approve (MFA prompt possible)                                                                                |
| 7   | Generic error plus "result unknown" (F2 evidence)          | Send. Server refuses with `verification_not_required`; this writes a review and an approval to `naba_visual` |

- **Not reachable here:** phone, address, auto, external and unknown methods; two-person copy; expired; accepted or confirmed outcome; the `null` business-type dead end. All need `tests/e2e/helpers/verification-backend.ts` fixtures (unverified, per-method, `CUSTOMER_LOCATION_ONLY` toggle at `:100-104`), via `verification-start-backend.spec.ts` and `captureVerificationStart`.
