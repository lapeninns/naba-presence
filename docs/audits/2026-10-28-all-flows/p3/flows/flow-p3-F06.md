# p3-F06 · Request Google-reviewed profile changes (services, attributes, service area, lodging, Google Ads phone)

Read-only analysis of `/tmp/naba-presence-p3` on `ux/flows-presence-p3` (head `e4123d25`). The core identity, contact and address fields belong to another flow and are left out here, except where this flow shares the editor's footer and validation summary.

## 1. Flow

- **ID / name:** p3-F06. Request Google-reviewed profile changes: services, attributes, service area, lodging, and the advertising and industry sections.
- **Goal:** change a Google-only part of the listing and get a server-confirmed outcome. These parts have no NabaPresence copy, so every change goes through review, then approval, then send.
- **Start:** `/listings/[id]/profile`, at `app/(dashboard)/listings/[id]/profile/page.tsx:20-34`. That route renders `ProfileTab` (`components/locations/profile/profile-editor.tsx:216`). The sections only appear once Google's half has loaded: `show: googleReady` at `:851,877`, attributes at `:930`, lodging at `:949` and services at `:952`.
- **End (server-confirmed):**
  - Service area, Google Ads phone and attributes: `CombinedReviewSheet` shows per-row results, followed by the toast "Business profile live on Google". If Google has only acknowledged the change, the toast is "…sent to Google" instead (`profile-editor.tsx:600-606`).
  - Services and lodging: `ReviewedChangeSheet` shows `OutcomeSummary`, which reads "Independently confirmed" only when Google confirms (`reviewed-change-sheet.tsx:250-256`, `reviewed-write/outcome-summary.tsx:38-47`). Lodging also shows the toast "Lodging details confirmed by Google" (`use-lodging-review.ts:75`).
  - Saved work can be finished later from the lists after the editor (`profile-editor.tsx:258-265`).
- **Roles:**
  - Owner and admin can edit (`canEditCanonical`, `lib/server/capabilities.ts:108,284`).
  - Sending needs `canPublish` and writes switched on (`services-section.tsx:123`).
  - Member and viewer get the read view with a view-only bar (`profile-editor.tsx:250-252,999,1020`).
  - In two-person mode, a _different_ owner or admin must approve.

## 2. Code map

| Piece                                                                                   | Where                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page shell, the saved-work column and the catalogue                                     | `profile-editor.tsx:216-271` (`ProfileTab`)                                                                                                                                                                                                                                       |
| Drafts for listing fields and attributes, the diff rows, issues, preview, publish steps | `profile-editor.tsx:321-381` (drafts), `:390-443` (rows), `:465-589` (steps), `:661-696` (issues), `:718-737` (`prepareReview` → `previewBusinessInformation` / `previewBusinessAttributes`)                                                                                      |
| Footer that routes between profile, services and lodging                                | `profile-editor.tsx:991-1022`                                                                                                                                                                                                                                                     |
| Service area                                                                            | `sections/service-area-section.tsx:25-97`                                                                                                                                                                                                                                         |
| Google Ads phone                                                                        | `sections/advertising-section.tsx:12-29`                                                                                                                                                                                                                                          |
| Attributes                                                                              | `sections/attributes-section.tsx:25-96` → `components/locations/typed-attribute-control.tsx:57-298`                                                                                                                                                                               |
| Services                                                                                | `sections/services-section.tsx:57-512`, `use-service-review.ts:14-84`, `service-workspace.tsx:20-71`, `service-approval-sheet.tsx`                                                                                                                                                |
| Lodging                                                                                 | `industry-sections.tsx:25-43` → `industry-editor.tsx` → `complete-lodging-section.tsx:15-56` → `lodging-editor.tsx`, `lodging-suggestions.tsx`, `lodging-review.tsx:10-31`, `use-lodging-review.ts:15-99`, `lodging-workspace.tsx:33-96`                                          |
| Review sheet shared by services and lodging                                             | `sections/reviewed-change-sheet.tsx:64-270` (area-local) on `reviewed-write/sheet.tsx`, `steps.tsx`, `consent.tsx`, `expiry.tsx`, `outcome-summary.tsx`, `summary-list.tsx` (SHARED)                                                                                              |
| Saved work                                                                              | `saved-listing-reviews.tsx`, `saved-attribute-reviews.tsx`, `saved-change-work.tsx:56-90` (`savedChangeItem`, area-local), `reviewed-write/saved-work-list.tsx` (SHARED)                                                                                                          |
| Retail catalogue handoff                                                                | `product-catalogue-handoff.tsx:11-21`                                                                                                                                                                                                                                             |
| Endpoints                                                                               | `lib/api/location-business-information.ts`: preview, approve, publish, confirm, reviews, `attribute_reviews`, services, `service_attempt`, service-workflows. `lib/api/location-industry.ts`: `previewLodging`, `approveLodging`, `publishIndustry`, `confirmIndustry`, workflows |

