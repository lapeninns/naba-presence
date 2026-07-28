# NabaReview UI/UX redesign — DS-idiom rebuild

**Date:** 2026-07-28
**Status:** Approved
**Decision:** Rebuild all five application views onto the components and conventions the
NabaReview design system prescribes (`docs/specs/2026-07-28-design-system.md`,
`.design-sync/conventions.md`, `docs/components/*.md`). The five-view information
architecture, all behaviour, and all API contracts stay unchanged.

## Why

The application UI in `components/naba-review/` predates the design system's component
library and conventions. It hand-rolls what the library provides (sidebar, tabs, list
rows, empty states) and breaks stated conventions (no Toast feedback, destructive
disconnect without AlertDialog, Select where Combobox is intended, a nine-select filter
row where the DS's own Sheet story — "ReviewFilters" — is the answer). The design
system's component stories were authored for this app; the redesign realises them.

Two alternatives were rejected:

- **Rebuild + IA rethink** (URL routing, command palette, restructured detail) — more
  risk to existing tests and wiring than the goal requires.
- **Visual polish only** — leaves the hand-rolled patterns and the filter-row UX in place.

## Constraints

- Only `components/ui/*` components and semantic token utilities. No new dependencies,
  no raw hex, no `bg-blue-600`-style palette utilities.
- Base UI, not Radix: `render` prop, never `asChild`. Avatar sizes via its `size` prop.
  `AlertDialog`, not `Dialog`, for destructive confirmation. Every control paired with a
  `Label`. `font-mono` for numerals, IDs, and timestamps.
- Behaviour and API contracts unchanged. The uncommitted functional fixes in the working
  tree (session route fallback, analytics/overview retry + loading-state fixes) are
  preserved and built upon, not reverted.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:a11y` all green
  after every increment; both themes verified in the running browser.
- `/design-system` proof sheet stays untouched (it is the palette regression test).

## 1. App shell

- Replace the hand-rolled `<aside>` and mobile nav `Sheet` in `review-app.tsx` with the
  DS `Sidebar` family: `SidebarProvider` → `Sidebar` (`SidebarHeader` brand,
  `SidebarContent` with `SidebarMenu`/`SidebarMenuButton isActive`, `SidebarFooter` user
  block, `SidebarRail`) + `SidebarInset` around header and main. `SidebarTrigger` sits in
  the header; mobile behaviour comes from the component, not custom code.
- Header keeps the live-data status chip and org name. Dead affordances are removed:
  the decorative org-name chevron and the non-functional Bell button.
- A theme toggle (light / dark / system, `DropdownMenu` on a ghost icon button) is added
  to the header, driven by the existing `ThemeProvider`. The provider's existing "d"
  hotkey stays; the toggle complements it.
- `Toaster` mounts once in `app/layout.tsx` alongside `TooltipProvider`.
- Feedback policy app-wide: success confirmations are Toasts; errors the user must act
  on stay inline (`Alert` or field-level text). Transient sync failures may toast with a
  retry `ToastAction` (the DS "SyncFailedWithAction" story).

## 2. Reviews workspace

- Queue chips become `Tabs` (line variant); each trigger shows its count as a mono
  numeral.
- Filter bar: inline controls are reduced to search (`InputGroup`), location
  (`Combobox` — "OpenLocationList" story), rating (`Select`), and sort (`Select`).
  The remaining filters (date range, reply state, verification, publish status, sync
  status) move into a filter `Sheet` (side="right") opened by a "Filters" button showing
  an active-filter count `Badge`. Active non-default filters render as removable badges
  beside the trigger so state hidden in the Sheet stays visible. Filtering continues to
  auto-apply (existing 250 ms debounce); the Sheet adds a "Clear all" action.
- Review list rows become `Item` compositions inside `ItemGroup` (`ItemMedia` avatar,
  `ItemContent` with title/description, trailing timestamp + status badge). Selection
  keeps `aria-current` + accent background. `ScrollArea` and cursor-paged "Load more"
  stay.
- List empty state becomes the `Empty` family with a "Clear filters" `EmptyContent`
  action. The no-selection detail placeholder also becomes `Empty`.
- Detail pane keeps its layout (header, review text, media grid, status alerts, draft
  editor with right rail: verification + activity timeline). Changes:
  - Draft save / publish / regenerate successes become Toasts; failures stay inline.
  - Byte counter and timestamps use `font-mono`.
  - The tone `Select` is removed (not wired to the drafting API).
  - The actions `DropdownMenu` keeps only working items: "Copy review ID" writes the id
    to the clipboard and toasts; dead items are removed.

## 3. Overview

- Structure stays: greeting, metric cards, "Reviews and replies" chart, "Operations
  health" card. Polish: metric values in `font-mono`; loading uses `Skeleton`; error
  states keep the retry affordance; empty data uses the `Empty` family.

## 4. Analytics

- Date-range and granularity selectors stay preset-based (`NativeSelect` is a DS
  component and the API takes presets — no calendar picker).
- Location performance table: response-rate cells gain `Progress` bars
  ("ResponseRateByLocation" story); numerals go `font-mono`.
- Loading / error / empty states standardised as in Overview.

## 5. Connections

- Disconnect gets an `AlertDialog` stating the consequence (sync stops; policy cleanup
  within 7 days) before calling the API. Success toasts.
- Google location import rows become `Item` + `Checkbox`; the search field is an
  `InputGroup`; backfill progress uses `Progress` with `ProgressLabel`/`ProgressValue`.
- Pub/Sub topic and similar identifiers render `font-mono`.
- Setup-progress steps and guidance cards are restyled with tokens only (structure
  unchanged).

## 6. Settings

- The `Field` idiom is completed across all cards (`FieldGroup`, `FieldLabel`,
  `FieldDescription`, `FieldSeparator`).
- Team member rows become `Item` with the role `Select` and publish `Switch` as
  `ItemActions`.
- Data-retention rows drop the disabled decorative `Switch`es in favour of read-only
  rows with an "Enforced" `Badge`.
- Compliance: creating a privacy (erasure/export) request confirms via `AlertDialog`;
  audit export and settings saves toast on success.

## 7. Code structure

`components/naba-review/` is split by view; `review-app.tsx` remains the entry so
`app/page.tsx` is unchanged:

| File | Contents |
|---|---|
| `review-app.tsx` | `NabaReviewApp`: session/reviews bootstrap, view switching, composes shell + views |
| `app-shell.tsx` | Sidebar family, header, theme toggle, live-data chip |
| `reviews-view.tsx` | Inbox: tabs, filters + Sheet, list, detail, verification, timeline |
| `overview-view.tsx` | Overview |
| `analytics-view.tsx` | Analytics |
| `connections-view.tsx` | Connections wizard + connection management |
| `settings-view.tsx` | Settings |
| `shared.tsx` | `Stars`, `StatusBadge`, formatters, `LiveDataError`-equivalent, shared types |

Existing state management (component-local state, `lib/naba-review-api.ts` calls,
transitions, deferred search) carries over as-is.

## Error handling

Unchanged in substance: API failures keep their current recovery paths (retry buttons,
preserved last-good state, inline messages). Presentation is standardised per the
feedback policy above.

## Testing

- Existing unit/integration tests must pass unmodified (they don't touch these
  components' internals).
- `pnpm test:a11y` (Playwright) must pass; structural changes keep or improve
  aria-labelling (nav landmarks, `aria-current`, labelled controls).
- Manual verification in the dev server: each view in light and dark, mobile viewport
  for the sidebar, filter Sheet, list/detail pane switch, and toasts.

## Execution order

Shell (+ Toaster/theme toggle) → Reviews → Overview → Analytics → Connections →
Settings → final validation sweep. Each increment leaves all checks green.
