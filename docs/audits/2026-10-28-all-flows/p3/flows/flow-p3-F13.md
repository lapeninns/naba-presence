# p3-F13 — Read-only and access-denied views for members and viewers

Code read at `/tmp/naba-presence-p3` (branch `ux/flows-presence-p3`, head `e4123d25`). Read-only analysis.

## 1. Flow

- **ID / name:** p3-F13, read-only and access-denied views for members and viewers.
- **Goal:** someone who can look but not change a listing sees its values clearly, and is told in plain words why they can't change them and what to do instead.
- **Start:** a member or viewer opens `/listings` (`app/(dashboard)/listings/page.tsx:19-47`) or a direct link to `/listings/[id]` or `/listings/[id]/{profile,hours,menu,booking,people}` (`app/(dashboard)/listings/[id]/*/page.tsx`). The layout wraps every area in `ListingAreaLayout` → `AreaFrame` → `ListingGate` (`components/listings/area-frame.tsx:969-990, 820`).
- **End:** one of the following:
  - a read view with its reason (hours, profile, menu, booking);
  - a denied card for People (`administration-denied.tsx:31-89`);
  - a 404 with help text for a listing the person can't see (`listing-gate.tsx:90-93` → `components/app-shell/not-found-content.tsx:87-99`).
- **Roles:**
  - **viewer:** read everywhere, never edits or publishes (`lib/server/permissions.ts:330-336, 394-412`).
  - **member:** `canEditCanonical=false` (`lib/server/capabilities.ts:284`). A member with publish rights can still change booking links (and photos and posts). A member who isn't assigned to the listing gets a 404.
  - **owner/admin:** the control group.

## 2. Code map

| Concern                                                                                                                                       | File:line                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Role → caps (`canEditCanonical` = owner/admin; console resources `permission_denied`; `publish_not_allowed`/`publishing_paused` states)       | `lib/server/capabilities.ts:184-247, 284-309`                                                                                 |
| Visibility / 404 parity / 403 per action                                                                                                      | `lib/server/permissions.ts:315-336, 394-447`                                                                                  |
| Directory gate (skeleton → 404, or 403 "Ask an owner or admin to check your access.")                                                         | `components/listings/listing-gate.tsx:47-93, 121-160`                                                                         |
| Area nav: console areas hidden for non-managers, Review & publish hidden if no edit/publish/request                                           | `lib/listings/area-nav.ts:75-82, 98-143`; `lib/listings/areas.ts:99-116, 137-139`                                             |
| Header, pill, model note, pane (`role="region"`, focusable for read-only panes)                                                               | `components/listings/area-frame.tsx:503-700, 750-870`                                                                         |
| Tab shell: caps error → `TabError`; `requires` gate → `Empty variant="forbidden"` "Your role can’t open this section. Ask an owner or admin…" | `components/locations/location-tab.tsx:185-213`                                                                               |
| Edit/publish reasons ("Only owners and admins can edit this location.")                                                                       | `lib/locations/gating.ts:39-43, 71-102, 171-181`                                                                              |
| Banner builder (role limit → "You can look, but not change {noun}")                                                                           | `lib/editors/gate.ts:26-73` (SHARED lib; callers: hours, booking, profile only)                                               |
| Read view styles / default gate title                                                                                                         | `components/editors/editor-frame.tsx:20-31, 99-119, 161-168`                                                                  |
| View-only footer ("View-only access. {reason}", no buttons, reports no status)                                                                | `components/editors/editor-footer.tsx:128-166`                                                                                |
| Hours                                                                                                                                         | `components/locations/hours-tab.tsx:413-420, 451-484`                                                                         |
| Profile                                                                                                                                       | `components/locations/profile/profile-editor.tsx:774-781, 996-1031`                                                           |
| Menu                                                                                                                                          | `components/locations/menu-tab.tsx:41-71, 268-376`                                                                            |
| Booking                                                                                                                                       | `components/locations/booking-tab.tsx:101-127, 169-445, 742-933`; page `app/(dashboard)/listings/[id]/booking/page.tsx:27-33` |
| People denied                                                                                                                                 | `components/locations/administration/administration-tab.tsx:185-258`; `administration-denied.tsx:14-89`                       |
| Overview cards / alerts                                                                                                                       | `components/listings/area-cards.tsx:226-300`; `components/listings/listing-overview.tsx:42-167, 271-277`                      |
| Board for non-managers                                                                                                                        | `components/listings/listings-board.tsx:734-812`                                                                              |

