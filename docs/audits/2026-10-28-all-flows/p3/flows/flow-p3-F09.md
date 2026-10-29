# p3-F09 · Edit the food menu

Code read at `/tmp/naba-presence-p3` (`ux/flows-presence-p3`, head `e4123d25`). Read-only analysis.

## 1. Flow

- **ID / name:** p3-F09, Edit the food menu.
- **Goal:** an owner or admin builds or changes the venue's food menus (menus, sections, items, prices), saves NabaPresence's copy, or hands the whole replacement to review and publish.
- **Start:** `/listings/[id]/menu`, `app/(dashboard)/listings/[id]/menu/page.tsx:20-35` (`StreamedTab` → `AreaEditor area="menu"`, which lazy-loads `MenuTab` at `components/listings/area-frame.tsx:929-930`).
- **End (any of):** (a) "Save here" confirmed by the server (`saved_locally` toast, `menu-tab.tsx:199-219`); (b) the Review sheet's publish confirmed (`"Menu live on Google"` / `"Menu sent to Google"`, `menu-tab.tsx:184-190`), or parked for a second approver (server, `app/api/locations/[id]/food-menus/route.ts:73-81`); (c) Discard or leave-and-discard (`menu-tab.tsx:385-394`, `components/editors/draft-notices.tsx:86-92`).
- **Roles:** owner and admin edit and save (`lib/locations/gating.ts:39-43`, `:171-181`; server `roles: ["owner","admin"]` at `route.ts:34-37`). Publishing also needs `canPublish` (`gating.ts:71-77`) and MFA step-up (`route.ts:64`). Member and viewer get the read view (`menu-tab.tsx:289-290`).

## 2. Code map

| Piece                                             | Where                                                                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Route + streamed first read                       | `app/(dashboard)/listings/[id]/menu/page.tsx:20-35`, `lib/server/prefetch.ts:884-893`                                                    |
| Load / error / retry                              | `components/locations/location-tab.tsx` (`TabLoading`, `TabError` "We couldn’t load this section" + "Try again", `tab-states.tsx:79-85`) |
| Eligibility gate                                  | `menu-tab.tsx:49-69`                                                                                                                     |
| Draft, revision follow, stash                     | `menu-tab.tsx:82-91` (`useEditorDraft`, scope `location-menu`)                                                                           |
| Validation                                        | `menu-editor.tsx:256-302` (`validateMenu`), summary `menu-tab.tsx:323-333`                                                               |
| Save here                                         | `menu-tab.tsx:199-228` → `saveFoodMenus` → `PUT /api/locations/[id]/food-menus`                                                          |
| Review & publish                                  | `menu-tab.tsx:124-195`, `:235-251`, `:396-413` (`ReviewChangesSheet`, SHARED) → `POST …/food-menus` (`submitListingChange`)              |
| Comparison                                        | `lib/locations/menu-diff.ts` (`compareMenuReplacement`; read-only)                                                                       |
| Empty states                                      | `menu-tab.tsx:335-365` ("No food menu yet"), `menu-editor.tsx:799-817` ("Build your first menu"), `:1104-1110` ("Start with a section")  |
| Menu picker, view switch, New menu                | `menu-editor.tsx:844-921`                                                                                                                |
| Menu details / remove menu                        | `menu-editor.tsx:929-1011`                                                                                                               |
| Find tools (search, jump, changed only, collapse) | `menu-editor.tsx:1013-1102`, thresholds `:74-75`, `:519-522`                                                                             |
| Sections                                          | `components/locations/menu/section-editor.tsx:26-188`                                                                                    |
| Items (row + sheet, price)                        | `components/locations/menu/item-editor.tsx:141-251`, `:265-418`; price parse `menu-editor.tsx:119-151`                                   |
| Remove / undo                                     | `menu-editor.tsx:641-736`, banner `:825-842`, dialog `:1298-1333`                                                                        |
| Preview                                           | `menu-editor.tsx:738-740`, `:884-897`, `:923-926`, `menu/menu-preview.tsx`                                                               |
| Leave guard                                       | `components/editors/draft-notices.tsx:41-44`, `:86-92`, `lib/editors/use-leave-guard.ts`                                                 |

