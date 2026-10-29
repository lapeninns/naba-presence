# p3-F02 — Board selection, bulk-change hand-off, and "Add listings"

Read-only analysis of `/tmp/naba-presence-p3` at `e4123d25` (branch `ux/flows-presence-p3`).

## 1. Flow

- **ID:** p3-F02.
- **Goal:** pick several listings on the board and hand them to a bulk change, or start adding new listings from Google.
- **Start:** `/listings` (`app/(dashboard)/listings/page.tsx:19-47`) renders `ListingsBoard` (`components/listings/listings-board.tsx:605`).
- **End, bulk branch:** the hand-off link `Prepare bulk change` to `/listings/bulk?ids=a,b,c` (`listings-board.tsx:1294-1299`). The compose page belongs to p4, so this analysis stops there.
- **End, add branch:** `Add listings from Google` to `/setup` (`components/listings/add-listings-link.tsx:23`), which is p2's screen.
- **Side task on the same rows:** filing an unfiled listing under a client with `FileUnderClient` (`listings-board.tsx:963-974`, `components/listings/file-under-client.tsx`).
- **Roles:**
  - Selection: owner or admin, and only when the organisation has the `bulk_actions` feature (`page.tsx:21-27`, `listings-board.tsx:616-617`).
  - Add listings and File under: owner or admin (`listings-board.tsx:577,757,798-813,964,1258`).
  - Member and viewer: none of these controls. A member sees "Not filed" (`:972`).

## 2. Code map

| Piece                                                                        | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server gate: `canManage`, `bulkActionsEnabled`                               | `app/(dashboard)/listings/page.tsx:20-29,44`; `lib/server/bulk-listings.ts:97-101`                                                                                                                                                                                                                                                                                                                                                                                   |
| Selection state: an explicit `Set` of ids, capped at `BULK_MAX_TARGETS` = 50 | `listings-board.tsx:618-630`; `lib/domain/bulk-merge.ts:37`                                                                                                                                                                                                                                                                                                                                                                                                          |
| Select all shown, its blocked reason and its phone bar label                 | `listings-board.tsx:877-896,1187-1223`; `components/ui/table.tsx:383` (`TableSelectAllLabel`)                                                                                                                                                                                                                                                                                                                                                                        |
| Row checkbox                                                                 | `listings-board.tsx:907-923`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Selection bar (`ActionBar dock`, region "Bulk change selection")             | `listings-board.tsx:1268-1302`; `components/ui/action-bar.tsx:130` (returns `null` when not visible), `:156-160` (polite live status)                                                                                                                                                                                                                                                                                                                                |
| Hand-off link                                                                | `listings-board.tsx:1294-1299` (`next/link`, `?ids=` joined)                                                                                                                                                                                                                                                                                                                                                                                                         |
| What the receiver does (p4, read only)                                       | `app/(dashboard)/listings/bulk/page.tsx:14,16` (role gate, `notFound` without the feature); `components/bulk/bulk-compose.tsx:307-313` (parse ids, never trimmed), `:662` ("Go back and select fewer."), `:715-721` ("Back to listings" goes to `/listings` with no ids); `lib/server/bulk-listings.ts:178-191` (each unlinked listing becomes a per-listing `skip`)                                                                                                 |
| Add listings                                                                 | `components/listings/add-listings-link.tsx:21-28` (`ShellLink` to `/setup`, prefetched on intent); used at `listings-board.tsx:579,759,1260`; the empty state uses its own `Link` at `:805-812`                                                                                                                                                                                                                                                                      |
| Setup landing (p2, read only)                                                | `app/(dashboard)/setup/page.tsx:68-70` (owner or admin), `:93-118` (`?client=` opens the wizard, `notFound` if the client is invalid or not visible), `:127-131` and `:205-210` (without a client it shows the "Client setup" chooser)                                                                                                                                                                                                                               |
| File under client                                                            | `file-under-client.tsx:47-145`: loading `:49-54`, error and retry `:55-85`, no clients `:86-101`, Select `:103-143`, success toast after the server answers `:112-122`                                                                                                                                                                                                                                                                                               |
| Unit tests                                                                   | `tests/components/listings-board.test.tsx`: `:153` "puts unfiled listings first and offers to file them", `:473` "keeps Add listings from Google at the end…", `:503` "selects every listing shown … docks the selection bar", `:545` "refuses to select all shown past 50…", `:582` "keeps the filing control away from members", `:591` "offers setup when there are no listings at all", `:625` "still offers Add listings from Google … while loading or failed" |
| E2E                                                                          | `tests/e2e/operations-features.spec.ts:536` "hides bulk changes from an organisation without the bulk_actions feature"; `:560` "prepares, approves and runs a bulk special-hours change…" (ticks 2 rows, checks the region shows "2 selected", clicks "Prepare bulk change")                                                                                                                                                                                         |

