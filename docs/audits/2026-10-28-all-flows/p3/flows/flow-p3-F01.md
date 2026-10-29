# p3-F01 · Find, filter and open a listing on the Listings board

Code read at `/tmp/naba-presence-p3` (`ux/flows-presence-p3`, head `e4123d25`, which includes #258 `7a70387b`). Read only.
All paths are repo-relative. `board` means `components/listings/listings-board.tsx`. Bulk selection and Add listings are out of scope (another flow covers them).

## 1. Flow

- **ID / name:** p3-F01. Find, filter and open a listing on the Listings board.
- **Goal:** find the listing that needs you (or a named one) and either check it in place (desk quick look) or open its workspace.
- **Start:** `/listings` (`app/(dashboard)/listings/page.tsx:19-47`), reached from the primary nav (`lib/navigation/destinations.ts:103-113`, no role gate) or Back from a listing (`lib/navigation/back-target.ts:47`). URL state: `q`, `health`, `clientId`, `order` (board:646-732).
- **End:** either `/listings/{id}`, via the row's name link (board:935-946, `listingHref` `lib/listings/areas.ts:141`), the quick look's "Open listing" (board:374-375), or an area link in the quick look (`/listings/{id}/{profile|hours|menu}`, board:384-389). On a desk the flow can also end in place: the quick look panel answers "what is waiting here?" (board:329-438).
- **Roles:** owner, admin, member and viewer all see the board. Owners and admins read the management directory and the others read the default one (`lib/queries/use-locations.ts:28-41`). Business mode drops the client layer: no client column, chips, grouping or order chip (board:640, 656, 669, 843, 1089).

## 2. Code map

| Piece                                                                              | Where                                                                                                                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Page, header (description sr-only below md, LST-07), hydration of summaries        | `app/(dashboard)/listings/page.tsx:24-45`; `lib/server/prefetch.ts:597-604`                                                                  |
| Directory hydrated by the dashboard layout                                         | `app/(dashboard)/layout.tsx:137`                                                                                                             |
| Async chunk wrapper                                                                | `components/listings/listings-board-entry.tsx:17-19`                                                                                         |
| Health filters, matcher, worst-first order                                         | board:82-93, 166-196                                                                                                                         |
| Order chip ("Order listings: Worst first"), a menu that becomes a sheet on a phone | board:98-151, 1089-1097                                                                                                                      |
| URL state, shallow rewrite, 300 ms search pause                                    | board:646-732; `lib/navigation/shallow-url.ts`                                                                                               |
| Loading skeleton                                                                   | board:528-584, 734                                                                                                                           |
| Load error "We couldn’t load your listings"                                        | board:736-764                                                                                                                                |
| Empty "No listings yet"                                                            | board:790-817                                                                                                                                |
| Search / health / client filtering and sorting                                     | board:819-841; client chips 843-860, 1099-1131                                                                                               |
| Toolbar search (phone takeover with Cancel)                                        | board:1053-1062; `components/ui/toolbar.tsx:26-29`                                                                                           |
| Health chips (`hideWhenZero`)                                                      | board:1070-1088; `components/ui/chip.tsx:268-296`                                                                                            |
| sr-only count live region (drawn only on summaries error)                          | board:1138-1166                                                                                                                              |
| "No listings match" + Clear filters                                                | board:870-875, 1169-1184                                                                                                                     |
| Row (phone record card / desk table), Waiting, Verification, Last published        | board:464-526, 898-1040                                                                                                                      |
| Desk quick look (from `lg`, plain click on row)                                    | board:329-438, 937-940, 1244-1255; `components/ui/quick-look-panel.tsx:62-118`                                                               |
| Health words and roll-up                                                           | `lib/listings/health.ts:153-161, 168-205, 235-260, 295-327`                                                                                  |
| Area words used by the overview, frame and tabs                                    | `lib/listings/area-state.ts:1-5, 61-110, 126-152`                                                                                            |
| Queries                                                                            | `useLocationDirectory` (`lib/queries/use-locations.ts:28`), `useListingSummaries` (`lib/queries/use-listing-summary.ts:23-29`), `useClients` |

**E2E coverage**

- `tests/e2e/listings.spec.ts:48` "the board lists every listing and the overview shows its areas": the table, the record cards under 48rem, Waiting settling, and the name click.
- `tests/e2e/desk-quick-look.spec.ts:185` "a click on a listing row opens its areas in a panel and Escape closes it", and `:229` "a click on a listing row opens the listing, with no panel" (900px).
- `tests/e2e/touch-critical.spec.ts:1138` "listings: open a listing, edit its profile, …" (tap from the tab bar to a row).
- `tests/e2e/accessibility.spec.ts:616` "listings board" (axe at each viewport and theme).

**Unit coverage:** `tests/components/listings-board.test.tsx` (filters :203, order :237/:369/:402, URL :295/:329/:350, zero chips :444, live region :492, no listings :591, load error :600, summaries pending :663, quick look :693-770) and `listings-board-business.test.tsx`.
**Not covered anywhere:** "No listings match", the summaries-error line, and the quick look's area words.

## 3. Steps today

1. **Initial.** `/listings`. Directory and summaries are hydrated on the server, so rows usually paint at once. Otherwise `BoardSkeleton` shows the toolbar, chips and 5 rows with `aria-busy` (board:528-584).
2. **Ready.** The search pill sits on its own row, then the health chips ("All", "Needs attention", "To publish", "Not linked", "In sync", each with a count and hidden at zero unless pressed), then "Worst first ⌄" (agency only), then the client chips (shown only when there are 2 or more clients with listings). A sr-only live line says "N listings · 1 needs attention · …" (board:1138-1166).
   - **Phone (<48rem container):** each row is a card: the name, "Client · address" with the health pill, then "n waiting" or "Nothing waiting". The whole card is one tap (board:464-484, 927-946).
   - **Desk:** a table with Listing, Client, Health (pill plus "Reviews checked …"), Waiting pills, Verification and Last published.
3. **Search.** Typing filters at once and the URL follows 300 ms later (board:710-720). Search matches the listing name, and the client name in agency mode only (board:822-826). The health chip counts follow the search (board:1042-1043). The client chip counts do not. Nothing is announced: the live line counts every listing (board:1133-1137).
4. **Filter.** A health chip presses (`aria-pressed`) and does not toggle off (board:1081). A client chip toggles (board:1119). The top-bar client switcher moves `?clientId=` and the chips follow it (board:657-665).
5. **Order.** Pick "Worst first" or "By client" in the menu. "By client" adds the group rows "Not filed under a client · n" and "Filed under a client · n" (board:1225-1239).
6. **No match.** "No listings match" / "Nothing fits this client, health and search together. Widen one of them to see the rest." / [Clear filters]. Clear filters clears the search, health and client together (board:870-875, 1169-1184).
7. **Open (phone, or desk name click).** `ShellLink` navigates to `/listings/{id}`.
8. **Quick look (≥`lg`, plain click anywhere on the row except the name).** A right panel opens with the title (the name), "Client · address", the health pill plus its description sentence, then "Areas" (Business profile / Opening hours / Food menu, each a link with a sync pill), "Waiting", "Google" (Verification, Last check, Last published), and "Open listing". Escape returns focus to the name link (desk-quick-look.spec.ts:185-221).
9. **Error, directory.** "We couldn’t load your listings" / "The listings service didn’t answer, so nothing is shown rather than a partial board. Nothing was changed." / [Try again]. There is no pending state and no alert role (board:739-754).
10. **Error, summaries.** The rows still show. Each health becomes "Not checked" and Waiting shows "—". The live line becomes visible: "N listings · N need checking. We couldn’t check what is waiting on each listing." It has no retry (board:1157-1160).
11. **Empty.** "No listings yet", with "Add listings from Google" for owners and admins only (board:790-817).
12. **Success.** This flow writes nothing to the server. "Success" means the right rows are shown and the listing opens. All health words come from the DB-only summary.

## 4. Protected rules for this flow

- The board is read only. Its only write affordance in scope is filing an unfiled listing, which is admin/owner gated and owned by its own component (board:964-973, `file-under-client.tsx`). It is not touched here.
- No status before evidence. While summaries load, the health pill waits instead of saying "Not checked" (board:986-993), and the quick look says "Checking this listing…" (board:345, 368-372).
- "No summary means we don't know, not that it never happened": the cell shows "—", not "Never" (board:1027-1034).
- With Google unreachable, "nothing may claim 'In sync' or 'checked just now'" (`lib/listings/health.ts:97-101`). One function (`areaState`) gives area words so that "the overview's area card, the area header's status pill and the area tab's badge can never tell three different stories" (`lib/listings/area-state.ts:1-5`).
- Filters live in the URL through the history API, with no server round trip (`page.tsx:11-18`, board:642-645). Back leaves the board and does not undo filters (`replace`).
- Role gates: `canManage` = owner/admin (page.tsx:21, board:616). The directory endpoint is chosen by role (`use-locations.ts:29-37`).

## 5. Prior audit status

| ID                                                                  | Status                                                | Evidence                                                                                                                                                                                                                         |
| ------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LST-07 (five control rows above first listing)                      | **Fixed**                                             | Add listings at the end (board:1256-1262), `hideWhenZero` (board:1083), the order folded into a chip (board:109-151), the count sr-only (board:1138-1143), the page description sr-only below md (page.tsx:37). `results.md:215` |
| LST-18 (no hours reads "In sync")                                   | **Fixed on board health**, **open in the quick look** | Health → "attention" (`health.ts:185-188`). The quick look's area pill still reads the raw `syncStatusLabel` "In sync" for hours (board:392-394). See friction #1                                                                |
| L18 follow-up (`listingAttentionReason()` not wired into the board) | **Still open**                                        | Defined at `health.ts:153-161`. No caller in `components/` or `app/` (grep). `results.md` "Carried from PR bodies → L18"                                                                                                         |
| DSK-23 (no desk quick look)                                         | **Fixed**                                             | board:37, 329-438, 937-940; `results.md:304`                                                                                                                                                                                     |
| CLR-19 remainder (order buckets by count)                           | Owned by Clients (p2). Not proposed here              | `results.md` follow-up 27                                                                                                                                                                                                        |

## 6. Friction

| #   | Problem                                                                                                                                                                                                                                                                                                                                                                                                      | Evidence (file:line, copy)                                                                                                                | Sev | Heuristic / WCAG                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------- |
| 1   | The quick look's area pills bypass `areaState`. A listing with no hours on Google shows "Needs attention" above "Opening hours · In sync". A disconnected listing, or one whose check failed, shows "In sync" for its areas, which breaks the "nothing may claim In sync" rule. The overview card for the same listing says "No hours on Google" / "Unknown — can’t reach Google" / "Couldn’t check"         | board:392-394 `syncStatusLabel(summary[area.key].status)`; compare `area-state.ts:126-152`, `:67-90`; `health.ts:97-101`                  | P1  | N1 visibility of status, N4 consistency; HIG consistent feedback |
| 2   | "Needs attention" is explained by a catch-all sentence, even though a specific reason function exists and is unused                                                                                                                                                                                                                                                                                          | `health.ts:251` "Review the failed check or publish, conflict, change Google made, or missing opening hours."; `health.ts:153-161` unused | P2  | N9 help diagnose, plain language                                 |
| 3   | When the summaries read fails, every row says "Not checked" and the quick look tells the user to "Open the profile, hours and any available menu to compare them with Google." The cause is the app's own read, not a missing check. The board line has no retry. After a failed _background_ refresh the data is kept, but the line still says "We couldn’t check what is waiting on each listing."         | board:1139-1141, 1157-1160; `health.ts:242-243`; board:345 (only _pending_ is treated as unknown); TanStack keeps `data` while `isError`  | P2  | N1, N9 recovery; HIG preserved context                           |
| 4   | Load error: "Try again" shows no progress, so repeat taps give no feedback. Clients (`clients-index.tsx:225`) and the listing gate (`listing-gate.tsx:56`) pass `pending`. The error replaces the skeleton without `role="alert"`, so it is not announced (`empty.tsx:41-55`, `query-states.tsx:125`). Internal copy: "The listings service didn’t answer, so nothing is shown rather than a partial board." | board:739-754, 744                                                                                                                        | P2  | WCAG 4.1.3; N1; N2 plain language                                |
| 5   | The filtered result count is never announced. The live line always counts every listing, so a search or chip press is silent to a screen reader. Clients announces "N of M clients"                                                                                                                                                                                                                          | board:1133-1137 (comment), 1149-1151; `clients-index.tsx:341-344`                                                                         | P2  | WCAG 4.1.3; N4 consistency                                       |
| 6   | "No listings match" names neither the query nor the filter. Its only action, Clear filters, also drops the typed search. A user who typed "Railway" with "In sync" pressed loses the search, even when the listing exists under another health. Clients titles `No clients match “q”`                                                                                                                        | board:1173-1183, 870-875; `clients-index.tsx:357`                                                                                         | P2  | N3 user control, N9 recovery, N4                                 |
| 7   | A `?clientId=` for a client with no listings, for example from the top-bar switcher, draws no pressed client chip (the chip is filtered out at count 0), and the empty state says only "this client"                                                                                                                                                                                                         | board:860, 1099, 1177                                                                                                                     | P3  | N1                                                               |
| 8   | Search ignores the address line drawn under each name, so a user can't find "the Cambridge one" by town. **Hypothesis** about value: the code fact is board:822-826 against 947-956                                                                                                                                                                                                                          | board:822-826                                                                                                                             | P3  | N7 flexibility                                                   |
| 9   | A pressed health chip doesn't toggle off, but a client chip does                                                                                                                                                                                                                                                                                                                                             | board:1081 vs 1119                                                                                                                        | P3  | N4 (mitigated: "All" is always drawn)                            |
| 10  | The skeleton has `aria-busy` but no sentence. `QueryPending` notes that this announces nothing. The state is rarely seen because the layout hydrates the directory                                                                                                                                                                                                                                           | board:531; `query-states.tsx:47-52`                                                                                                       | P3  | WCAG 4.1.3                                                       |

The quick look opens by pointer only (Enter opens the page). That is DSK-23's intended design (`quick-look-panel.tsx:102-118`), so it is not friction.

## 7. Proposed changes

All changes are in `components/listings/listings-board.tsx` (area-local). The two `lib/listings/*` helpers are imported, not edited. No shared file changes.

### C1 · The quick look tells the overview's story (fixes #1, #2 and the quick-look half of #3), P1

- **Area pills:** in `ListingQuickLook`, add props `now: number` (pass the board's `useNow()` value, board:613) and `summaryFailed: boolean` (`summaries.isError && !summaries.data`). Replace board:392-394 with:
  `const state = areaState(area.key, summary, now)` → `<StatusPill tone={state.tone}>{state.label}</StatusPill>`.
  Import `areaState` from `@/lib/listings/area-state`. Drop `syncStatusLabel`/`syncStatusTone` from the board's imports, since this was their only use in the file. Keep the menu-eligibility filter (board:346-348).
  - Before: "Opening hours · In sync" on a "Needs attention" listing with empty Google hours. After: "Opening hours · No hours on Google".
  - Before: "Business profile · In sync" on a "Disconnected" listing. After: "Business profile · Unknown — can’t reach Google".
- **Reason sentence** (board:364-366): `row.health === "attention" ? (listingAttentionReason(row.summary, now) ?? listingHealthDescription(row.health)) : listingHealthDescription(row.health)`.
  - Before: "Review the failed check or publish, conflict, change Google made, or missing opening hours." After, when hours are the only cause: "Google shows no opening hours for this listing."
- **Failed summaries** (board:345, 368-372): `known = !((summaryPending || summaryFailed) && row.health === "unchecked")`. In the unknown branch, show `summaryFailed ? "We couldn’t check this listing just now. Open it to see each area." : "Checking this listing…"`.
- **Benefit:** the panel, the overview card, the area header and the tab badge use one vocabulary. The quick look can no longer show green beside a warning.
- **Principle:** N1, N4; HIG consistent feedback.
- **Risk:** none. This is presentation from the same DB-only summary. `areaState` only replaces "In sync" with weaker or more specific words, so it enforces `health.ts:97-101`.
- **Test:** in `tests/components/listings-board.test.tsx` "quick look from lg", add "uses the overview's words for each area".
  - Case 1: hours `{status:"in_sync", observedAt: recent, checkStatus:"checked", googleEmpty:true}` → the dialog shows "No hours on Google" and "Google shows no opening hours for this listing.", and no "In sync" inside Areas.
  - Case 2: `connection.status:"expired"` → "Unknown — can’t reach Google".

### C2 · Errors that announce, recover and show progress (fixes #3 board half, #4), P2

- **Directory error** (board:739-754): add `role="alert"`. Move the button from `action` to `actions`, so the alert reads the message and not the button label (`empty.tsx:41-46`). Add `pending={directory.isFetching}` and `pendingLabel="Trying again…"`, as Clients does (`clients-index.tsx:223-227`).
  - Copy before: "The listings service didn’t answer, so nothing is shown rather than a partial board. Nothing was changed."
  - Copy after: "We didn’t get an answer just now, so nothing is shown rather than part of the list. Nothing was changed."
- **Summaries error** (board:1138-1166): keep the `<p aria-live>` as it is, and wrap it with a sibling in `<div className="flex flex-wrap items-center gap-x-2">` while `summaries.isError`. The sibling, outside the live region, is `<Button variant="ghost" size="sm" pending={summaries.isFetching} pendingLabel="Checking again…" onClick={() => void summaries.refetch()}><RefreshCwIcon aria-hidden />Check again</Button>`. `sm` keeps a 44px touch hit area (`button.tsx:66`).
- **Split the sentence** (board:1157-1160):
  - With `summaries.data` present: ". We couldn’t refresh what is waiting; this is the last check."
  - Without data: ". We couldn’t check what is waiting on each listing." (unchanged)
- **Benefit:** status in words, a working retry with visible progress, and no false "couldn’t check" while data is shown.
- **Risk:** none. `refetch` is a GET of the same queries.
- **Tests:**
  - Extend `:600` "says the board failed to load…": assert `getByRole("alert")` contains the title, and that the button has `aria-busy` when `isFetching: true`.
  - Add "offers Check again when the summaries fail": mock `isError: true, data: undefined, refetch` → the button calls refetch.
  - Add a case with data present for "refresh" wording.

### C3 · Announce what a filter leaves (fixes #5), P2

- In the live line (board:1148-1151): when `visible.length !== rows.length`, render `${formatNumber(visible.length)} of ${formatNumber(rows.length)} ${rows.length === 1 ? "listing" : "listings"} shown`. Otherwise keep "N listings". The health roll-up after " · " is unchanged.
  - Update the comment at board:1133-1137 ("all of them, not just those a filter leaves" becomes "how many a filter leaves, out of all").
- **Benefit:** a screen-reader user hears the result of each search or chip press, as on Clients.
- **Risk:** none. This is the sr-only text only, so LST-07's drawn height is unchanged.
- **Test:** `:492` still matches `/^3 listings/` unfiltered. Add: type "Harbour" into "Search listings" → the line reads "1 of 3 listings shown".

### C4 · "No listings match" says what is narrowing and keeps the search (fixes #6, #7), P2

- **Search predicate:** pull the predicate at board:822-826 into a local `matchesSearch(row)`. Compute:
  - `searchMatches = needle ? rows.filter(matchesSearch).length : 0`
  - `narrowed = health !== "all" || clientFilter !== null`
  - `healthLabel = HEALTH_FILTERS.find(f => f.value === health)!.label`
  - `clientLabel = clientFilter === UNFILED ? "Unfiled" : (clients.data?.items.find(c => c.id === clientFilter)?.name ?? "this client")`
  - `scope = [health !== "all" && \`“${healthLabel}”\`, clientFilter && !business && clientLabel].filter(Boolean).join(" and ")`
- **Title:** `needle ? \`No listings match “${search.trim()}”\` : "No listings match"`.
- **Description and actions** (Empty allows one primary and a second at most secondary):
  - (a) `needle && narrowed && searchMatches > 0`: "{n} listing(s) match outside {scope}." Primary `<Button variant="secondary" onClick={showAllMatches}>Show {n} match(es)</Button>`, where `showAllMatches = () => { setHealthState("all"); setClientState(null); writeUrl({ health: "all", clientId: null }) }`, which keeps `q`. Secondary `<Button variant="ghost" onClick={clearFilters}>Clear filters</Button>`.
  - (b) `needle && searchMatches === 0`: "Check the spelling, or clear the search to see every listing." with [Clear filters], as today.
  - (c) `!needle`: "No listing is in {scope} right now." with [Clear filters], as today. This covers #7 by naming the client.
- **Benefit:** no lost typing, a one-tap way to the match, and the same pattern as Clients.
- **Risk:** none. This is local state and a URL rewrite through the existing `writeUrl`, which already carries a pending search (board:682-690). The client param change is the same one Clear filters makes today.
- **Tests:** add
  - "names the search and keeps it when the match is under another health": `?health=healthy&q=Old Crown` with Old Crown "To publish" → title `No listings match “Old Crown”`. "Show 1 match" → the row is visible, `health` is gone from the URL and `q` stays.
  - "names the client when a stale clientId leaves nothing".

## 8. Screenshots to capture (`tests/visual/shoot.mjs`)

| #   | Route                                                                                                                                                      | Role   | Widths    | Interaction                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | `/listings?q=zzzz`                                                                                                                                         | owner  | 390, 1280 | none (C4 b, title names the query)                                                                                                                                              |
| S2  | `/listings?health=healthy&q=<seeded name of a non-healthy listing>` (fill in from `state.directReview.locationName` if it is not "In sync" in the fixture) | owner  | 390, 1280 | none (C4 a, "Show 1 match")                                                                                                                                                     |
| S3  | `/listings`                                                                                                                                                | owner  | 1280      | **yes**: click a row's Waiting cell to open the quick look (C1). Pick the fixture's "Needs attention" stub listing from LST-18 (ffb14793) to show "No hours on Google" in Areas |
| S4  | `/listings?clientId={client}&health=not_linked`                                                                                                            | member | 390       | none (C4 c, names client and health; member view without the filing control)                                                                                                    |

The error states (C2) need a failing endpoint, so cover them by unit test, not screenshots.

## 9. Files touched

components/listings/listings-board.tsx
tests/components/listings-board.test.tsx

## Follow-ups (out of scope)

- Search the address line too (#8). This is a small local change, but it changes the placeholder ("Search listings, clients or towns") and the business test `listings-board-business.test.tsx:124`. Decide with the owner whether town search is wanted.
- Make health chips toggle like client chips (#9), or record that "All" is the way out.
- Add a sentence to `BoardSkeleton` (#10): `<p role="status" className="sr-only">Loading listings…</p>`, as Clients does (`clients-index.tsx:938`).
- E2E: no spec covers search, no match or the summaries error. Consider one `listings.spec.ts` case for "No listings match “q”" → "Show n matches".