**Tests.** E2E: only `tests/e2e/listings.spec.ts` "Food menu loads clean (light)" / "(dark)" (the `AREAS` loop, `:28`, `:181-228`: h1, console, axe). No e2e edits a menu. Component: `tests/components/menu-tab.test.tsx` (13 tests: save here + discard, ineligible notice, reviewed preconditions, revision preservation, find-tool thresholds, summary-link focus), `tests/components/menu-editor.test.tsx` (21 tests: price typing, removal/undo, reorder, duplicate, empty→menu→section→item, read-only), `tests/components/menu-navigation.test.tsx` (8 tests: search, changed-only, jump, focus return).

## 3. Steps today

1. **Open** `/listings/{id}/menu`. Initial: streamed skeleton ("food menu"), then the editor. Error: "We couldn’t load this section" + "Try again". Not eligible: "This location can’t have a food menu" (`menu-tab.tsx:62-68`).
2. **Empty** (no sections anywhere in the draft, `menu-tab.tsx:233`): "No food menu yet" with "Start from Google’s menu" (if Google has one) and "Start a menu" (`:335-365`). No footer, no description (`:276`, `:292`).
3. **Pick a menu** in the "Menu" select; "Edit menu | Preview" segmented control; "New menu" (`menu-editor.tsx:853-907`). Caption: "1 menu in this draft. Saving, review and publishing include every menu, not only the one selected." (`:910-913`).
4. **Menu details:** "Menu name", "Menu description (optional)", "Remove menu" (`:929-1011`).
5. **Sections:** each a card headed by its name with "N items", collapse chevron and ⋯ (Move up/down, Remove section). Fields "Section name", "Section description (optional)", items list, "Add item" (`section-editor.tsx`). "Add section" at the end (`menu-editor.tsx:1235-1244`).
6. **Items:** a row ("Edit Soup", price "£6.5" or "No price", errors in words, "N options from Google kept as they are") with ⋯ (Move, Duplicate, Remove item). The row opens a sheet: "Item name", "Description", "Price (GBP)", "Done" (`item-editor.tsx:141-418`). Dietary/allergen data is not editable; it rides along untouched in `attributes`.
7. **Find tools** appear above 2 sections or 12 items: search, "Jump to section", "Changed items only", collapse/expand all, "N of N items shown · N sections total" (`menu-editor.tsx:1013-1102`).
8. **Remove:** dialog "Remove Starters?" / "2 items will be removed from this draft. You can undo the last removal, and Google keeps its menu until you review and publish." / "Keep editing" | "Remove section"; then an info banner with "Undo removal" (`:825-842`, `:1298-1333`).
9. **Footer** arrives with the first edit: status ("Changes not on Google" / "Not on Google yet"), "Review changes" primary, "Save here" and "Discard edits" secondaries (`menu-tab.tsx:291-313`). Description above: "Publishing replaces the whole food menu on Google, every menu, not only what you changed. 1 menu, 1 section, 1 item." (`:276-287`).
10. **Validation:** on Save here or Review, `validateMenu` runs; the summary "N problems to fix before saving or publishing" takes focus and links open the menu/section/sheet holding the field (`menu-tab.tsx:221-251`, `:323-333`). Problems then follow edits live.
11. **In progress:** Save here shows "Saving…" in the bar; during publish the editor is locked (`menu-tab.tsx:375`).
12. **Error/retry:** a failed save shows a destructive `Alert` (`role="alert"`) with the server's message (`:317-321`); a publish error stays in the review sheet; a stale review disables publish with "The menu changed since this review. Keep editing, then review again." (`:405-411`).
13. **Success (server-confirmed only):** "Saved here" toast after the PUT resolves; publish toast only after the steps complete, with the read-back verifying "live" (`:155-157`, `:184-190`).
14. **Leave guard:** an in-app link or Back while dirty asks "Leave without saving?" / "Your edits to this menu aren’t saved. Leaving throws them away. Google is not affected." (`draft-notices.tsx:86-92`).

## 4. Protected rules for this flow

- Save is owner/admin only, checked by the server (`route.ts:34-37`); the UI hides edit controls when `editReason` is set (`gating.ts:176-180`).
- A save invalidates any parked publish for the old menus (`route.ts:52-58`).
- Publish needs MFA step-up and goes through `submitListingChange("food_menus_publish")`, which parks for a second publisher in two-person mode (`route.ts:62-81`).
- Publishing is a full replacement: the reviewed snapshot, revision and Google hash are frozen at review time (`menu-tab.tsx:244-249`); the save step re-reads and refuses if the saved menu differs (`:137-148`); publish sends expected revision + both hashes with an idempotent intent id (`:161-168`).
- Only a confirmed read-back may say "live" (`verified: true`, `:157`; toast words `:186-189`).
- The editor is locked while publishing (`:373-375`); draft-only keys never leave the browser (`menu-editor.tsx:56-69`, `:169-183`).
- Imported currency, options and unknown attributes are never rewritten (`menu-editor.tsx:101-113`, `:367-368`).