**e2e coverage:** `tests/e2e/listings.spec.ts` has three relevant tests:

- "permission walk: owner/admin can edit canonical; member/viewer cannot" (`:253`)
- "console role walk: People/Verification hidden for member/viewer; the business profile stays read-only for everyone" (`:300`, which asserts "This section is available to owners and admins" on `/people`, `:393`)
- "read-only views: a member sees read rows, not greyed fields…" (`:529`)

**Unit tests:**

- `tests/editor-gate.test.ts`
- `tests/components/hours-tab.test.tsx:281` "disables editing for a viewer and says why"
- `tests/components/booking-tab.test.tsx:118` "disables adding with a reason when the viewer cannot publish"
- `tests/components/listing-area-cards.test.tsx:77,99`
- `tests/components/listing-overview.test.tsx:167,300`
- `tests/components/location-tab.test.tsx:229`

None of them cover menu or booking for a read-only role beyond that one booking case.

## 3. Steps today

1. **`/listings` (board), member or viewer.**
   - **Initial:** skeleton without the selection column (`listings-board.tsx:734`).
   - **Empty:** "Nothing is linked to Google yet. An owner or admin can add the first listing." (`:802`), with no button.
   - **Error:** "We couldn’t load your listings" with Try again. "Add listings" is shown to managers only (`:757`).
   - Bulk selection is hidden (`:616-617`). Rows open the overview. No problems found here.
2. **`/listings/[id]` (overview).**
   - `ListingGate` shows a skeleton (`listing-gate.tsx:66-87`). A hidden listing (unassigned member) gets `notFound()` → "This page doesn’t exist", plus the "Followed a link from a teammate? … an owner or admin can give you access from the Team page." help (`not-found-content.tsx:91-98`). A 403 shows "Ask an owner or admin to check your access." (`listing-gate.tsx:138`) and drops Try again.
   - The People and Verification cards are left out (`area-cards.tsx:195`).
   - Canonical areas show "View" with an eye icon (`:274-278`). However, an area with pending changes (`core_dirty`, `conflict`, `google_dirty`) or Suggested updates shows **"Review"** to a viewer (`:268-277`).
   - The section line says "Check a problem, review changes or edit an area." (`listing-overview.tsx:275`).
   - The unfiled alert ends "An owner or admin can file it." (`:81`). The unverified alert offers non-managers no action and doesn't say who can act (`:98-112`).
3. **`/hours`, member or viewer.**
   - The pane streams "Reading the opening hours from Google…".
   - **Loaded:** the fields are a read view (`hours-tab.tsx:454`). The lock banner reads "You can look, but not change these hours" / "Only owners and admins can edit this location." (`gate.ts:43-49`). The bottom bar repeats it: "View-only access. Only owners and admins can edit this location." (`editor-footer.tsx:150-166`).
   - There are no Save, Review or Discard buttons, and "Match Google closing boundaries" is hidden (`hours-tab.tsx:489`).
   - **Error:** `TabError` with Try again.
4. **`/profile`.** Same pattern as hours (`profile-editor.tsx:774-781, 999, 1022`). Services are read-only (`:953`). The industry GET never fires (e2e `:322-358`).
5. **`/menu`, member or viewer.**
   - The fields are a read view (`menu-tab.tsx:290`).
   - The banner is EditorFrame's generic default, "You can look, but not change **this**" (`editor-frame.tsx:164`), not `editorGate`.
   - **The footer has no `readOnlyReason`** (`menu-tab.tsx:292-311`). If Google's menu differs from the saved one (`rows.length>0`), the member sees "N changes to publish" with a **disabled "Review changes"** and the reason note (`editor-footer.tsx:219-221, 286-294`). That is the "row of disabled buttons" that hours and profile explicitly avoid.
   - **Empty (no menu):** "…Start one here; nothing reaches Google until you publish." (`menu-tab.tsx:344`), with no button for this role (`:347`).
