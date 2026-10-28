# p4-F07: Schedule a post and manage schedules (create, view, approve, pause, cancel; legacy times)

Worktree `/tmp/naba-presence-p4` at `e4123d25`. Mapped from the code only. No browser, tests or dev server were run. Anything not seen in a running app is marked **Hypothesis**.

## 1. Start and end

- **Start:** `/listings/[id]/posts` → `PostsTab` (`components/locations/posts-tab.tsx`). There are three entry points:
  - **A. New schedule.** A post's "More actions for <title>" → "Schedule publication" (`components/locations/posts-action-bar.tsx:393-398`). This mounts `SchedulePostSheet` with `openRef` (`:441-448`). The scheduler chunk is preloaded when the menu opens (`:367`).
  - **B. Manage.** The "Publication schedules" section at the bottom of the tab (`posts-tab.tsx:485-490` → `components/locations/posts/post-schedules.tsx:112-364`). It holds Review schedule, Pause, Resume, Change / Choose a new time, and Cancel schedule.
  - **C. Legacy.** "Old post times to review" (`posts-tab.tsx:482-484` → `components/locations/posts/legacy-post-schedules.tsx:64-170`). It offers "Schedule post" (the sheet, prefilled from the old time) or "Dismiss".
- **End:**
  - Create or change: the sheet closes, and the schedules, occurrences and legacy queries are invalidated (`schedule-post-sheet.tsx:286-299`). A row appears with "Awaiting approval" (`lib/locations/schedule-display.ts:88-89`). The post card's details gain "Scheduled publication awaiting approval: …" (`posts-tab.tsx:178-184`, `:412`). **No toast.**
  - Approve: the dialog closes and the row reads "Active" (`post-schedules.tsx:103-106`).
  - Pause, resume or cancel: the row's pill changes after a refetch (`:87-94`). No other feedback.
  - Legacy dismiss: the row goes away, and the section disappears when it is empty (`legacy-post-schedules.tsx:49-53`, `:62`).
- **Out of scope:** Publish now, and the "also scheduled" warning in Publish (F06, `posts-action-bar.tsx:297`, `:479-483`). The Calendar's occurrences (`/calendar`).

## 2. Roles and gates

**Feature gate (org flag, ships off):** `organisation_feature` rows `post_scheduling` and `post_scheduling_recurring`. A missing row means off (`lib/server/org-features.ts:8-14`).

| Gate                         | Client (file:line)                                                                                                                                                                                                                                      | Server (file:line)                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduling on                | `caps.postScheduling` (`lib/server/capabilities.ts:337-341`) → `scheduling` (`posts-tab.tsx:255`)                                                                                                                                                       | `requireScheduling` returns 404 `post_scheduling_unavailable` on create, approve, revise and resume (`lib/server/publication-schedules.ts:137-156`, `:111-129`)                                      |
| Repeating on                 | `caps.postSchedulingRecurring` (only when scheduling is on, `capabilities.ts:342-348`). The frequency control shows only when `recurring` is on (`schedule-post-sheet.tsx:427-443`). With it off, an existing repeat can only become "once" (`:90-92`). | 422 `schedule_recurring_unavailable` (`publication-schedules.ts:149-155`)                                                                                                                            |
| Offer "Schedule publication" | `canEditCanonical && schedulable(post) && !scheduled` (`posts-tab.tsx:455-458`, `:170-175`)                                                                                                                                                             | `requireLocationAction(...,"request_approval")` (`publication-schedules.ts:727-733`). A one-time schedule also needs a draft Google doesn't hold, and only one live schedule per post (`:741-751`).  |
| Change / new time            | `editor` (role ≠ viewer) && `enabled` && open status (`schedule-display.ts:162-167`, `post-schedules.tsx:143-147`)                                                                                                                                      | `request_approval`, closed → 409 (`publication-schedules.ts:984-1005`)                                                                                                                               |
| Review / approve             | owner or admin && `enabled` && awaiting (`schedule-display.ts:148-151`). `canApprove` comes from the server (`publication-schedules.ts:251-254`).                                                                                                       | owner or admin plus `canPublishLocation` (`:831-839`). Route roles plus `mfa:"step_up"` (`app/api/locations/[id]/post-schedules/[scheduleId]/approve/route.ts:13-14`). Two-person rule (`:861-870`). |
| Pause / cancel               | owner or admin, **even with the feature off** (`schedule-display.ts:152`, `:168`)                                                                                                                                                                       | Route `roles:["owner","admin"]`, `entitlement:"exempt"` (`[scheduleId]/route.ts:42-46`). Server check at `publication-schedules.ts:1094-1100`.                                                       |
| Resume                       | owner or admin && `enabled` && not missed (`schedule-display.ts:153-161`)                                                                                                                                                                               | `requireRecentMfa` plus `assertRouteEntitled(write)` (`[scheduleId]/route.ts:49-52`)                                                                                                                 |
| Legacy section               | Rendered only with scheduling on (`posts-tab.tsx:482`). The query is enabled for a manager (`legacy-post-schedules.tsx:42`).                                                                                                                            | GET and PATCH: `roles:["owner","admin"]` (`legacy-post-schedules/route.ts:13`, `[legacyId]/route.ts:14`)                                                                                             |

