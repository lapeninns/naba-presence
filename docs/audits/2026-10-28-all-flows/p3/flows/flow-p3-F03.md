# p3-F03 · Read a listing's overview and go to an area

Code read at `/tmp/naba-presence-p3` (`ux/flows-presence-p3`, head `e4123d25`, which includes #258 `7a70387b`). Read only.

## 1. Flow

- **Goal:** see what state one listing is in, what is waiting on it, and open the area that needs someone.
- **Start:** `/listings/[id]`. `app/(dashboard)/listings/[id]/page.tsx:15-22` renders `ListingOverview` with the session role. You get there from a board row (`components/listings/listings-board.tsx`), the sibling switcher, or a direct link.
- **End:** an area route `/listings/[id]/<segment>`, reached through the area card's link (`components/listings/area-cards.tsx:292-319`, `listingHref`). Other ways out: an alert action (Verification, the failed area), the header's Review & publish (`/changes`), or the Activity sheet (stays on the page). Not-found and denied states end on the dashboard 404 or on "Back to listings" (`listing-gate.tsx:160-165`).
- **Roles:** owner, admin, member and viewer can all read it. People with access and Verification are shown only to owners and admins (`areas.ts:137-139`, `listing-overview.tsx:209`). File under client, Start verification and Reconnect are owner/admin only.

## 2. Code map

| Piece                                                                 | Where                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route, metadata                                                       | `app/(dashboard)/listings/[id]/page.tsx:6-22`                                                                                                                                                                                                                                             |
| Layout: Suspense with `ListingSkeleton`, prefetch of caps and summary | `app/(dashboard)/listings/[id]/layout.tsx:23-53`; `lib/server/prefetch.ts:580-590` (summary), `:669-682` (capabilities)                                                                                                                                                                   |
| Directory prefetch (gate source)                                      | `app/(dashboard)/layout.tsx:137`                                                                                                                                                                                                                                                          |
| Route loading                                                         | `app/(dashboard)/listings/[id]/loading.tsx:10-20` (overview gets `ListingSkeleton`)                                                                                                                                                                                                       |
| Gate (exists / visible / errors)                                      | `components/listings/listing-gate.tsx:34-104`, `DirectoryError` `:106-169`                                                                                                                                                                                                                |
| Overview                                                              | `components/listings/listing-overview.tsx:201-300`; alerts `OverviewAlerts` `:42-170`                                                                                                                                                                                                     |
| Header (shared within p3; SHARED file per brief)                      | `components/listings/area-frame.tsx` `ListingAreaHeader` `:504-700`, `HeaderOverflow` `:391-480`, `ReviewPublishLink` `:358-379`, `ActivityDrawer` mount `:686-691`                                                                                                                       |
| Area cards                                                            | `components/listings/area-cards.tsx:177-385` (sort `:195-211`, skeleton `:213-223`, blocked `:229-259`, verb `:273-285`, no-summary `:322-343`)                                                                                                                                           |
| Google strip                                                          | `components/listings/health-strip.tsx:28-216`                                                                                                                                                                                                                                             |
| State words                                                           | `lib/listings/area-state.ts:127-269`; `lib/listings/health.ts:168-261`                                                                                                                                                                                                                    |
| Activity                                                              | `components/editors/activity-drawer.tsx:32-84` (SHARED), `components/locations/activity-panel.tsx:34-156`                                                                                                                                                                                 |
| Queries                                                               | `useListingSummary` `lib/queries/use-listing-summary.ts:13` → `GET /api/locations/:id/summary`; `useLocationCapabilities` → `/capabilities`; `useLocationDirectory` `lib/queries/use-locations.ts:28`; `useLocationActivityPages` `lib/queries/use-location-activity.ts:37` → `/activity` |

**Tests:**

- e2e `tests/e2e/listings.spec.ts:48`, "the board lists every listing and the overview shows its areas" (opens "Open Opening hours" and comes back).
- `tests/e2e/accessibility.spec.ts:684`, "listing overview and the profile editor".
- `tests/e2e/touch-critical.spec.ts:1138`, "listings: open a listing, edit its profile…".
- `tests/e2e/routing.spec.ts:320`.
- `tests/e2e/gbp-management-tabs.spec.ts:1254,1275`: the Activity dialog, from an area page.
- Unit: `tests/components/listing-overview.test.tsx` (14 cases), `listing-area-cards.test.tsx`, `listing-gate.test.tsx`, `listing-summary-recovery.test.tsx`, `listing-area-layout.test.tsx:62-81`, `listing-mobile-navigation.test.tsx`, `activity-panel.test.tsx`, `tests/lib/listing-health.test.ts`, `listing-area-state.test.ts`.

## 3. Steps today

1. **Loading.** The layout's Suspense fallback, then `loading.tsx`, both draw `ListingSkeleton`: name, title and pill, a tab row from lg, one h-40 card (`listing-skeleton.tsx:10-33`, `aria-busy` only, with no text). If the directory is still pending, `ListingGate` draws a _different_ skeleton: a 4-card grid with no tab row (`listing-gate.tsx:65-88`). That same gate skeleton also shows on every **area** page (`area-frame.tsx:820`). While the summary is pending, area cards and Google rows draw their own skeletons (`area-cards.tsx:213-223`, `health-strip.tsx:82-94`).
2. **Not found / denied.**
   - If the directory resolves without the id, `notFound()` runs. It is called only after a successful read (`listing-gate.tsx:90-93`), and the user sees the dashboard 404 "This page doesn’t exist" with a back link.
   - If the directory read fails, `DirectoryError` shows "We couldn’t load this listing" with focus on its h1. On 401 it offers "Sign in again". On 403 it says "Ask an owner or admin to check your access." with no retry. Otherwise it offers Try again (pending "Trying again…") and "Back to listings" (`:119-167`).
3. **Normal.**
   - The header shows the client caption, the H1 (the listing name, which is also the sibling switcher), a health pill and the health sentence with the address (`listing-overview.tsx:228-257`).
   - Desk header buttons: Open on Google (only when there is a mapsUrl), Review & publish (n), Activity.
   - Phone: one "⋯" (or a lone History icon) holds those (`area-frame.tsx:410-480`).
   - Next come the alerts, then "Areas" (cards sorted worst first, each one link to its area with the verb Review, View, Open or Edit), then "Google" (Google connection, Last published).
4. **Items waiting.**
   - Suggested updates lead the grid with an outline (`area-cards.tsx:196,350`).
   - Dirty areas say "Review" with "N fields not yet on Google". Posts say "Awaiting approval".
   - The header pill reads "Changes to publish" and the description says "Edits are saved here but not yet on Google. Review and publish them." (`health.ts:249`).
   - On a desk, "Review & publish (n)" is a header button. Below md it exists **only** inside "More listing actions" (`area-frame.tsx:441,463-470`; the desk buttons are `hidden … md:flex` at `:652`).
5. **Google disconnected / reconnect.**
   - The pill reads "Disconnected" and the description "The Google login behind this listing needs reconnecting." (`health.ts:255`).
   - Cards read "Unknown — can’t reach Google", and Review & publish is hidden (`area-frame.tsx:368`). The unverified alert is suppressed (`listing-overview.tsx:69-70`).
   - The only action, "Reconnect Google", is a footnote on the Google connection row **below every area card** (`health-strip.tsx:160-169`), for owners and admins with a clientId. Members and viewers get no "who can fix this" line on the overview.
   - Not linked: every card reads "Link this listing to Google to manage it here." (`area-cards.tsx:229-230`) and the Google row reads "Link it from the client’s setup" (`health-strip.tsx:138-140`). Neither is a link.
6. **Error / retry (summary).** If the summary fails, a warning alert says "We couldn’t check where each area stands" and offers Try again (`listing-overview.tsx:150-166`). Cards then show the dashed "Open to check" (`area-cards.tsx:322-343`) and the Google rows show "Couldn’t check". The retry path is covered by `listing-summary-recovery.test.tsx:39`.
7. **Failed or ambiguous last publish.** A destructive alert (announced as `role="alert"` by default) reads "The last {area} publish failed · {time}" or "Google hasn’t confirmed…", says "Activity has the attempt details", and offers "Check {area}" (`:118-148`). The Google row below says "The last {raw key} publish failed" (`health-strip.tsx:197-203`).
8. **Go to an area.** Activating a card's link (the whole card is the hit area) goes to the route. The area frame mounts with the same status pill (`AreaStatusPill`, `area-frame.tsx` `areaState`).
9. **Activity.**
   - The desk "Activity" button, or the phone ⋯ › Activity / History icon, opens the sheet "Recent activity". Its description reads "Google change attempts and confirmation results for this location." (`activity-drawer.tsx:70-74`).
   - The panel loads only once the sheet is open. Pending and error states with retry come from `LocationTab`.
   - Empty state: "No Google management changes recorded for this location yet." (`activity-panel.tsx:62-66`).
   - Rows have Load more. A confirm check appears only for managers (`:129-142`).
   - Success is server-confirmed: the toast appears only when the state is `confirmed` (`:178-181`). Otherwise the line reads "Still unresolved. No change was resent." (`:202`).

## 4. Protected rules for this flow

- The overview reads the DB-only summary and never asks Google (`listing-overview.tsx:196-200`, `health-strip.tsx:20-27`, `page.tsx:5`).
- The directory decides whether the listing exists and is visible. `notFound()` runs only after a successful read. 403 offers no retry (`listing-gate.tsx:24-33,90-93,138-159`).
- The People and Verification consoles are for owners and admins only (`areas.ts:137-139`, `area-cards.tsx:195`). File-under-client, Start verification and Reconnect are owner/admin only (`listing-overview.tsx:83,102`, `health-strip.tsx:161`).
- A blocked area explains why instead of offering a way in (`area-cards.tsx:245-259`). Its read-only state comes from caps (`:235-243`).
- Nothing claims "In sync" or "checked" while Google is unreachable (`health.ts:97-117`, `area-state.ts:69-79`).
- "Check" is reserved for actions that ask Google (DSK-15, `area-cards.tsx:283`).
- Review & publish is hidden while Google is unreachable and for roles that can't edit, publish or request approval (`area-frame.tsx:347-372`, `lib/listings/area-nav.ts:75-82`).
- A failed publish never denies partial success: "Some changes may already be on Google. The saved copy here is kept." (`listing-overview.tsx:130`, test `:361`).
- Activity confirmation never resends anything. The toast is shown only on a server `confirmed` (`activity-panel.tsx:167-204`).

## 5. Prior audit status

| ID                                    | Status                                                               | Evidence on this head                                                                   |
| ------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| LST-02 Activity keys as words         | fixed                                                                | `activity-panel.tsx:77-91` uses `lib/listings/activity-outcome` label maps              |
| LST-06 header rows                    | partly fixed (rest is Hours' time zone, follow-up 26: not this flow) | two-row header `area-frame.tsx:504+`                                                    |
| LST-14 header remounts / late fetch   | fixed                                                                | `[id]/layout.tsx:23-53`, `ListingAreaLayout` `area-frame.tsx:969-991`                   |
| LST-18 no hours reads "In sync"       | fixed                                                                | `area-state.ts:143-153`, `health.ts:125-132,185-188`                                    |
| LST-23 overview repeats health        | fixed                                                                | `health-strip.tsx:114-214` (two rows; verification only for the viewer case `:107-112`) |
| DSK-01 tabs overflow                  | fixed                                                                | `area-frame.tsx` `overflow="more"`; Review & publish is a header action `:680`          |
| DSK-05 place repeated                 | partly fixed (the business-mode trail is shell-owned, p6/shared)     | results.md:292                                                                          |
| DSK-06 overview switcher shows client | fixed                                                                | H1 is `SiblingSwitcher` (overview test `:139-147`)                                      |
| DSK-15 status words/verbs             | fixed                                                                | `area-cards.tsx:273-285`                                                                |
| SET-13 (one-item overflow)            | fixed                                                                | `area-frame.tsx:418-431` (lone Activity icon)                                           |

No LST/DSK finding covers the problems below. They are new.

## 6. Friction

| #   | Problem                                                                                                                                                                                                                               | Evidence                                                                                                                                                                                                                                                                                                                  | Sev | Heuristic / WCAG                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------- |
| 1   | Disconnected: the only fix ("Reconnect Google") sits under all area cards. Members and viewers aren't told who can fix it. Not linked has no link at all.                                                                             | `health-strip.tsx:160-169`; `OverviewAlerts` has no connection case (`listing-overview.tsx:57-166`); "Link it from the client’s setup" (`health-strip.tsx:140`); "Link this listing to Google to manage it here." (`area-cards.tsx:230`). Compare `review-publish.tsx:569-591` ("Ask an owner or admin to reconnect it.") | P2  | Nielsen: error recovery, visibility; HIG hierarchy    |
| 2   | Phone (<md): the description says "Review and publish them." but the button is only inside "More listing actions"                                                                                                                     | `health.ts:249`; `area-frame.tsx:652` (`hidden … md:flex`), `:463-470`                                                                                                                                                                                                                                                    | P2  | Recognition over recall, visibility of next step      |
| 3   | The Google row shows raw summary keys: "Last change: hours", "The last menu publish failed", while the alert above says "food menu"                                                                                                   | `health-strip.tsx:198-203`; vs `listing-overview.tsx:125`; test pins "Last change: hours" (`listing-overview.test.tsx:293`)                                                                                                                                                                                               | P3  | Consistency, plain language                           |
| 4   | Loading: there are two skeleton shapes for one page, and the gate's 4-card grid also flashes on area pages. No skeleton gives assistive tech any text (aria-busy alone).                                                              | `listing-gate.tsx:65-88` vs `listing-skeleton.tsx:10-33`; `area-frame.tsx:820`                                                                                                                                                                                                                                            | P3  | Consistency, system status; WCAG 4.1.3                |
| 5   | The failed-publish banner is an assertive `role="alert"` although it is page content present on load. It points to "Activity" without saying where that is. The Activity empty state says "location" and "Google management changes". | `listing-overview.tsx:120,131-132`; `components/ui/alert.tsx:67-87` (doc: `live={false}` for a destructive banner present on load); `activity-panel.tsx:65`                                                                                                                                                               | P3  | WCAG 4.1.3 (no needless interruption); plain language |
| H1  | **Hypothesis:** on a phone, Activity behind an icon-only ⋯ is hard to find from the failed-publish alert                                                                                                                              | `area-frame.tsx:436-479`                                                                                                                                                                                                                                                                                                  | —   | needs a session to confirm                            |

## 7. Proposed changes

### C1 · Put the connection problem first, with a next step for every role (#1) — P2

- **Where:** `components/listings/listing-overview.tsx`, `OverviewAlerts`. Pass `linked={entry.linked}`, which is already available as `entry.linked`. Add these two alerts **first** in `alerts`.
  - **Disconnected** (`disconnected` already computed at `:58-62`). Alert `variant="warning"` `icon={<UnplugIcon aria-hidden />}` (lucide, as in `review-publish.tsx:569`).
    - Title: "Google can’t be reached for this listing".
    - Description: `${business ? "Your" : "The client’s"} Google login needs reconnecting. Until then nothing here is checked against or published to Google; saved changes are kept.`, plus `canManage ? "" : " Ask an owner or admin to reconnect it."`.
    - Action (`canManage && entry.clientId`): a `Link` "Reconnect Google" → `/setup?client=${entry.clientId}&step=connect`, styled `buttonVariants({ variant: "secondary", size: "sm" })`.
  - **Not linked** (`!entry.linked`). Alert `variant="info"`.
    - Title: "This listing isn’t linked to Google".
    - Description: "Its areas stay unavailable until it’s linked to a Google Business Profile listing." plus, for non-managers, " An owner or admin can link it from Setup.".
    - Action (`canManage && entry.clientId`): `Link` "Link to Google" → `/setup?client=${entry.clientId}&step=locations` (the existing step, `lib/setup/steps.ts` "Link this client's listings").
  - Access lost needs no alert. The header description already gives the whole remedy, and that remedy is outside the app (`health.ts:257`).
- **Where:** `components/listings/health-strip.tsx`. Remove the `footnote` Reconnect link (`:160-169`) so the action isn't duplicated. Drop the then-unused `ShellLink` import and the `ACTION` constant. The row keeps "Needs reconnecting".
- **Benefit:** the fix sits under the header instead of below 7–9 cards, and members learn who can fix it.
- **Protected-behaviour risk:** none. The same href is used and it stays owner/admin only. The links go to the existing p2 Setup screen, which is not changed.
- **Tests:** `listing-overview.test.tsx:342` still passes (one "Reconnect Google" link, same href, absent for member). Add these cases:
  - a member sees "Ask an owner or admin to reconnect it.";
  - with `linked:false`, an owner gets "Link to Google" → `step=locations` and a viewer gets no link.

### C2 · Show Review & publish on the phone overview (#2) — P2

- **Where:** `listing-overview.tsx`. After `<OverviewAlerts …/>`, render `<ReviewPublishLink locationId={locationId} summary={summary.data} caps={caps.data} className="w-full md:hidden" />`. It is already exported from `area-frame.tsx:999` with a `className` prop, so **the shared file does not change**. Its gating (unreachable, `canReviewChanges`, count 0) is reused as is.
- **Benefit:** the step the description names is visible on a phone (target ≥ control height, so it meets 2.5.8).
- **Risk:** none. It is a link to `/changes`, and Review & publish still enforces every publish rule.
- **Test:** `listing-overview.test.tsx:150-165`. Change `getByRole("link",{name:"Review & publish (2)"})` to `getAllByRole(...)`, expect length 2, and check both hrefs are `/listings/l1/changes`. Add a case: disconnected plus dirty shows neither link.

### C3 · Name the published area in words (#3) — P3

- **Where:** `health-strip.tsx`. Add and export `publishAreaName(area: string) = areaForSegment(area)?.label.toLowerCase() ?? area` (import `areaForSegment` from `@/lib/listings/areas`, read only). Use it in the four description strings at `:198-203`.
  - Before → after: "Last change: hours" → "Last change: opening hours"; "The last menu publish failed" → "The last food menu publish failed"; "A profile publish is in progress" → "A business profile publish is in progress".
  - In `listing-overview.tsx:125`, replace `failedArea ? failedArea.label.toLowerCase() : failed.area` with `publishAreaName(failed.area)`.
- **Risk:** none (copy only).
- **Test:** `listing-overview.test.tsx:293` expects "Last change: opening hours".

### C4 · One loading shape that is announced (#4) — P3

- **Where:** `listing-skeleton.tsx`. Add `role="status"` on the root and a first child `<span className="sr-only">Loading this listing…</span>`. Keep `aria-busy`.
- **Where:** `listing-gate.tsx:65-88`. Replace the hand-built grid with `return <ListingSkeleton />`, and drop the `Skeleton` import. `ListingGate` is also used by `AreaFrame` (`area-frame.tsx:820`), so area pages also lose the overview-card flash. Their header already matches this shape (L03).
- **Risk:** none (presentation only). `notFound` and error ordering are untouched.
- **Tests:** `listing-gate.test.tsx:143` (aria-busy) and `listing-area-layout.test.tsx:74-80` (>3 skeletons, no heading) still pass. Add `expect(screen.getByRole("status")).toHaveTextContent("Loading this listing")`.

### C5 · Calmer failure banner, clearer Activity copy (#5) — P3

- **Where:** `listing-overview.tsx:120`.
  - Add `live={false}` to the failed or ambiguous `Alert`. This follows the documented contract in `components/ui/alert.tsx:79-87`, with no change to the shared component.
  - Copy: "…before trying again; Activity has the attempt details." → "…before trying again. Activity, at the top of this page, has the attempt details."
- **Where:** `components/locations/activity-panel.tsx:65` (area-local; its only caller is the drawer).
  - Copy: "No Google management changes recorded for this location yet." → "No changes to Google have been recorded for this listing yet."
- **Risk:** none. The "may already be on Google" sentence stays (test `:361`).
- **Test:** `activity-panel.test.tsx:85` uses the new string. If wanted, assert that the overview failure banner has no `role="alert"`.

## 8. Screenshots to capture

1. `/listings/{loc}` · owner · 390 and 1280 · no interaction. Shows the normal state, the C4 skeleton (only if the dev server is throttled), and the C3 "Last change" row.
2. `/listings/{loc2}` · owner · 390 · no interaction, if the approval fixture has dirty edits. Shows the C2 phone Review & publish button.
3. `/listings/{loc}` · member · 390 · the member view of the alerts. Disconnected (C1) needs a fixture with `connection.status !== "active"`. If the seed has none, capture C1 from the component test render or mark it **Blocked by fixture**.
4. `/listings/00000000-0000-0000-0000-000000000000` · viewer · 390 · the not-found end state (unchanged, as a baseline).

## 9. Files touched

```
components/listings/listing-overview.tsx
components/listings/health-strip.tsx
components/listings/listing-skeleton.tsx
components/listings/listing-gate.tsx            (p3-local, also used by AreaFrame on every area page)
components/locations/activity-panel.tsx
tests/components/listing-overview.test.tsx
tests/components/listing-gate.test.tsx
tests/components/activity-panel.test.tsx
```

No SHARED file is edited. `area-frame.tsx` (`ReviewPublishLink`) and `components/ui/alert.tsx` (`live`) are only used through their existing props.

## Follow-ups (out of scope)

- Let the failed-publish alert open the Activity sheet directly. That needs an opt-in controlled `activityOpen`/`onActivityOpenChange` on `ListingAreaHeader` (SHARED `area-frame.tsx`; callers are `listing-overview.tsx` and `AreaFrameBody`).
- The Activity sheet description "…for this location." (`components/editors/activity-drawer.tsx:72`, SHARED; only caller `area-frame.tsx:686`) → "…for this listing.".
- The in-frame `loading.tsx` skeleton sets `aria-busy` on an `aria-hidden` element, so nothing is announced on an area switch. It needs a test change at `listing-area-layout.test.tsx:69-71`.
- The Activity panel shows the count twice (top "N recorded changes" and the Load more status).
