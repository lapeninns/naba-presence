# p3-F08: Hours status, special/holiday hours and service ("more") hours

Code read at `/tmp/naba-presence-p3` (branch `ux/flows-presence-p3`, head `e4123d25`). Read only. This flow does not cover weekly day-row editing.

## 1. Flow

- **ID / name:** p3-F08. Understand the hours status, then manage special (holiday) hours and service hours.
- **Goal:** The operator can tell where the hours stand against Google (in sync, saved here but not on Google, changed on Google, conflict, or no hours on Google). They can add, edit and remove special days and service schedules, then save here or review and publish.
- **Start:** `/listings/[id]/hours`. `app/(dashboard)/listings/[id]/hours/page.tsx:20-35` streams `AreaEditor area="hours"`, which loads `HoursTab` (`components/listings/area-frame.tsx:912-913`).
- **End:** One of these:
  - a server-confirmed "Save here" (toast `saved_locally`, `hours-tab.tsx:358-377`);
  - a verified publish ("Opening hours live on Google" or "…sent to Google", `hours-tab.tsx:348-354`), or a publish parked for a second approver;
  - the header pill returning to "In sync".
- **Roles:**
  - Owner and admin can edit and save (`app/api/locations/[id]/hours/route.ts:36` `roles: ["owner","admin"]`; client `lib/locations/gating.ts:39-42`).
  - Publishing needs `canPublish` and an MFA step-up (`route.ts:59`), and goes through two-person approval when it is on (`route.ts:63-70`).
  - Member and viewer get a read-only view (`readView`, `hours-tab.tsx:454`; `CapabilityBanner` `:476-483`).

## 2. Code map

| Piece                                                                 | Where                                                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tab shell, status map, notes, zone line, footer, review sheet         | `components/locations/hours-tab.tsx:76-81, 114-120, 128-172, 421-429, 431-448, 456-473, 530-542, 551-561, 574-603`                               |
| Notes list (conflict, no hours on Google, reconcile, server warnings) | `lib/editors/hours-notes.ts:46-93` (only caller: `hours-tab.tsx:429`)                                                                            |
| Special hours group, rows, sheet                                      | `components/locations/hours-editor.tsx:738-825` (group), `:827-879` (sheet host), `:1161-1195` (helpers), `:1202-1351` (`SpecialDaySheet`)       |
| Service hours group                                                   | `hours-editor.tsx:578-736` (nested `HoursEditor weeklyOnly`, add sheet `:683-700`, remove dialog `:701-734`)                                     |
| "Closes on" select (weekly/service day sheet)                         | `hours-editor.tsx:121-168`, options `lib/editors/hours-presentation.ts:196-209`                                                                  |
| Validation and labels                                                 | `lib/editors/hours-presentation.ts:212-400` (`validateHours`; special label `:352`, service label `:247`); only caller `hours-tab.tsx:218`       |
| Conflict marking, part selection                                      | `hours-presentation.ts:476-516`; `ReviewChangesSheet` overwrite ack `components/editors/review-changes-sheet.tsx:205-226`                        |
| Header pill, footer words (SHARED)                                    | `components/editors/editor-status.tsx:131-156`, `components/editors/editor-footer.tsx:21-30, 172-183`                                            |
| Meta line (model note + freshness) (SHARED)                           | `components/listings/area-frame.tsx:317-345`                                                                                                     |
| Server read/status/publish guard (read only)                          | `lib/server/hours.ts:428-475` (`hoursState`), `:294-310` + `lib/domain/hours-vocabulary.ts:239-265` (drift), `:636-655` (overwrite confirmation) |
| Queries                                                               | `lib/queries/use-location-hours.ts` (`useHours`, `useRefreshHours`), `lib/api/location-hours.ts`                                                 |

**Tests**

- e2e:
  - `tests/e2e/listings.spec.ts:955` "the hours rows keep the day name and times beside the switch" (weekly rows)
  - `:1013` "the hours tab loads with the device clock … ahead"
  - `tests/e2e/touch-critical.spec.ts:1220` "hours copy sheet"
  - No e2e test covers special days, service hours, google_dirty or conflict, or the zone line. `operations-features.spec.ts:560` is bulk special hours (p4).
- Component and unit:
  - `tests/components/hours-tab.test.tsx`: zone `:164,:183`; notes `:116`; special-day reveal `:395`; overwrite ack `:710`
  - `tests/components/hours-editor.test.tsx`: special `:57-260`; services `:262-420`; radio pair `:511`
  - `tests/hours-notes.test.ts`

