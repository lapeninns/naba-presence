# Redesign route checklist: the operator's desk

Status: working record, 2026-09-23. The identity it implements is
`docs/specs/2026-09-23-operators-desk-identity.md`.

This checklist is built only from the reports the implementing agents
returned: a builder report and an independent verifier report per route
family, except for the shell, auth and system pages and the foundation, which
had a builder report only. Where a verifier report exists, its verified and
not-verified states are the ones listed. Nothing here was re-run while
writing it. Where a report does not say a state was checked, it is listed as
not verified.

## How the routes were verified

- **App under test:** a fixture app on `http://localhost:3200` (Turbopack dev)
  against an isolated seeded tenant, "Sprint 5 Journey tenant", in its own
  database (`naba_visual`), with a Google stub on `:3201`. Every sweep first
  checked `/api/session` for that organisation name.
- **Screenshots:** `node tests/visual/shoot.mjs` (Playwright, Chromium and
  WebKit), which reports horizontal overflow, offenders and console errors per
  width. The reference was rendered at the same widths from its `file://` URL.
- **Interaction checks:** one-off Playwright scripts; API states forced with
  `page.route`.
- **Not run, by instruction:** `pnpm test:e2e` and `pnpm test:a11y`. The
  final integration pass did run `pnpm typecheck`, `pnpm lint`, `pnpm test`
  (186 files passed, 61 skipped; 1756 tests passed, 301 skipped),
  `pnpm check:contrast` (178 pairs, both themes) and `pnpm build` (webpack,
  exit 0), all green.
- **e2e specs:** the integration pass copied the spec bodies into a shim with
  no global setup (so it cannot re-seed or wipe data) and ran it against
  `:3200` in Chromium: `accessibility.spec` 64/64; inbox, reports, routing,
  foundation, settings, setup, gbp-management-tabs and connections-oauth
  passed; `listings.spec` 25 passed, excluding the journey and danger-zone
  tests; two read-only journeys passed (viewer permission walk, dirty draft).
  Not run because they write: the other `journeys.spec` tests, the listings
  publish, booking, industry, verification and delete journeys, and
  `auth.spec`. This is not the real e2e runner.
- **Hydration:** every report used `http://localhost:3200`. Over
  `127.0.0.1:3200` the dev client never hydrates (Next 16 `allowedDevOrigins`
  refuses the dev resources), so pages show only their server render.
- **Fixture interruptions:** several agents saw the fixture sessions wiped
  mid-task; their cookies then resolved to a placeholder or real dev org
  ("Lapen Inns"). Reports say they paused and wrote nothing during those
  windows. The inbox builder notes that some of its early shots in
  `$SCRATCH/shots/inbox` show real dev-org customer names and must stay
  local; every shot in `$SCRATCH/shots/verify-inbox` shows the fixture.
- **Screenshot directories** are under the implementation session's
  scratchpad, written below as `$SCRATCH`:
  `/private/tmp/claude-501/-Users-amankumarshrestha-LapenInns-Project-platform-naba-presence/fdc8be69-c55c-4c80-bb75-0de7eae81b9f/scratchpad`.
  It is a temporary directory and will not survive a reboot; copy anything
  needed as evidence before then.

Status words: **done** means the verifier marked the route done;
**partial** means verified with named states outstanding; **done (builder
only)** means the builder marked it done and no independent verifier report
exists for it. A family's overall status can be partial while each of its
routes is done; the outstanding items are then the not-verified states listed
per route.

## Summary

Screenshot directories are relative to `$SCRATCH`.

| Route                                                                    | Reference                                            | Status              | Browsers                                            | Screenshots                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------- | --------------------------------------------------- | ---------------------------- |
| App shell (sidebar, rail, sheet nav, toolbar, palette, reconnect banner) | `assets/np.js`, `assets/np.css`                      | done (builder only) | Chromium, WebKit                                    | `shots/shell/`, `shots/int/` |
| `/sign-in` (and `?mode=create-account`)                                  | `sign-in.html`                                       | done (builder only) | Chromium, WebKit                                    | `shots/auth/`                |
| `/forgot-password`                                                       | `forgot-password.html`                               | done (builder only) | Chromium                                            | `shots/auth/`                |
| `/reset-password`                                                        | `reset-password.html`                                | done (builder only) | Chromium                                            | `shots/auth/`                |
| `/invite/[token]`                                                        | `invite.html`                                        | done (builder only) | Chromium                                            | `shots/auth/`                |
| Not found, access denied, error, global error                            | `not-found.html`, `access-denied.html`, `error.html` | done (builder only) | Chromium                                            | `shots/system/`              |
| `/inbox`                                                                 | `inbox.html`                                         | done                | Chromium, WebKit                                    | `shots/verify-inbox`         |
| `/reports`                                                               | `reports.html`                                       | partial             | Chromium, WebKit                                    | `shots/reports-verify/`      |
| `/clients`                                                               | `clients.html`                                       | done                | Chromium, WebKit                                    | `shots/verify-clients/`      |
| `/clients/new`                                                           | `client-new.html`                                    | done                | Chromium, WebKit                                    | `shots/verify-clients/`      |
| `/clients/[clientId]`                                                    | `client.html`                                        | done                | Chromium, WebKit                                    | `shots/verify-clients/`      |
| `/clients/[clientId]/settings`                                           | `client-settings.html`                               | done                | Chromium, WebKit                                    | `shots/verify-clients/`      |
| `/setup`                                                                 | `setup.html`                                         | done                | Chromium, WebKit                                    | `shots/verify-clients/`      |
| `/listings`                                                              | `listings.html`                                      | done                | Chromium, WebKit                                    | `shots/vlc/`                 |
| `/listings/[id]`                                                         | `listing.html`                                       | done                | Chromium, WebKit                                    | `shots/vlc/`                 |
| `/listings/[id]/changes`                                                 | `listing-changes.html`                               | done                | Chromium, WebKit                                    | `shots/vlc/rp/`              |
| `/listings/[id]/profile`                                                 | `listing-profile.html`                               | partial             | Chromium, WebKit                                    | `shots/ver-ed/`              |
| `/listings/[id]/hours`                                                   | `listing-hours.html`                                 | done                | Chromium, WebKit                                    | `shots/ver-ed/`              |
| `/listings/[id]/booking`                                                 | `listing-booking.html`                               | done                | Chromium, WebKit                                    | `shots/ver-ed/`              |
| `/listings/[id]/photos`                                                  | `listing-photos.html`                                | done                | Chromium, WebKit                                    | `shots/vv/`                  |
| `/listings/[id]/posts`                                                   | `listing-posts.html`                                 | done                | Chromium, WebKit                                    | `shots/vv/`                  |
| `/listings/[id]/menu`                                                    | `listing-menu.html`                                  | done                | Chromium, WebKit                                    | `shots/vv/`                  |
| `/listings/[id]/people`                                                  | `listing-people.html`                                | done                | Chromium, WebKit                                    | `shots/vlc/`                 |
| `/listings/[id]/verification`                                            | `listing-verification.html`                          | partial             | Chromium, WebKit                                    | `shots/vlc/`                 |
| `/listings/[id]/suggestions`                                             | `listing-suggestions.html`                           | done                | Chromium, WebKit                                    | `shots/vlc/sugg/`            |
| `/team`                                                                  | `team.html`                                          | done                | Chromium, WebKit                                    | `shots/vorg/`                |
| `/settings`                                                              | `settings.html`                                      | done                | Chromium, WebKit                                    | `shots/vorg/`                |
| `/settings/connections`                                                  | `settings-connections.html`                          | done                | Chromium only (verifier); WebKit 390 by the builder | `shots/vorg/`                |

Family statuses from the verifiers: inbox done; reports partial; clients and
setup partial (every route done); listings core partial (verification);
editors profile/hours/booking partial (profile); editors photos/posts/menu
partial (no writes against the stub); organisation done.

## Production routes

### App shell (all dashboard routes)

Sidebar, icon rail, phone sheet nav, toolbar, account menu, command palette,
reconnect banner and `PageFrame`.

|             |                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Reference   | `assets/np.js` (sidebar, toolbar, reconnect banner, palette), `assets/np.css` (shell and page frame) |
| Status      | done (builder only)                                                                                  |
| Widths      | 320, 360, 390, 414, 767, 768, 1024, 1180, 1181, 1280, 1440, 1920                                     |
| Browsers    | Chromium, WebKit                                                                                     |
| Screenshots | `$SCRATCH/shots/shell/`; integration sweep `$SCRATCH/shots/int/` (script `$SCRATCH/int-sweep.mjs`)   |