## 3. Steps today

1. **Initial.**
   - While the directory loads: a skeleton, with `Add listings from Google` for owners and admins (`:734`, `:528-584`).
   - On a directory error: "We couldn’t load your listings" with Try again, and Add listings still offered (`:736-764`).
   - With no listings: "No listings yet". An owner or admin gets a **secondary** `Link` to `/setup`; others read "An owner or admin can add the first listing." (`:790-817`).
2. **Board with selection enabled** (owner or admin, feature on).
   - Every row has a checkbox named "Select {name} for a bulk change". The table header has "Select all shown (N)". On phone cards that becomes a bar above the cards that reads "Select all shown (N) · k selected" (`:1214-1220`).
   - There is no separate "select mode": the checkboxes are always there.
3. **Input and validation.**
   - Ticking a row adds its id. Once 50 are selected, unticked rows are disabled (`:913-916`), and the bar adds "(the most one change can cover)" (`:1280-1282`).
   - When the union would pass 50, select-all is disabled and a reason paragraph describes it (`:1187-1198`).
4. **Filtering while selected.** Filters and search change only what is shown. Hidden ids stay selected (`:877-880`). The bar still says "N selected", with no hint that some are not on screen.
5. **Selection bar.** It appears with the first tick: docked on a phone, sticky on a desk. Its status is "N selected" (polite live region). It has two actions:
   - `Clear selection`: empties the set. The bar unmounts, so the focused button disappears.
   - `Prepare bulk change`: a link to `/listings/bulk?ids=…`.
6. **Hand-off.** The link navigates. The p4 page then:
   - re-checks the role and the feature;
   - lists "Selected listings";
   - says "Nothing is sent until the preview is approved and started."
     Unlinked listings are skipped per listing at preview, on the server. "Back to listings", or browser Back, returns to a board whose selection is **empty**, because it is `useState` only (`:620-622`).
7. **Add listings.**
   - It sits at the end of the list (`:1256-1262`) and goes to `/setup`.
   - In agency mode, `/setup` with no client shows the "Client setup" chooser. That happens even when the board is filtered to one client.
   - In business mode, setup resolves the home client itself.
8. **File under (unfiled rows).** The control is in the Client cell.
   - States: "Loading clients…"; an error with Retry, or "Sign in again" on a 401; "No clients yet." with Create client.
   - After a pick: "Filing…", then a success toast once the server answers.
   - The row then leaves the unfiled group. Its cell becomes the client name, so the Select trigger unmounts.

## 4. Protected rules for this flow

- Only owners and admins with `bulk_actions` can select. The server decides this (`page.tsx:21-27`), and the compose route enforces it again (`bulk/page.tsx:14,16`).
- The selection is explicit ids. It is never trimmed to fit, and select-all refuses rather than trims (`listings-board.tsx:618-619,877-896`; `bulk-compose.tsx:305-306`).
- Nothing is sent from the board. The preview freezes the ids, and Google writes happen only after approve and start (`bulk-compose.tsx:715`). Unlinked or non-publishable listings are skipped by the server (`bulk-listings.ts:180-191`).
- Add listings and File under are for owners and admins only. Setup enforces the role and client visibility on the server (`setup/page.tsx:68-70,93-110`).
- Filing is confirmed only after the server answers (`file-under-client.tsx:112-122`).

## 5. Prior audit status

