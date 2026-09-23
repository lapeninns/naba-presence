# Visual identity: Apple-grade, platform-native, light-first

Status: superseded, 2026-09-19, by
`docs/specs/2026-09-19-warm-paper-identity.md`. Was accepted 2026-09-04. Superseded
`docs/specs/2026-09-03-visual-identity.md` ("calm editorial"). The token
architecture, contrast gate, density model and accessibility pins from that
spec are carried forward unchanged; the values and the component language are
replaced.

## Why this changed

The editorial identity was chosen so an agency's clients would not see
Google's product. It succeeded at that, but a serif-and-paper interface reads
as a publication, and the product is a working tool people sit inside for
hours. The direction now is the one those people already know from the
machines they use: the Human Interface Guidelines' vocabulary, translated to
the web and held to WCAG where Apple's own palette is not.

"Apple-like" is a set of specific mechanisms, not a mood:

- **Hierarchy by weight and tracking, not colour or typeface.** One family
  everywhere. Titles are heavier and tighter; captions are lighter and looser.
- **Grouped backgrounds.** The page is a soft grey; content sits on white
  cards that need neither a border nor a shadow to be cards.
- **A label ladder and a fill ladder.** Four ink levels; three greys that
  controls are made of. Colour is reserved for the accent and the four
  status families.
- **Materials.** Sidebar, toolbar and popovers are translucent and blurred,
  and content scrolls beneath them. Every material has an opaque twin that
  takes over under `prefers-reduced-transparency` or when the browser cannot
  blur.
- **Hairlines and layered shadows.** Separators are thin and light. Chrome
  and overlays carry a half-pixel edge plus an ambient and a key shadow.
- **Springs.** Motion follows a spring curve encoded as `linear()`, so every
  browser plays the same curve. Overlays scale from their anchor; nothing
  linearly fades.
- **Concentric, continuous corners.** An inner radius is the outer radius
  minus the padding. Where the browser supports `corner-shape`, corners are
  superellipses.
- **Direct manipulation and keyboard first.** Segmented controls for view
  switching, an inspector column for detail, ⌘K everywhere, visible shortcuts
  in menus.

## Token architecture

Unchanged in shape: ramps → semantic roles → component tokens → shadcn
aliases, in `app/globals.css`. New roles this spec adds:

| Role | Purpose |
|---|---|
| `--np-ink-quaternary` | Decorative only: disabled glyphs, inert ornaments. Not in the manifest. |
| `--np-fill`, `--np-fill-secondary`, `--np-fill-tertiary` | Control surfaces: grey buttons, segmented tracks, search fields, keycaps. |
| `--np-accent-tint-strong` | Text selection and the pressed state of a tinted control. |
| `--np-accent-vivid` | The bright system blue, for graphics only (switch on-state, progress, active glyphs). Measured at 3:1. |
| `--np-material-{sidebar,toolbar,popover}` and their `-opaque` twins | Chrome surfaces. Text on a material is measured against the twin. |
| `--np-scrim` | The backdrop behind a modal. |
| `--np-shadow-hairline`, `--np-focus-halo` | The half-pixel edge and the soft focus halo. |
| `--np-ease-spring`, `--np-ease-spring-snappy` | The two spring curves. |
| `--np-radius-sheet`, `--np-corner-shape` | Bottom sheets and continuous corners. |
| `--np-toolbar-h`, `--np-menu-item-h` | Shell and menu metrics. |

## Direction parameters

- **Neutrals**: one cool hue (oklch 260–265, chroma 0.003–0.014). Canvas is
  the grouped background; cards are pure white.
- **Accent**: system blue at hue 256. Apple's `#007AFF` clears only 4.0:1 on
  white, so the text and button steps sit at lightness 0.56 and below, and the
  vivid step is reserved for non-text graphics at 3:1. In the dark theme the
  hover state is lighter than the rest state, as on the platform, but bounded
  so white text still clears 4.5:1.
- **Status**: success 150, warning 60–70 (ink kept dark), danger 27, info
  235, each with ink, tint, solid, on-solid and line.
- **Type**: one family. San Francisco via `-apple-system` where the platform
  has it; Inter with its optical-size axis everywhere else. Seven roles, each
  with a size, a line height and a tracking value: caption 12/16 +0.01em,
  ui 13/18, body 14/20, title 15/20 −0.01em, section 17/22 −0.015em,
  page-title 24/28 −0.02em, display 32/36 −0.025em. Caption stays at 12px:
  11px was the standing readability complaint and remains banned. Weight
  carries hierarchy: a headline is body size at 600, a page title is 700.
  Figures in tiles and tables use tabular numerals.
- **Shape**: tag 6, control 10, field 10, card 14, panel 16, modal 20,
  sheet 28, pill 999. Nested radii are concentric by construction.
- **Elevation**: cards on the canvas have none. Overlays use hairline plus
  two shadow layers. Dark-theme elevation is lightness first, shadow second.
- **Density**: unchanged. `data-density` switches spacing only; nothing drops
  below 12px text or a 24px target.
- **Focus**: a 3.5px accent halo at partial alpha hugging the control, no
  offset. The halo's solid colour is measured at 3:1.

## Component language

- **Toolbar** replaces the top bar: the page title lives in the content
  column with its actions, on a material that content scrolls under.
- **Sidebar** is a material with a rounded selection pill and tinted accent
  text; the selected item's glyph is filled.
- **Segmented control** replaces Tabs for switching views of the same data.
  Tabs remain for genuinely separate page sections.
- **Inspector** is a third column for inbox detail on wide screens and a
  sheet below it.
- **Buttons** come in Apple's four styles: filled, tinted, grey and plain.
  Destructive is a tinted red.
- **Grouped list** for settings and profile: inset rows, separators indented
  from the leading edge, chevrons on navigational rows.
- **Switch** joins the primitives. **Popover** gains an arrow. **Sheet** on
  narrow screens is a bottom sheet with a grabber.
- **Menus** are on the popover material with a checkmark column, a shortcut
  column and 30px rows.

## The contrast gate

Unchanged, and the reason this identity is better than a straight copy of
the platform: every ink/surface pair the product paints is measured in both
themes from the shipping CSS, and Apple's own palette fails several of them.
The manifest gained rows for the fill ladder, the material twins and the
vivid accent. Materials themselves are not measured — a translucent surface
composites over content — which is why each keeps its alpha high and its
opaque twin in the manifest.

## Known limits

- San Francisco cannot be shipped; non-Apple platforms see Inter.
- Backdrop blur must never sit on a scrolling row; only on chrome.
- Continuous corners are progressive enhancement.
- WCAG forces choices the platform does not make. When they conflict, WCAG
  wins.

## What this does not change

The backend, the database, the API contracts, `naba_session`, the DB roles
and the CI database names are anchors. One `<main>` per page still belongs to
`components/app-shell/page-frame.tsx`, and the pinned axe rules
(`heading-order`, `page-has-heading-one`, `landmark-no-duplicate-main`)
still govern every screen.