None of the proposals below touch any of these.

## 5. Prior audit status

| ID                                       | Status                                             | Evidence on this head                                                              |
| ---------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| LST-01 (P0) raw JSON at consent          | fixed                                              | `menu-diff.ts` `describeNode` / `formatMenuPrice`; results.md row LST-01           |
| LST-03 (P1) menu picker 20px sliver      | fixed                                              | `menu-editor.tsx:846` `basis-full … sm:min-w-56`                                   |
| LST-04 (P1) 3-button / idle bar          | fixed                                              | `editor-footer.tsx` returns nothing when clean; menu passes `canDiscard`, `onSave` |
| LST-14 (P1) client fetch after hydration | fixed                                              | `menu/page.tsx:27-33` uses `StreamedTab`                                           |
| LST-20 (P2) five tool rows / plural      | fixed                                              | `menu-editor.tsx:74-75`, `:519-522`, `:1092-1093` (`countNoun`)                    |
| LST-27 (P2) greyed read view             | fixed                                              | `menu-tab.tsx:289-290` `readView`                                                  |
| #258 responsive pass                     | no menu files touched (`git show 7a70387b --stat`) | n/a                                                                                |

No LST/DSK finding for the menu flow is still open. The friction below is new.

## 6. Friction

| #   | Problem                                                                                                                                                                                                                                                                                                                                                                                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                       | Sev | Heuristic / WCAG                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------- |
| 1   | Removing the draft's last section (or its only menu) swaps the whole editor for the "No food menu yet" empty state. The "Undo removal" banner that the dialog just promised goes with it, and the empty state's copy is wrong while dirty ("NabaPresence has no menu for {venue}…", although the saved copy has one). With the default "Start a menu" shape (one menu, one section), one removal reproduces it. | `menu-tab.tsx:233` `noMenu = draftCounts.sections === 0` (ignores `isDirty`); `:335-366` switches `MenuEditor` out; undo state lives inside `MenuEditor` (`menu-editor.tsx:405`, `:825-842`); dialog copy "You can undo the last removal" (`:1316-1318`); `menu-editor.tsx:799-817` early return also drops the undo banner and the dialog when `menus.length === 0`; fixture `tests/components/menu-tab.test.tsx:30-46` is exactly this shape | P1  | Nielsen 3 user control, 5 error prevention, 1 status; HIG preserved context |
| 2   | "Preview" is disabled with no visible reason whenever any name is blank. A fresh "Start a menu" has a blank section and item, so Preview starts disabled. The only explanation is shown when `view === "preview"`, which can't happen while it's disabled.                                                                                                                                                      | `menu-editor.tsx:738-740`, `:894` `disabled={previewBlocked}`, `:917-919` (`previewBlocked && view === "preview"`); `menu-tab.tsx:253-266` creates blank names; problems hidden until a review attempt (`menu-tab.tsx:106-109`)                                                                                                                                                                                                                | P2  | Nielsen 1, 9; WCAG 3.3.2                                                    |
| 3   | The remove dialog counts only items. A menu removal says nothing about its sections, and an empty section or menu reads "0 items will be removed from this draft."                                                                                                                                                                                                                                              | `menu-editor.tsx:347-354` (`removalItemCount`), `:1316-1318`                                                                                                                                                                                                                                                                                                                                                                                   | P2  | Nielsen 2 plain language, 5                                                 |
| 4   | Section fields' accessible names don't contain their visible labels: visible "Section name" → name "Section 1 name"; "Section description (optional)" → "Section 1 description". Speech-input users saying "Section name" may miss. The item sheet already uses the right pattern ("Item name — section 1, item 2").                                                                                            | `section-editor.tsx:112`, `:121`, `:140-148`; compare `item-editor.tsx:346`, `:362`                                                                                                                                                                                                                                                                                                                                                            | P2  | WCAG 2.5.3 Label in Name                                                    |
| 5   | The "every menu" message is said twice for a one-menu draft: the frame description ("…every menu, not only what you changed") and the toolbar caption ("1 menu in this draft. Saving, review and publishing include every menu, not only the one selected."), where "the one selected" means nothing with one menu.                                                                                             | `menu-tab.tsx:278-279`; `menu-editor.tsx:910-913`                                                                                                                                                                                                                                                                                                                                                                                              | P3  | Nielsen 8 minimalist                                                        |
| 6   | A member/viewer on an empty menu reads "Start one here; nothing reaches Google until you publish." / "Start from Google’s menu, or start a new one here." while the actions are hidden from them (the gate reason is shown above).                                                                                                                                                                              | `menu-tab.tsx:341-347`                                                                                                                                                                                                                                                                                                                                                                                                                         | P3  | Nielsen 4 consistency, 2                                                    |
| 7   | **Hypothesis:** dietary, allergen and other Google item attributes are kept but never shown in the row or sheet (only options are mentioned), so an operator can't tell that an item carries them, or that Duplicate copies them.                                                                                                                                                                               | `item-editor.tsx:225-230`, `:405-410` mention options only; `menu-diff.ts:228` knows `dietaryRestriction`                                                                                                                                                                                                                                                                                                                                      | P3  | Nielsen 1                                                                   |

