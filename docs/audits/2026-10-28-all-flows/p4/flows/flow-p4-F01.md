# p4-F01 — Browse and inspect the photo library (filter, open a photo)

Worktree `/tmp/naba-presence-p4` (branch `ux/flows-presence-p4`), read 28 Oct 2026. All paths are relative to the repo. Read-only mapping: nothing was run.

## 1. Start and end

- **Route:** `/listings/[id]/photos`, from `app/(dashboard)/listings/[id]/photos/page.tsx:25-44`. The page calls `StreamedTab` with `photosTabPrefetch(id, search)` (`loadingLabel="photos"`). It then renders `AreaEditor area="photos"`, which loads `PhotosTab` (`components/listings/area-frame.tsx:921-924`), then `LocationTab`, then `PhotosLibrary`.
- **Entry points:** the listing area tab "Photos" (`lib/listings/areas.ts:76-82`); the Overview area card's "Open" (`components/listings/area-cards.tsx:284`); the client hub section link (`tests/e2e/client-hub.spec.ts:97-98`); the legacy `/locations/{id}/photos`, which redirects (`tests/e2e/routing.spec.ts:330-336`); and a shared or filtered URL `?ownership=customer&category=INTERIOR` (`lib/locations/photos-url-state.ts:52-59`).
- **Header (owned by listings core):** H1 "Photos", pill "On Google", line "N of your photos" or "No photos of yours yet" (`lib/listings/area-state.ts:176-184`), model note "Changes here go to Google straight away." (`lib/listings/areas.ts:159`).
- **Done:** the operator sees the photos Google holds, narrowed by ownership or category if they chose to, and has opened one in the lightbox to check its category, who added it, the date, the size and the original on Google. No write happens in this flow. Writes belong to F02 (add) and F03 (delete), plus the category and logo changes on the tile.

## 2. Roles and gates

- **Session:** the page reads `getSession()` (`page.tsx:30-34`).
- **Read:** any role with access to the location. `loadMedia` calls `loadLinkedLocation`, which calls `requireLocationAccess` (`lib/server/gbp-write.ts:202`). An unknown id returns 404 `location_not_found` (`:200`). An unlinked location shows the not-linked state (`components/locations/tab-states.tsx:48-66`). `LocationTab` has no `requires`, so members and viewers browse too (`components/locations/photos-tab.tsx:60-65`).
- **Write lock (affects the tile and lightbox controls in this flow):**
  - `publishReason` comes from `tabGateReasons(caps, "photos", writesEnabled)` (`components/locations/location-tab.tsx:268`) and `resourceDisabledReason` (`lib/locations/gating.ts:83-102`), for example "You do not have permission to publish this location to Google."
  - That becomes `writeReason`, which drives `disabled` (`photos-library.tsx:64`) and the banner `gateTitle="You can look, but not change these photos"` (`:101-102`).
  - In the lightbox, `locked` disables the actions and replaces the note with the reason (`photo-preview.tsx:80-87,215,225`).
- **Unresolved creates:** they can be resolved only when the server's `canPublish` is true (`canPublishLocation`, `gbp-write.ts:232`; `photos-library.tsx:108`).
- **Customer photos:** they never get controls (`media-card.tsx:146-147`; `photo-preview.tsx:81`).
- **Capabilities query failure:** the tab shows `TabError` with retry (`location-tab.tsx:185-191`).

## 3. Baseline steps

1. Open Photos. While loading, the page shows "Reading the photos from Google…" (`lib/locations/gating.ts:136-138`, through `streamed-tab.tsx:49` and then `location-tab.tsx:252`).
2. Look over the browse row (`photos-toolbar.tsx:60-132`):
   - the radio group "Photo ownership", with **All**, **Your photos** and **Customer photos** (`photos-url-state.ts:34-41`);
   - "Category" with a select "Filter by category". Its placeholder is **All categories**, and it lists the 13 Google categories, humanised (`media-labels.ts:35-51`);
   - **Refresh from Google**, which is icon-only below `md` (`:120-129`);
   - **Add photos** (`photos-library.tsx:118-121`).
