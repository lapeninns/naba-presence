# p3-F07 — Edit regular (weekly) opening hours

Code read at `/tmp/naba-presence-p3` (`ux/flows-presence-p3`, head `e4123d25`). Read-only analysis; nothing in the repo was changed.

## 1. Flow

- **ID / name:** p3-F07, edit the regular weekly opening hours.
- **Goal:** set each weekday open or closed, with one or more periods (including overnight and midnight closes), then keep the result by saving it here or sending it to review.
- **Start:** `/listings/[id]/hours`. `app/(dashboard)/listings/[id]/hours/page.tsx:20-35` streams `AreaEditor area="hours"`, which loads `HoursTab` (`components/listings/area-frame.tsx:912-913`). The weekly group is the first `SettingsGroup` in `components/locations/hours-editor.tsx:498-576`.
- **End (server-confirmed):**
  - "Save here" succeeds: `saveHours` returns, then the "Saved here" toast shows (`hours-tab.tsx:358-377`, `lib/editors/outcome.ts:37-41`).
  - Or "Review changes" opens `ReviewChangesSheet` (`hours-tab.tsx:394-405`, `:574-603`). Publishing from that sheet is the review/publish flow's end and is out of scope here.
  - Or "Discard edits" confirms (`hours-tab.tsx:563-572`).
  - Or leaving the page is confirmed (`components/editors/draft-notices.tsx:41-44`, `:86-92`).
- **Roles:**
  - Owner and admin can edit (`lib/locations/gating.ts:39-42` `editDisabledReason`; server `PUT` has `roles: ["owner","admin"]` at `app/api/locations/[id]/hours/route.ts:34-36`).
  - Member and viewer get the read view: the rows and sheet show disabled fields and a view-only bar (`hours-tab.tsx:454,470-473`, `editor-footer.tsx:150-168`).
  - Billing read-only turns editing off for everyone (`gating.ts:40`).

## 2. Code map

| Piece                                                    | Where                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page / stream                                            | `app/(dashboard)/listings/[id]/hours/page.tsx:20-35`, `lib/server/prefetch.ts:767` (`hoursTabPrefetch`), `components/locations/location-tab.tsx:169,230`                                                                                                                         |
| Query / refresh                                          | `lib/queries/use-location-hours.ts:27` `useHours`, `:48` `useRefreshHours`                                                                                                                                                                                                       |
| API client                                               | `lib/api/location-hours.ts:30` fetch, `:42` save (PUT), `:50` publish (POST)                                                                                                                                                                                                     |
| Route / server                                           | `app/api/locations/[id]/hours/route.ts:26` GET, `:34-55` PUT, `:57-71` POST; `lib/server/hours.ts:478` `saveCanonicalHours` (revision check `:501-504` → 409 `canonical_resource_stale`)                                                                                         |
| Tab (form state, validation gate, save, discard, review) | `components/locations/hours-tab.tsx:174-606`                                                                                                                                                                                                                                     |
| Day rows, day sheet, copy sheet                          | `components/locations/hours-editor.tsx`: rows `:519-575`; `toggleDay` `:370-393`; day sheet host `:881-932`; `DaySheet` `:978-1159`; `CopyDaysDialog` `:1365-1496`; copy apply `:940-967`                                                                                        |
| Time entry                                               | `components/ui/time-field.tsx` (24-hour text field, `24:00` allowed, numeric pad, tidy on blur)                                                                                                                                                                                  |
| Validation                                               | `lib/editors/hours-presentation.ts:212-425` `validateHours` (missing times, same times, overnight with no closing day `:311-321`, close before open `:322-331`, overlap `:332-342`); split defaults `:84-154`; contract `lib/locations/forms/hours.ts:14` (= `hoursInputSchema`) |
| Change rows / words                                      | `lib/locations/hours-diff.ts:17-30` `describeDay`/`clockTime` ("midnight (end of day)"), `:67-166` `hoursChangeRows`                                                                                                                                                             |
| Notes (page-level, other flow)                           | `lib/editors/hours-notes.ts:46-93`                                                                                                                                                                                                                                               |
| Shared editors used                                      | `components/editors/editor-frame.tsx`, `editor-footer.tsx:70-306`, `discard-dialog.tsx:27-91`, `draft-notices.tsx:39-95` (+ `lib/editors/use-leave-guard.ts`), `review-changes-sheet.tsx`                                                                                        |