## 3. Steps today

1. **Initial.** The streamed tab loads behind "opening hours". The page then shows, in order:
   - the `CapabilityBanner` (gated roles only);
   - one `HoursNotice` (`hours-tab.tsx:485-502`);
   - draft notices;
   - the form error;
   - the validation summary;
   - the zone paragraph "Times are in **New Zealand time**." (only when the zone differs from the viewer's, `:422-428, :530-542`);
   - the editor groups: Regular hours → Service hours → Special hours (`hours-editor.tsx:498, 579, 739`).

   The header pill comes from `editorStatusPill`.

2. **Status by state.** In every state the footer bar is hidden while clean, unless the state is conflict (`editor-footer.tsx:172`).

   | State              | Header pill                                                   | Footer                                                                                | Notes and other copy                                                                                                                                                  |
   | ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `in_sync`          | "In sync"                                                     | Hidden                                                                                | —                                                                                                                                                                     |
   | No hours on Google | "No hours on Google" (attention, `editor-status.tsx:151-152`) | Hidden                                                                                | Note "No hours on Google. Google shows no hours yet, so customers see “Hours not available”. Switch on your open days." (`hours-notes.ts:60-68`)                      |
   | `core_dirty`       | "Saved here, not on Google"                                   | "N changes not on Google · saved here" + Review changes                               | —                                                                                                                                                                     |
   | `google_dirty`     | "Changed on Google" (`editor-status.tsx:139-140`)             | "2 changes not on Google · saved here" + Review changes (`editor-footer.tsx:177-187`) | No note. The only action offered is Review → publish, and every row is marked "conflict" (`hours-presentation.ts:480-490`).                                           |
   | `conflict`         | "Conflict with Google"                                        | "Conflict with Google" + Review changes                                               | Note "Google holds a different schedule. The saved schedule and Google differ. Review both versions before deciding which hours to publish." (`hours-notes.ts:51-59`) |

3. **Special day: add.**
   - "Add a special day" (`hours-editor.tsx:807-823`) adds a closed, undated entry and opens its bottom sheet: title "New special day", description "These hours override the regular week on this date." (`:1231-1240`).
   - Inputs: a date input; a Closed / Custom hours radio pair; for custom hours, opens, closes and a second date input (the closing date).
   - None of the inputs has a visible label, only `aria-label`s such as "Special date 1 closing date" (`:1243-1326`).
   - Done closes the sheet (edits are already in the draft). Remove deletes the day with no confirmation, which is fine for a draft.
4. **Special day: row.** Each row shows the formatted date, its hours ("12:00 – 16:00, closing Fri 26 Dec 2026"), and "Changed" / "Past" words. A hint reads "Already passed, so customers no longer see it." (`:751-806, :1192-1195`).
5. **Service hours.**
   - "Add service schedule" opens a sheet of the types Google supports (`:665-700`). Each schedule is a nested weekly editor with its own "Closes on" select per period.
   - Under each schedule is the raw type id, e.g. `KITCHEN` (`:642-648`).
   - Removal asks for confirmation: "Remove … from this draft. Review and publish to remove it from Google." (`:701-734`).
   - Empty state: "No service schedules are saved." (`:584-588`).
6. **Validation.** Problems show after the first save or review (`hours-tab.tsx:212-224`). The summary lists "Special date 1: Opening and closing times are the same" and "KITCHEN · Monday: …". A link opens the sheet first (`reveal`, `hours-editor.tsx:439-467`).
7. **In progress.** "Saving…" on Save here; "Checking Google…" on reconcile (`hours-tab.tsx:496-498`); publish steps in the review sheet.
8. **Error and retry.**
   - Save errors show as a destructive `Alert` (`:506-510`).
   - A failed reconcile shows "Google’s current closing boundaries could not be loaded. Your draft is unchanged. Try again." (`:442-444`).
   - A stale review shows `hours_review_stale` (`:288-292`).
   - A failed freshness check shows "Google couldn’t be checked just now. Try again." (`google-freshness.tsx:103`).
9. **Success.** Only after the server confirms: a `saved_locally` toast, or the verified publish toast (`:348-354`). The queries are invalidated and the pill follows.

## 4. Protected rules for this flow

- Saving is for owner and admin only, and is checked on the server (`route.ts:36`). A save invalidates pending `hours_publish` approvals (`route.ts:48-52`).
- Publishing needs an MFA step-up, goes through two-person approval when it is on (`route.ts:59-70`), and is verified by reading Google back (`hours-tab.tsx:303`).
- Overwriting a Google change needs `confirmOverwriteGoogleChanges`. Otherwise the server returns 409 `google_hours_overwrite_confirmation_required` (`lib/server/hours.ts:643-655`). The UI requires the "I’ve read what Google has now and want to replace it." tick (`review-changes-sheet.tsx:205-226`).
- Publishing is blocked while `publicationBlocked` or `reconciliationRequired` is set (`hours-tab.tsx:407-412`).
- Parts the operator unticks stay saved here only (`leftOutNote`, `:108-112`). The publish sends nothing when the update mask is empty (`:308`).
- Nothing says "published" or "saved" before the server confirms. The success toast fires from `usePublishFlow` / `useResourceMutation` only.

## 5. Prior audit status (15 Oct audit)

| ID                                                          | Status              | Evidence on this head                                                                                                                                                                           |
| ----------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LST-18 (no hours reads "In sync")                           | **Fixed**           | `emptyOnGoogle` at `hours-tab.tsx:461`, the pill at `editor-status.tsx:151`, the note at `hours-notes.ts:60-68`, the service note moved to the group at `:36-44` and `hours-editor.tsx:581-583` |
| LST-19 (raw IANA zone)                                      | **Fixed for Hours** | `formatTimeZoneLabel` at `hours-tab.tsx:425`. The Posts remainder belongs to p4.                                                                                                                |
| LST-06 remainder / follow-up 26 (zone outside the meta row) | **Open**            | The zone is still its own paragraph (`hours-tab.tsx:530-542`). `AreaMetaLine` (`area-frame.tsx:317-345`) has only the model note and freshness.                                                 |
| LST-16, LST-17, LST-29                                      | **Fixed**           | ListRow per day; 24-hour times (`hours-diff.ts` uses `formatTimeOfDay`); "Copy to…" name at `hours-editor.tsx:1146`                                                                             |
| LST-27 (member view)                                        | **Fixed**           | `readView`, `readOnlyReason` at `hours-tab.tsx:454, 472`                                                                                                                                        |
| LST-13 (publish failure ×3)                                 | **Fixed**           | Through `ReviewChangesSheet` / `usePublishFlow`                                                                                                                                                 |

## 6. Friction

| #   | Problem                                                                                                                                                                                                                                                               | Evidence                                                                                                                                                                     | Sev | Heuristic / WCAG                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------- |
| 1   | **Changed on Google gives no explanation and no way to keep Google's version.** The pill says "Changed on Google", but the footer says "2 changes not on Google" (wrong direction), and the only action is Review → overwrite. The notes have no `google_dirty` case. | `editor-status.tsx:139-140` against `editor-footer.tsx:181-182` (`countWords`), `hours-tab.tsx:460`; `hours-notes.ts:51-59` (conflict only); `hours-presentation.ts:480-490` | P1  | Nielsen 1 (status), 3 (user control), 5 (error prevention) |
| 2   | **Local edits that already match Google still say "Changes not on Google".** The bar also offers "Review changes", which leads to an empty publish. Profile passes `rows.length > 0` instead.                                                                         | `hours-tab.tsx:458` `isDirty={isDirty \|\| rows.length > 0}` against `profile-editor.tsx:991,1006`; the footer contract at `editor-footer.tsx:55-58`                         | P2  | Nielsen 1, 4 (consistency)                                 |
| 3   | **"No hours on Google" tells the operator to switch on days they have already switched on.** It shows whenever Google is empty, even when the draft or saved schedule already has hours waiting to publish.                                                           | `hours-notes.ts:60-68` ("Switch on your open days.") ignores the draft; `hours-tab.tsx:421`                                                                                  | P2  | Nielsen 2 (match), 9 (recovery)                            |
| 4   | **The zone takes its own row, with an icon, before the schedule** (follow-up 26). It is detached from the times it qualifies.                                                                                                                                         | `hours-tab.tsx:530-542`                                                                                                                                                      | P2  | HIG hierarchy; Nielsen 8                                   |
| 5   | **Special-day inputs have no visible labels.** The two date inputs look identical, and the second (the closing date) sits after the times with nothing to say what it is.                                                                                             | `hours-editor.tsx:1243-1261, 1291-1326` (only `aria-label`)                                                                                                                  | P2  | WCAG 3.3.2 Labels or Instructions; Nielsen 6               |
| 6   | **Validation names special days by array index, not date.** Rows are sorted by date, so "Special date 1" can be the third row.                                                                                                                                        | `hours-presentation.ts:352` against `hours-editor.tsx:92-101, 778-782`                                                                                                       | P3  | Nielsen 2, 6                                               |
| 7   | **Service schedules show raw Google ids.** A caption reads `KITCHEN` under "Kitchen", and validation reads "KITCHEN · Monday".                                                                                                                                        | `hours-editor.tsx:643-644`; `hours-presentation.ts:247`                                                                                                                      | P2  | Nielsen 2 (plain language)                                 |
| 8   | **The Service hours group has no caption, and its empty state does not say why nothing can be added** when Google offers no service types.                                                                                                                            | `hours-editor.tsx:579, 584-588, 665`                                                                                                                                         | P3  | Nielsen 1, 10                                              |
| 9   | **Hypothesis:** Special hours (holidays: the frequent task) sit below Service hours, so a phone scrolls past the nested service week(s) to reach them.                                                                                                                | Order `hours-editor.tsx:498 → 579 → 739`                                                                                                                                     | P3  | HIG hierarchy                                              |

## 7. Proposed changes

### C1. A "Changed on Google" note, with a way to keep Google's hours (fixes #1, #2)

**Notes** (`lib/editors/hours-notes.ts`)

- Widen the `HoursNote.action` type to `"reconcile" | "keep-google"`.
- Add the following after the conflict block:
  ```ts
  if (!gated && hours.status === "google_dirty")
    notes.push({
      key: "google-changed",
      tone: "warning",
      title: "Hours changed on Google",
      description: googleEmpty
        ? "Someone removed these hours on Google since they were last published from here. Review and publish to put the saved schedule back."
        : "Someone changed these hours on Google since they were last published from here. Keep Google’s hours and save them here, or review and publish to put the saved schedule back.",
      ...(googleEmpty ? {} : { action: "keep-google" as const }),
    })
  ```
- Suppress the "No hours on Google" note when `status === "google_dirty"`. The new note already covers that case.

**Tab** (`components/locations/hours-tab.tsx`)

- `HoursNotice`: replace the `reconcile: ReactNode` prop with `actions: Partial<Record<NonNullable<HoursNote["action"]>, ReactNode>>`. Render `actions[note.action]` in both the single-note and list branches (`:142-144, :163-165`).
- Add `keepGoogle()`, modelled on `reconcile()` (`:431-448`):
  - read `fetchHours(locationId, undefined, { refresh: true })`, then `setDraft(structuredClone(fresh.google))`;
  - while it runs, the button reads "Checking Google…";
  - on failure, show `formError` "Google’s current hours could not be loaded. Your draft is unchanged. Try again.";
  - the button is "Keep Google’s hours" (`variant="secondary" size="sm"`), and is not rendered when `disabled`, the same as reconcile.
- Nothing is saved until the operator taps the existing **Save here**.

**Footer** (same file, `:458-460`)

- Change to:
  - `isDirty={rows.length > 0}`
  - `changeCount={!isDirty && hours.status === "google_dirty" ? undefined : rows.length}`
- Effect: a clean google_dirty state reads "Changed on Google · saved here". After "Keep Google’s hours", the bar reads "No changes to publish · unsaved edits" with **Save here** as the primary (the existing contract at `editor-footer.tsx:55-58`).

**Assessment**

- **Benefit:** Status is honest, and the operator gets a non-destructive way out instead of an overwrite-only path.
- **Principles:** Nielsen 1, 3, 5; HIG "preserved context".
- **Risk:** None to the protected paths.
  - The draft is local state. The save uses the same PUT, server role check and revision guard.
  - Saving still invalidates pending hours approvals, which is existing behaviour, and the operator saves explicitly.
  - Publish and overwrite confirmation are unchanged.
  - The server decides `in_sync` (`hours-vocabulary.ts:246`). The UI only claims it once the refetched state says so.
  - Like `reconcile`, it reads Google fresh rather than from the possibly stale `hours.google`.
- **Tests:**
  - `tests/hours-notes.test.ts`:
    - "explains a Google-side change and offers to keep it" (status `google_dirty`);
    - "offers no keep action when Google removed every hour" (`googleEmpty: true`);
    - "shows no No-hours note while Google-changed".
  - `tests/components/hours-tab.test.tsx`: "keeps Google’s hours into the draft and saves only on Save here". Mock `fetchHours` with `refresh` returning a google schedule; assert the draft rows, that `saveHours` is not called until Save here, and the footer text "No changes to publish".
  - Adjust any assertion that expects "Review changes" when the draft equals Google. None was found in `hours-tab.test.tsx`; re-run it.

### C2. "No hours on Google" follows the draft (fixes #3)

- In `hours-notes.ts`, add `draftEmpty: boolean` to the options. `hours-tab.tsx:429` passes `draftEmpty: isEmptySchedule(draft)` (reusing `:114-120`).
- When `googleEmpty && !draftEmpty`, the description becomes: "Google shows no hours yet, so customers see “Hours not available”. Review and publish these hours to put them on Google."
- The title is unchanged ("No hours on Google"), so the pill and the LST-18 wording stay.
- **Files:** `lib/editors/hours-notes.ts`, `components/locations/hours-tab.tsx`.
- **Risk:** Copy only.
- **Test:** `hours-notes.test.ts`: "tells an operator with hours waiting to publish them, not to switch days on". The existing `:16` case passes `draftEmpty: true`.

### C3. The time zone becomes the Regular hours caption (closes #4 / follow-up 26 by decision)

- Delete the `<p>` with the `Globe` icon (`hours-tab.tsx:530-542`), and the `Globe` import if it is then unused.
- Pass `zoneLabel` to `HoursEditor` as a new optional prop: `timeZoneLabel?: string | null`.
- In `HoursEditor` (`hours-editor.tsx:498-518`), the top-level (non-service) Regular hours group gets `caption={timeZoneLabel && !serviceId ? <>Times are in <strong className="font-semibold text-ink">{timeZoneLabel}</strong>.</> : undefined}`.
- `SettingsGroup` already wires `caption` to `aria-describedby` (`settings-row.tsx:138-146,175-181`). No shared edit is needed.
- `HoursEditor` has one external caller (`hours-tab.tsx:551`). The nested service editors don't pass the prop.
- **Benefit:** One fewer full-width row at every width, and the zone sits on the times it qualifies.
- **Why not the meta line:** The follow-up asked for the meta line. That needs a new context slot in SHARED `area-frame.tsx`/`google-freshness.tsx`, which other areas edit. **Integrator: record follow-up 26 as closed by this alternative**, or keep the shared slot as a follow-up.
- **Risk:** None.
- **Tests:** `hours-tab.test.tsx:164-197` keeps passing (`getByText(/Times are in/)` then `toHaveTextContent("Times are in New Zealand time.")`). Add an assertion that the caption is inside the "Regular hours" group: `within(getByRole("group"|region named "Regular hours"))`.

### C4. Visible labels in the special-day sheet, and dates in validation (fixes #5, #6)

**Sheet** (`hours-editor.tsx:1242-1328`)

- Wrap each control in a small stacked label (`<label htmlFor>` with `text-caption text-ink-muted`, using the `Field`/`Label` from `components/ui` that the tab already uses elsewhere):
  - "Date" for the date input;
  - "Opens" and "Closes" for the times;
  - "Closing date" for the end date, with the hint "Change only if you close after midnight."
- Keep the current `aria-label`s. Each contains its visible text ("Special date 1" ⊃ "date", "… opens", "… closes", "… closing date"), so WCAG 2.5.3 holds, and the tests that query `getByLabelText("Special date 1 opens")` and similar (`hours-editor.test.tsx:91,253,378,536`; `hours-tab.test.tsx:429`) keep working.
- The segmented pair keeps its `aria-label`.

**Validation labels** (`hours-presentation.ts:352` and the schema branch `:235`)

- Change to: `label = entry.effectiveDate ? \`Special hours, ${formatSpecialDate(entry.effectiveDate)}\` : "New special day"`. `formatSpecialDate`is already in this file at`:171`.

**Assessment**

- **Files:** `components/locations/hours-editor.tsx`, `lib/editors/hours-presentation.ts`. `validateHours` has one caller, `hours-tab.tsx:218`. `review-publish-reads.ts` imports other symbols only.
- **Risk:** None. Field ids, `reveal` and focus are unchanged.
- **Tests:**
  - Update `hours-tab.test.tsx:422` from `/Special date 1: Opening and closing/` to `/Special hours, .*: Opening and closing/`.
  - Add to `hours-editor.test.tsx`: "labels the special-day fields in words" (`getByText("Closing date")`).
  - Check `tests/hours-presentation.test.ts` for `"Special date"` labels.

### C5. Plain service names and an explained Service hours group (fixes #7, #8; #9 optional)

**Raw ids** (`hours-editor.tsx:642-648`)

- Show the caption only when `!metadata`: `"{entry.hoursTypeId} · Google has not confirmed this service type…"`. The id stays there because no display name exists.

**Validation label**

- Add an optional `names?: ReadonlyMap<string,string>` or the supported-types array as a second argument to `validateHours`.
- The label becomes `${names.get(id) ?? id} · ${DAY_LABELS[day]}`.
- `hours-tab.tsx:218` passes `hours.supportedHoursTypes`.

**Group caption**

- `caption="Separate hours for services such as a kitchen, delivery or takeaway."`

**Empty states**

- When `supportedHoursTypes.length === 0 && !serviceNote`: "Google doesn’t offer service hours for this business’s category."
- Otherwise keep "No service schedules yet."

**Optional (#9, Hypothesis)**

- Render the Special hours group before Service hours.
- Before moving, check the focus-order expectations in `hours-editor.test.tsx:544-604`.

**Assessment**

- **Files:** `components/locations/hours-editor.tsx`, `lib/editors/hours-presentation.ts`, `components/locations/hours-tab.tsx`.
- **Risk:** None. Unconfirmed types stay read-only (`:636`).
- **Tests:**
  - `hours-editor.test.tsx:263`: assert `queryByText("KITCHEN")` is null.
  - `:321`: still finds the `UNKNOWN_SERVICE` caption.
  - New unit test in `hours-presentation.test.ts`: "names a service by Google’s display name in validation".

### Note on the "Closes on" select

`ClosingDaySelect` (`hours-editor.tsx:121-168`) is drawn only in day sheets: weekly rows and service rows. Its trigger has an `aria-label` and the visible value "Same day (Monday)", but no visible "Closes on" label. Leave it to the weekly-editing flow so that two flows don't edit `DaySheet`. If that flow adds a label, use "Closes on" to match the sheet title (`:159`) and C4's wording.

## 8. Screenshots to capture

| Route                               | Role   | Interaction                    | Shows                                                                                                                                                           |
| ----------------------------------- | ------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/listings/{loc}/hours` (390, 1280) | owner  | none                           | "No hours on Google" note (C2 copy when the fixture has saved hours) and zone caption placement (C3; needs a fixture zone ≠ viewer, otherwise there is no zone) |
| `/listings/{loc}/hours` (390)       | viewer | none                           | read-only view and the Service hours caption and empty state (C5)                                                                                               |
| `/listings/{loc}/hours` (390)       | owner  | tap "Add a special day"        | labelled special-day sheet (C4)                                                                                                                                 |
| `/listings/{loc}/hours` (1280)      | owner  | needs a `google_dirty` fixture | "Hours changed on Google" note with "Keep Google’s hours" (C1). If the harness has no such fixture, cover it in the component test only.                        |

## 9. Files touched

```
lib/editors/hours-notes.ts
components/locations/hours-tab.tsx
components/locations/hours-editor.tsx
lib/editors/hours-presentation.ts
tests/hours-notes.test.ts
tests/components/hours-tab.test.tsx
tests/components/hours-editor.test.tsx
tests/hours-presentation.test.ts
```

No SHARED file is changed. `hours-notes.ts` and `validateHours` each have one caller (`hours-tab.tsx`), and `HoursEditor` has one external caller (`hours-tab.tsx`).

## Follow-ups (out of scope)

- Follow-up 26, as literally specified: a zone slot in `AreaMetaLine`. This is SHARED (`area-frame.tsx`, `google-freshness.tsx`) and needs an opt-in context like `GoogleFreshnessSlot`.
- Keeping Google's version for `conflict` (not only `google_dirty`), per part. This needs a product decision because it would replace saved edits.
- Shared footer copy for `google_dirty` with a count ("N changes on Google"). It would need an `editor-footer.tsx` variant used by menu and profile too.
- An e2e journey for special days and the Google-changed state. No stub state for `google_dirty` exists yet.