3. Choose a filter. The URL is written with `router.replace`, and the defaults are dropped (`photos-tab.tsx:45-57`). The grid refetches with `keepPreviousData` (`lib/queries/use-location-media.ts:57`).
4. Scan the grid, `ul aria-label="Photos"` (`photos-grid.tsx:96-99`):
   - Each tile is a 4:3 button named "Preview {Category} {photo}". It carries the image labels "Logo", "{Category}" and "Customer", which are hidden from assistive tech (`media-card.tsx:96-143`).
   - Under a business tile are the "Move to category…" select, a star ("Use as logo") and a bin ("Delete from Google") (`:149-221`).
   - Under a customer tile is "Shared by a customer" (`:147`).
5. If there are more, use the footer "Showing 12 of 40 items" and **Load more items** (`components/ui/load-more.tsx:66-88`; `photos-grid.tsx:116-121`, noun `["item","items"]`).
6. Tap a tile to open the lightbox (`photo-preview.tsx:89-235`):
   - title "{Category}" and pill "Business photo" or "Customer photo";
   - "Added {date}", the image, and **Previous** / "3 of 12" / **Next**, or the arrow keys (`:93-102,137-164`);
   - details: "Added by", "Added", "Category", "Size", and "On Google: **Open original**" (`:166-203`);
   - a note, and for a business photo **Delete from Google** and **Use as logo** (`:206-233`).
7. Close the lightbox with × or Esc. It is a bottom sheet on a phone (`components/ui/dialog.tsx:30,126-127`).

## 4. States

| State                     | Where                                                                       | Copy / behaviour                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial/loading           | `streamed-tab.tsx:49`, `location-tab.tsx:251-252`, `query-states.tsx:72-81` | "Reading the photos from Google…" with `role=status` and `aria-busy` over a three-row skeleton (list rows, not tiles).                                                             |
| Filter change in flight   | `use-location-media.ts:55-57`                                               | The previous grid stays on screen, and nothing shows it is out of date. The toolbar already shows the new value. No `aria-busy`.                                                   |
| Refresh in flight         | `photos-toolbar.tsx:120-126`                                                | The button shows a spinner and "Refreshing…". On success nothing is said (`photos-library.tsx:71-89`, no `successToast`). On error the shared `describeActionError` toast appears. |
| Empty (no filter)         | `photos-library.tsx:171-181`                                                | h3 "No photos yet": "Google has no photos for this listing. Add the first ones above, or refresh from Google if the client added some there directly." No action.                  |
| Empty (filtered)          | `photos-library.tsx:174-188`                                                | h3 "No matching photos": "Try a different ownership or category filter." with **Clear filters**. Not announced.                                                                    |
| Input/validation          | `photos-url-state.ts:51-59`                                                 | An unknown `ownership` or `category` value in the URL falls back to "all" silently. A stale `page` is dropped (`:70`).                                                             |
| Load more                 | `load-more.tsx:66-88`                                                       | "Loading…" on the button. On failure, `role=alert` reads "We couldn’t load more items. Try again." and the rows already loaded stay.                                               |
| Load error                | `tab-states.tsx:76-90`                                                      | "We couldn’t load this section" / "{reason} Nothing was changed." with **Try again** and "Details for support". This **replaces the toolbar too** (`location-tab.tsx:249-250`).    |
| Not linked                | `tab-states.tsx:52-65`                                                      | "This location isn’t linked to Google yet" with **Link it in Setup**.                                                                                                              |
| Read-only                 | `photos-library.tsx:98-103`, `editor-frame.tsx`                             | Banner "You can look, but not change these photos" plus the reason. Tile controls are disabled. The lightbox note shows the reason.                                                |
| Thumbnail missing         | `media-card.tsx:118-124`, `photo-preview.tsx:128-133`                       | An `ImagesIcon` placeholder, with no words.                                                                                                                                        |
| Thumbnail fails to load   | `media-card.tsx:110-117`, `photo-preview.tsx:122-127`                       | **No `onError`.** The browser's broken-image glyph shows.                                                                                                                          |
| Lightbox (customer photo) | `photo-preview.tsx:83-84`                                                   | "Customer photos can’t be moved, deleted or used as your logo. If one breaks Google’s rules, report it on Google Maps."                                                            |
| Lightbox (business photo) | `photo-preview.tsx:87`                                                      | "Use as logo and Delete change the listing on Google straight away."                                                                                                               |
| Success                   | —                                                                           | Browse has no success message. The end state is the grid or lightbox showing the item.                                                                                             |

