# All-flows UX/UI pass — NabaPresence (2026-10-28)

Six areas of NabaPresence were reviewed flow by flow, changed, and reported
before and after. Each area worked on its own branch, cut from `main` at
`e4123d25`. The branches were integrated on `ux/all-flows-presence` with
`git merge --no-ff`, in the order p6, p1, p2, p5, p3, p4.

This page indexes the area reports and summarises what each one says. It
makes no claim beyond them. Where a report says a check was not run, this page
says so too. Every area describes itself as **implemented and partially
verified**: no area ran a provider-backed journey (real Google, Supabase Auth,
Stripe or email), and all browser evidence is from fixtures with stubbed
providers.

## Area reports

- **p1 · Sign-in, auth, invites, landing, legal and shared report**:
  [before and after](./p1/before-after.md); per-flow analyses in
  [`p1/flows/`](./p1/flows/).
- **p2 · Onboarding, setup and clients**:
  [before and after](./p2/before-after.md).
- **p3 · Listings core**: [before and after](./p3/before-after.md).
- **p4 · Listings content and operations**:
  [before and after](./p4/before-after.md); flow catalogue
  [`FLOWS.md`](./p4/flows/FLOWS.md).
- **p5 · Reviews and reporting: inbox, notifications, calendar and reports**:
  [before and after](./p5/before-after.md).
- **p6 · Settings, Team, Billing and Design system**:
  [before and after](./p6/before-after.md).

## p1 · Sign-in, auth, invites, landing, legal and shared report

Area-wide checks, as reported (final head after review fixes, worktree
`/tmp/naba-presence-p1`): `pnpm verify` **passed** (626 files, 8,522 tests
passed, 1 skipped; design ratchet passed). `pnpm check:contrast` **passed**
(212/212). `pnpm test:e2e:touch` **passed** 23/23 and `pnpm test:a11y`
**passed** 64/64 on port 3510. `auth.spec.ts`, `reports.spec.ts` and
`routing.spec.ts` **passed** 55/55. The 12 changed or new component test files
**passed** 181/181. BEFORE and AFTER captures ran (165 images each side). Every
auth API call was stubbed. Live Supabase Auth, mailer and authenticator app:
**not run**. Real-device VoiceOver or TalkBack: **not run**. `audit:mobile`,
perf-lab and route JS: **not run**. `lci`: not run by design.

| Flow                                    | Key changes                                                                                                                                                                                                                                                                          | Verification status                                                                                                                                                                             | Follow-ups                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p1-F01 Sign in with email and password  | Old banner cleared on each new attempt. Errors in words for a dropped connection, a stated 429 wait and an unnamed 5xx. Confirmation-first copy for a failed email link, only with `email=error`. Invite banner and `next` note in sign-in mode only. Shared `Button` pending state. | Component tests (`sign-in-form`, `auth-api`, `auth-error`); `auth.spec.ts` passed; 8 states captured. Provider: "**Not run**: no authorised provider target; every auth call was stubbed".      | Wrap read errors as `network_error` in `lib/api/client.ts` (shared).                                                                                                    |
| p1-F02 Create an account                | "Check your email" stage gets a focused h2 and names the submitted address. Focus returns to the email field.                                                                                                                                                                        | Component tests (`sign-in-form`, `sign-in-recovery`, new); 5 states captured.                                                                                                                   | None specific.                                                                                                                                                          |
| p1-F03 Resend a confirmation email      | "Send another link" stays on screen. Neutral note in a live region. Empty or malformed address flagged on the field, with no request. Invitation token carried.                                                                                                                      | Component tests; mutation check on the stale resend note "Failed as expected; fix restored". 3 states captured.                                                                                 | None specific.                                                                                                                                                          |
| p1-F04 Confirm an email from the link   | Same native POST, now "Confirming…"; only the first press posts; ready again after back-forward restore. Incomplete link titled for what happened.                                                                                                                                   | Component test reads the posted `FormData`. No-JavaScript run: "**Not run** as a browser run; covered by the component test". BEFORE "submitting" frames were blank and dropped; AFTER retaken. | Carry the invitation through a failed confirmation redirect (route change, owner decision). A stopped confirm navigation keeps "Confirming…" until reload (left as is). |
| p1-F05 Two-step verification at sign-in | Expired card with focus and a "Sign in again" link that keeps `next`. "Try again" on load failure. Separate "Signing out…". Rate limit names the wait and the control.                                                                                                               | Component test `mfa-verify-form`; captures from a second server with `MFA_ENABLED=true`. Real authenticator app not run.                                                                        | Lost-authenticator line waits on D10.                                                                                                                                   |
| p1-F06 Request a password reset link    | Check-your-email stage with guidance. Full resend errors as alerts, keyed to the address. Address kept and selected.                                                                                                                                                                 | Component tests (`password-reset`); 6 states captured.                                                                                                                                          | Resend cooldown unconfirmed, so no client timer added.                                                                                                                  |
| p1-F07 Choose a new password            | Outcome-unknown dead end. "May already be saved" after a dropped connection. Errors clear on typing. One field error for a breached password.                                                                                                                                        | Component tests (`password-reset`, `password-reset-recovery`, new); 6 states captured.                                                                                                          | `?from=reset` context on the two-step page needs the server's save order confirmed.                                                                                     |
| p1-F08 Accept a team invitation         | Description follows the toggle. Invitation panel when signed in. "Go to Inbox instead" for the wrong account. Session-aware exits. Neutral "already accepted" copy. Focus after retry and after a finished accept.                                                                   | Component tests (`invitation`, `invitation-leaving`, new); mutation check "Failed as expected". 9 states captured.                                                                              | See p1-F04 (invitation through a failed confirmation).                                                                                                                  |
| p1-F09 Public entry and auth shell      | Phone audience line under product screens. Auth error page retries with `retry` and keeps focus.                                                                                                                                                                                     | `/` redirect in production: "**Not run** (harness bootstraps a session); source only". Error pages in a browser: "**Not run**"; component tests assert `retry` is called.                       | Other error boundaries still call `unstable_retry ?? reset`.                                                                                                            |
| p1-F10 Privacy policy and terms         | "On this page" contents, `mailto:` links, larger section headings, print rules. Text and section ids unchanged.                                                                                                                                                                      | `legal-pages` component test pins the 18 section ids; new axe sweep in `auth.spec.ts` (light and dark); 4 states captured. Print output: "**Not run**".                                         | Dark-mode printing. Phone contents list adds about 400 px; collapse if too long.                                                                                        |
| p1-F11 Shared performance report        | Period links land on `#period`. One public Google caption. Empty-state lines for no figures and no listings. Error page shows "Trying again…" and keeps focus.                                                                                                                       | `reports.spec.ts` period assertions updated and passed; `shared-report-page` component test; 3 states captured.                                                                                 | Public wording for `PartialCoverageAlert` (owner: Reports). Rate deltas are percentage points (shared formatter).                                                       |

**Shared-file edits**

- `lib/api/auth-errors.ts`: new network, outage and stated-wait copy also
  reaches `components/settings/two-step-verification-card.tsx` and
  `components/auth/mfa-step-up-prompt.tsx`, by design. No caller's signature
  changed; the new third argument of `confirmStatusMessage` is optional.
- `tests/e2e/reports.spec.ts`: only the period-switch assertions (`#main` to
  `#period`).
- `tests/e2e/auth.spec.ts`: one new `describe` block.
- No edits to `components/ui/*`, `components/app-shell/*`,
  `components/reporting/*`, `components/clients/*`, layouts,
  `app/globals.css` or `lib/server/*`.

**Protected behaviour**

- The report says no route handler, server module, schema, migration,
  dependency, flag or env var changed; `lib/api/auth.ts`, `lib/server/**`,
  `app/api/**` and `app/auth/**` are untouched (from `git diff --stat`).
- Requests are the same. Enumeration resistance holds. The confirmation form
  keeps its method, action and hidden fields (component test). Invitation dead
  ends reveal nothing. The shared report stays read-only (tests assert no
  links). Legal pages stay static, with ids pinned by test.
- An independent reviewer checked each item against the diff and found no
  P0, P1 or P2 findings. All eight P3 items and both polish notes were fixed.

## p2 · Onboarding, setup and clients