**e2e coverage (`tests/e2e/`):**

- `touch-critical.spec.ts:1220` "listings: the controls inside a sheet take a tap (hours copy sheet)". Covers switching Monday on, "Copy Monday to…", ticking Tuesday, "Copy to 1 day" and "Review changes" in the docked bar.
- `listings.spec.ts:955` "the hours rows keep the day name and times beside the switch at {w}px".
- `listings.spec.ts:1013` "the hours tab loads with the device clock … ahead".
- `routing.spec.ts:441` (breadcrumb on hours).
- Component tests: `tests/components/hours-editor.test.tsx` (overnight closing day `:484`, copy `:588`, `:604`, reopen periods `:180`) and `tests/components/hours-tab.test.tsx` (validation summary `:348`, viewer `:281`, save failure `:549`).
- No e2e test covers split periods, overlap or midnight validation, discard, or the leave guard on hours.

## 3. Steps today

1. **Initial.** The rows read Monday first: `<day name>` over `describeDay` ("09:00 – 17:00", "Closed"). A "Changed" word and tint mark days that differ from Google (`hours-editor.tsx:524-563`), and the open switch sits beside each row (`:564-572`). One "Copy Monday to…" sits in the group header (`:502-512`). The footer is hidden while the draft is clean (`editor-footer.tsx:172`).
2. **Toggle a day.** The row switch sets the day closed and remembers its periods. Switching it back on restores them, or uses 09:00–17:00 with `closeDayOfWeek` = same day (`:370-393`). The row text updates and the footer appears ("1 change not on Google · unsaved edits", `editor-footer.tsx:176-188`).
3. **Open the day sheet.** Tapping the row opens a bottom sheet titled "Monday hours" with the description "Use 24-hour times. Choose the closing day explicitly for overnight hours; 24:00 means midnight at the end of that day." (`:1004-1010`). It holds:
   - a switch named "Monday open in this sheet", next to visible text "Open"/"Closed all day" that is `aria-hidden` (`:1012-1027`);
   - per period: two `TimeField`s (placeholder `HH:MM`, no visible label), a "–", a closing-day `Select` ("Same day (Monday)", "Next day (Tuesday)", …), and an ✕ when there are 2+ periods (`:1030-1115`);
   - "Add split period", shown only while `canSplit` (`:1120-1138`);
   - a footer with "Copy to…" and "Done" (`:1140-1156`).

   Edits go straight into the draft, and Done only closes the sheet.

4. **Input / validation.** Nothing is validated while typing. Errors appear only after the first Save or Review attempt (`hours-tab.tsx:212-224`, `checkDraft` `:380-392`). From then on:
   - the `ValidationSummary` lists them, as in "Monday: The closing time is earlier than opening. Choose the next closing day." (`:512-528`);
   - each link reopens the day's sheet on the field (`reveal`, `hours-editor.tsx:439-467`);
   - the row shows the first problem (`:528-562`).

   Messages: "Enter both an opening and a closing time.", "Opening and closing times are the same.", "Choose the closing day for this overnight period.", "Overlaps 09:00 – 12:00. Split periods can’t overlap.", and "Add opening times, or switch the day to Closed." Midnight is `24:00` (shown as "midnight (end of day)") or `00:00` with Next day.