Files: `components/app-shell/{app-shell,nav,topbar,account-menu,brand-mark,breadcrumbs-context,client-context,context-health-chip,command-palette,reconnect-banner,page-frame,system-page}.tsx`,
`app/(dashboard)/loading.tsx`. Tests: `tests/components/app-shell.test.tsx`,
`tests/components/nav.test.tsx`, `tests/design-system-contract.test.ts`.

Verified (builder):

- [x] 240px sidebar from 1181, 64px icon rail at 768–1180 (checked at 1180
      and 1181), no aside and a sheet nav below 768 (checked at 767 and 768).
- [x] Rail tooltips; accessible names kept.
- [x] Phone sheet, Chromium and WebKit (script, 16 checks): opens as dialog
      "Navigation", focus on the current item, Tab and Shift+Tab stay inside,
      Esc and scrim close, focus returns to the menu button, body scroll
      locked then unlocked, closes on navigation, on the close button and when
      resized to 768 or wider.
- [x] Toolbar 56px sticky; breadcrumbs collapse to the last crumb below 768;
      health chip and search become 44×44 icon buttons below 768.
- [x] Inbox needs-reply count from `/api/reviews/counts` (2 on the fixture),
      described but not part of the link name.
- [x] Client health dots with a spoken label on pinned client rows.
- [x] Account menu: name, email, role badge and explanation, theme radio
      (switching to dark checked), organisation switch hidden with one
      organisation, sign out.
- [x] Reconnect banner and client-scoped chip on a hub with a stubbed
      disconnected client at 390 and 1280; long names and emails wrap.
- [x] Workspace frame viewport-locked at 768 and wider (`/inbox`,
      `/listings/{loc}/hours`).
- [x] Dark at 390, 1024 and 1440.
- [x] Command palette opens with ⌘K and the search button.
- [x] Integration sweep: `/inbox`, `/listings`, `/clients`, `/reports`,
      `/team` at 320, 767, 768, 1180, 1181, 1440 and 1920 in Chromium and 390
      and 1280 in WebKit: page width equals the viewport, no overflowing
      elements, no console errors. The only horizontal scrollers are the inbox
      queue chip row and the listings and clients segment tabs at 320 and 390.

Not verified:

- [ ] Organisation switcher with more than one organisation (the fixture user
      has one).
- [ ] Sheet nav at 320 in WebKit (checked at 390).
- [ ] No independent verifier pass.

Gaps:

- The needs-reply badge is an extra background request to
  `/api/reviews/counts`.
- The Next dev indicator ("N") overlaps the sidebar foot in screenshots; dev
  only.

### `/sign-in`

Includes `?mode=create-account`, `?status=`, `?invite=` and `?next=`.

|             |                                                            |
| ----------- | ---------------------------------------------------------- |
| Reference   | `sign-in.html`                                             |
| Status      | done (builder only)                                        |
| Widths      | 320, 360, 390, 414, 768, 900, 901, 1024, 1280, 1440, 1920  |
| Browsers    | Chromium, WebKit                                           |
| Screenshots | `$SCRATCH/shots/auth/` (script `$SCRATCH/auth-states.mjs`) |

Files: `app/(auth)/layout.tsx`,
`components/auth/{auth-card,sign-in-panel,sign-in-form,password-field,password-requirements,resend-confirmation-button,auth-link,auth-error-alert}.tsx`.

Verified (builder, API responses stubbed; no auth form was submitted to the
real app):

- [x] Default sign-in and create account; the charcoal panel is hidden at 900
      and below.
- [x] `invalid_credentials`, `email_not_verified` (alert with resend) and
      `auth_rate_limited` alerts from the real API error codes.
- [x] Register with `confirmationRequired` → check-your-email panel with
      resend.
- [x] Client validation: friendly name and email messages, requirements
      ticking, mismatch.
- [x] `?status=invalid_email_link` banner, `?invite=` info banner, `?next=`
      note.
- [x] Dark in Chromium and WebKit.

Not verified:

- [ ] A real, unstubbed sign-in redirect in the browser (unit tests only;
      redirect logic unchanged).
- [ ] No independent verifier pass.

Gaps: no agency-name field (`registerSchema` does not accept one); no lockout
countdown (no retry-after); the reference's confirmed, signed-out and
password-changed banners are not added because the app never produces those
statuses.

### `/forgot-password`

|             |                                                           |
| ----------- | --------------------------------------------------------- |
| Reference   | `forgot-password.html`                                    |
| Status      | done (builder only)                                       |
| Widths      | 320, 360, 390, 414, 768, 900, 901, 1024, 1280, 1440, 1920 |
| Browsers    | Chromium                                                  |
| Screenshots | `$SCRATCH/shots/auth/`                                    |

Files: `app/(auth)/forgot-password/page.tsx`,
`components/auth/forgot-password-form.tsx`.

Verified (builder): default; sent state with neutral wording, "Send another
link" (repeats the real request) and "Use a different email"; rate-limited
error (unit test).

Not verified: WebKit; no independent verifier pass.

### `/reset-password`

|             |                                                           |
| ----------- | --------------------------------------------------------- |
| Reference   | `reset-password.html`                                     |
| Status      | done (builder only)                                       |
| Widths      | 320, 360, 390, 414, 768, 900, 901, 1024, 1280, 1440, 1920 |
| Browsers    | Chromium                                                  |
| Screenshots | `$SCRATCH/shots/auth/`                                    |

Files: `app/(auth)/reset-password/page.tsx`,
`components/auth/reset-password-form.tsx`.

Verified (builder): missing or incomplete token panel with "Request another
link"; valid-token form; a dead token (`invalid_email_link` from a stubbed
API) replaces the form with the alert.

Not verified: WebKit; no independent verifier pass.

Gap: no "checking the link" state, because the app does not pre-validate the
token.

### `/invite/[token]`

|             |                        |
| ----------- | ---------------------- |
| Reference   | `invite.html`          |
| Status      | done (builder only)    |
| Widths      | 390, 1280              |
| Browsers    | Chromium               |
| Screenshots | `$SCRATCH/shots/auth/` |

Files: `app/(auth)/invite/[token]/page.tsx` (unchanged),
`components/auth/{invitation-view,invitation-actions}.tsx`.

Verified (builder, stubbed `/api/invitations` responses): loading; signed out
(create account with the email locked); signed in with a different email
(real owner session); accepted; expired; not found; transient error with Try
again.

Not verified: widths other than 390 and 1280; WebKit; no independent verifier
pass.

Gaps: no inviter name (the lookup returns none); a signed-in visitor whose
email matches keeps "Sign out and continue" instead of accepting in place.

### System pages

Dashboard not found, root not found, access denied, route error boundary,
global error.

|             |                                                      |
| ----------- | ---------------------------------------------------- |
| Reference   | `not-found.html`, `access-denied.html`, `error.html` |
| Status      | done (builder only)                                  |
| Widths      | 320, 390, 768, 1024, 1181, 1440                      |
| Browsers    | Chromium                                             |
| Screenshots | `$SCRATCH/shots/system/`                             |

Files: `app/(dashboard)/not-found.tsx`, `app/not-found.tsx`,
`components/app-shell/access-denied.tsx`, `app/(dashboard)/error.tsx`,
`app/global-error.tsx`, `components/app-shell/system-page.tsx`. Test:
`tests/components/system-pages.test.tsx` (new).

Verified (builder):

- [x] Dashboard 404 (`/clients/<unknown uuid>`): requested path in mono, Back
      to Inbox, Search opens the palette, destinations (Team only for
      owner/admin).
- [x] Root 404 outside the shell.
- [x] Access denied for a viewer on `/team` and a member on
      `/settings/connections`: real area, role, explanation, signed-in email,
      "Copy an access request" (copies text only).
- [x] Error boundary and global error in unit tests: area from the path,
      digest in mono, `error.message` never shown, Try again uses
      `unstable_retry` (falls back to `reset`).

Not verified:

- [ ] Route error boundary and global error in a browser: there is no safe
      way to trigger a render error on the fixture app.
- [ ] WebKit; no independent verifier pass.

Gaps: access denied does not name the owners/admins and omits the
reference's per-role capability list; error pages show the Next.js digest
only (no request id for render errors); not-found destinations carry
descriptions, not counts.