**Off-state behaviour:**

- Publish reads "Publish", not "Publish now" (`posts-action-bar.tsx:297`).
- There is no Schedule menu item (`posts-tab.tsx:445`), and the legacy section is neither fetched nor drawn.
- `PostSchedules` still fetches. It renders **nothing** when the list is empty (`post-schedules.tsx:110`).
- With existing schedules, it shows the list with only Pause and Cancel. The intro still says "Approved schedules publish without anyone having the page open" (`:118-121`), and nothing says the feature is off. Blocked rows carry the `feature_disabled` reason text (`schedule-display.ts:43-44`).

## 3. Baseline steps (taps from the Posts tab, with the post visible)

| Task                                       | Steps                                                                                                              | Taps              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------- |
| Schedule tomorrow 09:00 (default)          | More actions → Schedule publication → (Tomorrow morning is preselected, `:315-325`) → Submit schedule for approval | 3                 |
| Schedule next Monday                       | … → Next Monday → Submit                                                                                           | 4                 |
| Custom date and time                       | … → Pick a date and time → date picker (n) → time (n) → [Timezone] → Submit                                        | 4 + picker taps   |
| Repeating (recurring on)                   | The full form opens directly: frequency, start, time, ends, [event days] → Submit                                  | 6+                |
| Approve (manager)                          | Scroll to the schedules section → Review schedule → Approve schedule [+ MFA step-up]                               | 2 (+scroll, +MFA) |
| Owner schedules own post and makes it live | 3 (submit) + 2 (approve)                                                                                           | 5 + scroll        |
| Pause / Resume / Cancel                    | One button each. **No confirmation, including Cancel, which is terminal.**                                         | 1                 |
| Missed slot                                | Choose a new time → sheet (full form) → Submit → approve again                                                     | 2 + approve       |
| Legacy time                                | Schedule post → full form, prefilled (`legacy-post-schedules.tsx:136-140`) → Submit. Or Dismiss (no confirmation). | 2 / 1             |

## 4. States (`schedule-post-sheet.tsx` = SPS, `post-schedules.tsx` = PS, `legacy-post-schedules.tsx` = LPS)

**Initial**

- Preset inset sheet, when the schedule is new, one-time, not prefilled and not a "new time" (SPS:166, :388-395).
  - Title "Schedule publication" (SPS:71).
  - Description: "When NabaPresence publishes this post, separate from any repeat in the event itself. It needs approval before anything is published." (SPS:413-417)
  - Rows "Tomorrow morning" and "Next Monday", each with the sub-line "Thu 15 Oct, 09:00 · venue time (Europe/London)" (SPS:351, **raw IANA**).
  - Row "Pick a date and time", sub-line "Choose the day, the time and the timezone." or "Thu 15 Oct, 09:00 · Europe / London" (SPS:355-358, `timezoneLabel` = semi-raw).
- Full form: "Date"/"Starting", "Local time", "Timezone" select (SPS:477-522); weekly "On", monthly "Day of the month", "Ends", event days (SPS:550-669).
- Other titles: "Choose a new publication time" / "Change publication schedule" / "Pick a date and time" (SPS:404-412).
- Schedules list:
  - Title: the summary, or the raw `topicType` when there is no text (PS:157-160).
  - Subtitle: "Mon 20 Oct, 09:00 BST · Once" (`schedule-dates.ts:90-104`).
  - Footer: `describeScheduleRule` → "Once on 2026-10-20 at 09:00 (Europe/London, UTC+01:00)" (**raw zone and ISO date**, `lib/domain/publication-schedule.ts:582`), then raw status counts "1 scheduled · 2 published" (PS:183-185).
