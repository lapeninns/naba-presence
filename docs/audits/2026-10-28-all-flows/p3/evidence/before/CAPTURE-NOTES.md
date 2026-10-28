# BEFORE capture notes

- **Code:** clean detached worktree `/tmp/naba-presence-p3-before` at HEAD
  `e4123d251cf9414c74e69b9cff018ba1c574d762` (`e4123d25`).
- **Time (UTC):** 2026-10-28 22:09:33Z to 22:13:05Z. The 03 quick look was
  reshot at 22:13:32Z (see below).
- **Command:** `bash run-capture.sh /tmp/naba-presence-p3-before <this folder>`,
  using the harness copy described in `../../capture/README.md`. The phases
  are lock, db, start, shoot, stop and dbstop. It runs a production build
  (`.next/standalone`) on 3532, the fixture server and Google stub on 3533,
  and a throwaway PostgreSQL 17 cluster. Shots are full-page Chromium at 390
  light, 390 dark and 1280 light, converted to WebP.
- **Fixture:** "Sprint 5 Journey" tenants. The listing shot is "Stub location
  6e6edc4b" (`/listings/ac8d39c8-…`). Roles: owner, plus viewer (05, 09, 15)
  and member (11).

## States

| State               | What the image shows                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 Board            | Listings board, two listings ("Needs attention" and "Not checked"), "Add listings from Google".                                                          |
| 02 Board, no match  | Search `zzqx`; empty state "No listings match" with "Nothing fits this client, health and search together…" and "Clear filters".                         |
| 03 Board quick look | 1280 only. Quick-look panel: catch-all attention sentence; all three areas "In sync"; Verified; "Open listing".                                          |
| 04 Overview         | Owner overview: area cards with Edit or Open, "No hours on Google" on Opening hours, and the Google connection strip.                                    |
| 05 Overview, viewer | Viewer overview: "View" buttons; Areas caption "Check a problem, review changes or edit an area."                                                        |
| 06 Profile          | Business profile editor (Riverside Rooms). Old place-ID hints; "Additional phone numbers"; empty "Saved lodging work" and "Saved service work" sections. |
| 07 Hours            | Opening hours, every day Closed; "No hours on Google" note; Service hours without a caption, "No service schedules are saved."                           |
| 08 Hours day sheet  | Monday sheet, 18:00 to 02:00 with "Same day (Monday)"; switch labelled "Open"; no field labels and no overnight hint; "Add split period".                |
| 09 Hours, viewer    | Viewer hours: "You can look, but not change these hours / Only owners and admins can edit this location."; "View-only access" bar.                       |
| 10 Menu             | Empty menu: "No food menu yet", "Start a menu".                                                                                                          |
| 11 Menu, member     | Member menu: banner "You can look, but not change this"; empty state still says "Start one here…", with no button.                                       |
| 12 People           | People with access: "Pending invitations · 0 waiting"; Primary owner rules and Danger zone ("Delete this location") before Saved access work.            |
| 13 People, invite   | Invite sheet with `not-an-email` and "Enter a valid email address."; Role and Scope have no hints.                                                       |
| 14 Booking          | Booking links: empty state, add form, Link field with a placeholder only.                                                                                |
| 15 Booking, viewer  | Viewer booking: banner without a next step; greyed add form; "Add a booking link below…".                                                                |
| 16 Booking, add     | `example.com/book` typed in Link (no hint); "Ready to review" bar with "Review booking link".                                                            |
| 17 Profile, invalid | Business name cleared and tabbed away: "Changed" tag, "1 change not on Google" bar with "Review changes"; no inline error.                               |

## Steps

- **03-board-quick-look (FAILED, then reshot).** On the first pass, "click the
  first listing row (not its name) to open the quick look" failed with
  `TimeoutError: locator.click: Timeout 15000ms exceeded.` because the locator
  was too narrow. That shot was saved with a `-FAILED` suffix and is not kept
  here. The locator was aligned with `desk-quick-look.spec.ts` (a click on the
  row itself, the locator the AFTER run used) and the state was reshot on the
  same BEFORE harness. The log's last line is
  `# 03-board-quick-look reshot ok after locator fix 22:13:32Z`. The reshot
  has no JSON line of its own.
- Every step of 08, 13, 16 and 17 is `ok` at all three viewports. 08's
  "make sure Monday is open" step switched Monday on, because the fixture's
  Monday is closed (see 07). It found the switch by its BEFORE name, "Monday
  open in this sheet".

## Log summary

There are 49 JSON lines: 36 URL shots and 13 interaction shots. Every line
has status 200, `horizontalOverflow: false` and `errors: []`. All 36 URL shots
have `overflow: []`. No console errors were recorded. The one failed step is
the 03 entry above. The log contains no cookies, tokens or secrets: it was
checked for `cookie`, `token`, `secret`, `password` and `Bearer`.