5. **Copy.** The "Copy Monday to…" header, or "Copy to…" in the sheet (which closes the sheet first, `:923-927`, `:886-891`), opens "Copy Monday’s hours". It offers Weekdays, Weekend, Every day and Clear, then day checkboxes with "Now: …", the note "This replaces the hours on the days you tick. Nothing reaches Google until you publish.", and "Copy to N days" (`:1394-1495`). Swiping away with ticks asks "Stop copying?". Applying closes the sheet with no message (`:940-967`).
6. **In progress.** "Save here" shows "Saving…" on the button and the status line (`editor-footer.tsx:196-203`, `:267-271`).
7. **Error / retry.** A failed save toasts the humanised error and also shows it as a destructive `Alert` (`hours-tab.tsx:375-376`, `:506-510`). The draft is kept, and pressing Save again retries with the same intent (`use-resource-mutation.ts:133-140`). A 409 stale revision comes from the server (`lib/server/hours.ts:501-504`). When a colleague saves, the warning "Someone else saved these hours while you were editing" offers Load theirs / Keep mine (`draft-notices.tsx:58-84`).
8. **Empty.** When Google has no hours, the "No hours on Google" note and pill show (page-level status, another flow).
9. **Success.** The "Saved here" toast reads "NabaPresence’s copy is saved. It isn’t on Google until you publish it." and the queries refresh. "Discard edits" asks "Discard your changes?" ("The schedule goes back to what NabaPresence last saved. Google is not affected.") and then toasts "Changes discarded". An in-app link with unsaved edits asks "Leave without saving?" (`draft-notices.tsx:86-92`).

## 4. Protected rules for this flow

- Only owner and admin can write canonical hours, and the server enforces it (`route.ts:34-36`). The client gate is `gating.ts:39-42`; the read view is `hours-tab.tsx:454`.
- Saves are pinned to `expectedCanonicalRevision`, and the server rejects a stale revision with a 409 (`hours-tab.tsx:360-363`, `lib/server/hours.ts:501-504`). Review-then-publish re-reads after the save and throws `hours_review_stale` if anything moved (`hours-tab.tsx:278-293`).
- "Saved here" shows only after the PUT resolves (`useResourceMutation` success). "Live on Google" shows only for `confirmed_applied` (`hours-tab.tsx:348-354`).
- A save drops pending `hours_publish` approvals (`route.ts:46-50`). Publishing goes through `submitListingChange` (two-person approval, step-up MFA, `route.ts:57-70`).
- Overnight closing days are never guessed (`hours-presentation.ts:190-195`, `hours-editor.tsx:115-120`), and the contract schema is the client validator (`forms/hours.ts:8-14`).
- Copy, toggle, split and discard are local draft edits only. Discard says "Google is not affected."

## 5. Prior audit status

| ID                                               | Status            | Where                                                                                                                                                                |
| ------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LST-16 (long list, repeated closed days)         | Fixed             | One `ListRow` and `Switch` per day, one "Copy Monday to…" (`hours-editor.tsx:498-576`); desk layout fixed in #216                                                    |
| LST-17 (24-h fields, 12-h confirm)               | Fixed             | `hours-diff.ts:27-30` via `formatTimeOfDay`                                                                                                                          |
| LST-29 ("Copy to…" name)                         | Fixed             | `hours-editor.tsx:1146` `aria-label="Copy to… (Monday’s hours)"`                                                                                                     |
| LST-04 (3-button bar, idle desk bar)             | Fixed             | `editor-footer.tsx:172`, `:211-234`                                                                                                                                  |
| LST-27 (greyed member view)                      | Fixed             | `readView` (`hours-tab.tsx:454`)                                                                                                                                     |
| LST-18 (no hours = "In sync"; service note)      | Fixed             | Page-level status (other flow)                                                                                                                                       |
| LST-19 (raw IANA zone)                           | Fixed on hours    | `hours-tab.tsx:424-428`                                                                                                                                              |
| LST-06 (desk meta row)                           | **Partly open**   | The time-zone paragraph still stands alone (`hours-tab.tsx:530-542`). It is page-level and the fix sits in `area-frame.tsx` (SHARED), so it belongs to another flow. |
| MEA-01 (7 switches and "Copy to…" flagged small) | Not a real defect | `sm`/`icon-sm`/`Switch` extend to 44 px (`button.tsx:66-71`)                                                                                                         |