### `/inbox`

|             |                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Reference   | `inbox.html`, rendered at 390 and 1280, light, and dark at 1280                                                                          |
| Status      | done                                                                                                                                     |
| Widths      | 320, 360, 390, 414, 767, 768, 1023, 1024, 1180, 1181, 1280, 1440                                                                         |
| Browsers    | Chromium, WebKit                                                                                                                         |
| Screenshots | `$SCRATCH/shots/verify-inbox` (`impl-*`, `ref-*`, `refdark-*`, `dark-*`, `viewer-*`, `mob-detail-*`, `st-<state>-*`, `more-*`, `bulk-*`) |

Files changed by the verifier (the builder's full file list was not in the
report): `components/inbox/inbox-hotkeys.tsx`,
`components/inbox/inbox-view.tsx`, `tests/components/inbox-view.test.tsx`
(test added).

Verified:

- [x] Default list with auto-selected detail at 320–1440: no horizontal
      overflow, no console errors, fixture tenant confirmed.
- [x] Parity with the reference at 390 and 1280: layout, Today tile, chips,
      filter row, list card head, selected-row tint and bar, serif only on the
      `h1` and the review quote, mono meta, dark action bar.
- [x] Dark at 1280: the charcoal bar turns near-white.
- [x] Viewer at 1280 (real viewer cookie): no tick boxes or bulk bar,
      "View-only access", publish disabled with its reason.
- [x] Narrow list → detail → Back (Chromium 390 and 320, WebKit 390): list
      hidden, Back takes focus, focus returns to the originating row, no
      overflow.
