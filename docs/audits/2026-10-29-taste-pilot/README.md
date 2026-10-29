# Taste pilot: audit, pilot and fan-out plan (2026-10-29)

Branch `feat/taste-pilot-redesign`, based on `main` at b52984278. This covers
phases 1 and 2 of the Taste Code redesign and drafts phases 3 to 5. The design
direction is in `docs/specs/2026-10-29-taste-pilot-direction.md`. Every
finding, with file, line and fix, is in `audit-findings.json` in this folder.

## 1. Audit

Eight auditors ran in parallel: seven read the code by layer, and one measured
the running fixture app at 390, 768 and 1440 px in both themes. They judged
against the Taste Code app-screen rules and against this repo's own identity
spec. They inventoried 261 entries and reported 157 findings: 10 high, 53
medium and 94 low. 39 of the findings are **tensions**, where a documented
identity decision conflicts with a Taste default. Those are not defects.

**What is already strong.** The token architecture is sound. No literal colour
appears below the ramps. Contrast is gated, with 222 pairs in both themes. The
type scale is touch-first and steps down under `desk`. Table headers are 12px
grey sentence case with right-aligned tabular figures. Pill colours come from
one five-tone source. Overlays have one foundation, a flat scrim and motion
from tokens. The shell folds correctly at every width. This is a mature system.
The redesign refines it; it does not replace it.

**Where it falls short.** The weak points are the moments that are not at rest:

| Pattern             | What the audit measured                                                                                                                                       | Reach                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Disabled            | `opacity-50` on Button and 7 other primitives. A disabled primary is about 1.8:1, so its label cannot be read                                                 | 749 Button call sites                |
| Focus while invalid | `aria-invalid:` border and shadow come after `focus:` at equal specificity, so an invalid field shows no focus. WCAG 2.4.7 failure, confirmed in a screenshot | About 100 field users                |
| Loading             | Skeleton draws a travelling shimmer, and QueryPending's visible label pushes the layout down when data lands                                                  | 46 and 15 files                      |
| Empty and error     | A 44px tinted square holds the icon (the "icon in a tinted square" tell)                                                                                      | 48 files plus 6 hand-rolled copies   |
| Accent on chrome    | Pressed filter chips are accent-tinted although the spec says ink. Nav count badges are solid green                                                           | Every filter strip, tab bar and rail |
| Selection           | The selected list row is `bg-fill`, one step from hover, not the documented `--np-selection-bg`                                                               | Inbox, listings, clients             |
| KPIs                | A bordered card per figure. The value is at h1 size. A missing value is a dash at value size. Every fall is red                                               | Reports, client hub, shared report   |
| Docs drift          | `docs/components/README.md` still asked for serif titles, mono timestamps and 36px controls, none of which the code does                                      | Every new primitive                  |

Screen-level findings, such as listings rows with 3 to 6 pills, the reports
dead band and the hours card inset, are in the fan-out plan (section 5).

## 2. Pilot selection

Five pilots were chosen. Each covers a different interaction pattern, sits low
in the dependency tree (feature code inherits the change without edits), and
fixes a measured defect, so none is a restyle for its own sake.

| #   | Pilot                                                                          | Pattern                  | Why this one                                                                                           |
| --- | ------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| P1  | Button                                                                         | Actions                  | The most reused primitive. Disabled is unreadable, there is no pressed fill, and hover sticks on touch |
| P2  | Field chrome (Input, Textarea, Select, Combobox, Search, OTP, TagInput, Label) | Inputs                   | Fixes a WCAG failure. One recipe instead of a duplicate                                                |
| P3  | FilterChip, ListRow selection, CountBadge                                      | Navigation and selection | Takes the accent off chrome and puts selection back on its documented token                            |
| P4  | Empty, Skeleton, QueryPending                                                  | System states            | Covers every empty, loading and error region at once                                                   |
| P5  | KpiTile into KpiStrip                                                          | Data display and cards   | Proves "group, don't box" and the type hierarchy on a real screen                                      |

Overlays were audited and are the most mature layer, so they are not a pilot.
Their two real defects open the fan-out (wave 1B).

## 3. Before and after

Screenshots are local and git-ignored. Before: `test-results/taste/before/`
(9 routes × 3 widths) and `test-results/taste/specimens-before/`. After:
`test-results/taste/after/` and `test-results/taste/specimens-after/`. The
specimen script is `test-results/taste/specimens.mjs`. It captures six
`/design-system` specimens at 390 and 1440 px, in light and dark, and with an
invalid field holding keyboard focus.

### P1 Button

- **Before:** Disabled was the variant at 50% opacity, about 1.8:1. Pending
  buttons were faded too, because Base UI marks them `data-disabled`. Hover
  fired on touch and stuck after a tap. There was no pressed colour. The 1px
  press nudge ran under reduced motion, and the link's cancel of it never
  applied.