## 7. Proposed changes

### C1 · Keep the editor and its undo on screen while the draft is being emptied (#1), P1

- **`components/locations/menu-tab.tsx`:**
  - `:233` → `const noMenu = draftCounts.sections === 0 && !isDirty`. The empty state now shows only for a clean draft with no sections. A dirty draft with no sections stays in `MenuEditor`, where its own empty states ("Start with a section", "Build your first menu") already exist.
  - `:276` and `:292`: `noMenu && !isDirty ? undefined : …` → `noMenu ? undefined : …` (same behaviour, simpler).
  - In the description (`:277-286`), after the counts sentence, add: `{draftCounts.sections === 0 && googleHasMenu ? " This draft has no sections, so publishing it would leave Google with no food menu." : null}`. This states the consequence before review; it claims nothing about the result.
- **`components/locations/menu-editor.tsx`:** remove the early return at `:799-817`. Inside the main `<div data-slot="menu-editor">`, keep the live region (`:821-823`), the undo `Alert` (`:825-842`) and the remove `AlertDialog` (`:1298-1333`) always mounted, and wrap the toolbar → sheet block (`:844-1296`) in `menus.length === 0 ? <Empty …"Build your first menu"… /> : <>…</>`. Copy is unchanged. The `AlertDialog`'s `finalFocus` then lands on "Undo removal" after removing the only menu, instead of falling to `<body>`. The guard is needed because `keyOf(menu)` (`:854`) throws on the `{}` fallback menu.
- **Benefit:** the dialog's "You can undo the last removal" stays true; no context jump; no false "NabaPresence has no menu".
- **Risk:** none to protected behaviour. Save, review, publish and the footer conditions are unchanged (the footer was already shown when dirty). Discard still returns to the clean empty state.
- **Tests:** `menu-tab.test.tsx`: new "keeps the editor and Undo after removing the last section". Use `makeMenus()`, ⋯ "Actions for section Starters" → "Remove section" → confirm. Expect no heading "No food menu yet", a visible "Start with a section", and "Undo removal"; click it and expect the "Starters" heading back. `menu-editor.test.tsx`: new "removing the only menu offers Create menu and Undo". Use a one-menu Harness, remove it, expect "Build your first menu" and that `getByRole("button",{name:"Undo removal"})` has focus.

### C2 · Say why Preview is off, and say "every menu" only when there are several (#2, #5), P2

- **`components/locations/menu-editor.tsx:910-920`**: give the caption `id="menu-toolbar-note"` and build it from parts. Render the `<p>` only if it has text:
  - `menus.length > 1`: keep "{n} menus in this draft. Saving, review and publishing include every menu, not only the one selected."
  - `menus.length >= MAX_MENUS`: keep " Google allows at most 100 menus."
  - `previewBlocked` (drop the `view === "preview"` condition): before " Fix the names and prices that need attention to preview." → after " Preview opens once every menu, section and item has a name and each price reads as an amount, like 12.50."