## 6. Friction

| #   | Problem                                                                                                                                                                                                                                                                                                                                                       | Evidence                                                                                                                                                                                      | Sev | Heuristic / WCAG                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------- |
| 1   | Overnight and midnight mistakes surface only after Save or Review. In the sheet, 18:00 → 02:00 can sit beside a closing day reading "Same day (Monday)" with no cue, because `toggleDay` and splits default `closeDayOfWeek` to the same day. The user taps Done, presses Review, gets a summary, follows a link and reopens the sheet.                       | `hours-tab.tsx:212-224` (attempts gate); `hours-editor.tsx:382-385`, `:1081-1086`; `hours-presentation.ts:322-331` ("The closing time is earlier than opening. Choose the next closing day.") | P2  | Nielsen 5 (error prevention), 9; WCAG 3.3.3 |
| 2   | "Copy to N days" replaces up to six days with no status message. Sighted users get tints; screen-reader users hear nothing.                                                                                                                                                                                                                                   | `hours-editor.tsx:940-967` (apply → `setCopyFrom(null)` only)                                                                                                                                 | P2  | Nielsen 1; WCAG 4.1.3                       |
| 3   | Focus returns to the wrong row after "Copy Monday to…". `lastCopyDay` is set by a sheet copy and never cleared, so a later header copy sends focus back to that old day's row, not the header button.                                                                                                                                                         | set `:888`; header `onClick` `:506` doesn't reset it; `returnFocusId` `:937`; `finalFocus` `:1411-1414`                                                                                       | P2  | WCAG 2.4.3                                  |
| 4   | Split periods move focus badly and hide limits. Focus isn't moved to the new period. ✕ removes the focused button, dropping focus. At 3 periods, or when there's no room, "Add split period" vanishes without a reason. On a single 4h+ period the button shortens the existing period (09:00–17:00 → 09:00–12:30, 13:30–17:00), which the label doesn't say. | `hours-editor.tsx:1096-1111`, `:1120-1138`; `hours-presentation.ts:92-103`, `:145-154`                                                                                                        | P3  | WCAG 2.4.3; Nielsen 1, 2                    |
| 5   | The sheet's switch is named "Monday open in this sheet" while its visible text ("Closed all day"/"Open") is `aria-hidden`, so a voice user saying "Closed all day" gets no match. The time fields have only a placeholder and a dash for visible labels.                                                                                                      | `hours-editor.tsx:1012-1027`, `:1039-1073`; `time-field.tsx` placeholder `HH:MM`                                                                                                              | P3  | WCAG 2.5.3, 3.3.2                           |
| 6   | **Hypothesis:** a closing-day select on every period (176 px min) wraps each period to two lines at 320 px. Needs a screenshot.                                                                                                                                                                                                                               | `hours-editor.tsx:155`, `:1074-1095`                                                                                                                                                          | P3  | Nielsen 8                                   |
| 7   | A failed "Save here" is said twice (toast plus an untitled destructive Alert at the top, possibly off-screen). Low impact.                                                                                                                                                                                                                                    | `hours-tab.tsx:375-376`, `:506-510`                                                                                                                                                           | P3  | Nielsen 8                                   |

## 7. Proposed changes

All four changes are in **`components/locations/hours-editor.tsx` (area-local; its only importer is `hours-tab.tsx`)**. No shared file changes. Contracts, the validator and `closeDayOfWeek` semantics stay untouched.

### C1 — Overnight cue with one-tap fix in the day sheet (#1)