| ID          | Relevance                                                                            | Status                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LST-07 (P1) | Add listings above the board; zero-count chips; order control                        | **Fixed** (L04/F3, #166 and #205). Add listings is at the end (`:1256-1262`), with `hideWhenZero` (`:1083`) and the order chip (`:109-151`). `b4012ea0` also made Add listings reachable while loading or failed (`:577,757`) |
| DSK-23 (P2) | Row click opens a quick look from `lg`                                               | **Fixed** (#230, `:935-946`). It does not interact with the checkbox, which is raised above the stretched link (`:909-910`)                                                                                                   |
| SET-13 (P2) | Sheets need a title                                                                  | **Fixed.** File under's `SelectContent title="File under a client"` (`file-under-client.tsx:135`)                                                                                                                             |
| —           | No LST or DSK finding covers bulk selection, the hand-off or the Add listings target | Nothing open from the audit; the issues below are new                                                                                                                                                                         |

## 6. Friction

| #   | Problem                                                                                                                                                                                                                                     | Evidence                                                                                                                                                                                           | Sev | Heuristic / WCAG                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------- |
| 1   | Going back from the bulk page loses the whole selection (up to 50 ticks), including on p4's own "Go back and select fewer." path                                                                                                            | `listings-board.tsx:620-622` (`useState(() => new Set())`); `bulk-compose.tsx:662`, `:718` `href="/listings"`; `next.config.ts` does not enable `cacheComponents`, so route state is not preserved | P2  | Nielsen 3 (user control); HIG "preserve context"  |
| 2   | The bar's "N selected" counts listings that the current filter hides, and says nothing about them                                                                                                                                           | `:877-880` (selection is kept across filters by design); bar status `:1276-1283`                                                                                                                   | P2  | Nielsen 1 (visibility of status)                  |
| 3   | Listings not linked to Google can be selected with no warning, and the server preview skips them                                                                                                                                            | rows of any health are selectable (`:907-923`); `bulk-listings.ts:188-190` `skip: … "not_linked"`                                                                                                  | P2  | Nielsen 5 (error prevention)                      |
| 4   | `Clear selection` unmounts its own bar while focused, so keyboard and screen-reader focus falls to `<body>`                                                                                                                                 | `:1287-1293`; `action-bar.tsx:130` `if (!visible) return null`                                                                                                                                     | P2  | WCAG 2.4.3 Focus Order; Nielsen 3                 |
| 5   | Once the cap is reached, unticked row checkboxes are disabled with no reason tied to them. The reason exists only as muted text in the bar                                                                                                  | `:913-916`; `:1281` "(the most one change can cover)"                                                                                                                                              | P3  | WCAG 1.3.1 / 3.3.2; Nielsen 9                     |
| 6   | Filtered to one client, `Add listings from Google` still lands on the "Client setup" chooser, so the user has to pick the same client again                                                                                                 | `add-listings-link.tsx:23` `href="/setup"`; `setup/page.tsx:205-210`; setup already accepts `?client=` (`:93-118`)                                                                                 | P3  | Nielsen 7 (efficiency)                            |
| 7   | The "No listings yet" action is a hand-made secondary `next/link`. It prefetches the heavy `/setup` on viewport, which contradicts `add-listings-link.tsx:19` "Prefetched on intent only", and the only action on the screen is not primary | `:805-812`                                                                                                                                                                                         | P3  | HIG hierarchy / consistency                       |
| 8   | **Hypothesis:** `Prepare bulk change` is a viewport-prefetching `next/link` whose `href` changes on every tick, so each new selection may trigger another prefetch                                                                          | `:1294-1299` (contrast `ShellLink`, `components/app-shell/shell-link.tsx:15-27`)                                                                                                                   | P3  | Performance (not measured)                        |
| 9   | Filing a listing replaces the focused Select trigger with plain client text (`:960-982`), so focus is lost after the toast                                                                                                                  | `file-under-client.tsx:106-142`                                                                                                                                                                    | P3  | WCAG 2.4.3 (follow-up; not proposed here, see §7) |

## 7. Proposed changes

All changes are in `components/listings/listings-board.tsx` and `components/listings/add-listings-link.tsx`, both area-local. **No shared file changes.** `ShellLink`, `ActionBarMuted`, `Checkbox` and `replaceUrl` are used as they are.

### C1: Keep the selection across the hand-off (#1, #8)

- **Change.** In the `actions` of `ActionBar` (`:1294-1299`):
  - Replace `Link` with `ShellLink` (intent prefetch). That removes the per-tick viewport prefetch.
  - Add `onClick={() => writeUrl({ selected: [...selected] })}`. This writes the ids into the board's own history entry (via `replaceUrl`) before the push to `/listings/bulk`.
- **Extend `writeUrl`** (`:676-709`) with `selected?: string[] | null`: `set("selected", next.selected?.length ? next.selected.join(",") : null, "")`.
- **Initialise `selected`** (`:620`) from `searchParams.get("selected")`:
  - Split on `,` and dedupe.
  - If there are more than `BULK_MAX_TARGETS` ids, restore **none**, because the selection is never trimmed.
  - Restore only when `canSelect`.
  - Add a one-shot effect: if the param was present, `writeUrl({ selected: null })` so a reload or shared link does not keep re-ticking.
- **Validate against the directory.** Compute `const rowIds = new Set(rows.map(r => r.entry.id))` and `const selectedIds = [...selected].filter(id => rowIds.has(id))`. Use `selectedIds` for the bar count, `visible=`, the select-all label and the `href`. A stale or foreign id then never reaches the hand-off or the count. Today every selected id is a row, so this changes nothing in the current flow.
- **Benefit.** Browser Back from `/listings/bulk` returns to the same ticks. p4's "Back to listings" can opt in later by linking to `/listings?selected=…` (follow-up for p4).
- **Principle.** User control; HIG preserved context.
- **Risk to protected behaviour.** None. It is local UI state and the URL. The ids are still only a proposal: the compose page re-gates, the server re-validates and preview freezes. Nothing is trimmed.
- **Tests.**
  - Unit (`listings-board.test.tsx`): set `search = "selected=l1,l3"`. Expect the bar to show "2 selected", the `href` to contain exactly `l1,l3`, and `replace` to be called without `selected`.
  - With `selected=` holding 51 ids, expect no bar.
  - Clicking "Prepare bulk change" calls `replace` with `selected=…`.
  - Adjust the `:503` test only if `ShellLink` renders differently under the `next/link` mock (it renders the same anchor).

### C2: Say what the count covers (#2, #3, #5)

- **Change.** In the bar `status` (`:1274-1284`), compute:
  - `hiddenSelected = selectedIds.length - shownSelected`, where `shownSelected` already exists at `:882`.
  - `unlinkedSelected = rows.filter(r => selected.has(r.entry.id) && !r.entry.linked).length`.
- **Copy**, before → after:
  - Before: `3 selected`
  - After: `3 selected` + `<ActionBarMuted> · 1 not shown</ActionBarMuted>` + `<ActionBarMuted> · 1 not linked to Google</ActionBarMuted>`. Each part appears only when non-zero. At the cap, keep `(the most one change can cover)`.
  - Do **not** claim the preview will skip them. Only the server decides that.
- **Reason for disabled rows.** Give the status `<span>` an id (`const selectionStatusId = React.useId()`). Set `aria-describedby={atCapAndUnticked ? selectionStatusId : undefined}` on the disabled row checkbox (`:911-921`). `Checkbox` spreads props after its own `aria-describedby` (`components/ui/checkbox.tsx:72,84`), so the override works.
- **Phone wrapping.** On a docked phone bar the longer status may need `statusRow` when both extras show: pass `statusRow={hiddenSelected > 0 && unlinkedSelected > 0}`. That is an existing prop (`action-bar.tsx:66-69`).
- **Benefit.** The user sees, before the hand-off, that some ticks are off screen or cannot be changed on Google.
- **Principle.** Visibility of status; error prevention; WCAG 1.3.1.
- **Risk.** None. The copy is read only and nothing is filtered out of the selection.
- **Tests.**
  - Unit: select all under "All", switch the health chip to one that hides a row, and expect the bar text `/3 selected · 1 not shown/`.
  - With an entry `linked: false` selected, expect `/1 not linked to Google/`.
  - Update e2e `operations-features.spec.ts:577` only if it used exact text. It uses `toContainText("2 selected")`, which still passes.

### C3: Return focus when the selection is cleared (#4)

- **Change.** Add `const selectAllRef = React.useRef<HTMLElement>(null)` and pass `ref={selectAllRef}` to the select-all `Checkbox` (`:1204`). Change `Clear selection`'s `onClick` to:
  ```tsx
  setSelected(new Set())
  requestAnimationFrame(() =>
    (selectAllRef.current ?? document.getElementById("main"))?.focus()
  )
  ```
  The `#main` fallback has `tabIndex={-1}` (`components/app-shell/app-shell.tsx:410-412`), the same pattern as `listing-gate.tsx:49`.
- **Benefit.** Keyboard and screen-reader users stay on the board at the control that starts a new selection. On a phone it is the select-all bar right above the cards.
- **Principle.** WCAG 2.4.3; consistent feedback.
- **Risk.** None.
- **Test.** Unit: select all, click "Clear selection", and expect `document.activeElement` to be the "Select all shown (3)" checkbox.

### C4: Send "Add listings" to the client already in view, and use one Add link everywhere (#6, #7)

- **Change in `AddListingsLink`.** Add an optional `clientId?: string` prop:
  ```tsx
  href={clientId ? `/setup?client=${encodeURIComponent(clientId)}` : "/setup"}
  ```
  Keep the label "Add listings from Google". The wizard names the client.
- **Change in the board.**
  - `const addClientId = !business && clientFilter && clientFilter !== UNFILED && clients.data?.items.some(c => c.id === clientFilter) ? clientFilter : undefined`
  - Pass `<AddListingsLink clientId={addClientId} />` at `:1260`.
  - Pass `addClientId` at `:759` only once `clients.data` exists. The skeleton at `:579` stays unscoped.
  - The guard means a stale or archived `?clientId=` falls back to the chooser, never to setup's `notFound` (`setup/page.tsx:94-110`).
- **Empty state.** Replace the hand-made `Link` at `:805-812` with `<AddListingsLink />`. It becomes primary, intent-prefetched and the same component as everywhere else. Then drop the now-unused `PlusIcon` and `Link` imports if nothing else uses them; `Link` is still used at `:384`, so keep that import.
- **Benefit.** One step fewer for an agency adding to the client it is looking at. The heavy `/setup` page is no longer prefetched from the empty board, and Add looks and behaves the same in every state.
- **Principle.** Efficiency; consistency; hierarchy.
- **Risk.** None. The setup route still enforces the role and client visibility on the server, and no API changes.
- **Tests.**
  - Unit: render with `search = "clientId=c1"` (owner) and expect the Add link's `href` to be `/setup?client=c1`.
  - With `clientId=__unfiled__`, or an unknown id, expect `/setup`.
  - `:591` still passes. It matches the name by regex and checks `href="/setup"`.

### Not proposed (kept as is)

- A separate "Select" mode like the Inbox's. The checkboxes are always on for owners and admins with the feature, and only those users see them. Changing that is a design decision, not a fix (**Hypothesis**: phone cards are busier).
- #9, focus after filing. It needs a decision about where focus should land once the row moves groups, for example the new client cell or the toast. It is listed as a follow-up.

## 8. Screenshots to capture

The visual fixtures must have `bulk_actions` on for selection states. If they don't, record selection states as **Blocked** and capture only the Add states.

1. `/listings?selected={loc},{loc2}`, role **owner**, widths 390 and 1280. _After C1_ the selection bar is reachable by URL. _Before_, this shows an empty selection, which is itself the "before" evidence for #1. To show C2's "not shown" text, use `/listings?selected={loc},{loc2}&health=healthy` if one of the two is not healthy.
2. `/listings?clientId={client}`, role **owner**, width 390, scrolled to the end. Hover the "Add listings from Google" link, or inspect its `href`; the change is mostly in the `href`, so a DOM note is enough.
3. `/listings`, role **member**, width 390: no checkboxes and no Add link, unchanged (a regression check).
4. The empty board ("No listings yet") is not reachable with the seeded tenant. Use the unit test instead of a screenshot.

## 9. Files touched

components/listings/listings-board.tsx
components/listings/add-listings-link.tsx
tests/components/listings-board.test.tsx

## Follow-ups (out of scope)

- **p4:** have `bulk-compose.tsx:718` "Back to listings" (and the `:662` "Go back and select fewer." path) link to `/listings?selected=<ids>`, so C1 also restores from the in-page link, not only from browser Back.
- **#9:** decide where focus lands after "File under…" succeeds (`file-under-client.tsx` with `listings-board.tsx:960-982`).
- **#8:** measure prefetch requests while ticking, to confirm or drop the hypothesis. C1 removes the cause either way.