## 5. Protected rules derived from code

- **Google stays authoritative.**
  - Every write re-reads the first page from Google and seeds only that page (`photos-library.tsx:68-89`).
  - Only the first page may trigger a Google sync. A cursor page reads the cache (`lib/server/media.ts:361-386`).
  - The cache TTL is 5 minutes, and an empty cache always re-syncs (`media.ts:191,318-328`).
- **Read contract:** `GET /api/locations/{id}/media` takes `pageSize`, `cursor`, `refresh=1`, `category` and `ownership` (`app/api/locations/[id]/media/route.ts:23-31`; `lib/contracts/location-media.ts:40,187-200`). The server echoes `category` and `ownership` back (`media.ts:404-405`).
- **Server prefetch parity:** the streamed prefetch and the route answer from one function, `readMediaListResponse` (`lib/server/listing-reads.ts:40-54`). The URL param names must stay `ownership` and `category` (`photos-url-state.ts:7-8`; `lib/server/prefetch.ts:421-431,789-791`).
- **Category writes** carry `expectedGoogleHash` and an intent id. Their toasts follow the outcome ("updated on Google" versus "change sent to Google") (`photos-grid.tsx:56-82`). Do not change this.
- **Customer media are read-only.** Cover and Profile are create-only (`media-labels.ts:8-21`; `media-card.tsx:82,155`).
- **Thumbnails load with `referrerPolicy="no-referrer"`** (`media-card.tsx:113`, `photo-preview.tsx:125`), asserted in `tests/components/photos-tab.test.tsx:240-256`.
- **The tab shell gate order** (capabilities, then resource, then error, then pending) is shared (`location-tab.tsx:169-271`). Do not change it from here.

## 6. 15 Oct audit status for this flow