- Empty list (feature on): "No schedules yet. Use Schedule on a post to plan its publication." (PS:135). The button is actually called "Schedule publication" and sits in a menu.
- Legacy row: "Was set for 2026-10-14 18:00 (Europe/London)." (LPS:106, **raw zone and ISO date**) with a "Needs review" pill (LPS:111).

**Validation:** one message at a time, shown inside the Preview card as `role="alert"`, never on the field (SPS:257-265, :684-687). Exact copy:

- Domain: "Enter a real date." / "Use a 24-hour time such as 09:30." / "The end date is before the start date." / "Choose each day once." / "The event cannot end before it starts." (`publication-schedule.ts:52,55,126,136,85`)
- Slot: "This time doesn’t exist that day because the clocks go forward. Choose another time." / "This time happens twice that day because the clocks go back. Choose which one." / "Choose a time at least 5 minutes from now." / "Choose a time within the next 90 days." (`:366-378`). The ambiguous slot shows "Which 01:30" with "First (UTC+01:00)" / "Second (UTC+00:00)" (SPS:525-549).
- Sheet: "Every time in this schedule has already passed." (SPS:264), plus the fallbacks "Check the schedule." / "Check the event dates." (SPS:258,260).
- **Raw zod defaults reach users (no error map exists; checked with a grep for `z.config`):**
  - A cleared date gives "Invalid string: must match pattern /^\d{4}-\d{2}-\d{2}$/".
  - A cleared "Times" or "Day of the month" (`Number("")` = 0) gives "Too small: expected number to be >=1".
  - No weekday ticked gives "Too small: expected array to have >=1 items".
  - Event days over 365 give "Too big: …".
  - Source: `node_modules/zod/v4/locales/en.js:82-96`.
- The submit button is disabled while there is a problem (SPS:737).
- Valid preview:
  - The rule sentence (raw zone) (SPS:691-695).
  - "1 publication from now. Publishing starts at that time; if it cannot start within 5 minutes, the time is missed and nothing publishes late." (SPS:697-706)
  - A list of ISO "2026-10-15 09:00" entries with clock-change notes, up to 8, then "and N more" (SPS:707-723).

**In progress**

- Submit: `pending` (SPS:738).
- Discard guard: "Discard this schedule?" / "The schedule hasn’t been submitted. Nothing is published or sent for approval." / "Discard schedule" (SPS:380-386).
- Row actions: the single shared `act` mutation disables Pause, Resume and Cancel on **every** row, with no pending label (PS:212,224,263).
- Approve: `pending` (PS:356).

**Error / retry**

- Sheet: the server message, else "The schedule could not be saved. Try again." (SPS:300-305, :728-732).
- List load: QueryStates "Schedules could not be loaded" with Retry (PS:131-132).
- Row action: the server message, else "That change could not be saved." (PS:81-86, :123-127).
- Approve: an alert inside the dialog (PS:346-350), e.g. "The schedule changed after you reviewed it. Review it again." (`publication-schedules.ts:856-860`).
- Approval problem: "<slot message> Change the schedule before approving it." (PS:304-309).
- Two-person: "A different owner or administrator must approve this schedule." (PS:341-345).
- Legacy: "That old time could not be dismissed." (LPS:58).
- Status reasons, such as missed and source_changed (`schedule-display.ts:38-75`), show as a `role="status"` line in danger ink (PS:190-194).

**Success:** no toast anywhere. The pill changes ("Awaiting approval"/"Active"/"Paused"/"Cancelled") (`schedule-display.ts:83-105`).

**Approval dialog:**

- "Approve publication schedule" / "Approval covers this exact content, location, timing and event dates. …" (PS:285-290).
- Occurrences are listed as "2026-10-20 09:00 (Europe/London)" (PS:330-331, **raw**).

**Off state:** see §2. The section is hidden when empty. With existing schedules it is shown with only Pause and Cancel, and its intro copy is unchanged.

## 5. Protected rules (do not change)