Area-wide checks, as reported: `pnpm verify` **passed** (625 files, 8,528
tests passed, 1 skipped; ratchet passed). `pnpm check:design --ratchet` and
`pnpm check:contrast` **passed** (212 pairs). Area e2e (`setup`,
`google-onboarding`, `onboarding-match-link`, `clients`, `client-hub`,
`client-form-archive`, `routing`, `touch-critical`) **passed** 122/122 on
`ac14987d`. `pnpm test:e2e:touch` **passed** 23/23 and `pnpm test:a11y`
**passed** 64/64 on `ac14987d`. Screenshots BEFORE 45/45 and AFTER 45/45.
Independent review: 0 P0, 0 P1, 3 P2 (all fixed). Live Google OAuth, real
Business Profile accounts and a real import: **not run**. `audit:mobile` and
tap counts: **not run**, and no measured-improvement claims are made.
Interactive error states are covered by unit and component tests, not
screenshots.

| Flow                                    | Key changes                                                                                                                                                                                                                      | Verification status                                                                                                                                                                     | Follow-ups                                                                                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p2-F01 Choose what to set up            | Every waiting client listed (query cap 200). One-line all-clear keeps New client near the top. "Try again" for a business that isn't ready. "Loading setup" label.                                                               | Captured (`01-setup-chooser`); area e2e passed.                                                                                                                                         | None specific.                                                                                                                                                                    |
| p2-F02 Create a client                  | Duplicate name is a focused field error. Unconfirmed failure says so and points to Clients. Definite 5xx keeps "Nothing was added". "Nothing is sent to Google." Create stays pending through navigation. Dark-mode swatch tick. | Captured (`02-new-client`). `client-form-archive.spec.ts` now stubs a definite 503, and a new case checks the unconfirmed-500 copy; "Both pass".                                        | None specific.                                                                                                                                                                    |
| p2-F03 Wizard frame; agency or business | Blocked Continue names unsaved agency name and timezone. Timezone leave guard. Preamble steps unnumbered. Refused-step note is actionable, rewrites the URL and clears on leave.                                                 | Captured (`03-setup-wizard-resume`, `15-setup-agency`, and the refused-step notes in 08–10).                                                                                            | Blocked Continue with only the name unsaved focuses step content, not Save name (needs an id prop on shared `AgencyNameForm`). Shared Stepper mark for unnumbered preamble steps. |
| p2-F04 Connect Google                   | Client's current login first as "Keep using this account". No orphan glyph. No empty section. No blue note over a Google error. Continue is secondary while blocked.                                                             | Captured (`04-setup-connect`). Live Google OAuth not run.                                                                                                                               | Fresh sign-in confirmation and the location-limit warning are ignored after OAuth return; a reload re-shows an old error.                                                         |
| p2-F05 Choose Business Profile accounts | Duplicate callout removed. Load error announced, with "Nothing was changed." and "Try again". "No Business Profile accounts" state with a way back to Connect. Plain role names.                                                 | Captured, but "**Not like-for-like for 05 and 06**": BEFORE shows the old error state, AFTER the loaded state. New error, empty and loading states are covered by component tests only. | None specific.                                                                                                                                                                    |
| p2-F06 Link the client's listings       | Loading, error and empty are distinct, with one retry. Drafts section no longer repeats the alert. Listings load labelled and failures announced. Stale data kept on a failed reload.                                            | Captured (`06-setup-listings`, see the note on F05). Component tests.                                                                                                                   | None specific.                                                                                                                                                                    |
| p2-F07 Import review history            | Start re-reads setup when it settles. Start is primary while nothing has started. Cancel only on queued rows, with errors shown. "Retry import" and "import again" agree. "Attempts 0" hidden.                                   | Captured (`07-setup-backfill`). Real import not run.                                                                                                                                    | Import progress polling while Start runs needs `lib/queries/use-backfill.ts` (shared). Two primary buttons on this step (recorded).                                               |
| p2-F08 Notifications, Team, Done        | Notifications step says it's optional and needs a Pub/Sub topic; new title. Skip re-reads setup. No "Finish later" on Done.                                                                                                      | "Notifications, Team and Done couldn't be reached in the fixture"; 08–10 show the refused-step note only. Component tests.                                                              | Setup resume after skipped optional steps (see the combined list).                                                                                                                |
| p2-F09 Find a client                    | "Not compared with Google yet". Empty "In sync" result is neutral. `/settings/listing` gets a named moved notice. Chip order stays by severity, rationale in code.                                                               | Captured (`11-clients-index`).                                                                                                                                                          | Owner to confirm severity order (follow-up 27, CLR-19).                                                                                                                           |
| p2-F10 Client hub                       | A cause link after the status sentence. Healthy login is plain text. No lone "·" on phone cards. Login line names the login the alert is about.                                                                                  | Captured (`13-client-hub`). A key-icon wrap at 390 found in review was fixed.                                                                                                           | None specific.                                                                                                                                                                    |
| p2-F11 Edit a client's details          | Confirmed save writes the server's client to the cache before the toast. Focus to the Details heading. Archived or missing client says so.                                                                                       | Captured (`14-client-settings`). Component tests.                                                                                                                                       | None specific.                                                                                                                                                                    |
| p2-F12 File, move and unfile listings   | "Unfile" with reassurance. Consistent empty state. Undo runs once, shows progress and names the listing.                                                                                                                         | Captured (`14-client-settings`). Unit test: the double-tapped unfile Undo sends one POST.                                                                                               | Moving a listing extends access, and Undo doesn't take it back (owner decision).                                                                                                  |
| p2-F13 Archive and restore              | No gap. Undo runs once and reports restore and re-file separately. Accurate copy. Own pending state. No endless "Checking attached listings…".                                                                                   | Captured (`12-clients-archived`, `14-client-settings`). Unit test: "runs the archive's Undo once, however often it is tapped".                                                          | None specific.                                                                                                                                                                    |

**Shared-file edits** (all additive and opt-in, as the report states)

- `components/settings/agency-name-form.tsx`: optional `onDirtyChange` prop.
  `components/settings/policy-form.tsx` (p6) does not pass it.
- `components/settings/account-picker-card.tsx`, `backfill-card.tsx`,
  `import-card.tsx`: new props `onChooseAnotherLogin`, `onStartSettled`,
  `inFlightNote`, `onChooseAccounts`. Their only callers are setup steps.
- `components/setup/onboarding-drafts.tsx`: whole file reformatted by
  Prettier; most of its diff is formatting.
- Not edited: `components/ui/*`, `components/app-shell/*`, `app/globals.css`,
  `lib/queries/*` and `share-report-dialog.tsx`.

**Protected behaviour**

- No route handler, API contract, SQL, migration, schema, flag or dependency
  changed (`git diff --stat`). `lib/clients/health.ts` gains presentation
  mapping and a `healthCause()` helper over data the hub already receives.
- Role gates, 404s and visibility unchanged. Google OAuth start, attach and
  return handling unchanged. Success only after a 2xx; Archive still waits for
  the re-read. Undo now runs once per toast, with unit evidence.
- Business wording is covered by the `setup-wizard.test.tsx` business cases
  and the `step-connect` label.

## p3 · Listings core