6. **`/booking`, viewer or member without publish rights.**
   - The streamed fallback says "Reading the **action links** from Google…" (`booking/page.tsx:30`). The tab itself says "booking links" (`booking-tab.tsx:104`).
   - **Loaded:** the banner reads "You can look, but not change these links" / "You do not have permission to publish this location to Google." (`:187-196`).
   - There is **no read view** (`EditorFrame` has no `readView`, `:112`). Every editable link keeps greyed **Edit** and **⋯** buttons (`:408-418, 523-555`). The full **"Add a booking link"** card still renders with a greyed Type row, URL field and checkbox, and its caption says "Review comes first. Nothing reaches Google until you approve and send it." (`:437-442, 826-881`).
   - **Empty:** "No booking links yet / Add a booking link below." (`:336-337`).
   - A member with publish rights gets the full editor (the gate is null), which is correct.
7. **`/people`, member or viewer** (by direct link: it isn't in the nav).
   - The header still shows the "On Google" pill and the model note "Administrator and invitation changes are reviewed and approved before sending…" (`area-frame.tsx:806-816`; `areas.ts:151`; `area-state.ts:236-240`).
   - **Body:** a lock card. Its title is "Only owners and admins can see who has access". Its description is "This section is available to owners and admins. People with access on Google decide who can change or delete the listing, so this page is limited to owners and admins." (`administration-denied.tsx:16-19, 51`), so "owners and admins" appears three times.
   - **Actions:** "Back to listing" and "Copy an access request". The second puts the sentence on the clipboard and shows "Copied. Paste it to an owner or admin — nothing was sent." (`:54-87`). The owner/admin-only GET never fires (`administration-tab.tsx:222-230`).

## 4. Protected rules for this flow

- Only owners and admins edit canonical data (`capabilities.ts:284`; `gating.ts:39-43`). Viewers never edit or publish, whatever their grant rows say (`permissions.ts:330-336, 398-401`). The server checks every write (`requireLocationAction`, `permissions.ts:420-447`).
- A member with publish rights can write booking links directly (the resource is `available`; `capabilities.ts:228-236`). Any read-only treatment must stay conditional on the gate, never on the role name alone.
- Console GETs (administration, industry) must never fire for non-managers (`location-tab.tsx:193-213`; `administration-tab.tsx:222`; e2e `:322-358, 380-396`).
- A hidden listing answers 404, exactly like a missing one, so a probe can't tell "not yours" from "doesn't exist" (`permissions.ts:404-417`; `listing-gate.tsx:92`). Don't add a "you lack access to this listing" page.
- Review & publish entry points are hidden for roles with nothing to send (`area-nav.ts:75-82`; `area-frame.tsx:358-372`).
- A view-only footer reports no status to the header pill (`editor-footer.tsx:131-145`).

## 5. Prior audit status

| ID                                                                         | Status                                                                                                                                                                                                                                                                                                                                                         | Evidence |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| LST-27 (read-only member view is a greyed editor; empty state says "edit") | **Fixed** for hours, profile and menu fields, and for Review & publish copy and gating (`results.md:234`; `readView` at `hours-tab.tsx:454`, `menu-tab.tsx:290`, `profile-editor.tsx:999`; `area-nav.ts:75`). **Still open in two places:** booking has no read view (step 6), and menu's footer and empty state still behave as if the role can act (step 5). |
| LST-31 ("action link" jargon)                                              | Fixed in the tab (`results.md:237`). **Leftover:** `booking/page.tsx:30` `loadingLabel="action links"`.                                                                                                                                                                                                                                                        |
| DSK-15 (card verbs)                                                        | Fixed ("Open", not "Check": `area-cards.tsx:283-284`). The "Review" verb for a read-only role (F7) is new.                                                                                                                                                                                                                                                     |
| INB-06 pattern ("Ask an owner or admin…", no dead-end button)              | Applied in Inbox. On listings it is used by `location-tab.tsx:209` and `listing-gate.tsx:138`, but not by the editor banners (F1).                                                                                                                                                                                                                             |

## 6. Friction

| #   | Problem                                                                                                                                                                | Evidence                                                                                                                                 | Sev | Heuristic / WCAG                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | The read-only banner on hours, profile and booking says why but never what to do; the tab-level gate does ("Ask an owner or admin if something here needs to change.") | `gate.ts:43-49` uses `editReason` alone; compare `location-tab.tsx:209`                                                                  | P2  | Nielsen 9 (recover), HIG consistency                                                                                                      |
| F2  | Hours and profile say the same sentence twice (banner, then "View-only access. Only owners and admins can edit this location.")                                        | `gate.ts:47`; `editor-footer.tsx:162-163`                                                                                                | P3  | Nielsen 8 (minimalist). Not changed, see C1 note.                                                                                         |
| F3  | Menu uses a different banner title ("…not change this") and has no view-only bar, so a member with Google drift sees a disabled "Review changes" and a reason row      | `menu-tab.tsx:289, 292-311`; `editor-frame.tsx:164`; `editor-footer.tsx:219-221`                                                         | P2  | Nielsen 4 (consistency), 1 (status)                                                                                                       |
| F4  | The empty menu tells a read-only role "Start one here", with no button                                                                                                 | `menu-tab.tsx:344, 347`                                                                                                                  | P2  | Nielsen 2 (real world). Same class as LST-27.                                                                                             |
| F5  | Booking for a viewer, or a member without publish rights: greyed "Add a booking link" form, greyed Edit/⋯ on every link, and empty copy "Add a booking link below."    | `booking-tab.tsx:112, 336-337, 408-418, 437-442, 826-881`                                                                                | P2  | Nielsen 4 & 8; disabled controls give no explanation (WCAG 1.4.3 does not apply to disabled controls, so greyed text may be hard to read) |
| F6  | The booking pending line says "action links"                                                                                                                           | `booking/page.tsx:30` and `lib/locations/gating.ts:136-138`                                                                              | P3  | Nielsen 4 (one word per thing)                                                                                                            |
| F7  | Overview cards offer **"Review"** to a viewer or member for an area they can't review (hours, profile or menu with changes; Suggested updates)                         | `area-cards.tsx:268-277` (`needsReview` checked before `readOnly`); suggestions gated on `editReason`, `suggestions-page.tsx:39-43, 150` | P2  | Nielsen 2 & 4                                                                                                                             |
| F8  | Overview section line "Check a problem, review changes or edit an area." is shown to a viewer                                                                          | `listing-overview.tsx:275`                                                                                                               | P3  | Nielsen 2                                                                                                                                 |
| F9  | The "Google hasn’t verified this listing" alert gives non-managers no action and no "who can". The unfiled alert next to it does ("An owner or admin can file it.")    | `listing-overview.tsx:81` compared with `:98-112`                                                                                        | P3  | Nielsen 4 & 9                                                                                                                             |
| F10 | The People denied card repeats "owners and admins" three times                                                                                                         | `administration-denied.tsx:16-19, 51`                                                                                                    | P3  | Nielsen 8                                                                                                                                 |
| F11 | The People page header shows a member an "On Google" pill and the admin-approval model note above the denied card                                                      | `area-frame.tsx:806-816`; `areas.ts:151`                                                                                                 | P3  | Nielsen 8. Needs the SHARED `area-frame.tsx`, so it's a follow-up.                                                                        |
| F12 | The People denied card's "Copy an access request" differs from the app-wide "Ask for access" (share sheet, link and identity included)                                 | `administration-denied.tsx:62-75` compared with `components/app-shell/access-denied.tsx:139-172`                                         | P3  | HIG familiarity. Follow-up: Verification (p4) shares this component.                                                                      |

Checked and fine: the board for non-managers, the `ListingGate` 403/404 copy, the LocationTab forbidden state, Review & publish gating, and the 404 for an unassigned member (deliberate parity; the help text names the Team page).

## 7. Proposed changes

**C1 — The read-only banner says what to do (F1).**

- **Change:** in `lib/editors/gate.ts` `editorGate`, editReason branch (`:43-49`), compute `const roleLimit = caps?.canWrite !== false && caps?.canEditCanonical === false`. Set the description to `roleLimit ? \`${editReason} Ask an owner or admin if something here needs to change.\` : editReason`. Move the sentence into an exported constant `ASK_OWNER_OR_ADMIN`, and use the same constant in `location-tab.tsx:209` so the wording can't drift.
- **Before and after (hours, viewer):** "Only owners and admins can edit this location." → "Only owners and admins can edit this location. Ask an owner or admin if something here needs to change."
- **Booking, viewer:** "You do not have permission to publish this location to Google. Ask an owner or admin if something here needs to change."
- **Billing read-only is unchanged:** an owner can't "ask an owner".
- **Files:** `lib/editors/gate.ts` (SHARED lib; callers `hours-tab.tsx:413`, `booking-tab.tsx:187`, `profile-editor.tsx:774`, plus menu after C2, all p3); `components/locations/location-tab.tsx` (SHARED shell; constant only, rendered copy unchanged).
- **Benefit:** every read-only area gives a way forward.
- **Risk:** none. This is copy only; caps and server checks are untouched. The F2 duplication stays: the bottom bar is the reminder at the end of a long form, and shortening it would change e2e strings for little gain.
- **Tests:**
  - Add two cases to `tests/editor-gate.test.ts`: `canEditCanonical:false`, which ends with the ask line; and `canWrite:false`, which has no ask line. The existing role-limit test uses `canEditCanonical:true` and stays green.
  - `hours-tab.test.tsx:299` `getAllByText` still matches the footer's exact text.

**C2 — Menu gets the same read-only treatment as hours (F3, F4).**

- **Change:** in `menu-tab.tsx`:
  - Pass `caps` from the `LocationTab` render props into `MenuForm` (`:49-59`).
  - Compute `editorGate({ caps, resource: "menu", editReason, publishReason: gateReason, noun: "this menu", savesHere: true })`.
  - Replace `gateReason={editReason}` (`:289`) with `gateReason={gate?.description} gateTitle={gate?.title} gateTone={gate?.tone} gateCode={gate?.code}`. EditorFrame already takes these props, so there are no changes to the shared frame.
  - Add `readOnlyReason={editReason}` to `EditorFooter` (`:292-311`).
  - Empty state (`:340-345`): when `disabled`, use `roleLimit` (as in C1). Copy for each case:

| Case                                     | Copy                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `googleHasMenu`                          | "NabaPresence has no menu for {name}, but Google has one with N items. An owner or admin can start from it here." |
| No menu anywhere, role limit             | "Neither NabaPresence nor Google has a food menu for {name}. An owner or admin can start one here."               |
| No menu anywhere, other reason (billing) | "…{name}." with no "Start one here"                                                                               |
| Not disabled                             | unchanged                                                                                                         |

- **Owner-visible side effect:** while publishing is paused or `publish_not_allowed`, an owner or admin now also sees the same "Publishing to Google is switched off…" banner that hours shows. This is consistent, but tell whoever owns the menu-editing flow.
- **Files:** `components/locations/menu-tab.tsx`.
- **Benefit:** a member never meets a disabled Review button, and the copy no longer invites an action they can't take.
- **Risk:** none. The footer's view-only branch reports no status (`editor-footer.tsx:131`), and saves and publishes still go through the same disabled path.
- **Tests:** in `tests/components/menu-tab.test.tsx`, add:
  - "a member sees the view-only bar, no Review changes" (caps `{canEditCanonical:false, canPublish:false}`, a state with `rows>0`);
  - "the empty menu doesn't tell a member to start one".

**C3 — Booking read view for a role limit (F5, F6).**

- **Change:** in `booking-tab.tsx` `BookingLinks`, add `const viewOnly = Boolean(caps && !caps.canEditCanonical && writeReason)`. This is the exact condition already used for `editReason` at `:193`, so a member with publish rights is unaffected. Then:
  - (a) Render `AddLinkForm` only when `!viewOnly` (`:437-442`). Leave it unchanged when the reason is a pause, so owners still see the form.
  - (b) Row footer `link.isEditable && !viewOnly ? <LinkActions…/> : undefined` (`:408-418`).
  - (c) Empty `description` (`:337`): `viewOnly ? "Google shows no booking links on this listing." : "Add a booking link below. Google decides how it appears publicly."`.
  - (d) `app/(dashboard)/listings/[id]/booking/page.tsx:30` `loadingLabel="action links"` → `"booking links"`.
- The C1 banner explains the read view, so it doesn't need a footer.
- **Files:** `components/locations/booking-tab.tsx`, `app/(dashboard)/listings/[id]/booking/page.tsx`.
- **Benefit:** booking matches hours, menu and profile, with values plus one explanation and no dead controls.
- **Risk:** none. Hiding is presentation only, and `previewPlaceAction` still checks permission on the server. The dialogs are only opened from the hidden actions.
- **Tests:** rewrite `booking-tab.test.tsx:118` as "shows links read-only to a viewer: no Add form, no Edit, and says who can help". Assert that there is no "Add a booking link" heading, no `Edit the … link` button, and that the ask line is present. Add a case where a publishing member keeps Edit.

**C4 — The overview tells read-only roles the truth (F7, F8, F9).**

- **Change in `components/listings/area-cards.tsx:268-277`:**
  - Add `const viewOnlyRole = caps?.canEditCanonical === false && (readOnly || area.key === "suggestions")`.
  - Set `const verb = viewOnlyRole ? "View" : needsReview ? "Review" : …`.
  - The pill still shows the state ("Changes to publish"), so the information isn't lost.
- **Change in `listing-overview.tsx:275`:** the description becomes `caps.data?.canEditCanonical === false ? "Open an area to see what it holds here and on Google." : "Check a problem, review changes or edit an area."`.
- **Change in `listing-overview.tsx:100`:** append `{canManage ? null : " An owner or admin can start verification."}`, mirroring `:81`.
- **Files:** `components/listings/area-cards.tsx`, `components/listings/listing-overview.tsx`.
- **Benefit:** no "Review" promise that opens a read-only page, and each alert says who can act.
- **Risk:** none. Hrefs are unchanged; this changes only words.
- **Tests:**
  - `listing-area-cards.test.tsx`: add a case with read-only caps, hours `core_dirty` and one suggestion, expecting the links "View Opening hours" and "View Suggested updates". The existing `:77` case keeps owner caps.
  - `listing-overview.test.tsx:167`: assert the member's section line and the unverified alert's "An owner or admin can start verification."

**C5 — People denied card stops repeating itself (F10).**

- **Change:** in `administration-denied.tsx`, give `DENIED_COPY` a `description` per kind. For `people`, use "Whoever has access on Google can change or delete the listing. Ask an owner or admin if you need to see or change who that is." For `verification`, keep `${GATED_SECTION_TITLE}. ${why}` byte-for-byte (p4 owns that screen). Render `description={copy.description}` (`:51`).
- **Files:** `components/locations/administration/administration-denied.tsx` (also rendered by `verification-tab.tsx:25` for p4, whose output is unchanged).
- **Benefit:** a shorter card that leads with the way forward.
- **Risk:** none. The GET gating is untouched.
- **Tests:** in `tests/e2e/listings.spec.ts:392-394`, replace the `getByText("This section is available to owners and admins")` assertion with `getByRole("heading", { name: "Only owners and admins can see who has access" })`. `location-tab.test.tsx:229` (the LocationTab gate) is unaffected.

### Follow-ups (out of scope)

- F11: hide the pill and model note on People and Verification for non-managers. This needs an opt-in in the SHARED `area-frame.tsx` (`AreaFrameBody` pill `:806-816`; `AreaInfo` and `AreaMetaLine`), for example skipping both when `listingArea(areaKey).consoleGated && role` isn't owner or admin.
- F12: make the People and Verification denied card use the app's "Ask for access" (`shareLink` + toast, like `access-denied.tsx:139-161`). This needs agreement with p4, because Verification shares the component.
- F2: shorten either the banner or the footer for read-only hours and profile. This needs e2e string updates (`listings.spec.ts:272, 286, 355`).

## 8. Screenshots to capture

| Route                     | Role                                             | Interaction                                              | Shows                                                                                                        |
| ------------------------- | ------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/listings/{loc}/booking` | viewer                                           | none                                                     | Before: greyed Add form and Edit/⋯. After: read view, banner with the ask line (C1, C3).                     |
| `/listings/{loc}/menu`    | member (memberUnassigned: scope all, no publish) | none (seed with Google drift, or an empty menu)          | Before: disabled "Review changes", or "Start one here". After: view-only bar and role-aware empty copy (C2). |
| `/listings/{loc}`         | viewer                                           | none (fixture with hours `core_dirty` or one suggestion) | "Review" → "View" card verbs and the section line (C4).                                                      |
| `/listings/{loc}/people`  | member                                           | none                                                     | The denied card copy (C5).                                                                                   |

## 9. Files touched

- lib/editors/gate.ts (SHARED; only p3 callers: hours-tab, booking-tab, profile-editor, menu-tab)
- components/locations/location-tab.tsx (SHARED shell; constant reuse only, rendered copy unchanged)
- components/locations/menu-tab.tsx
- components/locations/booking-tab.tsx
- app/(dashboard)/listings/[id]/booking/page.tsx
- components/listings/area-cards.tsx
- components/listings/listing-overview.tsx
- components/locations/administration/administration-denied.tsx (also rendered by p4 verification; its output is unchanged)
- tests/editor-gate.test.ts
- tests/components/menu-tab.test.tsx
- tests/components/booking-tab.test.tsx
- tests/components/listing-area-cards.test.tsx
- tests/components/listing-overview.test.tsx
- tests/e2e/listings.spec.ts
