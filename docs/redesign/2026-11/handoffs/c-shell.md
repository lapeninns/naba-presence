# Handoff: c-shell (phase C2, SYSTEM §16 wave 3: shell)

- **Branch:** `redesign-2026-11/c-shell`, cut from `redesign-2026-11/integration` (`ab36cbb9`). Not pushed.
- **Implementation head:** `278a41f0`. The commit that adds this file sits on top of it.
- **Commits:**
  - `f50f7ce2` feat(shell): one scope control per size, neutral current place, Outbox destination
  - `f9a96d82` test(shell): cover the scope control, neutral current place and Outbox destination
  - `cd47437d` style(shell): prettier
  - `278a41f0` fix(shell): review findings on the scope control
- **Ownership respected:** I did not edit `app/globals.css`, `components/ui/**` or `scripts/design-baseline.json`.

## What changed

### Navigation (DIRECTION §7.1/§7.2, D4)
- **`lib/navigation/destinations.ts`**
  - New `outbox` destination: `/outbox`, lucide `Send` icon, primary group.
  - Two new gates:
    - `sendersOnly`: owner, admin and member only. Hidden for viewers and while the role is unknown.
    - `needsOutbox`: needs `NavigationContext.showOutbox`.
  - Registry order is now Inbox, Listings, Clients, Calendar, Reports, Outbox, then the Workspace group. That gives agency `…Calendar, Reports, Outbox` and business `Inbox, Listings, Calendar, Reports, Outbox`.
  - `moreDestinations` follows DIRECTION order: Outbox, Calendar (agency), Notifications, Team, Settings.
  - Phone tabs are unchanged: agency Inbox, Listings, Clients, Reports; business Inbox, Listings, Calendar or Notifications, Reports.
  - The agency Reports description is reworded.
  - All existing permission, mode and `post_scheduling` gates are kept.
- **`lib/navigation/outbox.ts`:** new route-existence guard, `OUTBOX_ROUTE_READY = false`. The shell context, the palette's Go to group and `PALETTE_GO_TO` all honour it, so no link can 404. The worker that builds `app/(dashboard)/outbox` flips it in the same commit.
- **Current place uses one neutral style, with no accent and no bar:** `bg-fill`, ink, semibold, icon stroke 2.
  - Sidebar and rail rows: `nav.tsx`.
  - Tab bar: ink icon on a 56×28 `bg-fill` pill (`data-slot="tab-pill"`), applied to both tabs and More (`tab-bar.tsx`).
  - More sheet rows: `more-sheet.tsx`.
  - Scope menu tick: `CurrentMark` is now ink.
- **Pinned clients are removed** from the sidebar (D8).
- **`CountBadge`** uses sans `tabular-nums` (D11). Badges stay neutral ink.

### Scope (DIRECTION §7.3, D8)
- **One model, three sizes.** `useScopeControl(mode, organisationName)` in `scope-sheet-model.tsx` drives `ScopeControlView` in `client-switcher.tsx` at three sizes:
  - `sidebar`: the "Working on" button from `wide` (1180px). Mark, name, then a dot plus words on a second line. Opens the menu (≤ 8) or the cmdk searchable list.
  - `pill`: first item in the tablet top bar, 768–1180 (`wide:hidden`).
  - `chip`: phone app bar, opening the "Working on" sheet.
- **Accessible name:** `Working on <title>, <N listings> · <health words>`, for example "Working on Journey Hospitality, 9 listings · Needs attention". After a failed refetch the health part reads "Data may be stale".
- **Business mode:**
  - Title is the business name. Detail is "All locations" or the one location. The phone chip shows the location or "All locations".
  - The words "client" and "agency" never appear.
  - The desk opens a popover holding the same `BusinessScopeList` as the phone sheet (extracted in `scope-sheet.tsx`).