| ID                            | Finding                                                                    | Status                                                 | Evidence (current code)                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| LST-14 (P1)                   | Areas fetch after hydration                                                | **Fixed** (photos already streamed)                    | `page.tsx:36-42` `StreamedTab`; results.md:222                                                                                                |
| LST-15 (P2)                   | The upload sheet contradicts itself and is not named like its entry button | **Fixed** (it is F02's, but entered from this toolbar) | The button "Add photos" matches the heading "Add photos" (`tests/components/photos-tab.test.tsx:213-235`); results.md:223                     |
| SET-13 / LST-22 (P2)          | The photos select sheet has no title (`Managing photos/screen-02`)         | **Fixed**                                              | `photos-toolbar.tsx:108` `title="Filter by category"`; `media-card.tsx:172` `title="Move to category"`; results.md:273                        |
| DSK-15 (P2)                   | The card says "Check" for Photos                                           | **Fixed**                                              | `area-cards.tsx:283-284` "Open"; results.md:301                                                                                               |
| LST-06 (P1)                   | Five header rows before content (lists `Managing photos/screen-01`)        | **Partly fixed** (listings core)                       | results.md:214. Not this flow's files.                                                                                                        |
| DSK-22 (P2)                   | A failed photo shows the broken-image glyph                                | **Fixed in the inbox only. Remains for photos.**       | Fallback at `components/inbox/review-detail.tsx:703-783,855-859`. `media-card.tsx:110-117` and `photo-preview.tsx:122-127` have no `onError`. |
| perf (results.md:172,523,669) | Desktop Photos LCP is 846 ms against a 580 ms baseline                     | **Remains (measurement)**                              | No ceiling is configured. Out of scope for copy or a11y.                                                                                      |

## 7. Friction

1. **P2. A failed thumbnail shows a broken image** in both the grid and the lightbox. Google CDN URLs expire. `media-card.tsx:110-117` and `photo-preview.tsx:122-127` have no `onError`, and the inbox already solved this (DSK-22).
2. **P2. Tile names are not unique and leave out the visible labels.** Twelve tiles all read "Preview Additional photo" (asserted at `photos-tab.test.tsx:418`). The visible "Customer" label is `aria-hidden` (`media-card.tsx:135-141`), so a screen-reader user can't tell whose photo it is before opening it (WCAG 1.3.1, 2.4.6, 2.5.3). The same applies to "Delete Interior photo" and "Change category for …" (`:164,212`).
3. **P2. A filter change leaves a stale grid with no busy cue.** The toolbar shows "Customer photos" while the old mixed grid stays, and old tiles can still be tapped and acted on (`use-location-media.ts:57`). When the cache is cold this can take seconds (a live Google read).
4. **P2. The empty-state copy is wrong for some viewers.** "Add the first ones above" is shown even to viewers who can't add. It uses "above", a location-based instruction (WCAG 1.3.3), and "the client", an agency word, in a business workspace (`photos-library.tsx:180`). The filtered empty "No matching photos" is not announced when it replaces the grid (WCAG 4.1.3), while the footer count is a live region that disappears.
5. **P3. The lightbox position counts only loaded items.** It reads "12 of 12" and Next is disabled when 40 exist (`photo-preview.tsx:148-153`; this limit is acknowledged at `:38-40`). The operator may think they have seen everything.
6. **P3. A successful Refresh from Google gives no feedback** (`photos-library.tsx:71-89`). If nothing changed, the user can't tell whether it ran. On a phone the button is icon-only (`photos-toolbar.tsx:122`).
7. **P2. A failed filter fetch replaces the toolbar with "We couldn’t load this section"** (`location-tab.tsx:249-250`). "Try again" retries the same filter, and because the filter was applied with `router.replace`, Back does not undo it. The fix is in the shared `LocationTab` or `usePagedResource`, so it is **not proposed here**. Flag it to the listings-core and lib owners.
8. **P3. Count wording differs.** The header says "3 of your photos" (business photos only, `area-state.ts:183`). The footer says "Showing all 5 items" (all ownerships, `photos-grid.tsx:119`). Same page, two nouns and two scopes. Shared or listings-core; flag only.
9. **P3. Labels repeat.** A customer tile says "Customer" on the image and "Shared by a customer" beneath it (`media-card.tsx:141,147`). The lightbox says "Added {date}" in the description and again in the details (`photo-preview.tsx:112-114,172-177`).
10. **P3, Hypothesis.** Customer photos have `attribution` (`contracts/location-media.ts:177`), but the lightbox shows only "A customer". Showing the contributor's name may help operators judge or report a photo. Needs a product decision, and maybe Google policy.
11. **P3, Hypothesis.** On a phone the lightbox is a sheet with Previous/Next buttons only. Operators may expect to swipe. Untested.

## 8. Proposed changes

All six are presentation, copy, a11y or local state, in this flow's own files. None touches a shared file, `lib/`, a route or a contract. `media-card.tsx` and `photo-preview.tsx` are also listed under F03 (delete), so coordinate the label change (C2) with the F03 thread.

**C1. Fallback for a thumbnail that fails** (friction 1; Nielsen #1 visibility of system status, HIG "Images", WCAG 1.1.1)

- **Files:** `media-card.tsx` and `photo-preview.tsx`. Mirror `components/inbox/review-detail.tsx:703-783`.
- **media-card.tsx:** add `const [failed, setFailed] = useState(false)`. Render the image only when `item.thumbnailUrl && !failed`, add `onError={() => setFailed(true)}`, and add the same `ref` check for `complete && naturalWidth === 0 && currentSrc`. The else branch becomes `<span title={failed ? "Photo unavailable" : undefined} …>`, showing `{failed ? <ImageOffIcon …/> : <ImagesIcon …/>}` and `{failed ? <span className="sr-only">Photo unavailable</span> : null}`.
- **photo-preview.tsx:** use a local `failedId` state, keyed by `item.id` so that Next resets it. On failure, render `<p className="py-10 text-center text-body text-ink-muted">This photo can’t be shown here. Open the original on Google to see it.</p>` in place of the image. "Open original" already sits below.
- **Benefit:** an expired CDN URL reads as a known state, not a broken page.

**C2. Unique, complete tile names** (friction 2; WCAG 2.5.3 Label in Name, 1.3.1, 2.4.6)

- **File:** `media-card.tsx:81-99,164,194,212`.
- **Change:** `const created = formatMediaDate(item.createTime)` (from `media-labels.ts`). `const name = \`${categoryLabel} ${mediaKind}${customer ? " from a customer" : ""}${created ? \`, added ${created}\` : ""}\``.
- The labels become `Preview ${name}`, `Change category for ${name}`, `Use this ${mediaKind} as the logo, ${created ? \`added ${created}\` : categoryLabel}`and`Delete ${name}`.
- **Before and after:** "Preview Additional photo" becomes "Preview Additional photo from a customer, added 1 Jul 2026" (the date comes from `formatMediaDate`).
- **Benefit:** the tiles can be told apart, and ownership is heard before opening.

**C3. Show that a filtered grid is still loading** (friction 3; Nielsen #1, WCAG 4.1.3, HIG "Loading")

- **File:** `photos-library.tsx:65-66,125-143`. This is local, derived state. It uses the server's echo, and the hooks stay unchanged.
- **Change:** `const settling = (media.category ?? null) !== query.category || (media.ownership ?? null) !== query.ownership`.
- Wrap the empty/grid branch in `<div aria-busy={settling || undefined} className={cn("transition-opacity motion-reduce:transition-none", settling && "pointer-events-none opacity-60")}>`.
- Above it, add `{settling ? <p role="status" className="text-caption text-ink-muted">Loading matching photos…</p> : null}`.
- **Benefit:** the operator can't act on, or delete from, a list the filter no longer describes. `pointer-events-none` only blocks interaction while the new page loads; it does not change any write.

**C4. Empty-state copy that depends on role, and announcing the filtered result** (friction 4; Nielsen #2 and #9, WCAG 1.3.3, 4.1.3)

- **File:** `photos-library.tsx:126-131,163-191`. Pass `canAdd={!disabled}` to `PhotosEmpty`.
- **Unfiltered description:**
  - Old: "Google has no photos for this listing. Add the first ones above, or refresh from Google if the client added some there directly."
  - New, with `canAdd`: "Google has no photos for this listing yet. Use Add photos to upload the first ones, or Refresh from Google if someone added them on Google directly."
  - New, without `canAdd`: "Google has no photos for this listing yet. Refresh from Google if someone added them on Google directly."
- **Filtered:** add `role="status"` (the `Empty` `role` prop, documented for "replaces content"). Old: "Try a different ownership or category filter." New: "Nothing here matches these filters. Try another ownership or category, or clear them."
- **Benefit:** the copy is accurate for every role, has no spatial instruction, and the result is announced.

**C5. An honest lightbox position** (friction 5; Nielsen #1, HIG "Navigation")

- **Files:** `photo-preview.tsx:52-64,148-153` and `photos-grid.tsx:123-126`.
- **Change:** add the prop `total?: number`, and pass `total={total}` from the grid.
- **Copy:** `{index + 1} of {list.length}` becomes `{index + 1} of {list.length}{total && total > list.length ? \` loaded · ${formatNumber(total)} in all\` : ""}`.
- **Before and after:** "12 of 12" becomes "12 of 12 loaded · 40 in all".
- **Benefit:** a disabled Next no longer implies "end of library".

**C6. Confirm the refresh once the server answers** (friction 6; Nielsen #1)

- **File:** `photos-library.tsx:71-89`.
- **Change:** add to `useResourceMutation`: `successToast: (fresh) => fresh.total === 0 ? "Refreshed from Google: no photos yet" : \`Refreshed from Google: ${formatNumber(fresh.total)} ${fresh.total === 1 ? "item" : "items"}\``.
- **Constraint:** the toast fires in `onSuccess` only, after the GET resolves, so the server is still authoritative. Write paths that call `refreshFromGoogle` (add, delete, resolve) would toast twice. Gate it with a `const [announceRefresh, setAnnounceRefresh] = useState(false)` set only by the toolbar's `onRefresh`, or pass `refresh.mutate({ announce: true })` and return `null` otherwise.
- **Benefit:** an explicit "it ran" after a manual refresh.

**Not proposed (shared, flagged):** friction 7 (`components/locations/location-tab.tsx` / `lib/queries/paged-list.ts`) and friction 8 (`lib/listings/area-state.ts`, `components/ui/load-more.tsx` noun). Friction 9 is optional polish: dropping "Shared by a customer" or the duplicate "Added" line is local, but it changes the asserted copy `photos-tab.test.tsx:237`.

## 9. Tests

The existing unit test is `tests/components/photos-tab.test.tsx`. It mocks `useMedia` directly, so the server echo of `category`/`ownership` is `null` in `makeMedia`. Assertions that the proposals break or affect:

- **C2:**
  - `:273` `"Preview Interior photo"` (m1 has a `createTime`) becomes "Preview Interior photo, added …".
  - `:418,:435` `/^Preview Additional photo$/` (`manyItems` has a `createTime`) need a prefix regex.
  - `:508` `"Delete Interior photo"` changes.
  - `:505` and `:511` are `queryBy…` checks for a customer tile. They still pass, but trivially, so update the names.
- **C3:** the test at `:553-568` seeds `ownership=customer&category=INTERIOR` with `ownership: null` in the data, so the "Loading matching photos…" status would render. Set `ownership: "customer", category: "INTERIOR"` in that test's `makeMedia`. The text "No matching photos" still passes.
- **C4:** no test asserts the empty description. `"No matching photos"` and "Clear filters" (`:562,564`) are kept.
- **C5 and C1:** `:277-282` (heading "Interior", link "Open original") are kept.
- **e2e:** `tests/e2e/listings.spec.ts:230-249` (Add photos dialog) and `tests/e2e/routing.spec.ts:330-336` (H1 "Photos") are unaffected. `tests/e2e/client-hub.spec.ts:97` covers only the link.
- **Lib:** `tests/lib/photos-url-state.test.ts` is unaffected.
- **Focused tests worth adding (same file):**
  - (a) firing `error` on a tile `<img>` shows "Photo unavailable" and no `<img>` is left in that tile;
  - (b) a mismatched `ownership` echo renders `role=status` "Loading matching photos…" and `aria-busy` on the grid wrapper;
  - (c) the lightbox with `total: 15` and 12 items reads "1 of 12 loaded · 15 in all";
  - (d) a customer tile's name contains "from a customer";
  - (e) the unfiltered empty state with a `writeReason` does not mention "Add photos".

## 10. Screenshot states for BEFORE/AFTER

The fixture's Google stub returns `{ mediaItems: [] }` for both `/media` and `/media/customers` (`tests/e2e/helpers/stub-bridge.ts:402-409`). No `gbp_media_item` rows are seeded, and an empty cache re-syncs on every read (`media.ts:324`). So, with the owner on `/listings/{loc}/photos`:

| State                                                                                      | Reachable?                          | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading                                                                                    | Briefly                             | Cold load. "Reading the photos from Google…" is the streamed fallback. Hard to capture.                                                                                                                                                                                                                                                                                                                                                                              |
| Empty, unfiltered (C4)                                                                     | **Yes**                             | `/listings/{loc}/photos`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Empty, filtered (C4)                                                                       | **Yes**                             | `/listings/{loc}/photos?ownership=customer` or `?category=INTERIOR`                                                                                                                                                                                                                                                                                                                                                                                                  |
| Refresh pending, or C6 toast                                                               | **Yes**                             | Tap "Refresh from Google". The stub answers fast, so the pending state may flash. The toast is capturable.                                                                                                                                                                                                                                                                                                                                                           |
| Read-only banner and empty copy without Add (C4)                                           | Yes, with a viewer or member cookie | The fixture has `viewerCookie` (`stub-bridge.ts:52`).                                                                                                                                                                                                                                                                                                                                                                                                                |
| Grid, tile names, stale filter cue, lightbox, Load more, failed thumbnail (C1, C2, C3, C5) | **No** with the current stub        | Needs fixture media. Either extend the stub's `/media` handler in `stub-bridge.ts:402-409` (a shared test helper, so flag it) to return a few `mediaItems` (merchant and customer, a fake thumbnail host so that C1's failure shows naturally, more than 12 items so Load more and C5 show), or seed `gbp_media_item` with a fresh `observed_at` (it lasts the 5-minute TTL). Note that `page.route` alone won't do it, because the first page is server-prefetched. |

For C3 BEFORE/AFTER, the filter fetch must be slow: delay the stub's `/media` response by about 2 s.
