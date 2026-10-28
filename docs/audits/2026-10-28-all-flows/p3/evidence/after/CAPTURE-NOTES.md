# AFTER capture notes

- **Code:** branch worktree `/tmp/naba-presence-p3` at HEAD
  `46301fa4338f82963e2f6f9b975fb4e78651d581` (`46301fa4`).
- **Time (UTC):** 2026-10-28 22:14:27Z to 22:17:45Z.
- **Command:** `bash run-capture.sh /tmp/naba-presence-p3 <this folder>`,
  using the harness copy described in `../../capture/README.md`. It uses the
  same script, fixtures, viewports and steps as BEFORE. The phases are lock,
  db, start, shoot, stop and dbstop. It runs a production build
  (`.next/standalone`) on 3532, the fixture server and Google stub on 3533,
  and a throwaway PostgreSQL 17 cluster. Shots are full-page Chromium at 390
  light, 390 dark and 1280 light, converted to WebP.
- **Fixture:** "Sprint 5 Journey" tenants, reseeded, so the listing is
  "Stub location 0da15fe2" (`/listings/9582d078-…`). That is fixture data, not
  a change. Roles: owner, plus viewer (05, 09, 15) and member (11).

## States

| State               | What the image shows                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 Board            | Listings board, two listings ("Needs attention" and "Not checked"), "Add listings from Google". Same as BEFORE.                                                                          |
| 02 Board, no match  | Search `zzqx`; empty state `No listings match “zzqx”` with "Check the spelling, or clear the search to see every listing." and "Clear filters".                                          |
| 03 Board quick look | 1280 only. Quick-look panel: "Google shows no opening hours for this listing."; Opening hours pill "No hours on Google"; "Open listing".                                                 |
| 04 Overview         | Owner overview: area cards, "No hours on Google" on Opening hours, Google connection strip. Same as BEFORE (no Review & publish link: nothing unpublished).                              |
| 05 Overview, viewer | Viewer overview: "View" buttons; Areas caption "Open an area to see what it holds here and on Google."                                                                                   |
| 06 Profile          | Business profile editor (Riverside Rooms). New place-ID and County hints; "Additional phones"; no empty saved lodging or service sections.                                               |
| 07 Hours            | Opening hours, every day Closed; "No hours on Google" note; Service hours caption "Separate hours for services…", "No service schedules yet."                                            |
| 08 Hours day sheet  | Monday sheet: "Open on Monday" switch; "Opens", "Closes" and "Closing day" labels; 18:00 to 02:00 with "Same day (Monday)"; overnight hint and "Close on Tuesday"; "Add another period". |
| 09 Hours, viewer    | Viewer hours: banner adds "Ask an owner or admin if something here needs to change."; "View-only access" bar.                                                                            |
| 10 Menu             | Empty menu: "No food menu yet", "Start a menu". Same as BEFORE.                                                                                                                          |
| 11 Menu, member     | Member menu: banner "You can look, but not change this menu" with "Ask an owner or admin…"; empty state without the "Start one here" sentence.                                           |
| 12 People           | "Invitations to answer · 0 waiting for the connected Google login"; Saved access work before Primary owner rules and Danger zone; "Request deletion".                                    |
| 13 People, invite   | Invite sheet with `not-an-email` and "Enter a valid email address."; Role hint "Edits the listing and replies to reviews…"; Scope hint "Only this listing."                              |
| 14 Booking          | Booking links: empty state, add form, Link hint "The full address of your booking page, starting with https://".                                                                         |
| 15 Booking, viewer  | Viewer booking: banner with "Ask an owner or admin…"; no add form; "Google shows no booking links on this listing."                                                                      |
| 16 Booking, add     | `example.com/book` in Link with the new hint; "Ready to review" bar with "Review booking link".                                                                                          |
| 17 Profile, invalid | Business name cleared and tabbed away: "Changed" tag, "1 change not on Google" bar with "Review changes"; no inline error (Review isn't pressed). Lower page as 06.                      |

## Steps

- **03-board-quick-look:** both steps `ok` ("board settled", then "click the
  first listing row (not its name) to open the quick look"). The locator is
  the row click from `desk-quick-look.spec.ts`.
- Every step of 08, 13, 16 and 17 is `ok` at all three viewports. 08's
  "make sure Monday is open" step switched Monday on, because the fixture's
  Monday is closed (see 07). The switch locator accepts both the BEFORE name
  and the AFTER name, "Open on Monday".
- No step failed, and no state was reshot.

## Log summary

There are 49 JSON lines: 36 URL shots and 13 interaction shots. Every line
has status 200, `horizontalOverflow: false` and `errors: []`. All 36 URL shots
have `overflow: []`. No console errors were recorded. The log contains no
cookies, tokens or secrets: it was checked for `cookie`, `token`, `secret`,
`password` and `Bearer`.