- **Nothing to switch** (one client or one location): the control is drawn static (`data-static`, not a button) but still states the scope and its health.
- **Org-wide pages** (`scoped:false`: Team, Settings, Notifications) show no scope control at any size.
- **`ContextHealthChip` is retired.** `ShellHealthAnnouncer` (live region) and `useContextHealth` stay. The latter feeds the More sheet's Connections row, which shows only when there is nothing to switch.
- **Shared words** for sheet, menu and search rows: "9 listings · health", from `lib/clients/scope-words.ts`.
- **Deep links:** `?clientId=` is untouched (`lib/clients/scope.ts` not edited; the address still wins). A test covers it: `?clientId=c1` beats a remembered c2.

### Bars
- **Phone app bar (52px)**
  - Leading:
    - Scope chip on top-level scoped pages.
    - "‹ Parent" back link on deep pages: up, not back in history; `back-target.ts` unchanged. Back links are ink now (D12), and the page action in the bar is ink too.
    - Workspace name plus title echo on org-wide pages and before the scope is known.
  - Trailing: search, which is omitted on the Inbox because it has its own search. The bell lives in More on phones and appears in the bar only while a task bar is docked and the tab bar has stepped aside.
- **Tablet top bar (56px):** scope pill, back link, search as an icon (a field from `lg`, 1024px), bell.
- **Desktop top bar:** breadcrumbs, search field (⌘K, `wide:min-w-72`), bell.
- **More sheet:**
  - Search drawn as a field.
  - "Working on" row, named `…, Change`.
  - Go to list.
  - Account block (unchanged).
- **Unchanged and preserved:**
  - Skip link.
  - `RouteFocus`.
  - The chrome contract: one bottom bar, and the tab bar hides while a dock or the keyboard is up (CSS in globals, untouched).
  - Safe areas.
  - 44px targets on touch.
  - Reduced-motion fade.
  - Palette shortcuts (⌘K and `/`).
- **`main`:** the literal `[@media(min-height:620px)]` is now the `tall:` variant (part of D27).

### Server
- `app/(dashboard)/layout.tsx`: comment only. Auth, redirects, tenant reads, prefetch and hydration are unchanged.

## Changed paths
`app/(dashboard)/layout.tsx`; `components/app-shell/{app-bar,app-shell,client-scope-rows,client-switcher,command-palette,command-palette-dialog,context-health-chip,count-badge,more-sheet,nav,scope-sheet,scope-sheet-model,tab-bar,topbar}.tsx`; `lib/clients/scope-words.ts` (new); `lib/navigation/{destinations.ts,outbox.ts (new)}`; tests: `tests/components/{app-bar,app-shell,business-mode-shell,client-switcher,command-palette,context-health-chip,more-sheet,nav,scope-sheet,tab-bar}.test.tsx`, `tests/navigation-destinations.test.ts`, `tests/e2e/{accessibility,business-mode,foundation,journeys,reports,toolbar-back-target}.spec.ts`, `tests/agentic/{client-switching,tablet-back}.e2e.ts`, `tests/visual/nm-capture.mjs`.

## Acceptance → evidence

| Criterion | Evidence |
|---|---|
| Destinations per mode and role, plus Outbox gating | `tests/navigation-destinations.test.ts` Outbox block (owner/admin/member visible in both modes, viewer and null role hidden, hidden without `showOutbox`, sidebar order, tabs unchanged, More starts with Outbox); `nav.test.tsx`; `more-sheet.test.tsx` |
| Scope control's accessible name carries the health words | `client-switcher.test.tsx` (sidebar, pill, business pill, static), `scope-sheet.test.tsx` (agency and business chip, stale data, `?clientId=` deep link), `app-bar.test.tsx`, `app-shell.test.tsx` |
| Tab bar current state is neutral | `tab-bar.test.tsx` (aria-current, `tab-pill` fill class, stroke 2, no accent; More `data-current`) |
| More sheet contents | `more-sheet.test.tsx` (order with Outbox, scope row name, Connections row when not switchable, neutral current row) |
| Back link targets and ink colour | `app-bar.test.tsx` (deep pages, `/clients/c1` → "Back to Clients", `text-ink`); `tests/back-target.test.ts` unchanged and passing |
| No health chip; no pinned clients | `app-shell.test.tsx`, `nav.test.tsx`, `business-mode-shell.test.tsx` |
| Org-wide pages show no scope | `client-switcher.test.tsx` (`/team`, `/settings`, `/settings/billing`), `app-bar.test.tsx` |
| Rendered layout at every viewport, safe areas, keyboard, overlap | **Not verified: needs render** (see the matrix below) |