- **Where:** `DaySheet`, inside the period map (`:1030-1115`).
- **Detection.** For each period compute:
  `const end = period.closeDayOfWeek ?? dayOfWeek; const overnight = end === dayOfWeek && isValidTime(period.opensAt) && isValidTime(period.closesAt) && period.closesAt !== "24:00" && period.closesAt < period.opensAt; const nextDay = (dayOfWeek + 1) % 7`
  Import `isValidTime` from `@/components/ui/time-field`. It's already exported; this is a read, not a change.
- **Live region.** Always render `<div aria-live="polite" id={`${opensId}-overnight`} className="flex basis-full flex-wrap items-center gap-x-2">`.
- **Hint text.** When `overnight && !message`, show `<p className="text-caption text-ink-secondary">`:
  - closes at `00:00`: "Closing at midnight? Close on the next day, or enter 24:00."
  - any other close before opening: "Open past midnight? Close on the next day."
- **Button.** When `overnight && !disabled`, show `<Button size="sm" variant="ghost" className="text-accent-ink">Close on {DAY_LABELS[nextDay]}</Button>`. On click, set the period's `closeDayOfWeek: nextDay` with the same `onChange` the select uses. Visible text is the name, so no `aria-label`.
- **Wiring.** Add the hint id to the `ClosingDaySelect` `describedBy`, joined with `errorId` when both exist.
- **Benefit.** Catches the most common hours mistake at the point of entry, and fixes it in one tap instead of five steps.
- **Risk:** none. It isn't a guess: the user taps an explicit choice the select already offers. Validation, save and publish don't change.
- **Tests (`hours-editor.test.tsx`):**
  - Friday `{18:00, 02:00, closeDayOfWeek: 5}`: expect "Open past midnight?", click "Close on Saturday", and expect `closeDayOfWeek: 6`.
  - With `00:00`: expect the midnight text.
  - With `17:00`: expect no hint.

### C2 — Say what "Copy to…" did, and fix its focus return (#2, #3)

- **Header action (`:506`).** Change `onClick` to `() => { setLastCopyDay(null); setCopyFrom(WEEK_ORDER[0]) }`.
- **Apply (`:940-967`).** After `onChange(...)`, call `showToast({ kind: "local", title, description })` from `@/components/ui/toast` (as `components/inbox/review-triage.tsx:61` does):
  - title: `` `${scope}${DAY_LABELS[copyFrom]}’s hours copied to ${n} ${n === 1 ? "day" : "days"}` ``
  - description: `` `${new Intl.ListFormat("en-GB", { type: "conjunction" }).format(WEEK_ORDER.filter((d) => targets.includes(d)).map((d) => DAY_LABELS[d]))}. Nothing reaches Google until you publish.` ``
  - `scope` is `"Kitchen "` for a service and empty otherwise.
- **No Undo.** An Undo could re-dirty a draft after Discard or unmount; it is listed under follow-ups.
- **Benefit.** The result is announced politely with the days named; focus lands where the user started.
- **Risk:** none. It's a local message that says nothing went to Google, and no save is claimed. The toast stacks above the docked bar (`toast.tsx:104-133`), so `touch-critical.spec.ts:1220` can still tap "Review changes".
- **Tests:**
  - Extend `:604`: expect the toast text "Monday’s hours copied to 4 days" (render with the toast viewport, or spy on `showToast`).
  - New: copy from Wednesday's sheet, then open "Copy Monday to…", press Escape, and expect focus on the "Copy Monday to…" button.

### C3 — Split periods: say what the button does, and keep focus (#4)

