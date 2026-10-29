# p3 · Listings core: before and after

Status: **implemented and partially verified**, revised after an independent
review (see [Review response](#review-response)). The evidence is source,
unit and component tests, and fixture-browser runs against a production build
with a throwaway PostgreSQL and the repo's Google **stub**. Nothing was
published to real Google, and no provider-backed check ran. BEFORE and AFTER
screenshots were captured with the same script, fixtures and viewports (16
states, 49 images each side). See [Verification](#verification).

## Scope and baseline

**Area.** Listings core in NabaPresence: the board (`/listings`), a listing's
overview (`/listings/[id]`), the area header that frames every area, and the
`profile`, `hours`, `menu`, `people` and `booking` areas. Other areas own
posts, photos, suggestions, Review & publish, verification and the bulk pages
(p4), so their screens were not changed; where p3 code is shared with them it
is listed under [Shared-file edits](#shared-file-edits).

**Flows.** One analysis per flow
([`flows/flow-p3-F01.md`](flows/flow-p3-F01.md) …
[`flows/flow-p3-F13.md`](flows/flow-p3-F13.md)) recorded the steps, protected rules, prior audit
status, friction with evidence and the proposed changes.

| ID     | Flow                                                      | Route                                       | Start → end                                                                                                                                   |
| ------ | --------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| p3-F01 | Find, filter and open a listing                           | `/listings` (`q`, `health`, `clientId`)     | Board → `/listings/{id}` (name link or quick look's "Open listing"), an area link in the desk quick look, or the quick look's answer in place |
| p3-F02 | Select listings, hand off to bulk, add listings           | `/listings`                                 | Board → `/listings/bulk?ids=…` (p4) or "Add listings from Google" → `/setup` (p2)                                                             |
| p3-F03 | Read a listing's overview and go to an area               | `/listings/[id]`                            | Overview → an area route, an alert's action, Review & publish or the Activity sheet                                                           |
| p3-F04 | Move between areas through the area header                | `/listings/[id]/{area}`                     | Any area → another area, a sibling listing, Review & publish or Activity, under the same header                                               |
| p3-F05 | Edit the core business profile and send it to review      | `/listings/[id]/profile`                    | Editor → server-confirmed "Save here", or the review sheet's publish outcome (or parked for a second approver)                                |
| p3-F06 | Request Google-reviewed profile changes                   | `/listings/[id]/profile`                    | Services, attributes, service area, lodging, Ads phone → review → approve → send → outcome                                                    |
| p3-F07 | Edit regular weekly hours                                 | `/listings/[id]/hours`                      | Day rows and day sheet → "Save here", "Review changes", discard or confirmed leave                                                            |
| p3-F08 | Hours status, special and service hours                   | `/listings/[id]/hours`                      | Status notes and pill → special days, service schedules → save or publish; pill back to "In sync"                                             |
| p3-F09 | Edit the food menu                                        | `/listings/[id]/menu`                       | Menu editor → "Save here", Review → publish, or discard                                                                                       |
| p3-F10 | See who manages the listing and invite someone            | `/listings/[id]/people`                     | Roster → invite sheet → saved review → approve → send → recorded outcome                                                                      |
| p3-F11 | Transfer or request deletion (danger zone)                | `/listings/[id]/people`                     | Danger zone dialog → saved review → approve → typed name and consent → send → outcome; "ended" state                                          |
| p3-F12 | Add, change or remove a booking link                      | `/listings/[id]/booking`                    | Add form or row action → review → approve → send → outcome in the approval sheet and "Saved booking link work"                                |
| p3-F13 | Read-only and access-denied views for members and viewers | `/listings`, `/listings/[id]` and its areas | A read view with its reason (hours, profile, menu, booking), the People denied card, or the 404 for a listing the person can't see            |

**Baseline.** Branch `ux/flows-presence-p3`, cut from
`origin/ux/all-flows-presence` at `e4123d25` (after the responsive pass #258
and #261), in the isolated worktree `/tmp/naba-presence-p3`. BEFORE evidence
comes from a clean detached worktree at `e4123d25`; AFTER from the branch head.
Commits: `git log --oneline e4123d25..HEAD`. Commit `10316667` ("style:
prettier …") is formatting only: the format ratchet checks every changed file,
and 23 touched files were unformatted at the base, including the whole of
`tests/e2e/gbp-management-tabs.spec.ts`. It is left out of the change log.

**Environment.**

- Tests and e2e: production build, throwaway PostgreSQL per run through
  `scripts/run-test-command.mjs`, the repo's Google stub, `PLAYWRIGHT_PORT=3530`.
- `.env` and `.env.local` were symlinked into the worktrees from the main
  checkout, as for the 15 Oct after-evidence run. They were not opened.
- **Visual harness deviation.** The local Supabase on `:54322` belongs to
  another project and has no `naba_visual` database. The harness therefore
  ran on a throwaway PostgreSQL 17 cluster from `scripts/ci/postgres.mjs`,
  with a database named `naba_visual`, migrated by the repo's own
  `db-migrate` and `db-create-runtime-role`, then stopped. Everything else is
  the repo's own: the fixture server and its "Sprint 5 Journey" tenants, the
  Google stub and `tests/visual/shoot.mjs`. The app was served from the
  production build (`node .next/standalone/server.js`) on 3532, with the stub
  on 3533, under the `/tmp/naba-presence-visual.lock` lock.
- Viewports: Chromium at 390 light, 390 dark and 1280 light (`isMobile` and
  `hasTouch` below 768, reduced motion, height 860). The 390 shots are full
  page. The 1280 shots are 1280 × 860 and show the top of the page only: at
  that width the app scrolls inside its shell, so a full-page capture stops
  at the viewport.
- The capture scripts are kept as reference text in [`capture/`](capture/),
  with [rerun instructions](capture/README.md).

### Protected rules for this area

Each was checked at the branch head (`file:line`).

| Rule                                                                      | Where it lives                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit vs publish: "Save here" is canonical and revision-checked            | `components/locations/hours-tab.tsx:370-372` (`saveHours` with `expectedCanonicalRevision`)                                                                                                                                                           |
| Publish only through review, with overwrite consent and one intent        | `hours-tab.tsx:329-333` (`confirmOverwriteGoogleChanges`, `intentId`); `menu-tab.tsx:178`; `profile-editor.tsx:587,738` (`needsAck`)                                                                                                                  |
| Role gates and capabilities                                               | `lib/listings/area-nav.ts:75-82,135-137` (`canReviewChanges`); `lib/server/capabilities.ts:108,284` (`canEditCanonical` = owner or admin); route gates `app/api/locations/[id]/hours/route.ts:36,59`, `app/api/locations/[id]/food-menus/route.ts:36` |
| Two-person approval on reviewed writes                                    | `profile-editor.tsx:186-188` (`waitsForApprover`); `place-actions/place-action-approval-sheet.tsx:138,232` (`requiresSecondApprover`); `components/reviewed-write/*` (not changed)                                                                    |
| Place-action review → approve → consented send, owner/admin with publish  | `lib/server/place-action-review-state.ts:19`                                                                                                                                                                                                          |
| Lifecycle: typed name, consent, one action at a time, step-up             | `administration/lifecycle-review.tsx:198-212` (`ConsentSlot`, `TypedConfirmation`); `administration/use-lifecycle.ts:133-139,165` (`claim`); `app/api/locations/[id]/administration-lifecycle-reviews/[reviewId]/execute/route.ts:13,16`              |
| Invitations are reviewed writes                                           | `administration/invite-sheet.tsx:217` (`ReviewedWriteSheet`)                                                                                                                                                                                          |
| Bulk selection cap of 50 and the server's preview                         | `lib/domain/bulk-merge.ts:37`; `listings-board.tsx:650,966,975`; `lib/server/bulk-listings.ts:190` (unlinked targets skipped by the server)                                                                                                           |
| An unassigned member gets a 404                                           | `components/listings/listing-gate.tsx:74` (`notFound()`)                                                                                                                                                                                              |
| Server authority: nothing says saved, sent or published before the server | Toasts and outcomes follow the mutation result (`hours-tab.tsx`, `menu-tab.tsx`, `profile-editor.tsx`); booking's "Done" only for a settled outcome (`place-action-approval-sheet.tsx:147`)                                                           |

### Prior work: the 15 Oct audit

`docs/audits/2026-10-15-ux-flows/results.md` ("Findings by status" and "Open
follow-ups") lists nearly every listing finding as fixed. Checked against the
code at `e4123d25`, the flow analyses found:

- **Already fixed and left alone:** LST-01, 02, 03, 04, 05, 07, 08, 10, 13,
  14, 16, 17, 18 (board health and pages), 20, 21, 23, 26, 29; DSK-01, 06, 15
  and 23. LST-19 is fixed for Hours; its Posts remainder belongs to p4.
- **LST-06 remainder (follow-up 26)**, open: from `wide`, the time zone was
  still its own paragraph on Hours (`hours-tab.tsx:530-542` at the base),
  outside the frame's meta line. **This branch:** the paragraph is gone and
  the zone is now the Regular hours group's caption, on the times it
  qualifies (p3-F08-C3). That closes the remainder by an alternative, not as
  literally specified (a zone slot in the shared `AreaMetaLine`, F04-C1, was
  not done). See follow-up 2.
- **DSK-05 remainder (follow-up 22)**, open: a business-workspace trail is
  three crumbs, never folds, and repeats the listing name and the area name.
  **This branch:** not changed (F04-C2 skipped, because it needs the shared
  app shell and `lib/ui`). See follow-up 3.
- **LST-31**, recorded as fixed, had **regressed** in one place: L16 later set
  the booking page's streamed `loadingLabel="action links"`, so the pending
  line said "action links" and then "booking links". **This branch:** the label
  is "booking links" (p3-F12-C1), and server refusals that still say "action
  link" or "Place Action" are shown in booking-link words on the client
  (p3-F12-C3). The server strings themselves are unchanged (follow-up 13).
- **LST-27**, recorded as fixed for hours, profile and menu, was **still open
  for booking**: viewers saw a greyed add form and "Add a booking link below".
  Menu's footer and empty state also behaved as if the role could act.
  **This branch:** booking gets a read view (p3-F12-C2) and menu gets the same
  gate and view-only bar as hours (p3-F13-C2).
- **L18 carried item:** `listingAttentionReason()` was not wired into the
  board. **This branch:** the desk quick look uses it (p3-F01-C1). It is still
  not used by the overview's health strip.
- **RC-COPY "lifecycle"** remains in the People danger-zone flow (p3-F11-C4,
  partly done; follow-up 7).

### Scenarios and states

Each state is captured by the same script on both sides. `{loc}` is the
fixture's primary listing.

| State                 | Route                     | Role   | Viewports    | What it shows                                                |
| --------------------- | ------------------------- | ------ | ------------ | ------------------------------------------------------------ |
| `01-board`            | `/listings`               | owner  | 390 ×2, 1280 | The board                                                    |
| `02-board-no-match`   | `/listings?q=zzqx`        | owner  | 390 ×2, 1280 | "No listings match" for a search                             |
| `03-board-quick-look` | `/listings`, row click    | owner  | 1280 only    | The desk quick look for the first listing                    |
| `04-overview`         | `/listings/{loc}`         | owner  | 390 ×2, 1280 | Overview                                                     |
| `05-overview-viewer`  | `/listings/{loc}`         | viewer | 390 ×2, 1280 | Overview for a read-only role                                |
| `06-profile`          | `/listings/{loc}/profile` | owner  | 390 ×2, 1280 | Profile editor                                               |
| `07-hours`            | `/listings/{loc}/hours`   | owner  | 390 ×2, 1280 | Hours editor                                                 |
| `08-hours-day-sheet`  | `/listings/{loc}/hours`   | owner  | 390 ×2, 1280 | Monday's day sheet with opens 18:00, closes 02:00, not saved |
| `09-hours-viewer`     | `/listings/{loc}/hours`   | viewer | 390 ×2, 1280 | Hours read view                                              |
| `10-menu`             | `/listings/{loc}/menu`    | owner  | 390 ×2, 1280 | Menu editor                                                  |
| `11-menu-member`      | `/listings/{loc}/menu`    | member | 390 ×2, 1280 | Menu for a member                                            |
| `12-people`           | `/listings/{loc}/people`  | owner  | 390 ×2, 1280 | People: roster, invitations, saved work, danger zone         |
| `13-people-invite`    | `/listings/{loc}/people`  | owner  | 390 ×2, 1280 | Invite sheet with `not-an-email` typed, then Tab             |
| `14-booking`          | `/listings/{loc}/booking` | owner  | 390 ×2, 1280 | Booking links                                                |
| `15-booking-viewer`   | `/listings/{loc}/booking` | viewer | 390 ×2, 1280 | Booking for a viewer                                         |
| `16-booking-add`      | `/listings/{loc}/booking` | owner  | 390 ×2, 1280 | `example.com/book` typed into the link field, not submitted  |
| `17-profile-invalid`  | `/listings/{loc}/profile` | owner  | 390 ×2, 1280 | Business name cleared, then Tab, not saved                   |

"390 ×2" is 390 light and 390 dark. Interactions open sheets and type, and
never submit a write.

## Before

### Journey per flow

- **F01.** The board lists every listing with its health. Search, health chips
  and client chips narrow it. From `lg`, a row click opens a quick look. The
  quick look's area pills used the raw sync label, so a listing that "Needs
  attention" (no hours on Google), or one Google couldn't be reached for, could
  show "Opening hours · In sync".
- **F02.** Owners and admins tick rows (up to 50) and press "Prepare bulk
  change". "Clear selection" removed its own bar while focused. "Add listings
  from Google" always went to the client chooser.
- **F03.** The overview shows alerts, area cards, then the Google connection
  and last-published rows. For a disconnected listing the only fix, "Reconnect
  Google", sat below all the area cards. On a phone, "Review and publish them."
  had no button in view.
- **F04.** The area header carries the tabs, the status pill with its "How
  changes reach Google" sheet, and the meta line. An area switch showed an
  unlabelled grey block twice, then a different-shaped loading state.
- **F05.** One long profile editor. A problem in a Google-only field disabled
  "Review changes" with "Fix the highlighted fields before publishing." and no
  summary or link.
- **F06.** Google-only sections (services, attributes, service area, lodging).
  An attribute link without `https://` passed the page's checks, then failed
  Review with the generic "Something went wrong. Please try again."
- **F07.** Day rows open a day sheet with time fields and a closing-day select.
  An overnight period (18:00 → 02:00, closing "Same day") surfaced only after
  Review, through the summary.
- **F08.** Status notes above the schedule, then Regular, Service and Special
  hours. "Changed on Google" had no note and no way to keep Google's version;
  the footer said "N changes not on Google".
- **F09.** Menus, sections, items and prices. Removing the last section of the
  default one-menu draft swapped the editor for the empty state and took the
  promised "Undo removal" with it.
- **F10.** Roster, "Pending invitations", saved access work, then the danger
  zone. "Pending invitations" listed only invitations _to_ the connected login,
  while the people the operator had invited appeared under the roster.
- **F11.** "Delete this location" opened a step that deletes nothing. A failed
  preview showed one generic sentence and could mark an open review stale with
  the wrong reason.
- **F12.** Links grouped by type, an add form and saved booking-link work.
  Server refusals reached the screen in "action link" words. A viewer saw a
  greyed form.
- **F13.** Read-only banners said why the role couldn't change something, but
  not what to do; menu and booking behaved differently from hours and profile.

### Observed friction

These come from reading the code and copy at `e4123d25` (the flow analyses,
each claim with `file:line` at the base). They are source-level observations,
not session observations. The BEFORE screenshots, once captured, show those
that are reachable by URL with the fixture data.

| #   | Flow     | Observation                                                                                                                                 | Evidence (at `e4123d25`)                                                                     |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| B1  | F01      | Quick-look area pills bypass `areaState`, so "In sync" can sit under "Needs attention" or beside an unreachable Google                      | `listings-board.tsx:392-394` (`syncStatusLabel`) vs `lib/listings/area-state.ts:126-152`     |
| B2  | F01      | Load error not announced, its retry shows no progress, and the copy is internal ("The listings service didn’t answer…")                     | `listings-board.tsx:739-754`                                                                 |
| B3  | F01      | A failed summaries read makes every row "Not checked" and offers no retry                                                                   | `listings-board.tsx:1139-1141,1157-1160`                                                     |
| B4  | F01      | The filtered count is never announced; "No listings match" names neither search nor filter, and its one action drops the search             | `listings-board.tsx:1133-1137,1173-1183`                                                     |
| B5  | F02      | "N selected" counts hidden and unlinked listings silently; capped checkboxes have no tied reason; "Clear selection" drops focus to `<body>` | `listings-board.tsx:877-880,913-916,1276-1293`; `action-bar.tsx:130`                         |
| B6  | F02      | "Add listings from Google" ignores the client in view; the empty-board action is a hand-made secondary link that prefetches `/setup`        | `add-listings-link.tsx:23`; `listings-board.tsx:805-812`                                     |
| B7  | F03      | Disconnected: "Reconnect Google" sits under every card, members aren't told who can fix it, and "not linked" has no link                    | `health-strip.tsx:160-169`; `listing-overview.tsx:57-166`                                    |
| B8  | F03      | Phone: the description names Review & publish, but the button is only in "More listing actions"                                             | `area-frame.tsx:652` (`hidden … md:flex`)                                                    |
| B9  | F03      | Raw summary keys ("Last change: hours", "The last menu publish failed"); an assertive failed-publish alert present on load                  | `health-strip.tsx:198-203`; `listing-overview.tsx:120`                                       |
| B10 | F03, F04 | Two skeleton shapes for one page; nothing announced on load or area switch                                                                  | `listing-gate.tsx:65-88`; `loading.tsx:13-18`; `area-frame.tsx:874-881`                      |
| B11 | F04      | Phone: a failed "Check Google now" in the status sheet shows nothing in the sheet                                                           | `area-frame.tsx:303-308`                                                                     |
| B12 | F05      | A Google-only field error disables Review with no summary or link; two summary links don't land focus                                       | `profile-editor.tsx:759-760,1074`; `editor-footer.tsx:221`; `profile-editor.tsx:687,690`     |
| B13 | F05      | Every differing field says "Changed", including Google's changes and saved-here values                                                      | `profile-editor.tsx:788-792`; `identity-section.tsx:91`; `contact-section.tsx:88,110,288`    |
| B14 | F05      | Long or internal copy; the description counter is live on every keystroke                                                                   | `profile-editor.tsx:985,1113`; `contact-section.tsx:289-298`                                 |
| B15 | F06      | An attribute link without `https://` fails Review with a generic toast, and no field is marked                                              | `profile-editor.tsx:661-696,725`; `lib/errors/action-errors.ts:581,659`                      |
| B16 | F06      | Empty "Saved lodging work" and "Saved service work" on every profile; saved profile reviews all titled "Profile changes for {venue}"        | `lodging-workspace.tsx:50-53`; `service-workspace.tsx:36,41`; `saved-listing-reviews.tsx:56` |
| B17 | F06      | "Remove service 1" beside a named service; no help to find a place ID                                                                       | `services-section.tsx:243`; `service-area-section.tsx:84-86`                                 |
| B18 | F07      | Overnight mistakes surface only after Review                                                                                                | `hours-editor.tsx:382-385,1081-1086`; `hours-presentation.ts:322-331`                        |
| B19 | F07      | "Copy to N days" is silent to screen readers, and focus can return to an old day's row                                                      | `hours-editor.tsx:888,940-967,1411-1414`                                                     |
| B20 | F07      | Split periods drop focus and hide limits; switch and time fields lack visible labels in their names                                         | `hours-editor.tsx:1012-1027,1096-1138`                                                       |
| B21 | F08      | "Changed on Google" has no note and no way to keep Google's hours; edits that match Google still offer Review                               | `editor-status.tsx:139-140`; `hours-tab.tsx:458,460`; `hours-notes.ts:51-59`                 |
| B22 | F08      | "No hours on Google" says "Switch on your open days" when the draft already has them                                                        | `hours-notes.ts:60-68`                                                                       |
| B23 | F08      | Special-day inputs have no visible labels; validation says "Special date 1" by index; service schedules show raw ids (`KITCHEN`)            | `hours-editor.tsx:1243-1261,1291-1326,643-644`; `hours-presentation.ts:247,352`              |
| B24 | F09      | Removing the last section swaps out the editor and its Undo                                                                                 | `menu-tab.tsx:233`; `menu-editor.tsx:799-817`                                                |
| B25 | F09      | Preview disabled with no visible reason; remove dialog counts only items; section field names don't contain their labels                    | `menu-editor.tsx:347-354,894,917-919`; `section-editor.tsx:112,121`                          |
| B26 | F10      | Two kinds of invitation share one name; "0 waiting" beside an "Invitation pending" row                                                      | `administration-tab.tsx:346-352,387,469`; `invitations.tsx:39-40,105`                        |
| B27 | F10      | One footer button eases between variants through low-contrast frames (the root of an intermittent axe failure)                              | `invite-sheet.tsx:219-302`; `button.tsx:35`                                                  |
| B28 | F10      | Role and scope pickers say nothing about what they grant; the email error fires on the first character, assertively                         | `invite-sheet.tsx:115-119,395-443`                                                           |
| B29 | F10      | "Saved access work" renders after the danger zone                                                                                           | `access-workspace.tsx:93-112`; `administration-tab.tsx:502`                                  |
| B30 | F11      | A failed preview says one generic sentence, can block the open review with a wrong reason, and its error outlives the dialog                | `use-lifecycle.ts:58-59`; `danger-zone.tsx:201,229`                                          |
| B31 | F11      | "Delete this location" opens a request step; the destination needs a raw `accounts/…`; the ended state has no way forward                   | `danger-zone.tsx:138,155,170-171,184`; `administration-tab.tsx:286-294`                      |
| B32 | F11      | Wrong or missing disabled reasons ("Sending is paused until the other Google change is resolved." for a permissions limit)                  | `danger-zone.tsx:52,86`; `lifecycle-workspace.tsx:81`                                        |
| B33 | F12      | Loading label "action links" (LST-31 regression); server refusals shown in "action link" words                                              | `booking/page.tsx:30`; `use-place-action-review.ts:23`                                       |
| B34 | F12      | Viewers get a greyed form and "Add a booking link below"                                                                                    | `booking-tab.tsx:337,437-442`                                                                |
| B35 | F12      | "Keep editing" returns to nothing; the paused alert has no action; raw operation enums; URL format only in a placeholder                    | `place-action-approval-sheet.tsx:137-144`; `booking-tab.tsx:290-298,294-295,866`             |
| B36 | F13      | Read-only banners say why, not what to do; overview offers "Review" to roles that can't review                                              | `lib/editors/gate.ts:43-49`; `area-cards.tsx:268-277`                                        |
| B37 | F13      | The People denied card says "owners and admins" three times                                                                                 | `administration-denied.tsx:16-19,51`                                                         |

Left alone on purpose: the quick look opening by pointer only (DSK-23's
design); `wrap-anywhere` on invitation emails (deliberate); the 404 for an
unassigned member (deliberate parity).

### Hypotheses (not measured)

- H1: A Review button that lists what to fix, with links that land on the
  field, leads to fewer abandoned profile edits than a disabled button.
- H2: "Keep Google’s hours" reduces accidental overwrites of a change made on
  Google.
- H3: The in-sheet overnight cue removes most Review → summary → reopen loops
  for late closes.
- H4: Putting the connection problem first gets disconnected listings
  reconnected sooner.
- H5: With saved access work above the danger zone, a second approver is less
  likely to mis-tap a destructive control.
- From the analyses, not acted on: town search on the board (F01 #8);
  "Prepare bulk change" prefetching on every tick (F02 #8); Activity hard to
  find behind ⋯ on a phone (F03 H1); "Review & publish (n)" prefetching
  `/changes` on each area load (F04 #6); no leave guard for services and
  lodging drafts (F05 #10); closing-day selects wrapping at 320 px (F07 #6);
  Special hours below Service hours slowing phones (F08 #9); hidden menu-item
  attributes (F09 #7); "Remove" on a pending invitation reading as removing
  access (F10 #6).

None of these was tested with users. No completion, timing, tap-count or
height figures were measured.

## After

Steps, required inputs, server calls and success destinations are unchanged
in every flow. What changed is copy, grouping, focus, accessible names, local
UI state, and the loading, empty, error and retry states.

- **F01 board.** The quick look uses `areaState`, the overview's own words,
  and names the one attention reason when there is one. The load error is
  announced, with a pending "Trying again…". A failed summaries read says so,
  with "Check again"; a failed refresh says the last check is still shown. The
  hidden count line says "N of M listings shown". "No listings match “q”"
  names the search, says what is narrowing it, and offers "Show N matches"
  without dropping the search; after it (or "Clear filters"), focus moves to
  the search field.
- **F02 selection.** The bar adds "· N not shown" and "· N not linked to
  Google". A capped checkbox is described by the bar's count. "Clear
  selection" returns focus to the select-all checkbox, or `#main`. "Add
  listings from Google" opens `/setup?client=` for a client in view that the
  session can see, and the empty board uses the same link.
- **F03 overview.** A disconnected listing's first alert says Google can't be
  reached, what that means, and either "Reconnect Google" (owners and admins)
  or "Ask an owner or admin to reconnect it." An unlinked listing gets its
  own alert with "Link to Google" or who can. Phones get a full-width Review &
  publish link. Publish areas read in words ("opening hours"). The
  failed-publish alert is no longer assertive and says where Activity is.
  Loading is one announced shape.
- **F04 area header.** A failed "Check Google now" also shows inside the
  status sheet. Area switches show announced pending rows ("Loading this
  page…"), not an unlabelled block. Booking's loading words match.
- **F05 profile.** "Review changes" stays enabled; pressing it focuses a
  summary of every problem, each linking to a control that takes focus
  (disclosures open first). A guard still refuses to prepare any review while
  a check fails. Field tags say "Changed", "Changed on Google" or "Not on
  Google yet". Copy is shorter and plainer; the description counter is no
  longer live, and only crossing the limit is announced.
- **F06 Google-reviewed sections.** Attribute values Google won't accept are
  checked before review, marked on the field and listed in the summary. Empty
  saved lodging and service work is hidden while Google is readable. Saved
  profile reviews are named by the fields they change. Service Remove buttons
  name the service. The place-ID field explains the format, with a link to
  Google's finder after "Add service area".
- **F07 regular hours.** An overnight period shows "Open past midnight? Close
  on the next day." with an explicit "Close on {day}" button; nothing is
  chosen for the operator. "Copy to…" confirms in a toast and returns focus to
  the right control. The split button says what it will do, or why it can't,
  and focus follows the new or previous period. The switch reads "Open on
  {day}", and the time fields have visible "Opens", "Closes" and "Closing day"
  labels.
- **F08 status, special and service hours.** "Hours changed on Google"
  explains the change and offers "Keep Google’s hours", which reads Google
  fresh and fills the draft only (saved later with "Save here"). It is offered
  only with no unsaved edits, and refuses if the draft changed during the read
  or the read is empty. The footer says "Changed on Google" rather than "N
  changes not on Google", and edits that already match Google offer "Save
  here", not an empty Review. "No hours on Google" follows the draft. The time
  zone is the Regular hours caption. Special days have visible labels and are
  named by date in validation. Service schedules use Google's names, and the
  Service hours group says what it is and why it may be empty.
- **F09 menu.** Emptying the draft keeps the editor and "Undo removal", and
  the description warns that publishing would leave Google with no food menu.
  The toolbar says why Preview is off, and "every menu" only when there are
  several. The remove dialog names what goes (sections and items). Section
  field names contain their visible labels. Read-only roles get the same gate,
  view-only bar and empty-state copy as hours.
- **F10 people.** "Invitations to answer" (to the connected login) is
  separate from people "not yet accepted". Each sheet step has its own keyed
  footer buttons. Role and scope choices say what they grant. The email is
  checked on blur or Enter. Saved access work comes before the explainers and
  the danger zone.
- **F11 danger zone.** A failed transfer or deletion preview is explained in
  its dialog, against the destination field where that's the cause, with
  "No review was saved, and nothing was sent to Google." Only refusals about
  the typed destination stay in the dialog; connection, source and publishing
  refusals still block an open review. The button reads "Request deletion";
  both dialogs name the listing. A bare account ID is accepted and prefixed.
  The ended state names the Search/Maps caveat for a deletion and offers
  "Open Google connections" and "See the saved outcome". Disabled rows and the
  send bar say the real reason.
- **F12 booking.** The loading label says "booking links". Viewers, and
  members without publish rights, get a read view. Server refusals are shown
  in booking-link words with a next step. The approval sheet closes with
  "Done" only for a settled outcome, otherwise "Close for now", and says where
  the work is kept. The paused and needs-check alerts carry an action.
  Operations read in words. The link field has a visible hint, and confirm
  labels are plain.
- **F13 read-only.** Role-limited banners add "Ask an owner or admin if
  something here needs to change." Overview cards say "View", not "Review",
  to a role that can't review; the Areas line and the verification alert speak
  to that role. The People denied card stops repeating itself.

## Change log

One row per implemented change, by the analysis change ID. Commits:
`c51888cc` (board), `32f2551b` (overview), `1d76b8b3` (profile), `db5bb217`
(hours), `b63c4ce7` (menu), `23312a3d` (people), `62552502` (booking),
`c446412a` (e2e copy), `0d3a4852` (place-ID link order) and `25839c91`
(review fixes).

| Change                                                           | Before                                                                                                   | After                                                                                                                                                                                                                      | Reason                               | Relevant principle                             | Affected files                                                                                                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p3-F01-C1 Quick look tells the overview's story                  | Area pills from `syncStatusLabel`; one catch-all attention sentence                                      | Pills from `areaState(area, summary, now)`; `listingAttentionReason` when there is one cause; "We couldn’t check this listing just now…" when summaries failed                                                             | B1; L18 carried item                 | Nielsen 1, 4; HIG consistent feedback          | `components/listings/listings-board.tsx`                                                                                                                                         |
| p3-F01-C2 Errors announce, recover and show progress             | Unannounced load error, no pending retry; no summaries retry                                             | Load error `role="alert"`, plain copy, `pending` "Trying again…"; "Check again" for summaries with focus return to `#main`; failed refresh keeps "this is the last check"                                                  | B2, B3                               | WCAG 4.1.3; Nielsen 1, 9                       | `listings-board.tsx`                                                                                                                                                             |
| p3-F01-C3 Announce what a filter leaves                          | Live line always counted every listing                                                                   | "N of M listings shown" in the polite line when narrowed                                                                                                                                                                   | B4                                   | WCAG 4.1.3; Nielsen 4                          | `listings-board.tsx`                                                                                                                                                             |
| p3-F01-C4 "No listings match" names the narrowing                | Generic title; only "Clear filters", which drops the search                                              | `No listings match “q”`; scope named; "Show N matches" keeps the search; focus to the search field after either button (review P3-1)                                                                                       | B4                                   | Nielsen 3, 9; WCAG 2.4.3                       | `listings-board.tsx`                                                                                                                                                             |
| p3-F02-C2 Say what the count covers                              | "N selected" only; capped checkbox unexplained                                                           | "· N not shown", "· N not linked to Google"; capped checkbox `aria-describedby` the bar status                                                                                                                             | B5                                   | Nielsen 1, 5; WCAG 1.3.1                       | `listings-board.tsx`                                                                                                                                                             |
| p3-F02-C3 Focus after Clear selection                            | Focus fell to `<body>`                                                                                   | Select-all checkbox, else `#main`                                                                                                                                                                                          | B5                                   | WCAG 2.4.3                                     | `listings-board.tsx`                                                                                                                                                             |
| p3-F02-C4 Add listings keeps the client; one Add link            | Always `/setup`; empty board used a secondary `next/link`                                                | `AddListingsLink clientId` → `/setup?client=` for a visible client; the empty board uses it                                                                                                                                | B6                                   | Nielsen 7; HIG hierarchy                       | `components/listings/add-listings-link.tsx`, `listings-board.tsx`                                                                                                                |
| p3-F03-C1 Connection problem first, a step for every role        | Reconnect under the cards; no who-can; no link for unlinked                                              | Warning alert first with Reconnect (owners/admins) or "Ask an owner or admin…"; unlinked alert with "Link to Google" or who can; footnote removed from the health strip                                                    | B7                                   | Nielsen 1, 9; HIG hierarchy                    | `components/listings/listing-overview.tsx`, `components/listings/health-strip.tsx`                                                                                               |
| p3-F03-C2 Review & publish on the phone overview                 | Only in the overflow below md                                                                            | `ReviewPublishLink` full width, `md:hidden`                                                                                                                                                                                | B8                                   | Nielsen 6                                      | `listing-overview.tsx`                                                                                                                                                           |
| p3-F03-C3 Publish area in words                                  | "Last change: hours"                                                                                     | `publishAreaName` from the area's label                                                                                                                                                                                    | B9                                   | Nielsen 2, 4                                   | `health-strip.tsx`, `listing-overview.tsx`                                                                                                                                       |
| p3-F03-C4 / F04-C4 One announced loading shape                   | Gate's four-card skeleton; unlabelled 160 px block on area switch                                        | Gate uses `ListingSkeleton` (`role="status"`, "Loading this listing…"); in-frame route loading and editor chunk loading use `QueryPending` "Loading this page…"                                                            | B10                                  | WCAG 4.1.3; Nielsen 1; layout stability        | `components/listings/listing-gate.tsx`, `listing-skeleton.tsx`, `app/(dashboard)/listings/[id]/loading.tsx`, `components/listings/area-frame.tsx` (shared)                       |
| p3-F03-C5 Calmer failure banner, clearer Activity copy           | Assertive alert on load; "Activity" unlocated; "location"                                                | `live={false}`; "Activity, at the top of this page, has the attempt details."; "No changes to Google have been recorded for this listing yet."                                                                             | B9                                   | WCAG 4.1.3; Nielsen 2                          | `listing-overview.tsx`, `components/locations/activity-panel.tsx`                                                                                                                |
| p3-F04-C3 Failed Google check inside the status sheet            | Sheet showed nothing; failure under the header behind the scrim                                          | `GoogleFreshnessFailure` in the `AreaInfo` popover                                                                                                                                                                         | B11                                  | Nielsen 1, 9; WCAG 4.1.3                       | `area-frame.tsx` (shared)                                                                                                                                                        |
| p3-F05-C1 Review always shows what to fix                        | Review disabled; no summary; two links didn't land focus                                                 | Review enabled; summary focused on each attempt; mirrored payload, unplaced and attribute problems listed; `revealField` opens disclosures and focuses a control; `blocking` guard refuses to prepare a review             | B12                                  | Nielsen 9, 5; WCAG 3.3.1, 3.3.3, 2.4.3         | `components/locations/profile/profile-editor.tsx`, `typed-attribute-control.tsx`                                                                                                 |
| p3-F05-C2 Field tags say whose change                            | "Changed" for every difference                                                                           | "Changed", "Changed on Google" or "Not on Google yet" (display only; review and `needsAck` don't read it)                                                                                                                  | B13                                  | Nielsen 1, 2                                   | `profile-editor.tsx`, `sections/identity-section.tsx`, `sections/contact-section.tsx`                                                                                            |
| p3-F05-C4 Plain, shorter copy                                    | 37-word save note; "Local checks validate format only…"; approver said twice; "Additional phone numbers" | Shorter save note; plain field hints; "Publishing unlocks once they approve."; stale-review line in plain words; section title "Additional phones"                                                                         | B14                                  | Nielsen 2, 8                                   | `profile-editor.tsx`, `sections/related-businesses-section.tsx`, `sections/contact-section.tsx`, `sections/address-details-fields.tsx`, `sections/additional-phones-section.tsx` |
| p3-F05-C5 Quieter counter; named chain results                   | Counter `aria-live` on every keystroke; `div` with an ignored `aria-label`                               | Counter describes the field; an sr-only status only when over the limit; results `role="group"`                                                                                                                            | B14                                  | WCAG 4.1.3, 1.3.1, 4.1.2                       | `sections/contact-section.tsx`, `sections/chain-section.tsx`                                                                                                                     |
| p3-F06-C1 Attribute values checked before review                 | Generic toast after Review                                                                               | `googleAttributeWriteSchema.safeParse` per attribute; message on the field (`aria-invalid`, `aria-describedby`) and in the summary                                                                                         | B15                                  | Nielsen 5, 9; WCAG 3.3.1, 3.3.3                | `profile-editor.tsx`, `typed-attribute-control.tsx`, `sections/attributes-section.tsx`                                                                                           |
| p3-F06-C2 Hide empty saved lodging and service work              | Empty sections on every profile                                                                          | `hideWhenEmpty` while Google is readable; the review sheet stays mounted; a failed read still shows                                                                                                                        | B16                                  | Nielsen 8; consistency                         | `sections/lodging-workspace.tsx`, `sections/service-workspace.tsx`, `profile-editor.tsx`                                                                                         |
| p3-F06-C3 Name what each saved review changes                    | "Profile changes for {venue}"                                                                            | "{field labels} for {venue}"                                                                                                                                                                                               | B16                                  | Nielsen 6; WCAG 2.4.6                          | `sections/saved-listing-reviews.tsx`                                                                                                                                             |
| p3-F06-C5 Name service rows; help with place IDs                 | "Remove service 1"; no help                                                                              | "Remove {service}"; "A Google place ID looks like ChIJ…"; finder link placed after "Add service area" (`0d3a4852`, to keep keyboard order)                                                                                 | B17                                  | WCAG 2.4.6; Nielsen 10                         | `sections/services-section.tsx`, `sections/service-area-section.tsx`                                                                                                             |
| p3-F07-C1 Overnight cue with one-tap fix                         | Found only after Review                                                                                  | Hint plus "Close on {next day}" button, polite region, never automatic                                                                                                                                                     | B18                                  | Nielsen 5, 9; WCAG 3.3.3                       | `components/locations/hours-editor.tsx`                                                                                                                                          |
| p3-F07-C2 Say what "Copy to…" did; fix focus return              | Silent; focus to an old row                                                                              | Local toast naming the days; header copy resets `lastCopyDay`                                                                                                                                                              | B19                                  | WCAG 4.1.3, 2.4.3                              | `hours-editor.tsx`                                                                                                                                                               |
| p3-F07-C3 Split periods say what they do; keep focus             | "Add split period" vanished; focus dropped                                                               | Label by effect ("Split into two periods", "Add another period"…); reason when unavailable; focus to the new or previous period                                                                                            | B20                                  | WCAG 2.4.3; Nielsen 1, 2                       | `hours-editor.tsx`                                                                                                                                                               |
| p3-F07-C4 Visible labels match names                             | "Monday open in this sheet"; placeholder-only times                                                      | Switch "Open on {day}"; "Opens", "Closes", "Closing day", "Period N"                                                                                                                                                       | B20                                  | WCAG 2.5.3, 3.3.2                              | `hours-editor.tsx`                                                                                                                                                               |
| p3-F08-C1 Changed on Google note; keep Google's hours            | No note; footer "N changes not on Google"; Review offered for matching edits                             | `google-changed` note with "Keep Google’s hours" (fresh read, draft only, no unsaved edits, refuses an edit made during the read or an empty read); footer `isDirty={rows.length > 0}`, no count for a clean Google change | B21; review P1-1, P3-2               | Nielsen 1, 3, 5                                | `components/locations/hours-tab.tsx`, `lib/editors/hours-notes.ts`                                                                                                               |
| p3-F08-C2 "No hours on Google" follows the draft                 | "Switch on your open days." always                                                                       | Asks to publish when the draft already has hours                                                                                                                                                                           | B22                                  | Nielsen 2, 9                                   | `hours-notes.ts`, `hours-tab.tsx`                                                                                                                                                |
| p3-F08-C3 Time zone as the Regular hours caption                 | Own paragraph with an icon (LST-06 remainder)                                                            | Caption of the Regular hours group, when the zone isn't the viewer's                                                                                                                                                       | LST-06 / follow-up 26 by alternative | HIG hierarchy; Nielsen 8                       | `hours-tab.tsx`, `hours-editor.tsx`                                                                                                                                              |
| p3-F08-C4 Special-day labels; dates in validation                | No visible labels; "Special date 1"                                                                      | "Date", "Opens", "Closes", "Closing date" plus a hint; "Special hours, {date}" or "New special day"                                                                                                                        | B23                                  | WCAG 3.3.2; Nielsen 2, 6                       | `hours-editor.tsx`, `lib/editors/hours-presentation.ts`                                                                                                                          |
| p3-F08-C5 Plain service names; explained group                   | `KITCHEN`; no caption or empty reason                                                                    | Google's display names in validation; raw id only for an unconfirmed type; caption and "Google doesn’t offer service hours for this business’s category."                                                                  | B23                                  | Nielsen 2, 1                                   | `hours-editor.tsx`, `hours-presentation.ts`, `hours-tab.tsx`                                                                                                                     |
| p3-F09-C1 Keep the editor and Undo while emptying                | Editor swapped out; Undo lost                                                                            | `noMenu` only for a clean draft; notices, Undo and the keyed remove dialog stay with no menus; warning about publishing an empty menu                                                                                      | B24                                  | Nielsen 3, 5; HIG preserved context            | `components/locations/menu-tab.tsx`, `components/locations/menu-editor.tsx`                                                                                                      |
| p3-F09-C2 Say why Preview is off; "every menu" only when several | Reason shown only in preview view; sentence for one menu                                                 | Toolbar note with the reason, `aria-describedby` on Preview; multi-menu sentence only for 2+                                                                                                                               | B25                                  | Nielsen 1, 8; WCAG 3.3.2                       | `menu-editor.tsx`                                                                                                                                                                |
| p3-F09-C3 Removal dialog says what goes                          | "0 items will be removed…"                                                                               | Sections and items named, empty cases worded                                                                                                                                                                               | B25                                  | Nielsen 2, 5                                   | `menu-editor.tsx`                                                                                                                                                                |
| p3-F09-C4 Section names contain their labels                     | "Section 1 name"                                                                                         | "Section name — section 1"                                                                                                                                                                                                 | B25                                  | WCAG 2.5.3                                     | `components/locations/menu/section-editor.tsx`                                                                                                                                   |
| p3-F09-C5 / F13-C2 Read-only menu matches hours                  | Own banner title; no view-only bar; "Start one here" for viewers                                         | `editorGate` banner, `readOnlyReason` bar, empty-state "start" sentence only for editors                                                                                                                                   | B36                                  | Nielsen 4, 2                                   | `menu-tab.tsx`                                                                                                                                                                   |
| p3-F10-C1 Name both kinds of invitation                          | "Pending invitations"; "0 waiting"                                                                       | "Invitations to answer"; "N not yet accepted"; "waiting for the connected Google login"; "waiting for your answer"                                                                                                         | B26                                  | Nielsen 2, 1                                   | `administration/administration-tab.tsx`, `administration/invitations.tsx`                                                                                                        |
| p3-F10-C2 One set of footer buttons per step                     | One button eased across variants                                                                         | Keyed `Fragment` per step                                                                                                                                                                                                  | B27                                  | WCAG 1.4.3 (transient); release-gate stability | `administration/invite-sheet.tsx`                                                                                                                                                |
| p3-F10-C3 Say what role and scope grant                          | Labels only                                                                                              | `FieldDescription` per choice                                                                                                                                                                                              | B28                                  | Nielsen 5; HIG clarity                         | `invite-sheet.tsx`                                                                                                                                                               |
| p3-F10-C4 Email checked on blur or submit                        | Error on the first keystroke                                                                             | `emailTouched` on blur or Enter; `noValidate`                                                                                                                                                                              | B28                                  | WCAG 3.3.1, 4.1.3                              | `invite-sheet.tsx`                                                                                                                                                               |
| p3-F10-C5 Saved access work before the danger zone               | After Danger zone                                                                                        | `after` slot: roster, saved work, then rules, Team note, Danger zone, inside the same provider and gates                                                                                                                   | B29                                  | HIG hierarchy; Nielsen 6                       | `administration/access-workspace.tsx`, `administration-tab.tsx`                                                                                                                  |
| p3-F11-C1 Explain a failed preview in its dialog                 | One generic sentence; open review marked stale                                                           | `previewProblem` per code, on the field or as a form error, with `NOTHING_SAVED`; `scoped` previews keep the page error; only own-destination codes stay in the dialog (review P2-1)                                       | B30                                  | Nielsen 9, 1; WCAG 3.3.1, 3.3.3                | `administration/danger-zone.tsx`, `administration/use-lifecycle.ts`, `administration/lifecycle-workspace.tsx`                                                                    |
| p3-F11-C2 Honest names; forgiving destination                    | "Delete this location"; raw `accounts/…` only; error on first key                                        | "Request deletion"; dialog titles name the listing; bare ID prefixed then checked by the same schema; hint; error on blur or Enter                                                                                         | B31                                  | Nielsen 2, 5; WCAG 3.3.2                       | `danger-zone.tsx`                                                                                                                                                                |
| p3-F11-C3 Ended state has a way forward; said once               | No action; caveat dropped; reason three times                                                            | Search/Maps caveat for deletion; "Open Google connections" (was "Remove from NabaPresence" before review P2-2) and "See the saved outcome"; short `DangerGateNote` reasons                                                 | B31, B32                             | Nielsen 3, 8, 9                                | `administration-tab.tsx`, `danger-zone.tsx`                                                                                                                                      |
| p3-F11-C4 (partly) Accurate send-paused reason                   | Same sentence for every cause                                                                            | `sendPaused` names access change, loading or permissions; plain danger-zone description. "lifecycle" wording kept                                                                                                          | B32                                  | Nielsen 1, 9                                   | `lifecycle-workspace.tsx`, `administration/lifecycle-review.tsx`, `danger-zone.tsx`                                                                                              |
| p3-F12-C1 / F04-C4 Booking loading label                         | "action links"                                                                                           | "booking links"                                                                                                                                                                                                            | B33 (LST-31 regression)              | Nielsen 4                                      | `app/(dashboard)/listings/[id]/booking/page.tsx`                                                                                                                                 |
| p3-F12-C2 / F13-C3 Booking read view                             | Greyed form and row actions; "Add a booking link below"                                                  | `bookingViewOnly` (no canonical edit and a write reason): no add form or row actions, "Google shows no booking links on this listing."                                                                                     | B34 (LST-27)                         | Nielsen 4, 8                                   | `components/locations/booking-tab.tsx`                                                                                                                                           |
| p3-F12-C3 Booking-link words for server errors                   | Server text shown verbatim                                                                               | `bookingLinkMessage` maps known codes; unknown codes keep the server's message                                                                                                                                             | B33                                  | Nielsen 2, 9                                   | `place-actions/use-place-action-review.ts`                                                                                                                                       |
| p3-F12-C4 Honest close; actionable alerts                        | "Keep editing"; no action on the paused alert; raw `(create)`                                            | "Done" when settled, else "Close for now" plus where it is kept; "Check this change on Google"; "Open saved outcome"; "Go to saved booking link work"; operation words                                                     | B35                                  | Nielsen 2, 3, 9                                | `booking-tab.tsx`, `place-actions/place-action-approval-sheet.tsx`, `place-actions/saved-place-action-work.tsx`                                                                  |
| p3-F12-C5 URL hint and confirm labels                            | Placeholder only; "Prepare removal review"                                                               | Visible hint; "Remove this {type} link?", "Review removal", "Review preferred link"                                                                                                                                        | B35                                  | WCAG 3.3.2; Nielsen 4                          | `booking-tab.tsx`                                                                                                                                                                |
| p3-F13-C1 Read-only banner says what to do                       | Why only                                                                                                 | `ASK_OWNER_OR_ADMIN` appended for a role limit (not billing); `LocationTab` uses the same constant, rendered copy unchanged                                                                                                | B36                                  | Nielsen 9; HIG consistency                     | `lib/editors/gate.ts`, `components/locations/location-tab.tsx`                                                                                                                   |
| p3-F13-C4 Overview tells read-only roles the truth               | "Review" verb; editor-only Areas line; no who-can on verification                                        | "View" for a role that can't edit canonical data; read-only Areas line; "An owner or admin can start verification."                                                                                                        | B36                                  | Nielsen 2, 4                                   | `components/listings/area-cards.tsx`, `listing-overview.tsx`                                                                                                                     |
| p3-F13-C5 People denied card stops repeating                     | "Owners and admins" three times                                                                          | People description leads with why and the way forward; Verification copy byte-identical                                                                                                                                    | B37                                  | Nielsen 8                                      | `administration/administration-denied.tsx`                                                                                                                                       |

Paths without a folder are under `components/locations/` (or
`components/locations/profile/` for `sections/`). Tests were updated or added
in each commit (`tests/components/*`, `tests/editor-gate.test.ts`,
`tests/hours-notes.test.ts`, `tests/hours-presentation.test.ts`,
`tests/server/streamed-tab.test.ts`). `c446412a` updates e2e assertions for the
changed copy and for Review now being enabled (five assertions in
`gbp-management-tabs.spec.ts`, plus `listings.spec.ts`); the booking and people
commits also touch `place-actions-backend.spec.ts`, `lifecycle-backend.spec.ts`
and `administration-access-recovery.spec.ts`. No send or publish assertion was
removed.

## Screenshot pairs

**How they were captured.** BEFORE was shot from a clean detached worktree at
`e4123d25`, AFTER from the branch head `46301fa4`, with the same script
(`capture/run-capture.sh`), fixtures ("Sprint 5 Journey" tenants), viewports
(390 light, 390 dark, 1280 light) and steps: a production build, a throwaway
PostgreSQL cluster, the Google stub, and Chromium shots (full page at 390;
the top 860 px only at 1280). The
tenants are reseeded per run, so the listing names differ ("Stub location
6e6edc4b" before, "Stub location 0da15fe2" after); that is fixture data, not a
change. One BEFORE interaction step (03, opening the quick look) failed on
the first pass because its locator was too narrow. It was reshot on the same
BEFORE harness after the locator was aligned with `desk-quick-look.spec.ts`
(a click on the row itself), which is the locator the AFTER run used. See the
tail of `evidence/before/capture-run.log` and the `CAPTURE-NOTES.md` in each
evidence folder. Paths are relative to this file.

| State               | Before 390 light                                                          | After 390 light                                                         | Before 390 dark                                                         | After 390 dark                                                        | Before 1280                                                      | After 1280                                                     |
| ------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| 01 Board            | ![01 before 390 light](evidence/before/01-board-390-light.webp)           | ![01 after 390 light](evidence/after/01-board-390-light.webp)           | ![01 before 390 dark](evidence/before/01-board-390-dark.webp)           | ![01 after 390 dark](evidence/after/01-board-390-dark.webp)           | ![01 before 1280](evidence/before/01-board-1280.webp)            | ![01 after 1280](evidence/after/01-board-1280.webp)            |
| 02 Board, no match  | ![02 before 390 light](evidence/before/02-board-no-match-390-light.webp)  | ![02 after 390 light](evidence/after/02-board-no-match-390-light.webp)  | ![02 before 390 dark](evidence/before/02-board-no-match-390-dark.webp)  | ![02 after 390 dark](evidence/after/02-board-no-match-390-dark.webp)  | ![02 before 1280](evidence/before/02-board-no-match-1280.webp)   | ![02 after 1280](evidence/after/02-board-no-match-1280.webp)   |
| 03 Board quick look | —                                                                         | —                                                                       | —                                                                       | —                                                                     | ![03 before 1280](evidence/before/03-board-quick-look-1280.webp) | ![03 after 1280](evidence/after/03-board-quick-look-1280.webp) |
| 04 Overview         | ![04 before 390 light](evidence/before/04-overview-390-light.webp)        | ![04 after 390 light](evidence/after/04-overview-390-light.webp)        | ![04 before 390 dark](evidence/before/04-overview-390-dark.webp)        | ![04 after 390 dark](evidence/after/04-overview-390-dark.webp)        | ![04 before 1280](evidence/before/04-overview-1280.webp)         | ![04 after 1280](evidence/after/04-overview-1280.webp)         |
| 05 Overview, viewer | ![05 before 390 light](evidence/before/05-overview-viewer-390-light.webp) | ![05 after 390 light](evidence/after/05-overview-viewer-390-light.webp) | ![05 before 390 dark](evidence/before/05-overview-viewer-390-dark.webp) | ![05 after 390 dark](evidence/after/05-overview-viewer-390-dark.webp) | ![05 before 1280](evidence/before/05-overview-viewer-1280.webp)  | ![05 after 1280](evidence/after/05-overview-viewer-1280.webp)  |
| 06 Profile          | ![06 before 390 light](evidence/before/06-profile-390-light.webp)         | ![06 after 390 light](evidence/after/06-profile-390-light.webp)         | ![06 before 390 dark](evidence/before/06-profile-390-dark.webp)         | ![06 after 390 dark](evidence/after/06-profile-390-dark.webp)         | ![06 before 1280](evidence/before/06-profile-1280.webp)          | ![06 after 1280](evidence/after/06-profile-1280.webp)          |
| 07 Hours            | ![07 before 390 light](evidence/before/07-hours-390-light.webp)           | ![07 after 390 light](evidence/after/07-hours-390-light.webp)           | ![07 before 390 dark](evidence/before/07-hours-390-dark.webp)           | ![07 after 390 dark](evidence/after/07-hours-390-dark.webp)           | ![07 before 1280](evidence/before/07-hours-1280.webp)            | ![07 after 1280](evidence/after/07-hours-1280.webp)            |
| 08 Hours day sheet  | ![08 before 390 light](evidence/before/08-hours-day-sheet-390-light.webp) | ![08 after 390 light](evidence/after/08-hours-day-sheet-390-light.webp) | ![08 before 390 dark](evidence/before/08-hours-day-sheet-390-dark.webp) | ![08 after 390 dark](evidence/after/08-hours-day-sheet-390-dark.webp) | ![08 before 1280](evidence/before/08-hours-day-sheet-1280.webp)  | ![08 after 1280](evidence/after/08-hours-day-sheet-1280.webp)  |
| 09 Hours, viewer    | ![09 before 390 light](evidence/before/09-hours-viewer-390-light.webp)    | ![09 after 390 light](evidence/after/09-hours-viewer-390-light.webp)    | ![09 before 390 dark](evidence/before/09-hours-viewer-390-dark.webp)    | ![09 after 390 dark](evidence/after/09-hours-viewer-390-dark.webp)    | ![09 before 1280](evidence/before/09-hours-viewer-1280.webp)     | ![09 after 1280](evidence/after/09-hours-viewer-1280.webp)     |
| 10 Menu             | ![10 before 390 light](evidence/before/10-menu-390-light.webp)            | ![10 after 390 light](evidence/after/10-menu-390-light.webp)            | ![10 before 390 dark](evidence/before/10-menu-390-dark.webp)            | ![10 after 390 dark](evidence/after/10-menu-390-dark.webp)            | ![10 before 1280](evidence/before/10-menu-1280.webp)             | ![10 after 1280](evidence/after/10-menu-1280.webp)             |
| 11 Menu, member     | ![11 before 390 light](evidence/before/11-menu-member-390-light.webp)     | ![11 after 390 light](evidence/after/11-menu-member-390-light.webp)     | ![11 before 390 dark](evidence/before/11-menu-member-390-dark.webp)     | ![11 after 390 dark](evidence/after/11-menu-member-390-dark.webp)     | ![11 before 1280](evidence/before/11-menu-member-1280.webp)      | ![11 after 1280](evidence/after/11-menu-member-1280.webp)      |
| 12 People           | ![12 before 390 light](evidence/before/12-people-390-light.webp)          | ![12 after 390 light](evidence/after/12-people-390-light.webp)          | ![12 before 390 dark](evidence/before/12-people-390-dark.webp)          | ![12 after 390 dark](evidence/after/12-people-390-dark.webp)          | ![12 before 1280](evidence/before/12-people-1280.webp)           | ![12 after 1280](evidence/after/12-people-1280.webp)           |
| 13 People, invite   | ![13 before 390 light](evidence/before/13-people-invite-390-light.webp)   | ![13 after 390 light](evidence/after/13-people-invite-390-light.webp)   | ![13 before 390 dark](evidence/before/13-people-invite-390-dark.webp)   | ![13 after 390 dark](evidence/after/13-people-invite-390-dark.webp)   | ![13 before 1280](evidence/before/13-people-invite-1280.webp)    | ![13 after 1280](evidence/after/13-people-invite-1280.webp)    |
| 14 Booking          | ![14 before 390 light](evidence/before/14-booking-390-light.webp)         | ![14 after 390 light](evidence/after/14-booking-390-light.webp)         | ![14 before 390 dark](evidence/before/14-booking-390-dark.webp)         | ![14 after 390 dark](evidence/after/14-booking-390-dark.webp)         | ![14 before 1280](evidence/before/14-booking-1280.webp)          | ![14 after 1280](evidence/after/14-booking-1280.webp)          |
| 15 Booking, viewer  | ![15 before 390 light](evidence/before/15-booking-viewer-390-light.webp)  | ![15 after 390 light](evidence/after/15-booking-viewer-390-light.webp)  | ![15 before 390 dark](evidence/before/15-booking-viewer-390-dark.webp)  | ![15 after 390 dark](evidence/after/15-booking-viewer-390-dark.webp)  | ![15 before 1280](evidence/before/15-booking-viewer-1280.webp)   | ![15 after 1280](evidence/after/15-booking-viewer-1280.webp)   |
| 16 Booking, add     | ![16 before 390 light](evidence/before/16-booking-add-390-light.webp)     | ![16 after 390 light](evidence/after/16-booking-add-390-light.webp)     | ![16 before 390 dark](evidence/before/16-booking-add-390-dark.webp)     | ![16 after 390 dark](evidence/after/16-booking-add-390-dark.webp)     | ![16 before 1280](evidence/before/16-booking-add-1280.webp)      | ![16 after 1280](evidence/after/16-booking-add-1280.webp)      |
| 17 Profile, invalid | ![17 before 390 light](evidence/before/17-profile-invalid-390-light.webp) | ![17 after 390 light](evidence/after/17-profile-invalid-390-light.webp) | ![17 before 390 dark](evidence/before/17-profile-invalid-390-dark.webp) | ![17 after 390 dark](evidence/after/17-profile-invalid-390-dark.webp) | ![17 before 1280](evidence/before/17-profile-invalid-1280.webp)  | ![17 after 1280](evidence/after/17-profile-invalid-1280.webp)  |

**Observed in the pairs.** Read from the 390 light and 1280 pairs, with the
390 dark pairs checked for contrast and colour. No pair shows an error page, a
skeleton in place of content, horizontal overflow or a dark-theme problem.
The 1280 shots show the top 860 px only, so some differences are visible in
the 390 shots only:

- **06:** the place-ID and County hints, "Additional phones" and the removed
  saved-work sections. At 1280 only the missing "Saved lodging work" entry in
  the section nav shows.
- **12:** the Danger zone's move and new description, and "Request deletion".
- **17:** 06's differences further down the page.

| State               | Visible difference (AFTER vs BEFORE)                                                                                                                                                                                                                                                                                                                                                                           | Change IDs                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 01 Board            | No visible difference (fixture state doesn't exercise it)                                                                                                                                                                                                                                                                                                                                                      | —                                              |
| 02 Board, no match  | Title "No listings match" becomes `No listings match “zzqx”`. Body "Nothing fits this client, health and search together. Widen one of them to see the rest." becomes "Check the spelling, or clear the search to see every listing." Only the search narrows here, so no "Show N matches" button appears; "Clear filters" stays                                                                               | p3-F01-C4                                      |
| 03 Board quick look | The one catch-all reason ("Review the failed check or publish, conflict, change Google made, or missing opening hours.") becomes "Google shows no opening hours for this listing.". The Opening hours area pill "In sync" becomes "No hours on Google", matching the overview                                                                                                                                  | p3-F01-C1                                      |
| 04 Overview         | No visible difference (fixture state doesn't exercise it). The phone Review & publish link needs unpublished work, which the fixture listing doesn't have                                                                                                                                                                                                                                                      | —                                              |
| 05 Overview, viewer | The Areas caption "Check a problem, review changes or edit an area." becomes "Open an area to see what it holds here and on Google.". The cards already said "View" in BEFORE                                                                                                                                                                                                                                  | p3-F13-C4                                      |
| 06 Profile          | Place-ID hints "Local checks validate format only; provider validation and confirmation are separate." become "We check its format here; Google checks the place when you publish.". "Additional phone numbers" becomes "Additional phones". The County hint is shorter. The empty "Saved lodging work" and "Saved service work" sections and their section-nav entries are gone                               | p3-F05-C4, p3-F06-C2                           |
| 07 Hours            | Service hours gains the caption "Separate hours for services such as a kitchen, delivery or takeaway.". "No service schedules are saved." becomes "No service schedules yet."                                                                                                                                                                                                                                  | p3-F08-C5                                      |
| 08 Hours day sheet  | The switch reads "Open on Monday" (was "Open"). Visible "Opens", "Closes" and "Closing day" labels appear. "Open past midnight? Close on the next day." appears with a "Close on Tuesday" button, and "Same day (Monday)" stays selected. "Add split period" becomes "Add another period". With hours in the draft, the "No hours on Google" note says "Review and publish these hours to put them on Google." | p3-F07-C1, p3-F07-C3, p3-F07-C4, p3-F08-C2     |
| 09 Hours, viewer    | The banner adds "Ask an owner or admin if something here needs to change.". The Service hours caption is as in 07                                                                                                                                                                                                                                                                                              | p3-F13-C1, p3-F08-C5                           |
| 10 Menu             | No visible difference (fixture state doesn't exercise it)                                                                                                                                                                                                                                                                                                                                                      | —                                              |
| 11 Menu, member     | Banner title "You can look, but not change this" becomes "…change this menu" and adds "Ask an owner or admin…". The empty state drops "Start one here; nothing reaches Google until you publish." No view-only bar shows in this empty-menu state                                                                                                                                                              | p3-F09-C5 / F13-C2, p3-F13-C1                  |
| 12 People           | "Pending invitations · 0 waiting" becomes "Invitations to answer · 0 waiting for the connected Google login", with new empty-state copy. The header count reads "0 invitations to answer". Saved access work moves above Primary owner rules and the Danger zone. The Danger zone description is reworded. "Delete this location" becomes "Request deletion"                                                   | p3-F10-C1, p3-F10-C5, p3-F11-C2, p3-F11-C4     |
| 13 People, invite   | Role and Scope gain hints ("Edits the listing and replies to reviews. Can’t manage people or remove the listing."; "Only this listing."). "Enter a valid email address." shows on both sides after Tab. The page behind shows 12's changes                                                                                                                                                                     | p3-F10-C3 (p3-F10-C4 not distinguishable)      |
| 14 Booking          | The Link field gains the hint "The full address of your booking page, starting with https://"                                                                                                                                                                                                                                                                                                                  | p3-F12-C5                                      |
| 15 Booking, viewer  | The greyed "Add a booking link" form is gone. The empty state "Add a booking link below…" becomes "Google shows no booking links on this listing.". The banner adds "Ask an owner or admin…"                                                                                                                                                                                                                   | p3-F12-C2 / F13-C3, p3-F13-C1                  |
| 16 Booking, add     | The same Link hint as 14 shows under `example.com/book`. The "Ready to review" bar is unchanged                                                                                                                                                                                                                                                                                                                | p3-F12-C5                                      |
| 17 Profile, invalid | Top of the page: no visible difference. The emptied Business name shows only the "Changed" tag on both sides, and "Review changes" looks the same, because the error summary needs a press of Review, which the capture doesn't make. Further down, the page shows 06's differences                                                                                                                            | p3-F05-C4, p3-F06-C2 (p3-F05-C1 not exercised) |

Some differences are capture timing or fixture, not changes. At 390 the area
title's underline varies between runs (in 11 it is plain BEFORE and underlined
AFTER; in 15 it is the other way round). Mobile full-page shots paint the
docked tab bar and action bars partway down the page, on both sides. The
profile's docked "1 change not on Google · unsave…" text is truncated at 390
on both sides.

The fixture can't show these changes; they are covered by component tests only:

- A state the fixture lacks: a disconnected or unlinked listing (p3-F03-C1); unpublished work, for the phone Review & publish link (p3-F03-C2); a failed publish or a recorded publish area (p3-F03-C3, p3-F03-C5); a failed summaries read or failed board load (p3-F01-C2); a failed Google check (p3-F04-C3); a `google_dirty` schedule (p3-F08-C1); special days and a non-local time zone (p3-F08-C3, p3-F08-C4); a menu draft being emptied or one with sections (p3-F09-C1 to C4); a failed or ended lifecycle preview (p3-F11-C1, p3-F11-C3); booking server errors and approval outcomes (p3-F12-C3, p3-F12-C4); the People denied card (p3-F13-C5).
- A step the capture doesn't take: selection (p3-F02-C2 to C4); the profile error summary, attribute checks, field-tag variants and saved-review names (p3-F05-C1, p3-F05-C2, p3-F06-C1, p3-F06-C3, p3-F06-C5); "Copy to…" (p3-F07-C2); loading states (p3-F03-C4 / F04-C4, p3-F12-C1); the invite sheet's step footers (p3-F10-C2).
- Not visible in a still image: announcements, focus moves and accessible names (p3-F01-C3, p3-F05-C5, and the focus parts of p3-F01-C4 and p3-F02-C3).

## Core preservation

| Protected rule                                                        | How it stays intact                                                                                                                                                                                      | Evidence                                                                                                                             |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Server actions, route handlers, contracts, RPCs, schema, dependencies | Nothing changed under `app/api`, `lib/server`, `lib/contracts` or `supabase/`, nor `package.json` or the lockfile. Query keys, invalidations and request payloads are unchanged                          | `git diff --stat e4123d25..HEAD -- app/api lib/server lib/contracts supabase package.json pnpm-lock.yaml` is empty; reviewer's check |
| Shared primitives                                                     | No change under `components/ui`, `components/editors`, `components/reviewed-write`, `components/app-shell`, `lib/ui`, `lib/listings/area-nav.ts` or `app/globals.css`                                    | Same diff check on those paths is empty                                                                                              |
| Edit vs publish split; revision checks                                | "Save here" still posts `expectedCanonicalRevision`; publish still goes through review with `confirmOverwriteGoogleChanges` and an `intentId`. "Keep Google’s hours" only fills the draft                | Diff; `hours-tab.tsx:329-333,370-372`; reviewer item 3                                                                               |
| Nothing invalid reaches review                                        | Review is enabled on invalid profile fields, but `review()` returns early while `issues.blocking`; `prepareReview` still parses with `businessInformationPayloadSchema` and `googleAttributeWriteSchema` | `profile-editor.tsx:1025,1035-1036,1054,1065`; component tests assert no preview request; reviewer item 2                            |
| Two-person approval                                                   | `waitsForApprover`, `requiresSecondApprover` and the stale-fingerprint check are unchanged apart from copy                                                                                               | Diff; reviewer item 2                                                                                                                |
| Role gates and capabilities                                           | `area-nav.ts` untouched. Booking's read view needs both no canonical edit and a write reason, so no role loses a working control; a member with publish rights keeps the editor (see follow-up 12)       | `booking-tab.tsx:161`; reviewer item 4                                                                                               |
| Overwrite consent on Google-changed fields                            | `needsAck` unchanged; the field tags are display only                                                                                                                                                    | `profile-editor.tsx:587,738,1204`                                                                                                    |
| Lifecycle typed name, consent, one-action lock                        | `LifecycleReview` gates untouched; the `claim` lock unchanged; the bare-ID prefix result is checked by the same schema before preview                                                                    | `use-lifecycle.ts:133-165`; `lifecycle-review.tsx:198-212`; reviewer item 5; P2-1 regression test                                    |
| Open lifecycle reviews blocked when the server would refuse           | Scoped previews still block an open review for connection, source and publishing codes                                                                                                                   | `use-lifecycle.ts:44-48,146-157`; test "still holds an open deletion review…" (fails without the fix)                                |
| Danger zone gates after the move                                      | `after` renders inside the same `AdministrationProvider` with the same composed `publishReason` and `disabled`                                                                                           | `access-workspace.tsx`; reviewer item 6                                                                                              |
| Invitations as reviewed writes                                        | Same `ReviewedWriteSheet` steps; only the footer fragments are keyed                                                                                                                                     | `invite-sheet.tsx:217`                                                                                                               |
| Place-action chain and hash checks                                    | `preflight`, claim and unsafe refs, `send` guard and stale handling identical; only display messages added                                                                                               | Reviewer item 1                                                                                                                      |
| Bulk cap and server preview                                           | Selection logic and the hand-off URL unchanged; the new bar words are local counts, and what a change skips is still the server preview's to say                                                         | `listings-board.tsx:650,966,975`; reviewer item 8                                                                                    |
| Unassigned member 404                                                 | `ListingGate` still calls `notFound()`; only its pending shape changed                                                                                                                                   | `listing-gate.tsx:74`                                                                                                                |
| Server authority                                                      | No new success copy before a server answer. Booking says "Done" only for a rejected or independently confirmed outcome; Keep Google's hours says "Nothing is saved yet"                                  | Diff; `place-action-approval-sheet.tsx` `settled`                                                                                    |

## Verification

Environment: macOS, worktree `/tmp/naba-presence-p3`. Final results are on the
code head `46301fa4` (later commits add only this report and its evidence).
The first e2e batches ran before the review-fix commit `25839c91`; the specs
those fixes touch, touch and a11y were rerun on `46301fa4` after a fresh
production build (rows marked "head").

| Check                                                                                                                                                                                                                   | Level                                       | Result                        | Notes                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm verify` (typecheck, lint, format:check, unit and component, design ratchet)                                                                                                                                       | source + unit                               | **Passed**                    | Head `46301fa4`: 623 test files passed, 1 skipped; 8,550 tests passed, 1 skipped (8,546 before the review fixes and their tests)                                                                                         |
| `pnpm check:design --ratchet`                                                                                                                                                                                           | source                                      | **Passed**                    | No file or rule count rose                                                                                                                                                                                               |
| `pnpm check:contrast`                                                                                                                                                                                                   | source                                      | **Passed**                    | All 212 pairs clear in both themes                                                                                                                                                                                       |
| `pnpm exec tsc --noEmit`, `eslint --max-warnings 0` on changed files, `vitest run` on 26 changed or related test files (reviewer, read-only)                                                                            | source + unit                               | **Passed**                    | 26 files, 442 tests, on `0d3a4852`                                                                                                                                                                                       |
| Review-fix tests: Keep Google's hours (three cases), lifecycle scoped preview (one case)                                                                                                                                | unit                                        | **Passed**                    | The lifecycle case was mutation-checked: it fails without the fix. Board focus fix (P3-1): two focus assertions added in `46301fa4`                                                                                      |
| `PLAYWRIGHT_PORT=3530 pnpm test:e2e:touch`                                                                                                                                                                              | fixture-browser                             | **Passed**                    | 23 passed; head rerun 23 passed                                                                                                                                                                                          |
| `PLAYWRIGHT_PORT=3530 pnpm test:a11y`                                                                                                                                                                                   | fixture-browser                             | **Passed**                    | 64 passed; head rerun 64 passed                                                                                                                                                                                          |
| `listings`, `gbp-management-tabs`, `desk-quick-look`, `place-actions-backend` specs                                                                                                                                     | fixture-browser (throwaway DB, Google stub) | **Failed → fixed → Passed**   | 113 passed, 1 failed: the keyboard-only service-area case (`gbp-management-tabs.spec.ts:1370`), because the new finder link sat between the field and "Add service area". Fixed in `0d3a4852`; rerun of that case passed |
| `gbp-management-tabs.spec.ts:1370`, `lifecycle-backend`, `administration-access-backend`, `administration-access-recovery`, `services-backend`, `lodging-complete-backend`, `lodging-recovery-backend`, `business-mode` | fixture-browser (throwaway DB, Google stub) | **Passed**                    | 68 passed                                                                                                                                                                                                                |
| `operations-features`, `journeys`, `touch-critical`                                                                                                                                                                     | fixture-browser (throwaway DB, Google stub) | **Passed**                    | 51 passed                                                                                                                                                                                                                |
| Head rerun: `listings`, `lifecycle-backend`, `administration-access-recovery`, `administration-access-backend`, `desk-quick-look`                                                                                       | fixture-browser (throwaway DB, Google stub) | **Passed**                    | 70 passed, on `46301fa4` after the review fixes                                                                                                                                                                          |
| BEFORE and AFTER captures (`tests/visual/shoot.mjs` + `capture/capture-interactions.mjs.txt`)                                                                                                                           | fixture-browser (throwaway DB, Google stub) | **Passed**                    | 49 images each side, all HTTP 200, no horizontal overflow, no console errors; one BEFORE step reshot (see [Screenshot pairs](#screenshot-pairs))                                                                         |
| `pnpm test:integration`                                                                                                                                                                                                 | DB                                          | **Not run**                   | No server or database code changed; component tests cover the client changes                                                                                                                                             |
| Publishing to real Google, live Google reads                                                                                                                                                                            | provider                                    | **Not run**                   | Every browser run used the stub; nothing was published                                                                                                                                                                   |
| Real-device VoiceOver or TalkBack                                                                                                                                                                                       | manual                                      | **Not run**                   |                                                                                                                                                                                                                          |
| `audit:mobile`, perf-lab, route JS                                                                                                                                                                                      | measurement                                 | **Not run**                   | No tap, height, timing or bundle claims are made                                                                                                                                                                         |
| `lci`                                                                                                                                                                                                                   | CI                                          | **Not run** in this area pass | One run on the final combined head                                                                                                                                                                                       |

## Review response

An independent reviewer with fresh context reviewed every commit except the
Prettier one, on head `0d3a4852` ([`REVIEW.md`](REVIEW.md)). It found
no P0. Fixes landed in `25839c91`.

| Finding                                                                                | Disposition                                                                                                                                                                                                                                                | Evidence                                                                                                          |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| P1-1 "Keep Google’s hours" could overwrite edits made while Google was read            | **Fixed.** The click snapshots the draft; if the draft changed during the read, nothing is applied and the form says "You edited the hours while Google was being read, so your draft was left as it is." The button is only offered with no unsaved edits | `hours-tab.tsx`; tests "never puts Google’s hours over unsaved edits", "leaves an edit made while Google is read" |
| P2-1 Scoped lifecycle preview stopped flagging an open review the server will refuse   | **Fixed.** Only own-destination codes (`destination_*`, `destination_matches_source`) stay in the dialog; others also block the open review                                                                                                                | `use-lifecycle.ts`; test "still holds an open deletion review…", mutation-checked                                 |
| P2-2 "Remove from NabaPresence" led to a page that can only disconnect the whole login | **Fixed.** Relabelled "Open Google connections"                                                                                                                                                                                                            | `administration-tab.tsx`; `access-tab.test.tsx:814`                                                               |
| P3-1 "Show N matches" and "Clear filters" dropped focus                                | **Fixed.** Focus moves to the search field                                                                                                                                                                                                                 | `listings-board.tsx`; focus assertions in `listings-board.test.tsx` (`46301fa4`)                                  |
| P3-2 Keep Google's hours: empty read empties the draft; toast may claim a change       | **Partly fixed.** An empty read now leaves the draft and says why. A read that matches the saved schedule still shows the "in your draft" toast                                                                                                            | Test "doesn’t empty the draft when Google now shows no hours"; follow-up 8                                        |
| P3-3 Footer "Changed on Google · saved here" for a clean Google change                 | **Left.** Needs a `where` override in the shared editor footer                                                                                                                                                                                             | Follow-up 9                                                                                                       |
| P3-4 One failed Google check announced twice (popover and header)                      | **Left.** Shared `GoogleFreshnessFailure`                                                                                                                                                                                                                  | Follow-up 10                                                                                                      |
| P3-5 "Additional address details" summary link always targets the language field       | **Left**                                                                                                                                                                                                                                                   | Follow-up 11                                                                                                      |
| P3-6 Booking editor offered to a member with a publish grant whom the server refuses   | **Left**, pre-existing; product decision                                                                                                                                                                                                                   | Follow-up 12                                                                                                      |

## Shared-file edits

- **`components/listings/area-frame.tsx`** (shared by p3 and p4): three hunks.
  It imports `QueryPending`; it renders `<GoogleFreshnessFailure report={freshness} />`
  in the status popover, which draws only after a failed check; and it
  replaces `AreaEditorLoading`'s grey block with
  `<QueryPending label="Loading this page…" />`. For p4's photos, posts,
  changes, suggestions and verification, only the loader and the
  failed-check line change.
- **`components/listings/listing-gate.tsx`, `listing-skeleton.tsx`,
  `app/(dashboard)/listings/[id]/loading.tsx`**: used by every listing area
  page, p4's included. One announced loading shape (`role="status"`,
  "Loading this listing…" or "Loading this page…").
- **`lib/editors/gate.ts`**: a role-limited reason gains
  `ASK_OWNER_OR_ADMIN`. Callers are hours, profile, menu and booking (all p3).
  The billing case is unchanged.
- **`components/locations/location-tab.tsx`**: uses the constant; the
  rendered copy is unchanged.
- **`components/locations/administration/administration-denied.tsx`**: the
  People copy changed. Verification's (p4) copy is byte-identical and pinned
  by a test.
- **`components/locations/activity-panel.tsx`**: the empty-state copy also
  shows in the Activity drawer on every listing page.
- **`lib/editors/hours-notes.ts`, `lib/editors/hours-presentation.ts`**:
  hours only. `validateHours` gains an optional second argument; Review &
  publish imports other functions from the same file, which are unchanged.
- **e2e specs**: `gbp-management-tabs.spec.ts` (five Review-enabled
  assertions, lifecycle labels, and the whole-file Prettier reformat: a
  merge-conflict risk for any other area editing it), `listings.spec.ts` (two
  places), `place-actions-backend.spec.ts`, `lifecycle-backend.spec.ts`,
  `administration-access-recovery.spec.ts`.

## Outcome and follow-ups

**Done.** Every p3 flow got a small set of presentation, copy, focus and state
changes tied to a source-level problem. Server behaviour, contracts, gates and
approvals are unchanged, and the change set passed the gates and the affected
fixture-browser suites listed above. Of the prior audit's open listing items,
the LST-06 remainder is closed by an alternative, the LST-31 loading-label
regression is fixed, and LST-27's booking and menu gaps are closed. DSK-05's
remainder is still open.

**No measured-improvement claims.** Taps, heights, timings and completion
were not measured; H1–H5 stay hypotheses until they are.

**Follow-ups (not done here):**

1. **F02-C1, skipped.** Keep the board selection across the bulk hand-off
   (`?selected=`). It crosses into p4's bulk page (`bulk-compose.tsx` "Back to
   listings" and "Go back and select fewer.").
2. **F04-C1, not done as proposed.** Follow-up 26 asked for the time zone in
   the shared meta row. This branch makes it the Regular hours caption
   instead (F08-C3). If the owner wants the literal meta-row slot, it needs an
   opt-in in `area-frame.tsx` and `google-freshness.tsx`.
3. **F04-C2, skipped: DSK-05 remainder (follow-up 22).** Drop the listing
   crumb on business-workspace area pages. Needs the shared app shell and
   `lib/ui/breadcrumb-trail.ts`, and an owner decision for the agency trail.
4. **F05-C3, skipped.** Visible, announced progress while a profile review is
   prepared ("Preparing the exact review." is still a muted note). Needs an
   opt-in prop on the shared editor footer.
5. **F06-C4, skipped.** One entry point per saved service or lodging review:
   the section's per-review buttons and the saved-work list still both exist.
6. **F08 optional reorder, skipped.** Special hours above Service hours
   (hypothesis F08 #9); check with phone screenshots first.
7. **F11-C4 remainder.** Removing "lifecycle" from the danger-zone, review and
   outcome copy (RC-COPY) was dropped: about 27 e2e assertions depend on it.
8. **Review P3-2 remainder.** When Google's fresh read matches the saved
   schedule, say "Google now matches the saved hours" instead of the "in your
   draft" toast.
9. **Review P3-3.** Hours footer reads "Changed on Google · saved here" for a
   clean Google-side change; needs a `where` override in
   `components/editors/editor-footer.tsx` (shared).
10. **Review P3-4.** A failed Google check is announced twice (popover and
    header line); give one copy no live role, or show the header copy only
    while the popover is closed.
11. **Review P3-5.** The "Additional address details" summary link always
    targets the language field; carry the failing sub-path through
    `fieldErrorsFromPayload`.
12. **Review P3-6 (pre-existing, product decision).** A member with a publish
    grant gets the booking editor, but the server allows only owners and
    admins to change booking links (`lib/server/place-action-review-state.ts:19`).
13. **LST-31 server strings.** Server messages still say "action link" and
    "Place Action". The client maps known codes; an unknown code still shows
    the server's words.
14. **Pre-existing bug.** `fieldErrorsFromPayload`
    (`lib/locations/business-information-draft.ts`) doesn't unwrap zod union
    errors, so an invalid address language shows as "Address: Invalid input".
15. **Test gaps.** No e2e covers board search and no-match, Keep Google's
    hours (no `google_dirty` stub state exists), the overnight hint, or a
    menu edit end to end; these are component-tested only.
16. **Capture harness.** The visual harness's `naba_visual` database is
    missing from the local Supabase on this Mac (another project's cluster
    holds :54322), so this capture used a throwaway cluster
    ([`capture/run-capture.sh`](capture/run-capture.sh)). Restoring
    `naba_visual`, or teaching `tests/visual/with-visual-db.sh` to use
    `scripts/ci/postgres.mjs`, would let every area use the stock harness.
    Pre-existing in both captures: the docked bar text on 17 at 390 is cut
    off ("1 change not on Google · unsave…").
17. **Out of scope in the analyses**, for their owners:
    - board town search and health-chip toggling (F01);
    - focus after "File under…" (F02);
    - opening Activity from the failed-publish alert, and the Activity drawer's
      "location" wording (F03, shared);
    - "Use Google's version" for profile conflicts, and a leave guard for
      services and lodging drafts (F05);
    - a note on the mixed profile footer, the shared reviewed-write vocabulary
      ("observation", "Read saved … outcome"), deadline-first saved-work
      lines, and a place search (F06);
    - an Undo on the copy toast, and the save-failure alert's title (F07);
    - keeping Google's version for `conflict` (F08, product decision);
    - showing menu-item attributes (F09);
    - "Withdraw invitation" wording for pending rows, and People's mobile
      LCP and JS budgets (follow-up 29) (F10);
    - per-code server preflight messages and an account picker (F11, API);
    - a real result on saved booking rows (contract field) and "Leave without
      saving?" wording for review-only editors (F12, shared);
    - hiding the People pill and model note from non-managers, "Ask for
      access" on the denied card (with p4), and the doubled read-only banner
      and footer sentence on hours and profile (F13).
