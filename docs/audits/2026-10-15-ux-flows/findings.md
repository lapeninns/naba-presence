# UX flows audit: findings

Phase 1 of the frictionless-flows work (AMA-13). Audit only, no code changes. The fixes are grouped into slices in [plan.md](plan.md).

## Scope and evidence

- **App under audit:** `main` at `4e0fa805`. The 141-screen phone library "Naba Presence Mobile - Flows" (42 flows, 390pt at 3x) was captured from that commit with the visual fixtures. Screen paths below are relative to that library's root, for example `03 - Inbox/01 - Review detail/screen-02.webp`. The library lives on the owner's machine and is not committed.
- **Desktop:** 15 captures at 1280x800 (light), taken for this audit with `tests/visual/shoot.mjs` against the same fixtures. They are committed under [`desktop/`](desktop/), for example `desktop/listings--loc--hours.webp`.
- **Benchmark:** "Notion Mail iOS - Flows" (Mobbin, 31 flows). It was used for interaction patterns only: steps per task, sheets, gestures, density, empty states and feedback. Its branding was not used.
- **Rules that win:** `docs/specs/2026-10-13-mobile-first-design-system.md` (cited below as "the spec"), `docs/specs/2026-10-13-mobile-interaction-infra.md`, and the tokens in `app/globals.css` and `/design-system`.
- **Measurements:** `pnpm check:contrast`, `pnpm check:design`, `pnpm audit:mobile`, `tests/perf/perf-lab.mjs` and `tests/perf/route-js.mjs`, all run against the `visual-fixtures` and `visual-app` harness on the `flows-capture` worktree (`4e0fa805`). Raw summaries are in [`baseline/`](baseline/) and are the "before" figures for Phase 3.
- **Method:** four agents audited the flow families in parallel (Inbox and notifications; Listings and Calendar; Clients and Reports; Team, Settings, sign-in and the shell). A fifth audited the desktop captures. Each finding was checked against the code at `4e0fa805` and cites a screen and/or `path:line`. Findings reported by more than one family were merged into one entry, and the merged IDs are listed on it. Each finding appears once.

**Severity:** P0 blocks the task. P1 is friction that costs time, causes mistakes or misleads. P2 is polish.

**Roles:** the code has four roles: owner, admin, member and viewer (`lib/settings/roles.ts`). "Agency" and "business" are workspace modes, not roles. There is no "manager" role in the app, although the reply-approval toast uses the word (INB-15). "Manager" in listing invitations is Google's own role name (LST-26), which is correct.

**Lanes** (who fixes what in Phase 2): **Presence Platform** owns the shared components, the shell, the design system, the audit tooling, and Team, Settings and sign-in. **Listings & GBP** owns the listing, Google profile and Calendar flows. **Reviews & AI** owns Inbox, Notifications, Clients, client setup and Reports. Each slice in plan.md names its lane.

## Summary

| Family | P0 | P1 | P2 | Total |
| --- | --- | --- | --- | --- |
| Measurements | 0 | 1 | 3 | 4 |
| Inbox, reviews and notifications | 0 | 9 | 16 | 25 |
| Listings, Google profile and Calendar | 1 | 14 | 19 | 34 |
| Clients and Reports | 0 | 6 | 19 | 25 |
| Team, Settings, sign-in and the app shell | 0 | 3 | 32 | 35 |
| **All** | **1** | **33** | **89** | **123** |

123 findings after merging duplicates (the five audits reported 132, and those raised in more than one place were folded into one entry). There is one P0: food-menu changes are shown to the operator as raw JSON at the point of consent (LST-01). The P1s fall into five themes:

1. **Status that contradicts itself or Google:** "Live on Google" while still pending (INB-01), "In sync" for a listing with no hours (LST-18), "Needs attention" above "up to date" (CLR-13), and a Member role that promises listing edits it doesn't have (SET-01).
2. **Shared components bypassed:** editor bars with three equal buttons, or an idle bar on desk (LST-04, LST-05, CLR-16), a one-off approval sheet (LST-10), and tall hand-built rows in Team (SET-02).
3. **Content below the fold:** five header rows on listing areas and the board (LST-06, LST-07), and a screen of notices on Reports (CLR-02).
4. **Scope and steps:** two scope controls on Reports and in Inbox (CLR-01, INB-07), single-review triage through Select mode (INB-08), and publishing a post through the list (LST-11).
5. **Load and loading:** the `/inbox` first-load JS budget breach (INB-23) and listing areas that fetch after hydration (LST-14).

The automated accessibility checks are clean: axe 0, contrast 212 of 212, focus obscured 0, no horizontal overflow. The gaps are semantic and listed under RC-A11Y. The touch-target count needs fixing before it can be trusted (MEA-01). One-off components are listed at the end of each family section, each with the shared primitive it should use.


## Measured baseline (4e0fa805)

| Check | Result |
| --- | --- |
| `pnpm check:contrast` | All 212 colour pairs pass in both themes |
| `pnpm check:design --ratchet` | Passes. 106 token bypasses in 43 files: R1 type 12, R2 colour 9, R3 spacing 54, R4 radius/z 12, R5 raw primitive 1 (`window.confirm()` in `lib/hooks/use-dirty-guard.ts:134`), R6 inline style 2, R7 literal breakpoint 16 (`[@media(min-height:620px)]`). The top files are `app/design-system/page.tsx` (14), `components/inbox/inbox-view.tsx` (6) and `lib/clients/colours.ts` (6). |
| `pnpm audit:mobile` (36 routes × 320 light, 390 light, 390 dark, 1280 light, 1280 dark = 180 loads) | 0 load errors, 0 horizontal overflow, 0 axe violations, 0 focus obscured, 0 iOS zoom inputs, 0 console errors, h1/main landmark correct on every page. Phone chrome is at most 20.4% of the screen. Phone text floor holds: the committed `smallestTextPx` of 12 is at 1280 (desk captions, allowed), and no page at 320 or 390 has text under 13px (per-page data in the uncommitted raw JSON). `textUnder14Phone` 2016 counts 13px captions, which the spec allows. Flagged: **260** touch targets under 44px (but see MEA-01), 3 WCAG 2.5.8 target-size failures, and **76** clipped labels (SET-07). |
| `perf-lab` mobile (390, 4× CPU, Slow 4G, 3 cold runs, production build) | LCP 1.18-1.25s on 13 of 14 routes. CLS ≤ 0.018. TBT 35-164ms (highest on `/listings/{loc}/posts`). First-load JS is 245KB on `/sign-in` and 428-552KB on dashboard routes. Breaches against `tests/perf/budgets-baseline.json`, among the 14 routes perf-lab visits by default (the listing areas other than hours, photos and posts are not in its list): `/inbox` and `/inbox?selected=` first-load JS 552KB > 520 (INB-23), and `/settings/billing` LCP 3,336ms and lazy JS 72KB (MEA-02). |
| `perf-lab` desktop (1280, unthrottled, 2 runs) | The same two `/inbox` JS breaches. LCP is under 200ms except Hours (992ms) and Photos (580ms), which stream their Google read. |
| `route-js.mjs` | The dashboard shell's chunks, shared by all 34 dashboard routes: 42 files, 359.1KB gzip (baseline ceiling 400). |

The production server for perf-lab needed `PASSWORD_AUTH_ENABLED=false` as a process override, because the owner's local config enables password sign-in without the Supabase keys a production start checks for. Nothing else differed from the `visual-app` launch config. The harness ran on ports 3220/3221 because the owner's own dev server held 3200.

## Findings from the measurements

#### MEA-01 · The phone touch-target count mostly measures the wrong box — P1 · RC-TOUCH
- **Screen:** [`baseline/mobile-audit.md`](baseline/mobile-audit.md) (Top offenders tables)
- **Problem:** `audit:mobile` reports 260 phone targets under 44px. Most of them are primitives that already extend their hit area to `--np-touch` (44px) with an absolutely positioned `::before`/`::after`: `Button` `sm`/`icon-sm` (`components/ui/button.tsx:66-71`), `Switch` (`components/ui/switch.tsx:21`), `Checkbox` (`components/ui/checkbox.tsx:21`) and the chips (`components/ui/chip.tsx:46`, `:293`). The audit measures only the element's own box (`tests/visual/mobile-audit.mjs` has no pseudo-element handling), so "Check Google now" (151×20, a `link` `sm` button), the 16 notification switches (36×20) and the 36px row menus all count as failures. The baseline Phase 3 must compare against is therefore mostly noise, and it hides the few real offenders (MEA-03).
- **Evidence:** offender lists in `baseline/mobile-audit.md`. Per route at 390 light: `/settings/notifications` 16 switches, `/listings/{loc}/hours` 7 switches and 7 "Copy to…" `sm` buttons, `/listings/{loc}` 8 area-card links at 20×20 (`[data-slot=card-link]`, `components/ui/card.tsx:148-160`).
- **Affects:** the Phase 2 and 3 evidence, not users directly
- **Fix:** Teach `tests/visual/mobile-audit.mjs` to measure the effective hit area: the union of the element's box and any absolutely positioned `::before`/`::after` box (read with `getComputedStyle(el, "::after")` and the element's rect). Keep the raw box count as a second metric. Re-run it on `4e0fa805` and replace `baseline/mobile-audit-totals.json` before any slice is measured. `card-link` is a stretched link (its `::after` covers the card, `components/ui/card.tsx:150-153`), so the card is its target. Two limits to keep: the `sm` button and the chips extend only vertically (`inset-x-0`), so narrow ones are real failures; and the extended area must be clipped against any ancestor that scrolls or clips (TabNav, FilterChipStrip), or P01 would undercount.
- **Slice:** P01

