# Mobile-first design system

Status: accepted, 2026-10-13. Amends
`docs/specs/2026-09-23-operators-desk-identity.md`. That spec's visual
identity stands: cool paper, white cards drawn by a line, one green accent,
serif page titles and customer words, mono figures, the one charcoal bar for
the action that reaches Google, status as a word plus a tone. This spec
replaces its size scale, its shell breakpoints, its overlay and navigation
patterns, and the assumption that a phone is a narrow desktop.

## Why

A first-principles audit of every route and primitive (11 areas, 254
findings, every high-severity claim re-checked against code and
screenshots) found the product correct and careful in its business logic
and desktop-first in its presentation:

- Navigation was a hamburger drawer only; Settings and Team were three taps
  deep; there was no up-navigation on a phone.
- The shell locked itself to the viewport and scrolled an inner column, so a
  phone lost browser-chrome collapse, tap-to-top and pull-to-refresh.
- Running text was 14px and interface text 13px; touch sizing was an opt-in
  `(pointer: coarse)` patch with 57 ad-hoc overrides from 32px to 44px.
- No `viewport` export, so every `env(safe-area-inset-*)` resolved to 0.
- Dialogs, menus and pickers were desktop popovers on a phone; the bottom
  sheet's grabber did nothing; nothing reacted to the on-screen keyboard.
- Listing areas stacked three or four controls before any content; clean
  editors still pinned a save bar over 12-23% of the screen; tab strips hid
  the current tab; tables became two tall label/value cards per screen.
- Seven copies of the review → confirm → outcome flow, 143 hand-rolled card
  class strings, about ten tone vocabularies for five states, four
  loading/error/empty systems.

## Direction

Three designers produced competing prototypes
(`/tmp/naba-redesign/directions/`, not checked in): **A, Evolved Desk** (keep
the identity, rebuild the interaction layer), **B, Touch-First Field Kit** (a
new visual language: one sans family, ink for local actions, green only for
Google), **C, Queue-First** (a phone organised around a To do stream). A and
C independently kept the identity; all three agreed on the structure. The
identity is retained (it is contrast-gated, documented and familiar; a sixth
rebrand in three months has a cost and no evidence behind it). Adopted from
all three: density keyed to pointer and width, one bottom bar at a time, the
action bar riding the keyboard, the listing name as the listing switcher, an
area list instead of stacked selectors, tables as record cards with a
headline figure, scrollable chips that never truncate a label, prev/next
stepping through reviews. Deferred: C's To do stream (a new aggregate
screen; recorded as a follow-up, not part of a redesign that must not invent
data), B's recolouring and serif removal.

## Principles

1. **Touch first, desk earned.** Every size token defaults to what a thumb
   and a phone at reading distance need. The compact desk scale applies only
   under `desk`: a fine pointer and at least 48rem.
2. **Layout in CSS, behaviour in JS.** Never choose a layout with a JS media
   query (it flashes on hydration and sends phones desktop HTML). JS media
   queries decide behaviour only (push navigation vs split view, sheet vs
   dialog at open time).
3. **One bottom bar.** On a phone the bottom edge belongs to the tab bar on a
   top-level screen and to the action bar on a task screen, never both.
4. **The thumb does the work.** Primary actions sit in the bottom third on a
   phone; transient choices open as bottom sheets; every gesture has a
   visible button alternative (WCAG 2.5.7).
5. **Nothing hides the focus.** Sticky and fixed chrome reserve scroll padding
   so a focused control is never covered (WCAG 2.4.11).
6. **Words first.** Unchanged: status is a word plus a tone; a disabled
   control shows its reason as text, never only in a hover title.
7. **One primitive per job.** A pattern implemented twice becomes a primitive
   or uses an existing one; `pnpm check:design` ratchets token bypass down.

## Foundations (`app/globals.css`)

### Type

| Role              | Touch | Desk        | Use                         |
| ----------------- | ----- | ----------- | --------------------------- |
| `text-caption`    | 13/18 | 12/16       | Meta, hints, timestamps     |
| `text-ui`         | 15/20 | 13/20       | Controls, nav, labels       |
| `text-body`       | 16/24 | 14/22       | Running text, field values  |
| `text-title`      | 17/24 | 16/24       | `h3`, card titles           |
| `text-section`    | 20/26 | 18/26       | `h2`                        |
| `text-page-title` | 26    | 22-28 fluid | The page's `h1`, serif      |
| `text-display`    | 32    | 28-36 fluid | Rare hero figures           |
| `text-reading`    | 17/28 | 17/28       | The customer's words, serif |

Nothing below 13px on touch or 12px on desk. Field text is `text-body`, so
it is 16px on touch and iOS never zooms on focus.

### Size, chrome and layers

- Controls, fields and menu rows: 44px on touch, 36/36/32px under `desk`;
  `--np-control-h-sm` 36/30. Compact density exists under `desk` only.
  Checkbox, radio and switch keep a modest visual size with a 44px hit area
  on touch.
- Chrome: app bar 52px, tab bar 56px, action bar 64px, desk toolbar 56px,
  rail 64px, sidebar 240px; each bar adds its safe-area inset.
