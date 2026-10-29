# Taste pilot: design direction (2026-10-29)

Status: pilot. Five components were redesigned to test this direction before
any app-wide rollout. The direction **refines** the operator's-desk identity
(`2026-09-23-operators-desk-identity.md`); it does not replace it. Tokens stay
in `app/globals.css`, contrast stays gated by `pnpm check:contrast`, and the
yardstick is the Taste Code skill's app-screen rules
(`design-taste-frontend/references/app-screens.md`).

## The direction in one line

**States are drawn, chrome is ink, colour is for data and the one action.**
NabaPresence already has a calm, token-driven system. What it lacks is
consistency in the moments that are not "at rest": disabled, focused while
invalid, loading, empty, pressed and selected. Those moments are where it
still uses opacity, tinted icon squares, shimmer and accent-on-chrome. The
pilot fixes them in the primitives so that feature code does not change.

## Principles

1. **Draw every state with a role, never with opacity.** Disabled is the
   `--np-disabled-*` trio (sunken fill, muted ink at 4.5:1 or better, quiet
   edge), not `opacity-50`. A faded control drops to about 1.8:1, which you
   cannot read.
2. **One focus language.** Every focusable control shows the same 2px
   accent halo (`focus-halo`). A field shows it too, and an invalid field
   keeps its red edge underneath the halo, so focus and error never hide
   each other.
3. **Chrome is ink; the accent is for the action, focus and the current
   place.** A pressed filter chip is ink, as the identity spec already says.
   Counts on navigation are neutral ink badges. The green fill is spent on
   the primary action and on "you are here" (the current nav item and the
   selected row).
4. **Loading looks like the finished layout.** Flat bars at the final size,
   with no travelling highlight (motion-safe users get a slow opacity
   breath) and no label line that pushes content when the data lands.
5. **Empty is a sentence in a frame, not an illustration.** No 44px tinted
   square. A quiet 20px line icon in the tone's ink, the title, and one
   sentence and an action.
6. **Figures are type, grouped, not tiles.** A row of KPIs is one container
   split by hairlines: label over value, the value in the `figure` role (24px
   touch, 22px desk), one step under the h1. Missing is a small grey dash,
   never a dash at value size. Colour on a change only where good or bad is
   known.
7. **Press, hover and focus give feedback in 140ms on transform and colour
   only.** Every move has a reduced-motion fallback. Nothing performs an
   entrance.

## Tokens added

| Token                                         | Value                 | Role                                                              |
| --------------------------------------------- | --------------------- | ----------------------------------------------------------------- |
| `--np-disabled-bg` / `bg-disabled`            | `--np-fill-secondary` | Disabled control fill                                             |
| `--np-disabled-ink` / `text-disabled-ink`     | `--np-ink-muted`      | Disabled label, 4.5:1 or better on its fill and on a card (gated) |
| `--np-disabled-line` / `border-disabled-line` | `--np-line`           | Disabled control edge                                             |
| `--np-text-figure` / `text-figure`            | 24px touch, 22px desk | A KPI's value                                                     |

## The five pilots

| #   | Pilot                                                                   | Pattern it proves                                     | Reach                                          |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| P1  | Button                                                                  | Actions: rest, hover, press, focus, disabled, pending | 217 files, 749 call sites                      |
| P2  | Field chrome (Input, Textarea, Select, Combobox, Search, OTP, TagInput) | Inputs: focus, invalid, focus-while-invalid, disabled | About 100 files                                |
| P3  | Selection: FilterChip, ListRow selection, CountBadge                    | Navigation and selection in lists                     | Inbox, listings, clients, the tab bar and rail |
| P4  | System states: Empty, Skeleton, QueryPending                            | Empty, loading and error                              | About 90 files                                 |
| P5  | KPI: KpiTile becomes KpiStrip                                           | Data display and cards                                | Reports, the client hub                        |

Overlays (Dialog, Sheet, Menu) were audited and are the most mature layer. They
are not a pilot. Their two defects (the Select popup's scale snapping, and the
border plus shadow on menus) are first in the fan-out plan.

## Decisions left to the owner (tensions)

These conflict with a Taste default but are documented identity choices. The
pilot keeps them as they are:

- **Green filled primary.** Taste's default primary is near-black. The green
  is the brand's one accent and the "reaches Google" signal. Kept.
- **12px card radius.** Taste calls 11-12px the weak middle and prefers tight
  (4-8px) or soft (16-24px). Changing it is one token block
  (`globals.css` radius), but it reshapes every screen. Proposed for Phase 4,
  not piloted.
- **Tinted nav row with a 3px bar.** Taste lists this as a tell of generated
  dashboards, but it is the documented "current place" signal. Kept. Counts
  move off the accent (P3).
- **Sunken table header band.** Taste says no band. It is one token
  (`--np-table-header-bg`). Proposed for Phase 4.
