# Area p2: onboarding, setup and clients, before and after

Status: **implemented and partially verified**. The evidence is source, unit,
component and fixture-browser (Playwright against a throwaway PostgreSQL
cluster and the Google stub). Nothing was published to Google, and no
provider-backed journey (real Google OAuth, real Business Profile accounts)
was run. A fixture test is not proof of the live journey. See
[Verification](#verification).

## Scope and baseline

**Routes.** `app/(dashboard)/setup`, `clients`, `clients/new`,
`clients/[clientId]`, `clients/[clientId]/settings`, and the components they
render: `components/setup/*`, `components/clients/*`, `lib/setup/*`,
`lib/clients/*`, plus four `components/settings/*` cards whose only caller
is a setup step (see [Shared-file edits](#shared-file-edits)).

**Baseline.** Branch `ux/flows-presence-p2`, cut from
`origin/ux/all-flows-presence` at `e4123d25` (after the responsive pass, #258),
in the isolated worktree `/tmp/naba-presence-p2`.

**Environment.**

- Visual harness: `tests/visual/fixture-server.ts` + `next dev --turbopack`
  on 3200/3201 (the repo's `visual-fixtures` / `visual-app` pair), held under
  `/tmp/naba-presence-visual.lock`.
  - The shared local Supabase cluster has no `naba_visual` database. Rather
    than create and migrate one on shared infrastructure, the harness ran on
    a throwaway `scripts/ci/postgres.mjs` cluster with a `naba_visual`
    database, migrated with `scripts/db-migrate.mjs` and given the runtime
    role. The wrapper lives outside the repo (`/tmp/p2-visual/cluster-up.sh`).
- e2e and a11y: `scripts/run-test-command.mjs e2e` on `PLAYWRIGHT_PORT=3520`
  (stub 3521), each run on its own throwaway cluster, against a production
  build (`pnpm build`).
- Fixtures: the seeded "Sprint 5 Journey tenant", client "Journey
  Hospitality", two stub listings and a stub Google login
  (`stub@example.test`). No real people, phones, emails or tokens appear.
- Viewports: 390 (light and dark, touch, Chromium) and 1280 (light), full
  page, reduced motion. Full-page captures draw fixed bars (tab bar, docked
  action bar) mid-image, and the round "N" bottom-left is the Next dev
  indicator: capture artefacts, not friction.

### Flows

The routes support these user tasks. Each had its own analysis subagent
(baseline, friction and proposals), and the analyses are kept in
`research/naba-presence-all-flows-2026-10-28/p2/flow-p2-F*.md`.

| ID     | Flow                                      | Start                                                                    | End (server-confirmed)                                                    | Roles                                    |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------- |
| p2-F01 | Choose what to set up                     | `/setup` with no `?client=` (Listings "Add listings from Google", menus) | A wizard opens for the chosen client, or `/clients/new`                   | owner, admin (others: Access denied)     |
| p2-F02 | Create a client                           | `/clients/new` (`?listing=` variant from a listing)                      | 201 from `POST /api/clients`, then the wizard at Connect (or the listing) | owner, admin                             |
| p2-F03 | Wizard frame; confirm agency or business  | `/setup?client=…` (resumes at the server's `nextStep`)                   | Agency name and timezone saved; Continue moves on                         | owner, admin                             |
| p2-F04 | Connect Google                            | Wizard step `connect`                                                    | A Google login attached to the client (`?google=connected` on return)     | owner, admin                             |
| p2-F05 | Choose the Business Profile accounts      | Wizard step `account`                                                    | At least one account switched on                                          | owner, admin                             |
| p2-F06 | Link the client's listings                | Wizard step `locations` (plus "Find your business on Google" drafts)     | At least one listing linked                                               | owner, admin                             |
| p2-F07 | Import review history                     | Wizard step `backfill`                                                   | The import is queued or running (it continues in the background)          | owner, admin                             |
| p2-F08 | Optional Notifications and Team; Done     | Wizard steps `notifications`, `team`, `done`                             | Done shows the state the server reports                                   | owner, admin                             |
| p2-F09 | Find a client and see what it needs       | `/clients`                                                               | The client's hub opens (or a filtered list)                               | all agency roles; New client owner/admin |
| p2-F10 | Client hub: see a client's status and act | `/clients/[clientId]`                                                    | The inbox, listing or settings it points to opens                         | all who can see the client               |
| p2-F11 | Edit a client's details                   | `/clients/[clientId]/settings#details`                                   | `PATCH` 200; "Client updated"                                             | owner, admin                             |
| p2-F12 | File, move and unfile a client's listings | Settings › Listings                                                      | The assign or unassign request answers 2xx; Undo is offered               | owner, admin                             |
| p2-F13 | Archive and restore a client              | Settings › Archive; Clients › Archived                                   | Archive confirmed by a re-read; Restore 200                               | owner, admin                             |

"Share a client's report" (hub › More) opens `share-report-dialog.tsx`,
which Reports (area p5) also uses, and the public report is area p1's. It was
observed only, and not changed.

### Protected core rules (derived from the code)

1. Setup, New client, client settings, archive and restore are owner and
   admin only. Others get `AccessDeniedPage`
   (`app/(dashboard)/setup/page.tsx`, `clients/new/page.tsx`), and the
   UI-level `canManage` checks in the hub and index stay as they are.
2. A `?client=` or `[clientId]` that is malformed, not visible to the session,
   or archived is a 404. Nothing reveals that an id exists or what its name is
   (`clientVisibilityPredicate`, `readVisibleClient` in
   `clients/[clientId]/layout.tsx`).
3. A business workspace has no client layer
   (`redirectOutOfClientLayer`): setup runs for its one home client, and
   setup copy never says "client" or "agency" (`BUSINESS_OVERRIDES` in
   `lib/setup/steps.ts`).
4. Setup's step is computed from server facts (`resolveStep`, the server's
   `nextStep`). A step the data hasn't reached cannot be opened.
5. Google OAuth start, the attach request, the `?google=` return parameters
   and account discovery are unchanged. Discovery is rate limited, so a retry
   is one request.
6. Creating a client: the API's `409 client_name_taken` uniqueness check
   (archived clients included), the landing at the wizard, and the
   `?listing=` variant returning to the listing without filing it.
7. The agency timezone save sends the whole policy object (`saveSettings`),
   so the reply policy can't change by accident.
8. Review import: starts are scoped to the client's linked listings
   (`maxPagesPerLocation: 10`), and the server refuses to cancel a running
   batch (409).
9. Archive: the server needs `detachLocations` when listings are filed, and
   archiving is confirmed by a re-read (`archiveConfirmed`). Undo is a
   restore followed by a re-file (`grantToClientMembers: false`). A later
   restore from Clients › Archived does not re-file.
10. Unfile and move change only which client a listing is filed under. The
    Google link and reviews stay.
11. Server authority: a success toast or completed state appears only after a
    2xx. Health is computed on the server (`lib/server/clients.ts`), and
    `lib/clients/health.ts` only maps it to words.
12. Idempotency: Undo, Create and Start each send one request per intent.

### Prior audit (15 Oct) status for these routes

Already fixed on the baseline and not redone: CLR-13 (except the link to the
cause), CLR-14, CLR-15, CLR-16, CLR-17, CLR-18, CLR-20, CLR-21, CLR-22,
SET-12, DSK-10 and DSK-11 (`results.md:250-298`). Still open on the baseline:

- **CLR-13 remainder:** the hub's "Needs attention" didn't link to its cause.
  Done here (F10).
- **CLR-19 remainder (follow-up 27):** the urgent health chips are in
  severity order, not count order. Decision proposed here (F09); it needs
  the owner's confirmation.
- CLR-05 and CLR-06 remainders are in Reports (area p5), not here.

## Before

BEFORE screenshots: [`evidence/before/`](evidence/before/), 15 states × 3
(390 light, 390 dark, 1280 light). The friction below comes from those
screenshots and from code; untested ideas are marked as hypotheses.

| #   | Flow | Observation                                                                                                                                                                                                                                                                                           | Evidence                                                                                |
| --- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| B1  | F01  | Only the 5 newest unfinished clients were listed (`.slice(0, 5)`). A sixth was in neither list, so the chooser couldn't reach it.                                                                                                                                                                     | `setup/page.tsx:158` at `e4123d25`                                                      |
| B2  | F01  | A full-size "Nothing waiting" empty state pushed **New client** below the fold at 390.                                                                                                                                                                                                                | `01-setup-chooser-390-light`                                                            |
| B3  | F02  | A duplicate name (409 `client_name_taken`) showed "This changed since you loaded it. Refresh and try again", which loses the input and fails again.                                                                                                                                                   | `client-form.tsx`; API route                                                            |
| B4  | F02  | A dropped connection or untyped 500 still said "Nothing was added", although the client may already exist.                                                                                                                                                                                            | `client-form.tsx`                                                                       |
| B5  | F02  | The docked bar's status was cut off at 390 ("…the client doesn’t touch…").                                                                                                                                                                                                                            | `02-new-client-390-light`                                                               |
| B6  | F03  | An unsaved agency name was dropped on Continue, and an unsaved timezone on a rail link or Finish later.                                                                                                                                                                                               | `setup-wizard.tsx`, `step-agency.tsx`                                                   |
| B7  | F03  | The rail renumbered on the Agency screen (Agency 1, Import reviews 6), while every other screen said "Step 4 of 6 · Import reviews".                                                                                                                                                                  | `15-setup-agency-*` vs `03-setup-wizard-resume-*`                                       |
| B8  | F03  | The refused-step note ("…hasn’t reached “Team” yet, so setup opens at …") said what happened but not what to do, and the refused `?step=` stayed in the address.                                                                                                                                      | `09-setup-team-390-light`                                                               |
| B9  | F04  | A link-glyph tile floated between the saved login and "Or sign in with another Google account", whose heading outranked the faster path. The client's own login looked like any other.                                                                                                                | `04-setup-connect-390-light`                                                            |
| B10 | F04  | After a cancelled sign-in, a blue redirect note sat above the red "Google didn’t connect" alert.                                                                                                                                                                                                      | `setup-wizard.tsx:447` (code)                                                           |
| B11 | F05  | The info callout repeated the step description. The load error was drawn as a neutral empty state, not announced. No accounts was a dead end. Roles showed raw `PRIMARY_OWNER`.                                                                                                                       | `05-setup-account-*`; `account-picker-card.tsx`                                         |
| B12 | F06  | One failed accounts load showed two messages: "Choose a Google account" (wrong) at the top and "Google accounts didn’t load / Retry accounts" lower down. The listings load had no label and its failure looked like "no listings".                                                                   | `06-setup-listings-390-light`; `import-card.tsx:178-213`                                |
| B13 | F07  | After Start import, the footer kept saying "Start the review import to continue" (setup wasn't re-read). Start was a small secondary button under a dominant (blocked) Continue. Cancel showed on running rows, which the server refuses, and the error was never shown. "Retry it" named no control. | `07-setup-backfill-*`; `use-backfill.ts`, `backfill-card.tsx`                           |
| B14 | F08  | Notifications needs a Pub/Sub topic and never said so; its heading duplicated the card's. "Skip for now" didn't re-read setup, so Done could show stale state. Done still offered "Finish later".                                                                                                     | `step-notifications.tsx`, `setup-wizard.tsx:539` (code; steps not reachable in fixture) |
| B15 | F09  | Row note "Listing areas have not been compared" was jargon. An empty "In sync" result used the green all-clear tone. `/settings/listing` got the generic moved notice.                                                                                                                                | `11-clients-index-*`; `lib/clients/health.ts:485-488`                                   |
| B16 | F10  | Two stacked pills ("Not checked" over a green "Connected"). Phone listing cards showed a lone "·" line. The status had no link to its cause (CLR-13). The login line could show "Connected" above a "needs reconnecting" alert for a different login.                                                 | `13-client-hub-*`; `client-hub.tsx`                                                     |
| B17 | F11  | After Save, the form flashed back to "Unsaved changes" until a background refetch, and a false leave prompt was possible. Focus dropped to the page top when the save bar unmounted.                                                                                                                  | `client-settings.tsx`, `use-clients.ts` (code)                                          |
| B18 | F12  | "Remove" under a green "Linked" pill read as "unlink from Google". The empty state's "Add one from the unfiled list below" contradicted "Every imported listing is filed" under it.                                                                                                                   | `14-client-settings-*`                                                                  |
| B19 | F13  | A ~60px blank gap above a centred red "Archive …" in the Archive card. Undo stayed tappable and could send a second restore and re-file. The copy implied Restore re-files, and the archived page said listings were "kept but hidden". A Details save relabelled the archive button "Archiving…".    | `14-client-settings-*`; `settings-row.tsx:731` (`mt-8`); `client-settings.tsx`          |

Hypotheses, not measured:

- H1: showing every waiting client and keeping New client on screen shortens
  the way to "start setup" for agencies with many new clients.
- H2: naming what is unsaved and what to do next (refused step, import)
  reduces dead-end taps on Continue.
- H3: "Unfile" with the reassurance line reduces fear of losing a Google link.

No completion times, tap counts or abandonment figures were measured for this
report.

## After

The flows, their steps, their required inputs and their success destinations
are unchanged. What changed is what each screen says and shows at each state,
which control leads, and what happens to focus and state after a server
answer.

- **F01, chooser:** every waiting client is listed (up to the query's 200). When
  nothing is waiting, the card is one line ("Nothing waiting. …"), so New
  client stays near the top. A business that isn't ready yet gets a "Try
  again". The loading label is "Loading setup", with no "client" for
  businesses.
- **F02, new client:**
  - A duplicate name is an error on the name field, focused, which clears on
    edit: "There’s already a client called “X”. Archived clients count too…".
  - An unconfirmed failure says "We couldn’t confirm the client was created",
    and tells you to check Clients first.
  - A definite 5xx keeps "Nothing was added" and no longer blames Google.
  - The bar reads "Nothing is sent to Google.", and Create stays pending
    through the navigation, so there's no double submit.
  - The swatch tick is readable in dark mode.
- **F03, wizard frame:**
  - Continue's blocked reason names the unsaved agency name and/or timezone.
    The timezone has its own leave guard, and the leave prompt names both
    edits when both are unsaved.
  - Agency and Client are unnumbered on every screen, so Import reviews is
    always 4.
  - The refused-step note reads "“Team” opens once “Import reviews” is done,
    so setup continues here". The address is rewritten to the step shown, and
    the note clears when you leave that step.
- **F04, connect:**
  - The client's current login is first, as "Keep using this account ·
    Connected to {client}", and runs the same attach.
  - No orphan glyph. The two sections are peers under a divider.
  - No empty "already connected" section when there are no logins.
  - No blue note over a Google error.
  - Continue is secondary while it's blocked on Connect.
- **F05, accounts:**
  - The duplicate callout is gone; its sense is now in the step description.
  - The load error is an announced error with "Nothing was changed.", and
    "Try again" (with a "Trying again…" state) sits outside the alert.
  - No accounts: "This Google login has no Business Profile accounts", with
    a "Use another Google login" button back to Connect.
  - Roles read Owner, Primary owner, Manager, Site manager.
- **F06, listings:**
  - Accounts loading, error and empty are three distinct states at the top,
    and one retry serves both sections.
  - The drafts section no longer repeats the alert.
  - The listings load is labelled "Finding listings on Google…", and its
    failure is announced.
  - A failed background reload keeps already-loaded listings usable.
  - "Choose accounts" appears in the dead-end states.
  - The repeated h2 became an h3, "Listings on Google".
- **F07, import:**
  - Start re-reads setup when it settles, so the footer clears.
  - Start is primary while nothing has started; its id lets a blocked
    Continue focus it.
  - Cancel only on queued rows, and cancel errors are shown.
  - The button reads "Retry import" after failures. Row reasons and the
    blocker say "import again", so they agree whichever label shows.
  - "Attempts 0" is hidden, and "you can carry on" is said once, only while
    something is in flight.
- **F08, finishing:**
  - Notifications says it's optional and needs a Pub/Sub topic. The step
    title is now "Get new reviews as they arrive", so it no longer duplicates
    the card heading.
  - Skip re-reads setup before moving on.
  - Done has no "Finish later".
- **F09, index:**
  - Row notes read "Not compared with Google yet". An empty "In sync" result
    is neutral, not green.
  - `/settings/listing` gets a named moved notice.
  - The chip order stays in severity order, with the rationale in code
    (proposed decision for follow-up 27).
- **F10, hub:**
  - A "cause" link follows the status sentence: "Open <listing>" for one, the
    Listings board filtered by client and health for several, or "See which
    listings below".
  - A healthy login is plain text; pills only for problems.
  - Phone cards have no empty "·" line, and non-calm facts are in the address
    line.
  - The login line names the login the alert is about.
- **F11, details:**
  - A confirmed save writes the server's client into the cache before the
    toast, so the bar clears at once.
  - Focus moves to the Details heading after Save or Discard.
  - An archived or missing client in settings says so, with links to
    Archived clients and All clients.
- **F12, listings in settings:**
  - "Unfile" (named "Unfile <listing>", pending "Unfiling…") with the line
    "Unfiling or moving a listing keeps its Google link and reviews."
  - The empty state no longer contradicts itself.
  - Undo runs once, shows its progress, and errors name the listing and
    action.
- **F13, archive:**
  - No gap; the button and footnote are left-aligned in the card.
  - Undo runs once and closes the toast. A confirmed restore with a failed
    re-file now says so ("X is restored, but its listings weren’t filed
    back").
  - The copy says only Undo re-files the listings, and the archived page says
    the listings were unfiled.
  - The archive button has its own pending state.
  - A failed listings load no longer leaves "Checking attached listings…"
    forever.

### Screenshot pairs

Same harness, fixture tenant and route for both. The fixture is re-seeded per
run, so ids differ. See [`evidence/after/`](evidence/after/).

AFTER_PAIRS_PLACEHOLDER

## Change log

| Change                   | Before                                                         | After                                                                   | Reason                                    | Relevant principle                         | Affected files                                                                                           |
| ------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| F01 all waiting clients  | 5 newest only                                                  | All (query cap 200)                                                     | Unreachable clients                       | Nielsen: user control; HIG: familiarity    | `app/(dashboard)/setup/page.tsx`                                                                         |
| F01 compact all-clear    | Full empty state, New client below fold                        | One-line status                                                         | Primary action in reach                   | HIG: hierarchy                             | `app/(dashboard)/setup/page.tsx`                                                                         |
| F01 business not ready   | Dead end                                                       | "Try again"                                                             | Recovery                                  | Nielsen: recover from errors               | `app/(dashboard)/setup/page.tsx`                                                                         |
| F01 loading label        | "Loading client setup"                                         | "Loading setup"                                                         | Business wording                          | Nielsen: match the real world              | `app/(dashboard)/setup/loading.tsx`                                                                      |
| F02 duplicate name       | Generic "refresh" alert                                        | Field error, focused, clears on edit                                    | Recoverable in place                      | Nielsen: error recovery; WCAG 3.3.1, 3.3.3 | `components/clients/client-form.tsx`                                                                     |
| F02 unconfirmed failure  | "Nothing was added"                                            | "We couldn’t confirm…", check Clients                                   | Truthful status                           | Nielsen: visibility of system status       | `components/clients/client-form.tsx`                                                                     |
| F02 bar text, pending    | Truncated; re-submittable                                      | "Nothing is sent to Google."; pending through navigation                | Legibility; no duplicates                 | HIG: clarity; Nielsen: error prevention    | `components/clients/client-form.tsx`                                                                     |
| F02 swatch tick          | Low contrast in dark                                           | `text-ink-on-charcoal`                                                  | Contrast                                  | WCAG 1.4.11                                | `components/clients/client-colour-field.tsx`                                                             |
| F03 unsaved agency edits | Silently dropped                                               | Named blocker, timezone leave guard, combined prompt                    | Prevent loss                              | Nielsen: error prevention                  | `setup-wizard.tsx`, `step-agency.tsx`, `components/settings/agency-name-form.tsx`                        |
| F03 numbering            | Renumbered on Agency                                           | Preamble unnumbered everywhere                                          | Consistency                               | HIG: consistency                           | `components/setup/setup-wizard.tsx`                                                                      |
| F03 refused step         | Unclear note; stale URL                                        | Actionable note; URL rewritten; note clears on leave                    | Clarity; preserved context                | Nielsen: help users recognise              | `components/setup/setup-wizard.tsx`                                                                      |
| F04 connect layout       | Orphan glyph; heading hierarchy inverted; own login unlabelled | Peers under divider; "Keep using this account" first                    | Hierarchy                                 | HIG: hierarchy; Nielsen: recognition       | `components/setup/step-connect.tsx`, `setup-wizard.tsx`                                                  |
| F04 alerts               | Blue note over red error                                       | Red error only                                                          | One message per cause                     | Nielsen: minimalist design                 | `components/setup/setup-wizard.tsx`                                                                      |
| F05 account states       | Repeated callout; neutral error; dead end; raw roles           | Error announced; escape to Connect; plain roles                         | Recovery; plain words                     | Nielsen; WCAG 4.1.3                        | `step-account.tsx`, `components/settings/account-picker-card.tsx`, `lib/setup/steps.ts`                  |
| F06 listing states       | Two messages for one failure; unlabelled load                  | One message + retry; labelled load; failures announced; stale data kept | Truthful status                           | Nielsen: visibility of status; WCAG 4.1.3  | `components/settings/import-card.tsx`, `onboarding-drafts.tsx`, `step-locations.tsx`, `setup-wizard.tsx` |
| F07 import               | Blocker stuck after Start; weak Start; dead Cancel; "Retry it" | Setup re-read; primary Start; Cancel only when allowed; agreeing copy   | Status matches server                     | Nielsen: status, consistency               | `components/settings/backfill-card.tsx`, `step-backfill.tsx`, `lib/setup/steps.ts`, `setup-wizard.tsx`   |
| F08 finishing            | Unexplained requirement; stale Done; "Finish later" on Done    | Requirement stated; re-read on Skip; no Finish later                    | Clarity; server authority                 | Nielsen: match the real world              | `step-notifications.tsx`, `setup-wizard.tsx`, `lib/setup/steps.ts`                                       |
| F09 index words          | "Listing areas have not been compared"; green empty "In sync"  | "Not compared with Google yet"; neutral tone                            | Plain language                            | Nielsen: match the real world              | `lib/clients/health.ts`, `components/clients/clients-index.tsx`, `health-filter.tsx`                     |
| F10 hub                  | No cause link; pill stack; lone "·"; mismatched login line     | Cause link; pills for problems only; phone facts inline; login named    | Hierarchy; recognition                    | HIG: hierarchy; Nielsen                    | `components/clients/client-hub.tsx`, `lib/clients/health.ts`                                             |
| F11 details save         | Dirty flash; false leave prompt; focus lost                    | Cache settled from reply; focus to heading; unavailable state           | Server-confirmed state; focus order       | WCAG 2.4.3; Nielsen: status                | `components/clients/client-settings.tsx`                                                                 |
| F12 filing               | "Remove"; contradictory empty state; repeatable Undo           | "Unfile" + reassurance; consistent empty state; Undo once with progress | Prevent misunderstanding; idempotent Undo | Nielsen: error prevention                  | `components/clients/client-settings.tsx`                                                                 |
| F13 archive              | Gap; repeatable Undo; inaccurate copy; shared pending          | Aligned; Undo once with split outcome; accurate copy; own pending       | Truthful outcome                          | Nielsen: status; HIG: feedback             | `components/clients/client-settings.tsx`, `app/(dashboard)/clients/[clientId]/layout.tsx`                |

## Core preservation

- **No route handler, API contract, SQL, migration, schema, flag or
  dependency changed.** `git diff --stat` touches only `app/(dashboard)/…`
  pages and layout, components, `lib/setup/steps.ts`,
  `lib/clients/health.ts` (presentation mapping and a new `healthCause()`
  helper over data the hub already receives) and tests.
- **Role gates and visibility:** unchanged. The setup page's role check and
  404s, and the layout's visibility read and archived state, have the same
  conditions. Only the archived page's copy changed.
- **Google:** the OAuth start, attach request and return handling are the
  same. "Keep using this account" reorders and relabels the existing
  attach row, using the connection id already in the setup payload.
- **Server authority:**
  - The Details form now settles from the PATCH's own 2xx reply.
  - Archive still waits for the re-read.
  - Undo of an archive reports the restore and the re-file separately, and
    says "restored" only after the restore's 2xx.
  - New-client copy says "Nothing was added" only on a definite refusal.
- **Idempotency:** Undo (archive, unfile, move) now runs once per toast
  through the house `showToast({ kind: "local", undo })` helper, where it
  could run twice before. Create stays pending through the navigation.
  - Unit evidence: "runs the archive's Undo once, however often it is
    tapped", and the double-tapped unfile Undo sends one POST.
- **Import:** Start sends the same scoped request. Cancel is offered only
  where the server accepts it (queued rows).
- **Business wording:** no new setup copy says "client" or "agency" in
  business mode. The covering tests are the `setup-wizard.test.tsx`
  business cases and the `step-connect` "your business" label.
- Unit and component tests cover each changed behaviour (listed per group in
  `research/…/p2/` and in the diff).

## Verification

| Check                                                                                                                                        | What it is                                 | Result                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| `pnpm verify` (typecheck, lint, format:check, unit + components, design ratchet)                                                             | Source + unit/component                    | **Passed**: 625 files, 8,528 tests passed, 1 skipped; ratchet passed |
| `pnpm check:design --ratchet`                                                                                                                | Source                                     | **Passed**: no file/rule count rose                                  |
| `pnpm check:contrast`                                                                                                                        | Source (token pairs)                       | **Passed**: all 212 pairs, both themes                               |
| Area e2e: `setup`, `google-onboarding`, `onboarding-match-link`, `clients`, `client-hub`, `client-form-archive`, `routing`, `touch-critical` | Fixture browser, throwaway DB, Google stub | **Passed**: 122/122 on the final head (`aab3be1f`)                   |
| `pnpm test:e2e:touch` (touch-390)                                                                                                            | Fixture browser                            | **Passed**: 23/23 on the final head                                  |
| `pnpm test:a11y` (`accessibility.spec.ts`, axe)                                                                                              | Fixture browser                            | **Passed**: 64/64 on the final head                                  |
| Screenshots 390 light, 390 dark, 1280 (`tests/visual/shoot.mjs`)                                                                             | Fixture browser                            | BEFORE **Passed**; AFTER see [Screenshot pairs](#screenshot-pairs)   |
| Independent review (fresh-context subagent, diff + protected list)                                                                           | Review                                     | **Done**: 0 P0, 0 P1, 3 P2 (all fixed), P3s fixed or recorded below  |
| Live Google OAuth, real Business Profile accounts, real import                                                                               | Provider-backed                            | **Not run** (out of scope; no provider calls from tests)             |
| `audit:mobile` totals, tap counts                                                                                                            | Measurement                                | **Not run**: no measured-improvement claims are made                 |

The e2e changes: `client-form-archive.spec.ts` "refused create" now stubs a
definite 503, and a new case checks the unconfirmed-500 copy. Both pass.

### Review response

| Finding                                                                           | Severity | Outcome                                                                                                |
| --------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| Archive Undo said "wasn’t restored" when only the re-file failed                  | P2       | Fixed: split outcomes plus a unit test                                                                 |
| A failed background reload of accounts hid usable listings                        | P2       | Fixed: the error shows only without data (both sections), plus a unit test                             |
| Import button, row reasons and blocker disagreed                                  | P2       | Fixed: rows and blocker name the action ("import again"), not a label                                  |
| The refused-step note could reappear after rail navigation                        | P3       | Fixed: it clears when you leave its step                                                               |
| The leave prompt named one of two unsaved edits                                   | P3       | Fixed on the timezone prompt (names both). The name form's own prompt is shared code and unchanged     |
| A blocked Continue with only the name unsaved focuses step content, not Save name | P3       | Not fixed: needs an id prop on the shared `AgencyNameForm`. Focus lands in the step, next to the field |
| "Accounts" wording, missing "Nothing was changed." in the import card error       | P3       | Fixed                                                                                                  |
| "Every imported listing is filed" when nothing is imported                        | P3       | Fixed: "There are no unfiled listings to add…"                                                         |
| Two primary buttons on the import step (Start + Continue)                         | P3       | Recorded: the wizard's Continue treatment is shared by every step                                      |
| `AgencyNameForm` cleanup relies on a stable callback                              | P3       | Recorded: the one caller passes a stable `setState`                                                    |

## Shared-file edits

All are additive and opt-in, with default behaviour unchanged for other
callers:

- `components/settings/agency-name-form.tsx`: an optional `onDirtyChange`
  prop. It is also used by `components/settings/policy-form.tsx` (area p6),
  which doesn't pass the prop, so nothing changes there.
- `components/settings/account-picker-card.tsx`,
  `components/settings/backfill-card.tsx` and
  `components/settings/import-card.tsx` live under `settings/`, but their
  only callers are setup steps (`step-account`, `step-backfill`,
  `step-locations`). New props: `onChooseAnotherLogin`, `onStartSettled`,
  `inFlightNote`, `onChooseAccounts`.
- `components/setup/onboarding-drafts.tsx` was not Prettier-clean on the
  base. `format:check` covers changed files, so the whole file was
  formatted, and most of its diff is formatting.
- **Not edited:** `components/ui/*` (stepper, table and settings-row; the
  archive gap is fixed with an area-local override on
  `[data-slot=settings-destructive]`), `components/app-shell/*`,
  `app/globals.css`, `lib/queries/*` and `share-report-dialog.tsx`.

## Outcome and follow-ups

Thirteen flows were improved, and their analyses, implementations, review and
gates are complete on fixtures. Verification is partial: provider-backed
journeys weren't run, interactive error states are covered by unit and
component tests rather than screenshots, and Notifications, Team and Done
couldn't be reached in the fixture (the import isn't started there).

Follow-ups (not done; some need an owner decision):

1. **Follow-up 27 (CLR-19):** the owner should confirm that severity order
   replaces count order for the urgent health chips (rationale in
   `lib/clients/health.ts`).
2. **Setup resume after skipped optional steps (F08 P1-3):** a business owner
   who skipped Notifications and Team reopens setup there. Two possible
   fixes: open on Done when the resume point is optional and no step was
   asked for, or change Listings' "Add listings from Google" links to
   `/setup?step=locations` (`add-listings-link.tsx`, `tab-states.tsx`, area
   p3/p4).
3. **Moving a listing extends access** to the target client's teammates, and
   Undo doesn't take it back (F12). This is a policy question for the owner.
4. **Fresh sign-in confirmation and the location-limit warning** are ignored
   after OAuth return (F04 P3), and a reload re-shows an old error.
5. **Import progress polling while Start runs** (F07 P2) needs
   `lib/queries/use-backfill.ts`, a shared file.
6. **Shared Stepper:** an opt-in mark for unnumbered preamble steps. Today
   the current preamble shows the flag icon.
7. **"Link it in Setup" for members** (`components/locations/tab-states.tsx`)
   leads to Access denied (area p3/p4).
8. **The visual harness's `naba_visual` database** doesn't exist on the
   shared local Supabase. Document the throwaway-cluster route, or provision
   it, in `tests/visual/`.