- **After:** Disabled uses the new `drawn-disabled:` variant with
  `bg-disabled`, `text-disabled-ink` and `border-disabled-line`. That is at
  least 4.5:1, gated, and it keeps the button's shape on any surface. A
  pending button keeps its colours and spinner. Hover applies only on fine
  pointers. Pressed is one step past hover (new `--np-accent-active`, 13.2:1
  in light). The nudge is motion-safe.
- **Rationale:** A disabled control the user can read still tells them what
  it is. The spec's "words first" rule needs the words to be legible.
- **Impact:** 217 files, 749 call sites, with no feature edits.

### P2 Field chrome

- **Before:** Focus was a 1px border change plus a 3px accent tint at about
  1.1:1. On an invalid field, focus disappeared entirely. TagInput did the
  reverse and hid the error on focus. Disabled was faded. Select duplicated the
  field recipe.
- **After:** There is one recipe in three cuts:
  - `fieldChromeClassName` for text entry, which shows focus on `:focus`;
  - `fieldTriggerChromeClassName` for pop-up buttons, which shows focus on
    `:focus-visible` and while the popup is open;
  - `fieldWrapperChromeClassName` for wrappers, which shows focus on
    `:focus-within`.

  Focus is a 1px accent edge plus the shared 2px halo. Invalid keeps its red
  edge, and a focused invalid field rings in `shadow-np-focus-danger`. Its
  compound variants outrank plain focus, so the red ring always shows. Disabled
  and read-only use the disabled roles.

- **Rationale:** There is now one focus language across buttons and fields,
  and error and focus never hide each other.
- **Impact:** Every form, editor, filter and search field.

### P3 Selection marks

- **Before:** A pressed chip was accent tint plus an accent ring, which
  contradicts the spec. A selected row was `bg-fill`, almost the same as hover.
  Count badges were solid green.
- **After:** A pressed chip is ink, with no ring. Its count is in
  `ink-inverse` and a danger count appears only while the chip is unpressed. In
  dark mode the rating star is remapped so it stays visible. A selected row is
  `--np-selection-bg`, and hovering it does not change it. That covers swipe
  rows too. Count badges are neutral ink. A focus ring on a selected row is
  gated at 3:1.
- **Rationale:** Green now means two things only: the action and where you
  are. Selection is clearly different from hover and from focus.
- **Impact:** Inbox queues and filters, the listings board, client health
  chips, the tab bar, the rail and the bell.

### P4 System states

- **Before:** A 44px tinted square sat above a hero-like empty state. Skeletons
  shimmered. A visible "Loading…" line shifted content when the data arrived.
- **After:** The glyph is a bare 20px icon in the tone's ink, followed by the
  title and one sentence, with tighter padding. A skeleton is a flat bar with a
  slow, motion-safe opacity pulse. QueryPending keeps its sentence for screen
  readers but hides it visually when rows stand in, so the skeleton holds the
  final layout. The reports skeleton now draws a KpiStrip, as the loaded page
  does.
- **Rationale:** Taste's rules for loading and empty states: the final layout
  in flat bars, and a sentence in a frame rather than an illustration.
- **Impact:** About 90 files using Empty, 46 using Skeleton, 15 QueryPending
  call sites.

### P5 KPIs

- **Before:** Separate bordered cards. Values at the h1 size (26px on touch).
  A missing value was a 28px em dash. A hover shadow sat on top of the border.
  Every fall was red.
- **After:** `KpiStrip` is one bordered container with hairlines between
  cells. Its columns are chosen by count, so it never makes a 3+1 row, and an
  odd last cell spans both phone columns. Values use the `figure` role (24px on
  touch, 22px on desk) in tabular numerals. A missing value is a small grey
  dash. A delta is coloured only when its `tone` says which way is good.
- **Rationale:** Taste §5 and §9.4 say "group, don't box": the screen's figures
  read as one answer, one step under the title.
- **Impact:** Reports (Reply and Google tabs), the shared public report and the
  client hub.

## 4. Evaluation

| Check                           | Result                                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                | No errors in project files. The same 69 pre-existing errors as `main`, all in git-ignored `docs/release/receipts/local/evidence/**` and an external `.codex/worktrees` copy                                     |
| `pnpm lint`                     | Changed files are clean (`eslint --max-warnings 0`). The repo-wide run fails only on the same git-ignored evidence files                                                                                        |
| `pnpm format:check`             | Clean                                                                                                                                                                                                           |
| `pnpm test` (unit + components) | 9172 passed, 1 skipped. Six assertions on the old literal classes were updated to the new token                                                                                                                 |
| `pnpm check:contrast`           | 222/222 pairs pass in both themes. 6 pairs are new: disabled ×2, pressed primary, danger halo, focus on selection                                                                                               |
| `pnpm check:design --ratchet`   | Passes. No rule count rose                                                                                                                                                                                      |
| Visual                          | Before and after at 390 and 1440 px in both themes. No horizontal overflow and no console errors on /inbox, /reports or /notifications                                                                          |
| Independent review              | Each pilot got an adversarial reviewer. Reviewers found 7 real defects (for example, `scale-*` not being in the transition list, a dark-mode star vanishing on an ink chip, and deleted exports). All are fixed |
| Not run                         | `pnpm build`, `pnpm test:e2e` and `pnpm test:a11y`. These need a production build. Run them before merge                                                                                                        |