#### MEA-02 · A disabled feature route takes 3.3 s to paint on a phone — P2 · RC-PERF
- **Screen:** [`baseline/perf-mobile.md`](baseline/perf-mobile.md) (`/settings/billing`)
- **Problem:** With billing off, `/settings/billing` renders "This page doesn't exist", but the mobile median LCP is 3,336ms, against about 1,230ms for every other route. It also loads 72KB of lazy JS, over the 60KB budget, and makes 14 RSC requests. Desktop LCP is 178ms, so the cost appears only under throttling. The cause was not traced.
- **Evidence:** `baseline/perf-mobile.md`, `baseline/perf-desktop.md`
- **Affects:** anyone who follows a billing link while billing is off; the route also needs measuring with billing on
- **Fix:** Find what the not-found path waits on (likely the settings layout's tab prefetches) and make a disabled area render the shared not-found without them. Needs owner setup to measure the enabled billing page.
- **Slice:** P22

#### MEA-03 · Short tab labels make targets narrower than 44px — P2 · RC-TOUCH
- **Screen:** `09 - Notifications/screen-01.webp`
- **Problem:** The Notifications "All" tab is 35.5×44px. `TabNav` items have no minimum width and no horizontal hit-area extension, so any one-word tab can fall under the 44px project floor.
- **Evidence:** `baseline/mobile-audit.md` (`[data-slot=tabs-tab]` 35.5x44 on `/notifications`); `components/ui/tabs.tsx:157-180`
- **Affects:** all roles
- **Fix:** Give tab items `min-w-(--np-touch)` on touch in `components/ui/tabs.tsx`.
- **Slice:** P04

#### MEA-04 · Desktop listing pages make 19 extra RSC requests on load — P2 · RC-PERF
- **Screen:** [`baseline/perf-desktop.md`](baseline/perf-desktop.md) (`/listings/{loc}`, `/hours`, `/photos`, `/posts`)
- **Problem:** At 1280 every listing area page makes 22-23 fetches, 19 of them RSC. At 390 the same pages make 3-4 fetches and 0 RSC. The likely cause is the desk-only area tab strip (`hidden lg:block`, `components/listings/area-frame.tsx:139-152`) prefetching all 11 areas. That has not been verified. If those prefetches reach the server's Google reads, each page view costs much more than it should.
- **Evidence:** fetch and RSC columns in `baseline/perf-desktop.md` against `baseline/perf-mobile.md`
- **Affects:** all desktop roles; server load
- **Fix:** Confirm the source. If it is the strip, prefetch on hover/intent only (`prefetch={false}` plus the shell's intent prefetch).
- **Slice:** L16

## Shared root causes

Each finding below carries one root-cause key. This section explains each cause once, so the findings don't repeat it. "Members" lists every finding with that key, P0 and P1 first. The shared fix is built once, in the Presence Platform slice named, before the flow slices that adopt it.

### RC-ACTIONBAR: action bars that bypass `ActionBar`
The spec has one `ActionBar` (`components/ui/action-bar.tsx`). It docks on a phone, rides the keyboard, appears with the first change, and carries one primary action with the rest in an overflow (`primary` + `secondaryActions`). It also publishes its measured height (`--np-dock-bar-h`), which the toast and scroll padding read. Editors and forms that predate it hand-roll the same job. The editor footer uses the free-form `actions` prop, Review & publish pins itself with `max-md:fixed`, and client forms use an inline `CardFooter`. Each loses one part of the contract: one primary, docking, the measured height, or hiding when clean.
**Shared fix:** P02 moves the editor footer and Review & publish onto `ActionBar` and hides the idle bar at every width. Flow slices then adopt it for the forms in their area.
**Members:** INB-02 (P1), INB-03 (P1), LST-04 (P1), LST-05 (P1), CLR-16 (P1), INB-17 (P2), CLR-10 (P2), CLR-14 (P2), SET-14 (P2)

### RC-SHEET: overlays that don't share one anatomy
The overlay foundation (`components/ui/overlay.tsx`) gives dialogs, menus and selects a bottom sheet on a phone. But each primitive draws its own header and footer, so dismiss and confirm look different in every sheet (×, Cancel, Keep editing, Close; grabber or none). Feature code also builds whole flows in sheets where a shared set already exists (`components/reviewed-write/*`), or stacks a sheet on a sheet.
**Shared fix:** P03 puts one header and footer recipe in `overlay.tsx`, makes `title` required for phone `SelectContent`, and documents it in `/design-system`. L08 and L13 move their flows onto `ReviewedWriteSheet`.
**Members:** LST-10 (P1), SET-03 (P1), CLR-11 (P2), SET-13 (P2), DSK-23 (P2)

### RC-FEEDBACK: feedback that waits, repeats or stacks
Mutations update the screen only after the server answers (no `onMutate`). Errors appear far from what failed. One outcome is announced three times (step, banner, toast). Repeated actions pile up toasts. Notion Mail's pattern is optimistic change, one short toast, and Undo.
**Shared fix:** P07 adds replace-by-id to the toast manager and documents the optimistic-toggle and Undo pattern in `/design-system`. Flow slices then apply it.
**Members:** INB-01 (P1), LST-13 (P1), INB-18 (P2), INB-21 (P2), INB-24 (P2), LST-26 (P2), CLR-07 (P2), SET-06 (P2)

### RC-CONFIRM: confirmation dialogs where Undo fits
Reversible or local actions (archive a client, mark "No reply needed", regenerate a draft) ask for confirmation, sometimes with a checkbox as well. Google writes keep their consent step by rule D5. Local actions should act at once and offer Undo.
**Shared fix:** the Undo pattern from P07. Some cases need a server-side undo, which is an owner decision.
**Members:** INB-09 (P2), CLR-22 (P2)

### RC-STATES: empty, loading and error states that mislead or dead-end
There is one vocabulary (`Empty`, `QueryStates`, `Skeleton`), but feature code decides what each state says without the context it needs. Examples: a role-blind call to action that leads to Access denied, "In sync" when Google has no hours, skeletons shaped unlike the content, and empty states with no next step.
**Shared fix:** P08 fixes `QueryPending` (one indicator) and the two system pages. The rest are local fixes in each flow slice.
**Members:** INB-06 (P1), LST-18 (P1), INB-14 (P2), LST-27 (P2), LST-28 (P2), CLR-08 (P2), SET-09 (P2), SET-19 (P2), SET-20 (P2), DSK-14 (P2), DSK-22 (P2)

### RC-LISTROW: rows that aren't `ListRow` or `SettingsRow`
The spec's record card is "headline, subtitle, one meta line, trailing status". `ListRow` and `SettingsRow` implement it. Team, notification settings, hours, the client hub and connection cards instead draw tall multi-line blocks, so a phone shows 2-3 items per screen, and switches sit in three different places.
**Shared fix:** the primitives exist. P10 adds trailing swipe actions with a visible button alternative to `ListRow`. Flow slices then adopt the rows.
**Members:** INB-08 (P1), SET-02 (P1), LST-16 (P2), LST-23 (P2), LST-24 (P2), CLR-15 (P2), CLR-20 (P2), SET-05 (P2), SET-10 (P2), SET-28 (P2), DSK-10 (P2), DSK-11 (P2), DSK-12 (P2)

### RC-NAVSTRIP: tab and chip strips that hide what matters
Strips scroll with a fade and no visible alternative at desk width. They show "0" and "–" chips that mean nothing, and two chip primitives use two pressed styles (`chipClassName` with `bg-ink`, and `filterChipClassName` with `bg-accent-tint`). As a result, labels and the current item get cut off ("Sugges…", "Partially ch…").
**Shared fix:** P04 gives `TabNav` a desk overflow mode, tab items a minimum touch width, `TabCount`/`ChipCount` one zero rule, and filters one chip primitive. L03, R07 and R16 adopt them.
**Members:** CLR-19 (P1), INB-11 (P2), CLR-24 (P2), DSK-01 (P2)

### RC-APPBAR: shell chrome that crowds or repeats
The phone app bar packs the workspace name or back label (up to half the width), a scrolled title echo, and up to two trailing controls, one of them a scope chip of up to 40vw. The title the user needs is what gets cut (76 clipped labels measured). On desk, one-crumb trails repeat the h1, the sidebar hides Team and Settings behind More even with room to spare, and two rows can be `aria-current`.
**Shared fix:** P05 (phone app bar), P06 (desk navigation) and P15 (settings shell).
**Members:** INB-12 (P2), INB-13 (P2), CLR-21 (P2), SET-04 (P2), SET-07 (P2), SET-11 (P2), SET-26 (P2), SET-27 (P2), DSK-05 (P2), DSK-06 (P2), DSK-07 (P2), DSK-08 (P2)

### RC-SCOPE: client scope set in more than one place
The app-bar scope chip is the agency's client scope (`scope-sheet-model.tsx`). Inbox also counts the client as a filter, with a chip and a Filters-sheet select, and "Clear all filters" resets it. Reports draws a second scope pill with its own sheet of selects. Team and Settings show the chip although they ignore it. Each extra control is another place to change, or lose, the scope.
**Shared fix:** P05 makes the chip appear only on scoped destinations (`scoped: false` in `lib/navigation/destinations.ts`). R05 and R12 then remove the page-level copies.
**Members:** INB-07 (P1), CLR-01 (P1), SET-08 (P2)

### RC-DENSITY: captions and controls stacked above the content
On a phone the first row or figure sits about halfway down the screen, under the page description, scope, freshness line, model note, provenance, notices and tool rows. Every block is reasonable on its own, and together they push the task below the fold. The spec calls this out for listing areas ("three or four controls before any content").
**Shared fix:** no primitive. Each flow slice folds secondary lines into one caption or an info sheet, targeting two rows above the content.
**Members:** LST-06 (P1), LST-07 (P1), CLR-02 (P1), LST-20 (P2), CLR-12 (P2)

### RC-COPY: internal words, raw values and contradictions on screen
Enum and API values reach users through generic humanisers ("Regularhours", "Publish google", `NOT_FOUND`, raw JSON). Internal terms appear in copy ("window", "lifecycle", "merchant standing", "parked"). One object goes by three nouns (location, listing, venue). Copy also contradicts the product: Member "edits listings", "Live on Google" while still pending. Several of these happen at the point of consent.
**Shared fix:** P11 adds shared vocabulary helpers (one place-noun in `lib/workspace/terms.ts`, and time and time-zone formatters). Label maps replace generic humanisers in each flow slice, and an unknown key renders as "Other change", never a raw token.
**Members:** LST-01 (P0), LST-02 (P1), LST-09 (P1), CLR-13 (P1), CLR-18 (P1), SET-01 (P1), INB-15 (P2), LST-15 (P2), LST-17 (P2), LST-19 (P2), LST-21 (P2), LST-25 (P2), LST-31 (P2), CLR-03 (P2), CLR-05 (P2), CLR-06 (P2), SET-12 (P2), SET-16 (P2), SET-17 (P2), SET-21 (P2), SET-23 (P2), SET-29 (P2), DSK-15 (P2)

### RC-FORMS: fields that ignore input hints or carry extra steps
Wrong keyboard (typed email confirmation with no `@` key), a native number spinner, borderless fields, a typeable combobox where a select fits, a confirm-password field beside a reveal toggle, short values in desk-wide fields.
**Shared fix:** P09 covers `TypedConfirmation` input hints and a desk measure for short `Field`s. The rest are local.
**Members:** LST-12 (P1), INB-10 (P2), INB-16 (P2), SET-15 (P2), SET-18 (P2), SET-24 (P2), DSK-18 (P2)

### RC-TOUCH: targets and primary actions out of reach
Primary actions sit at the top of tall phone pages and scroll away (principle 4: bottom third). A few real targets fall under 44px. The measured count is inflated by MEA-01.
**Shared fix:** P01 (measure the effective hit area) and P04 (tab minimum width). Thumb reach is fixed per flow.
**Members:** MEA-01 (P1), LST-03 (P1), MEA-03 (P2), INB-19 (P2), SET-25 (P2)

### RC-PERF: data that starts loading late, or JS loaded up front
Several routes fetch their main data only after hydration (HTML, then JS, then API). Inbox ships every dialog in its first load. Some views fetch in a waterfall, or twice for one press.
**Shared fix:** the server-prefetch pattern (`HydrationBoundary`, `StreamedTab`) and `next/dynamic` already exist and are adopted per route.
**Members:** INB-23 (P1), LST-14 (P1), MEA-02 (P2), MEA-04 (P2), CLR-09 (P2), SET-22 (P2)

### RC-A11Y: accessibility gaps the automated checks don't catch
Axe, contrast and focus-obscured are clean (see the baseline). The gaps are semantic: the accessible name doesn't contain the visible label, toggle buttons stand in for a radio group, a motion opt-out is missing, two current pages are announced, and a time is read in the wrong zone.
**Shared fix:** local, apart from P06 (single `aria-current`).
**Members:** INB-22 (P2), LST-29 (P2), CLR-17 (P2), SET-30 (P2), DSK-09 (P2)

### RC-WRITEMODEL: one job, several routes to Google
The same "change a listing" job goes to Google four ways: editor save then publish, reviewed request then approve then send, immediate upload, or publish from a list. Sometimes the profile form mixes two of them. Users must learn the model field by field. Unifying it changes behaviour, so it needs an owner decision.
**Members:** LST-08 (P1), LST-11 (P1)

### RC-STATEGUARD: controls that stay live in a state they silently change
An editor or action stays enabled in a workflow state where using it quietly changes that state, for example regenerating a reply that is awaiting approval.
**Members:** INB-04 (P1)

### RC-NOTIFY: work waiting on a person isn't surfaced
Approvals and sent-back replies get no badge, count or notification. New notification kinds are a backend change and need an owner decision.
**Members:** INB-05 (P1)

### RC-CHART: charts that don't read on a phone
Peak and latest labels collide, 28 daily bars give about 10px tap targets, and an average rating is drawn as bars.
**Members:** CLR-04 (P2)

## Inbox, reviews and notifications

### Steps per flow

| Flow | Task | Now (taps) | Notion Mail equivalent (taps) | Gap |
| --- | --- | --- | --- | --- |
| Inbox (`03 - Inbox/screen-01`) | Open the next review that needs a reply | 1: tap the row (Needs reply is the default queue) | `03 - Mail/screen-01` → `01 - Email detail/screen-02`: 1 (tap the thread) | Same |
| Review detail › Replying (`03 - Inbox/01 - Review detail/01 - Replying to a review/`) | Write and publish a reply | 3: open the row; tap the box and type; Publish reply (saves, checks and publishes in one press). Toast, then the next review opens | `03 - Mail/01 - Email detail/01 - Replying to an email/screen-01…06`: 3 (open, reply and type, send), "Email sent · Undo" toast | Same count. Auto-advance is better; no undo, by design (Google write). The status contradicts itself after publishing (INB-01) |
| Using a suggested reply (`…/02 - Using a suggested reply/`) | Publish an AI draft | 4: open; tone (optional); Generate reply; Publish reply | No AI equivalent; nearest is Reply (3) | +1 (tone). The AI path could not be observed (fixture, see Needs owner setup) |
| Approving a reply (`…/03 - Approving a reply/`) | Requester submits, approver approves | Requester 3: open; Generate; "Publish reply" (actually parked for approval). Approver 3: Approval tab; row; Approve reply. Reject on a phone 6: ⋯, Reject reply, note, confirm after the first three | None | No benchmark. Nothing leads the approver to the work (INB-05). Labels mislead (INB-02, INB-03) |
| Review detail ⋯ (`03 - Inbox/01 - Review detail/screen-02`) | See history or details | 2: ⋯; History or Review details | `03 - Mail/01 - Email detail` ⋯: 2 (⋯, item) | Same |
| Filtering reviews (`03 - Inbox/02 - Filtering reviews/`) | 5★ reviews with text | 4: Filters; ★5; With text; "Show 1 review". Removing one filter: 1 (its chip) | `04 - Filtering emails/screen-01…03`: 2 (Filter, Unread only) | +2. The sheet has 10 groups and the lower ones (Reply status, Age, Dates, Sort) need a scroll (INB-10) |
| Searching (not captured; code only, `components/inbox/inbox-toolbar.tsx:59-69`) | Find a review | 1 plus typing: tap search (screen switches to search mode), type, results; 2: Cancel | `05 - Searching Notion Mail/screen-01…03`: 1 plus typing (search, type, results), Cancel | Same in code; not checked visually |
| Syncing reviews (`03 - Inbox/03 - Syncing reviews/`) | Pull new reviews from Google | 1: sync icon; spinner in place, then "Up to date" toast. Owners and admins only | None visible in the benchmark | Same for owners and admins. Members and viewers have no control and no freshness line (INB-18) |
| Switching client scope (`03 - Inbox/04 - Switching client scope/`) | Work on one client | 2: scope chip; client row; "Switched to …" toast | `06 - Switching account/screen-01…04`: 2 (avatar, account), "Switched to Sam's account" toast | Same count. Side effects: a filter chip and a filter-count badge, and "Clear all filters" resets the scope (INB-07) |
| Inbox › Select (`03 - Inbox/screen-02`) | Mark one review "No reply needed" | 4: Select; tick the row; No reply needed; Confirm | `03 - Mail/03 - Deleting a thread/screen-01…03`: 2 (swipe, Trash) with Undo toast; or `02 - Adding a label`: 4 (long-press, Label, tick, close) | +2 compared with swipe, and a confirm where Notion offers undo. No per-review action on the detail screen (INB-08, INB-09) |
| Notifications (`09 - Notifications/screen-01`) | Check problems | 1: bell (Inbox app bar), or More → Notifications | No equivalent | n/a. Only the empty state was captured |

### Findings

#### INB-01 · "Live on Google" and "Google is reviewing this reply" appear on the same screen — P1 · RC-FEEDBACK
- **Screen:** `03 - Inbox/01 - Review detail/01 - Replying to a review/screen-02.webp`, `03 - Inbox/01 - Review detail/03 - Approving a reply/screen-07.webp`
- **Problem:** After publishing, three places say "Live on Google": the toast ("Reply published · Live on Google."), the action bar status and the "Reply as …" subline. At the same time the banner at the top says customers don't see the reply until Google approves it. The owner cannot tell whether the reply is public.
- **Evidence:** The two screens above. "Live on Google" comes only from `publishStatus === "published"` (`lib/inbox/reply-state.ts:333-345`), and the toast is fixed by status (`lib/inbox/actions.ts:162-170`). Neither reads `reply.googleReplyState`. The banner is raised exactly when `googleReplyState === "PENDING"` (`components/inbox/detail/reply-exception.tsx:102-110`).
- **Affects:** owner, admin, and members with publish access.
- **Fix:** When `googleReplyState === "PENDING"`, derive status "Sent · waiting for Google's check" (the existing `sent` outcome with the note "not live until Google confirms"), and have `describeOutcomeToast` take that state into account. One status vocabulary in `lib/inbox/reply-state.ts`, shown through `components/ui/status-pill` and `components/ui/toast` (`useOutcomeToast`).
- **Slice:** R01a

#### INB-02 · "Publish reply" parks the reply for approval in two-person mode — P1 · RC-ACTIONBAR
- **Screen:** `03 - Inbox/01 - Review detail/03 - Approving a reply/screen-02.webp` (the button says "Publish reply"), `03 - Inbox/01 - Review detail/03 - Approving a reply/screen-03.webp` (toast: "Submitted for approval")
- **Problem:** A publisher in an organisation with two-person approval presses "Publish reply", and the reply is parked instead. The label promises something the server will not do.
- **Evidence:** The client chooses the verb from `capabilities.canPublish` alone (`lib/inbox/reply-state.ts:138-146`; "submit" only when `!canPublish && canRequestApproval`). The server parks when `require_two_person_approval && !has_qualifying_approval` (`lib/server/publishing/approval.ts:23-31`).
- **Affects:** owner, admin, and members with publish access in two-person organisations.
- **Fix:** Add the organisation's two-person flag (or a `primaryVerb`) to the review detail payload, and use the existing `submit` branch ("Submit for approval", status "Ready to submit for approval"). No new UI is needed: `components/inbox/action-bar.tsx:342-356` already draws it inside the shared `components/ui/action-bar` ActionBar. Needs an owner decision before Phase 2: it adds fields to the review-detail payload.
- **Slice:** R01b

#### INB-03 · The person who submitted a reply is offered "Approve reply" and told "Approval required" — P1 · RC-ACTIONBAR
- **Screen:** `03 - Inbox/01 - Review detail/03 - Approving a reply/screen-03.webp` (the same session that just submitted)
- **Problem:** Straight after submitting, the requester sees a live green "Approve reply" and the status "Approval required", as if it were their job. The banner then explains, in a subordinate clause, that a two-approver organisation will not take that decision from them.
- **Evidence:** `approvalScope: review.capabilities.canPublish ? "me" : "others"` (`components/inbox/action-bar.tsx:136`). The code itself says `canPublish` "stays true for the very person who submitted the reply" (`components/inbox/detail/reply-exception.tsx:126-133`).
- **Affects:** owner, admin, and members with publish access (two-person organisations).
- **Fix:** Have the server send `approvalScope` (`me | others`), compared against `approval_requested_by`. Then show "Waiting for another approver" with no Approve button for the requester. Keep the shared ActionBar; only the status and primary-action inputs change. Needs an owner decision before Phase 2: it adds fields to the review-detail payload.
- **Slice:** R01b

#### INB-04 · One tap on "Regenerate" during approval withdraws the request — P1 · RC-STATEGUARD
- **Screen:** `03 - Inbox/01 - Review detail/03 - Approving a reply/screen-05.webp` (the approver sees the tone switch and "Regenerate" directly above the submitted reply)
- **Problem:** The approver has to read the parked reply, and the composer stays fully live while they do. If the box is not dirty, "Regenerate" runs with no confirmation. It writes a new draft on the server and moves the review to `drafted`, which takes it out of Approval and discards what the requester submitted. The toast's Undo only puts the old text back locally; the approval state is not restored.
- **Evidence:** `editable = canEdit && canDraft`, and `canDraft` allows `awaiting_approval → drafted` (`components/inbox/reply-composer.tsx:404-412`, `lib/domain/workflow.ts:21`). The confirmation appears only when dirty (`components/inbox/reply-composer.tsx:356-362`). The server always sets `workflow_status = 'drafted'` (`lib/server/review-drafts.ts:546-550`). Undo is local only (`components/inbox/reply-composer.tsx:330-340`).
- **Affects:** owner, admin, and members with publish access (approvers).
- **Fix:** While `awaiting_approval`, show the parked reply read-only, as the existing `reply-readonly` branch does (`reply-composer.tsx:445-458`). Put "Edit reply" in the ActionBar overflow, and say inline that editing sends the reply back to Needs reply. Hide tone and Generate until then.
- **Slice:** R02

#### INB-05 · Approvers get no badge and no notification for work waiting on them — P1 · RC-NOTIFY
- **Screen:** `03 - Inbox/01 - Review detail/03 - Approving a reply/screen-04.webp` (approver's Inbox: tab bar badge empty, title "Inbox" with no count, Needs reply "–", Approval 1)
- **Problem:** The approver's only cue is a "1" in the third tab. Nothing in the tab bar, the title or Notifications points to it. The same is true for a requester whose reply was sent back.
- **Evidence:** The title count and the tab badge count only `needs_reply` (`components/inbox/inbox-toolbar.tsx:30-43`, `components/app-shell/use-needs-reply-count.ts:21-31`). No notification kind exists for approval requested or reply sent back (`lib/domain/notification-preferences.ts:13-30`). The Notifications empty copy lists only connections, publishing and syncs (`components/notifications/notifications-view.tsx:252-253`).
- **Affects:** owner, admin, members with publish access (approvers); members (requesters).
- **Fix:** Count "awaiting my approval" (the server already has the `awaiting_my_approval` queue, `components/inbox/filter-toolbar.tsx:105-110`) in the Inbox badge and title. Add the `approval_requested` and `reply_sent_back` notification kinds, rendered with the existing `ListRow` in `notifications-view`. Needs an owner decision before Phase 2: new notification kinds.
- **Slice:** R03

#### INB-06 · Connection actions send members and viewers to "Access denied" — P1 · RC-STATES
- **Screen:** `03 - Inbox/04 - Switching client scope/screen-03.webp` ("No locations are linked to Google yet." with "Manage connection")
- **Problem:** The empty-state buttons "Manage connection" and "Reconnect Google", and the review banner's "Check Google connections", are shown to everyone. `/settings/connections` only renders for owners and admins. The "no clients" empty state already handles roles; these branches do not.
- **Evidence:** `components/inbox/empty-states.tsx:451-470` (no role check) compared with `:446` (`canManageClients`). `components/inbox/detail/reply-exception.tsx:247-258`. `app/(dashboard)/settings/connections/page.tsx:9-10` returns `<AccessDenied area="Google connections" />`.
- **Affects:** member, viewer.
- **Fix:** Pass `canManageClients` into those branches. For other roles, keep the explanation, swap the link for "Ask an owner or admin to reconnect Google", and add no button. Use `components/ui/empty` `Empty` (`action` slot empty) and `components/ui/alert` without `AlertActions`.
- **Slice:** R04

#### INB-07 · Client scope is treated as a filter, and "Clear all filters" quietly resets it — P1 · RC-SCOPE
- **Screen:** `03 - Inbox/04 - Switching client scope/screen-02.webp`, `03 - Inbox/04 - Switching client scope/screen-03.webp` (after switching scope: a "Client: …" chip, a "Clear all filters" link and a filter-count "1"), `03 - Inbox/02 - Filtering reviews/screen-01.webp` (a third Client control in the Filters sheet)
- **Problem:** Three controls do one job: the app-bar scope chip, the Filters sheet "Client" select, and the removable chip. Choosing a scope in the app bar shows up as an active filter. Pressing "Clear all filters" to drop a rating filter also drops the client, which the switcher then mirrors in the app bar. Notion's account switch (`06 - Switching account/screen-04`) changes context and adds no filter.
- **Evidence:** The client counts as a filter (`components/inbox/filter-toolbar.tsx:54`) and gets a chip (`components/inbox/active-filter-chips.tsx:32-38`). `onClearFilters` rebuilds the state without `clientId` (`components/inbox/inbox-view.tsx:329-340`). The Filters sheet Client select is at `components/inbox/more-filters.tsx:224-249`. The switcher keeps the remembered client in step with the address (`components/app-shell/client-switcher.tsx:49-101`). Unverified at runtime: whether the remembered cookie is also cleared.
- **Affects:** owner, admin, member and viewer in agency mode.
- **Fix:** Keep scope only in the app bar (`ClientScopeChip` and the scope sheet). Remove `clientId` from `activeFilterCount`, `ActiveFilterChips` and `FiltersSheet`, and make `onClearFilters` keep `state.clientId`.
- **Slice:** R05, P05

#### INB-08 · Triaging a single review takes four taps through Select mode — P1 · RC-LISTROW
- **Screen:** `03 - Inbox/screen-02.webp` (selection bar: More, No reply needed), `03 - Inbox/01 - Review detail/screen-02.webp` (the detail ⋯ menu has only Open listing, History and Review details)
- **Problem:** Marking one review "No reply needed", or assigning it, means Select → tick → action → confirm. Rows have no swipe action, and the review's own ⋯ menu has no triage actions. Notion does it with a swipe and a tap, plus undo (`03 - Mail/03 - Deleting a thread/screen-02…03`).
- **Evidence:** The detail menu items are at `components/inbox/review-detail.tsx:270-301`. There is no swipe, long-press or `mark_reviewed` handler in `components/inbox/review-list.tsx` or `review-detail.tsx`. Triage lives only in `components/inbox/bulk-action-bar.tsx:353-367`.
- **Affects:** owner, admin, member (the bulk tools are hidden for viewers, `components/inbox/inbox-view.tsx:196`).
- **Fix:** Add "No reply needed" and "Assign…" to the detail's ⋯ (the `DropdownMenu`, which becomes the menu sheet on a phone), and a trailing swipe on `components/ui/list-row` `ListRow` with a visible button alternative (WCAG 2.5.7). Pair both with an undo toast (INB-09).
- **Slice:** R06a, P10

#### INB-23 · The Inbox ships every dialog in its first load and breaks the JS budget — P1 · RC-PERF
- **Screen:** `03 - Inbox/screen-01.webp`; [`baseline/perf-mobile.md`](baseline/perf-mobile.md), [`baseline/perf-desktop.md`](baseline/perf-desktop.md)
- **Problem:** The Inbox imports every overlay statically, including ones a phone user may never open: `TemplateReplyDialog` (580 lines), the History dialog with `ActivityTimeline`, `ReviewMetadata`, and four AlertDialogs. Two Selects are always mounted but hidden (`className="hidden"`). Queue counts render as skeletons until hydration even when the server prefetched them, so tab widths change once the figures arrive.
- **Evidence:** perf-lab measured `/inbox` and `/inbox?selected={review}` first-load JS at 552KB transfer (1,555KB decoded) on both profiles, over the 520KB `budgets-baseline.json` limit; these are the only first-load JS breaches among the 14 routes perf-lab measured (its default list skips the listing areas; see LST-14). No `dynamic()` under `components/inbox/`. `components/inbox/bulk-action-bar.tsx:14`, `components/inbox/review-detail.tsx:248-319`, `components/inbox/filter-toolbar.tsx:199`, `:209`, `components/inbox/inbox-view.tsx:163-165`, `components/inbox/queue-tabs.tsx:143-147`.
- **Affects:** all roles.
- **Fix:** Load the template dialog, History and Review details with `next/dynamic`, as the shell already does for `ClientSearchList` and `CommandPaletteDialog`. Remove the hidden Selects or gate them by breakpoint in CSS. Reserve the tab count width (min-width on `TabCount`).
- **Slice:** R09

#### INB-09 · Confirmation dialogs used where undo fits — P2 · RC-CONFIRM
- **Screen:** `03 - Inbox/screen-02.webp` (selection → No reply needed), `03 - Inbox/01 - Review detail/02 - Using a suggested reply/screen-01.webp` (Generate over edits)
- **Problem:** "No reply needed" (a local triage step that sends nothing to Google) is behind an AlertDialog because there is no API to undo it. "Regenerate" over unsaved edits asks "Discard your edits?" and then offers Undo anyway. Notion's equivalent is an undo toast (`03 - Mail/03 - Deleting a thread/screen-03`).
- **Evidence:** `components/inbox/bulk-action-bar.tsx:432-462` (the comment: "There is no API to put a review back"). `components/inbox/reply-composer.tsx:461-484` (the dialog text says "You can undo it straight afterwards") and `:323-340` (Undo action).
- **Affects:** owner, admin, member.
- **Fix:** Add a server undo (`mark_unreviewed`) and replace the dialog with a `components/ui/toast` `ToastAction` "Undo" (kind "local"). Remove the regenerate confirmation and keep the Undo toast. Needs an owner decision before Phase 2: a server undo for "No reply needed".
- **Slice:** R06b, P07

#### INB-10 · The Filters sheet is long, repeats other controls and mixes control styles — P2 · RC-FORMS
- **Screen:** `03 - Inbox/02 - Filtering reviews/screen-01.webp`, `03 - Inbox/02 - Filtering reviews/screen-02.webp`
- **Problem:** Ten groups: Rating, Written review, Venue, Client, Assigned to, Waiting on, Reply status, Age, Date range, Sort. "Reply status" (Unreplied/Replied) overlaps the queue tabs: inside Needs reply, "Replied" can only return nothing. Client duplicates the scope (INB-07). Venue is a typeable Combobox, which raises the keyboard, with a ⇕ icon, while Client and Assigned to are Selects with ⌄ icons. Rating is a hand-made toggle box. The commonest choices still need the sheet. Notion's filter is a two-option menu (`04 - Filtering emails/screen-02`).
- **Evidence:** `components/inbox/more-filters.tsx:177-338` (groups), `:200-220` (Combobox), `:280-285` (Reply status). `components/inbox/filter-controls.tsx:32-83` (`RatingFilter`, hand-rolled `role="checkbox"` buttons).
- **Affects:** all roles.
- **Fix:** Drop Client and Reply status from the sheet, and use `Select` (or a short combobox that does not open the keyboard, per the spec) for Venue. Rebuild Rating as `components/ui/chip` `ToggleChip` in a `ChipRow`. Put the two commonest filters (rating, with text) as `ToggleChip`s above the list so they are one tap.
- **Slice:** R07

#### INB-11 · Queue counts show "–" for zero and ignore active filters — P2 · RC-NAVSTRIP
- **Screen:** `03 - Inbox/screen-01.webp` ("Approval –", "Publishing –"), `03 - Inbox/02 - Filtering reviews/screen-03.webp` ("Needs reply 2" above "1 review"), `desktop/inbox.webp` (compare `desktop/listings.webp`, `desktop/clients.webp`)
- **Problem:** A dash reads as "unknown" or "loading", not zero. At 1280 the Approval, Publishing and Failed tabs show "–" while the Listings and Clients chips show "0" for the same meaning, so the strips disagree with each other. With a filter on, the tab count and the list disagree too, and the explanation exists only for screen readers.
- **Evidence:** `components/inbox/queue-tabs.tsx:156` (`count > 0 ? formatNumber(count) : "–"`), `:163-172` (an `sr-only` note saying the counts ignore filters). The header comment says "A queue with nothing in it shows no figure" (`components/inbox/inbox-toolbar.tsx:28`), which the strip does not do.
- **Affects:** all roles; everyone who replies to reviews.
- **Fix:** Never show a dash. Use one zero treatment on every count strip through the shared `TabCount` in `components/ui/tabs` and `ChipCount`: either no figure (which `TabCount` already supports and the header comment promises) or a muted "0". While filters are on, either fetch filtered counts or show the count only on the current tab, matching the list header.
- **Slice:** R07, P04
- **Merged:** DSK-13

#### INB-12 · The same number repeats and the badge disagrees with the scope — P2 · RC-APPBAR
- **Screen:** `03 - Inbox/screen-01.webp` ("2" four times: tab bar badge, "Inbox 2", "Needs reply 2", "2 reviews"), `03 - Inbox/04 - Switching client scope/screen-03.webp` (Old Crown scope: badge 2, Needs reply "–")
- **Problem:** Notion shows the count once ("Inbox 99+", `03 - Mail/screen-01`). Here the badge is organisation-wide while the title and tabs follow the scope, so in a scoped view they contradict each other. App-bar truncation of the scope and organisation names is covered under SET-07.
- **Evidence:** `components/app-shell/use-needs-reply-count.ts:21-31` (unscoped key; its comment claims the badge and the queue "never disagree"). `components/inbox/inbox-view.tsx:154` (scoped counts).
- **Affects:** all roles.
- **Fix:** Keep one count, the "Inbox N" title, and drop the duplicate from the active tab. Scope the badge to the current scope (`reviewCountsFor({clientId})`).
- **Slice:** R07

#### INB-13 · Review detail stacks two header bars and shows the reviewer's name twice — P2 · RC-APPBAR
- **Screen:** `03 - Inbox/01 - Review detail/screen-01.webp`
- **Problem:** The app bar (‹ Inbox, bell, scope chip) sits above a second band ("Stub reviewer · 2 of 2 · ‹ ›"), and then the card repeats "Stub reviewer" as the h2. About 100pt of chrome comes before the review. The spec's app bar is "labelled back, page title, at most two actions". Notion uses one bar (back, ⋯) and then the subject (`03 - Mail/01 - Email detail/screen-02`).
- **Evidence:** `components/inbox/review-detail.tsx:366-447` (`HeadFrame`, a second header), `:184-191` (h2 name). `components/inbox/inbox-view.tsx:1027-1032` (PageChrome back in the app bar).
- **Affects:** all roles.
- **Fix:** Move "2 of 2 ‹ ›" into the app bar's two action slots through `components/app-shell/page-chrome.tsx` (title echo plus count). Hide the scope chip on the pushed detail, and drop the head band.
- **Slice:** R08, P05

#### INB-14 · When AI is unavailable, the screen offers Retry, Generate and a credit balance anyway — P2 · RC-STATES
- **Screen:** `03 - Inbox/01 - Review detail/02 - Using a suggested reply/screen-02.webp`
- **Problem:** "AI assistance isn't available for this workspace yet" is permanent until setup, but the alert offers "Retry". "Generate reply" stays enabled and "100 of 100 credits left this month" stays visible, so the screen contradicts itself. The fixture caused the state; the handling is product code.
- **Evidence:** Retry is offered for every non-credit error (`components/inbox/reply-composer.tsx:504-514`). The error code is `ai_not_configured` (`lib/errors/action-errors.ts:142`). `canGenerate` ignores configuration (`reply-composer.tsx:412`). The alert is a hand-rolled `div` (`:486-522`).
- **Affects:** owner, admin, member.
- **Fix:** Treat `ai_not_configured` like credits-out: no Retry, Generate hidden or disabled with the reason as text, credits hidden. Render it with `components/ui/alert` `Alert` (`variant="destructive"`, `AlertActions` holding only "Write my own").
- **Slice:** R08

#### INB-15 · Approval copy uses jargon, names a hidden control and refers to a role that does not exist — P2 · RC-COPY
- **Screen:** `03 - Inbox/01 - Review detail/03 - Approving a reply/screen-03.webp`, `03 - Inbox/01 - Review detail/03 - Approving a reply/screen-05.webp`
- **Problem:** The banner says "parked for approval… send it back with Reject reply — an organisation that asks for two approvers will not take the decision from whoever submitted it". That is long, uses jargon, and "Reject reply" is hidden in ⋯ on a phone. The toast says "once a **manager** approves it", but the roles are owner, admin, member and viewer.
- **Evidence:** `components/inbox/detail/reply-exception.tsx:131-135`, `components/inbox/action-bar.tsx:318-326` (Reject is `max-md:hidden`), `lib/inbox/actions.ts:176`, `lib/settings/roles.ts:14-23`.
- **Affects:** owner, admin, member.
- **Fix:** Banner: "Waiting for your approval. Approve it, or send it back with a note." Toast: "It goes live once someone with publishing rights approves it." On a phone, show Reject as a second `InlineAction` in the shared ActionBar, or name it as "⋯ › Reject".
- **Slice:** R01a

#### INB-16 · Composer controls push the text box down and guidance looks tappable — P2 · RC-FORMS
- **Screen:** `03 - Inbox/01 - Review detail/screen-01.webp`, `03 - Inbox/01 - Review detail/screen-03.webp`, `desktop/inbox.webp`, `desktop/inbox-selected--review.webp`
- **Problem:** Before you can type there is a tone switch, a "0 characters" count and Generate. Under the box sit guidance items ("○ Greets them by name", "○ Under 1,000 characters") drawn with empty circles that look like a radio group, but are not controls, plus a credit line. "Under 1,000 characters" also shows as unmet at "0 characters". On a 390pt screen the box starts at about 70% of the height and the keyboard then covers it; desk shows the same circles. Notion's composer is the text alone (`03 - Mail/01 - Email detail/01 - Replying to an email/screen-02`).
- **Evidence:** `components/inbox/reply-composer.tsx:528-548` (tone), `:596-604` (count shown at 0), `:684-720` (`CircleIcon` guidance; an unmet item at `:697-707`), `:737-748` (credits). The length item requires `text.length > 0` (`lib/inbox/reply-guidance.ts:86-90`).
- **Affects:** owner, admin, member; everyone who replies to reviews.
- **Fix:** Put the box first. Fold tone into a Generate menu (`DropdownMenu`, which becomes the menu sheet on a phone). Hide the count until there is text. Hide the guidance checklist until the reply has text, or draw it as plain ✓ text or a dashed or dot marker that cannot read as a radio button, titled "Good replies", or move it into `components/ui/field` `FieldDescription`.
- **Slice:** R08
- **Merged:** DSK-21

#### INB-17 · Select mode has two exits that look the same — P2 · RC-ACTIONBAR
- **Screen:** `03 - Inbox/screen-02.webp` ("Cancel" at the top, "Clear selection" in the bottom bar)
- **Problem:** "Cancel" leaves select mode. "Clear selection" empties the selection but stays in the mode. Notion has one: "1 selected · Cancel" (`03 - Mail/02 - Adding a label/screen-02`).
- **Evidence:** `components/inbox/list-header.tsx:136-148`, `components/inbox/bulk-action-bar.tsx:320-330` (`cancelLabel="Clear selection"`).
- **Affects:** owner, admin, member.
- **Fix:** Keep the count and Cancel in the header band only, and let `components/ui/selection-bar` `SelectionBar` hold only actions (make its cancel optional).
- **Slice:** R09

#### INB-18 · Sync errors are a stuck caption, and freshness is hidden on phones — P2 · RC-FEEDBACK
- **Screen:** `03 - Inbox/03 - Syncing reviews/screen-01.webp`, `03 - Inbox/03 - Syncing reviews/screen-02.webp`
- **Problem:** Success is a toast, but failure (including "A sync is already running") is an absolutely positioned red caption under the icon. It never dismisses. "Google checked 5 min ago" is hidden below 2xl, so phone users, and members and viewers who have no Sync button at all, cannot tell how fresh the list is.
- **Evidence:** `components/inbox/sync-reviews-button.tsx:41-53`, `:102-109`. `components/inbox/list-header.tsx:111-114` (`max-2xl:hidden`). `lib/reporting/sync-permission.ts:1-3` (owners and admins only).
- **Affects:** owner and admin (errors); member and viewer (no freshness).
- **Fix:** Send errors through `components/ui/toast` (`type: "error"`, the same channel as success). Show `GoogleFreshness` in the list header on phones (it fits beside the count).
- **Slice:** R09

#### INB-19 · List controls sit outside thumb reach — P2 · RC-TOUCH
- **Screen:** `03 - Inbox/screen-01.webp`
- **Problem:** Search, Filters, Sync and Select are all in the top 30% of the screen. Notion floats filter, search and compose at the bottom (`03 - Mail/screen-01`). Principle 4 of the spec: "Primary actions sit in the bottom third on a phone".
- **Evidence:** `components/inbox/inbox-view.tsx:762-806` (controls band above the list), `components/inbox/inbox-toolbar.tsx:187-220`.
- **Affects:** all roles.
- **Fix:** On a phone, put search and Filters in a bottom-floating `components/ui/toolbar` `Toolbar` above the tab bar. It steps aside for the SelectionBar or ActionBar, by the "one bottom bar" rule. Sync becomes pull-to-refresh with the button as the visible alternative.
- **Slice:** R10

#### INB-21 · Notifications actions wait on the server, errors appear away from the row, and labels are unclear — P2 · RC-FEEDBACK
- **Screen:** `09 - Notifications/screen-01.webp`
- **Problem:** "Mark read" and "Resolve" are not optimistic. A failure shows as a red line above the list, far from the row on a long page. "Mark shown as read" is jargon, and it appears, disabled, in the empty state next to "0 open and unread". The filter "Open" sits beside "Unread" without explanation. The empty state has no next step, for example notification settings. The settings glyph has no visible label on a phone.
- **Evidence:** `components/notifications/notifications-view.tsx:132-136` (mutation, no `onMutate`), `:232-236` (`<p role="alert">`), `:216-229`, `:56` (FILTERS), `:248-254` (Empty with no action), `:182-192`.
- **Affects:** all roles.
- **Fix:** Update the row's read state in the cache before the server answers (`onMutate`), roll back on error with a `components/ui/toast` error toast, and remove the inline `<p>`. Rename the button "Mark all read" and hide it when there is nothing unread. Add `action` to `Empty`: "Notification settings".
- **Slice:** R11

#### INB-22 · The list refresh bar is a one-off animation that ignores reduced motion — P2 · RC-A11Y
- **Screen:** `03 - Inbox/03 - Syncing reviews/screen-01.webp` (the refresh after sync)
- **Problem:** A hand-made 2px bar with `animate-pulse` and no `motion-reduce` opt-out, while the composer's pulse and the `Skeleton` shimmer both respect it.
- **Evidence:** `components/inbox/review-list.tsx:262-269` compared with `components/inbox/reply-composer.tsx:670-672` and `components/ui/skeleton.tsx:17`.
- **Affects:** all roles.
- **Fix:** Use `components/ui/progress` `Progress` with no value (indeterminate, reduced motion handled, named with `label`).
- **Slice:** R09

#### INB-24 · Scope-switch toasts pile up — P2 · RC-FEEDBACK
- **Screen:** `03 - Inbox/04 - Switching client scope/screen-03.webp` (a second "Switched to" toast peeks behind the first)
- **Problem:** Each switch adds a toast, so quick switches stack outdated "Switched to …" messages over the list. Notion shows one (`06 - Switching account/screen-04`).
- **Evidence:** `components/app-shell/scope-sheet-model.tsx:121-123` (toast text). Each switch calls `toasts.add`, and nothing updates or replaces the previous toast.
- **Affects:** all roles in agency mode.
- **Fix:** Give the scope toast a fixed id and update it (`toasts.update`), or close the previous one, through `components/ui/toast`.
- **Slice:** P07

#### DSK-12 · The Inbox's long venue line wraps every row to three lines — P2 · RC-LISTROW
- **Screen:** `desktop/inbox.webp`, `desktop/inbox-selected--review.webp`
- **Problem:** The list pane is 40% of the content width (about 416px). The "client · listing" line wraps onto a second line ("Journey Hospitality · Stub location / e23631ff"), so each row is about 110px and an 800px-high desk shows about five reviews. Real listing names are often longer than the fixture's.
- **Evidence:** The venue string is `${clientName} · ${name}` with no truncation (`components/inbox/review-list.tsx:300-303`). The list width is `clamp(18.75rem, 40%, 30rem)` (`lib/inbox/layout.ts:12`).
- **Affects:** everyone who replies to reviews.
- **Fix:** In the `ListRow` (`components/ui/list-row`) meta slot, truncate the venue to one line with the full text in `title`, or drop the client name when a client is in scope.
- **Slice:** R09

#### DSK-22 · A review photo that fails to load shows the browser's broken-image icon — P2 · RC-STATES
- **Screen:** `desktop/inbox-selected--review.webp`
- **Problem:** The photo tile shows the native broken-image glyph. The fixture URL is probably fake, but expired Google CDN thumbnails would look the same. This also happens on a phone.
- **Evidence:** `<img src={item.thumbnailUrl} alt="" …>` has no `onError` fallback (`components/inbox/review-detail.tsx:563-568`).
- **Affects:** everyone who replies to reviews.
- **Fix:** On `onError`, swap to the tile's existing icon placeholder (an image icon plus "Photo unavailable" in `title`), using the same branch as the video-only tile.
- **Slice:** R08

### One-off components

| One-off (file:lines) | Should reuse | Slice |
| --- | --- | --- |
| `components/inbox/filter-controls.tsx:32-83` (`RatingFilter`) | `components/ui/chip.tsx` `ToggleChip` in `ChipRow` | R07 |
| `components/inbox/reply-composer.tsx:486-522` (generate error block) and `:760-775` (`reply-problem`) | `components/ui/alert.tsx` `Alert` with `AlertActions` | R08 |
| `components/inbox/review-list.tsx:262-269` (refresh bar) | `components/ui/progress.tsx` `Progress` (indeterminate) | R09 |
| `components/inbox/sync-reviews-button.tsx:102-109` (floating error caption) | `components/ui/toast.tsx` error toast | R09 |
| `components/notifications/notifications-view.tsx:232-236` (page-level `<p role="alert">`) | `components/ui/toast.tsx` error toast | R11 |
| `components/inbox/review-detail.tsx:366-447` (`HeadFrame`, a second header bar) | `components/app-shell/page-chrome.tsx` (app-bar title, count and actions); no `components/ui` equivalent | R08, P05 |
| `components/inbox/more-filters.tsx:56-83` (`Group`, hand-rolled heading and group) | `components/ui/fieldset.tsx` `Fieldset` and `FieldsetLegend` | R07 |
| `components/inbox/more-filters.tsx:200-220` (Venue `Combobox`, which opens the keyboard) | `components/ui/select.tsx` `Select`, matching Client and Assigned to | R07 |

### Needs owner setup
- **AI suggested reply:** `OPENAI_API_KEY` is empty in `visual-app`, so a generated reply could not be captured (`03 - Inbox/01 - Review detail/02 - Using a suggested reply/screen-02.webp`). INB-14 covers only how the product handles that error. The success path, tone switching and regeneration still need a capture.
- **Review photo:** the seeded thumbnail is a placeholder URL, so the tile shows a broken image (`03 - Inbox/01 - Review detail/screen-01.webp`). Not judged on the fixture itself (DSK-22 covers the missing fallback).
- **Notifications with items:** none are seeded. Rows, Resolve, Mark read, and the "Open" and "Unread" filters were judged from code only (INB-21).
- **Search mode:** not captured. Judged from code (`components/inbox/inbox-toolbar.tsx:59-69`).
- **Failed, Publishing and long queues:** no seeded failures or backlog. The failure banners (`reply-exception.tsx:56-90`), "Load more", the advance after publishing through more than two reviews, and the queue strip's reveal of Failed are unverified on screen.
- **Bulk approve and template reply:** need a seeded set of rating-only reviews and approvals. The dialogs were judged from code only.
- **Fixture names:** "Stub reviewer" and "Stub location b2e5d15e" appear because of the fixture. Row wrapping was not judged on real names.
- **Keyboard over the composer:** captures show no on-screen keyboard. Whether the ActionBar rides the keyboard on iOS needs a device check (spec testing §1).
- **Dark mode:** no Inbox captures in dark mode. The code uses tokens only in `components/inbox` (no hard-coded colours found), so parity is likely but unverified on screen.

## Listings, Google profile and Calendar

### Steps per flow

| Flow | Task | Now (taps) | Notion Mail equivalent (taps) | Gap |
| --- | --- | --- | --- | --- |
| Listings index / overview | Open a listing; switch to a sibling | Open: 1. Switch: 2 (name, then sibling in a sheet). Activity: 2 ("…", Activity) | Inbox → email: 1. Detail "…" → action: 2 | Parity on taps. First row starts about halfway down the screen (LST-07); the overflow holds one item (SET-13) |
| Editing the profile | Change the business name and publish | 3 plus typing (Business profile card, Review changes, Publish to Google) | 2 (Compose, Send, then an "Undo" toast) | +1 (the consent sheet is deliberate). Three equal bar buttons (LST-04), about five header rows (LST-06), two save models (LST-08) |
| Editing hours | Open Monday 09–17 and copy to the weekdays | 6 (toggle Monday, Copy to…, Weekdays, Copy to 4 days, Save here or Review changes, Publish, not captured) | 2 (calendar icon, preset, toast). Swipe-action edits apply with no save | +3 to 4. Presets are good; the long day list and two-step save add friction (LST-16) |
| Editing the menu | Start a menu with one item and save | 4 plus about 5 fields (Start a menu, tap item, Done, Save here); publish adds 2 | 4 (compose, Aa, style, Send) | +1 to 3, but the scroll and five toolbar rows are the real cost (LST-20). The menu picker is unusable (LST-03) |
| Managing photos | Upload a photo from the library | 4 plus the OS picker (Add photos, Choose from library, Review file upload, Upload N photos). Upload not captured | 1 plus the OS picker (composer image button) | +3. The sheet also contradicts itself (LST-15) |
| Creating a post | Write an update and publish it | 4 to 5 (New post, Type, Save draft, back to the list, Publish, confirm). No photo possible | 2 (Compose, Send, Undo toast). Image +1; schedule +2 | +2 to 3 and a change of screen. A photo post cannot be made (LST-11, LST-12) |
| Reviewing Google suggestions | Check for and accept suggestions | 1 (Check Google now). Accept/ignore not captured | No direct equivalent (pull to refresh in Inbox) | n/a; needs owner setup |
| Adding a booking link | Add a "Reserve a table" link | 7 (card, Type row, only option, paste URL plus preferred tick, Review action link, Approve, Send not captured) | 3 (Add sender, pick contact, tick) | +4. Approve and send are separate by design; the single-option picker and inline secondary primary add more (LST-10, SET-13, LST-31) |
| Checking verification | Find out whether the listing is verified | 1 to 2, then a long page of PIN, start and history sections | 0 (a single status banner on the detail) | +1, but most of the page has no bearing on a verified listing (LST-09) |
| Change history and approvals | Publish all saved areas; read history | Publish: 3 ("…", Review & publish, Publish 2 areas). History: 2 ("…", Activity) | 2 (× then Save Draft) | Parity on taps. The diff and failure copy are the problem (LST-01, LST-02, LST-13, LST-05) |
| Requester view | Member looks at a listing | Read only; no request path for listings | n/a | Read-only view is a greyed editor (LST-27). Approval hand-off needs owner setup |
| Managing people | Invite a manager | 4 (Add administrator, email, Review invitation, Approve, Send not captured) | 3 (Add sender, pick contact, tick) | +1. Context jumps from sheet to page panel (LST-26) |
| Calendar | See scheduled posts | Agency: 2 (More, Calendar). Business: 1 (Calendar tab). Lands on "Scheduled publishing is off" | No separate screen for scheduled sends (toast and undo) | Dead end with no action, and no current item in the nav (LST-28) |

### Findings

#### LST-01 · Food-menu changes are shown as raw JSON at the point of consent — P0 · RC-COPY
- **Screen:** `04 - Listings/09 - Change history & approvals/screen-02.webp`
- **Problem:** "After publishing" for a new menu prints `{"labels":[{"description":…},"nanos":500000000,"units":"16"…}]}`. The operator is asked to publish something they cannot read. The price shows as `nanos`/`units`, not "£16.50", even though `formatMenuPrice` exists in the same file. The same comparison feeds the menu editor's own review sheet. The reviewed-write consent cannot be given knowingly, so the task is blocked in practice.
- **Evidence:** `04 - Listings/09 - Change history & approvals/screen-02.webp`; `lib/locations/menu-diff.ts:59-63` (`display()` stringifies any object); added and removed menus pass the whole node at `:281-295`; field label fallbacks such as "Fractional amount" for `nanos` at `:126-138`. Consumers: `components/listings/review-publish.tsx:263`, `components/locations/menu-tab.tsx:112,140`.
- **Affects:** owner, admin (anyone who publishes a menu). All real data with a new or removed menu, section or item.
- **Fix:** Render added or removed menus, sections and items as structured rows (name, description, price through `formatMenuPrice`, "N sections · N items") using `components/ui/diff-view.tsx` / `components/editors/change-diff.tsx`. Never fall back to `JSON.stringify` for display. Add a test that no diff row value starts with `{` or `[`.
- **Slice:** L01

#### LST-02 · The activity sheet shows API keys and enums as words — P1 · RC-COPY
- **Screen:** `04 - Listings/09 - Change history & approvals/screen-04.webp`
- **Problem:** Rows read "Publish google · Profile", "Harness user · Regularhours", "Failed · Not found" and "Publish · Reviews". `regularHours` is lower-cased into "Regularhours", `publish_google` becomes "Publish google", and the error code becomes "Not found". The actor ("Harness user") is a fixture name; the rest happens with real data.
- **Evidence:** `04 - Listings/09 - Change history & approvals/screen-04.webp`; `lib/listings/activity-outcome.ts:38-41` (`humaniseActivity` lower-cases and swaps `_` for a space, so camelCase collapses); used for operation, resource type, update mask and error code at `components/locations/activity-panel.tsx:77-86,108-110`.
- **Affects:** owner, admin, member, viewer (Activity is in every role's overflow).
- **Fix:** Add explicit label maps for operations ("Published", "Sent to Google"), resource types ("Opening hours", "Food menu", "Business profile") and update-mask fields ("Regular hours", "Business name"). Map error codes through `lib/errors/action-errors.ts` copy. Keep rows on `ListRow`. Treat an unknown key as "Other change", never a raw token.
- **Slice:** L02

#### LST-03 · The menu picker collapses to an empty sliver about 20px wide — P1 · RC-TOUCH
- **Screen:** `04 - Listings/03 - Editing the menu/screen-02.webp`, `04 - Listings/03 - Editing the menu/screen-03.webp`
- **Problem:** Beside "Edit menu | Preview" and "New menu", the "Menu" select renders as a blank box with a chevron outside it. With two or more menus, switching means hitting a target narrower than a fingertip, and the current menu's name is not visible.
- **Evidence:** `04 - Listings/03 - Editing the menu/screen-02.webp`, `screen-03.webp`; `components/locations/menu-editor.tsx:836` (`flex min-w-0 flex-1` with no minimum width, in a `flex-wrap justify-between` row with a non-shrinking control group at `:874-897`).
- **Affects:** owner, admin
- **Fix:** On a phone, put the menu picker on its own full-width row (`basis-full` below `sm`), or make the title the switcher ("Lunch menu ⌄" as a `Select` opening a bottom sheet) with "New menu" as its last row. Make Edit/Preview a `SegmentedControl` on its own row. Set a minimum width on the trigger.
- **Slice:** L07

#### LST-04 · The editor save bar shows three equal-width buttons on two rows on a phone, and an idle bar on desk — P1 · RC-ACTIONBAR
- **Screen:** `04 - Listings/01 - Editing the profile/screen-02.webp`, `04 - Listings/02 - Editing hours/screen-02,05,06.webp`, `04 - Listings/03 - Editing the menu/screen-02..04,06.webp`, `desktop/listings--loc--hours.webp`
- **Problem:** On a phone "Discard | Save here | Review changes" sit as three equal-width buttons (`max-md:grow`; Review changes is the green primary, the other two ghost) under a status line, so the bar is about 100px tall (two rows, about 12% of an 844px screen). After "Save here" the bar stays with Discard and Save here disabled (`02 - Editing hours/screen-06`). On desk, a clean editor shows a floating dark bar 12px above the bottom edge that covers the Tuesday row, holding "These hours match Google." and three disabled buttons. The spec says a clean editor shows no bar, bars are inline on desk, and a bar has one primary with the rest in an overflow. Three greyed-out buttons with no reason also suggest the operator lacks permission.
- **Evidence:** `04 - Listings/02 - Editing hours/screen-06`; `desktop/listings--loc--hours.webp` (bar covers the second day row while the hours are clean). `components/editors/editor-footer.tsx:209-243` uses the legacy free-form `actions` prop; the comment at `:172-177` admits two rows; the idle bar is kept on desk on purpose at `:160-165` (`idle ? "max-md:hidden"`). `components/editors/editor-frame.tsx:148` makes it sticky from `md` (`md:[@media(min-height:620px)]:sticky md:[@media(min-height:620px)]:bottom-3`). The `ActionBar` contract is at `components/ui/action-bar.tsx:36-60`.
- **Affects:** owner, admin; on desk every listing editor (profile, hours, menu, booking) shows the idle bar to member as well.
- **Fix:** In `EditorFooter`, render nothing when `idle` at every width (the area header's `StatusPill` already states the sync state). When dirty, use `ActionBar` with `primary={<Button>Review changes</Button>}` and `secondaryActions=[{label:"Save here"}, {label:"Discard edits", destructive:true}]`, inline at the end of the form on desk and one row with a "More actions" overflow on a phone. Hide disabled secondaries instead of greying them. Files: `components/editors/editor-footer.tsx`, `components/editors/editor-frame.tsx`.
- **Slice:** P02
- **Merged:** DSK-02

#### LST-05 · The Review & publish bar is docked by hand, so the toast covers it and nothing reserves its height — P1 · RC-ACTIONBAR
- **Screen:** `04 - Listings/09 - Change history & approvals/screen-01..03.webp` (on `screen-03` the error toast hides the bar's status line)
- **Problem:** This bar sets `data-docked="bottom"` and `max-md:fixed` itself instead of using `ActionBar dock`. That skips the `DockSpacer` measurement that publishes `--np-dock-bar-h`. The toast and the scroll padding then assume the one-row height while this bar wraps to two rows (status over the button), so the toast overlaps it and a focused or last element can sit under it.
- **Evidence:** `04 - Listings/09 - Change history & approvals/screen-03.webp`; `components/listings/review-publish.tsx:977-981`. The measured-height contract is at `components/ui/action-bar.tsx:199-260`; the toast reads `--np-dock-bar-h` at `components/ui/toast.tsx:127`.
- **Affects:** owner, admin
- **Fix:** Use `<ActionBar dock primary={…}>` and drop the hand-written fixed classes and `data-docked`. Keep "Publish N areas to Google" as `primary`. File: `components/listings/review-publish.tsx`.
- **Slice:** P02

#### LST-06 · Every listing area stacks about five header rows on a phone and nine blocks on desk before any content — P1 · RC-DENSITY
- **Screen:** `04 - Listings/01 - Editing the profile/screen-01.webp` (first field at about 53% of the height); also `04 - Listings/02 - Editing hours/screen-01`, `04 - Listings/04 - Managing photos/screen-01`, `04 - Listings/05 - Creating a post/screen-01`, `04 - Listings/07 - Adding a booking link/screen-01`; `desktop/listings--loc--hours.webp`, `desktop/listings--loc--profile.webp`
- **Problem:** On a phone the rows are: (1) the listing switcher plus "…"; (2) the H1 plus status pill; (3) an area dropdown repeating the H1 ("Business profile ⌄" under "Business profile") plus an info button; (4) "Checked with Google just now. Check Google now"; (5) section tabs. The spec names this exact problem and asks for the listing name as the switcher. On desk at 1280 the first Hours day row starts at about y=600 of 800: above it are the client caption, listing switcher, H1 with pill, description, tab row, model note, notice box, time-zone line, "Checked with Google" line and the section heading. The model note, time zone and check line each take a full row for one short sentence.
- **Evidence:** `04 - Listings/01 - Editing the profile/screen-01.webp`; `desktop/listings--loc--hours.webp`. `components/listings/area-frame.tsx:479-592` (header rows), `:163-224` (AreaSwitcher repeats the current area label), `:569-572`; on desk the header composition is at `:370-380` (doc comment) and `:435-574`, and the time-zone line at `components/locations/hours-tab.tsx:516-525`.
- **Affects:** owner, admin, member, viewer
- **Fix:** Make the H1 itself the area switcher (title plus chevron opening the `DropdownMenu` sheet) so the duplicate dropdown row goes. Move the model note into the status pill's tap target and fold `GoogleFreshness` into the pill's sheet or a caption under the H1. Target 2 rows above the tabs on a phone. From `wide`, merge the model note, time zone and last-checked line into one meta row under the tabs (a `Toolbar` with separators) and drop the client caption (see DSK-05). Files: `components/listings/area-frame.tsx`, `components/editors/google-freshness.tsx`, `components/locations/hours-tab.tsx`.
- **Slice:** L03
- **Merged:** DSK-20

#### LST-07 · The listings board puts five control rows above the first listing — P1 · RC-DENSITY
- **Screen:** `04 - Listings/screen-01.webp` (first row at about 51% of the height)
- **Problem:** The rows are: Add listings from Google (full-width primary), search, a chip strip with zero-count chips ("Needs attention 0", "To publish 0"), a "Worst first | By client" segmented control, and a count line. The primary job (find the listing that needs you) is pushed below the fold, and zero-count chips are noise.
- **Evidence:** `04 - Listings/screen-01.webp`; `components/listings/listings-board.tsx:595` (add button), `:843-870` (chip strips), `:65-66` (chip labels), segmented control imported at `:22`.
- **Affects:** owner, admin, member, viewer (agency and business modes)
- **Fix:** Move "Add listings from Google" to an app-bar action or the end of the list. Hide zero-count chips, or render them disabled at the end. Fold sort and grouping into one chip ("Worst first ⌄") inside the same `FilterChipStrip`. Drop the count line into the strip's live region. File: `components/listings/listings-board.tsx`.
- **Slice:** L04

#### LST-08 · One profile form uses two different routes to Google, and each area uses its own — P1 · RC-WRITEMODEL
- **Screen:** `04 - Listings/01 - Editing the profile/screen-01.webp` ("Saved here first" above "No draft · reviewed, then sent to Google"); compare `04 - Listings/07 - Adding a booking link/screen-01`, `04 - Listings/10 - Managing people/screen-04`, `04 - Listings/04 - Managing photos/screen-03`
- **Problem:** In one scrolling form, the business name saves locally then publishes, while the store code and labels have "No draft" and need a separate reviewed request. Across areas, the same "make a change" job uses four paths: the editor bar (Save here → Review changes → Publish), booking (inline Review → sheet Approve → Send), people (sheet → page panel Approve → Send), and photos ("goes to Google as soon as its upload finishes"). Operators must learn the model per field, and the labels are internal model names.
- **Evidence:** `04 - Listings/01 - Editing the profile/screen-01.webp`; `components/locations/profile/section-card.tsx:38-58`; `lib/listings/areas.ts:146-165` (`modelNote`, which needs an area-specific special case for booking, people and profile).
- **Affects:** owner, admin
- **Fix:** One visible path per screen. In the profile, route every field through the editor bar: "Review changes" collects local fields and reviewed requests into one sheet with a single consent and per-row results via `components/reviewed-write/sheet.tsx` and `summary-list.tsx`. Replace the per-field model tags with one plain line in the review sheet ("Name and phone save here first; categories go to Google when you send"). Files: `components/locations/profile/profile-editor.tsx`, `components/locations/profile/section-card.tsx`, `lib/listings/areas.ts`, `components/reviewed-write/*`. Needs an owner decision before Phase 2: one write path for the profile.
- **Slice:** L14

#### LST-09 · The verification page is jargon-heavy and offers start or continue actions on a verified listing — P1 · RC-COPY
- **Screen:** `04 - Listings/08 - Checking verification/screen-01..03.webp`
- **Problem:** On a listing the overview calls "Verified · Google trusts this listing" (`04 - Listings/screen-03`), the page still shows "PIN completion and saved outcomes", "No independently known pending request is available for PIN entry", "Saved PIN completions… Resume an exact team review", "Continue verification in Google" and "Start a new verification". It also shows "Merchant standing", "Business authority reported: Unknown" and "Pending verification reported: Unknown". The answer the operator came for takes one line; the rest is a long scroll of unrelated tools.
- **Evidence:** `04 - Listings/08 - Checking verification/screen-01..03.webp`; `components/locations/administration/verification-tab.tsx:46-66` (all five sections always render; only their order changes on `pinExpected`); `components/locations/administration/verification-completion.tsx:135,317,403`; `components/locations/administration/verification-observation.tsx:73,88`.
- **Affects:** owner, admin (actions); member, viewer (reading)
- **Fix:** Lead with one status card in plain words ("Verified. Google confirms you manage this listing.") using `Empty`/`Card`. Collapse the PIN, start and history sections behind a "Verification tools" disclosure of `SettingsRow` links when the listing is verified and no request is pending. Show "Enter the PIN" only when one is expected. Rewrite the copy without "merchant standing", "independently known" or "exact team review". Files: `verification-tab.tsx`, `verification-completion.tsx`, `verification-observation.tsx`.
- **Slice:** L12

#### LST-10 · The booking-link review is a one-off sheet, and its primary action is an inline secondary button — P1 · RC-SHEET
- **Screen:** `04 - Listings/07 - Adding a booking link/screen-03.webp` (right-aligned outline "Review action link" mid-page, tab bar still showing), `04 - Listings/07 - Adding a booking link/screen-04.webp` (approval sheet)
- **Problem:** The spec lists place actions among the consumers of the shared reviewed-write set (sheet with steps, summary list, outcome summary). The booking flow instead hand-builds its own Sheet with approve, send, read and refresh states and shows no stepper. The form's primary is a `variant="secondary"` button in the card footer, not the docked `ActionBar`, so it sits mid-screen and the tab bar stays.
- **Evidence:** `04 - Listings/07 - Adding a booking link/screen-03.webp`, `screen-04.webp`; `components/locations/place-actions/place-action-approval-sheet.tsx:1-30` (imports `ui/sheet` directly; no `components/reviewed-write`); `components/locations/booking-tab.tsx:832-842` (secondary footer button).
- **Affects:** owner, admin
- **Fix:** Rebuild the approval on `ReviewedWriteSheet` + `ReviewedWriteSteps` + `SummaryList` + `OutcomeSummary` (`components/reviewed-write/`). Put "Review link" in a docked `ActionBar` that appears once a URL is entered.
- **Slice:** L08

#### LST-11 · A post cannot be published from the composer — P1 · RC-WRITEMODEL
- **Screen:** `04 - Listings/05 - Creating a post/screen-02..05.webp`
- **Problem:** The composer's only action is "Save draft". Publishing then means going back to the list, pressing Publish on the card and confirming "Publish this post to Google?". That is 4 to 5 taps and a change of context, against Notion Mail's compose → Send → "Email sent · Undo" (2 taps).
- **Evidence:** `04 - Listings/05 - Creating a post/screen-02..05.webp`; `components/locations/posts/post-composer-sheet.tsx:1041` (only Save draft or Save changes); `components/locations/posts-action-bar.tsx:500-515` (separate publish confirm). Rule D5 (`posts-action-bar.tsx:122`) rules out Undo for Google writes, so the fix keeps consent.
- **Affects:** owner, admin (and anyone the post-approval policy lets publish)
- **Fix:** Give the composer footer a primary "Publish to Google", with the consent line from `components/reviewed-write/consent.tsx` in the footer, and keep "Save draft" as a secondary. When policy needs approval, the primary becomes "Send for approval". Drop the separate `AlertDialog` for posts published from the composer. Files: `post-composer-sheet.tsx`, `posts-action-bar.tsx`. Needs an owner decision before Phase 2: publishing from the composer changes the consent flow.
- **Slice:** L10

#### LST-12 · The post composer has no way to add a photo — P1 · RC-FORMS
- **Screen:** `04 - Listings/05 - Creating a post/screen-02,03.webp`; the post card shows an empty image placeholder (`04 - Listings/05 - Creating a post/screen-05`)
- **Problem:** No photo control exists on a new post. Existing media is carried over read-only, and no other add-photo path to posts was found in `components/locations/posts`. Photo posts are the normal GBP post, and Notion Mail's composer adds an image in 1 tap from the keyboard toolbar.
- **Evidence:** `04 - Listings/05 - Creating a post/screen-02,03.webp`; `components/locations/posts/post-composer-sheet.tsx:341-346` ("there is no upload or removal in this path").
- **Affects:** owner, admin
- **Fix:** Add a "Photo" row to the composer that reuses the photo picker from `components/locations/photos/add-photo-dialog.tsx` (Take photo / Choose from library) with `components/ui/file-card.tsx` for the thumbnail. Needs an owner decision before Phase 2: photo upload in posts.
- **Slice:** L10

#### LST-13 · A publish failure repeats the same long message three times and shows a raw code — P1 · RC-FEEDBACK
- **Screen:** `04 - Listings/09 - Change history & approvals/screen-03.webp`
- **Problem:** "Google couldn't find that account or listing… Earlier steps were sent to Google. Review the step results before retrying. This step did not finish with a confirmed result. Check Google before retrying; the saved copy is kept." appears in the step, again in a "Publishing stopped at…" banner, and again in a 5-line toast. A `NOT_FOUND` chip is also shown. The recovery is unclear (Retry or Retry publishing?).
- **Evidence:** `04 - Listings/09 - Change history & approvals/screen-03.webp`; `lib/editors/use-publish-flow.ts:255-263` (builds the message with the progress sentence); `components/listings/review-publish.tsx:537-539` (appends more to the step detail), `:960` (banner); `components/ui/publish-steps.tsx:140-143` (error-code chip).
- **Affects:** owner, admin
- **Fix:** State it once: one short line on the step ("Google couldn't find this listing"), one banner with the single next action ("Retry the food menu"), and a toast of 6 words or fewer, or none. Move the code into `components/editors/support-details.tsx` ("Details for support").
- **Slice:** L11

#### LST-14 · Seven area routes wait for a client fetch after hydration, and the header remounts on every area switch — P1 · RC-PERF
- **Screen:** all area screens. The visible symptom is the `loading` skeleton on each area change (not capturable under `next dev`, per README).
- **Problem:** Hours, photos and posts stream their Google read from the server (`StreamedTab`). Profile, menu, booking, people, verification, suggestions and changes only prefetch the summary, so their main data (`useProfile`, `useFoodMenus`, …) starts fetching after the client bundle hydrates. The code itself documents that `AreaFrame` remounts on each area switch. Code evidence: perf-lab's default route list does not visit these seven areas, so the committed baseline has no paint figures for them; `baseline/route-js.md` shows `/listings/[id]/profile` with the largest first-load JS union of any route (543.7KB gzip, an upper bound, against 513.0KB for `/inbox`). L16 adds the seven areas to the perf-lab run before changing them.
- **Evidence:** pages without `StreamedTab` are `app/(dashboard)/listings/[id]/{profile,menu,booking,people,verification,suggestions,changes}/page.tsx`; with it, `…/{hours,photos,posts}/page.tsx`. Client reads at `components/locations/profile/profile-editor.tsx:179-180` and `components/locations/menu-tab.tsx:38`. The remount gap is noted at `app/(dashboard)/listings/[id]/loading.tsx:10-13`.
- **Affects:** all roles
- **Fix:** Give the other seven routes the same `StreamedTab` + `*TabPrefetch` pattern. Move `AreaFrame` into a new `app/(dashboard)/listings/[id]/layout.tsx` so the header survives area switches. Files also include `lib/server/prefetch.ts`.
- **Slice:** L16

#### LST-18 · A listing with no hours on Google reports green "In sync", and the hours notice mixes in an unrelated service-metadata warning — P1 · RC-STATES
- **Screen:** `04 - Listings/02 - Editing hours/screen-01.webp`; `desktop/listings.webp`, `desktop/listings--loc.webp`, `desktop/listings--loc--hours.webp`
- **Problem:** Stub location ffb14793 shows Health "In sync" on the Listings board, "Opening hours · In sync" on its Overview card, and an "In sync with Google" pill plus "These hours match Google." on the Hours page. The same page then warns "Google has no opening hours for this listing. Customers see 'Hours not available'." The green state is technically true (both sides are empty) but tells the operator nothing needs doing, so the board's "Worst first" sort and the "Needs attention" chip never surface a listing that customers see without hours. The notice also adds "Google service-type metadata could not be loaded. Existing services are preserved; adding services is unavailable until the lookup succeeds", a lookup failure about services, not hours, in developer language. The same strings show on a phone.
- **Evidence:** `04 - Listings/02 - Editing hours/screen-01.webp`; `desktop/listings--loc--hours.webp`. `lib/server/hours.ts:190-193` (server-authored message at `:192`); `lib/editors/hours-notes.ts:45-52` (information-only, tone `"info"`, never feeds status; the "no opening hours" note at `:49`; the service-metadata note comes through the warnings loop at `:65-75`); the footer hint is chosen only from `hours.status === "in_sync"` at `components/locations/hours-tab.tsx:454-457`, notice at `:114-160`. Neither `lib/listings/health.ts` nor `lib/listings/area-state.ts` checks for missing hours.
- **Affects:** all roles; owner, admin and member for agency triage on the Listings board.
- **Fix:** Add a "No hours on Google" state with attention tone in `lib/listings/area-state.ts`, roll it up into listing health in `lib/listings/health.ts` so the board's "Needs attention" chip counts it, and show the pill as "No hours on Google" (warning tone), not "In sync". Use the footer hint "Google shows no hours yet" instead of "match". Drop the service-metadata note from the hours page, or show it only where services are edited, mapped in `hours-notes.ts` to plain copy ("Some service options couldn't load; try again later. Your existing services are safe."). Use `components/ui/alert.tsx` with one note per alert. Needs an owner decision before Phase 2 for the health roll-up only: the listing summary stores only hashes for hours (`lib/server/location-summary.ts:109-156`), so the board and client health (`lib/server/clients.ts:280`) need a server summary field and a contract change; the copy, hint and note fixes are client-only.
- **Slice:** L05, L18
- **Merged:** DSK-03, DSK-16 (hours and service-metadata part)

#### LST-15 · The photo upload sheet contradicts itself and is not named like its entry button — P2 · RC-COPY
- **Screen:** `04 - Listings/04 - Managing photos/screen-01.webp` ("Add photos"), `04 - Listings/04 - Managing photos/screen-03.webp` ("Add media")
- **Problem:** The description says "Each photo goes to Google as soon as its upload finishes. Nothing waits for a publish step." The primary below it is "Review file upload", followed by another "Upload N photos" step. The sheet title "Add media" does not match the "Add photos" button.
- **Evidence:** `04 - Listings/04 - Managing photos/screen-01.webp`, `screen-03.webp`; `components/locations/photos/add-photo-dialog.tsx:361-366` (title and description), `:640-648` (Review file upload), `:630-633` (Upload N photos).
- **Affects:** owner, admin
- **Fix:** Title "Add photos". Describe it as "Photos go to Google when you tap Upload." Make choosing files go straight to the review list inside the same sheet with one primary "Upload N photos", reusing `components/ui/file-card.tsx` for the rows.
- **Slice:** L15

#### LST-16 · The hours list is long and repeats itself for closed days — P2 · RC-LISTROW
- **Screen:** `04 - Listings/02 - Editing hours/screen-01,02,05.webp`
- **Problem:** Each closed day takes four lines: a day heading, a switch with "Closed", "Closed all day", and "Copy to". An open day takes about 280px. Seven days run past three screens before special days, against the spec's Notion-style dense rows.
- **Evidence:** `04 - Listings/02 - Editing hours/screen-01,02,05.webp`; `components/locations/hours-editor.tsx:472-482` ("Closed" beside the switch, then "Closed all day"), `:590-611` (Copy to on every day).
- **Affects:** owner, admin
- **Fix:** Make each day a `ListRow`/`SettingsRow` ("Monday · 09:00–17:00 ›", "Tuesday · Closed ›") with the switch at the trailing edge. Tapping opens the day in a bottom sheet (`TimeField`s, split period, "Copy to…"). Put one "Copy Monday to…" action in the group header, not one per day.
- **Slice:** L06

#### LST-17 · Hours use 24-hour fields but are confirmed in 12-hour time — P2 · RC-COPY
- **Screen:** `04 - Listings/02 - Editing hours/screen-02.webp` ("Use 24-hour times", fields 09:00/17:00), `04 - Listings/02 - Editing hours/screen-03.webp` ("9:00 am – 5:00 pm"), `04 - Listings/09 - Change history & approvals/screen-01.webp` ("9:00 am – 5:00 pm")
- **Problem:** The operator types 17:00 and confirms "5:00 pm", which invites doubt at the consent step.
- **Evidence:** `lib/locations/hours-diff.ts:31` (12-hour formatter), against the 24-hour guidance in the hours tab.
- **Affects:** owner, admin
- **Fix:** Use one format everywhere. Pick 24-hour to match the fields and the British default, and format through one helper shared by `TimeField`, the copy sheet and the diff. Files: `lib/locations/hours-diff.ts`, `components/locations/hours-editor.tsx`.
- **Slice:** L05, P11

#### LST-19 · Raw IANA time-zone IDs are shown to operators — P2 · RC-COPY
- **Screen:** `04 - Listings/02 - Editing hours/screen-01.webp` ("Times are in Europe/London."), `05 - Calendar/screen-01.webp` ("(Pacific/Auckland)")
- **Problem:** These are database identifiers, not words.
- **Evidence:** `components/locations/hours-tab.tsx:521-526`; `components/calendar/publication-calendar.tsx:171-173`.
- **Affects:** all roles
- **Fix:** Format with `Intl.DateTimeFormat(…, { timeZoneName: "longGeneric" })` (for example "UK time") through a shared helper in `lib/format`. Show the zone only when it differs from the viewer's.
- **Slice:** L05, P11

#### LST-20 · The menu editor shows five tool rows for a one-item menu, and the count is mis-pluralised — P2 · RC-DENSITY
- **Screen:** `04 - Listings/03 - Editing the menu/screen-04,06.webp`
- **Problem:** Search, "Jump to section", "Changed items only", "Collapse all sections | Expand all sections" and a count line come before the first section, for one item. The count reads "1 of 1 items shown · 1 sections total".
- **Evidence:** `04 - Listings/03 - Editing the menu/screen-04,06.webp`; `components/locations/menu-editor.tsx:1004-1086`, plural bug at `:1080-1081`.
- **Affects:** owner, admin
- **Fix:** Show the find tools only above a threshold (for example more than 2 sections or 12 items). Put the filter and collapse actions behind one "Filter" chip in a `FilterChipStrip`. Use `components/ui/count-text.ts` for the plural.
- **Slice:** L07

#### LST-21 · The info-sheet title is built from a template and reads badly — P2 · RC-COPY
- **Screen:** `04 - Listings/06 - Reviewing Google suggestions/screen-02.webp` ("Where suggested updates changes go")
- **Problem:** The title is `Where ${area.label.toLowerCase()} changes go`, which breaks for plural or verb-ish area names.
- **Evidence:** `04 - Listings/06 - Reviewing Google suggestions/screen-02.webp`; `components/listings/area-frame.tsx:254`.
- **Affects:** all roles
- **Fix:** Use a fixed title "How changes reach Google", or a per-area title in `lib/listings/areas.ts` next to `modelNote`.
- **Slice:** L03

#### LST-23 · The overview repeats verification and sync status in a second "Health" list — P2 · RC-LISTROW
- **Screen:** `04 - Listings/screen-03.webp` (the "Verification · Verified · Google trusts this listing" card appears twice, and "In sync" three times counting the header)
- **Problem:** The area cards already carry each area's status. The Health strip repeats verification and sync and adds a scroll.
- **Evidence:** `04 - Listings/screen-03.webp`; `components/listings/health-strip.tsx:121-124`; `components/listings/listing-overview.tsx:293-300`.
- **Affects:** all roles
- **Fix:** Keep only "Google connection" and "Last published" as two `SettingsRow`s under the areas, or move them into the header pill's sheet.
- **Slice:** L04

#### LST-24 · Every update post is headed "Update", and the timeline is labelled "Lifecycle" — P2 · RC-LISTROW
- **Screen:** `04 - Listings/05 - Creating a post/screen-05.webp`
- **Problem:** With several update posts, every card starts with the same word, and the summary is the only differentiator. "Lifecycle" is internal vocabulary.
- **Evidence:** `04 - Listings/05 - Creating a post/screen-05.webp`; `components/locations/posts/post-card.tsx:40-41` (the headline is the type for updates), `:144` ("Lifecycle").
- **Affects:** all roles
- **Fix:** Lead with the first line of the summary (truncated) as the `ListRow` title and show the type as a tag. Rename the disclosure "History". Files: `post-card.tsx`, `components/locations/posts-tab.tsx`.
- **Slice:** L09

#### LST-25 · The composer repeats its draft copy three times, uses borderless fields, and shows "Preview" twice — P2 · RC-COPY
- **Screen:** `04 - Listings/05 - Creating a post/screen-02..04.webp`
- **Problem:** "Saved as a draft. Nothing reaches Google until you publish it from the list." appears in the header, then "Nothing to save yet. Write the post first." and "This saves a draft. Nothing goes to Google…" in the footer. Fields are borderless at rest, unlike every other editor in this family, so the event title and summary read as empty space. The collapsible "Preview" contains another "Preview" heading. Event start and end show identical date and time values in `screen-04`, but the fields default to empty in code (`:110-113`); the source of the values is unverified.
- **Evidence:** `04 - Listings/05 - Creating a post/screen-02..04.webp`; `components/locations/posts/post-composer-sheet.tsx:399,488,1018` (copy), `:96-100` (BARE inputs); `components/locations/posts/post-preview.tsx` (inner heading).
- **Affects:** owner, admin
- **Fix:** Say it once, in the footer status. Use the default `Input`/`Textarea` inside `Field`, as in the profile and menu editors. Drop the inner "Preview" label.
- **Slice:** L09

#### LST-26 · Inviting someone jumps from a sheet to a page panel, with unlabelled steps and a jargon toast — P2 · RC-FEEDBACK
- **Screen:** `04 - Listings/10 - Managing people/screen-02..04.webp`
- **Problem:** "Add administrator" opens a sheet with Role defaulting to "Manager", so the button says administrator while the role says manager. "Review invitation" closes the sheet and moves to an inline page card with a stepper whose later steps show only "3" and "4" on a phone. The toast says "Administrator invitation review saved". By contrast, the booking flow keeps its review in a sheet.
- **Evidence:** `04 - Listings/10 - Managing people/screen-02..04.webp`; `components/locations/administration/invitations.tsx:204` (toast), `:237-241` (labels); `components/ui/stepper.tsx:134,148` (non-current labels `max-md:sr-only`); `components/reviewed-write/panel.tsx:61-66` (panel versus sheet rule).
- **Affects:** owner, admin
- **Fix:** Label the entry "Invite someone". Keep review → approve → send in one `ReviewedWriteSheet` opened from the form, or show the full step labels on a phone, since the labels are short. Use the toast "Invitation ready to approve". Files: `invitations.tsx`, `components/ui/stepper.tsx`, `components/locations/administration/access-review.tsx`.
- **Slice:** L13

#### LST-27 · The read-only member view is a greyed editor, and its empty state tells members to edit — P2 · RC-STATES
- **Screen:** `04 - Listings/09 - Change history & approvals/01 - Requester view/screen-01,02.webp`
- **Problem:** A member sees every editor field disabled, with "Changed" markers and an amber "Changed on Google" they cannot act on. On Review & publish, the empty state says "Edit an area and come back here to publish it" to someone who cannot edit or publish.
- **Evidence:** `04 - Listings/09 - Change history & approvals/01 - Requester view/screen-01,02.webp`; `components/listings/review-publish.tsx:792` (copy has no capability check); `components/editors/editor-frame.tsx:135` (gate); `lib/locations/gating.ts:42`.
- **Affects:** member, viewer
- **Fix:** For read-only roles, render values as `SettingsRow` read rows, not disabled inputs. Change the empty-state copy by capability ("Nothing is waiting to go to Google."). Hide "Review & publish" for roles that cannot publish. Files also include `components/locations/profile/profile-editor.tsx`.
- **Slice:** L11

#### LST-28 · Calendar "off" is a dead end, its description describes a calendar that is not there, and the page has no current nav item — P2 · RC-STATES
- **Screen:** `05 - Calendar/screen-01.webp`; `desktop/calendar.webp`
- **Problem:** The page keeps "Scheduled post publications across the listings you can see… (Pacific/Auckland)" above "Scheduled publishing is off… ask NabaPresence support". There is no link or action and no route back to posts. On the phone no bottom tab is marked current, although `tab-bar.tsx:79` intends to mark More current on More destinations (cause unverified). On desk at 1280 no sidebar item is current and "More" is collapsed, so the page has no visible place in the navigation. Calendar is dropped from the nav when scheduling is off, but its route still renders.
- **Evidence:** `05 - Calendar/screen-01.webp`; `desktop/calendar.webp`. `components/calendar/publication-calendar.tsx:171-209`; `components/app-shell/tab-bar.tsx:77-81`; Calendar is filtered out by `needsPostScheduling` at `lib/navigation/destinations.ts:197`.
- **Affects:** owner, admin (support copy); member, viewer ("ask an owner"); anyone who lands on `/calendar` from the palette or a link.
- **Fix:** When unavailable, drop the long description and give `Empty` an action: owners get "Contact support" (mailto or help link); others get "Go to Listings". Either redirect `/calendar` to Listings when scheduling is off, or show Calendar in the nav as muted with its reason so the page has a current item. Check the More tab's current state on `/calendar` in agency mode. Files: `components/calendar/publication-calendar.tsx`, `components/app-shell/tab-bar.tsx`, `app/(dashboard)/calendar/`.
- **Slice:** L17
- **Merged:** DSK-08 (Calendar part)

#### LST-29 · The "Copy to…" accessible name does not contain its visible label (WCAG 2.5.3) — P2 · RC-A11Y
- **Screen:** `04 - Listings/02 - Editing hours/screen-02.webp`
- **Problem:** The visible text is "Copy to…" but the aria-label is "Copy Monday's hours to other days". A voice-control user saying "Tap Copy to" will not match. The spec names 2.5.3.
- **Evidence:** `04 - Listings/02 - Editing hours/screen-02.webp`; `components/locations/hours-editor.tsx:607-611`.
- **Affects:** all editing roles using assistive tech
- **Fix:** Use the label "Copy to… (Monday's hours)", or keep the visible text and add the day through `aria-describedby`.
- **Slice:** L05

#### LST-31 · The booking area mixes "booking link", "action link" and process jargon — P2 · RC-COPY
- **Screen:** `04 - Listings/07 - Adding a booking link/screen-01..04.webp`
- **Problem:** The area is "Booking links", but the empty state says "No action links yet", the form "Add an action link", the button "Review action link", and the lists "Saved action link work", "No saved action link requests". The copy explains internals: "Approval saves the exact request; sending to Google is a separate action", "Recorded outcomes remain available when Google cannot be read. Expired approvals cannot be sent again", and "Approval expires: 15 Oct, 22:04".
- **Evidence:** `04 - Listings/07 - Adding a booking link/screen-01..04.webp`; `components/locations/booking-tab.tsx:335,828,840,1045`; `components/locations/place-actions/saved-place-action-work.tsx:77-79,113`; `components/locations/place-actions/place-action-approval-sheet.tsx:145`.
- **Affects:** owner, admin
- **Fix:** Use "booking link" throughout. Collapse the process copy into the reviewed-write steps (LST-10). Show expiry only when it is within the next hour. Files: `booking-tab.tsx`, `components/locations/place-actions/*`.
- **Slice:** L08

#### DSK-01 · Listing area tabs overflow at 1280, which hides "Suggestions" and "Review & publish" — P2 · RC-NAVSTRIP
- **Screen:** `desktop/listings--loc.webp`, `desktop/listings--loc--hours.webp`, `desktop/listings--loc--profile.webp`, `desktop/listings--loc--posts.webp`, `desktop/listings--loc--menu.webp`
- **Problem:** The area tab row holds 11 items but has only about 975px. The row ends in a fade, so "Suggestions" is cut to "Sugges" and "Review & publish", the last tab, is entirely off-screen. The scrollbar is hidden and there are no scroll buttons, so a mouse user without a horizontal wheel cannot reach the tab that carries the changes-to-publish count from the strip; it stays reachable through the header's "…" overflow (Review & publish), which is why this is P2. The spec rule "never truncate a label" is broken at desk width.
- **Evidence:** All five captures show "Sugges" clipped at the right edge. The row is `hidden lg:block` (`components/listings/area-frame.tsx:139-152`). `TabNav` hides the scrollbar and relies on a mask fade (`components/ui/tabs.tsx:39-48`). "Review & publish" is added last (`lib/listings/area-nav.ts:121-122`).
- **Affects:** owner, admin, member (anyone editing or publishing a listing).
- **Fix:** Give `TabNav` a desk overflow mode: either wrap from `lg`, or keep as many tabs as fit and move the rest into a "More ▾" `DropdownMenu`. Move "Review & publish (n)" out of the strip into the `ListingAreaHeader` actions as a button beside Activity so it is always visible. On Overview the area cards already list every area, so the strip could start at the first area. Files: `components/ui/tabs.tsx`, `components/listings/area-frame.tsx`, `lib/listings/area-nav.ts`.
- **Slice:** L03, P04

#### DSK-05 · Listing pages repeat the same place four times while the breadcrumb trail is cut to stubs — P2 · RC-APPBAR
- **Screen:** `desktop/listings--loc.webp`, `desktop/listings--loc--hours.webp`, `desktop/listings--loc--profile.webp`, `desktop/listings--loc--menu.webp`
- **Problem:** On the listing Overview, "Journey Hospitality" appears in the breadcrumb, the health chip ("Journey Hospitality: Partially checked"), the switcher above the h1 and the sidebar. On area pages the trail is cut to "Listi… / Journey Hospit… / Stub location ffb1… / Opening hou…" even though there is free space, because the health chip refuses to shrink. Directly below, the eyebrow, switcher and h1 spell out the same trail in full. The code comment says crumbs were dropped below `wide` because they "repeated the eyebrow and the h1 below it", and at `wide` they still do.
- **Evidence:** The four captures above. The health chip is `shrink-0 max-w-[min(22rem,34vw)]` (`components/app-shell/context-health-chip.tsx:86`). Ancestor crumbs shrink first and every crumb truncates (`components/app-shell/breadcrumbs-context.tsx:88-91, 104, 114`). The page header draws a client caption, a listing switcher and an h1 (`components/listings/area-frame.tsx:435-473, 500-502`).
- **Affects:** all roles
- **Fix:** At `wide`, let the toolbar trail carry the hierarchy: drop the client caption from `ListingAreaHeader` and make the listing crumb itself the `SiblingSwitcher`. Let the health chip shrink with its label truncating, or show only the dot plus a short word when a client is in scope. Collapse middle crumbs into a "…" `DropdownMenu` before truncating any of them. Files: `context-health-chip.tsx`, `breadcrumbs-context.tsx`, `area-frame.tsx`.
- **Slice:** L03

#### DSK-06 · On the listing Overview, a control showing the client's name actually switches between listings — P2 · RC-APPBAR
- **Screen:** `desktop/listings--loc.webp` (compare `desktop/listings--loc--hours.webp`)
- **Problem:** Above the h1 on Overview, "Journey Hospitality ▾" opens a menu of that client's listings, not of clients. On every area page the same control shows the listing name. A sighted user reasonably expects the Overview control to change client; its purpose ("switch to another listing of this client") exists only as screen-reader text.
- **Evidence:** `desktop/listings--loc.webp`. On Overview the trigger's children are the client label (`components/listings/area-frame.tsx:458-472`). The trigger text plus `sr-only` purpose is at `components/listings/sibling-switcher.tsx:73-75`, and the menu lists siblings only (`:51-53`).
- **Affects:** owner, admin, member (agency mode, clients with two or more listings).
- **Fix:** Make the listing name the trigger on every listing page. On Overview, put the `SiblingSwitcher` on the h1 line or label it "2 listings ▾". Keep the client as plain caption text or leave it to the breadcrumb (see DSK-05). Files: `area-frame.tsx`, `sibling-switcher.tsx`.
- **Slice:** L03

#### DSK-14 · The Posts empty state points to a button elsewhere instead of carrying its own action — P2 · RC-STATES
- **Screen:** `desktop/listings--loc--posts.webp` (compare `desktop/listings--loc--menu.webp`, `desktop/team.webp`)
- **Problem:** On Posts, "New post" floats alone at the right above a divider, while the empty state in the middle tells the user to "Write the first one with New post". Food menu's empty state carries its own "Start a menu" button, and Listings, Clients and Team put their primary action in the page header. That gives three placements for the same "create the first one" job.
- **Evidence:** `desktop/listings--loc--posts.webp`. The empty state has no `action` (`components/locations/posts-tab.tsx:302-313`); compare `components/locations/menu-tab.tsx:364`.
- **Affects:** owner, admin, member
- **Fix:** Pass `action={<Button>New post</Button>}` to `Empty` when there are no posts, and hide the floating button in that state. With posts present, put "New post" in the `ListingAreaHeader` `actions` slot beside Activity. Files: `posts-tab.tsx`, `area-frame.tsx`.
- **Slice:** L09

#### DSK-15 · Status words and card actions differ for the same listing area — P2 · RC-COPY
- **Screen:** `desktop/listings--loc.webp`, `desktop/listings--loc--hours.webp`, `desktop/listings--loc--menu.webp`, `desktop/listings--loc--posts.webp`
- **Problem:** The Overview cards say "In sync". The Hours page header says "In sync with Google" and the Food menu header says "In sync". Other areas say "On Google" or "Nothing waiting". The card button reads "Edit" on some areas and "Check" on Photos, Posts, People with access and Verification, even though "Check" only opens the area. Next to "Check Google now" on the area pages, it reads as though it triggers a Google check.
- **Evidence:** The four captures above. Labels are in `lib/listings/area-state.ts:113, 149, 202, 221` and `lib/listings/health.ts:229` ("In sync with Google"). The verb logic is `components/listings/area-cards.tsx:274-284`, which hard-codes "Check" for `["photos","posts","people","verification"]`.
- **Affects:** owner, admin, member
- **Fix:** Use one status vocabulary for area pills in both `StatusPill` callers. Give the card link "Open", or a task verb that matches the state ("Add photos", "Write a post"), and keep "Check" for the action that actually queries Google.
- **Slice:** L03

### One-off components

| One-off (file:lines) | Should reuse | Slice |
| --- | --- | --- |
| `components/locations/place-actions/place-action-approval-sheet.tsx` | `components/reviewed-write/sheet.tsx` (`ReviewedWriteSheet`) + `steps.tsx` + `summary-list.tsx` + `outcome-summary.tsx` + `consent.tsx` | L08 |
| `components/listings/review-publish.tsx:977-1025` (hand-docked bar) | `components/ui/action-bar.tsx` with `dock` and `primary` | P02 |
| `components/editors/editor-footer.tsx:209-243` (free-form `actions`) | `components/ui/action-bar.tsx` `primary` + `secondaryActions` | P02 |
| `components/locations/booking-tab.tsx:832-842` (secondary submit in the card footer) | `components/ui/action-bar.tsx` (docked, appears once dirty) | L08 |
| `components/locations/posts-action-bar.tsx:500-515` (publish `AlertDialog` for a Google write) | `components/reviewed-write/consent.tsx` inside the composer footer, or `ReviewedWriteSheet` | L10 |
| `components/locations/posts/post-composer-sheet.tsx:96-100` (`BARE` borderless inputs) | `components/ui/input.tsx` / `textarea.tsx` defaults inside `components/ui/field.tsx` | L09 |
| `lib/locations/menu-diff.ts:59-63` (`display()` stringifying objects) | `components/editors/change-diff.tsx` / `components/ui/diff-view.tsx` structured rows | L01 |
| `components/locations/hours-editor.tsx:420-615` (per-day block with inline switch, periods and copy) | `components/ui/list-row.tsx` / `settings-row.tsx` rows opening `components/ui/sheet.tsx` with `time-field.tsx` | L06 |
| `components/listings/health-strip.tsx` (second status list) | `components/ui/settings-row.tsx` (two rows), or merge into the area `ListRow`s | L04 |
| `components/locations/administration/verification-tab.tsx:46-66` (five always-on `SectionHeader` blocks) | `components/ui/card.tsx` status plus `components/ui/settings-row.tsx` tool links behind a disclosure | L12 |
| `components/listings/area-frame.tsx:163-224` (AreaSwitcher as an extra button row duplicating the H1) | the H1 as the trigger of the existing `components/ui/dropdown-menu.tsx` sheet | L03 |

### Needs owner setup
- **Uploading a photo:** no image fixture, so only the sheet was shown (`04 - Listings/04 - Managing photos/screen-03`). Needs an image fixture to audit progress, failure, the per-file review list and the post-upload grid.
- **Requester to approver approval of a listing edit:** the seeded requester is a member and can only view. Needs an approval-policy fixture where a non-owner can request a listing change.
- **Bulk edit** (`/listings/bulk`, `/listings/bulk/[operationId]`): the `bulk_actions` feature is off for the seeded organisation.
- **Scheduled posts on the calendar, and the schedule-post sheet:** scheduled publishing is off, so only the "off" state shows (`05 - Calendar/screen-01`). "Schedule publication" in the post overflow (`posts-action-bar.tsx:427-431`) could not be reached.
- **Google suggestions to accept or ignore:** the fixture has none (`04 - Listings/06 - Reviewing Google suggestions/screen-01`).
- **Send and outcome steps of booking-link and invitation writes:** captures stop at Approve (`04 - Listings/07 - Adding a booking link/screen-04`) and at the inline approve panel (`04 - Listings/10 - Managing people/screen-04`). Needs a run past Approve against the Google stub.
- **Verification with a pending PIN request:** the seeded listing is verified, so "Enter the PIN from Google" (`verification-tab.tsx:53`) did not render.
- **Posts awaiting approval:** the "Awaiting approval" chip shows 0. Needs a post-approval policy fixture.
- **A listing with real (long) venue names:** needed to size the app-bar truncation on deep listing pages (see SET-07). Stub names are short IDs.

## Clients and Reports

### Steps per flow

| Flow | Task | Now (taps) | Notion Mail equivalent (taps) | Gap |
| --- | --- | --- | --- | --- |
| Reports | Choose whose figures and which period | 6: scope pill (1) → Client (2) → client in a nested action sheet (3) → Period (4) → period (5) → Done (6). Client alone via the app-bar chip is 2, but the period still needs +4 | Filtering emails: filter button (1) → option in an inline menu (2) | +4 taps, and a sheet stacked on a sheet |
| Reports | Switch between Reply / Google / Keywords | 1; the period can change silently (Keywords jumps from "Last 28 days" to "Last 6 months") | No equivalent | 0 taps, but the period context is lost |
| Reports | Reach the first figure on the Google / Keywords tab | Scroll about one screen past the description, scope pill, tabs, provenance lines, Refresh, coverage warning, CSV and (Keywords) an info box | Inbox content starts directly under the header | About one screen of scrolling |
| Sharing a report | Share a client's report from its hub | 6: Clients tab (1) → client card (2) → Share report (3) → [expiry, optional] → Create link (4) → Share link (5) → target in the system sheet (6) | Switching account: 3 taps, confirmed with a toast | Matches from the hub (3 taps inside the sheet) |
| Sharing a report | Share from Reports with "All clients" in scope | 7: scope pill (1) → Client (2) → client (3) → Done (4) → share icon (5) → Create link (6) → Share link (7); no Share button and no hint with all clients in scope | 3 | +4, and hard to find |
| Sharing a report | Recipient changes the period | 2: open the link (1) → period text-tab (2) reloads the whole page and lands at the top | No equivalent | n/a |
| Clients | Create a client and start set-up | About 12-14: New client (1) → name (typed) → [colour (1)] → Create client (2) → Connect: Sign in with Google or Use this account (3) → Google consent (fixture limit) → Continue (4) → Account, Listings, Import, Notifications, Team, each with a choice and Continue | Onboarding: about 6 taps and 2 fields across 11 screens, one primary action per screen | +6-8 taps (the domain is more complex); the first step's primary action is unclear (CLR-18) |
| Clients | Find a client that needs work | 3: Clients tab (1) → health chip, scrolling the strip first when the bucket is off-screen (2) → card (3) | Filtering emails: 2 taps | +0-1 |
| Clients | Switch the app-wide client scope | 2: app-bar chip (1) → client row (2), with a polite announcement | Switching account: 3 taps plus a toast | −1 (better) |
| Clients | Edit a client's name, colour or notes | 3: Hub → Settings (1) → Details row, an in-page anchor (2) → edit → Save changes (3) | Adding a label: about 3-4 taps, applied inline with no save step | 0 taps, but the save bar is inline mid-page, not docked |
| Clients | File or move a listing under a client | 4: Hub → Settings (1) → Listings anchor (2) → Move to… (3) → client (4), with an Undo toast | Adding a label: about 4 taps | 0 |
| Clients | Archive a client | 5: Hub → Settings (1) → Archive row (2) → Archive {client} (3) → "I understand" checkbox (4) → Archive / Unfile and archive (5) → toast with Undo | Disconnecting an address: 4 taps, and it cannot be reversed | +1 tap and a checkbox, for an action that can be undone |

### Findings

#### CLR-01 · Two client-scope controls on Reports; the page's own takes 6 taps through a sheet stacked on a sheet — P1 · RC-SCOPE
- **Screen:** `06 - Reports/screen-01.webp`
- **Problem:** The app bar shows an "All clients" scope chip, and directly below it the page shows a second "All clients · 2 locations · Last 28 days" pill. Both write the same `?clientId=`. The page pill opens a bottom sheet of three Selects, and on a phone each Select opens its own bottom action sheet, so choosing a client and a period takes 6 taps through a sheet on a sheet, then Done. Notion Mail filters in 2 taps with an inline menu.
- **Evidence:** `06 - Reports/screen-01.webp`; `components/performance/performance-view.tsx:233-295` (page reads `?clientId=` at `:119-121,249-258`); `components/reporting/report-toolbar.tsx:80-158` (sheet of Selects at `:141-157`); `components/performance/scope-select.tsx:62-81`; `components/app-shell/scope-sheet-model.tsx:42,78-85` (switcher treats `/reports` as a scoped path)
- **Affects:** owner, admin, member, viewer (agency). In business mode the pill still holds Location and Period.
- **Fix:** Make the app-bar chip (`ClientScopeChip` and the scope sheet, which already pushes to locations) the only client/location scope on a phone. Replace the page pill with the period alone, as a `ChipRow`/`ToggleChip` strip or `SegmentedControl` (`components/ui/chip.tsx`, `components/ui/segmented-control.tsx`) under the tabs, so the period is one tap. Keep the inline fields from `md`.
- **Slice:** R12a, P05

#### CLR-02 · On the Google and Keywords tabs, the figures sit below a screen of chrome and notices — P1 · RC-DENSITY
- **Screen:** `06 - Reports/screen-03.webp`, `06 - Reports/screen-04.webp`
- **Problem:** Before the first figure, the phone shows the h1 and its two-line description, the scope pill, the tabs, two provenance lines, a right-aligned Refresh from Google button, a 5-line amber coverage warning and a "Download totals CSV" link. Keywords adds a blue "How Google counts these" box. On Google the first KPI tile only starts at the bottom edge. On Keywords no search term is visible on the first screen at all. The Reply tab starts its tiles about halfway down (`06 - Reports/screen-01.webp`).
- **Evidence:** `06 - Reports/screen-03.webp`, `screen-04.webp`; `app/(dashboard)/reports/page.tsx:21-26`; `components/performance/google-performance-tab.tsx:63-84,205-221`; `components/performance/keywords-tab.tsx:61-84,127-136`; `components/reporting/presence-provenance.tsx:102-126`
- **Affects:** all roles. Refresh is shown to owner/admin only, so their view is longest.
- **Fix:** On a phone, hide the page description below `md`. Fold provenance into one caption line ("Through 14 Oct · 1 of 2 locations") with an info button that opens a `Sheet` for the detail. Move Refresh into an overflow menu (`DropdownMenu`, which becomes an action sheet on a phone). Collapse `PartialCoverageAlert` to a one-line `Alert` with "Details". Put "How Google counts these" as a footnote under `KeywordsTable`. Move CSV under the tiles.
- **Slice:** R12a

#### CLR-13 · The hub says "Needs attention" and "Review checks are up to date" together — P1 · RC-COPY
- **Screen:** client hub, visible behind the share sheet in `06 - Reports/01 - Sharing a report/screen-01.webp`
- **Problem:** For `health === "attention"`, the hub's description is `freshnessSentence(client.freshness)`. When `freshness.reason` is `null`, that returns "Review checks are up to date." So an amber "Needs attention" pill sits on top of an all-clear sentence, with no hint of what needs attention.
- **Evidence:** `06 - Reports/01 - Sharing a report/screen-01.webp`; `components/clients/client-hub.tsx:236-245`; `lib/clients/health.ts:513-529`
- **Affects:** owner, admin, member, viewer (agency)
- **Fix:** Fall back to `healthDescription("attention")` when `freshness.reason` is null. Better, name the listing or area that caused it, with a link.
- **Slice:** R15

#### CLR-16 · New client and client Details: the save bar is inline mid-page, the tab bar stays, and New client has no leave guard — P1 · RC-ACTIONBAR
- **Screen:** `07 - Clients/screen-02.webp`, `07 - Clients/screen-03.webp`, `07 - Clients/screen-07.webp`
- **Problem:** New client is a task screen, but the tab bar stays and "Create client" sits in an inline `CardFooter` halfway down the page. With the keyboard open on Notes, the button is off-screen. The name field `autoFocus`es, so the keyboard opens on arrival. Back or Cancel throws away typed notes with no prompt. The same three fields in Client settings › Details do have `useUnsavedChanges`, but also an always-visible inline footer ("No unsaved changes"), which then scrolls away above Listings and Archive. The design-system spec says the action bar is docked on a phone, rides the keyboard, and appears with the first change.
- **Evidence:** `07 - Clients/screen-02.webp`, `screen-03.webp`, `screen-07.webp`; `components/clients/client-form.tsx:80-161,113`; `components/clients/client-settings.tsx:992-1004,1097-1156`; `components/ui/action-bar.tsx` (docking contract)
- **Affects:** owner, admin
- **Fix:** Use `ActionBar` with `dock` in both: New client always visible, with Create client as the primary; Details with `visible={dirty}`. Add `useUnsavedChanges` to `NewClientForm`. Drop `autoFocus` on touch, or keep it and rely on the docked bar.
- **Slice:** R17

#### CLR-18 · The Connect step's hint points at a button that is off-screen, and the faster path comes second — P1 · RC-COPY
- **Screen:** `07 - Clients/screen-04.webp`
- **Problem:** The docked bar's amber hint says "Choose 'Use this account', or connect another Google account, to continue". That button is below the fold, after "Sign in with Google" and both consent lists, in the "Use an account already connected" section. The green Continue looks enabled but is blocked. With an existing login, reusing it is one tap, yet it comes after the new-sign-in path. Notion's onboarding shows one primary action per screen (`01 - Onboarding/screen-08.webp`).
- **Evidence:** `07 - Clients/screen-04.webp`; `components/setup/step-connect.tsx:153-230,300-334`; `lib/setup/steps.ts:268-272`; `components/setup/setup-wizard.tsx:252-255,314-318,486-527`
- **Affects:** owner, admin
- **Fix:** When usable logins exist, render them first as `OptionRow`s with "Use this account", then "Or sign in with another Google account". Word the hint after what is on screen ("Pick an account above"), and scroll or focus the first option when blocked Continue is pressed.
- **Slice:** R18

#### CLR-19 · Health filter chips: empty buckets, two chip primitives, clipped at 1280, and health words that mean nothing — P1 · RC-NAVSTRIP
- **Screen:** `07 - Clients/screen-01.webp`, `desktop/clients.webp` (compare `desktop/listings.webp`), `03 - Inbox/04 - Switching client scope/screen-01.webp`
- **Problem:**
  - The strip always shows all 8 buckets. "Action needed 0" and "Needs attention 0" come second and third and mean nearly the same thing. The only client is in "Partially checked", the sixth chip, which needs a sideways scroll to find.
  - At 1280 the Clients page puts a 320px search box and eight chips on one row. "Partially ch…" is cut by the fade and two more chips are hidden past it, so the chip that matches the only client is the one the user cannot read.
  - Listings does the same job differently: search on its own row, chips that wrap from `md`, an accent-tint pressed state. Clients uses a black-filled pressed chip that never wraps. The filter words also differ (Listings: Needs attention, To publish, Not linked, In sync; Clients: Action needed, Needs attention, In sync, Not checked, Partially checked and more), which breaks the spec's rule of one primitive per job.
  - "Partially checked" is shown without saying what was checked or whether to act, in the filter, in the scope sheet and with "Some listing areas need checking" on the hub.
- **Evidence:** `07 - Clients/screen-01.webp`; `desktop/clients.webp`; `03 - Inbox/04 - Switching client scope/screen-01.webp`; `components/clients/health-filter.tsx:94-131` (`ChipRow` and `ToggleChip`); `components/clients/clients-index.tsx:303-318` (`md:flex-row` row, `md:w-80` search); `components/listings/listings-board.tsx:843-862` (`FilterChipStrip`, `FilterChip`, `md:flex-wrap`); `components/ui/chip.tsx:49-51` (`chipClassName`, `bg-ink`) vs `:281-297` (`filterChipClassName`, `bg-accent-tint`); `lib/clients/health.ts:248-257,371-380`; `components/app-shell/client-scope-rows.tsx:37-53`
- **Affects:** all roles (agency)
- **Fix:** Move `HealthFilterStrip` onto `FilterChipStrip` and `FilterChip` with `md:flex-wrap`, put search on its own row as Listings does, and retire `ToggleChip` for filters. Hide buckets with a count of 0 unless selected (or fold them into a "More filters" `DropdownMenu`), and order the urgent buckets by count. Agree one health vocabulary for client and listing filters; rename "Action needed" to say what it is ("Login broken" or "Reconnect needed"), and replace "Partially checked" with plain words ("Some listings not checked yet"), keeping the word-plus-tone pattern, in `lib/clients/health.ts` so the chip, scope sheet and hub read the same.
- **Slice:** R16, P04
- **Merged:** DSK-04, INB-20

#### CLR-03 · The Google tab's provenance lines contradict each other and use internal words — P2 · RC-COPY
- **Screen:** `06 - Reports/screen-03.webp`
- **Problem:** The caption says "Data through 14 Oct (Google's daily dates) · Not fetched successfully yet". The next line says "1 of 2 locations reporting · 2 not fetched yet". That reads as both "we have data" and "we never fetched", and as 1 location reporting while 2 are not fetched. The counts are computed independently: `reporting` counts locations with metric rows, and `pending` counts locations with no successful checkpoint, so they can overlap whenever rows exist without a recorded success. The fixture produced this state; how often real data does is unverified. The warning box below repeats "Not fetched from Google yet". "Google's daily dates" and "reporting" are internal terms.
- **Evidence:** `06 - Reports/screen-03.webp`; `components/reporting/presence-provenance.tsx:84-125`; `lib/server/presence-report.ts:229-247`
- **Affects:** all roles
- **Fix:** Derive one disjoint status per location on the server (has data / waiting for first fetch / refresh failed / stale), so the counts add up to `eligible`. Say it once in plain words ("Figures up to 14 Oct. 1 location hasn't sent figures yet."), and name that location only in the expandable detail. Needs an owner decision before Phase 2: a server-side disjoint status per location.
- **Slice:** R12b

#### CLR-04 · The bar charts read wrong at a glance and their bars are about 10px tap targets — P2 · RC-CHART
- **Screen:** `06 - Reports/screen-02.webp`, `06 - Reports/01 - Sharing a report/screen-04.webp`
- **Problem:** The busiest bar (14 Oct, labelled "2") stands right above the "15 Oct" axis label. Meanwhile the readout says "Latest day · 15 Oct: Reviews 0, Replies 0", and the real latest bar's "0" is crammed against it. "Average rating over time" shows a 4.5 bar beside "15 Oct: Average rating —". 28 daily columns share about 270px, so each column is about 10px wide with no extended hit area. The figcaption says "Tap a bar for its figures", but on a phone that is a mis-tap. A daily average rating drawn as bars on a 0-5 scale is mostly empty days. The "Show values" table and keyboard slider are good alternatives, which is why this is P2.
- **Evidence:** `06 - Reports/screen-02.webp`; `components/reporting/report-bar-chart.tsx:141-167` (peak/latest labels, readout), `:153` (minimum column 1-5px), `:263-301`, `:328-339` (only first/middle/last axis labels), `:366-373`
- **Affects:** all roles, and public report recipients
- **Fix:** Put the date in the peak label ("2 on 14 Oct"). Make the readout follow a horizontal drag across the plot (pointer move or scrub) rather than per-bar taps, keeping the slider semantics. Group by week below a width threshold on a phone. Draw average rating as a line or dot series, or as a single KPI with a weekly trend (`ReportBarChart`, `ReplyFigures`).
- **Slice:** R13

#### CLR-05 · Internal words and GBP jargon in Reports and on the client hub — P2 · RC-COPY
- **Screen:** `06 - Reports/screen-01.webp`, `07 - Clients/screen-05.webp`, `07 - Clients/screen-06.webp`, `desktop/clients--client.webp`
- **Problem:** Several labels use internal or Google terms:
  - "vs the previous window" and "Changes compare with the 28 days before this window". "Window" is internal; the public report already says "period".
  - "Data through … (Google's daily dates)".
  - "Impressions since 1 May".
  - "Behind it: stub@example.test" for the connected Google login.
  - "Review import · Not started · Start the import", with no explanation of what is imported.
  - "Failed publishes".

  The same strings show on a phone.
- **Evidence:** `components/reporting/delta-badge.tsx:28-33`; `components/reporting/reply-figures.tsx:88-95,280-282`; `components/reporting/presence-provenance.tsx:84-86`; `components/performance/keywords-tab.tsx:65-67`; `components/clients/client-hub.tsx:404-407` ("Behind it"), `:302-308`, `:697-739` (Review import at `:702`, "Start the import" at `:738`)
- **Affects:** all roles
- **Fix:** Use the public copy set for internal users too ("vs the 28 days before"). Replacements: "Behind it:" → "Google login:"; "Review import" → "Past reviews", with "Bring in past reviews" and a one-line `CardDescription` ("Bring in the reviews Google already holds for these listings"); "Failed publishes" → "Replies that didn't post"; "Impressions" → "Times shown in search".
- **Slice:** R15
- **Merged:** DSK-16 (client-hub part)

#### CLR-06 · One family, three nouns for the same thing: location, listing, venue — P2 · RC-COPY
- **Screen:** `06 - Reports/screen-01.webp` ("2 locations"), `07 - Clients/screen-06.webp` ("Listings", "Add listings from Google", "Listings linked"), `06 - Reports/01 - Sharing a report/screen-03.webp` ("Venues")
- **Problem:** A client's Google Business Profile entries are "locations" in Reports, "listings" on the hub and in settings, and "venues" on the shared report. The client index card says "Linked 2 / 2" with no noun.
- **Evidence:** `components/performance/performance-view.tsx:75-77`; `components/clients/client-hub.tsx:309-314,507-516`; `components/share/shared-client-report.tsx:129-134,234`
- **Affects:** all roles, and public recipients
- **Fix:** Pick one user-facing noun ("listing" matches the Listings tab), put it in `lib/workspace/terms.ts`, and read it everywhere, including `PartialCoverageAlert` nouns.
- **Slice:** R15, P11

#### CLR-07 · Refresh from Google refreshes everyone, then gives no visible progress — P2 · RC-FEEDBACK
- **Screen:** `06 - Reports/screen-03.webp`, `06 - Reports/screen-04.webp`
- **Problem:** The button sits on a client-scoped report. However, "the sync endpoints take no client scope … a client-scoped report refreshes every client's figures", and the label does not say so. After the toast ("New figures appear here as Google sends them") nothing polls: `useAnalyticsPresence` has no `refetchInterval`, so figures only change on a later refetch. The handler also invalidates the presence queries and then calls `presence.refetch()`, which is two requests for one press.
- **Evidence:** `components/performance/refresh-google-button.tsx:24-30,55-76`; `lib/queries/use-analytics-presence.ts`; `components/performance/google-performance-tab.tsx:75-81`
- **Affects:** owner, admin
- **Fix:** Label it honestly ("Refresh all clients from Google") or scope the endpoint. While a sync checkpoint is `running`, poll with `refetchInterval` and show an inline "Refreshing…" status in the caption. Drop either the invalidate or the explicit refetch. Needs an owner decision before Phase 2: refresh scope.
- **Slice:** R13

#### CLR-08 · The report tabs load with different shapes; Google and Keywords use generic rows — P2 · RC-STATES
- **Screen:** `11 - Empty, loading & error states/01 - Loading/screen-02.webp` (Reply: shaped skeleton)
- **Problem:** Reply loads with `ReportsSkeleton variant="tab"`: tiles plus a chart shape, which looks right. Google and Keywords use `ReportingPanel variant="loading"`, which is `QueryPending`'s generic list rows. On those tabs the swap to tiles or a table moves the layout. The Google caption is also `null` until data arrives, so the provenance lines push the content down when they appear.
- **Evidence:** `components/performance/reply-performance-tab.tsx:26-28`; `components/performance/google-performance-tab.tsx:95-98` (caption `null` at `:65-71`); `components/performance/keywords-tab.tsx:116-118`; `components/reporting/reporting-states.tsx:113-117`
- **Affects:** all roles
- **Fix:** Give `ReportsSkeleton` a `google` variant (tile grid) and a `keywords` variant (record cards), and reserve the caption's line height while pending.
- **Slice:** R13

#### CLR-09 · A one-location report fetches in a waterfall — P2 · RC-PERF
- **Screen:** Reports with `?locationId=`, reached from a hub listing's More › Reports (`07 - Clients/screen-06.webp`)
- **Problem:** `LocationReport` renders a skeleton until the location directory has loaded, and only then mounts the figures that start their own queries. The figures wait for the directory request to finish.
- **Evidence:** `components/performance/location-report.tsx:49,60-64`
- **Affects:** all roles
- **Fix:** Start the figure queries from `locationId` straight away, in parallel with the directory, and let only the name and sibling picker wait for the directory.
- **Slice:** R13

#### CLR-10 · You can't share from Reports until you pick a client, and nothing says so — P2 · RC-ACTIONBAR
- **Screen:** `06 - Reports/screen-01.webp`
- **Problem:** With "All clients" in scope, Share report is not rendered and nothing replaces it. Once a client is chosen it appears as an icon-only button with its label hidden below `md`. The captured sharing flow therefore starts from the client hub instead (`06 - Reports/01 - Sharing a report/screen-01.webp`).
- **Evidence:** `06 - Reports/screen-01.webp`; `components/performance/performance-view.tsx:140,286-294`; `components/clients/share-report-dialog.tsx:127-151`
- **Affects:** owner, admin (agency)
- **Fix:** With all clients in scope, show "Share a client's report" in the overflow menu. It should open the shared `Sheet` with a client list (the scope sheet's client rows), then the share step.
- **Slice:** R12a

#### CLR-11 · The share sheet's actions don't follow the sheet footer pattern, and its rows are hand-built — P2 · RC-SHEET
- **Screen:** `06 - Reports/01 - Sharing a report/screen-01.webp`, `06 - Reports/01 - Sharing a report/screen-02.webp`
- **Problem:** "Create link" is a right-aligned inline button in the middle of the sheet, with the "Links for…" list below it. After creation, Copy link and Share link are full-width and stacked. The same sheet uses two different action layouts, and neither sits in `DialogFooter`. The expiry options are restyled with `labelClassName` overrides rather than `OptionRow`. The existing-links list is a hand-built `ul`. The flow itself is good: 3 taps, a shown-once guard, and system share.
- **Evidence:** `06 - Reports/01 - Sharing a report/screen-01.webp`, `screen-02.webp`; `components/clients/share-report-dialog.tsx:303-323,333-341,409-435,543-585`
- **Affects:** owner, admin
- **Fix:** Put Create link, and after creation Share link (primary) and Copy link, in `DialogFooter` as `block` buttons pinned to the sheet foot. Use `OptionRowGroup` with a radio indicator (`components/ui/option-row.tsx`) for expiry, and `ListRow` with `interactive={false}` and a trailing Revoke (`components/ui/list-row.tsx`) for links.
- **Slice:** R14

#### CLR-12 · The public report opens on four rows of metadata, and switching period reloads to the top — P2 · RC-DENSITY
- **Screen:** `06 - Reports/01 - Sharing a report/screen-03.webp`
- **Problem:** The client's first screen is "Performance report", the name, then Period / Venues / Prepared by / Generated as a definition list, then the period tabs. The first figure is about halfway down. The periods are plain anchors that reload the page, a deliberate choice for no-JS and view counting (`shared-client-report.tsx:144-147`), so a reader comparing periods lands back at the top each time.
- **Evidence:** `06 - Reports/01 - Sharing a report/screen-03.webp`; `components/share/shared-client-report.tsx:116-162`
- **Affects:** external recipients (no role)
- **Fix:** Lead with the name and the period tabs. Move Venues, Prepared by and Generated to the footer, or into one caption line. Add `#main` (or a period-specific anchor) to the period links so the reload returns to the figures.
- **Slice:** R14

#### CLR-14 · Four stacked header actions on the hub, indented under the avatar — P2 · RC-ACTIONBAR
- **Screen:** `07 - Clients/screen-05.webp`
- **Problem:** Report, Share report, Settings (bordered) and Open inbox (primary) take four rows of the first screen. They are inset by the avatar column because `PageHeader` sits inside the avatar's flex row, so the primary is narrower than the page. The design-system spec allows "one primary action, the rest in an overflow" and "at most two actions" in the app bar.
- **Evidence:** `07 - Clients/screen-05.webp`; `components/clients/client-hub.tsx:152-218,224-261`
- **Affects:** owner, admin. Member and viewer see Open inbox and Report only.
- **Fix:** Make Open inbox full-width under the header, outside the avatar row. Put Report, Share report and Settings in one "More" `DropdownMenu`, which is an action sheet on a phone, or in the app bar's trailing slot through `PageChrome`.
- **Slice:** R15

#### CLR-15 · Hub density: a duplicate count and a pill on every row even when all is well — P2 · RC-LISTROW
- **Screen:** `07 - Clients/screen-06.webp`
- **Problem:** The "Listings linked 2 / 2 · 2 verified on Google" tile is repeated by the Listings header ("2 linked · 2 verified") a few lines below. Each listing card then shows both a green "Linked" and a green "Verified" pill plus a bordered "More" button, so a healthy list is mostly badges. The "Review import" group sits after the listings, separate from the "Start the import" action it needs.
- **Evidence:** `07 - Clients/screen-06.webp`; `components/clients/client-hub.tsx:309-314,506-516,584-616,645-671,684-745`
- **Affects:** all roles (agency)
- **Fix:** Drop the tile or the header count. In `DataTable` record cards, show a status pill only for non-default states ("Not linked", "No manager access", "Not verified"). Use an icon-only "More" with an accessible name, as `ListRow` trailing actions do.
- **Slice:** R15

#### CLR-17 · The colour picker is a group of toggle buttons, and its names read out hex codes — P2 · RC-A11Y
- **Screen:** `07 - Clients/screen-02.webp`, `07 - Clients/screen-07.webp`
- **Problem:** A single choice is built as six `aria-pressed` toggle buttons, so a screen reader doesn't hear "1 of 6" or radio semantics. Each name is "Umber (#7A4E3B)", which reads out the hex code. With nothing picked, no swatch is marked, yet the client still gets a colour derived from its name (`colourFor`). There is no preview of the mark.
- **Evidence:** `07 - Clients/screen-02.webp`, `screen-07.webp`; `components/clients/client-colour-field.tsx:28-55`; `components/clients/client-avatar.tsx` (`colourFor`)
- **Affects:** owner, admin
- **Fix:** Use `RadioGroup` semantics (`components/ui/radio-group.tsx`, or `OptionRowGroup` with `indicator="radio"` laid out as swatches). Use the colour name only as the accessible name. Pre-select the derived colour and show a live `ClientAvatar` preview beside the name field.
- **Slice:** R17

#### CLR-20 · Client cards read "Synced Not yet", and a second link is nested inside the tappable card — P2 · RC-LISTROW
- **Screen:** `07 - Clients/screen-01.webp`
- **Problem:** The meta line joins the label "Synced" with the value "Not yet". The whole card opens the client (`onRowClick`), but the underlined "2 to reply" inside it goes to the Inbox, so one card holds two targets with different destinations. That link also drops the queue the hub's tile uses (`/inbox?clientId=` here, `&queue=needs_reply` on the hub).
- **Evidence:** `07 - Clients/screen-01.webp`; `components/clients/clients-index.tsx:383-389,464-484,723-733`; `components/clients/client-hub.tsx:290`
- **Affects:** all roles (agency)
- **Fix:** Write the meta as a sentence ("Not synced yet", "Synced 3 min ago"). Make "2 to reply" a non-link trailing count on the card (the `ListRow` `trailing` slot), so the card has one target. Inbox stays one tap away on the hub. If the link stays, add `&queue=needs_reply`.
- **Slice:** R16

#### CLR-21 · Client settings: a second back button, and chevron rows that only jump down the page — P2 · RC-APPBAR
- **Screen:** `07 - Clients/screen-07.webp`
- **Problem:** The app bar already has "‹ Journey Hospital…", and the page adds a full-width "Back to Journey Hospitality" button. The phone index (Details / Listings / Archive, with chevrons) uses `GroupedListItem href="#…"`. Chevrons promise a pushed screen, but these rows scroll to sections that start right under them. The design-system spec's phone pattern for settings is an index that pushes. The same "second back button" defect exists in the Settings shell (SET-04).
- **Evidence:** `07 - Clients/screen-07.webp`; `components/clients/client-settings.tsx:162-185,338-350`
- **Affects:** owner, admin
- **Fix:** Remove the in-page Back button below `md`. Either drop the anchor index on a phone and let the sections stack, or make each one a pushed sub-route with a labelled back, as `/settings` does.
- **Slice:** R17

#### CLR-22 · Archiving a client asks to confirm, then to tick a checkbox, then offers Undo — P2 · RC-CONFIRM
- **Screen:** `07 - Clients/screen-07.webp` (only the Archive row is captured; the rest is from code)
- **Problem:** Archive is reversible: the toast has an Undo that restores the client and re-files its listings (`client-settings.tsx:698-716,729-750`). Even so, the action needs an AlertDialog and an "I understand" checkbox before the danger button is enabled. That is 5 taps, against Notion's 4 for an irreversible disconnect. The phone version restyles a `danger-outline` Button with `@max-md:` overrides instead of using `SettingsDestructiveAction`.
- **Evidence:** `07 - Clients/screen-07.webp`; `components/clients/client-settings.tsx:808-947`; `components/ui/settings-row.tsx:663-700` (`SettingsDestructiveAction`)
- **Affects:** owner, admin
- **Fix:** Use `SettingsDestructiveAction`. Archive straight away with the existing Undo toast, or keep a single `AlertDialog` without the checkbox when listings would be unfiled.
- **Slice:** R17

#### CLR-24 · Switching tabs silently changes the period — P2 · RC-NAVSTRIP
- **Screen:** `06 - Reports/screen-03.webp` (Last 28 days) → `06 - Reports/screen-04.webp` (Last 6 months)
- **Problem:** Each tab has its own range set and default. `selectTab` drops `?range=` when the next tab doesn't offer it, so the scope pill changes from "Last 28 days" to "Last 6 months" without saying so. Going back to Google returns to 28 days, not to whatever the user chose there.
- **Evidence:** `06 - Reports/screen-03.webp`, `screen-04.webp`; `components/performance/performance-view.tsx:52-60,149-159`; `lib/reporting/ranges.ts`
- **Affects:** all roles
- **Fix:** Map the period to the nearest equivalent (28 days → last full month) and show a one-line caption ("Keywords count whole months: showing the last 6 months"). Remember each tab's last choice in the URL (`?range_kw=`).
- **Slice:** R12a

#### DSK-10 · The client page shows its listings as phone record cards at 1280 — P2 · RC-LISTROW
- **Screen:** `desktop/clients--client.webp` (compare `desktop/listings.webp`)
- **Problem:** The client's listings sit in a column about 630px wide next to the Review import and Notes cards. That is below the table's 48rem container query, so a 1280 desktop gets the phone layout: no column headers, stacked "Linked" and "Verified" pills, a "More" button per row, and the per-listing section links hidden. The rows also show different facts from the same listings on the Listings board (no Health, Waiting or Last published).
- **Evidence:** `desktop/clients--client.webp`; `DataTable responsive` with record cards below 48rem of its own width (`components/clients/client-hub.tsx:543-547`); section links hidden by `@max-3xl/table:hidden` (`components/clients/client-hub.tsx:618-622`)
- **Affects:** owner, admin, member (agency)
- **Fix:** Let the listings `DataTable` (`components/ui/data-table.tsx`) span the full content width and move Review import and Notes below it or into a narrower rail from `xl`. Reuse the Listings board's columns (Health, Waiting, Verification) so a listing row reads the same on both pages.
- **Slice:** R15

#### DSK-11 · The Clients table sets the "2 to reply" link in monospace — P2 · RC-LISTROW
- **Screen:** `desktop/clients.webp`
- **Problem:** "2 to reply" (a link phrase) and "2 / 2" render in mono. The D1 amendment limits mono to "IDs, codes and tabular figures in tables". A phrase in mono reads as code and does not match the sans links elsewhere. The zero state was already switched to sans for this reason, but the link was not.
- **Evidence:** `desktop/clients.webp`; a numeric column applies `font-mono` to the whole cell (`components/ui/table.tsx:437`); Open reviews and Listings linked are `numeric: true` (`components/clients/clients-index.tsx:446, 461`); the comment at `components/clients/clients-index.tsx:708` notes the zero state's switch to sans; the link is at `components/clients/clients-index.tsx:723-731`
- **Affects:** owner, admin, member (agency)
- **Fix:** Set `font-sans` on the `OpenWork` link, or let `numeric` mean right-aligned tabular figures without mono in `components/ui/table.tsx`, and keep mono for ID columns only.
- **Slice:** R16

### One-off components

| One-off (file:lines) | Should reuse | Slice |
| --- | --- | --- |
| `components/clients/client-form.tsx:139-160` (inline `CardFooter bar`) | `components/ui/action-bar.tsx` (`ActionBar dock`) | R17 |
| `components/clients/client-settings.tsx:1097-1156` (Details `CardFooter bar`, always shown) | `components/ui/action-bar.tsx` (`dock`, `visible={dirty}`) | R17 |
| `components/clients/client-settings.tsx:837-885` (Archive button restyled for the phone) | `components/ui/settings-row.tsx` `SettingsDestructiveAction` | R17 |
| `components/clients/client-settings.tsx:351-361` (desk rail of raw `<a>` links) | `components/ui/grouped-list.tsx` / `settings-row.tsx`, or a `TabNav`-style rail | R17 |
| `components/clients/client-colour-field.tsx:28-55` (`aria-pressed` swatch buttons) | `components/ui/radio-group.tsx` (or `option-row.tsx` with a radio indicator) | R17 |
| `components/clients/client-form.tsx:171-217` (hand-built numbered "What happens next") | `components/ui/stepper.tsx` (`QuietStepper`) | R17 |
| `components/clients/share-report-dialog.tsx:303-323` (`RadioGroupItem` restyled as option rows with `labelClassName`) | `components/ui/option-row.tsx` (`OptionRowGroup`) | R14 |
| `components/clients/share-report-dialog.tsx:333-341,409-435` (inline action rows) | `components/ui/dialog.tsx` `DialogFooter` | R14 |
| `components/clients/share-report-dialog.tsx:543-585` (hand-built `ul` of links) | `components/ui/list-row.tsx` (`ListRow interactive={false}` with a trailing action) | R14 |
| `components/clients/client-hub.tsx:684-766` (`ImportCard`/`ImportRow` status list) | `components/ui/settings-row.tsx` (`SettingsGroup`/`SettingsRow` with value) | R15 |
| `components/clients/client-hub.tsx:152-218` (four header buttons) | `components/ui/action-bar.tsx` secondary-actions overflow, or `components/ui/dropdown-menu.tsx` | R15 |
| `components/reporting/report-toolbar.tsx:80-158` (a second scope pill and sheet) | `components/app-shell/scope-sheet.tsx` (client/location) plus `components/ui/chip.tsx` `ChipRow` or `components/ui/segmented-control.tsx` (period) | R12a, P05 |
| `components/performance/google-performance-tab.tsx:95-98` and `components/performance/keywords-tab.tsx:116-118` (generic `QueryPending` rows) | `components/reporting/reports-skeleton.tsx` (add tab variants) built on `components/ui/skeleton.tsx` | R13 |
| `components/clients/clients-index.tsx:723-733` (an inline link nested in a tappable record card) | the `trailing` slot of `components/ui/list-row.tsx` / `DataTable` | R16 |
| `components/share/shared-client-report.tsx:148-162` (anchor tabs styled with `textTabItemClassName`; its comment justifies it, no prefetch on a view-counted page, so this is acceptable) | A `TabNav` `prefetch={false}` option in `components/ui/tabs.tsx` would remove the copy | R14 |

### Needs owner setup
- **Connecting a Google account:** "Sign in with Google" opens Google's real consent page. `07 - Clients/screen-04.webp` is the last capturable screen.
- **Set-up steps 2-6 for a new client** (Account, Listings, Import reviews, Notifications, Team, Done) were not captured, so the onboarding step count comes from `lib/setup/steps.ts`.
- **Share link host:** the created link shows `http://localhost:3260/share/re…` (`06 - Reports/01 - Sharing a report/screen-02.webp`), the fixture's base URL. Check the production host and how a long URL wraps in the mono field.
- **Native share sheet and clipboard result** after Share link / Copy link (`navigator.share`) were not captured.
- **Fully fetched Google figures:** the fixture has 1 of 2 locations without a successful fetch (`06 - Reports/screen-03.webp`). The normal "all reporting" provenance and tile grid are not shown. Whether real data produces the overlapping counts in CLR-03 is unverified.
- **The keyword list itself** is below the fold of `06 - Reports/screen-04.webp`. Not captured.
- **Refresh from Google outcome** (sync running, then new figures). The Google stub does not answer.
- **Archive confirm, Undo toast, Archived clients view and Restore** were not captured. Only the Archive index row is.
- **Member and viewer views** of Clients and Reports (no New client, Share or Settings) were not captured. They are derived from code.
- **Dark mode** for this family was not captured. Client marks and swatches are fixed hex values by design (`lib/clients/colours.ts`, `client-avatar.tsx` picks a contrasting ink).
- **"Generated 15 Oct, 10:13 GMT+13"** on the shared report is the fixture organisation's time zone. UK organisations would read BST/GMT (`presence-provenance.tsx:24-32`).
- **Stub names:** "Stub location b2e5d15e" comes from the seeded fixture (`tests/integration/helpers/tenant.ts:270`). The UI shows `location.name` from the database everywhere (`lib/server/presence-report.ts:89`, `lib/server/shared-report.ts:115-120`), not raw IDs, so real names would show. The same goes for "Harness user", "stub@example.test" and "Sprint 5 Journey tenant". "No address" is shown because the stub locations have none.

## Team, Settings, sign-in and the app shell

### Steps per flow

| Flow | Task | Now (taps) | Notion Mail equivalent (taps) | Gap |
| --- | --- | --- | --- | --- |
| 01 Signing in | Sign in with email | Email, password, Sign in: 2 fields + 1 tap; autofill hints correct (`sign-in-form.tsx:415,438`); success path not captured | Get started, Email, Continue, code, Continue: 4 taps + 2 entries; or Google, Apple, Microsoft or passkey in about 3 taps (`01 - Onboarding/screen-02.webp`) | About the same for email users; no Google, passkey or magic-link option, so every new device means typing a password |
| 01 Signing in | Create an account | Create account tab, name, email, password (12+ characters, letter, number, symbol), confirm, Create account, then the email round trip: 2 taps + 4 fields + email (`01 - Signing in/screen-04.webp`) | Email + code, no password: 2 entries | +2 fields and composition rules |
| 01a Resetting a password | Reset a forgotten password | Forgot password?, email, Send reset link, email round trip, new password + confirm, save: 3 taps + 3 fields; only error states captured | None (Notion is passwordless) | n/a |
| 01b Accepting an invite | Join an organisation | Open link, name, password, confirm, Create account: 1 tap + 3 fields; email prefilled and locked (`02 - Accepting an invite/screen-01.webp`) | Onboarding email + code: 2 entries | +1 field; the role being granted is never shown (SET-17) |
| 02 Setting up | Set up a client to Done | Clients/Setup, Resume setup, Connect, Continue, Account, Continue, Listings, Continue, Import, Continue, Notifications (optional), Team (optional), Done: about 10-12 taps over 6 counted steps + Done; Google consent not captured | Sign-in to inbox: about 7 taps | About 1.5x more taps, defensible for agencies; counter is wrong (SET-12) and Setup loses its tab and back control (SET-11) |
| 02a Managing Google connections | Disconnect a Google login | More, Settings, Google connections, Disconnect, type the full email (about 17 characters), Disconnect: 5 taps + typing (`02 - Setting up/01 - Managing Google connections/screen-03.webp`) | 07/05 Disconnecting an address: avatar, Settings, Disconnect address, Disconnect: 4 taps, plain alert (`07 - Settings/05 - Disconnecting an address/screen-02.webp`) | +1 tap + typing; typing is mandated by the spec (`TypedConfirmation`), but the keyboard is wrong (SET-24) |
| 08a Inviting a member | Invite a teammate | More, Team, Invite a teammate, type email, (role defaults to Member), scroll for Can publish / Client access, Create invite link, Share…, OS share sheet, Done: 6 taps + typing (`08 - Team/01 - Inviting a member/screen-01..03.webp`) | No team feature; closest is 07/04 Giving feedback: about 4 taps | n/a; Client access is hidden below four tall role cards (SET-03) |
| 08b Changing a role | Make a viewer a member | More, Team, scroll to the row, ⋯, Change role…, pick a role, "Make Journey a member": 5 taps + scroll (`08 - Team/02 - Changing a role/screen-01..03.webp`) | 06 Switching account: avatar, Switch Notion Account, pick: 3 taps, then a toast (`06 - Switching account/screen-02..04.webp`) | +2 taps; the role chip is not tappable, so an action-sheet hop is added (SET-10) |
| 10a Notification settings | Turn one alert off | More, Settings, Notifications, switch: 4 taps; email cadence +2 (`10 - Settings/01 - Notification settings/screen-01..03.webp`) | 07/03: avatar, Settings, Notifications, switch: 4 taps (`07 - Settings/03 - Notification settings/screen-03.webp`) | Parity on taps; each Naba event is about 2x the height, so more scrolling (SET-05) |
| 10b Reply policy | Change approval or retention | More, Settings, Reply policy, edit, Save in the docked action bar: 5 taps | No equivalent; Swipe settings is about 4 taps | Comparable |
| 10c Checking operations | See whether background work is healthy | More, Settings, Operations, then about 3 screens of scrolling with no summary (`10 - Settings/03 - Checking operations/screen-01..02.webp`) | None | n/a; the answer is never stated in one line (SET-21) |
| 10d Switching to dark mode | Choose Dark | More, Dark: 2 taps (`10 - Settings/04 - Switching to dark mode/screen-01..02.webp`) | 07/02: avatar, Settings, Theme, Dark: 4 taps (`07 - Settings/02 - Switching to dark mode/screen-03.webp`) | Naba is 2 taps faster, but Theme is not in Settings (SET-26) |
| Shell | Switch client scope | App-bar "All clients" chip, pick a client, "Switched to …" toast: 2 taps (`scope-sheet-model.tsx:121-132`) | 06: avatar, Switch Notion Account, pick, toast: 3 taps | Naba is 1 tap faster |
| 11b Permission denied | Ask for access | Scroll, Copy an access request, leave the app to paste it: 1-2 taps + context switch (`access-denied.tsx:125-134`) | None | Useful action is below the fold; primary button goes to Inbox (SET-19) |
| 11c Missing page | Get back on track | Back to Inbox: 1 tap, although the app bar's back control points to Clients (`11 - Empty, loading & error states/03 - Missing pages and links/screen-01.webp`) | None | Goes to the wrong place; the primary action should be the back target (SET-20) |

### Findings

#### SET-01 · The Member role description promises listing edits that Members can't make — P1 · RC-COPY
- **Screen:** `08 - Team/01 - Inviting a member/screen-01.webp`, `08 - Team/02 - Changing a role/screen-02.webp`; contradicted by `11 - Empty, loading & error states/02 - Permission denied/screen-03.webp`
- **Problem:** The role card says Member "Drafts replies and edits listings they can see". But profile, hours and other canonical listing edits are limited to owners and admins, and a member is told "Only owners and admins can edit this location". An owner picks a role on a promise the product then breaks. The capture README also notes that the seeded member "can only view listings".
- **Evidence:** The screens above; `lib/settings/roles.ts:20` (description); `lib/locations/gating.ts:42` (`canEditCanonical` gate and its message); `lib/server/capabilities.ts:108,284` (`canEditCanonical === isManagerialRole`).
- **Affects:** owner and admin (choosing a role); member (expectations).
- **Fix:** Reword it to say what is true, for example: "Drafts replies and posts for the listings they can see. Can't change a listing's profile, hours or menu. Publishes only when publishing access is on." Apply the same correction to the business-mode variant and to `ROLE_MATRIX` (`components/settings/team-view.tsx`), and add a test that ties the description to `canEditCanonical`.
- **Slice:** P13

#### SET-02 · Team member cards are 7-8 lines tall, so a phone shows about 2.5 people per screen — P1 · RC-LISTROW
- **Screen:** `08 - Team/screen-01.webp`, `08 - Team/screen-02.webp`
- **Problem:** Each member is a responsive-table record card with name, You, role pill and ⋯, a truncated email, the join date, a "Client access" label with value and detail, and a "Publishing" label with a pill or switch and a reason. That is about 145pt per person. Emails truncate ("harness-a0d786c4@n…") because the role pill shares the title line. The spec's record card is "headline value, a subtitle, one meta line and a trailing status"; Inbox and Setup already use `ListRow`.
- **Evidence:** Screens above; `components/settings/members-table.tsx:288-463` (five cells per row, Access and Publishing `span` cells at 321-397); `components/settings/team-list.tsx:14-27` (class overrides grafted onto `Table` instead of a row primitive); spec `mobile-first-design-system.md:161-163`.
- **Affects:** owner, admin
- **Fix:** Render members with `ListRow` (`components/ui/list-row.tsx`): avatar; name + "You"; subtitle = the full email; one meta line = "Admin · All clients · Can publish"; trailing ⋯. Tapping a row opens a member sheet (`Dialog`, which is a sheet on a phone; new `components/settings/member-sheet.tsx`) holding Role, Client access and the Publishing switch as `SettingsRow`s. Keep the desk table.
- **Slice:** P12

#### SET-03 · Invite sheet: four tall role cards push Client access and Can publish below the fold, so over-granting is easy — P1 · RC-SHEET
- **Screen:** `08 - Team/01 - Inviting a member/screen-01.webp`, `screen-02.webp`
- **Problem:** The sheet shows the email field, then Owner, Admin, Member and Viewer as 2-3-line `ChoiceCard`s with Owner first. Then comes the footer. "Can publish" and "Client access" (default: All clients, including clients added later) only appear after scrolling inside the sheet, so an agency can create a link that grants every client without ever seeing the choice. Change role repeats the same cards (`08 - Team/02 - Changing a role/screen-02.webp`).
- **Evidence:** `components/settings/member-dialogs.tsx:42-83` (RoleCards); `lib/settings/gating.ts:72-77` (order follows `MEMBER_ROLES`, Owner first); `components/settings/invitations-panel.tsx:428-447` (Member and "all" defaults; scope only for member/viewer), `:575-620` (field order: email, roles, publish, scope).
- **Affects:** owner, admin (inviting); every invitee's access
- **Fix:** Use `OptionRowGroup` / `OptionRow` radio rows (`components/ui/option-row.tsx`) with a one-line sub-label, ordered Member (usual), Viewer, Admin, Owner. Show the full description only for the selected row. Move "Client access" directly under the role (as a `SettingsRow` with a chevron and the value "All clients"), so it is visible before Create invite link is.
- **Slice:** P13

#### SET-04 · The Settings back control appears twice, and the in-page copy sits below the page actions — P2 · RC-APPBAR
- **Screen:** `02 - Setting up/01 - Managing Google connections/screen-01.webp`, `10 - Settings/01 - Notification settings/screen-01.webp`, `10 - Settings/02 - Reply policy/screen-01.webp`, `10 - Settings/03 - Checking operations/screen-01.webp`
- **Problem:** The app bar already shows "‹ Settings" (as the spec requires). Every settings area also draws "‹ All settings" below its header, which costs about 90px above the fold and offers two controls that do the same thing. On Google connections it sits after "Connect another account", between the action and the content. Client settings has the same defect (CLR-21).
- **Evidence:** Screens above; `components/settings/settings-nav.tsx:67-73` (`md:hidden` link); `components/app-shell/page-frame.tsx:121-127` (actions render before `tabs`); `components/app-shell/app-bar.tsx:34-85` (ShellBackLink); spec `mobile-first-design-system.md:134-135`; `app/(dashboard)/settings/loading.tsx` (skeleton reserves the link).
- **Affects:** all roles (owner/admin for Connections and Operations)
- **Fix:** Delete the phone "All settings" link and rely on `ShellBackLink`. Keep `TabNav` for md and up. Update the `settings/loading.tsx` skeleton to match.
- **Slice:** P15

#### SET-05 · Notification preferences use a hand-rolled three-row block per event; switch placement differs on every settings screen — P2 · RC-LISTROW
- **Screen:** `10 - Settings/01 - Notification settings/screen-01.webp` compared with `10 - Settings/02 - Reply policy/screen-01.webp` and `08 - Team/screen-02.webp`
- **Problem:** Each event shows a title and description, then "In app" with the switch on the left, then a full-width "Email: Immediately" select. That is about 135pt per event against Notion's 45pt rows with a trailing switch (`07 - Settings/03 - Notification settings/screen-03.webp`). Reply policy puts its switch on the right after the label; Team puts it on the left before "Drafts only". So there are three placements for one control.
- **Evidence:** `components/settings/notification-preferences.tsx:176-259` (custom `<li>` grid); `components/settings/policy-form.tsx:542-556`; `components/settings/members-table.tsx:336-353`; the primitive that already does this is `components/ui/settings-row.tsx:27-38` (switch rows, chevron rows).
- **Affects:** all roles
- **Fix:** Use `SettingsGroup` + `SettingsRow` switch rows (label, description, trailing switch) for "in app". Make email cadence a chevron `SettingsRow` with the value "Immediately", opening a titled `Select` sheet. Use trailing switches everywhere.
- **Slice:** P14

#### SET-06 · Toggles are not optimistic and freeze every control while one save runs; bulk "Turn all off" has no Undo — P2 · RC-FEEDBACK
- **Screen:** `10 - Settings/01 - Notification settings/screen-01.webp` → `screen-02.webp`; `08 - Team/screen-02.webp`
- **Problem:** A notification switch disables all switches, selects and the group action until the request returns. The Team publishing switch shows the server value (`checked={m.canPublish}`), which changes only after the invalidate-and-refetch completes. Any role, access or removal mutation disables every row menu. "Turn all on/off in app" changes up to 40 preferences with no way back.
- **Evidence:** `components/settings/notification-preferences.tsx:67-87,134,201,212`; `components/settings/members-table.tsx:213-234,245,337-340,414`; Undo already exists for local actions in `components/ui/toast.tsx:227-235`.
- **Affects:** all roles (notifications); owner and admin (publishing)
- **Fix:** In `onMutate`, call `setQueryData` optimistically and roll back on error. Disable only the row being saved. After the bulk action, show an Undo toast via `useToastManager` that restores the previous preferences.
- **Slice:** P14

#### SET-07 · The app bar's workspace name, page title and scope chip squeeze each other, so the name you need is the part that truncates — P2 · RC-APPBAR
- **Screen:** `08 - Team/screen-02.webp` ("Sprint 5 Journey tenant   Team"), `08 - Team/02 - Changing a role/screen-01.webp` ("T.."), `02 - Setting up/01 - Managing Google connections/screen-02.webp` ("Google co…"), `10 - Settings/04 - Switching to dark mode/screen-06.webp` ("Sprint 5 Journey ten…", "Journey Ho…"); `03 - Inbox/04 - Switching client scope/screen-03.webp` ("Sprint 5 Journey ten…", "Old Crown …"); `04 - Listings/02 - Editing hours/screen-02.webp` ("‹ Stub location 4f4f4…  Opening…"), `04 - Listings/03 - Editing the menu/screen-04.webp` ("Food me…"), `04 - Listings/09 - Change history & approvals/screen-02.webp` ("Review …"), `04 - Listings/screen-03.webp` ("Stub lo…"); `06 - Reports/screen-02.webp` ("Sprint 5 Journey tenant R.."), `07 - Clients/screen-06.webp` ("‹ Clients  Journe…  JH Journey Hos…"), `07 - Clients/screen-07.webp`
- **Problem:** The leading slot takes up to half the bar for the workspace name or, on deep listing pages, a back label carrying the full listing name. The trailing scope chip takes up to 40vw. The compact page title gets what is left, often 2-6 characters, so neither "where am I" nor "where does back go" survives. In an agency the organisation name and the scope name both truncate and the scope name is the one you need; on a client hub the title and the chip both say the client's name, truncated twice. Real venue names ("Riverside Rooms & Kitchen") will truncate the same way.
- **Evidence:** The screens above; `components/app-shell/app-bar.tsx:237` (`max-w-1/2` leading), `:244-271` (title echo), `:329-354` (scope chip, `max-w-[40vw]` at `:336`, `:351`), `:371-385` (leading workspace name). `pnpm audit:mobile` at 320/390px found 76 clipped labels with no full value exposed: 66 are the truncated `span.truncate` inside the app bar's dropdown trigger (scope chip / switcher) across 33 routes and 10 are `[data-slot=workspace-name]`.
- **Affects:** all roles; agency mode most (organisation and scope names)
- **Fix:** Once the h1 or compact title is visible on a top-level page, cross-fade the leading workspace name out and the page title in (one title, not two). In agency mode on the Inbox, give the scope chip the leading slot instead of the organisation name (the organisation is in More). On deep pages, shorten the back label to "‹" plus a short word ("‹ Listing" or "‹ Back") and let the condensed title take the remaining width; keep the venue name in the page's switcher row. On a client's own pages, hide the chip's label (keep the avatar mark) when the title is the same client. Expose the full value to assistive tech and `title` wherever a label still truncates.
- **Slice:** P05
- **Merged:** LST-30, CLR-23, INB-12 (app-bar truncation part only; INB-12 keeps the repeated count and the badge-vs-scope mismatch)

#### SET-08 · App-bar trailing controls change from page to page; the scope chip appears on org-wide pages where it changes nothing — P2 · RC-SCOPE
- **Screen:** `08 - Team/screen-01.webp` (search + bell), `08 - Team/02 - Changing a role/screen-01.webp` (search + "All clients"), `10 - Settings/screen-01.webp` (search + scope), `11 - Empty, loading & error states/screen-01.webp` (bell + scope)
- **Problem:** The second control is the scope chip whenever an agency has more than one client. It also appears on Team, Settings and Google connections, which are organisation-wide and ignore the scope. There the chip takes up to 40vw and pushes the bell into More. Where the bell lives therefore depends on the page and on a client-list query. The same Team page was captured with both layouts; the exact cause of that variance is unverified.
- **Evidence:** `components/app-shell/app-bar.tsx:310-358` (`scope.visible` decides; there is no per-destination opt-out); `components/app-shell/scope-sheet-model.tsx:348-356` (visible = more than one client).
- **Affects:** owner and admin in agency mode
- **Fix:** Add a `scoped: false` flag to the Team, Settings and Notifications destinations in `lib/navigation/destinations.ts`, and on those pages render search + bell. Use the freed slot for the page's primary action (see SET-25).
- **Slice:** P05

#### SET-09 · Some empty and loading placeholders don't match the content they stand in for — P2 · RC-STATES
- **Screen:** `11 - Empty, loading & error states/01 - Loading/screen-03.webp` compared with `08 - Team/screen-01.webp`; `11 - Empty, loading & error states/01 - Loading/screen-02.webp`
- **Problem:** Team's member skeleton is three compact 56px rows, but the real cards are about 145pt each, so the page jumps when data lands. Team also has two different skeletons: the route `loading.tsx` and the table's own pending state. `QueryPending` (used across Reports and Settings) draws a spinner sentence and a skeleton at the same time, which is two loading indicators.
- **Evidence:** `components/settings/members-table.tsx:130-145`; `app/(dashboard)/team/loading.tsx:25-48`; `components/ui/query-states.tsx:57-69`; spec `mobile-first-design-system.md:172-174` ("SkeletonList rows at the row height the content will have").
- **Affects:** all roles
- **Fix:** After SET-02, define one `MembersSkeleton` built from `SkeletonList` at `ListRow` height and use it in both places. In `QueryPending`, keep the sentence (it is the live region) but drop the spinner when skeleton rows follow.
- **Slice:** P12, P08

#### SET-10 · Changing a role takes an extra action-sheet hop because the role chip isn't tappable — P2 · RC-LISTROW
- **Screen:** `08 - Team/02 - Changing a role/screen-01.webp` → `screen-02.webp` → `screen-03.webp`
- **Problem:** The flow is ⋯, then an action sheet ("Change role…", "Client access…", "Remove from team…"), then the role sheet, then confirm. The role pill on the row looks like a control but does nothing.
- **Evidence:** `components/settings/members-table.tsx:318-320` (static `RoleChip`), `:407-460` (menu); `components/settings/team-list.tsx:33-43`.
- **Affects:** owner, admin
- **Fix:** When `gate.roleReason` is null, make the role chip a button (or a member-row tap, per SET-02) that opens `ChangeRoleDialog` directly. Keep ⋯ for Client access and Remove.
- **Slice:** P12

#### SET-11 · Setup has no back control and no active tab, so people lose their place — P2 · RC-APPBAR
- **Screen:** `02 - Setting up/screen-01.webp`, `02 - Setting up/screen-02.webp`
- **Problem:** The page's eyebrow says "Clients", but no tab is selected and the app bar shows the workspace name instead of "‹ Clients". `/setup` belongs to no destination, so the shell treats it as top-level.
- **Evidence:** `lib/navigation/destinations.ts:301-325` (`destinationForPath` returns null for Setup; `isTopLevelPath` treats single-segment unknown paths as top-level); `lib/navigation/back-target.ts:26-49`.
- **Affects:** owner, admin
- **Fix:** Map `/setup` to Clients (agency mode) or Listings (business mode) for `isActivePath`, and give it the back target "‹ Clients" / "‹ Listings".
- **Slice:** P15

#### SET-12 · The setup counter says "Step 1 of 6" while the step list numbers Done as 7 — P2 · RC-COPY
- **Screen:** `02 - Setting up/screen-02.webp`
- **Problem:** The header counts six steps and excludes Done. The vertical stepper passes all seven steps, so Done is drawn with a "7".
- **Evidence:** `lib/setup/steps.ts:166-185` (`numberedSteps` drops `done`); `components/setup/setup-wizard.tsx:256-262,389-395` (all steps passed to `Stepper`); `components/ui/stepper.tsx`.
- **Affects:** owner, admin
- **Fix:** Draw Done without a number (a check or flag glyph) or drop it from the list. Use the same counting source for both.
- **Slice:** R18

#### SET-13 · Sheets look different depending on which primitive draws them — P2 · RC-SHEET
- **Screen:** `08 - Team/02 - Changing a role/screen-01.webp` (menu sheet: no grabber, outlined Cancel at the bottom) compared with `08 - Team/01 - Inviting a member/screen-01.webp` (dialog sheet: grabber, ×, ghost Cancel stacked above the primary) and `10 - Settings/01 - Notification settings/screen-03.webp` (select sheet with no title, so the options "Immediately / Daily summary / Off" don't say which event they belong to); and from Listings: `04 - Listings/02 - Editing hours/screen-03.webp` (centred title, × and Cancel), `04 - Listings/01 - Editing the profile/screen-03.webp` (left title, ×, Keep editing), `04 - Listings/04 - Managing photos/screen-02.webp` (no title, Cancel only), `04 - Listings/06 - Reviewing Google suggestions/screen-02.webp` (title, Close), `04 - Listings/07 - Adding a booking link/screen-02.webp` (title, ×, a single option), `04 - Listings/screen-04.webp` (an overflow sheet with only "Activity" and Cancel)
- **Problem:** There are three sheet chromes in Settings and Team for one pattern, and the cadence picker gives no context. Across Listings the same job (dismiss, confirm) is drawn five ways. The booking type picker opens for one supported type, and the listing overflow opens a sheet to offer one action.
- **Evidence:** `components/ui/menu-surface.tsx:170-185` (`MenuSheetCancel`, secondary button); `components/settings/member-dialogs.tsx:205`, `components/settings/invitations-panel.tsx:671` (ghost Cancel); `components/ui/select.tsx:117-118` (optional `title`), not passed at `components/settings/notification-preferences.tsx:231`; `components/locations/hours-editor.tsx:743-781` (Dialog), `components/locations/booking-tab.tsx:886-905` (inset Sheet over `state.supportedTypes`), `components/listings/area-frame.tsx:301-360` (overflow when nothing is pending).
- **Affects:** all roles
- **Fix:** Put one header and footer recipe in `components/ui/overlay.tsx` (and `sheet.tsx`), used by menu, dialog and select sheets: left title, ×, the grabber on both menu and dialog sheets, the confirm as the footer primary, the same Cancel style and position, and no extra Cancel when × exists. Make `title` required on phone `SelectContent` and pass "Email: <event name>". Two feature follow-ups: when `supportedTypes.length === 1`, render the booking type as static `SettingsRow` text; when the listing overflow has one action, show it as a direct icon button in the header.
- **Slice:** P03, L04, L08
- **Merged:** LST-22

#### SET-14 · The invite success sheet has two primary buttons and three stacked actions — P2 · RC-ACTIONBAR
- **Screen:** `08 - Team/01 - Inviting a member/screen-03.webp`
- **Problem:** "Share…" (primary) and "Done" (primary) compete, and "Invite someone else" adds a third row. The docked footer takes about 15% of the screen.
- **Evidence:** `components/settings/invitations-panel.tsx:306-313` (Share uses the default primary), `:641-647` (Done is the default primary), `:623-637`.
- **Affects:** owner, admin
- **Fix:** Make Share… (or Copy where `navigator.share` is missing) the one primary action. Close with × or a ghost "Done". Move "Invite someone else" into the body as a text link. Spec: "one primary action, the rest in an overflow".
- **Slice:** P13

#### SET-15 · The Reply policy retention field is a native number spinner in mono, labelled "Raw review content" — P2 · RC-FORMS
- **Screen:** `10 - Settings/02 - Reply policy/screen-02.webp`
- **Problem:** `type="number"` draws tiny native spin arrows (well under 44px) for a 1-30 value, in `font-mono`. The spec amendment limits mono to IDs, codes and table figures. "Raw review content retention" is internal wording.
- **Evidence:** `components/settings/policy-form.tsx:599-628`; spec `mobile-first-design-system.md:207-208`.
- **Affects:** owner, admin (editable); member and viewer (view only)
- **Fix:** Replace it with a `Select` (or `SegmentedControl`) of presets such as 7, 14 and 30 days, or a text `Input` with `inputMode="numeric"` and no `type="number"`. Drop `font-mono`. Retitle to "How long we keep review text".
- **Slice:** P16

#### SET-16 · Reply policy copy refers to a desk "sidebar" and says the approval state three times — P2 · RC-COPY
- **Screen:** `10 - Settings/02 - Reply policy/screen-01.webp`, `desktop/settings.webp`
- **Problem:** "What your team sees in the sidebar…" is shown on a phone, which has no sidebar. Approval is described by the switch description, then an info box, then a warning that reads "Direct publishing is on. Direct publishing was confirmed on 14 October 2026." On desk with approval off, a grey "consequence" panel ("People who can publish send their replies straight to Google, with no approval step") sits directly above a warning ("Replies will publish without approval…"): two boxes, two tones, the same fact.
- **Evidence:** `components/settings/policy-form.tsx:528`, `components/settings/agency-name-form.tsx:139`; `components/settings/policy-form.tsx:467-468` (consequence text), `:542-596`, `:559` (`<Consequence>`), `:571-583` (warning `Alert`).
- **Affects:** owner and admin; member and viewer read it
- **Fix:** Use "What your team sees at the top of the app and what invitations say they are joining." Collapse approval into one warning `Alert` carrying the consequence and the confirmation date: "Replies publish straight to Google. Confirmed on 14 October 2026." Drop `Consequence` while approval is off.
- **Slice:** P16
- **Merged:** DSK-19

#### SET-17 · The invitation page doesn't say what role you are accepting — P2 · RC-COPY
- **Screen:** `01 - Signing in/02 - Accepting an invite/screen-01.webp`
- **Problem:** The page shows only the Organisation and "Sent to", plus "…work on what X has given you access to". The lookup returns no role or expiry, so the invitee accepts blind.
- **Evidence:** `components/auth/invitation-view.tsx:42-60`; `app/api/invitations/[token]/route.ts:28-49` (returns `organisationName`, `email`, `expired`; no role).
- **Affects:** invitees of every role
- **Fix:** Add `role` and `expiresAt` to the lookup response. Show a `SettingsRow` reading "Role: Member. Drafts replies…" from `roleDescriptions` (once SET-01 is fixed), plus "Link expires on …". Needs an owner decision before Phase 2: the invitation lookup would return role and expiry to anyone holding the token.
- **Slice:** P19b

#### SET-18 · Password forms ask for confirmation even though there is a reveal toggle, and they use composition rules — P2 · RC-FORMS
- **Screen:** `01 - Signing in/screen-04.webp`, `01 - Signing in/02 - Accepting an invite/screen-02.webp`
- **Problem:** Create account, invite and reset all require "Confirm password" although every password field has a show/hide toggle. The checklist demands a letter, a number and a symbol on top of 12 or more characters. On a phone keyboard each rule means a mode switch, and the mismatch error only appears on submit.
- **Evidence:** `components/auth/sign-in-form.tsx:240-251,459-469`; `components/auth/reset-password-form.tsx:28,112-114`; `components/auth/password-requirements.tsx:13-18`; `components/auth/password-field.tsx` (reveal toggle).
- **Affects:** every new user (all roles)
- **Fix:** Remove the confirm field and keep the reveal toggle and the length rule. Whether to drop the character-class rules is a security-lane decision, and whether a server-side breached-password check exists is unverified. Needs an owner decision before Phase 2: password rules are a security decision.
- **Slice:** P19b

#### SET-19 · Access-denied page: "403" is shown to users, the primary button goes to Inbox, and the access request is below the fold — P2 · RC-STATES
- **Screen:** `11 - Empty, loading & error states/02 - Permission denied/screen-01.webp`, `screen-02.webp`
- **Problem:** The eyebrow reads "No access · 403". The area is called "Team access" when the page is "Team". "Back to Inbox" is hard-coded even when the app bar says "‹ Settings". "Copy an access request", the one action that helps, is a secondary button below the fold.
- **Evidence:** `components/app-shell/access-denied.tsx:52-63,125-134`; `app/(dashboard)/team/page.tsx:16`.
- **Affects:** member, viewer
- **Fix:** Drop "403" from the eyebrow. Use "Team" as the area name. Make the primary action "Ask for access", which shares via `navigator.share` with copy as the fallback (the pattern in `invitations-panel.tsx:130-175`). Make the secondary action the shell back target (`useShellBack`).
- **Slice:** P08

#### SET-20 · Missing-page state shows a raw UUID path, sends people to Inbox instead of up, and duplicates the tab bar — P2 · RC-STATES
- **Screen:** `11 - Empty, loading & error states/03 - Missing pages and links/screen-01.webp`, `screen-02.webp`
- **Problem:** "You asked for /clients/00000000-0000-4000-8000-000000000000" is shown in mono. The primary button is "Back to Inbox" while the app bar back control says "‹ Clients". "Where to go instead" lists six destinations already in the tab bar and More. The root 404 uses different words ("Page not found", "Go to Inbox") from the in-app one ("This page doesn't exist", "Back to Inbox").
- **Evidence:** `app/(dashboard)/not-found.tsx:64-90` (title, path at 75-79, hard-coded `/inbox`), `:113-140` (destination list); `app/not-found.tsx:37-52`.
- **Affects:** all roles
- **Fix:** Use `backTarget()` for the primary action ("Back to Clients"). Move the path into a "Details for support" disclosure. Keep search and drop the destination list (or limit it to the parent). Use one title and one verb across both 404s.
- **Slice:** P08

#### SET-21 · Operations is in engineering vocabulary, with no one-line answer at the top — P2 · RC-COPY
- **Screen:** `10 - Settings/03 - Checking operations/screen-01.webp`, `screen-02.webp`
- **Problem:** The page shows "Heartbeat stale", "Job runner", "from 03:00 UTC" and "Evaluates every organisation" (other tenants are irrelevant to this owner). There are ten red "Stale" pills and no summary of what it means or what to do. Webhook failure rows print raw `eventType · status · lastErrorCode`. That everything is stale is a fixture artefact (the scheduler is not running); the vocabulary and structure are product.
- **Evidence:** `components/settings/operations-view.tsx:174-183` (raw codes), `:214-255` (per-job list), `:268-289` ("Heartbeat stale"); `lib/settings/scheduled-jobs.ts` (or wherever `scheduledJobInfo` lives).
- **Affects:** owner, admin
- **Fix:** Lead with one `Alert` that says it in words: "Background work hasn't run for 19 days. New reviews and publishing are paused. Contact support." Put the per-job list under a "Details" disclosure using `ListRow` (`interactive={false}`) with a trailing `StatusPill`. Map event types and error codes to words through `lib/errors/action-errors.ts`.
- **Slice:** P18

#### SET-22 · Settings data loads only after hydration, so every visit shows a skeleton — P2 · RC-PERF
- **Screen:** `11 - Empty, loading & error states/01 - Loading/screen-03.webp`
- **Problem:** Inbox and Listings prefetch on the server through `HydrationBoundary`. Team, Notifications, Reply policy, Google connections and Operations fetch on the client after JavaScript runs (HTML, then JS, then the API call). Only `settingsCapabilities` is prefetched.
- **Evidence:** `app/(dashboard)/team/page.tsx:13-26` (no prefetch); `app/(dashboard)/settings/layout.tsx:27`; `lib/server/prefetch.ts:424-431`; client queries at `components/settings/members-table.tsx:124`, `components/settings/notification-preferences.tsx:61-64`, `components/settings/operations-view.tsx:100-108`.
- **Affects:** all roles
- **Fix:** Add `teamPrefetch` (members and invitations) to `/team`, and a per-page prefetch in `app/(dashboard)/settings/*/page.tsx` for notification preferences, policy and connections, following `listingPagePrefetch`.
- **Slice:** P20

#### SET-23 · Auth error copy ignores where you are, and business mode sees "agency" — P2 · RC-COPY
- **Screen:** `01 - Signing in/01 - Resetting a password/screen-02.webp`
- **Problem:** The reset-password page says "Sign-in is temporarily unavailable." because errors map by code only. The fixture causes this state (password auth is off), but the copy mapping is product. `invitation_already_used` says "Sign in to reach the agency", which is also shown to business-mode workspaces, and the business-mode spec forbids "agency".
- **Evidence:** `lib/api/auth-errors.ts:34-41`, `:64-66`; `components/auth/forgot-password-form.tsx:188`; `components/auth/*-form.tsx`.
- **Affects:** all users
- **Fix:** Pass a surface ("sign-in", "reset", "invite") into the mapper and title it accordingly ("Password reset is temporarily unavailable."). Use "Sign in to continue." for the already-used invitation.
- **Slice:** P19a

#### SET-24 · Disconnecting by typing an email opens a keyboard with no @ key, and the consequences are repeated — P2 · RC-FORMS
- **Screen:** `02 - Setting up/01 - Managing Google connections/screen-03.webp`
- **Problem:** The confirmation asks for "stub@example.test", but the field has no `inputMode="email"`. The helper text under it repeats the "Now / After 7 days" list just above.
- **Evidence:** `components/ui/typed-confirmation.tsx:168-174` (no `inputMode`); `components/settings/connection-card.tsx:303-310`; the email hints already exist in `components/ui/input.tsx:34-41`.
- **Affects:** owner, admin
- **Fix:** In `TypedConfirmation`, set `inputMode="email"` when `expected` contains "@" (or accept an `inputHints` prop). Remove the duplicate `description`.
- **Slice:** P09

#### SET-25 · Page primary actions sit at the top, out of thumb reach, and scroll away — P2 · RC-TOUCH
- **Screen:** `08 - Team/screen-01.webp` (Invite a teammate), `02 - Setting up/01 - Managing Google connections/screen-01.webp` (Connect another account)
- **Problem:** Both primary actions are full-width buttons in the page header and disappear once the user scrolls. Spec principle 4 says "Primary actions sit in the bottom third on a phone". On top-level pages the tab bar owns the bottom edge, so the reachable persistent slot is the app bar.
- **Evidence:** `components/settings/team-view.tsx:102-111`; `components/settings/connections-workspace.tsx`; `components/app-shell/page-frame.tsx:121-125` (actions render full width on a phone); `components/app-shell/page-chrome.tsx`; spec `mobile-first-design-system.md:63-65`.
- **Affects:** owner, admin
- **Fix:** Once the header scrolls away, expose the action as an app-bar trailing control through `PageChrome` (using the slot freed in SET-08). Alternatively, repeat it as the last row of the list ("+ Invite a teammate") using `ListRow`.
- **Slice:** P17

#### SET-26 · Theme exists only in the More sheet; Settings has no Appearance row and "Match system" wraps — P2 · RC-APPBAR
- **Screen:** `10 - Settings/screen-01.webp`, `10 - Settings/04 - Switching to dark mode/screen-01.webp`
- **Problem:** Someone looking in Settings (as Notion users do: Settings, Theme) finds no theme control. In More, the three-column radio grid wraps "Match system" onto two lines at 390px.
- **Evidence:** `components/settings/settings-index.tsx:24-36` (the "You" group has Notifications only); `components/app-shell/account-menu.tsx:510-528` (RadioGroup `grid-cols-3`); `lib/settings/areas.ts`.
- **Affects:** all roles
- **Fix:** Add an "Appearance" `SettingsRow` (value "Match system") to the "You" group, opening an `OptionRow` sheet. In More, use `SegmentedControl` with "Light / Dark / System".
- **Slice:** P15

#### SET-27 · There is no help or feedback route anywhere — P2 · RC-APPBAR
- **Screen:** `10 - Settings/04 - Switching to dark mode/screen-01.webp` (More), `10 - Settings/screen-01.webp`
- **Problem:** Notion Mail puts "Support & feedback" in Settings (`07 - Settings/04 - Giving feedback/screen-02.webp`). NabaPresence has none in More, Settings or the destination registry, even on pages such as Operations that say something is wrong.
- **Evidence:** `lib/navigation/destinations.ts` (no help destination); `components/app-shell/more-sheet.tsx:233-282`; `components/settings/settings-index.tsx:24-36`.
- **Affects:** all roles
- **Fix:** Add a "Help and feedback" `SettingsRow` to the More account block and the Settings index. The channel (email, form or help centre) is not invented here. Needs an owner decision before Phase 2: which help channel.
- **Slice:** P21

#### SET-28 · On a Google account card, Disconnect is the most prominent control — P2 · RC-LISTROW
- **Screen:** `02 - Setting up/01 - Managing Google connections/screen-01.webp`
- **Problem:** A red "Disconnect" text button sits at the top right of the account card, in the headline position, beside the email. The spec puts destructive actions last (`SettingsDestructiveAction`).
- **Evidence:** `components/settings/connection-card.tsx:537-549`; `components/ui/settings-row.tsx:40-47`.
- **Affects:** owner, admin
- **Fix:** Put the status in the trailing position. Move Disconnect to a ⋯ menu (destructive item last) or into an account detail sheet ending with `SettingsDestructiveAction`.
- **Slice:** P17

#### SET-29 · Notification email warning is shown to people who can't act on it, and email choices stay live — P2 · RC-COPY
- **Screen:** `10 - Settings/01 - Notification settings/screen-01.webp`, `desktop/settings-notifications.webp`
- **Problem:** "No notification email is sent until an email provider is configured" is shown to every role, including members and viewers, who can't configure anything. The "Email: Immediately" selects remain editable although nothing will be sent; on desk the banner says "Email is not set up… No notification email is sent" above rows that still offer an active select, so the settings promise something that will not happen. `emailConfigured` is false in this environment (a fixture), but the state exists in product.
- **Evidence:** `components/settings/notification-preferences.tsx:103-111,210-240` (`emailConfigured` gates only the banner at `:103`; the selects are disabled only while saving, `:201,212`).
- **Affects:** all roles
- **Fix:** For non-managers, say "Email notifications aren't available for this workspace yet. You'll still see them in the app." When `!emailConfigured`, disable the email `Select`s with that reason as text (spec principle 6: a disabled control shows its reason). For owners and admins, link to Operations.
- **Slice:** P14
- **Merged:** DSK-17

#### SET-30 · The Replay button's accessible name assumes London time — P2 · RC-A11Y
- **Screen:** not captured (no failed events in the fixture); code only
- **Problem:** The name reads "Replay <event> received <time>" formatted in `Europe/London`, while the visible row says "received N ago" and the organisation may use another time zone (the seeded workspace defaults to Pacific/Auckland, `10 - Settings/02 - Reply policy/screen-02.webp`). Screen-reader users hear a time that conflicts with what everyone else sees.
- **Evidence:** `components/settings/operations-view.tsx:190`.
- **Affects:** owner, admin
- **Fix:** Use the organisation's default time zone (or the same relative phrase that is visible) in the label.
- **Slice:** P18

#### DSK-07 · Top-level pages repeat the h1 in the toolbar, and the Settings trail is inconsistent — P2 · RC-APPBAR
- **Screen:** `desktop/inbox.webp`, `desktop/listings.webp`, `desktop/clients.webp`, `desktop/reports.webp`, `desktop/team.webp`, `desktop/settings.webp`, `desktop/settings-notifications.webp`
- **Problem:** On every top-level page the toolbar's single crumb repeats the h1 directly beneath it (for example "Inbox" above "Inbox 2"). Settings is inconsistent: on Reply policy the trail reads "Settings" over an h1 of "Reply policy", while the sibling tab shows "Settings / Notifications". The two tabs share one tab strip, but their trails disagree.
- **Evidence:** Visible in each capture. `ShellBreadcrumbs` renders whenever there is at least one crumb (`components/app-shell/breadcrumbs-context.tsx:70-71`), so a top-level page always gets a one-item trail; the trail builder it reads is `useShellTrail`.
- **Affects:** all roles
- **Fix:** Render no trail for a one-crumb route in `ShellBreadcrumbs`. Use the freed toolbar space for the page's scope or count, or leave it empty. Make `/settings` produce "Settings / Reply policy" so every Settings tab has the same two-level trail.
- **Slice:** P06

#### DSK-08 · The desk sidebar hides Team and Settings behind "More" — P2 · RC-APPBAR
- **Screen:** `desktop/inbox.webp`, `desktop/team.webp`, `desktop/settings.webp`
- **Problem:** At 1280 the sidebar has about 450px of empty height, yet Team and Settings still sit behind a collapsed "More" disclosure. This copies the phone's tab-bar limit onto a screen that has room, and adds a click to reach Settings.
- **Evidence:** The rule that Team and Settings sit behind More in the sidebar (`components/app-shell/nav.tsx:216-218`). The collapsed list is hidden at `wide` (`components/app-shell/nav.tsx:365`).
- **Affects:** owner and admin (Team, Settings)
- **Fix:** From `wide`, list the "more" group permanently under a quiet group label such as "Workspace" (`Nav`), and keep the disclosure for the rail only if needed.
- **Slice:** P06

#### DSK-09 · Two sidebar links are marked as the current page on a client page — P2 · RC-A11Y
- **Screen:** `desktop/clients--client.webp`
- **Problem:** Both "Clients" and the pinned "Journey Hospitality" row get the accent tint, the 3px accent bar and `aria-current="page"`. Screen readers announce two current pages, and sighted users see two selected rows.
- **Evidence:** In the capture both rows are tinted. "Clients" is active for any `/clients/*` path (`components/app-shell/nav.tsx:40-42, 270-273`), and the pinned client is active on an exact match (`components/app-shell/nav.tsx:294-301`).
- **Affects:** all roles in agency mode; screen-reader users especially
- **Fix:** When a pinned child is current, give the parent a "contains current" style (text accent, no tint) and no `aria-current`. Use `aria-current="page"` on exactly one `NavRow`.
- **Slice:** P06

#### DSK-18 · Short text fields stretch across the whole desk column — P2 · RC-FORMS
- **Screen:** `desktop/settings.webp`, `desktop/listings--loc--profile.webp`
- **Problem:** "Agency name" is about 936px wide, and Business name and Store code are about 704px wide. Very long fields for short values make the form harder to scan, and the eye travels a long way to a field's end.
- **Evidence:** The captures. There is no `max-w` in `components/settings/policy-form.tsx` (grep finds none).
- **Affects:** owner, admin and member
- **Fix:** Give `Field` (`components/ui/field.tsx`) or `Input` (`components/ui/input.tsx`) a desk measure for short single-line values (for example `desk:max-w-md`), keeping full width on a phone.
- **Slice:** P09

#### DSK-23 · Clients and Listings rows always open a full page; no side panel for a quick look — P2 · RC-SHEET
- **Screen:** `desktop/clients.webp`, `desktop/listings.webp`
- **Problem:** The spec's list → detail pattern ("from `lg` it is a split view") is applied only to the Inbox. On a 1280 desk the Clients and Listings tables fill half the height, and checking one client's open work or one listing's status means a full page change and a Back. A listing is a whole workspace, so a full page is right for editing it, but the common triage question ("what is waiting here?") could be answered in place.
- **Evidence:** The captures; `components/clients/clients-index.tsx`, `components/listings/listings-board.tsx`. The overlay foundation already offers a right `panel` presentation (`docs/specs/2026-10-13-mobile-first-design-system.md`, Interaction patterns → Overlays; `components/ui/overlay.tsx`).
- **Affects:** owner, admin and member (agency triage)
- **Fix:** From `lg`, open a right `panel` (overlay `panel` presentation) on row click with the client's work tiles or the listing's area states and "Open client" or "Open listing". Keep the row link for a full open with modifier-click.
- **Slice:** P23

### One-off components

| One-off (file:lines) | Should reuse | Slice |
| --- | --- | --- |
| `components/settings/notification-preferences.tsx:176-259` (hand-rolled event rows) | `SettingsGroup` / `SettingsRow` switch and chevron rows (`components/ui/settings-row.tsx`) | P14 |
| `components/settings/members-table.tsx:249-467` + `components/settings/team-list.tsx:14-27` (Table with phone class overrides) | `ListRow` / `ListRows` (`components/ui/list-row.tsx`) + a member detail `Dialog` sheet | P12 |
| `components/settings/members-table.tsx:130-145` and `app/(dashboard)/team/loading.tsx:25-48` (two different member skeletons) | One skeleton built on `SkeletonList` (`components/ui/skeleton.tsx`) at `ListRow` height | P12, P08 |
| `components/settings/member-dialogs.tsx:42-83` (`RoleCards` built from tall `ChoiceCard`s) | `OptionRowGroup` / `OptionRow` radio (`components/ui/option-row.tsx`) | P13 |
| `components/settings/invitations-panel.tsx:568-588` (hand-built "Can publish" box with a switch) | `SettingsRow` switch row (`components/ui/settings-row.tsx`) | P13 |
| `components/settings/settings-nav.tsx:67-73` ("All settings" back link) | Remove; `ShellBackLink` (`components/app-shell/app-bar.tsx:34-85`) already does it | P15 |
| `components/settings/operations-view.tsx:214-255` (scheduler `<li>` list) and `:169-196` (failure rows) | `ListRow` with `interactive={false}` + trailing `StatusPill` (`components/ui/status-pill.tsx`) | P18 |
| `components/app-shell/access-denied.tsx:110` (inline role pill `span`) | `Badge` (`components/ui/badge.tsx`) via `RoleChip` (`components/settings/team-list.tsx:33-43`) | P08 |
| `components/app-shell/account-menu.tsx:514-528` (3-column theme radio grid) | `SegmentedControl` (`components/ui/segmented-control.tsx`) | P15 |
| `components/settings/policy-form.tsx:616-623` (native number input in mono) | `Select` (`components/ui/select.tsx`) or `SegmentedControl` | P16 |
| `components/ui/menu-surface.tsx:170-185` (`MenuSheetCancel`, secondary) compared with ghost Cancel in dialog footers | One overlay footer recipe in `components/ui/overlay.tsx` | P03 |
| `app/(dashboard)/not-found.tsx:53-140`, `app/not-found.tsx:27-53` (hand-rolled empty states; the comment at `not-found.tsx:30-32` gives the bundle-size reason) | `Empty` (`components/ui/empty.tsx`) / `PageEmptyState` (`components/app-shell/page-frame.tsx`), or a light shared `SystemEmpty` if bundle size rules out `Empty` | P08 |
| `app/(dashboard)/setup/page.tsx:174-190,216-226` (card header `div`s with `border-b`) | `CardHeader divided` (`components/ui/card.tsx`) | P15 |
| `components/settings/settings-index.tsx:38-44` (`ROW_FOCUS_CLASS` local exemption) | Fix the inset focus ring inside `SettingsRow` (`components/ui/settings-row.tsx`) | P15 |
| `components/settings/connection-card.tsx:537-549` (Disconnect ghost button in the row) | `SettingsDestructiveAction` (`components/ui/settings-row.tsx`) in a detail sheet, or a destructive `DropdownMenuItem` | P17 |

### Needs owner setup
- Verifying with MFA (`/sign-in/verify`) and Settings → Security: MFA is off in `visual-app`.
- Billing, Confirming billing and Usage (`/settings/billing`, `/settings/billing/confirming`, `/settings/usage`): `BILLING_ENABLED` is off.
- Data and privacy (`/settings/privacy`): the seeded organisation lacks `privacy_settings`.
- Signing in with a password (success path), the forgot-password success state, and resetting with a valid link: the seeded users have no passwords, and password auth returns "temporarily unavailable" (`01 - Signing in/screen-03.webp`, `01 - Signing in/01 - Resetting a password/screen-02.webp`).
- Connecting a Google account (Google consent) from Setup step 1 and "Connect another account": the capture never opens the real consent page.
- Real-time notification settings on Google connections: the stub doesn't answer, so the card shows "We couldn't load notifications" (`02 - Setting up/01 - Managing Google connections/screen-02.webp`).
- Route skeletons from `loading.tsx` (`app/(dashboard)/team/loading.tsx`, `settings/loading.tsx`, `setup/loading.tsx`): `next dev` does not prefetch, so only in-page pending states were captured.
- Healthy Operations: every job shows "Stale" because the fixture's scheduler isn't running. A green state and real webhook failures were not captured.
- Email-configured notification settings and emailed invitations (the "Invitation emailed / queued / not sent" states at `invitations-panel.tsx:258-280`): no email provider is configured in `visual-app`.
- Business-mode variants of Team, Settings and Setup; the admin and member views of Team; the organisation switcher in More (it needs more than one organisation); notifications with items in More/Notifications.
- A listing with real (long) venue names, needed to size the app-bar truncation in SET-07 (stub names are short IDs).