- **Where:** `DaySheet` (`:1096-1138`).
- **Label.** Compute `const next = withSplitPeriod(day.periods, dayOfWeek)` and `const splitsExisting = day.periods.some((p, i) => p.opensAt !== next[i]?.opensAt || p.closesAt !== next[i]?.closesAt)`. Change the button label from "Add split period" to `splitsExisting ? "Split into two periods" : "Add another period"`. No test references the old text.
- **Focus after adding.** Find `k` = the first index whose period changed (or `day.periods.length` when a period was appended). Then run `const target = ids.opens(dayOfWeek, k === day.periods.length ? k : k + 1); void untilMounted(target).then(() => document.getElementById(target)?.focus())`. `untilMounted` is at `:194`.
- **Focus after ✕.** Focus `ids.opens(dayOfWeek, Math.max(0, index - 1))` the same way.
- **When `!canSplit`** (open, not disabled), replace the vanished button with `<p className="text-caption text-ink-muted">`:
  - 3 periods: "A day can have up to 3 opening periods."
  - otherwise: "No room for another period. Shorten one to add more."
- **Benefit.** No lost focus (2.4.3), no surprise change to existing times, and the limit is explained.
- **Risk:** none. Local UI only; the same `withSplitPeriod` output.
- **Tests:** a split on 09:00–17:00 moves focus to "Monday period 2 opens"; at 3 periods the cap caption shows; ✕ on period 2 moves focus to "Monday period 1 opens".

### C4 — Visible labels that match accessible names in the day sheet (#5)

- **Switch (`:1012-1027`).** Make the visible text a constant label: `<span id={switchLabelId} className="text-ui text-ink">Open on {label}</span>`, with `switchLabelId = useId()`, and set `aria-labelledby={switchLabelId}` instead of `aria-label`. When the day is closed, add a caption "Closed all day." (`text-caption text-ink-muted`) under it.
- **Periods.** Wrap each `TimeField` and the closing-day select in `<label className="flex flex-col gap-1"><span className="text-caption text-ink-muted">Opens|Closes|Closing day</span>…</label>`, and set the period row to `items-end`. Keep the current `aria-label`s ("Monday period 1 opens" / "… closes" / "… closing day"); they contain the visible words, which satisfies 2.5.3, and the tests keep passing. When `periods.length > 1`, add `<p className="basis-full text-caption font-medium text-ink-secondary">Period {index + 1}</p>` so the visible "Period 2" matches error text and names.
- **Benefit.** WCAG 3.3.2 and 2.5.3, and voice control works.
- **Risk:** none. The row switch keeps "Monday open", which the e2e tests use; the row is inert behind the modal sheet.
- **Test:** change `hours-editor.test.tsx:188` from "Monday open in this sheet" to "Open on Monday", and assert the visible "Opens"/"Closes" text in the sheet.

### Follow-ups (out of scope)

- Undo on the copy toast. It needs a value/onChange ref and must close on discard or unmount.
- LST-06's time-zone line in the desk meta row (`area-frame.tsx`, SHARED; page-level flow).
- #6: an inline "Closes same day ▾" disclosure in place of the always-visible select. Decide after the 320 px screenshots.
- #7: give the save-failure Alert a title, or rely on the toast. This touches the shared toast/Alert policy across editors.
- An e2e test for split, overlap, midnight, discard and leave on hours.

## 8. Screenshots to capture

1. `node tests/visual/shoot.mjs --route /listings/{loc}/hours --widths 320,390,1280 --role owner --name hours-rows`: no interaction. A baseline for rows and the header "Copy Monday to…", and a regression check for C4.
2. `/listings/{loc}/hours`, role `viewer`, 390: no interaction. Read-view regression (no new buttons or captions on disabled sheets).
3. The day sheet with Friday 18:00 → 02:00 at 320 and 390, owner: **needs interaction** (tap the Friday row, type 02:00). Before shows "Same day (Friday)" and no cue; after shows "Open past midnight? · Close on Saturday", the "Opens/Closes/Closing day" captions and the select wrap (#6).
4. After "Copy Monday to…" → Weekdays → Copy, owner at 390: **needs interaction**. Shows the toast above the docked bar.

## 9. Files touched

components/locations/hours-editor.tsx
tests/components/hours-editor.test.tsx