**Coherence.** All five pilots now share one vocabulary: drawn states, one
focus halo, ink chrome, colour on data and the action. The direction holds.
Two things it did not settle: the green primary against Taste's near-black,
and the 12px card radius. Both are owner decisions (section 6).

## 5. Fan-out plan

Foundations come first and are centralised in one owner. Then come parallel
workstreams with disjoint files, then screens. Each wave lands as one bundled
PR, per the repo rules.

**Wave 0: foundations (one owner, `app/globals.css`, `lib/design/`).**
Apply the owner decisions from section 6 (radius ladder, table header band).
Add pressed steps for tinted, danger and on-dark. Delete dead tokens:
`--np-field-ring`, `--np-field-ring-invalid`, and the material/blur and
entrance animations the audit found unused. Move Progress off shimmer, then
delete `shimmer`.

**Wave 1: primitives (parallel, disjoint files).**

- **1A Disabled everywhere.** Replace opacity with `drawn-disabled:` and the
  roles in Switch, Checkbox, Radio, Segmented, ChoiceCard, OptionRow, Tabs,
  Stepper, RemovableChip, `app-bar.tsx` and `billing-card.tsx`.
- **1B Overlays.**
  - Make `menu-surface` transition `scale`; today the popup scale snaps.
  - Remove border plus shadow on menus and popovers.
  - Change ActionBar's default tone from charcoal to surface, and keep
    charcoal for the actions that reach Google.
  - Fix the docked bar's elevation and easing.
  - Make the command palette's phone Cancel 44px.
- **1C Tables.** Row rule to `line-subtle`. Selected fill to selection. Fix
  ChartDataTable's row-header cells. Apply the header-band token decision.
- **1D Status and feedback.** Give PublishSteps one status mark per row.
  Align Alert and StatusPill.
- **1E Shell.**
  - One toolbar control height, 44px on coarse pointers.
  - No weight change on the active nav item.
  - Align the app bar to the page edge.
  - Not-found and access-denied use the new Empty.

**Wave 2: composites and screens (parallel by area).**

- **2A Listings board.** One status mark per row. "Healthy" and "Verified" go
  quiet. Tablet rows become two-line.
- **2B Notifications.** Make the whole row interactive and move actions into
  a ⋯ menu. This roughly halves row height on a phone.
- **2C Reports.**
  - Close the 70 to 110px dead band above the KPIs.
  - Make the period facts agree ("1 Oct – 29 Oct" against "As at 30 Oct").
  - In `PresenceFigures`, show "No data" as a dash with a hint.
  - ReportBarChart: segment seams, no per-point dots.
- **2D Editors.** Fix the hours card's desk inset (rows sit 5px from the
  border). Load errors get a Retry.
- **2E Inbox.**
  - Add the quick-filter chip row to the route skeleton.
  - Show "Needs reply" once per row.
  - Keep the desk tick box visible.
- **2F Disabled reasons.** Adopt `DisabledReason` so the reason is visible
  across settings, billing, bulk, hours, menus and posts.

**Wave 3: consolidation.**

- Fold the six hand-rolled empty states into `Empty`.
- Run a Button variant codemod: `outline` to `secondary`, and drop the unused
  `destructive` and `on-dark`.
- Bring the identity spec up to date.
- Do a full visual sweep at 390, 768 and 1440 px in both themes.
- Run `pnpm test:e2e` and `pnpm test:a11y` on a production build.

Waves 1A to 1E and 2A to 2F can each run as an independent workstream. Wave 2
items that use a Wave 1 primitive (2B uses 1B's menu, 2A uses 1C's table)
start after that primitive lands.

## 6. Owner decisions

1. **Primary colour.** Keep the green fill, which is the brand and the "reaches
   Google" signal, or move to Taste's near-black primary and keep green for
   focus, data and the Google action. This is one alias change
   (`--primary`) either way.
2. **Card radius.** Keep 12px, or move to a tight ladder (8 card, 6 control,
   4 tag) or a soft one (16 / 12 / 999). This is one token block and reshapes
   every screen.
3. **Table header band.** Keep the sunken band, or go flat as Taste
   recommends. This is one token.
4. **Nav current item.** Keep the tint with the 3px bar, or move to a neutral
   pill.