## Commands and exit codes (final head `278a41f0`)

| Command | Exit | Note |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | First attempt hit npm 502s; the retry passed |
| `pnpm typecheck` | 0 | |
| `pnpm lint` | 0 | |
| `pnpm format:check` | 0 | |
| `pnpm check:design --ratchet` | 0 | 11 findings removed across 5 files. Baseline **not** updated, because c-system edits the same file; the orchestrator can run `--update-baseline` after merge |
| Targeted vitest (28 files: destinations, back-target, client-scope, breadcrumb-trail, breakpoints, perf lab-results, and every shell/nav/scope/tab-bar/app-bar/more/palette/route-focus/notices component test) | 0 | 571 passed |
| `pnpm test` | 1 | 10087 passed, 39 failed, 38 skipped. **All 39 failures are environment-blocked**, in non-shell files: `google-transport` (network), `notifications-email`, `server/postgres-docker-ownership` (`listen EPERM`), `server/run-test-command-guard` (timeout on EPERM), `server/runner-pre-job-hook` (`mkdtemp` EPERM in /private/tmp). Not passes, and not caused by this branch |
| `pnpm build` (webpack) | 0 | `AGENTS.md` not rewritten |
| e2e / agentic / Playwright | not run | Sandbox blocks port binding and browsers. The specs were statically updated, and `tsc` passes on them |

**Defects found during verification, all fixed in `f9a96d82` and `278a41f0`:**
- The test-update agents found that the desk trigger lost its `data-slot` to the Base UI trigger props.
- An independent review workflow (three lens reviewers, each finding adversarially verified) confirmed four more:
  - the More sheet used a stale organisation name;
  - the business phone chip hid the location;
  - "Change" was missing from the More row's accessible name;
  - the static control showed a hover border.

## For the orchestrator: what to render

**Engines and input:** Chromium, plus WebKit if available. Touch for widths ≤ 1024 at tablet presets, mouse at desktop. Light **and** dark themes.

**Widths:** 320, 360, 390, 430, 600, 767, 768, 834, 1024, 1179, 1180, 1280, 1440, 1920. Also short heights 390×600 and 1024×600, and landscape 844×390.

**Routes, agency owner (Sprint 5 Journey tenant):**
- `/inbox` (scope chip/pill/sidebar; bell docked-only on phone)
- `/inbox?clientId=<id>` (deep link wins)
- `/listings`
- `/listings/<id>/hours` (deep: back link "‹ Listing", dock plus tab bar never both)
- `/clients`
- `/clients/<id>` (back link)
- `/reports`
- `/team`, `/settings`, `/notifications` (no scope control; workspace name on phone)
- `/setup` (Clients current)

**Business owner:** `/inbox`, `/inbox?locationId=<id>` (chip shows the location), `/listings`, `/settings`.

**Viewer:** `/inbox` (no Outbox anywhere; also confirm the flag is off for everyone).

**States:**
- More sheet open (phone).
- "Working on" sheet open, including a pushed client's locations.
- Desk scope menu open (≤ 8 clients) and searchable list (> 8 clients, if a fixture exists).
- Business desk popover.
- Command palette open from the tablet search icon and the desktop field.
- Keyboard up on a phone form (tab bar hidden).
- Reduced motion.
- Stale data: a failed clients refetch shows "Data may be stale" in the control.