- Feature and recurring gates are enforced on the server for every publishing path (`publication-schedules.ts:111-156`). The client flags are hints only.
- One-time slot rules (5 min–90 days, nonexistent time refused, ambiguous time needs an offset): `planOnceSlot` (`publication-schedule.ts:323-364`), `planSlots` (`publication-schedules.ts:665-717`).
- Approval binds `revision` and `payloadHash`, or returns 409 `approval_stale` (`publication-schedules.ts:852-860`). Two-person rule (`:861-870`). Occurrences are materialised once (`on conflict … do nothing`, `:939-944`). Any change is a new revision that needs approval again (`:972-1050`).
- Claiming and idempotency:
  - The runner claims through `claim_due_publication_schedules` (`lib/server/publication-schedule-runner.ts:960-965`).
  - It flips an occurrence from `scheduled` to `publishing` with `intent_id = scheduledPublishIntentId(run.id, sha256)` (`:583-587`).
  - It throws if the occurrence was claimed elsewhere (`:588`).
  - The #259 starvation fix, the single clock read `checkedAt` (`:950-960`, `:999`), must stay as it is.
- A missed slot is never resumed or retried. The only ways out are a new time or a cancel (`schedule-display.ts:134-169`, `publication-schedules.ts:1114`).
- Role gates: approve needs owner or admin, `canPublishLocation` and MFA step-up. Resume needs MFA plus entitlement. Pause and cancel are entitlement-exempt (the route files cited in §2).
- `describeScheduleRule` and `scheduleRuleSchema` live in shared `lib/domain` and are also used on the server (`publication-schedules.ts:665+`). Don't edit their copy for this flow.

## 6. Audit status (15 Oct, LST-19 "Raw IANA time-zone IDs", P2)

- **Fixed elsewhere:** Hours (`hours-tab.tsx:425`), Calendar (`publication-calendar.tsx:179`, `calendar-grid.tsx:98`) and the Replay name (`lib/operations/zoned-time.ts:30`) use `formatTimeZoneLabel` (`lib/format/time.ts:87-113`, tests `tests/format-time.test.ts:46-95`). It gives "UK time", "Eastern time", or null when the zone is the viewer's own.
- **Remaining in this flow on `e4123d25` (unchanged since `5fd05fce`):**
  - `schedule-post-sheet.tsx:351` (preset line).
  - `post-schedules.tsx:331` (approval list).
  - Also not named in the audit:
    - `legacy-post-schedules.tsx:106`.
    - Every `describeScheduleRule` caller: PS:177, PS:298, SPS:691, and `posts-tab.tsx:179,449` (F06-owned).
    - The `timezoneLabel` "Europe / London" form at SPS:357.
    - `zoneAbbreviation` falls back to the raw zone (`schedule-dates.ts:78`).
- **Status: partly fixed. The Posts half remains.**

## 7. Friction

