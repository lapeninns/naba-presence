# p3-F04: Move between a listing's areas via the area header

Code: `/tmp/naba-presence-p3` @ `e4123d25` (branch `ux/flows-presence-p3`, after #258). Read-only analysis.

## 1. Flow

- **ID / name:** p3-F04, move between a listing's areas via the area header.
- **Goal:** from any area of one listing, reach another area, another listing of the same client, Review & publish or Activity without losing your place, and know where changes go and how fresh the Google read is.
- **Start:** any area route `/listings/{id}/{profile|hours|booking|menu|people|…}`. The layout reads capabilities and the DB summary behind its own Suspense (`app/(dashboard)/listings/[id]/layout.tsx:23-53`), and `ListingAreaLayout` wraps the page in one `AreaFrame` that survives area switches (`components/listings/area-frame.tsx:969-991`).
- **End:** the target area's editor is loaded under the same header, the pane is scrolled to the top (`area-frame.tsx:801-804`), and the tab or menu row is marked current (`lib/listings/area-nav.ts:96-151`).
- **Roles:** everyone can open the overview and the non-console areas. People and Verification are for owners and admins only (`area-nav.ts:124`, `lib/listings/areas.ts:137-139`). Review & publish is left out for a role that can't edit, publish or request approval (`area-nav.ts:75-82,137`). Unavailable areas still open, to look (`area-nav.ts:49-66`).

## 2. Code map

| Piece                                                                         | Where                                                                                                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listing layout, Suspense around caps and summary                              | `app/(dashboard)/listings/[id]/layout.tsx:23-53`                                                                                                     |
| Loading boundary: editor card in the frame, full skeleton outside it          | `app/(dashboard)/listings/[id]/loading.tsx:10-20`, `components/listings/area-frame-context.ts:11-15`                                                 |
| Frame providers (in-frame, editor status, freshness slot)                     | `area-frame.tsx:731-748`                                                                                                                             |
| Header composition (phone two rows, desk buttons, tabs, meta row)             | `area-frame.tsx:503-701`                                                                                                                             |
| Desk tab row (`TabNav overflow="more"`, `prefetch="intent"`)                  | `area-frame.tsx:159-181`                                                                                                                             |
| H1 as area switcher (menu of `ShellLink`s, action sheet on phone)             | `area-frame.tsx:191-246`                                                                                                                             |
| Sibling switcher (same client only, keeps area suffix)                        | `components/listings/sibling-switcher.tsx:38-117`; fallback "‹ name" link `area-frame.tsx:555-578`                                                   |
| Status pill: editor's own status, else the summary's, skeleton while it loads | `area-frame.tsx:770-778,806-817,703-714`                                                                                                             |
| "How changes reach Google" sheet (pill or info button)                        | `area-frame.tsx:255-311`                                                                                                                             |
| Meta row from md (model note · last check)                                    | `area-frame.tsx:317-346`, `components/editors/google-freshness.tsx:53-90`                                                                            |
| Failed-check line                                                             | `google-freshness.tsx:93-106`, drawn at `area-frame.tsx:698`                                                                                         |
| "Review & publish (n)" header action / phone overflow                         | `area-frame.tsx:358-383,391-482,677-685`                                                                                                             |
| Summary re-read when the editor's state moves                                 | `area-frame.tsx:784-797`                                                                                                                             |
| Scrolling pane as a named region                                              | `area-frame.tsx:849-858`                                                                                                                             |
| Editors as dynamic imports + `AreaEditorLoading`                              | `area-frame.tsx:874-952`                                                                                                                             |
| Streamed first read (document load only; never on an RSC request)             | `components/listings/streamed-tab.tsx:36-70`; per-area `app/(dashboard)/listings/[id]/*/page.tsx`                                                    |
| Tab pending and error states                                                  | `components/locations/tab-states.tsx:25-92`, `components/locations/location-tab.tsx:169-200`                                                         |
| Desk breadcrumb trail (from `wide`) and phone back                            | `lib/ui/breadcrumb-trail.ts:59-99,160-168`, `components/app-shell/breadcrumbs-context.tsx:33-58,66-69,123-203`, `components/app-shell/topbar.tsx:33` |
| Hours' own time-zone paragraph                                                | `components/locations/hours-tab.tsx:422-428,530-542`                                                                                                 |

**Tests.**

- e2e, `tests/e2e/listings.spec.ts`:
  - "the board lists every listing and the overview shows its areas" opens Hours, then checks the H1 switcher below lg and the Overview tab from lg (`:136-178`).
  - "`{area}` loads clean (light|dark)" does a document load of every area and runs axe (`:181-227`).
  - "read-only views: …" and "publish failure: Review & publish says it once…".
- e2e, `tests/e2e/touch-critical.spec.ts`: "listings: open a listing, edit its profile, and review the change in the sheet".
- e2e, `tests/e2e/routing.spec.ts`: "old location routes land on the listing, owned by Listings in the nav".
- Unit:
  - `tests/components/listing-mobile-navigation.test.tsx` (header, sheet, failed check, LST-27).
  - `tests/components/listing-area-layout.test.tsx` (frame, loading).
  - `tests/components/sibling-switcher.test.tsx`.
  - `tests/components/shell-breadcrumbs.test.tsx` and `tests/breadcrumb-trail.test.ts` (fold, business trail).
  - `tests/server/streamed-tab.test.ts`, `tests/listing-area-nav.test.ts` and `tests/components/hours-tab.test.tsx:164-197` (zone words).
- **Not covered:** a failed "Check Google now" seen from the phone sheet; the business-mode trail on an area page; the area-switch loading state.

## 3. Steps today

1. **Initial (document load of `/listings/{id}/hours`).** The layout's Suspense shows `ListingSkeleton`, which has the area header's shape (`layout.tsx:31`, `listing-skeleton.tsx:10-34`). Then `ListingGate` checks the directory (`listing-gate.tsx`). The header paints with its pill from the DB summary. The editor slot shows `TabLoading`, "Reading the opening hours from Google…", with three skeleton rows and `role=status` (`streamed-tab.tsx:49`, `query-states.tsx:54-88`), until the streamed read lands.
2. **The header shows:**
   - **Phone:** row 1 is the listing name (sibling switcher, or the "name" link) and "⋯" (`area-frame.tsx:599-611`). Row 2 is the H1 "Opening hours ⌄" and the status pill with an ⓘ.
   - **md and up:** the area description, plus the header buttons (links, "Review & publish (n)", Activity) (`:642-692`).
   - **lg and up:** the tab row, with "More areas" overflow (`:695`).
   - **md and up:** one meta row, "Saved here first; nothing reaches Google until you review and publish. · Checked with Google 3 min ago. Check Google now" (`:697`).
   - **Hours only:** inside the editor, "🌐 Times are in **New Zealand time**." as its own row when the listing's zone differs from the viewer's (`hours-tab.tsx:530-542`).
3. **Switch area.**
   - **Desk:** click a tab, or a row in "More areas".
   - **Phone and md–lg:** tap the H1, then pick a row in the "Listing areas" menu or sheet. Unavailable rows are muted, carry their reason and still open (`:212-243`).
   - **Another listing:** use the switcher above the H1. Siblings only, and the area suffix is kept (`sibling-switcher.tsx:59-64,104`).
   - Links go through the leave guard when there are unsaved edits (`listing-mobile-navigation.test.tsx:221`).
4. **In progress (client navigation).** The header stays mounted. `loading.tsx` draws a bare 160 px `Skeleton` (`loading.tsx:13-18`), then `AreaEditorLoading` draws the same block while the chunk loads (`area-frame.tsx:874-881`). The editor's `LocationTab` then shows "Reading the … from Google…" with three rows. `StreamedTab` reads nothing on an RSC request (`streamed-tab.tsx:67`). The pane scrolls to the top (`:801-804`).
5. **Error and retry.**
   - **Capabilities or area read fails:** `TabError` shows "We couldn’t load this section", `describeActionError(...)` + " Nothing was changed.", a **Try again** button and "Details for support" (`tab-states.tsx:76-90`, `location-tab.tsx:185-191`).
   - **Not linked:** the "isn’t linked to Google yet" empty state (`tab-states.tsx:48-66`).
   - **Summary fails:** no pill. Phones keep an ⓘ button (`area-frame.tsx:817,635`).
   - **Directory fails:** the `DirectoryError` alert with retry (`listing-gate.tsx`).
   - **"Check Google now" fails:** the header shows `role=status` "Google couldn’t be checked just now. Try again." (`google-freshness.tsx:100-104`). The retry button is in the meta row (md and up) or only inside the pill's sheet (phone).
6. **Empty.** An area with nothing on Google is the editor's own concern. The pill uses the editor's `emptyOnGoogle` label and never "In sync" while Google is unreachable (`area-frame.tsx:772-778`).
7. **Server-confirmed state.** The pill shows the editor's reported status, otherwise the DB summary's words, the same as the overview card (`:703-714`). When the editor's state moves, the summary is re-read (`:784-797`). "Review & publish (n)" counts saved, unpublished areas from the DB summary, and is hidden while the Google login is broken (`:369-372`).

## 4. Protected rules for this flow

- **Area visibility:** console areas are for owners and admins only (`area-nav.ts:124`). Unavailable areas open read-only and are never `disabled` (`area-nav.ts:49-66`, `area-frame.tsx:150-158`).
- **Review & publish entry points** (row, header button, overflow) are gated by `canReviewChanges` (`area-nav.ts:75-82,137`, `area-frame.tsx:369,411-416`). A direct link still opens it read-only, and the server checks every write.
- **No false sync claim:** "In sync" or empty-on-Google is suppressed while Google is unreachable (`area-frame.tsx:770-778`). Counts come from the DB summary and are never optimistic.
- **Streamed reads never read Google on a client navigation or prefetch** (`streamed-tab.tsx:30-35,67`). A failed prefetch falls back to the client read and never becomes a page error (`:26-28`).
- **The sibling switcher stays inside one client** (`sibling-switcher.tsx:24-26,59-61`), to avoid publishing to the wrong business.
- **Every area link is a real link**, so the editor's leave guard catches it (`area-frame.tsx:186-188`).
- **The phone back target uses the full trail** (`breadcrumbs-context.tsx:51-58`), so it must not lose the listing crumb.

## 5. Prior audit status (15 Oct, `docs/audits/2026-10-15-ux-flows/results.md`)

| ID          | Status                                                   | Evidence                                                                                                                                                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LST-06 (P1) | **Partly fixed, remainder open (follow-up 26)**          | The two-row phone header, H1 switcher, pill sheet and meta row are done (`area-frame.tsx:191-346`). **Open:** the time zone isn't in the meta row. Hours still draws "Times are in …" as its own row (`hours-tab.tsx:530-542`). `AreaMetaLine` has only the note and the last check (`area-frame.tsx:317-346`).                 |
| DSK-05 (P2) | **Partly fixed, business remainder open (follow-up 22)** | Agency trails fold to "Listings / … / Hours" (`breadcrumb-trail.ts:160-168`). **Open:** a business trail is 3 crumbs, so it never folds. "Listings / The Bell / Opening hours" sits over "‹ The Bell" and the H1 "Opening hours ⌄" (`breadcrumb-trail.ts:80-98`, `area-frame.tsx:560-576`, `breadcrumb-trail.test.ts:153-159`). |
| DSK-06      | Fixed                                                    | The overview H1 is the sibling switcher; the client is plain words (`area-frame.tsx:579-583,617-623`).                                                                                                                                                                                                                          |
| DSK-01      | Fixed                                                    | `overflow="more"` (`:163`); Review & publish is a header action (`:677-685`).                                                                                                                                                                                                                                                   |
| LST-14      | Fixed                                                    | Persistent frame in the layout; `StreamedTab` on every area and on `changes`.                                                                                                                                                                                                                                                   |
| LST-27      | Fixed                                                    | Role gate on the header and overflow (`:369,411-416`).                                                                                                                                                                                                                                                                          |
| MEA-04      | Fixed                                                    | Tabs prefetch on intent (`:167`).                                                                                                                                                                                                                                                                                               |
| LST-19      | Fixed for Hours                                          | `formatTimeZoneLabel` (`hours-tab.tsx:425`). The Posts remainder belongs to p4.                                                                                                                                                                                                                                                 |

## 6. Friction

| #   | Problem                                                                                                                                                                                                                                                            | Evidence                                                                                                                                                                                   | Sev               | Heuristic / WCAG                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | From md, Hours still spends a full row on the time zone, under a meta row built to hold short facts like it. This is the open part of LST-06 (follow-up 26).                                                                                                       | `hours-tab.tsx:530-542` "Times are in **New Zealand time**."; `area-frame.tsx:317-346`                                                                                                     | P2 (P1 remainder) | Aesthetic and minimalist design; HIG hierarchy                                                                             |
| 2   | Business workspace, from `wide`: the listing name shows twice (crumb, then "‹ The Bell" right under it). The area name also shows twice (crumb and H1). Agency trails already drop the listing into "…".                                                           | `breadcrumb-trail.ts:82-97` (no fold at 3 crumbs, `:161`); `area-frame.tsx:560-576`; DSK-05 row in results.md:292                                                                          | P2                | Minimalist design; consistency between workspace modes                                                                     |
| 3   | Phone: "Check Google now" is only inside the pill's bottom sheet. If it fails, the sheet shows nothing: the button just reverts. The failure line renders under the header, behind the sheet's scrim, and says "Try again." with no control of its own on a phone. | `area-frame.tsx:303-308` (sheet has the line but no `GoogleFreshnessFailure`); `:698`; `google-freshness.tsx:100-104`; Popover is a phone bottom sheet (`components/ui/popover.tsx:19-21`) | P2                | Visibility of system status; help users recover from errors; WCAG 4.1.3 (status not perceivable where the action happened) |
| 4   | An area switch shows an unlabelled 160 px block twice (route loading, then chunk loading). It is `aria-hidden`, so nothing is announced. It then becomes "Reading the … from Google…" with three rows, a different shape, so the content jumps.                    | `loading.tsx:13-18`; `area-frame.tsx:874-881`; `skeleton.tsx:15` (always `aria-hidden`); vs `query-states.tsx:72-86`                                                                       | P3                | Visibility of system status; WCAG 4.1.3; layout stability                                                                  |
| 5   | On a Booking document load, the streamed placeholder says "Reading the **action links** from Google…". When the client read takes over, it says "Reading the **booking links** from Google…". The words change mid-load, and "action links" is the retired term.   | `app/(dashboard)/listings/[id]/booking/page.tsx:30` vs `components/locations/booking-tab.tsx:107`; `streamed-tab.tsx:17-20` says the two must match                                        | P3                | Consistency and standards; plain language                                                                                  |
| 6   | **Hypothesis:** "Review & publish (n)" uses `next/link` with default (viewport) prefetch, while the tabs prefetch on intent (MEA-04). Each area load may then fetch the `/changes` RSC payload.                                                                    | `area-frame.tsx:374-381,468-469` vs `:167`                                                                                                                                                 | P3                | Performance (not visible)                                                                                                  |
| 7   | **Hypothesis:** `ListingGate`'s pending skeleton is the overview's four-card grid, even inside an area frame. It is rarely seen because the layout hydrates the directory.                                                                                         | `listing-gate.tsx` (pending branch)                                                                                                                                                        | P3                | Consistency                                                                                                                |

## 7. Proposed changes

### C1 · Put the time zone in the meta row from md (fixes #1, closes LST-06 / follow-up 26)

- **`components/listings/area-frame-context.ts`** (p3-local; imported only by `loading.tsx` and `area-frame.tsx`). Add a two-context slot, setter and value, the same pattern as `GoogleFreshnessSlot`, so reporting never re-renders the reporter:
  ```ts
  const AreaTimeZoneSetterContext = React.createContext<
    ((label: string | null) => void) | null
  >(null)
  const AreaTimeZoneContext = React.createContext<string | null>(null)
  /** Hours reports its zone in words ("UK time") to the frame's meta row; true inside a frame. */
  function useReportAreaTimeZone(label: string | null): boolean {
    const set = React.useContext(AreaTimeZoneSetterContext)
    React.useEffect(() => {
      if (!set) return
      set(label)
      return () => set(null)
    }, [set, label])
    return set !== null
  }
  function AreaTimeZoneSlot({ children }) {
    /* useState, both providers */
  }
  ```
- **`components/listings/area-frame.tsx` (SHARED, opt-in).**
  - `AreaFrame` (`:739-746`) wraps its children in `<AreaTimeZoneSlot>`.
  - `AreaMetaLine` (`:317-346`) reads `AreaTimeZoneContext`. When it is non-null, it draws the zone after the model note:
    `<span aria-hidden className="text-ink-muted">·</span><span data-slot="area-time-zone">Times are in <strong className="font-semibold text-ink">{zone}</strong>.</span>`
  - The resulting row: "Saved here first; nothing reaches Google until you review and publish. · Times are in **New Zealand time**. · Checked with Google 3 min ago. Check Google now".
  - Nothing changes for any area that doesn't report a zone, which today is every area except Hours. That includes p4's Photos, Posts, Changes, Suggestions and Verification. `ListingAreaHeader` on the overview (`listing-overview.tsx`) sits outside the slot, so the context is null there.
- **`components/locations/hours-tab.tsx`.**
  - Add `const zoneInHeader = useReportAreaTimeZone(zoneLabel)` after `:428`.
  - On the paragraph at `:531`, add `cn(..., zoneInHeader && "md:hidden")`.
  - Phones (no meta row, `hidden md:flex`) keep the paragraph in the body, so the zone is never only behind a tap.
- **Benefit:** one fewer row before the first day row at md and up, as the 15 Oct fix asked. The three short facts sit together.
- **Principle:** HIG hierarchy; Nielsen 8.
- **Risk:** none. Presentation only, with the same words and the same `formatTimeZoneLabel` rule. Hydration timing is unchanged: the label is null on the server for both, `use-viewer-time-zone.ts`.
- **Tests:**
  - `listing-mobile-navigation.test.tsx`: in a frame with a Hours-like reporter, `[data-slot="listing-area-meta"]` has the text "Times are in New Zealand time.", and an area with no reporter has no `area-time-zone`.
  - `hours-tab.test.tsx:164-197` stays green, because outside a frame the paragraph has no `md:hidden`.

### C2 · Business desk trail drops the listing crumb on area pages (fixes #2, closes DSK-05's remainder)

- **`lib/ui/breadcrumb-trail.ts` (SHARED lib).** Add a pure helper:
  ```ts
  /** Desk trail on a business listing area: the header right below names the listing, so "Listings / Opening hours"
   *  (DSK-05). Agency trails already fold it into "…". The phone's back target keeps the full trail. */
  export function deskListingTrail(
    pathname: string,
    crumbs: Crumb[],
    mode: "business" | "agency"
  ): Crumb[] {
    if (mode !== "business") return crumbs
    const [first, second, third] = pathname.split("/").filter(Boolean)
    if (
      first !== "listings" ||
      !second ||
      second === "bulk" ||
      !third ||
      crumbs.length !== 3
    )
      return crumbs
    return [crumbs[0], crumbs[2]]
  }
  ```
- **`components/app-shell/breadcrumbs-context.tsx` (SHARED).**
  - In `ShellBreadcrumbs` (`:123-126`), add `const mode = useWorkspaceMode()`.
  - Change the trail line to `deskTrail(pathname, deskListingTrail(pathname ?? "", useShellTrail(), mode))`.
  - `useShellTrail` and `useShellBack` are untouched, so the phone and tablet back control still reads "‹ The Bell". The topbar's `ShellBreadcrumbs` (`topbar.tsx:33`) is its only caller. `breadcrumbTrail` has one consumer, `useShellTrail`, which also feeds `app-bar.tsx`, `access-denied.tsx` and `not-found-content.tsx`; those are unchanged.
- **Benefit:** the trail says where you are, the header says which listing, with nothing said twice. It matches the agency fold.
- **Principle:** Nielsen 8; consistency across modes.
- **Risk:** none. Presentation only. The way up stays in the header's "‹ name" link, the switcher's current row and the Overview tab, which is visible from lg, below `wide`.
- **Tests:**
  - `breadcrumb-trail.test.ts`: `deskListingTrail("/listings/l1/photos", business(...), "business")` gives `["Listings","Photos"]`.
  - The overview `/listings/l1`, agency trails, `/listings/bulk` and unknown areas are unchanged.
  - `shell-breadcrumbs.test.tsx`: add a business-mode case, mocking `useWorkspaceMode`.

### C3 · Show a failed Google check inside the "How changes reach Google" sheet (fixes #3)

- **`components/listings/area-frame.tsx` (SHARED, internal to `AreaInfo`).** After `{freshness ? <GoogleFreshnessLine …/> : null}` at `:306`, add `<GoogleFreshnessFailure report={freshness} />`.
- The person who tapped "Check Google now" in the sheet now sees "Google couldn’t be checked just now. Try again." directly under that button, which is still there to press. The header line stays for when the sheet is closed.
- No change to `google-freshness.tsx` and no new props. `AreaInfo` is used only by `ListingAreaHeader`, on areas only (`:626-637`).
- **Benefit:** feedback appears where the action happened, and the retry is right next to it.
- **Principle:** Nielsen 1 and 9; WCAG 4.1.3.
- **Risk:** none. Read-only presentation of existing state, and the failure isn't claimed any differently. At desk the popover isn't modal, so two identical status regions may both announce once. Acceptable; if the review objects, give the in-sheet copy `aria-live="off"`.
- **Test:** in `listing-mobile-navigation.test.tsx`, extend "opens the model note and the last Google check from the status pill" with a `failed` report. The opened sheet contains the text "Google couldn’t be checked just now".

### C4 · One announced, same-shaped pending state on an area switch, and the right words on Booking (fixes #4, #5)

- **`app/(dashboard)/listings/[id]/loading.tsx` (p3).** In the `inFrame` branch, return `<QueryPending label="Loading this page…" />` (`components/ui/query-states`). Keep its `aria-busy`, `role=status` and the 3-row `SkeletonList`, the same shape `TabLoading` draws next, so the swap changes only the words. Import from `components/ui/query-states` rather than `tab-states`, to keep this chunk small (the comment at `area-frame-context.ts:7-9`).
- **`components/listings/area-frame.tsx` (SHARED).** Make `AreaEditorLoading` (`:874-881`) return the same `<QueryPending label="Loading this page…" />`. Its callers are the ten `AREA_EDITORS` entries (`:894-952`): p3's profile, hours, booking, menu and people, and p4's photos, posts, changes, suggestions and verification. Presentation only.
- **`app/(dashboard)/listings/[id]/booking/page.tsx:30`:** `loadingLabel="action links"` becomes `loadingLabel="booking links"`, which matches `booking-tab.tsx:107` and the "Booking links" title.
- **Benefit:** screen-reader users hear that the page is loading, and the content doesn't jump from a block to rows.
- **Principle:** Nielsen 1 and 4; WCAG 4.1.3.
- **Risk:** none. No data or timing change.
- **Tests:**
  - Update `listing-area-layout.test.tsx` "draws only the editor's card under a frame that stays" to expect `role="status"` with "Loading this page…" and `aria-busy="true"`.
  - Add `"booking links"` to the loop in `tests/server/streamed-tab.test.ts:55`.

## Follow-ups (out of scope)

- Agency desk trail: the F3 design call (results.md follow-up 22) asks whether to drop only the listing crumb, giving "Listings / Client / Hours" instead of the "…" fold. That needs an owner decision, because it reverses #212's fold test (`shell-breadcrumbs.test.tsx:76-99`).
- #6: switch `ReviewPublishLink` and the overflow row to `ShellLink` or `prefetch="intent"`, after a perf-lab check (MEA-04 territory).
- #7: an area-shaped `ListingGate` pending skeleton. Measure first whether it is ever visible.
- `TabError` could name the area ("We couldn’t read the opening hours from Google"). That touches `LocationTab`, which p4 tabs also use, so it needs a cross-area opt-in.

## 8. Screenshots to capture (`tests/visual/shoot.mjs`)

1. `--route /listings/{loc}/hours --widths 1280 --role owner`. Before: the zone paragraph above the day rows. After: the zone in the meta row. No interaction. The zone shows only when the listing's zone differs from the browser's. The e2e stub uses `Pacific/Auckland` (`tests/e2e/helpers/stub-bridge.ts:139`); confirm the visual fixture does too, otherwise the line is absent in both shots.
2. `--route /listings/{loc}/hours --widths 768,390 --role owner`: from md the zone is in the meta row; at 390 the paragraph stays in the body (no regression).
3. `--route /listings/{loc}/booking --widths 1280 --role member`: the meta row is unchanged for an area with no zone, and Review & publish is hidden or shown by role.
4. Not reachable by URL: the business-mode trail (no business role in `shoot.mjs`; covered by unit tests in C2), the failed check in the sheet (needs a tap and a failing refresh; covered by the C3 test), and the area-switch loading state (transient).

## 9. Files touched

- components/listings/area-frame-context.ts
- components/listings/area-frame.tsx (SHARED with p4)
- components/locations/hours-tab.tsx
- lib/ui/breadcrumb-trail.ts (SHARED)
- components/app-shell/breadcrumbs-context.tsx (SHARED)
- app/(dashboard)/listings/[id]/loading.tsx
- app/(dashboard)/listings/[id]/booking/page.tsx
- tests/components/listing-mobile-navigation.test.tsx
- tests/components/listing-area-layout.test.tsx
- tests/breadcrumb-trail.test.ts
- tests/components/shell-breadcrumbs.test.tsx
- tests/server/streamed-tab.test.ts