**What to check:**
- The current place reads as fill plus weight with no green at any size.
- The tab-bar pill sits behind the icon.
- Count badges are legible on the current rail tile.
- At 320px the chip truncates without pushing search off the screen.
- The sidebar "Working on" second line wraps to two lines at 240px.
- The pill doesn't squeeze the back link at 768 and 834.
- 1179 vs 1180 switches rail → sidebar and pill → sidebar button.
- 767 vs 768 switches tab bar → rail.
- Focus moves to the h1 after navigating from a tab, rail row or More row.

## Tokens needed from c-system
None blocking: the shell uses existing utilities only (`bg-fill`, `text-ink`, `text-ink-secondary`, `rounded-(--np-radius-pill|control)`, `hover-fine`, `desk`, `tall`, `wide`). Nice-to-have:
- A **28px mark size** for the scope control (SYSTEM §10 says 28; I used ClientAvatar `sm` = 32 and `size-6` for the pill).
- An optional `--np-scope-pill-max-w` to replace `max-w-[45vw] lg:max-w-md` on the tablet pill.
- Dark `--np-fill` 0.28 (SYSTEM §15) is what the current-place fill depends on, so please confirm it lands.
- The skip link still uses `bg-primary`. It follows c-system's `--primary → ink`.

## Open defects / limits
- **Outbox has no count badge yet.** SYSTEM §10 wants failures only, in danger ink with `triangle-alert`. There is no read model to feed it, so it is left for the Outbox page worker.
- **The phone bell is in More, per the brief.** The concept image shows it in the app bar; the brief and DIRECTION §7.1 say More on phone. The bar shows it only while a task bar is docked.
- **No "Inbox 12" count echo on phone top-level scoped pages.** The chip owns the leading slot there, and the Inbox tab badge still shows the count.
- **Agency with exactly one client:** the static control reads "All clients…" until `ClientScopeSync` fills `?clientId=` (current `currentClientId` behaviour, not changed).
- **Concept extras not built:** the desk menu footer ("New client", "All clients page") and listing counts on the business desk popover header. The palette still offers "New client".
- **E2E and agentic specs are statically updated but unrun.** They need the orchestrator's browser run.
- `PALETTE_GO_TO` with `paletteEntriesFor` has no `sendersOnly` gate. Only a test uses it; the live palette uses `visibleDestinations`, which does gate.

## Decisions to confirm
1. **Outbox gate = route-existence constant** (`lib/navigation/outbox.ts`), not an org feature or env flag.
   - **Alternatives:** an org feature in `lib/contracts/org-features.ts`, or a `NEXT_PUBLIC_*` flag.
   - **Why:** there is no client env-flag pattern in the repo; Outbox reads states every tenant already has; and the later page worker flips one line.
2. **Outbox `scoped` left unset:** no `?clientId=` is carried, and the scope chip still shows on `/outbox`.
   - **Alternatives:** `scoped: true` (follows the client) or `false` (org-wide, no chip).
   - **Why:** DIRECTION calls it cross-scope. The page worker can choose.
3. **Phone top-level pages keep the scope chip** instead of cross-fading to the title echo on scroll.
   - **Alternative:** the large-title echo as before.
   - **Why:** "one scope control per size" should stay reachable.
4. **The static control is still drawn** when there is nothing to switch.
   - **Alternative:** hide it, as before.
   - **Why:** the retired health chip's words need a home at every size.
5. **The More sheet keeps a "Working on" row** (or Connections when not switchable), even though DIRECTION §7.2's More list omits it.
   - **Why:** on deep phone pages the app bar shows the back link, not the chip, so scope and health would otherwise be unreachable.
6. **Scope detail wording is "N listings · <health label>"**, using existing `healthLabel` and `summariseHealth` words rather than the concept's sample words ("in sync", "1 failed send").
7. **Inactive nav rows are `text-ink-secondary`, and the current row is `text-ink`**, plus fill and weight.
8. **The design baseline is not regenerated** on this branch, to avoid conflicts with c-system.