- [x] Sticky footer at 390: last content ends above the bar.
- [x] Reply states with mocked detail payloads at 1280, 1024 and 390 (every
      non-GET aborted): failed ("Retry publish"), requester ("Submit for
      approval", not clipped), approver, waiting for another approver,
      published ("Update reply"), `publish_requested` ("Publishing…" and "Sent
      to Google — waiting for Google to confirm"), blocked by verification.
      Footer not clipped at any width.
- [x] More filters sheet fits at 320 and 390 (Chromium, WebKit).
- [x] Bulk bar at 320 and 390: sticky in the list pane, wraps.
- [x] Keyboard: `j` moves the selection; `?` and the Shortcuts button open the
      dialog; focus enters it and returns to the trigger on Escape; logical tab
      order with visible focus throughout.
- [x] axe (WCAG 2 A/AA, 2.1, 2.2, best practice): no violations at 1280 light,
      1280 dark and 390 with the detail open.
- [x] Heading order: `h1` Inbox, `h2` reviewer, `h3` Write the reply,
      Verification, Activity.

Not verified:

- [ ] Real requester and approver sessions: those cookies resolve to "Harness
      tenant", so approval states were checked with mocked capabilities only.
- [ ] Mutations (save, publish, approve, reject, retry, delete): all non-GET
      requests were aborted.
- [ ] Real loading, empty and list-error states: not re-shot by the verifier
      (the builder's route-mocked shots exist).
- [ ] Long review text and media: the fixture has two short reviews.

Gaps:

- Fixed during verification: the shortcuts dialog listed `a` and `e`, which
  are unbound; viewers got the `x` / Shift X / Esc bindings. Test added.
- From 1181 to about 1250px the detail pane is about 550px wide and the shared
  Lifecycle primitive switches to its vertical layout (about 180px tall). The
  threshold lives in `components/ui/lifecycle.tsx`; not changed.
- On coarse pointers the queue chips (40px), star multi-select (38px), tone
  segments (36px) and row checkbox (24px hit area in a non-clickable 44px
  column) are below 44px. All meet the 24px WCAG 2.2 floor; primary actions on
  the bar are 44px.
- The filter row wraps "More filters" onto a second line at 1024–1440, because
  the repo keeps more controls than the reference.
- No per-queue Google sync time ("Refreshed HH:MM" instead), no assignee in the
  detail head, generic Pass/Check/Fail check texts.
- On a narrow deep link (`?selected=…`) Back is focused on load, so a focus
  ring shows before any interaction.
- The list status pill carries `aria-label` on a role-less span. Tests depend
  on it and axe passes; a visually hidden text would be sturdier.

### `/reports`

Tabs `reply`, `google`, `keywords`; query parameters `?clientId`,
`?locationId`, `?tab`.

|             |                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| Reference   | `reports.html`                                                                                                      |
| Status      | partial                                                                                                             |
| Widths      | 320, 360, 390, 414, 639, 640, 767, 768, 769, 1024, 1180, 1181, 1280, 1440                                           |
| Browsers    | Chromium, WebKit                                                                                                    |
| Screenshots | `$SCRATCH/shots/reports-verify/` (scripts `$SCRATCH/vshoot.mjs`, `vwide.mjs`, `vaxe.mjs`, `vint.mjs`, `vrange.mjs`) |

Files: `components/reporting/report-bar-chart.tsx`,
`components/reporting/report-tab-head.tsx`,
`components/performance/presence-figures.tsx`,
`components/performance/google-performance-tab.tsx`,
`lib/reporting/series-bins.ts`, `tests/components/series-bins.test.ts` (new).
Edits outside the family: `tests/e2e/reports.spec.ts` (not run),
`tests/components/google-performance-tab.test.tsx`,
`tests/components/refresh-google-button.test.tsx`.

Verified:

- [x] Reply tab at 320–1440, including 639/640/641, 767/768/769 and
      1180/1181: no document overflow.
- [x] Google tab at 320, 360, 390, 414, 639, 640, 768, 1024, 1280, 1440. After
      the fix, document `scrollWidth` is 320 at 320 (was 359).
- [x] Keywords tab at 320, 390, 768, 1280; WebKit 390 for keywords and Google.
- [x] Location report (`?locationId`) at 320 and 1280.
- [x] Dark 1280 (Google tab).
- [x] axe (WCAG 2 A/AA, 2.1, 2.2 AA) on `main`: 0 violations for reply,
      Google, keywords, location and unknown client, light and dark.
- [x] Heading order on every tab and the location report.
- [x] Tabs keyboard: ArrowRight moves focus, Enter selects and updates `?tab=`,
      visible focus.
- [x] Loading, error (alert plus Try again), empty or pending ("Nothing
      collected yet", once), partial Google and keywords (reasons list plus
      "Open Google connections").
- [x] Refresh from Google with an intercepted POST: 409 shows an "already
      running" alert; 202 clears the error and refetches; no success claim.
- [x] Viewer: no Refresh button.
- [x] Keywords filter: live "N of M terms", no-match panel.
- [x] 90d draws 14 weekly bars; 12m draws 13 monthly bars across the window.

Not verified:

- [ ] Client with zero locations (no such fixture client).
- [ ] `keywords_paused` 503 panel in a browser (unit test only).
- [ ] Unknown `?locationId` in a browser (same component as unknown client).
- [ ] `tests/e2e/reports.spec.ts` edits (e2e not run).

Gaps:

- Each tab keeps its own Period select; the reference has one in the scope
  bar. The three endpoints use different range vocabularies.
- Not rendered, no API data: "Actions by location" bars, keyword Location,
  Previous and Change columns, CSV export, by-location Status column and row
  actions, deltas against a previous period.
- The reference's "Google revised views" banner is intentionally not added.
- A 12m or 18m chart's first bar is a partial month; the axis does not mark it.
- Existing behaviour: the location report's "Review activity" uses the
  org-wide last-30-days overview, not the Period select.
- Fixed during verification: page-wide horizontal scroll at 320 from the
  hidden chart table; a misleading time axis on sparse data; a made-up "0"
  on all-null stacked columns; "Nothing collected yet" shown twice; an empty
  caption row on phones.

### `/clients`

|             |                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Reference   | `clients.html`                                                                                      |
| Status      | done                                                                                                |
| Widths      | 320, 360, 390, 414, 719, 720, 767, 768, 1024, 1180, 1181, 1280, 1440                                |
| Browsers    | Chromium, WebKit                                                                                    |
| Screenshots | `$SCRATCH/shots/verify-clients/` (`imp-clients-*`, `dk-clients-*`, `wk-clients-*`, `r-*-clients-*`) |

Files: `app/(dashboard)/clients/page.tsx`,
`components/clients/clients-index.tsx`, `lib/clients/health.ts`.

Verified:

- [x] Owner default at every width, no horizontal overflow.
- [x] Dark 1280; WebKit 390.
- [x] Viewer 390; member 390.
- [x] Search with no matches.
- [x] Serif only on the `h1` (computed font-family sweep).
- [x] Touch-target sweep at 390 (coarse pointer).

Not verified:

- [ ] A list with mixed health (the fixture has one healthy client).
- [ ] Admin role.

Gaps:

- Health filter segments are 40px on touch, from the shared SegmentedControl.
- The row's name link is 20px tall; the whole row is clickable and serves as
  the target.
- Last sync comes before Google login, the reverse of the reference (minor).

### `/clients/new`

|             |                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| Reference   | `client-new.html`                                                                                                |
| Status      | done                                                                                                             |
| Widths      | 320, 360, 390, 414, 719, 720, 767, 768, 1024, 1180, 1181, 1280, 1440                                             |
| Browsers    | Chromium, WebKit                                                                                                 |
| Screenshots | `$SCRATCH/shots/verify-clients/` (`imp-new-*`, `dk-new-*`, `wk-new-*`, `v-new-invalid-390.png`, `v-newclient-*`) |

Files: `app/(dashboard)/clients/new/page.tsx`,
`components/clients/client-form.tsx`.

Verified:

- [x] Default.
- [x] Empty submit: focus to the name field, `aria-invalid`, `aria-describedby`
      pointing at the error and the description.
- [x] Create end to end on the fixture with a very long name, landing on
      `/setup?client=…&step=connect`; the client was archived afterwards.
- [x] Member and viewer denied.
- [x] Dark 1280; WebKit 390.

Not verified:

- [ ] Server error alert (covered by the builder, not re-run).

Gaps:

- Duplicate names are not blocked: the API allows them, and that is a
  business rule.

### `/clients/[clientId]`

|             |                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| Reference   | `client.html`                                                                                                  |
| Status      | done                                                                                                           |
| Widths      | 320, 360, 390, 414, 719, 720, 767, 768, 1024, 1180, 1181, 1280, 1440                                           |
| Browsers    | Chromium, WebKit                                                                                               |
| Screenshots | `$SCRATCH/shots/verify-clients/` (`imp-hub-*`, `dk-hub-*`, `wk-hub-*`, `r-*-hub-*`, `v-newclient-hub-390.png`) |

Files: `app/(dashboard)/clients/[clientId]/layout.tsx`,
`components/clients/client-hub.tsx`.

Verified:

- [x] Healthy (fixture).
- [x] Not connected, with a very long name: wraps, "Finish setup" is primary.
- [x] Viewer 390 (no Settings); member 390.
- [x] Dark 1280; WebKit 390.
- [x] Keyboard tab order with visible focus on every stop.
- [x] Headings `h1` then `h2`.

Not verified:

- [ ] Disconnected hub in a browser (component test only).
- [ ] Import running.

Gaps:

- No data source for the reference's Recent activity feed or "Changes not on
  Google" tile; replaced by a Review import card and a Listings linked tile.
- The listing-name link in each row is 20px tall on touch; the row also has a
  full-size "Listing" link.

### `/clients/[clientId]/settings`

|             |                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Reference   | `client-settings.html`                                                                                                             |
| Status      | done                                                                                                                               |
| Widths      | 320, 360, 390, 414, 719, 720, 767, 768, 1024, 1180, 1181, 1280, 1440                                                               |
| Browsers    | Chromium, WebKit                                                                                                                   |
| Screenshots | `$SCRATCH/shots/verify-clients/` (`imp-settings-*`, `dk-settings-*`, `wk-settings-*`, `v-archive-*`, `v-settings-invalid-390.png`) |

Files: `app/(dashboard)/clients/[clientId]/settings/page.tsx`,
`components/clients/client-settings.tsx`.

Verified:

- [x] Default.
- [x] Archive disabled with its reason linked by `aria-describedby` while
      listings are attached.
- [x] Empty name on save: focus to the field, `aria-invalid`.
- [x] Archive dialog at 390 on a client with no listings: confirm disabled
      until the acknowledgement is ticked; Escape returns focus to the trigger;
      a long name wraps.
- [x] Archive end to end: redirect to `/clients`, the client leaves the list,
      the API answers 404.
- [x] Member and viewer denied.
- [x] Dark 1280; WebKit 390.

Not verified:

- [ ] Assigning unfiled listings (the fixture has none).

Gaps:

- No Undo after removing a listing: re-assigning also grants access to client
  members, so it is not an exact inverse.
- Server contract bug, recorded, not fixed: after archiving, `PATCH` returns
  `{client: null}` because `loadClientSummary` skips archived clients. The UI
  confirms the archive by re-reading the client.

### `/setup`

|             |                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| Reference   | `setup.html`                                                                                                             |
| Status      | done                                                                                                                     |
| Widths      | 320, 360, 390, 414, 719, 720, 767, 768, 1024, 1180, 1181, 1280, 1440                                                     |
| Browsers    | Chromium, WebKit                                                                                                         |
| Screenshots | `$SCRATCH/shots/verify-clients/` (`imp-wiz-*`, `imp-chooser-*`, `wiz-*`, `dk-wiz-*`, `wk-wiz-*`, `v-wiz-*`, `ref-wiz-*`) |

Files: `app/(dashboard)/setup/page.tsx`, `components/setup/setup-wizard.tsx`,
`components/setup/step-connect.tsx`, `components/setup/step-agency.tsx`,
`lib/setup/steps.ts`, `lib/setup/oauth-status.ts`. The report also records
edits to `tests/e2e/setup.spec.ts` (8 to 9 stepper items; not run) and a
rewrite of `tests/setup-steps.test.ts`.

Verified:

- [x] Chooser (nothing waiting).
- [x] Wizard resumes at backfill on the fixture.
- [x] Connect, agency and account steps at 390 and 1280.
- [x] Continue while blocked: a ValidationSummary takes focus; the URL does
      not change.
- [x] Back moves focus to the step `h2` and updates `?step=`.
- [x] `?step=done` deep link falls back to the resume step with a note.
- [x] "All steps" disclosure toggles `aria-expanded` from the keyboard.
- [x] Footer reason is in an `aria-live="polite"` region.
- [x] Sticky footer at 390 and 320.
- [x] A client created through `/clients/new` lands on Connect.
- [x] Dark 1280; WebKit 390; member and viewer 390.

Not verified:

- [ ] Google OAuth round trip.
- [ ] The `?google=error` alert (the callback sends errors to
      `/settings/connections`).

Gaps:

- The breadcrumb reads "Setup"; the reference has "Clients / {client} /
  Setup". The trail comes from the path (`lib/ui/breadcrumb-trail`, owned by
  the shell).
- For backfill, account and listings, the ValidationSummary link focuses the
  step container (`#setup-step-content`), not the control: the embedded
  settings cards have no stable ids.
- The embedded settings cards keep their own `h2` below the step's `h2`, one
  heading level too high; those cards are owned by settings.
- "Finish later" on mobile is a full-width ghost button with a centred label.

### `/listings`

|             |                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| Reference   | `listings.html`, compared at 390 and 1280                                                                |
| Status      | done                                                                                                     |
| Widths      | 320, 360, 390, 414, 719, 721, 767, 768, 769, 1024, 1179, 1181, 1280, 1440                                |
| Browsers    | Chromium, WebKit                                                                                         |
| Screenshots | `$SCRATCH/shots/vlc/` (`listings-*`, `ref/ref-listings-*`, `final/listings-*`); builder `shots/listings` |

Files: `components/listings/listings-board.tsx`,
`components/listings/file-under-client.tsx`, `app/(dashboard)/listings/page.tsx`.

Verified:

- [x] Default real data at every width, no horizontal overflow.
- [x] WebKit 390; dark 1280.
- [x] Compared with the reference at 390 and 1280.
- [x] Builder only: busy summaries (changes to publish, Google changes, post
      awaiting approval, failed publish, not verified), summaries loading,
      viewer, filtered-empty ("No listings match" and Clear filters).

Not verified:

- [ ] Busy, filtered and error states re-run by the verifier (component tests
      pass).
- [ ] Client chip row (the fixture has one client).
- [ ] Directory loading skeleton in a browser (server-prefetched).

Gaps: the Pending column shows for every role (the repo serves summaries to
members and viewers); no client-picker dialog; client marks keep the coloured
`ClientAvatar`. Fixed by the verifier: "Never" for Last published when the
summary was missing (now a skeleton or a dash).

### `/listings/[id]` (overview)

|             |                                                                           |
| ----------- | ------------------------------------------------------------------------- |
| Reference   | `listing.html`, compared at 1280                                          |
| Status      | done                                                                      |
| Widths      | 320, 360, 390, 414, 719, 721, 767, 768, 769, 1024, 1179, 1181, 1280, 1440 |
| Browsers    | Chromium, WebKit                                                          |
| Screenshots | `$SCRATCH/shots/vlc/listings-<loc>-*`, `$SCRATCH/shots/vlc/final/`        |

Files: `components/listings/{listing-overview,area-frame,health-strip,area-cards,recent-activity,sibling-switcher}.tsx`,
`lib/listings/area-state.ts`, `app/(dashboard)/listings/[id]/loading.tsx`.

Verified:

- [x] Default real data, no overflow at any width.
- [x] Dark 1280; WebKit 390; compared with the reference at 1280.
- [x] Builder only: busy summary via stale-refetch interception (attention
      health, "Review & publish (3)", failed-publish alert, suggestions card
      first, per-area counts); viewer (no console tabs or cards).

Not verified:

- [ ] Busy summary, failed summary and unfiled alert re-run by the verifier.
- [ ] Summary-failed in a browser at all (server-prefetched; a failed refetch
      keeps its data).
- [ ] Unfiled listing alert with inline "File under…" (no fixture).

Gaps: "Open on Google" disabled with a reason (no public Maps URL stored);
the header pill can say "In sync" while an area has never been compared
(`lib/listings/health.ts` counts `unknown` as healthy). Fixed by the verifier:
the Sync tile and header no longer claim a match with Google for unchecked
areas.

### `/listings/[id]/changes` (review and publish)

|             |                                                                           |
| ----------- | ------------------------------------------------------------------------- |
| Reference   | `listing-changes.html`                                                    |
| Status      | done                                                                      |
| Widths      | 320, 360, 390, 414, 719, 721, 767, 768, 769, 1024, 1179, 1181, 1280, 1440 |
| Browsers    | Chromium, WebKit                                                          |
| Screenshots | `$SCRATCH/shots/vlc/rp/` (script `$SCRATCH/vlc-rp.mjs`)                   |

Files: `components/listings/review-publish.tsx`,
`app/(dashboard)/listings/[id]/changes/page.tsx`.

Verified (every publish POST intercepted; nothing reached the stub):

- [x] Nothing to publish (real data) at every width.
- [x] Two areas via interception (profile conflict with long description and
      URL, plus hours) at 320, 390 and 1280, no overflow; WebKit 390.
- [x] Conflict checkbox toggled with Space enables Publish; the disabled
      reason is exposed through `aria-describedby`.
- [x] Partial failure (profile 200, hours 502): "Accepted by Google" on
      profile, Failed with `google_write_failed` and Retry on hours, focus
      moves to Retry, `role=alert` banner.
- [x] The sticky action bar covers nothing at the end of the scroll.

Not verified:

- [ ] Viewer with pending changes in a browser (interception did not take;
      the `caps.canPublish` gate was checked in code, and the capabilities API
      returns `canPublish: false` for the viewer).
- [ ] Publishing paused (disconnected connection).
- [ ] Summary load error.

Gaps: diffs load for every area on arrival rather than lazily. Fixed by the
verifier: running and finished steps looked alike; "Accepted by Google" could
show for a step that sent nothing; the provider error code was dropped;
Publish counted an area that failed to load; focus did not move to Retry.

### `/listings/[id]/profile`

|             |                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Reference   | `listing-profile.html` (reference shots in `$SCRATCH/shots/ver-ed/ref/`)                                    |
| Status      | partial                                                                                                     |
| Widths      | 320, 360, 390, 414, 767, 768, 769, 1024, 1179, 1180, 1181, 1280, 1440                                       |
| Browsers    | Chromium, WebKit 390, Chromium dark 1280                                                                    |
| Screenshots | `$SCRATCH/shots/ver-ed/profile-*`, `$SCRATCH/shots/ver-ed/i/profile-*`, `$SCRATCH/shots/ver-ed/v/profile-*` |

Files: `components/locations/profile/profile-editor.tsx`,
`components/locations/profile/section-card.tsx` (new),
`components/locations/profile/sections/*`,
`components/locations/typed-attribute-control.tsx`, the shared
`components/editors/*` and `lib/editors/*`.

Verified (every write intercepted with a 502 by the verifier):

- [x] Default and in sync, owner, every width, no overflow.
- [x] Viewer: banner, disabled fields and a visible, disabled Review changes.
- [x] Address typing after the fix ("12 High Street", Enter, "Old Town"
      kept) in Chromium and WebKit.
- [x] Save here disabled with its reason while a Google-only field is dirty.
- [x] "Jump to section" (narrow) and the index link (1280) move focus to the
      section heading.
- [x] Permanently-closed dialog: confirm disabled until acknowledged; Cancel
      returns focus to Open status.
- [x] Review sheet and a publish failure: the no-op step reads "Nothing to
      send", the listing step Failed with its code, the button "Try again".
- [x] At 390×500 and 1280×600 a focused field stays above the bar.
- [x] Builder only: dirty marks, validation summary focus, a real Save here
      PUT on the fixture, conflict banner via interception, loading and error.

Not verified:

- [ ] Conflict banner and rows in a live browser by the verifier (component
      test only).
- [ ] Publishing paused gate in a browser.
- [ ] Discard confirmation dialog in a browser.

Gaps: the action bar spans under the section index (the reference starts it
at the form column); the AreaFrame pill can say "In sync" with unsaved edits;
at 390 the sheet's "Try again" can sit under an error toast until it goes; no
category descriptions or service-area editor (no data).

### `/listings/[id]/hours`

|             |                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Reference   | `listing-hours.html`                                                                                        |
| Status      | done                                                                                                        |
| Widths      | 320, 359, 360, 390, 414, 767, 768, 769, 1024, 1179, 1180, 1181, 1280, 1440                                  |
| Browsers    | Chromium, WebKit 320/390/390×500, Chromium dark 1280                                                        |
| Screenshots | `$SCRATCH/shots/ver-ed/hours-*`, `$SCRATCH/shots/ver-ed/i/hours-*`, `$SCRATCH/shots/ver-ed/i/pane*-hours-*` |

Files: `components/locations/hours-tab.tsx`,
`components/locations/hours-editor.tsx`, `lib/editors/hours-presentation.ts`
(new).

Verified:

- [x] Empty (Google has no hours: info banner).
- [x] Split default (09:00–12:30 and 13:30–17:00).
- [x] Invalid: focus to the summary, the link focuses the field,
      `aria-invalid` and `aria-describedby`, the summary clears once fixed.
- [x] Copy-to-days dialog: quick pick gives "Copy to 4 days"; focus returns
      to the trigger.
- [x] Review sheet diff at 390 and 1280; buttons stack full width on phones.
- [x] Publish failure (writes intercepted): the save step Failed with its
      code, publish "Not sent — an earlier step failed", "Try again" works.
- [x] Viewer read-only.
- [x] Bar held to two rows at 320.
- [x] Editor usable at 390×500, 320×568, 375×667 and 844×390 after the pane
      fix.
- [x] Builder only: a real Save here PUT on the fixture; conflict via
      interception; loading and error.

Not verified:

- [ ] Conflict status in the browser by the verifier (component test).
- [ ] Publishing paused in the browser (component test).

Gaps: no "Open 24 hours" and no overnight "next day" hint (not in the wire
contract); the footer says "These hours match Google." while the AreaFrame
pill says "Not checked yet" for the same empty schedule.

### `/listings/[id]/booking`

|             |                                                                        |
| ----------- | ---------------------------------------------------------------------- |
| Reference   | `listing-booking.html`                                                 |
| Status      | done                                                                   |
| Widths      | 320, 360, 390, 414, 767, 768, 769, 1024, 1179, 1180, 1181, 1280, 1440  |
| Browsers    | Chromium, WebKit 390, Chromium dark 1280                               |
| Screenshots | `$SCRATCH/shots/ver-ed/booking-*`, `$SCRATCH/shots/ver-ed/i/booking-*` |

Files: `components/locations/booking-tab.tsx`,
`lib/editors/booking-presentation.ts` (new),
`components/locations/overwrite-confirm-dialog.tsx`.

Verified:

- [x] Empty (real fixture).
- [x] Intercepted list: preferred link, provider link, long URL wrapping at
      320, pending `latestMutation` alert.
- [x] Make preferred confirmation opens.
- [x] Edit dialog: focus on open; invalid link sets `aria-invalid` and moves
      focus; a failed PATCH keeps the dialog and value and shows the error
      inline.
- [x] Remove confirmation with the URL preview and an inline failure note.
- [x] Add form: empty link sets `aria-invalid`, moves focus, error linked by
      `aria-describedby`.
- [x] Viewer.
- [x] Builder only: a real create POST (201) against the stub with the "Booking
      link added" toast; loading and error.

Not verified:

- [ ] Successful edit, prefer and remove against the stub (intercepted with a
      502).
- [ ] The post-create list against live data (the stub does not list new
      links).

Gap: the unsupported empty state cannot be reached with live data (the server
lists every supported type).

### `/listings/[id]/photos`

|             |                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------- |
| Reference   | `listing-photos.html`, compared at 390 and 1280                                             |
| Status      | done                                                                                        |
| Widths      | 320, 360, 390, 414, 767, 768, 769, 1024, 1180, 1181, 1280, 1440                             |
| Browsers    | Chromium, WebKit                                                                            |
| Screenshots | `$SCRATCH/shots/vv/photos-*` (script `$SCRATCH/vv/v.mjs`); builder `shots/editors/photos-*` |

Files: `components/locations/photos-tab.tsx`,
`components/locations/photos/{photos-library,photos-toolbar,photos-grid,media-card,photo-preview,add-photo-dialog,upload-dialog,delete-photo-dialog}.tsx`.

Verified (media intercepted; no writes):

- [x] Default at all 12 widths, no page overflow, no console errors.
- [x] Empty, error 503, read-only (viewer), paused at 390.
- [x] Dark 1280.
- [x] Lightbox at 320, 390, 1280 and WebKit 390; ArrowRight moves to 2 of
      12; Escape returns focus to the tile's Preview button.
- [x] Add-media dialog at 320 and 1280 fits; category combobox named; focus
      returns to Add photos.
- [x] Delete confirmation at 320.

Not verified:

- [ ] A real upload or URL import against the stub.
- [ ] Drag and drop.
- [ ] Loading state re-shot by the verifier (builder shot it).

Gaps: category Select instead of chips with counts (no counts in the API); no
"Use as cover" (COVER is create-only); tiles carry an always-visible control
strip the reference does not have; ownership segmented buttons are 40px on
touch (shared recipe).

### `/listings/[id]/posts`

|             |                                                                 |
| ----------- | --------------------------------------------------------------- |
| Reference   | `listing-posts.html`, compared at 1280                          |
| Status      | done                                                            |
| Widths      | 320, 360, 390, 414, 767, 768, 769, 1024, 1180, 1181, 1280, 1440 |
| Browsers    | Chromium, WebKit                                                |
| Screenshots | `$SCRATCH/shots/vv/posts-*`; builder `shots/editors/posts-*`    |

Files: `components/locations/posts-tab.tsx`,
`components/locations/posts-action-bar.tsx`,
`components/locations/posts/{post-card,post-composer-sheet,post-preview}.tsx`,
`lib/locations/post-display.ts` (new).

Verified (no writes):

- [x] Default (live, awaiting, draft, failed, ambiguous) at all 12 widths, no
      overflow, no console errors; re-shot at 320 and 390 after fixes.
- [x] Empty, error, read-only, paused at 390.
- [x] Dark 1280.
- [x] Composer with Event at 320, 390, 1280 and WebKit 390: fits, footer
      reachable.
- [x] Composer validation (Offer without a title, Book button without a
      link): Save focuses the first invalid field; both errors linked by
      `aria-describedby`.

Not verified:

- [ ] Saving a draft, publishing, approving or deleting against the fixture.
- [ ] The rewritten delete-dialog copy and paused caption, checked in code
      only.

Gaps: no edit flow, library photo picker or send-back reason; no author or
approver meta (no data); the shell header pill can disagree with the in-page
count under interception; the filter chip row scrolls on phones (the next
chip is visibly cut off).

### `/listings/[id]/menu`

|             |                                                                 |
| ----------- | --------------------------------------------------------------- |
| Reference   | `listing-menu.html`, compared at 1280                           |
| Status      | done                                                            |
| Widths      | 320, 360, 390, 414, 767, 768, 769, 1024, 1180, 1181, 1280, 1440 |
| Browsers    | Chromium, WebKit                                                |
| Screenshots | `$SCRATCH/shots/vv/menu-*`; builder `shots/editors/menu-*`      |

Files: `components/locations/menu-tab.tsx`,
`components/locations/menu-editor.tsx`.

Verified (no writes):

- [x] Default (drift) at all 12 widths, no overflow.
- [x] The sticky footer never covers "Add section" at the end of the scroll
      (320, 390, 1280, WebKit 390).
- [x] Invalid at 320 and 1280: Review moves focus to the summary; problems
      clear live; "12." and "12.5" can be typed.
- [x] Review sheet at 390 and 1280 fits; Publish to Google reachable.
- [x] Empty, empty-google ("Start from Google's menu" is local only),
      unsupported, error, read-only, paused at 390.
- [x] Dark 1280.

Not verified:

- [ ] Save and publish against the stub.

Gaps: no dietary, spice or allergen fields and no kitchen gate (by decision);
item options carried but not editable; no item photos; the shell header pill
can disagree with the editor's status under interception.

### `/listings/[id]/people`

|             |                                                                           |
| ----------- | ------------------------------------------------------------------------- |
| Reference   | `listing-people.html`, compared at 1280                                   |
| Status      | done                                                                      |
| Widths      | 320, 360, 390, 414, 719, 721, 767, 768, 769, 1024, 1179, 1181, 1280, 1440 |
| Browsers    | Chromium, WebKit                                                          |
| Screenshots | `$SCRATCH/shots/vlc/listings-<loc>-people-*`; builder `shots/listings/`   |

Files: `components/locations/administration/{administration-tab,admins,admins-table,invitations,danger-zone,context}.tsx`.

Verified:

- [x] Real data (the primary owner row locked with its reason) at every
      width, no overflow.
- [x] Viewer denied page with "Copy an access request" (copy only).
- [x] Dark 1280; WebKit 390.
- [x] Builder only: three people with a long email, a pending owner invite
      and an invitation to accept (mocked); load error (502).

Not verified:

- [ ] Role change, remove, transfer and delete dialogs in a browser
      (component tests pass).
- [ ] Multi-person and long-email states re-run by the verifier.

Gaps: no Resend or Cancel on outgoing invitations; "Remove from NabaPresence"
points to Connections. Fixed by the verifier: the Actions column header was
invisible.

### `/listings/[id]/verification`

|             |                                                                                  |
| ----------- | -------------------------------------------------------------------------------- |
| Reference   | `listing-verification.html`, compared at 1280                                    |
| Status      | partial                                                                          |
| Widths      | 320, 360, 390, 414, 719, 721, 767, 768, 769, 1024, 1179, 1181, 1280, 1440        |
| Browsers    | Chromium, WebKit                                                                 |
| Screenshots | `$SCRATCH/shots/vlc/listings-<loc>-verification-*`; builder `shots/listings/v-*` |

Files: `components/locations/administration/{verification,administration-tab,voice-of-merchant}.tsx`.

Verified:

- [x] Verified (real data) at every width, no overflow.
- [x] Viewer denied page.
- [x] Dark 1280; WebKit 390.

Not verified:

- [ ] Unverified, pending PIN, unsupported and wrong-PIN states by the
      verifier. The builder reports unverified (4 methods), pending PIN and
      unsupported via interception; wrong PIN was not checked in a browser.

Gaps: no History section and no attempt counter (no data); the label stays
"PIN" (tests); "Start a new verification" shows for a verified listing
(existing capability).

### `/listings/[id]/suggestions`

|             |                                                                           |
| ----------- | ------------------------------------------------------------------------- |
| Reference   | `listing-suggestions.html`                                                |
| Status      | done                                                                      |
| Widths      | 320, 360, 390, 414, 719, 721, 767, 768, 769, 1024, 1179, 1181, 1280, 1440 |
| Browsers    | Chromium, WebKit                                                          |
| Screenshots | `$SCRATCH/shots/vlc/sugg/` (script `$SCRATCH/vlc-sugg.mjs`)               |

Files: `components/locations/suggestions/{suggestions-page,suggestion-list}.tsx`.

Verified (decisions intercepted):

- [x] Empty (real data) at every width.
- [x] Three proposals via interception (long URL, "Also edited here", menu
      price) at 320, 390 and 1280, no overflow, 44px buttons on touch.
- [x] 409 decision failure: inline "Not applied" with the message and Retry
      (`role=alert`).
- [x] Viewer: every button disabled but focusable with the reason.
- [x] Dark 1280; WebKit 390.

Not verified:

- [ ] Overwrite-confirm dialog in a browser.
- [ ] `importReviewEnabled=false` copy.

Gaps: no "Accept all" (no bulk endpoint); a decided row leaves the list and a
toast confirms; "Here now" is drawn as a struck-out "before" by `DiffView`.

### `/team`

|             |                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| Reference   | `team.html`, compared at 390 and 1280                                                                          |
| Status      | done                                                                                                           |
| Widths      | 320, 360, 390, 414, 767, 768, 1024, 1180, 1181, 1280, 1440                                                     |
| Browsers    | Chromium, WebKit                                                                                               |
| Screenshots | `$SCRATCH/shots/vorg` (`team-*`, `ref-team-*`, `sw/team-*`, `role-dlg-*`, `invite-dlg-*`); builder `shots/org` |

Files: `app/(dashboard)/team/page.tsx`,
`components/settings/{team-view,members-table,member-dialogs,invitations-panel}.tsx`,
`lib/settings/roles.ts`.

Verified:

- [x] Owner default at 1280 against the reference; labelled rows at 390.
- [x] No overflow and no console errors at all 11 widths.
- [x] Row menu from the keyboard; every disabled item carries its reason.
- [x] Change-role dialog: focus on the checked role, Escape returns to the
      row trigger, fits at 320 and 390.
- [x] Invite dialog: empty submit focuses the email field with
      `aria-invalid`, an `aria-describedby` error and a real label; fits at 320.
- [x] Role matrix and descriptions checked against the source.
- [x] Admin gets Team; viewer and member get access denied. WebKit 390.
- [x] Builder only: members loading and error, empty invitations, invite
      success via intercepted POST, `#invite` deep link.

Not verified:

- [ ] Invitation rows with pending or expired data (none on the fixture).
- [ ] A real role change or removal.
- [ ] Dark 1280 (shot taken, not reviewed in detail).
- [ ] Server refusals `already_a_member` / `invitation_pending` in a browser
      (unit level).

Gaps: client access from per-listing grants only; Joined instead of Last
active; no Resend; no Undo on revoke; at 320 the invite dialog's footer is
reached by scrolling inside the dialog.

### `/settings` (reply policy)

|             |                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Reference   | `settings.html`, compared at 1280                                                                    |
| Status      | done                                                                                                 |
| Widths      | 320, 360, 390, 414, 767, 768, 1024, 1180, 1181, 1280, 1440                                           |
| Browsers    | Chromium, WebKit                                                                                     |
| Screenshots | `$SCRATCH/shots/vorg` (`settings-*`, `ref-settings-*`, `sw/settings-*`, `settings-bottom-*`, `sb-*`) |

Files: `app/(dashboard)/settings/{layout,page,loading,error}.tsx`,
`components/settings/{policy-form,settings-nav}.tsx`.

Verified:

- [x] Owner at 1280 against the reference.
- [x] The last card clears the sticky save bar at 320 and 1280, light and
      dark.
- [x] Dark 1280.
- [x] Admin: consent checkbox disabled with the owner-only text; Save
      disabled.
- [x] Viewer and member: Policy tab only, read-only, Save disabled.
- [x] No overflow and no console errors at all 11 widths.
- [x] Builder only: loading, error with Try again, retention validation,
      intercepted PATCH failure keeps values, Discard resets.

Not verified:

- [ ] A successful save on the fixture (tenant policy left unchanged).
- [ ] Loading and error re-run by the verifier.

Gaps: banned terms, low-rating threshold, tone, "Restore safe defaults",
Compliance and "last saved by" have no API data. The two-person switch is
hidden while approval is off, although the server still enforces the stored
value (the note now says so).

### `/settings/connections`

|             |                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------- |
| Reference   | `settings-connections.html`                                                                  |
| Status      | done                                                                                         |
| Widths      | 320, 360, 390, 414, 767, 768, 1024, 1180, 1181, 1280, 1440                                   |
| Browsers    | Chromium (verifier); the builder also checked WebKit 390                                     |
| Screenshots | `$SCRATCH/shots/vorg` (`settings-connections-*`, `ref-settings-connections-*`, `disc-dlg-*`) |

Files: `app/(dashboard)/settings/connections/page.tsx`,
`components/settings/{connections-workspace,connection-card,reconnect-alert,oauth-return,notifications-card,backfill-card}.tsx`.

Verified:

- [x] Owner with the stub connection: table at 1280, labelled rows at 320,
      long email wraps.
- [x] Disconnect dialog fits at 320, 390 and 1280; focus on the
      acknowledgement; Disconnect disabled until ticked (nothing submitted).
- [x] Notifications load error keeps the "Real-time notifications" heading
      and region.
- [x] Heading order: `h1`, then `h2` Google accounts, Real-time
      notifications, Setting up a client.
- [x] No overflow and no console errors at all 11 widths.
- [x] Builder only: member denied; empty (no login); error with Try again;
      `?google=error&status=400|401|403|429|503`; `?google=connected`;
      `?reconnect=<id>`; Pub/Sub topic validation; dark 1280; WebKit 390.

Not verified:

- [ ] WebKit by the verifier.
- [ ] `?google=` and `?reconnect=` states re-run by the verifier (code read).
- [ ] A real OAuth round trip.
- [ ] Notifications card with real fixture data (stub gap, see below).

Gaps: the backfill table and "Locations found on Google" stay in `/setup`;
the `h1` stays "Google Business Profile" (tests).

## Known gaps (app has no data for this)

What the reference shows but the app renders without, because no API,
model or endpoint provides it. None were invented.

| Area                  | Missing from the app                                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                  | Agency name on create account; lockout countdown (no retry-after); confirmed, signed-out and password-changed statuses; token pre-validation on reset; inviter name on invitations.                                                |
| Access denied, errors | Owners/admins by name for non-managers; per-role capability list; a request id for render errors (digest only).                                                                                                                    |
| Inbox                 | Per-queue Google sync time; assignee in the detail head; specific check texts (generic Pass/Check/Fail); long reviews and media on the fixture.                                                                                    |
| Reports               | "Actions by location"; keyword Location, Previous and Change columns; CSV export; by-location Status column and row actions; deltas against a previous period; one shared Period (the endpoints use different range vocabularies). |
| Client hub            | Recent activity feed; "Changes not on Google" tile; per-listing import progress.                                                                                                                                                   |
| Listing overview      | Public Maps URL ("Open on Google"); listing code for the eyebrow.                                                                                                                                                                  |
| Profile               | Category descriptions; service-area field.                                                                                                                                                                                         |
| Hours                 | "Open 24 hours" (no flag); overnight "next day" (closeDay equals openDay).                                                                                                                                                         |
| Booking               | A category-based "not eligible" signal (every type is always supported).                                                                                                                                                           |
| Photos                | Per-category counts and a cover/logo filter; "Use as cover" (COVER is create-only).                                                                                                                                                |
| Posts                 | Edit flow; library photo picker; send-back reason; author and approver.                                                                                                                                                            |
| Menu                  | Dietary, spice, allergen vocabulary; editable item options; item photos.                                                                                                                                                           |
| Verification          | Attempt history; attempt counter.                                                                                                                                                                                                  |
| People                | Resend or cancel for outgoing invitations.                                                                                                                                                                                         |
| Team                  | Per-client access (per-listing grants only); Last active; Resend; Undo on revoke.                                                                                                                                                  |
| Settings              | Banned terms, low-rating threshold, tone, "Restore safe defaults", Compliance (privacy requests, legal holds, audit export), "last saved by".                                                                                      |
| Connections           | Review counts for backfill progress bars.                                                                                                                                                                                          |

Fixture limits (the app has the capability, the fixture has no data):
one client (no mixed health, no client chip rows), one organisation per user,
no unfiled listing, no unfiled listings to assign, no pending or expired
invitations, no two editable booking links of one type, requester and
approver cookies resolving to "Harness tenant" (approval states checked with
mocked capabilities), and a Google stub that answers
`/api/google/notifications` with an accounts list and does not list newly
created booking links.

## Server-side findings outside the redesign

Recorded, not fixed: the brief forbids changing API routes, `lib/server`,
migrations and permission checks for the redesign.

- **Archive `PATCH` returns `{client: null}`.** `PATCH /api/clients/[id]`
  with `archived: true` succeeds, but `loadClientSummary`
  (`lib/server/clients.ts`) only lists unarchived clients, so the reply is
  `{client: null}` and `apiFetch`'s schema throws `malformed_response`. The
  UI works around it by re-reading the client and treating a 404
  `client_not_found` as proof (`components/clients/client-settings.tsx`).
- **Local owner bootstrap under `next dev`.** `GET /api/session`
  (`app/api/session/route.ts`) calls `ensureDevelopmentSession()` whenever
  `NODE_ENV !== "production"`, and the dashboard layout
  (`app/(dashboard)/layout.tsx`) skips the sign-in redirect under the same
  condition, whatever `LOCAL_BOOTSTRAP_ENABLED` says (`isLocalBootstrapEnabled()`
  only matters in production). So under `next dev` an expired or missing
  session is silently replaced by the local owner session. During this work
  that made wiped fixture cookies resolve to the placeholder or real dev org
  without any error.
- **OAuth callback errors never reach setup.**
  `app/api/google/connect/callback/route.ts` sends every error to
  `/settings/connections`, so the `?google=error` alert in `/setup` cannot be
  reached. Keeping the signed `returnTo` on the error branch would fix it.
- **Setup attribution.** The server attributes a Google login to a client
  only through a linked listing; the wizard's reachability now also counts an
  active organisation login (client-side only; `nextStep` unchanged).
- **Listing health counts `unknown` as healthy.** `lib/listings/health.ts`
  makes the board and area header pill say "In sync" for areas never compared
  with Google (the overview tile and description were corrected).
- **Two-person rule while approval is off.** The switch is hidden, but the
  server still enforces the stored value.
- **Org publishing flag ignored with per-listing grants.** The server uses the
  grants; the UI now disables the toggle for such members.
- **No resend or restore endpoints** for invitations (team and listing
  people), and the invite API creates a link without emailing it.
- **Fixture Google stub:** `/api/google/notifications` returns an accounts
  list, so the notifications card shows its load error on `:3200`.

Environment notes, not app defects: `127.0.0.1:3200` does not hydrate under
`next dev`; dates read "Sep" in WebKit and "Sept" in Chromium (engine locale
data); an untracked `Library/` folder (a pnpm store) sits in the repo root and
should not be committed.

## Follow-up verification

**For the lead to fill in.** A follow-up workflow was running alongside this
write-up and may verify states listed above as not verified. Record each
result here with the route, the state, the browser and width, the screenshot
path and the outcome, and tick or update the matching item in the route
section. Until an entry appears here, the route sections above are the
record.

| Route | State | Browser, width | Evidence | Outcome |
| ----- | ----- | -------------- | -------- | ------- |
|       |       |                |          |         |

## Prototype launcher and `/design-system` evidence page

These are not product routes and are kept apart from the list above.

### `index.html` (prototype launcher)

The reference's route and state inventory, with links to each route's
`?state=` variants and the redirects table. It exists only in the Open Design
project. It has no counterpart in the app and nothing in it is a requirement;
the `?state=` switches it links to are prototype simulations the app must not
reproduce.

### `/design-system`

|             |                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reference   | `design-system.html` (with `assets/np.css`, `assets/np.js`)                                                                                                  |
| Status      | done                                                                                                                                                         |
| Widths      | 320, 390, 768, 1280, 1440                                                                                                                                    |
| Browsers    | Chromium only                                                                                                                                                |
| Screenshots | `$SCRATCH/shots/sec` (per section at 390 and 1280, light and dark; `i-*.png` for the open sheet, dialog, menu and toast) and `$SCRATCH/shots/ds` (full page) |

Files: `app/design-system/page.tsx`, `app/design-system/interactive-demos.tsx`,
`app/design-system/contrast-evidence.tsx`, plus the shared primitives in
`components/ui/` listed in the identity spec.

The page is internal evidence: gated by `DESIGN_SYSTEM_EVIDENCE_ENABLED`, off
in production, calls no API, and shows sample figures that are labelled as
such.

Verified:

- [x] axe WCAG 2.2 AA: 0 violations, light and dark, at 390 and 1280.
- [x] No horizontal overflow at 320, 390, 768, 1280, 1440.
- [x] The dark-theme sample block sits beside the current theme.
- [x] Sheet: right panel at 1280, 92dvh bottom sheet at 390.
- [x] Alert dialog footer stacks at 390, primary on top.
- [x] Dropdown menu shows a disabled item with its reason.
- [x] Toast is charcoal, bottom right.
- [x] Validation summary takes focus on submit; its link focuses the field.
- [x] Tag input: Enter adds, Backspace removes.
- [x] Pending button shows its spinner.
- [x] Responsive table switches to labelled rows at 390.
- [x] Lifecycle switches to vertical under 520px.

Not verified:

- [ ] WebKit.
- [ ] Coarse-pointer 44px sizing (not emulated).
- [ ] The theme toggle, beyond confirming hydration.

Gaps:

- `h1` "NabaPresence design system" and the five `h2#section-*` headings are
  kept because `tests/e2e/accessibility.spec.ts` pins them; the reference's
  eleven sections appear as `h3` groups and a table of contents.

Checks the foundation work reported: `pnpm exec tsc --noEmit -p .` clean apart
from an existing TS5097 in `tests/visual/fixture-server.ts`;
`pnpm exec eslint components/ui lib/ui app/design-system` clean;
`pnpm exec vitest run tests/components tests/design-system-contract.test.ts tests/design-tokens-contrast.test.ts`
117 files, 1169 tests passed on the final run.

## Redirects (behaviour unchanged)

No screens; they resolve before rendering. None of them changed in the
redesign. The retired routes are `RETIRED_ROUTES` in `next.config.ts`
(temporary redirects); the root and the flat single-business routes are
server pages that call `redirect()`.

| From                                                             | To                                                                                                | Where                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `/`                                                              | `/inbox` when signed in (or anonymous access is allowed outside production), otherwise `/sign-in` | `app/page.tsx`                              |
| `/home`, `/overview`, `/reviews`                                 | `/inbox`                                                                                          | `next.config.ts`                            |
| `/analytics`, `/performance`                                     | `/reports`                                                                                        | `next.config.ts`                            |
| `/locations/:id/performance`                                     | `/reports?locationId=:id`                                                                         | `next.config.ts`                            |
| `/login`                                                         | `/sign-in`                                                                                        | `next.config.ts`                            |
| `/connections`                                                   | `/settings/connections`                                                                           | `next.config.ts`                            |
| `/settings/team`                                                 | `/team`                                                                                           | `next.config.ts`                            |
| `/locations`                                                     | `/listings`                                                                                       | `next.config.ts`                            |
| `/locations/:id/administration`, `/locations/:id/access`         | `/listings/:id/people`                                                                            | `next.config.ts`                            |
| `/locations/:id/business-information`, `/locations/:id/industry` | `/listings/:id/profile`                                                                           | `next.config.ts`                            |
| `/locations/:id/:area`                                           | `/listings/:id/:area`                                                                             | `next.config.ts`                            |
| `/locations/:id`                                                 | `/listings/:id`                                                                                   | `next.config.ts`                            |
| `/profile`                                                       | `/listings/{only visible listing}`, otherwise `/clients`                                          | `app/profile/page.tsx`                      |
| `/profile/hours`, `/profile/menu`, `/profile/booking`            | that area of the only visible listing, otherwise `/clients`                                       | `app/profile/[...section]/page.tsx`         |
| `/profile/details`, `/profile/industry`                          | `/listings/{only visible listing}/profile`, otherwise `/clients`                                  | `app/profile/[...section]/page.tsx`         |
| `/photos`, `/posts`                                              | that area of the only visible listing, otherwise `/clients`                                       | `app/photos/page.tsx`, `app/posts/page.tsx` |
| `/settings/listing`                                              | `/listings/{only visible listing}/people`, otherwise `/clients`                                   | `app/settings/listing/page.tsx`             |

"Only visible listing" is `flatRouteTarget` in
`lib/server/flat-route-redirect.ts`: with exactly one visible location it goes
there, with none or several it goes to `/clients`.