- Safe areas and keyboard: `--np-safe-*`, `--np-keyboard-inset` (written by
  `ViewportInsets`), `--np-dock-bottom`; utilities `pt-safe`, `pb-safe`,
  `px-safe`, `pb-dock`. `app/layout.tsx` sets `viewport-fit=cover`,
  `interactive-widget=resizes-content` and both theme colours.
- Layers: `z-sticky` 10, `z-chrome` 20, `z-scrim` 40, `z-overlay` 50,
  `z-popover` 60, `z-toast` 70, `z-tooltip` 80, `z-skip-link` 90. No bare
  `z-50`.
- Breakpoints: `sm` 40rem, `md` 48rem, `lg` 64rem, `wide` 73.75rem, `xl`
  80rem; `lib/ui/breakpoints.ts` mirrors them. No arbitrary `max-[…px]:`.
- Focus: the `focus-halo` ring, with a system-colour outline under
  `forced-colors: active`.
- Motion: unchanged curves; `--np-duration-sheet` 320ms and
  `--np-duration-push` 300ms join the reduced-motion collapse.

## Shell and navigation

| Width                               | Navigation                    | Header                                                              | Bottom                            |
| ----------------------------------- | ----------------------------- | ------------------------------------------------------------------- | --------------------------------- |
| < 48rem (phone)                     | Bottom tab bar, five items    | App bar: switcher or labelled back, page title, at most two actions | Tab bar, or the task's action bar |
| 48rem - wide (tablet, small laptop) | 64px rail with visible labels | Desk toolbar                                                        | Inline action bars                |
| ≥ wide                              | 240px sidebar                 | Desk toolbar with breadcrumbs                                       | Inline action bars                |

- Tabs: agency mode Inbox, Listings, Clients, Reports, More; business mode
  Inbox, Listings, Calendar, Reports, More. The Inbox tab carries the
  needs-reply count. More is a bottom sheet: client scope (agency),
  Calendar (agency), Notifications, Team, Settings, then the account block
  (name, theme, sign out). One destination list feeds the tab bar, rail,
  sidebar, More sheet and command palette.
- A phone scrolls the document, not an inner column. The app bar is sticky,
  the tab bar fixed; both reserve scroll padding. Desk workspace pages (the
  inbox split view) may lock to the viewport from `lg`.
- Deep pages show a labelled back control in the app bar ("‹ Listings");
  breadcrumbs show on desk only.
- Global banners share one region and show the highest-priority one with a
  count of the rest.
- Route changes move focus to the new page's `h1` and announce it.
- Toasts dock to the bottom on a phone, above whichever bar owns the edge.

## Interaction patterns

- **Overlays.** One foundation with four presentations: centred `dialog`,
  bottom `sheet` (Base UI Drawer: working handle, swipe to dismiss, optional
  snap points, keyboard aware), right `panel`, left `drawer`. Dialog and
  AlertDialog are a sheet on a phone and a dialog from `sm` by default. A
  built-in dirty guard asks before discarding input. Select, menus,
  comboboxes and popovers become bottom action sheets with 44px rows on a
  phone; a short combobox switches without raising the keyboard.
- **List → detail.** On a phone the detail is a pushed screen with a back
  control and prev/next through the list ("2 of 7"); from `lg` it is a split
  view.
- **Navigation strips** (tabs, segmented controls, chips): scroll
  horizontally with fade edges, keep the current item in view, never
  truncate a label, carry counts. Settings is an index list on a phone.
- **Tables.** On a phone a row is a record card led by its headline value
  (the sort column), a subtitle, one meta line and a trailing status;
  selection keeps a select-all bar.
- **Action bars.** One `ActionBar`: docked to the bottom on a phone (riding
  the keyboard), inline on desk. A clean editor shows no bar; it appears
  with the first change. Status words on the left, one primary action, the
  rest in an overflow.
- **Forms.** `Field`/`Fieldset` everywhere; the right `inputMode`,
  `autoComplete`, `enterKeyHint`, `autoCapitalize`; `TimeField` for hours,
  `OtpField` for PINs and codes, `TypedConfirmation` for destructive
  confirmations; errors inline plus one summary, one live region.
- **States.** One empty/error/loading vocabulary (`Empty`, `QueryStates`,
  `Skeleton`) and one `Card`/surface primitive; feature code stops
  hand-rolling either.
- **Reviewed writes.** The review → consent → send → outcome flow becomes one
  primitive set (sheet with steps, summary list, outcome summary) used by
  access, lifecycle, verification, lodging, services and place actions.

## Accessibility (WCAG 2.2 AA)

Contrast stays gated by `pnpm check:contrast`. Added obligations: 2.5.8
target size (24px minimum everywhere, 44px project floor for primary touch
targets), 2.4.11 focus not obscured, 2.5.7 dragging alternatives, 1.4.10
reflow at 320px, 2.5.3 label in name, and forced-colours focus.

## Verification

- `pnpm verify` (typecheck, lint, unit), `pnpm check:contrast`.
- `pnpm check:design --ratchet`: token bypass may only go down.
- `pnpm audit:mobile`: target size, iOS zoom, axe WCAG 2.2, focus obscured,
  overflow and chrome budget at 320-1280 in both themes.
- `tests/perf/perf-lab.mjs`: throttled mobile lab budgets.
- Playwright: the existing suites plus a touch project (390x844, `hasTouch`,
  `isMobile`) for the critical journeys.