**e2e coverage**

- `tests/e2e/gbp-management-tabs.spec.ts`:
  - "Google Ads phone reviews an isolated change and clear at {375,768,1280}px"
  - "Google Ads phone protects unsupported advertising fields"
  - "Service areas support keyboard-only initial setup…", "…restore exact identifiers…", "…preserve unsupported provider data…", "Service areas review conversion and exact places at {w}px"
  - "Services review preserves siblings and cleared prices at {w}px"
  - "Saved service review keeps its frozen payload when {confirmed,stale,awaiting_confirmation}"
  - "Attribute metadata controls and enum clear at {w}px"
  - "Saved attribute review preserves drafts with canApprove=…"
  - "Repeated enum answers preserve siblings…"
  - "Multiple URL attributes remove one value…"
  - "Lodging publishes only the frozen reviewed change…"
- `tests/e2e/services-backend.spec.ts`: 5 journeys plus 2 layout tests (`:162-349`).
- `tests/e2e/lodging-complete-backend.spec.ts`: 5 journeys plus 2 layout tests (`:134-423`).
- `tests/e2e/lodging-recovery-backend.spec.ts`: 3 journeys plus 1 layout test.
- `tests/e2e/listings.spec.ts:674`: "industry publish journey…".
- Unit tests: `tests/components/{services-section,service-review,service-workspace,lodging-review,lodging-workspace,lodging-editor,industry-sections,saved-listing-reviews,saved-attribute-reviews,service-area-section,typed-attribute-control,profile-editor}.test.tsx`.

## 3. Steps today

1. **Open the profile.**
   - The tab streams with the loading label "business profile".
   - If Google's login is broken, `ProfileUnreachable` says so and offers "See saved work" (`profile-unreachable.tsx:62-71`).
   - While Google's half loads, the page shows "Reading categories, address and attributes from Google…" (`profile-editor.tsx:910`).
   - If that read fails, a banner explains that the Google-only sections stay hidden (`:913-917`).