- `:894`: `<SegmentedControlItem value="preview" disabled={previewBlocked} aria-describedby={previewBlocked ? "menu-toolbar-note" : undefined}>` (the item spreads `...props`, `components/ui/segmented-control.tsx:528-535`).
- **Benefit:** a disabled control always has its reason next to it; one fewer repeated sentence for the common one-menu case.
- **Risk:** copy only.
- **Tests:** `menu-editor.test.tsx`: a menu with a blank item name shows the "Preview opens once…" text, and the Preview tab is described by it. A one-menu draft has no "include every menu" text. Check that `tests/components/menu-*.test.tsx` doesn't assert the old caption (no current matches for "menus in this draft").

### C3 · Removal dialog says what goes (#3), P2

- **`components/locations/menu-editor.tsx`:** replace `removalItemCount` (`:347-354`) and `pendingCount` (`:767`) with `removalSummary(removal: Removal): string` built with `countNoun` (already imported, `:24`):
  - item: "This removes the item from this draft."
  - section, items > 0: "This removes the section and its {countNoun(n,"item")} from this draft."; section, 0 items: "This removes the empty section from this draft."
  - menu: "This removes the menu, its {countNoun(s,"section")} and {countNoun(i,"item")} from this draft."
- Dialog body `:1316-1318`: `{removalSummary(pending)} You can undo the last removal, and Google keeps its menu until you review and publish.` The title "Remove {name}?" and the buttons are unchanged.
- **Risk:** copy only.
- **Tests:** update `menu-editor.test.tsx:413-415` "2 items will be removed" → "its 2 items". Add an assertion that a menu removal names sections ("1 section and 2 items").

### C4 · Section field names contain their labels (#4), P2

- **`components/locations/menu/section-editor.tsx`:** `:121` `aria-label={\`Section ${sectionIndex + 1} name\`}` → ``aria-label={`Section name — section ${sectionIndex + 1}`}``. `:148` `Section ${n} description`→`Section description — section ${n}`. This matches the item sheet pattern (`item-editor.tsx:346`, `:362`).
- **Risk:** none (accessible name only).
- **Tests:** update `tests/components/menu-tab.test.tsx:428` and `tests/components/menu-editor.test.tsx:494` to `{ name: "Section name — section 1" }`. No e2e uses these names.

### C5 · The empty state doesn't invite a viewer to act (#6), P3

- **`components/locations/menu-tab.tsx:341-345`:** when `disabled`, drop the instruction sentence:
  - Google has a menu: "NabaPresence has no menu for {name}. Google has one with {n} items."
  - Neither has one: "Neither NabaPresence nor Google has a food menu for {name}."
  - The edit copy is unchanged. The gate reason ("Only owners and admins can edit this location.") is already shown by `EditorFrame` (`gateReason`, `components/editors/editor-frame.tsx:161-165`).
- **Risk:** copy only.
- **Test:** `menu-tab.test.tsx`: with `canEditCanonical: false` and empty menus, the description has no "Start one here".

### Follow-ups (out of scope)

- **#7:** show which Google attributes an item carries (dietary restrictions, allergens, spiciness) as a read-only line in the row/sheet. This needs a product decision on whether to make them editable and a vocabulary map shared with `menu-diff.ts:221-236` (`lib/*`, shared). Verify against real Google data first.
- No e2e edits a menu end to end. A Playwright journey (start a menu → save here → review) would cover C1–C3. It isn't proposed here because e2e suites aren't run in this pass.

## 8. Screenshots to capture

| Route                                   | Role   | Interaction                  | Shows                                                                             |
| --------------------------------------- | ------ | ---------------------------- | --------------------------------------------------------------------------------- |
| `/listings/{loc-with-menu}/menu`        | owner  | none                         | toolbar caption before/after C2 (one-menu draft: repeated "every menu" line gone) |
| `/listings/{loc-without-menu}/menu`     | viewer | none                         | C5 empty-state copy for a read-only role                                          |
| `/listings/{loc-without-menu}/menu`     | owner  | click "Start a menu"         | C2: Preview disabled with its reason visible                                      |
| `/listings/{loc-with-one-section}/menu` | owner  | ⋯ → Remove section → confirm | C1: editor + "Undo removal" stay, instead of "No food menu yet"                   |

## 9. Files touched

components/locations/menu-tab.tsx
components/locations/menu-editor.tsx
components/locations/menu/section-editor.tsx
tests/components/menu-tab.test.tsx
tests/components/menu-editor.test.tsx

No SHARED files: `components/editors/*`, `components/ui/*` and `lib/locations/menu-diff.ts` are read, not changed.