Area-wide checks, as reported (code head `46301fa4`): `pnpm verify` **passed**
(623 test files passed, 1 skipped; 8,550 tests passed, 1 skipped).
`pnpm check:design --ratchet` and `pnpm check:contrast` **passed**.
`PLAYWRIGHT_PORT=3530 pnpm test:e2e:touch` **passed** 23 (head rerun 23) and
`pnpm test:a11y` **passed** 64 (head rerun 64). BEFORE and AFTER captures, 49
images each side. `pnpm test:integration`: **not run** ("No server or database
code changed"). Real Google: **not run**. VoiceOver or TalkBack: **not run**.
`audit:mobile`, perf-lab, route JS: **not run**. `lci`: **not run** in this
area pass.

| Flow                                          | Key changes                                                                                                                                                                                                                                     | Verification status                                                                                                                                                                                                  | Follow-ups                                                                                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p3-F01 Find, filter and open a listing        | Quick look uses the overview's own words and names one attention reason. Load error announced with "Trying again…". "N of M listings shown". "No listings match" names the search and offers "Show N matches"; focus moves to the search field. | Captured (01–03). `listings` and `desk-quick-look` specs passed (head rerun). Focus assertions added in `listings-board.test.tsx`. "No e2e covers board search and no-match".                                        | Town search and health-chip toggling (out of scope).                                                                                                                                                |
| p3-F02 Select, hand off to bulk, add listings | Bar adds "N not shown" and "N not linked to Google". "Clear selection" returns focus. "Add listings from Google" opens `/setup?client=` for a visible client.                                                                                   | No flow-specific check named; area-wide checks apply.                                                                                                                                                                | Keep the selection across the bulk hand-off (skipped). Focus after "File under…".                                                                                                                   |
| p3-F03 Overview and go to an area             | Disconnected and unlinked listings get their own alert with the right action or who can act. Full-width Review & publish link on phones. Publish areas in words. Calmer failed-publish alert. One announced loading shape.                      | Captured (04, 05).                                                                                                                                                                                                   | Open Activity from the failed-publish alert. Activity drawer "location" wording. `listingAttentionReason()` not yet used by the health strip.                                                       |
| p3-F04 Area header                            | A failed "Check Google now" also shows in the status sheet. Announced pending rows on area switches. Booking loading words match.                                                                                                               | No flow-specific check named; area-wide checks apply.                                                                                                                                                                | Time zone in the shared meta row (follow-up 26) was done as an alternative. DSK-05 breadcrumb remainder (follow-up 22) skipped. A failed check is announced twice.                                  |
| p3-F05 Core business profile                  | "Review changes" stays enabled and focuses a summary of every problem; a guard still blocks review while a check fails. Plainer field tags. Description counter no longer live.                                                                 | Captured (06, 17). Component tests assert no preview request. Five Review-enabled assertions updated in `gbp-management-tabs.spec.ts`.                                                                               | Visible progress while a review is prepared (needs shared footer opt-in). Address-details summary link. `fieldErrorsFromPayload` union bug (pre-existing).                                          |
| p3-F06 Google-reviewed profile changes        | Invalid attribute values checked before review. Empty saved work hidden. Saved reviews named by their fields. Named Remove buttons. Place-ID help with a finder link.                                                                           | `gbp-management-tabs.spec.ts:1370` "**Failed → fixed → Passed**" (finder link sat between field and button; fixed in `0d3a4852`). `services-backend`, `lodging-complete-backend`, `lodging-recovery-backend` passed. | One entry point per saved service or lodging review (skipped).                                                                                                                                      |
| p3-F07 Regular weekly hours                   | Overnight hint with an explicit "Close on {day}" button. "Copy to…" confirms and returns focus. Split button explains itself. Visible "Opens", "Closes" and "Closing day" labels.                                                               | Captured (07, 08). Component tests. "No e2e covers … the overnight hint".                                                                                                                                            | Undo on the copy toast; save-failure alert title (out of scope).                                                                                                                                    |
| p3-F08 Status, special and service hours      | "Keep Google's hours" fills the draft only, with guards added after review (P1-1). Plainer footer. Time zone is the Regular hours caption. Labelled special days. Google's names for service schedules.                                         | Review-fix tests passed (three cases). "No e2e covers … Keep Google's hours (no `google_dirty` stub state exists)".                                                                                                  | Toast when Google matches the saved hours (P3-2 remainder). Footer "where" override (shared). Special above service hours (hypothesis). Keeping Google's version for `conflict` (product decision). |
| p3-F09 Food menu                              | Emptying the draft keeps the editor and "Undo removal". Preview says why it's off. Remove dialog names what goes. Read-only roles get the hours gate and view-only bar.                                                                         | Captured (10, 11). "No e2e covers … a menu edit end to end".                                                                                                                                                         | Show menu-item attributes (out of scope).                                                                                                                                                           |
| p3-F10 People and invitations                 | "Invitations to answer" separated from "not yet accepted". Keyed footer buttons per step. Role and scope choices say what they grant. Email checked on blur or Enter. Saved work first.                                                         | Captured (12, 13). `administration-access-backend` and `-recovery` passed (head rerun).                                                                                                                              | "Withdraw invitation" wording. People mobile LCP and JS budgets (follow-up 29).                                                                                                                     |
| p3-F11 Transfer or request deletion           | Failed previews explained in the dialog. Only destination refusals stay in the dialog; others still block an open review. "Request deletion". Bare account ID accepted. Ended state explains the caveat and offers next steps.                  | `lifecycle-backend` passed (head rerun). Regression test for P2-1 "fails without the fix".                                                                                                                           | Remove "lifecycle" from danger-zone copy (dropped: about 27 e2e assertions). Per-code preflight messages, account picker (API).                                                                     |
| p3-F12 Booking link                           | Loading label says "booking links" (LST-31 regression fixed). Read view for viewers and members without publish rights. Refusals in booking-link words. "Done" only for a settled outcome.                                                      | Captured (14–16). `place-actions-backend` spec passed.                                                                                                                                                               | Member with a publish grant gets an editor the server refuses (product decision). Server strings still say "action link".                                                                           |
| p3-F13 Read-only and access-denied views      | "Ask an owner or admin…" on role-limited banners. "View", not "Review", for roles that can't review. People denied card no longer repeats itself.                                                                                               | Captured (05, 09, 11, 15).                                                                                                                                                                                           | People pill and model note for non-managers. "Ask for access" on the denied card (with p4). Doubled read-only banner.                                                                               |

**Shared-file edits**

- `components/listings/area-frame.tsx` (shared by p3 and p4): imports
  `QueryPending`, renders `GoogleFreshnessFailure` in the status popover after
  a failed check, and replaces the grey loading block with "Loading this
  page…". On p4's pages only the loader and the failed-check line change.
- `components/listings/listing-gate.tsx`, `listing-skeleton.tsx`,
  `app/(dashboard)/listings/[id]/loading.tsx`: one announced loading shape on
  every listing area page, p4's included.
- `lib/editors/gate.ts`: role-limited reason gains `ASK_OWNER_OR_ADMIN`
  (callers: hours, profile, menu, booking). Billing case unchanged.
  `components/locations/location-tab.tsx` uses the constant.
- `components/locations/administration/administration-denied.tsx`: People
  copy changed; Verification (p4) copy byte-identical and pinned by a test.
- `components/locations/activity-panel.tsx`: empty-state copy also shows in
  the Activity drawer on every listing page.
- `lib/editors/hours-notes.ts`, `lib/editors/hours-presentation.ts`:
  `validateHours` gains an optional second argument.
- e2e specs: `gbp-management-tabs.spec.ts` (whole-file Prettier reformat,
  flagged as a merge-conflict risk), `listings.spec.ts`,
  `place-actions-backend.spec.ts`, `lifecycle-backend.spec.ts`,
  `administration-access-recovery.spec.ts`.

**Protected behaviour**

- `git diff --stat e4123d25..HEAD` is empty for `app/api`, `lib/server`,
  `lib/contracts`, `supabase/`, `package.json` and the lockfile, and for the
  shared primitives (`components/ui`, `components/editors`,
  `components/reviewed-write`, `components/app-shell`, `lib/ui`,
  `lib/listings/area-nav.ts`, `app/globals.css`).
- Edit versus publish, revision checks, two-person approval, overwrite
  consent, lifecycle gates, bulk cap and the unassigned-member 404 are each
  traced to file and line and to an independent reviewer's item.
- Reviewer found no P0. P1-1, P2-1, P2-2 and P3-1 were fixed; P3-2 partly;
  P3-3 to P3-6 left as follow-ups.

## p4 · Listings content and operations

Area-wide checks, as reported (final tree): `pnpm verify` **passed** (635 test
files passed, 1 skipped; 8,618 tests passed, 1 skipped). `pnpm check:design`
**passed** (103 before, 103 after). `pnpm check:contrast` **passed**. 13 new
component test files **passed**. `pnpm test:e2e:touch` **passed** 23 and
`pnpm test:a11y` **passed** 64 on port 3540. BEFORE and AFTER capture, 24
states × 3, axe on each: "0 axe violations and no horizontal overflow".
`tests/visual/shoot.mjs`: "**Blocked.** `naba_visual` is missing on the local
Supabase". `audit:mobile`, perf-lab: **not run**. Provider-backed journeys:
**not run**. Hosted CI and `lci`: **not run**. A publish, a bulk start and a
verification send were never pressed in a capture.

| Flow                            | Key changes                                                                                                                                                                              | Verification status                                                                                                                                                                           | Follow-ups                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| p4-F01 Photo library            | Thumbnail fallback. Named tiles, dated only after hydration. Stale grid dimmed and `inert`. Role-aware empty copy. Position line. Toast after a manual refresh.                          | Captured (`f01-photos-library`), but the stub "returns no photos", so the grid and lightbox are component-tested only (photos, 23 tests).                                                     | None specific.                                                                                                                                   |
| p4-F02 Add photos               | Per-file "Try again" resends the kept intent. Honest summary after a re-read. Run-wide refusals stop at the first file. "Done" end state.                                                | Captured (open and ready states). Upload outcomes component-tested only.                                                                                                                      | None specific.                                                                                                                                   |
| p4-F03 Delete a photo           | Focus to the next tile. Errors inside the dialog. Stale delete follows Google's version or disables Delete. Named dialog title.                                                          | Component tests only (no photos in the stub). Review P1 fixed, with a new test in `photos-flows.test.tsx`.                                                                                    | None specific.                                                                                                                                   |
| p4-F04 Browse posts             | Schedule line in plain words and local time. "Sent to Google" view name. History named for screen readers. "Loading drafts…".                                                            | Captured (`f04-posts-draft`, `f04-posts-empty`). Component tests (9). The "Made on Google" change was reverted after review.                                                                  | Post provenance needs a real field.                                                                                                              |
| p4-F05 Write and publish a post | Step-up copy says nothing was sent. Conflicting save keeps edits and offers "Load theirs / Keep mine". Footer names the real button; one "Preview".                                      | Captured (composer open and written). `post-composer-publish.test.tsx` "passes unedited, including the exact consent text".                                                                   | Dates for events and offers (hypothesis). Second draft after a lost save (server). Consent wording under the two-person policy (owner decision). |
| p4-F06 Act on a post            | Consent also covers a second approver. "Send back to draft". Focus to the post's heading. Waiting caption replaces an Approve the server would refuse. Delete error stays in the dialog. | Captured (`f06-publish-confirm`). Component tests (13).                                                                                                                                       | Server-computed `canApprove` (contract change). Possible missed `finalFocus` after a fast refetch.                                               |
| p4-F07 Schedule a post          | "UK time" and plain dates instead of raw zones and ISO dates. Validation under the field. "Cancel this schedule?" dialog. Toasts after the server answers.                               | Captured (schedule sheet, custom date). `operations-features.spec.ts` **passed** 18 with two assertion updates.                                                                               | Activity cursor regex lacks `schedule:`.                                                                                                         |
| p4-F08 Suggested updates        | `disabledReason` on both check buttons. Check result from the response. Settled rows disabled after `onSuccess`. Loading and error roles.                                                | Captured (owner, viewer). The stub returns no suggestions, so rows are component-tested only (7 tests).                                                                                       | **Core defect, not fixed:** food-menu decisions send the profile's revision. `proposal_patch_invalid` copy in `lib/`.                            |
| p4-F09 Review & publish         | Success sentence only for `confirmed_applied`. Unreadable areas can be left out. Read-only view for roles that can't publish.                                                            | Captured (owner, viewer). Component tests (9).                                                                                                                                                | None specific.                                                                                                                                   |
| p4-F10 Verification status      | One warning with "Check Google again". Pill from Google's fields only ("Unknown", never "Not verified" without an answer). Plain sentences.                                              | Captured (two listings). `verification-workspace.spec.ts` passed. Unverified and pending states component-tested only.                                                                        | "merchant standing" still in a server string.                                                                                                    |
| p4-F11 Start a verification     | Status line on a verified listing; Review is not disabled. Plain messages per code. Field errors after blur.                                                                             | Captured (`f11-verification-tools`). `verification-start-backend` passed. Send never pressed.                                                                                                 | Unknown business type (owner decision). Extra address codes. Double polite announcements on field errors.                                        |
| p4-F12 Complete with a PIN      | Truthful empty state. Hint per method. Plainer review copy. "Refresh this review" calls the read-only `checkState()`.                                                                    | Not captured. `verification-pin-backend`, `-pin-drift`, `-pin-recovery` passed (48 with start).                                                                                               | PIN typed before hydration (needs a repro). Typo on re-entry forces a new review (owner decision).                                               |
| p4-F13 Compose a bulk change    | "Choose a date." instead of "Invalid ISO date". Preview and Add stay focusable with a reason. "Choose listings first". Busy until navigation.                                            | Captured (initial, none, ready). Component tests (9). `operations-features.spec.ts` passed.                                                                                                   | Board should seed its selection from `?ids=` (p3).                                                                                               |
| p4-F14 Track a bulk operation   | Last known state kept on a failed refresh. Discard and Stop confirm with server counts. "Retry N unconfirmed". Real not-found state. Member controls match `requireBatchControl`.        | Captured (`f14-bulk-previewed`). Component tests (13). Bulk start never pressed.                                                                                                              | Activity cursor regex lacks `bulk:`.                                                                                                             |
| p4-F15 Old flat links           | Signed out in production: `sign-in?next=<old path and query>`, sanitised.                                                                                                                | Captured (owner, member). Signed out: unit-tested only; the capture shows the development fallback. `tests/flat-route-redirect.test.ts` (+3), `tests/next-config.test.ts`, `routing.spec.ts`. | `/clients` moved notice and business-mode bounce (see the combined list).                                                                        |

**Shared-file edits**

- `lib/server/flat-route-redirect.ts`: a signed-out branch in
  `flatRouteTarget` for production. Its only callers are the five flat-route
  shims.
- `tests/e2e/operations-features.spec.ts`: two assertion updates for copy
  changed on purpose.
- No edits to `components/ui`, `components/editors`,
  `components/reviewed-write`, layouts, `app/globals.css` or another area's
  components. Shared components are used as they are.

**Protected behaviour**

- `git diff --stat -- app lib supabase` shows only
  `lib/server/flat-route-redirect.ts`. Every request body and endpoint is the
  same; the review checked this item by item.
- Idempotency (upload and delete intents, bulk busy state), consent (the
  composer consent test passes unedited), server authority and deep links are
  each described with test evidence.
- One core defect was found and recorded, not fixed (F08 food-menu revision).
- Review: no P0, 1 P1, 3 P2 and 6 P3. P1 and all P2s fixed (one by revert);
  two P3s left.

## p5 · Reviews and reporting: inbox, notifications, calendar and reports

Area-wide checks, as reported (on `8da8cae2` unless noted): `pnpm verify`
**passed** (8,601 tests on `8da8cae2`; 8,605 passed, 1 skipped on the final
head). `pnpm check:design` **passed** (103 before and after).
`pnpm check:contrast` **passed**. `pnpm build` **passed**.
`pnpm test:e2e:touch` **passed** 23 and `pnpm test:a11y` **passed** 64.
`inbox`, `inbox-shallow-url`, `inbox-history`, `journeys`,
`approval-notifications` specs **passed** 40. `operations-features`,
`reports`, `business-mode`, `routing` specs **passed** 72. Captures 42 + 42.
Full e2e suite, integration tests, perf-lab, `audit:mobile`, real devices and
a live Google journey: **not run**.

Measured, as reported (`node tests/perf/route-js.mjs`, gzip upper bounds from
the build, not transfer sizes): `/inbox` 468.3 to 470.7 KB, `/reports` 490.7 to
492.3 KB, `/calendar` 457.1 to 460.4 KB, `/notifications` 416.7 to 417.6 KB,
dashboard shell unchanged at 378.9 KB.

| Flow                                   | Key changes                                                                                                                                                                                                                                                                                                                                                                                                                      | Verification status                                                                                                                                                   | Follow-ups                                                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| p5-F01 Work the reply queue            | Rows kept after a failed refresh, with Try again. Empty list plus failed refresh is the error state. "Load more" keeps focus. Sort is not a filter. No false empty on queue switch.                                                                                                                                                                                                                                              | Captured (01, 03). Inbox specs passed. R2 and R3 fixes: "Source only".                                                                                                | None specific.                                                                                                                                |
| p5-F02 Narrow the list                 | Search and filter empty states name the term and queue, with "Clear search" or "Clear all filters". Focus after clearing. Filters sheet clarified. Curly quotes in the search chip.                                                                                                                                                                                                                                              | Captured (04). Quotes fix: `active-filter-chips.test.tsx` 14 passed, "not in the e2e runs or the screenshots"; AFTER 04 still shows straight quotes.                  | R15 (Clear counts sort as a filter).                                                                                                          |
| p5-F03 Read a review                   | Real draft authorship. Plain history labels. Visible "Photo unavailable". No retry on a deleted review. Desk pane matches the list; J hint removed.                                                                                                                                                                                                                                                                              | Captured (02, 05). Component tests. R5: "Source only".                                                                                                                | Hotkey dialog and J (owner decision).                                                                                                         |
| p5-F04 Reply                           | "Generating a draft". Google-pending reads "sent". The bar names a next step by cause and role. Delete error in the confirm. Contradicting copy removed.                                                                                                                                                                                                                                                                         | Component tests; `inbox.spec.ts`, `journeys.spec.ts` passed.                                                                                                          | Save path for edit-only users (owner decision). **Blocked:** honest wording for an auto-retried publish needs an API field. R11.              |
| p5-F05 Two-person approval             | Edited parked reply has one action, "Save and take out of approval", and can't be approved unseen. "Reject" becomes "Send back". Parked state said once.                                                                                                                                                                                                                                                                         | `action-bar.test.tsx` "replaces Approve with Save…"; approval journeys in `inbox.spec.ts` and `journeys.spec.ts`. No approval rows in screenshots. R6: "Source only". | R16, R17, R19.                                                                                                                                |
| p5-F06 Triage one review               | "No reply needed" in Done. Action hidden where it doesn't fit. Assign toasts name the person. Focus after a row leaves.                                                                                                                                                                                                                                                                                                          | Component tests.                                                                                                                                                      | Auto-advance after "No reply needed" (owner decision). R18.                                                                                   |
| p5-F07 Bulk act                        | Progress, counted skip reasons and a receipt with "Follow batch". Only rows that did not take effect stay ticked. Cancelled selection stays cancelled.                                                                                                                                                                                                                                                                           | `bulk-action-bar.test.tsx` (cancel case "fails without the fix"). Bulk approve and template "judged from code only" (no fixture rows).                                | Pass the assignee name to the bulk bar. R21.                                                                                                  |
| p5-F08 Sync from Google                | Progress toast replaced by the result. Distinct copy for some listings failing, 429 waits and lost answers. A listing the server reports as `partial` is worded as partial, never "Up to date"; "Up to date" speaks only for the listings checked. Try again only for transient failures. Freshness warns about logins. **Not handled:** a sync that stops at its time budget leaves unreached listings invisible to the client. | `sync-reviews-button.test.tsx` (partial and "listings checked" cases); `touch-critical.spec.ts` waits for the result toast.                                           | **API:** the session reconcile needs a `truncated` flag. Desk "Sync" label (hypothesis). Pull-to-refresh (follow-up 25, owner decision). R12. |
| p5-F09 Check notifications             | "Mark N read". Account kinds link to settings. Failed Load more reported at the bottom. Focus kept.                                                                                                                                                                                                                                                                                                                              | Captured (06, 07; empty only). `notifications-review-links.test.tsx`.                                                                                                 | "Notification settings" shown twice when empty (observed, not changed).                                                                       |
| p5-F10 Resolve a notification          | "Resolving…" until the server confirms, then "Resolved" and a polite announcement. Refusals say why. Rows say who closes them.                                                                                                                                                                                                                                                                                                   | `operational-notifications.test.tsx` (held resolve); `operations-features.spec.ts` waits for "Resolved".                                                              | Initial focus to Cancel (owner decision). R13, R14.                                                                                           |
| p5-F11 Browse scheduled publications   | Count or "Nothing scheduled in …" line. "+N more" opens Agenda. Visible problem statuses. Inert grid while loading. Stale filter ids checked before the first request.                                                                                                                                                                                                                                                           | Component tests (`publication-calendar.test.tsx`); `operations-features.spec.ts` agenda copy updated. Scheduling is off in the fixture, so no on-state screenshots.   | `#post-schedules` deep link "untested in a browser".                                                                                          |
| p5-F12 Calendar unavailable            | Off-state copy says only support can switch it on; no channel invented. Own-service error copy. Announced off state.                                                                                                                                                                                                                                                                                                             | Captured (08, 09). Role tests for admin, member, viewer, scoped and business.                                                                                         | D10 support channel (LST-28).                                                                                                                 |
| p5-F13 Reply report                    | "this period". Figures kept after a failed refetch. Failed comparison said. "Unresolved" explained. Owner-only "Add listings from Google". Phone skeleton.                                                                                                                                                                                                                                                                       | Captured (10). `reporting-honesty.test.tsx`; `reports.spec.ts` passed.                                                                                                | Rating readout and "—" tile reasons (owner decision). R20.                                                                                    |
| p5-F14 Scope and period                | "listings" throughout Reports components. Ways back keep tab and period. Period note at every width. "We can't find this client".                                                                                                                                                                                                                                                                                                | Captured (13, 14). State 14 silently drops to All clients, before and after, so the not-found copy is "covered by component tests only".                              | Phone scope and period caption (owner decision). Date labels disagree (observed). Shared "locations" wording in other areas.                  |
| p5-F15 Google performance and Keywords | Refresh reports the server's counts; truncated or cap-reached walks stay "Refresh started" (R1). "Times shown". Clearer unavailable and off states.                                                                                                                                                                                                                                                                              | Captured (11, 12). `refresh-google-button.test.tsx` (cap cases), `report-loading-refresh.test.tsx`.                                                                   | Provenance sheet as a list (owner decision). R10. Reports JS budget (follow-up 29) not re-measured.                                           |
| p5-F16 Export and share                | Opt-in CSV names with scope and dates. Downloads announced. Share picker shows listing counts and a retry.                                                                                                                                                                                                                                                                                                                       | `csv-download-button.test.tsx`. The share dialog itself is p2's and was not changed.                                                                                  | Visible Share button (owner decision).                                                                                                        |

**Shared-file edits**

- `lib/api/sync.ts`: additive `ManualSyncResult` type and comment;
  `triggerReviewSync` unchanged.
- `lib/inbox/actions.ts`, `lib/inbox/reply-state.ts`: copy and a "sent"
  toast; only inbox components import them.
- Shared e2e specs, only on this area's strings: `journeys.spec.ts` (1 line),
  `touch-critical.spec.ts` (1 line), `operations-features.spec.ts` (calendar
  agenda empty copy and a comment).
- `components/reporting/*` also render the public shared report: only "this
  period" reaches it. CSV naming (`ReportExportScope`) and `comparisonNote`
  are opt-in and not used there.
- No edits to `components/ui/*`, `components/app-shell/*`, layouts,
  `app/globals.css`, `lib/workspace/terms.ts` or `lib/errors/action-errors.ts`.

**Protected behaviour**

- Nothing changed under `app/api`, `lib/server` or migrations
  (`git diff e4123d25..8da8cae2 --stat`, 74 files).
- Approval binding, publish and step-up, bulk idempotency, sync budget,
  resolve, calendar authority and report honesty each have a named component
  test and, where relevant, an e2e spec. The report marks some fixes "source
  only" (see the table above).
- Review: 0 P0, 2 P1, 7 P2, 12 P3. All P1 and P2 fixed in `8da8cae2`; P3s
  left as follow-ups.

## p6 · Settings, Team, Billing and Design system

Area-wide checks, as reported (final working tree): `pnpm verify` **passed**
(626 test files passed, 1 skipped; 8,606 tests passed, 1 skipped; ratchet
passed). `pnpm check:design` **passed** (103 base, 103 branch).
`pnpm check:contrast` **passed**. `PLAYWRIGHT_PORT=3560 pnpm test:e2e:touch`
**passed** 23 and `pnpm test:a11y` **passed** 64 (including "design-system
proof"). Area specs **passed** 99 (settings 14, billing 8, connections-oauth
5, operations-features 18, business-mode 19, foundation 14, routing 14,
forced-colors-focus 7). BEFORE and AFTER captures 93/93 each. The LLM-driven
`tests/agentic/settings.e2e.ts`: **not run** ("Needs a model provider").
Same-path reload after a workspace switch: not run. Database checks: not run.
Stripe, Google consent and revoke, email delivery: **not run**. `lci`: not run
by this area.

| Flow                                 | Key changes                                                                                                                                                                                                           | Verification status                                                                                                                                             | Follow-ups                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| p6-F01 Settings home                 | Billing-off tab title matches the h1. Settings sub-page error offers "Back to Settings".                                                                                                                              | Captured (index, viewer, billing-on, billing-off-404: "No (identical)", title only). Error boundary component-tested only.                                      | "View only" from the server capability. Security and Privacy `notFound()` path. More sheet description.      |
| p6-F02 Reply policy                  | Light surface save bar with ghost Discard. Change list uses the page's words. Status row of its own on a phone. Name locks under billing read-only. Unlisted stored zone no longer blocks other fields.               | Captured (policy, policy-dirty re-shot, viewer). Billing read-only: "component test only". `policy-form.test.tsx` updated.                                      | Admin consent checkbox. Dirty policy form plus workspace switch shows "Leave site?".                         |
| p6-F03 Workspace type                | Step-up refusal is an info note, not a permission error. Links to Clients, and to Billing only when billing is on. Server-sourced success note after reload. Condition first. Cancel disabled while switching.        | Captured (`policy-workspace-type`). Success, refusals and step-up notes component-tested only. Same-path reload: "Not run".                                     | Browser check of the same-path reload.                                                                       |
| p6-F04 Notification preferences      | No-provider caption says the administrator switches email on. Daily-summary explanation moved to "By email".                                                                                                          | Captured (owner, member). With-provider state component-tested only.                                                                                            | Bulk "Turn all email off" with Undo. `emailConfigured()` ignores `TENANT_EMAIL_ENABLED`.                     |
| p6-F05 Connect Google and return     | Next-step link only where it fits. Error copy from setup's source. "Nothing was changed." not doubled. Request id under "Details for support". Pre-consent line.                                                      | Captured (connections, error return). `connections-oauth.spec.ts` (one assertion changed) passed. Google not exercised.                                         | Setup cards (F05-4..6). Session lapse during OAuth. 403 session-switch wording.                              |
| p6-F06 Manage a connection           | Email keeps room on a phone. Dialog titles break before "@". Disconnect toast explains the 7-day keep. Errors in the dialog. Focus to the heading after a disconnect. No new Reconnect action (removed after review). | Captured (disconnect dialog). Broken rows, toasts and focus component-tested only. The 7-day line was "checked in code" and "**Not exercised against Google**". | Reconnect from a disconnected row (P1-1). Healthy-row email still wraps at 390. `SectionHeader` focus props. |
| p6-F07 Background health             | "Needs attention" list when a count is above zero. Lost manager access points to `/listings?health=attention`. Plain labels. Replay announced once.                                                                   | Captured (operations; all zeros, so the list is absent). Non-zero list and replayed rows component-tested only.                                                 | `SettingsFacts` phone layout.                                                                                |
| p6-F08 Data and privacy              | "Review text kept for" with a link to Reply policy. Plain run pills. Owner-only note for admins. Next-step copy for export and fulfil.                                                                                | Captured (privacy). Run pills and dialogs component-tested only.                                                                                                | Carry the subject into the export form. Legal hold needs a review UUID.                                      |
| p6-F09 Two-step verification         | On/Off pill with a sentence. Accurate session lines. One-off success alert after reload. Limits stated up front; tries left shown. "Setup stopped."                                                                   | Captured (security, config B). Success alert and setup steps component-tested only.                                                                             | In-app MFA remove or replace (product and security decision). D10.                                           |
| p6-F10 Billing                       | Grace and read-only states lead with a recovery alert and one action; title follows `access.reason`. Access denied says "the owner" and "Owners". Toasts from the server's answer. Focus after cancel.                | Captured (billing, canceled, admin-denied re-shot; config B). Grace, read-only and toasts component-tested only. `billing.spec.ts` passed. Stripe: **not run**. | `billing_subscription_active` copy with billing off. Skeleton. axe on grace and read-only stubs.             |
| p6-F11 Confirming a subscription     | Outcome announced. Delayed state with its own heading and "Still checking…". Load failure not called a Stripe delay. Confirmed names the plan.                                                                        | Captured (plain confirming state). Delayed and confirmed component-tested only.                                                                                 | Tab title. axe on confirming (trialing).                                                                     |
| p6-F12 Check usage                   | "Try again" on the plan card. Limit sentence at exactly full. "Change plan" for the owner. "AI reply credits" with ", N left". Announced loading.                                                                     | Captured (usage, usage-member). At-limit and errors component-tested only.                                                                                      | "Change plan" placement on a phone (remaining observation).                                                  |
| p6-F13 See the team                  | Zero-access warning line. Phone invitations as `ListRow`s. "Since …" for expired invites. "Joined" in a Details group.                                                                                                | Captured (team, member sheet, denied). Invitations and zero-access rows component-tested only.                                                                  | Palette `/team#invite`. WebKit #418 recheck. Members heading focus ring.                                     |
| p6-F14 Invite and manage invitations | "Can publish" on and disabled for Owner and Admin. Emails break before "@". Revoke-first guidance for an expired duplicate.                                                                                           | Captured (invite, invite-admin). New test asserts the exact payload with `toStrictEqual` for seven states.                                                      | P3-6 recorded as intentional.                                                                                |
| p6-F15 Change a member               | Self-demotion warns first. Owner warnings corrected. Re-render under the new role. Toasts name the person and what the server set. Focus after removal. Step-up wording by code.                                      | Captured (change role, remove dialog). Self change, toasts and focus component-tested only.                                                                     | Business-mode widen and narrow warning. Members heading focus ring.                                          |
| p6-F16 Design system                 | "Settings patterns" block with seven sub-patterns and a 13th TOC chip. Stray h2 is an h3. Lead no longer overclaims.                                                                                                  | Captured; the AFTER `design-system-settings` shot "compares positions, not the same element". a11y "design-system proof" passed.                                | TOC edge fade at 390 may hide the 13th chip.                                                                 |

**Shared-file edits**

- `components/app-shell/access-denied.tsx`: opt-in `whoCanGrant` prop. The
  default is the old literal, "Owners and admins". Only the two Billing pages
  pass it.
- `app/(dashboard)/settings/billing/page.tsx` and `confirming/page.tsx`:
  callers of that prop; owner gate unchanged.
- `lib/queries/use-connection-workspace.ts`: disconnect `onError` toast
  removed; the rest is a Prettier reflow. Only `connection-card.tsx` uses
  `disconnect`.
- `lib/settings/privacy.ts`: `retentionOrganisationLabel` labels and a `code`.
- `app/design-system/page.tsx`: import, one demo line, one TOC entry and the
  lead paragraph copy ("Not purely append-only").
  `app/design-system/nm-lists-1b-demo.tsx`: `headingAs="h3"`.
- Tests: `rc3-settings.test.tsx` copy update; `accessibility.spec.ts` comment
  only; `connections-oauth.spec.ts` one text assertion.
- New capture harness under `p6/capture/` (docs only).

**Protected behaviour**

- The diff touches no `app/api`, `lib/api`, `lib/contracts` or `lib/server`
  file. Capability, page and nav gates and flag reads are unchanged, traced to
  file and line.
- The invite payload is pinned by a new `toStrictEqual` test. Server authority
  and the session-storage flags are traced to `onSuccess`. Billing, Stripe
  return and two-step security behaviour unchanged.
- Review: 0 P0, 2 P1, 5 P2, 12 P3. P1-1 was resolved by removing the new
  Reconnect action; P1-2 and all P2s fixed; three P3s left with reasons.

## Integration conflicts and fixes

The six area branches were merged into `ux/all-flows-presence` with
`git merge --no-ff`, in the order p6, p1, p2, p5, p3, p4. **No merge had a
textual conflict.** Only two non-report files were changed by more than one
area, and git combined both areas' edits in each:

| File                                                  | Areas  | Resolution                                                                                       |
| ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| `tests/e2e/operations-features.spec.ts`               | p4, p5 | Auto-merged; both areas' assertions kept. The spec passes on the combined head (isolated suite). |
| `tests/components/operational-notifications.test.tsx` | p5, p6 | Auto-merged; both areas' cases kept. The file passes in `pnpm verify`.                           |

**No integration fixes were needed.** No area's change was dropped or
rewritten.

Some areas change the same behaviour in different files. The specs below
were run together on the combined head, and all passed:

- **p1 and p6, two-step error copy:** `auth`, `settings`, `forced-colors-focus`.
- **p3's listing frame on p4's pages:** `listings`, `verification-workspace`,
  `gbp-management-tabs`, and the isolated verification specs.
- **Deep links into the listings board from p2's hub and p6's Operations:**
  `client-hub`, `listings`, `routing`.
- **p1 and p5's shared report wording:** `reports`.
- **p2 and p6's agency name and timezone forms:** `setup`, `settings`, and
  the component tests.

Two overlaps are left as they are and listed as owner decisions, because
changing them would choose between areas:

- **"Add listings from Google" destination.** p3's `AddListingsLink` opens
  `/setup?client=<id>` with no step. Every other link uses `&step=locations`.
  Setup works either way (see item 8).
- **p4's follow-up on the moved notice.** Its first point may already be
  closed by p2's `listing` moved notice (see item 25).

### Changes outside the UI

Twelve `lib/` files changed (+345/−47, from
`git diff --stat e4123d25 HEAD -- lib`):

| Area | Files                                                                                    |
| ---- | ---------------------------------------------------------------------------------------- |
| p1   | `lib/api/auth-errors.ts`                                                                 |
| p2   | `lib/clients/health.ts`, `lib/setup/steps.ts`                                            |
| p3   | `lib/editors/gate.ts`, `lib/editors/hours-notes.ts`, `lib/editors/hours-presentation.ts` |
| p4   | `lib/server/flat-route-redirect.ts`                                                      |
| p5   | `lib/api/sync.ts`, `lib/inbox/actions.ts`, `lib/inbox/reply-state.ts`                    |
| p6   | `lib/queries/use-connection-workspace.ts`, `lib/settings/privacy.ts`                     |

Two of them change behaviour:

1. **Old flat links, signed out** (`lib/server/flat-route-redirect.ts`, p4,
   server-only). In production, a signed-out visitor to an old flat link now
   goes to `signInPathFor(<request path header>)`, so sign-in brings them
   back to the old link. This matches `app/(dashboard)/layout.tsx`,
   including its bypass when
   `NODE_ENV !== "production" || isLocalBootstrapEnabled()`. Covered by
   `tests/flat-route-redirect.test.ts`.
2. **No toast when Disconnect fails**
   (`lib/queries/use-connection-workspace.ts`, p6). Its only caller,
   `components/settings/connection-card.tsx`, shows the error in a
   `role="alert"` inside the Disconnect dialog, so nothing is lost.

The other ten change wording or add helpers only.

### Independent review fixes

An independent review of PR #262 at `2d4293a5` found no P0 or P1. Its nine
P2s were fixed on this branch after the merges:

| Finding                                                                                     | Area  | Fix                                                                                                                                                                                                                                                             | Evidence                                                                        |
| ------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| P2-1: PR body and README understated the non-UI changes                                     | all   | "Changes outside the UI" above; the integration-test note now says it was skipped here and is run by `lci`                                                                                                                                                      | This README                                                                     |
| P2-2: the resend live region was `display:none` while empty (4.1.3)                         | p1    | `empty:hidden` changed to `empty:sr-only` in `resend-confirmation-button.tsx`, so the region stays in the accessibility tree                                                                                                                                    | `sign-in-recovery.test.tsx`                                                     |
| P2-3: "Keep Google's hours" dropped focus to `<body>` (2.4.3)                               | p3    | Both Google buttons use `pending`, so they stay focusable while Google is read. After Keep succeeds, focus moves to the footer's "Editor actions" bar                                                                                                           | `hours-tab.test.tsx`: focus checks, and `publishHours` is never called          |
| P2-4: focus could be lost after deleting a post (2.4.3)                                     | p4    | The posts list owns focus after a delete: the neighbouring post, then the filter chip, then the editor frame. Base UI already restored focus when the row unmounted; the real gap was deleting the last post                                                    | `posts-list-browse.test.tsx`: 2 tests, the last-post case fails on the old code |
| P2-5: the phone bulk bar could cover the last rows (2.4.11)                                 | p4    | `bulk-operation-view.tsx` uses `<ActionBar dock statusRow>`, which measures itself and feeds the shared scroll padding                                                                                                                                          | `bulk-ux-operation-view.test.tsx`                                               |
| P2-6: "Refreshed from Google … The figures shown include this check" after a failed re-read | p5    | After the re-read, any query that failed switches the toast to a warning: "The figures couldn’t be reloaded; those shown are from the last successful load."                                                                                                    | `refresh-google-button.test.tsx`                                                |
| P2-7: a partial review sync could say "Up to date"                                          | p5    | Listings the server marks `"partial"` are counted, and the result is worded as partial. "Up to date" now says "for the listings checked". A sync that stops at its time budget is still invisible to the client; owner item for a `truncated` flag              | `sync-reviews-button.test.tsx`; the p5 report and the F08 row corrected         |
| P2-8: dismissing "Checkout was not completed" dropped focus (2.4.3)                         | p6    | Focus moves to the Subscription block, or the page heading, before the notice is removed                                                                                                                                                                        | `billing-card.test.tsx`: 2 tests                                                |
| P2-9: evidence labels                                                                       | p1–p5 | 1280 shots relabelled "top of the page only" (1280 × 860) in p1–p4; p3's cited flow notes, `REVIEW.md` and `CAPTURE-BRIEF.md` committed; p4 F15 signed-out capture relabelled (development fallback, unit-tested only); p5 R1 and R9 lines now cite their tests | The reports                                                                     |

Codex reviewed the PR at `2d4293a5` and raised one P2. If a bulk action in
the Inbox came back partly failed, it trimmed the selection the run started
with. That re-ticked rows unticked while the request was out, and dropped rows
ticked meanwhile (p5, `components/inbox/bulk-action-bar.tsx`). It now trims
the current selection; the template-reply path does the same. A new
`bulk-action-bar.test.tsx` case fails on the old code. Codex found no issues
at `8e440c05`.

One review P3 was also fixed: a fixture email on a domain like a real
venue's (`invitations-panel`) now uses `example.test`. The remaining P3s are
in the review and are not fixed here.

## Integration checks

Checks run on the combined head `a8d30444` (all six areas merged), and run
again with the same results after the independent review fixes, in the
worktree `/tmp/naba-presence-integrate`. The e2e runs used the production
build (`pnpm build`), `scripts/run-test-command.mjs` (a throwaway PostgreSQL
per run), and `ci.yml`'s placeholder secrets. No `.env*` file was present.

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                  | Result                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` (typecheck, lint, format, unit and component tests, design ratchet)                                                                                                                                                                                                                                                                                                                                                      | Pass: 645 files passed and 1 skipped; 9114 tests passed and 1 skipped (9127 after the review fixes added tests). Ratchet passed. |
| `pnpm check:design --ratchet`                                                                                                                                                                                                                                                                                                                                                                                                          | Pass (run inside `pnpm verify`)                                                                                                  |
| `pnpm check:contrast`                                                                                                                                                                                                                                                                                                                                                                                                                  | Pass: all 212 pairs, both themes                                                                                                 |
| `pnpm build`                                                                                                                                                                                                                                                                                                                                                                                                                           | Pass                                                                                                                             |
| `node tests/perf/route-js.mjs --max-chunk 70 --max-shared 400 --max-route 560`                                                                                                                                                                                                                                                                                                                                                         | Pass (exit 0)                                                                                                                    |
| `pnpm test:a11y` (`PLAYWRIGHT_PORT=3600`)                                                                                                                                                                                                                                                                                                                                                                                              | 64 passed                                                                                                                        |
| `pnpm test:e2e:touch`                                                                                                                                                                                                                                                                                                                                                                                                                  | 23 passed                                                                                                                        |
| Shared specs cited by p1, p2 and p5: `auth`, `reports`, `routing`, `setup`, `google-onboarding`, `onboarding-match-link`, `clients`, `client-hub`, `client-form-archive`                                                                                                                                                                                                                                                               | 140 passed                                                                                                                       |
| Shared specs cited by p2, p3 and p4: `listings`, `gbp-management-tabs`, `desk-quick-look`, `business-mode`, `journeys`, `touch-critical`, `verification-workspace`                                                                                                                                                                                                                                                                     | 157 passed                                                                                                                       |
| Shared specs cited by p5 and p6: `inbox`, `inbox-shallow-url`, `inbox-history`, `settings`, `billing`, `connections-oauth`, `foundation`, `forced-colors-focus`                                                                                                                                                                                                                                                                        | 75 passed                                                                                                                        |
| Isolated specs cited by p3, p4, p5 and p6 (`PLAYWRIGHT_SUITE=isolated`): `place-actions-backend`, `lifecycle-backend`, `administration-access-backend`, `administration-access-recovery`, `services-backend`, `lodging-complete-backend`, `lodging-recovery-backend`, `operations-features`, `verification-pin-backend`, `verification-pin-drift`, `verification-pin-recovery`, `verification-start-backend`, `approval-notifications` | 132 passed                                                                                                                       |

None of the e2e runs had a failure, a flaky test or a skip.

Not run at integration:

- `pnpm test:integration`: skipped here; run by the `lci` gate. p4 changed one
  server-only module (see [Changes outside the UI](#changes-outside-the-ui)).
- `tests/agentic/settings.e2e.ts` (needs a model provider; p6 also skipped it).
- The areas' screenshot capture scripts. Before-and-after evidence comes from
  each area's own run.

The full release gate (`lci`) result is recorded on the PR.

## Owner decisions and follow-ups

Collected from the six reports and de-duplicated. Nothing here was done in
this pass unless it says so.

1. **Food-menu suggestion decisions send the profile's revision** (core
   defect, recorded and not fixed). Once the counters differ, every menu
   Accept and Remove fails with `canonical_resource_stale`. (p4)
2. **Moving a listing extends access** to the target client's teammates, and
   Undo doesn't take it back. Policy question. (p2)
3. **Booking editor for a member with a publish grant**, whom the server
   refuses (pre-existing; product decision). (p3)
4. **Server-computed `canApprove`** and two-person flag on post rows, so a
   requester never sees Approve on their own post (contract change). (p4)
5. **Error boundaries that never re-fetch:** `app/(dashboard)/error.tsx` and
   `app/global-error.tsx` still call `unstable_retry ?? reset`. (p1)
6. **D10 support channel** stays deferred: the lost-authenticator line on
   two-step, Calendar's "Contact support" (LST-28), and the 2FA removal note.
   (p1, p5, p6)
7. **MFA remove or replace** is not available in the app (product and
   security decision). (p6)
8. **Setup resume and the "Add listings from Google" destination.** A
   business owner who skipped Notifications and Team reopens setup there.
   Options: open on Done, or link Listings to `/setup?step=locations`. p3 now
   opens `/setup?client=` from the board. (p2, p3)
9. **"Link it in Setup" for members** leads to Access denied; "Ask for access"
   on the denied card, which p3 raises with p4. (p2, p3)
10. **Keep the board selection across the bulk hand-off** (`?selected=` or
    seeding from `?ids=`). (p3, p4)
11. **Follow-up 27 (CLR-19):** confirm severity order for the urgent health
    chips. (p2)
12. **Follow-up 26:** confirm the Hours caption as the alternative to a time
    zone slot in the shared meta row. (p3)
13. **Follow-up 22 (DSK-05):** business-workspace breadcrumbs; needs the
    shared app shell and an owner decision for the agency trail. (p3)
14. **"locations" wording in shared files:** `lib/workspace/terms.ts`,
    `components/app-shell/scope-sheet-model.tsx`,
    `lib/reporting/unavailable-reasons.ts`, and the Activity drawer. (p3, p5)
15. **Server and `lib/` strings:** "action link" and "Place Action" (LST-31);
    `proposal_patch_invalid` says "Refresh from Google"; "merchant standing"
    in `google-verification-execution.ts`; app-wide MFA code mapping in
    `lib/errors/action-errors.ts`; 403 session-switch wording in
    `lib/setup/oauth-status.ts`. (p3, p4, p6)
16. **Shared editor footer opt-ins:** visible progress while a profile review
    is prepared, and a `where` override for "Changed on Google · saved here".
    (p3)
17. **A failed Google check is announced twice** (popover and header). (p3)
18. **Profile field errors:** `fieldErrorsFromPayload` doesn't unwrap zod
    unions, and the "Additional address details" link always targets the
    language field. (p3)
19. **Keep Google's hours:** say "Google now matches the saved hours" instead
    of the "in your draft" toast. (p3)
20. **"lifecycle" in danger-zone copy** (RC-COPY): dropped because about 27
    e2e assertions depend on it. (p3)
21. **Other listings items skipped or out of scope:** one entry point per
    saved review; special hours above service hours (hypothesis);
    `listingAttentionReason()` in the overview health strip; town search and
    chip toggling; focus after "File under…"; Activity from the failed-publish
    alert; "Use Google's version" and leave guards; keeping Google's version
    for `conflict`; menu-item attributes; "Withdraw invitation" wording;
    per-code preflight messages and an account picker; a real result on saved
    booking rows; People pill and doubled read-only banner. (p3)
22. **Post provenance** (made on Google or here) needs a real field. (p4)
23. **Composer:** dates for events and offers (hypothesis); server dedupe for
    a second draft after a lost save (L10); consent wording under the
    two-person policy (owner decision). (p4)
24. **Verification:** unknown business type forces a private address (owner
    decision; a unit test pins current behaviour); address codes behind "More
    address details"; a PIN typed before hydration; a typo on re-entry forces
    a new review (owner decision). (p4)
25. **Old flat links:** `/clients` lacked `moved=listing` copy and shows the
    banner above empty states; business mode with several locations drops
    `moved` and the query. p2 reports that `/settings/listing` now gets a
    named moved notice; check whether that closes the first point. (p4)
26. **Activity cursor regex** lacks `bulk:` and `schedule:`
    (`lib/contracts/location-activity.ts`). (p4)
27. **Inbox and Reports owner decisions:** save path for edit-only users;
    auto-advance after "No reply needed"; desk "Sync" label; initial focus on
    the resolve confirm; visible Share button; phone scope and period caption;
    rating readout and "—" tile reasons; provenance sheet as a list; hotkey
    dialog and J. (p5)
28. **Pull-to-refresh** (follow-up 25): needs shared shell and CSS changes and
    spends the manual sync limit. (p5)
29. **Blocked:** honest wording for an auto-retried publish needs an API
    field. (p5)
30. **p5 review P3s R10 to R21**, and observed issues not changed: an unknown
    `clientId` silently drops to All clients; disagreeing Reports date labels;
    "Notification settings" twice; the bulk bar could pass the assignee name.
    (p5)
31. **Performance budgets (follow-up 29):** Reports first-load JS not
    re-measured; p5 adds about 1.6 KB (gzip upper bound) to `/reports`, "a
    risk to the budget". People mobile LCP and JS budgets. (p3, p5)
32. **Auth items:** `?from=reset` context on two-step (needs the server's save
    order); resend cooldown; carrying the invitation through a failed
    confirmation redirect (route change, owner decision); `apiFetch` network
    errors for reads (`lib/api/client.ts`); dark-mode printing; phone legal
    contents length. (p1)
33. **Shared report:** public wording for `PartialCoverageAlert` (owner:
    Reports, p5's area); rate deltas shown as percentages are percentage
    points (shared formatter). (p1)
34. **Setup items:** sign-in confirmation and location-limit warning ignored
    after OAuth return; import progress polling (`lib/queries/use-backfill.ts`);
    a Stepper mark for preamble steps; blocked-Continue focus needs an id prop
    on `AgencyNameForm`; two primary buttons on the import step. (p2)
35. **Setup cards seen from Settings** (F05-4..6): listing-name wrap and a
    bulk-link summary, backfill cancel error and reconnect link,
    account-picker empty state. p2 also changed these cards. (p6)
36. **Google connections:** a proper Reconnect from a disconnected row, with
    relinking guidance (P1-1); session lapse during OAuth has no way back;
    healthy-row email wrap and pill alignment at 390; `SectionHeader` focus
    props. (p6)
37. **Settings items:** palette `/team#invite`; bulk "Turn all email off";
    export subject carry; `emailConfigured()` ignores `TENANT_EMAIL_ENABLED`;
    legal hold needs a review UUID; WebKit #418 on Team loading; dirty policy
    form plus workspace switch; Members heading focus ring; `areas.ts`
    description, More sheet description, `SettingsFacts` phone layout, "View
    only" from the server, Security and Privacy `notFound()` path, F15
    business-mode warning, F02 admin consent checkbox, F11 tab title and F10
    skeleton; "Change plan" placement and the design-system TOC fade. (p6)
38. **Other review leftovers:** double polite announcements on verification
    field errors; a possible missed `finalFocus` after a fast post-delete
    refetch. (p4)
39. **Test gaps:** no e2e for board search and no-match, Keep Google's hours,
    the overnight hint or a menu edit (p3); four p5 review fixes (R2, R3,
    R5 and R6) are "source only" (p5); axe on billing confirming, grace and read-only,
    a long-email route mock, a foundation check for the Settings chip, and a
    browser check of the same-path reload (p6). (p3, p5, p6)
40. **Fixture gaps:** setup's Notifications, Team and Done screens unreachable
    (p2); no photos or suggestions, and always verified (p4); no
    notifications, scheduling off, no reply, bulk or approval rows (p5); no
    invitations, zero-access member, non-zero operations counts, retention
    cycle or paid subscription (p6). (p2, p4, p5, p6)
41. **Visual harness:** the `naba_visual` database is missing from the shared
    local Supabase. Recreate it, or document or script the throwaway-cluster
    route in `tests/visual/`. p5 and p6 worked around the same gap. (p2,
    p3, p4)
42. **Provider-backed and real-device checks:** no area ran real Google,
    Supabase Auth, Stripe or email journeys. p1, p3 and p5 also list
    real-device VoiceOver and TalkBack as not run. (p1, p2, p3, p4, p5, p6)