2. **Edit a reviewed field** (service area, Google Ads phone or an attribute).
   - The section shows "Changed" and so does its section-nav entry (`:851-881,930`).
   - Attributes use the Yes / No / Not set choice, a Select or a URL field (`typed-attribute-control.tsx:152-283`).
   - Deprecated or unknown attribute types are read-only (`:284-297`).
   - The service-area place needs a raw Google place ID (`service-area-section.tsx:84-86`).
   - **Validation:**
     - The service-area transition and an unsupported advertising baseline become `listingIssues` (`profile-editor.tsx:363-371`). These disable Review with "Fix the highlighted fields before publishing." (`:759-761`).
     - Other issues are listed in `ValidationSummary` once Review has been pressed (`:661-696,1073-1076`).
     - **Attribute values are not validated at all** (friction #1).
3. **Footer.**
   - It shows "N changes not on Google · unsaved edits" with **Review changes**.
   - Save here is left out, and the bar explains: "…go to Google when you publish. Only the name, description, primary phone and website are saved here." (`:982-986`).
4. **Review changes.**
   - `prepareReview` creates saved change sets on the server and opens `CombinedReviewSheet`. Each row says it goes to Google (`:142-157,718-737`).
   - If the draft or baseline moves after the review is prepared, Publish is blocked with "The draft or Google baseline changed. Close this review and review again." (`:1113`).
   - In two-person mode the sheet says "A different authorised user must approve this saved review."
5. **Publish to Google.**
   - Each step approves its change set if needed, publishes with an intent id, and reads Google back (`:523-565`).
   - A failure stays on the step.
   - A parked step (awaiting approval) keeps the sheet open (`:572,607-609`).
   - Success gives the toast described under End.
6. **Services (separate reviewed write).**
   - Section actions: edit the rows, "Add a suggested service", "Add custom service for {category}" and **Review service changes** (`services-section.tsx:393-480`).
   - That button opens the sheet "Review service changes": **Approve service changes**, then the consent "Send these exact approved service changes to Google.", then **Send approved service changes** (`reviewed-change-sheet.tsx:159-176,259-266`).
   - In progress: "Sending to Google. The outcome appears here when the response arrives."
   - If the response is lost: "The send response is unavailable. Read the saved outcome before another write." Further writes stay locked (`use-service-review.ts:21,43`).
   - If the review is stale or expired: "This review needs a fresh preview before sending."
   - Once recorded: the "Saved service outcome" sheet with the actions **Read saved service outcome** and **Refresh service observation**.
7. **Lodging (separate reviewed write).**
   - The section shows Google's suggestions ("Apply suggested … to draft"), a searchable list of collapsible groups, and the alert "Details to correct before review" (`lodging-editor.tsx:59-68`).
   - To review, press **Review lodging changes** or the footer's "Review lodging draft". The sheet is the same as for services, with the noun "lodging".
   - Toasts on the outcome: confirmed, rejected or unresolved (`use-lodging-review.ts:75-77`).
8. **Saved work** (after the editor):
   - "Saved profile reviews" and "Saved attribute reviews" are hidden when empty.
   - "Saved lodging work" and "Saved service work" are **always drawn** (friction #2).
   - Each row shows the operation, "{deadline} · Review expires · Awaiting approval" and an open action (`saved-change-work.tsx:14-49`).
9. **Empty states:**
   - "No services added." (`services-section.tsx:219`)
   - "Google has not suggested lodging changes." (`lodging-suggestions.tsx:17`)
   - "No service area configured" (`service-area-section.tsx:52`)
   - "No saved lodging requests." and "No saved service requests."

## 4. Protected rules for this flow (do not change)

- **Edit gate:** owner and admin only (`capabilities.ts:284`). The UI disables editing until the role is known (`profile-editor.tsx:248-250`). Services are disabled without `canPublish && writesEnabled` (`services-section.tsx:123`).
- **Approval never sends.** Send needs `approvedBy`, the consent, a review that hasn't expired or gone stale, and no unresolved outcome (`reviewed-change-sheet.tsx:93-99,159-176`; `use-service-review.ts:61-62`; `use-lodging-review.ts:68-69`).
- **Unresolved outcomes lock further writes:**
  - `unsafe` / `unresolved` in `use-service-review.ts:15,21,43,47` and `use-lodging-review.ts:16,26,49,54`.
  - An active lodging request blocks every profile write (`profile-editor.tsx:296-299`).
- **"Applied" only after an independent confirmation** (`outcome-summary.tsx:38-47`). The service draft is only cleared on `confirmed` (`use-service-review.ts:37-39`).
- **Two-person approval:**
  - `waitsForApprover` (`profile-editor.tsx:131-135`).
  - The publish-disabled reason (`:1111-1113`).
  - The "different current owner or administrator" line (`reviewed-change-sheet.tsx:223-228`).
  - The saved-review gates (`saved-listing-reviews.tsx:73`, `saved-attribute-reviews.tsx:65`).
- **The review is frozen:** a fingerprint check (`profile-editor.tsx:1104`). Saved reviews publish their own payload, not the current draft.
- **Idempotency:** `intent.idFor(...)` (`profile-editor.tsx:519,537,559`).
- **Unsupported Google data is preserved and handed off:**
  - Service area (`service-area-section.tsx:37,43`).
  - Advertising (`advertising-section.tsx:20-22`; `profile-editor.tsx:366`).
  - Services (`services-section.tsx:70-78`).
  - Attributes (`typed-attribute-control.tsx:284-297`; `saved-attribute-reviews.tsx:28-31`).

## 5. Prior audit status (15 Oct)

| ID                                      | Relevance                                                                 | Status                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| LST-08 two write models in one form     | Service area, Ads phone and attributes now share the profile's one review | **Fixed** (`combined-review.tsx`, `profile-editor.tsx:1098`). Services and lodging remain separate reviewed writes, but on the same sheet anatomy |
| LST-04 editor bar                       | Footer for this flow                                                      | **Fixed** (`editor-footer.tsx`: no bar when clean, secondaries in the overflow)                                                                   |
| LST-10 / LST-26 one-off approval sheets | Services and lodging sheets                                               | **Fixed**: `ReviewedChangeSheet` uses `ReviewedWriteSheet`, `Steps`, `ConsentSlot` and `OutcomeSummary`                                           |
| LST-13 failure said three times         | Combined review failures                                                  | **Fixed** (`use-publish-flow.ts`, publish steps with SupportDetails)                                                                              |
| LST-27 read-only member view            | Member or viewer on the profile                                           | **Fixed** (`readView`, view-only bar)                                                                                                             |
| DSK-15 status words                     | Footer and pill words                                                     | **Fixed**                                                                                                                                         |

No earlier finding covered attribute validation, the empty saved-work sections, saved-row titles or the duplicate saved-review buttons. They are new below.

## 6. Friction

| #   | Problem                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                          | Sev | Heuristic / WCAG                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------- |
| 1   | An attribute URL without `https://` (say "www.pub.co.uk/menu") passes the page's checks. **Review changes** then fails with the generic toast "Something went wrong. Please try again." No field is marked, and retrying can never succeed.                                                                                            | `issues` covers no attributes (`profile-editor.tsx:661-696`). `prepareReview` calls `googleAttributeWriteSchema.parse(attribute)` (`:725`), which throws a ZodError, so `describeActionError` falls back to `GENERIC_ERROR_COPY` (`lib/errors/action-errors.ts:581,659`). The URL input has no error slot (`typed-attribute-control.tsx:259-280,239`). The schema's own message is "Use an http or https link." (`lib/contracts/http-url.ts:12`). | P2  | Error prevention, recovery; WCAG 3.3.1, 3.3.3                   |
| 2   | Every owner or admin sees "Saved lodging work" and "Saved service work" at the foot of every profile, even on a pub that has no lodging or services. Each section shows a loading line, then "No saved … requests." and a Reload button, and both get section-nav entries.                                                             | `SavedLodgingWorkspace` and `SavedServiceWorkspace` render whenever `canEditCanonical` (`lodging-workspace.tsx:50-53,66`; `service-workspace.tsx:36,41`). `SavedWorkList` always draws its empty text (`saved-work-list.tsx:83-84`). By contrast, saved profile and attribute reviews hide when empty (`saved-listing-reviews.tsx:47`, `saved-attribute-reviews.tsx:40`).                                                                         | P2  | Aesthetic and minimalist design; consistency                    |
| 3   | Rows under "Saved profile reviews" all read "Profile changes for {venue}", so two saved reviews can only be told apart by their deadline. Saved attribute reviews already name their fields.                                                                                                                                           | `saved-listing-reviews.tsx:56` vs `saved-attribute-reviews.tsx:49`                                                                                                                                                                                                                                                                                                                                                                                | P3  | Recognition over recall; 2.4.6                                  |
| 4   | The Services section draws one **"Open saved service review"** button _per_ saved review, all with the same name. The same reviews are listed again under "Saved service work". Lodging does the same with "Review saved lodging change". The page's own rule is "All saved work in one place".                                        | `services-section.tsx:481-496`; `lodging-review.tsx:24-26`; the comment at `profile-editor.tsx:257`; the lists at `service-workspace.tsx:44-55` and `lodging-workspace.tsx:69-80`                                                                                                                                                                                                                                                                 | P3  | Consistency; WCAG 2.4.6 (identical names for different targets) |
| 5   | A service row's Remove is named "Remove service 1" while its heading shows the service's name. Service areas use "Remove service area {name}".                                                                                                                                                                                         | `services-section.tsx:231,243` vs `service-area-section.tsx:79`                                                                                                                                                                                                                                                                                                                                                                                   | P3  | Consistency; 2.4.6                                              |
| 6   | To add a service area, the user must type a raw Google place ID, and nothing says how to find one.                                                                                                                                                                                                                                     | `service-area-section.tsx:84-86`: "Use an existing Google place ID. These checks validate format only; Google validates the proposed areas before publication."                                                                                                                                                                                                                                                                                   | P3  | Help and documentation; plain language                          |
| 7   | With profile fields _and_ services or lodging edited, the footer counts every change ("3 changes not on Google"). Its primary only reviews the profile fields ("Review profile fields"), and nothing says that services and lodging are sent separately. The "own review" note only appears when the four saved-here fields are clean. | `profile-editor.tsx:1008-1010,1016`                                                                                                                                                                                                                                                                                                                                                                                                               | P3  | Visibility of system status                                     |
| 8   | "Refresh {noun} observation" and "Read saved {noun} outcome" are process jargon.                                                                                                                                                                                                                                                       | `reviewed-change-sheet.tsx:145,155`. The same words are used by booking ("Refresh booking link observation") and lifecycle, so changing them is a cross-area vocabulary decision.                                                                                                                                                                                                                                                                 | P3  | Plain language                                                  |
| 9   | A saved-work sub-line starts with the deadline time, followed by "· Review expires · Awaiting approval", so the time reads as a creation time.                                                                                                                                                                                         | `saved-work-list.tsx:103` (SHARED) + `saved-change-work.tsx:39`                                                                                                                                                                                                                                                                                                                                                                                   | P3  | Match with real world                                           |
| H1  | **Hypothesis:** operators may not know which attributes Google actually shows. The section has no per-attribute help, and the metadata carries none.                                                                                                                                                                                   | `attributes-section.tsx:73`                                                                                                                                                                                                                                                                                                                                                                                                                       | –   | –                                                               |

## 7. Proposed changes

The changes are listed in priority order. None of them edits a SHARED file.

### C1 · Validate attribute values before review, on the field (fixes #1)

- **`components/locations/typed-attribute-control.tsx`:**
  - Export `attributeFieldId(name: string) => \`attribute-${name.replace(/[^A-Za-z0-9_-]/g, "-")}\``.
  - Add the prop `error?: string`.
  - **Single URL** (`:259`): set `id={attributeFieldId(name)}` and `aria-invalid={error ? true : undefined}`.
    - Build `aria-describedby` by merging `describedBy` with `${labelId}-error` when there is an error. Merge them by hand rather than wrapping the input in `Field`: an explicit `aria-describedby={undefined}` would override Field's wiring.
    - Render `{error ? <p id={…-error} className="basis-full text-caption text-danger-ink">{error}</p> : null}` inside the row.
  - **Repeated URL** (`:239`): put the same `id` on the first entry's input, mark the invalid entries with `aria-invalid`, and show one error line under the list.
  - The input's chrome already styles `aria-invalid` (`components/ui/field.tsx:515`).
- **`sections/attributes-section.tsx`:** add the prop `errors?: Readonly<Record<string, string>>` and pass `error={errors?.[meta.parent]}` to each control.
- **`profile/profile-editor.tsx`:**
  - Compute the errors:

    ```ts
    const attributeErrors = useMemo(() => {
      const out: Record<string, string> = {}
      for (const a of attributesUpdate.attributes) {
        const r = googleAttributeWriteSchema.safeParse(a)
        if (!r.success)
          out[a.name] =
            r.error.issues.find((i) => i.path.includes("uri"))?.message ??
            "Google can’t accept this value. Clear it or choose another answer."
      }
      return out
    }, [attributesUpdate.attributes])
    ```

    `googleAttributeWriteSchema` is already imported at `:73`.

  - In `issues` (`:661`), after the listing issues, push `{ fieldId: attributeFieldId(meta.parent), message: \`${meta.displayName ?? meta.parent}: ${msg}\` }` for each erroring attribute, in metadata order.
  - Pass `errors={attempts > 0 ? attributeErrors : undefined}` to `AttributesSection` (`:931`).
  - `check()` already refuses review while `issues.list` is non-empty, so `prepareReview` never runs with a bad value. The `ValidationSummary` link focuses the field.
- **Copy:**
  - Before: toast "Something went wrong. Please try again."
  - After: the summary says "Menu link: Use an http or https link.", and the field shows the same message under it.
- **Benefit:** the error is prevented, and the user can see where it is and how to fix it.
- **Principle:** Nielsen #5 and #9; WCAG 3.3.1 and 3.3.3.
- **Protected-behaviour risk:** none. The same schema the request already enforces now runs earlier, and no payload or endpoint changes.
- **Tests:**
  - `tests/components/typed-attribute-control.test.tsx`: with `error`, the textbox "Menu" has `aria-invalid="true"` and is described by the message.
  - `tests/components/profile-editor.test.tsx`: typing "example.com" into a URL attribute and pressing Review changes shows the summary link. No preview request is sent (assert the fetch mock).

### C2 · Hide empty lodging and service saved-work sections while the profile is readable (fixes #2)

- **`sections/lodging-workspace.tsx`:**
  - `SavedLodgingWorkspace` gets the prop `hideWhenEmpty?: boolean` and passes it to `SavedLodgingWork`.
  - In `SavedLodgingWork`: `if (hideWhenEmpty && (query.isPending || (!query.isError && items.length === 0))) return null`.
  - Keep the sheet mounted when `workflow.review` is set: return just `<LodgingApprovalSheet>`, so that a review opened from the section still works.
- **`sections/service-workspace.tsx`:** the same prop and rule for `SavedServiceWorkspace`. Keep `<ServiceApprovalSheet>` rendered whenever `workflow.review` is set, because the in-section services flow uses the workspace sheet (`services-section.tsx:503`).
- **`profile/profile-editor.tsx` (`ProfileTab`, `:263-264`):** pass `hideWhenEmpty={!unreachable}`. When Google can't be reached, the sections stay visible with their empty text, so "See saved work" still lands on something (that intent is tested at `profile-editor.test.tsx:~470`).
- **Section nav:** no change is needed. It already leaves out ids that aren't on the page (comment at `profile-editor.tsx:971-973`).
- **Benefit:** a pub's profile no longer ends with two empty sections and two Reload buttons that have nothing to do with it.
- **Principle:** HIG hierarchy; Nielsen #8.
- **Risk:** none to writes. The saved-work list is display only, and any saved item, an error, or Google being unreachable still shows the section.
- **Tests:**
  - `profile-editor.test.tsx` "lists every block on the page…" (`:1295`) and "jumps to a section…" (`:1361`) need one lodging workflow item in the fixture (`type=workflows` → `items: [ … ]`).
  - Add a test that the profile has no "Saved lodging work" or "Saved service work" region when both lists are empty and Google is readable.
  - `lodging-workspace.test.tsx` and `service-workspace.test.tsx` are unaffected (they don't pass the prop).

### C3 · Name what each saved profile review changes (fixes #3)

- **`sections/saved-listing-reviews.tsx:56`:**
  - Before: `operation: \`Profile changes for ${review.locationName}\``
  - After: `` operation: `${review.updateMask.map((m) => LOCATION_FIELD_LABELS[m as BusinessMask] ?? m).join(", ")} for ${review.locationName}` ``. Import `LOCATION_FIELD_LABELS` from `@/lib/locations/google-values` and `type BusinessMask` from `@/lib/contracts/location-business-information`.
  - Example: "Chain affiliation, Parent business for Camden Hotel".
- **Benefit:** saved reviews can be told apart at a glance, the same way saved attribute reviews already are.
- **Risk:** none (display only). The `supported` filter (`:46`) guarantees every mask has a label.
- **Test:** in `saved-listing-reviews.test.tsx`, assert the row text "Chain affiliation, Parent business for Camden Hotel".

### C4 · One entry point per saved review (fixes #4)

- **`sections/services-section.tsx:481-496`:** let `savedReviews` be the filtered list and `workspace` the existing `useServiceWorkspace()`.
  - With **one** review, or **no workspace**: keep the current button(s). This keeps `gbp-management-tabs.spec.ts:843` working.
  - With **two or more** reviews and a workspace: replace the buttons with one link, `<a href={\`#${SAVED_SERVICES_ID}\`} className={buttonVariants({ variant: "outline" })}>See {n} saved service reviews</a>`. Import `SAVED_SERVICES_ID`from`./service-workspace` (the module is already imported).
- **`sections/lodging-review.tsx:24-26`:** the same rule.
  - Keep a button for `workflow.review` when it is not yet in `saved`. Its label stays the existing outcome or review wording.
  - When `saved.length >= 2` and a workspace exists, show `<a href="#section-saved-lodging">See {n} saved lodging reviews</a>` (import `SAVED_LODGING_ID`).
  - With 0 or 1 saved reviews, nothing changes, which keeps `tests/components/lodging-review.test.tsx` passing as is.
- **Benefit:** no list of identically named buttons, and saved work lives in one place.
- **Principle:** consistency; WCAG 2.4.6.
- **Risk:** none. The same `workflow.restore` is reached from the saved-work rows.
- **Verify while implementing:** the `service-workflows` list includes unsent reviews. Its "Open service review" label for rows without an attempt (`service-workspace.tsx:52`) implies it does.
- **Test:** in `services-section.test.tsx`, two saved `serviceItems` reviews inside `ServiceWorkspaceProvider` give one link "See 2 saved service reviews" to `#section-saved-services`.

### C5 · Name service rows and say how to find a place ID (fixes #5, #6)

- **`sections/services-section.tsx:243`:**
  - Before: `aria-label={\`Remove service ${index + 1}\`}`
  - After: ``aria-label={`Remove ${label(row.item) || `service ${index + 1}`}`}``. The visible text "Remove" is kept, so WCAG 2.5.3 still passes. No test references the old name.
- **`sections/service-area-section.tsx:86`, FieldDescription:**
  - Before: "Use an existing Google place ID. These checks validate format only; Google validates the proposed areas before publication."
  - After: "A Google place ID looks like ChIJ…. Look one up with <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener noreferrer">Google's place ID finder (opens in a new tab)</a>. We only check the format here; Google checks the area when you send the change."
- **Benefit:** the user knows how to finish the task without leaving to search for help. Remove now names its row.
- **Risk:** none (copy and attributes only).
- **Test:** none needed beyond the existing `service-area-section.test.tsx`. Optionally assert the link's `href` and `target`.

## Follow-ups (out of scope)

- **#7 Mixed footer:**
  - Add an opt-in `note?: string` prop to SHARED `components/editors/editor-footer.tsx`, rendered in the existing note row when `reason` is empty. Profile would pass "Services and lodging are reviewed separately after these fields." when `rows.length > 0 && (serviceStatus.dirty || lodgingDirty)`.
  - Its other callers (hours, menu, booking) would be unaffected, but the integrator owns that file.
- **#8:** the reviewed-write vocabulary ("observation", "Read saved … outcome") is shared with booking (`place-actions`), lifecycle and verification. A single cross-area rename belongs with whoever owns `reviewed-write/*`.
- **#9:** an opt-in `when="deadline"` on SHARED `SavedWorkList` that prints "{stage} · {deadline}". Its other callers: `administration/{lifecycle-workspace,access-workspace,verification-saved-workflows}.tsx`.
- A place search, so users don't have to type a raw place ID (it needs a Places API endpoint).
- `services-section.tsx:168` "Service publishing is unavailable." should say why (role or paused writes). The editor gate banner usually covers this already.
- Saved rows show the raw "Google target: locations/…" (`saved-change-work.tsx:74-77`). This is deliberate and asserted by tests (`service-workspace.test.tsx:34`, `lodging-workspace.test.tsx:31`, `place-action-review.test.tsx:143`), so it is left alone.

## 8. Screenshots to capture

1. `/listings/{loc}/profile`, owner, widths 390 and 1280, no interaction, full page. **Before:** empty "Saved lodging work" and "Saved service work" at the foot, plus their section-nav entries. **After:** both gone (C2).
2. `/listings/{loc}/profile`, viewer, at 390. Confirms the read view is unchanged and the saved sections are absent, as before (regression check).
3. Attribute URL error (C1). **Needs interaction and mocked metadata:** capture it through the `gbp-management-tabs.spec.ts` route mocks (the "Multiple URL attributes…" fixture). Type `example.com`, press Review changes, and capture the summary and the inline error at 390.
4. Service area place-ID help (C5). **Needs interaction:** choose "Business and customer locations" in Service area at 390.

## 9. Files touched

components/locations/typed-attribute-control.tsx
components/locations/profile/sections/attributes-section.tsx
components/locations/profile/profile-editor.tsx (shared with the identity/contact flow: `issues` memo, AttributesSection props, ProfileTab saved-work props)
components/locations/profile/sections/lodging-workspace.tsx
components/locations/profile/sections/service-workspace.tsx
components/locations/profile/sections/saved-listing-reviews.tsx
components/locations/profile/sections/services-section.tsx
components/locations/profile/sections/lodging-review.tsx
components/locations/profile/sections/service-area-section.tsx
tests/components/typed-attribute-control.test.tsx
tests/components/profile-editor.test.tsx
tests/components/saved-listing-reviews.test.tsx
tests/components/services-section.test.tsx