| #   | Pri | Friction                                                                                                                                                                                                                                                                                       | Evidence                   |
| --- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| F1  | P2  | Raw IANA IDs and ISO dates in the preset lines, preview, row footer, approval list and legacy rows (LST-19). The same time is shown three ways in one row: "Mon 20 Oct, 09:00 BST" vs "2026-10-20 at 09:00 (Europe/London, UTC+01:00)".                                                        | §4, §6                     |
| F2  | P1  | Clearing a date or number field shows raw zod text, e.g. "Too small: expected number to be >=1", and only in the Preview card, away from the field.                                                                                                                                            | SPS:257-258, zod en.js     |
| F3  | P1  | "Cancel schedule" is one tap and terminal (a cancelled schedule can't be revised: `publication-schedules.ts:1000-1005`), with no confirmation. The shared mutation disables every row's buttons, with no per-button pending state. Legacy "Dismiss" is also one tap.                           | PS:259-270, :87-94         |
| F4  | P2  | Off state: with existing schedules, the section still promises "Approved schedules publish…" and never says scheduling is off, so a manager sees only Pause and Cancel without knowing why.                                                                                                    | PS:110-121                 |
| F5  | P2  | No success feedback after submit, approve, pause or cancel (WCAG 4.1.3 Status Messages). The result appears in a section at the bottom of the page, often off-screen on a phone. **Hypothesis** (scroll position not measured).                                                                | SPS:286-299, PS:72-80      |
| F6  | P3  | The empty copy names a control that doesn't exist ("Use Schedule on a post"; the menu item is "Schedule publication"). Row footer counts print raw statuses ("1 ambiguous"). A row with no text is titled with the raw `topicType` ("EVENT").                                                  | PS:135, :183-185, :157-160 |
| F7  | P2  | An owner who schedules their own post must find "Review schedule" at the bottom and approve it in a second dialog (5 taps plus a scroll). **Hypothesis**: offering "Review schedule" right after submit when `canApprove` would cut this. The approval rule itself is protected. Not proposed. | §3                         |
| F8  | P3  | The preview error is `role="alert"`, so it is re-announced on every keystroke that changes it. **Hypothesis** (noisy for screen readers). Not proposed.                                                                                                                                        | SPS:685                    |

## 8. Proposed changes (all inside this flow's files unless flagged)

1. **Friendly zone names (F1, LST-19).**
   - Problem: database IDs shown to operators.
   - Change: add `zoneName(zone)` = `formatTimeZoneLabel(zone) ?? timezoneLabel(zone)` to `components/locations/posts/schedule-dates.ts`. Import `formatTimeZoneLabel` from `@/lib/format`; import only, no shared edit.
   - Use it at SPS:351 (`· venue time (${timezone})` → `` `${formatWallDay(date)}, ${PRESET_TIME} ${zoneName(timezone)}` `` → "Thu 15 Oct, 09:00 UK time"), SPS:357, PS:331 and LPS:106.
   - `describeScheduleRule` uses its `timeZone` argument **only** in the parenthesis (`publication-schedule.ts:582`). So pass `zoneName(zone)` at SPS:692, PS:178 and PS:299 → "(UK time, UTC+01:00)", with no `lib/domain` edit.
   - Keep `timezoneLabel` in the Timezone **select** (SPS:510,517). `longGeneric` gives the same name for Paris, Madrid and Berlin, so the options would collide.
   - Benefit: one vocabulary across Hours, Calendar and Posts.
   - Principle: Nielsen #2 (match the real world) and #4 (consistency).
   - Shared: none. `posts-tab.tsx:179,449` is F06's; tell the integrator to pass `zoneName` there too, or leave it.
   - Schedules are fetched on the client only (not in `postsTabPrefetch`, `lib/server/prefetch.ts:810-821`), so there is no hydration-mismatch risk.
2. **Readable dates in lists (F1).**
   - Change: SPS:710 and PS:330 `{occurrence.localDate} {occurrence.localTime}` → `` `${formatWallDay(occurrence.localDate)}, ${occurrence.localTime}` ``. LPS:106 → "Was set for Tue 14 Oct, 18:00 UK time".
   - Principle: Nielsen #4. File: flow-owned.
3. **Field-level, plain validation copy (F2).**
   - Change: in SPS, replace `parsed.error.issues[0]?.message` (SPS:258) with a local `ruleProblem(issue)`. It keeps the domain's custom messages and maps zod defaults by `issue.path[0]`:
     - startDate → "Enter a date."
     - end/count → "Enter how many times, from 1 to 366."
     - end/date → "Enter a last date."
     - dayOfMonth → "Enter a day from 1 to 31."
     - weekdays → "Choose at least one day."
   - Do the same for offsets (SPS:260): "Enter days from 0 to 365."
   - Optionally also mark the offending `Field` `invalid`, with `FieldError` from `components/ui/field.tsx:308` (import only).
   - Principle: Nielsen #9; WCAG 3.3.1 Error Identification and 3.3.3 Error Suggestion.
   - Shared: none. The schema stays untouched because the server uses it.
4. **Confirm Cancel and show per-row pending (F3).**
   - Change: in PS, the Cancel button sets `confirmCancel = schedule`. An `AlertDialog` (`components/ui/alert-dialog.tsx`, import only) then shows:
     - Title: "Cancel this schedule?"
     - Description: "Nothing more publishes from it. A cancelled schedule can’t be restarted; schedule the post again to publish it later."
     - Buttons: "Keep schedule" / "Cancel schedule"
   - The confirm button and the row's buttons use `pending={act.isPending && act.variables?.id === schedule.id}`.
   - Pause stays one tap, because it is reversible.
   - Principle: Nielsen #5 (error prevention); Apple HIG (confirm destructive actions).
   - Server semantics are unchanged.
5. **Say when scheduling is off (F4).**
   - Change: PS:118-121. When `!enabled`, the intro reads: "Scheduled publishing is switched off for this workspace, so nothing here publishes. You can still pause or cancel these schedules."
   - Principle: Nielsen #1 (visibility of system status).
6. **Success toasts and copy fixes (F5, F6).**
   - Toasts: `showToast({ kind: "local", title })` (`components/ui/toast.tsx:667`, import only) in:
     - SPS `onSuccess` (:286): "Schedule sent for approval" (revision: "Changed schedule sent for approval")
     - PS approve: "Schedule approved"
     - PS act: "Schedule paused" / "Schedule resumed" / "Schedule cancelled"
     - LPS dismiss: "Old time dismissed"
     - No Undo: none of these is a cheap local revert.
   - PS:135: "No schedules yet. Choose Schedule publication from a post’s More actions menu."
   - PS:183-185: map counts through a local label map (scheduled → "planned", published, missed, ambiguous → "being checked", rejected → "not accepted").
   - PS:158-159: fall back to `POST_TOPIC_LABEL` (as posts-tab does) instead of the raw `topicType`.
   - Principle: WCAG 4.1.3 Status Messages; Nielsen #1 and #2.

## 9. Tests

**Existing assertions that the changes break (update them):**

- `tests/components/post-schedules-ui.test.tsx`:
  - `:343` ("Was set for … (Europe/London)…")
  - `:531` and `:620` ("· venue time (Europe/London)")
  - `:542` and `:627` (`/^Once on … \(Europe\/London/`)
  - the `America/New_York` sentence check (~`:666-670`; the select assertion at ~`:675` stays)
- `tests/e2e/operations-features.spec.ts:502-507`: Cancel now needs the dialog's "Cancel schedule" too (scope to `getByRole("alertdialog")`).
- Unchanged:
  - `tests/components/posts-tab.test.tsx:237`: the F06 card summary, unless the integrator applies `zoneName` there.
  - `tests/publication-schedule.test.ts:247`: the domain is unchanged.
  - `tests/short-date-callers.test.ts:222-225` and `post-schedules-ui.test.tsx:699-708`: `scheduleWhen` is unchanged.
  - The feature-off test `:459-489`: it stays valid, because the region is still hidden when empty.

**New, focused tests:**

- Unit, `tests/schedule-dates.test.ts` (new file, or add to `short-date-callers.test.ts`):
  - `zoneName("Europe/London")` → "UK time"
  - `zoneName("America/New_York")` → "Eastern time"
  - an unnameable zone falls back to `timezoneLabel`
  - the result never contains "/" for the common zones
- In `post-schedules-ui.test.tsx`:
  - the preset line reads "…, 09:00 UK time"
  - clearing the date shows "Enter a date." and no text matching /Invalid string|Too small/
  - unticking every weekday (recurring on) shows "Choose at least one day."
  - Cancel opens "Cancel this schedule?" and "Keep schedule" sends no PATCH
  - with `postScheduling:false` and one existing schedule, the switched-off sentence shows, with only Pause and Cancel
  - submitting shows the toast "Schedule sent for approval"
- Checks to run: `pnpm typecheck`, `pnpm lint`, `pnpm vitest run tests/components/post-schedules-ui.test.tsx tests/components/posts-tab.test.tsx tests/format-time.test.ts`. Run the e2e spec only if the integrator's run allows it.

## 10. Screenshot states reachable in the visual fixture

**The visual fixture leaves scheduling off.** `tests/visual/fixture-server.ts` seeds the journey tenants through `tests/e2e/helpers/stub-bridge`, and nothing there inserts `organisation_feature` `post_scheduling`; only `operations-features.spec.ts:289-293` and `operations-backend.ts:152-156` turn it on. The capture list includes `/listings/{loc}/posts` (`tests/visual/nm-capture.mjs:77`) but has no schedule-specific STATES.

- **Reachable as-is:** the off state of the Posts tab. That means "Publish" instead of "Publish now", no Schedule item in More actions, and no schedules or legacy sections. This proves the off state is hidden, but shows none of this flow's changes.
- **Reachable only with the flag on for a `uxp-p4-` fixture tenant** (e.g. via `operations-backend` `enableFeature`, or an admin SQL insert into the fixture DB `naba_visual`; no migration). Repeating states also need `post_scheduling_recurring`. States:
  - the preset inset sheet (zone line)
  - Pick a date and time
  - a validation error (clear the date)
  - the "Which 01:30" choice on the 25 Oct date
  - a row awaiting approval and the approval dialog
  - the Cancel confirmation
  - the success toast
  - the off-with-existing-schedules notice: create a schedule, then turn the flag off
- **Legacy rows:** these need a `legacy_post_schedule` row (as at `operations-features.spec.ts:518-533`), so only through the e2e backend.
- Existing e2e capture names to compare BEFORE and AFTER: `schedule-preview`, `schedule-approval`, `schedule-active`, `schedule-once-preview`, `schedule-once-awaiting`, `legacy-post-time` (`operations-features.spec.ts:328,347,351,479,500,521`).
