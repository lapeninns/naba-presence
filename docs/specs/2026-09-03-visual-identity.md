# Visual identity: calm editorial, light-first

Status: superseded, 2026-09-04, by
`docs/specs/2026-09-04-apple-identity.md`. Was accepted 2026-09-03. Superseded
`docs/specs/2026-07-28-design-system.md` and
`docs/archive/2026-07-frontend-rebuild/specs/2026-07-29-full-design-system-replacement-design.md`.
Amends §7 of
`docs/archive/2026-07-frontend-rebuild/specs/2026-07-31-frontend-rebuild-design.md`.

## Why this changed

The previous identity was Google's own Material palette converted to oklch,
on the reasoning that a Google Business Profile tool should look like Google.
That reasoning does not survive the shift to the agency persona
(`docs/specs/2026-09-03-agency-ux.md`): an agency shows these screens to its
clients, and a product wearing Google's blue reads as Google's product rather
than the agency's tool. It also made the interface loud in a job that is mostly
long stretches of reading review text.

The new direction is calm and editorial: warm paper neutrals, one restrained
accent, borders instead of shadows, and a serif reserved for titles and
figures. Light is the primary mode; dark is a faithful inversion, not an
afterthought.

## Token architecture

Four layers in `app/globals.css`, top to bottom. Nothing below layer 1 may
introduce a literal colour.

1. **Ramps** (`--np-ramp-*`) — raw steps. The only layer a designer edits.
2. **Semantic roles** (`--np-*`) — what components read: surface, ink, line,
   accent, four status families, interactive, data, shape, motion, spacing,
   density.
3. **Component tokens** — the few values that vary by density or control kind
   (`--np-field-h`, `--np-table-header-bg`, `--np-row-py`).
4. **Aliases** — the shadcn contract (`--background`, `--primary`, …), each
   resolving to a `--np-*` role.

The rebuild also carried a fifth, temporary layer: every legacy `--nr-*` name,
resolving to the `--np-*` role that replaced it, so screens could migrate one
at a time instead of in one breaking change. It is gone. Every screen reads the
roles directly, and `tests/design-system-contract.test.ts` now fails if a
`--nr-` name reappears — a compatibility layer that outlives its migration is
just a second vocabulary.

Two naming traps are documented rather than fixed, because fixing them would
mean forking shadcn: its `--accent` is a HIGHLIGHT SURFACE, not the brand
colour (it maps to `--np-selection-bg`), and the brand accent reaches Tailwind
as `--color-primary`.

### No `color-mix` in a role that must clear a ratio

Hover and active states are literal tokens (`--np-accent-hover`,
`--np-accent-active`). A value computed at paint time cannot be measured, and
an unmeasured hover state is precisely where AA quietly breaks — the previous
system's primary button hover was a `color-mix` with a hand-written comment
claiming 5.29:1 that nothing verified. `lib/design/tokens.ts` refuses to
resolve a `color-mix` in a checked role.

## Direction parameters

- **Neutrals**: one warm hue (oklch 70–85, chroma 0.003–0.012) for every grey.
- **Accent**: one hue at low chroma. sRGB cannot hold much chroma at teal hues
  in dark lightnesses — the maximum at L 0.46, hue 200 is about 0.078 — so the
  ramp is trimmed to what a browser can actually paint. The gate enforces it.
- **Status**: success ≈ 150, warning ≈ 72 (ink kept dark), danger ≈ 27, info
  ≈ 250, each with ink, tint, solid, on-solid and line.
- **Type**, a closed set of seven roles: caption 12/16, ui 13/20, body 14/22,
  title 16/24, section 18/26, page-title 26/32, display 32/38. Body rises from
  13.5px to 14px and caption from 11px to 12px; 11px was below the size at
  which any contrast allowance applies and was the standing readability
  complaint for long triage sessions. Geist carries UI and body; Newsreader
  carries page titles and display figures, with a Georgia fallback whose
  metrics are close enough that a slow font load does not reflow a heading.
- **Shape**: tag 4, control 8, field 8, card 12, panel 12, modal 16, pill 999.
- **Elevation is border-led.** Cards get a line and no shadow. Shadows exist
  for popovers, modals, toasts and a single raised-hover step. The glass
  tokens and the body gradients are retired.
- **Density**: `data-density` switches spacing only, never the type role, so
  compact tables cannot produce sub-12px text and no control falls under the
  24px target-size floor.

## The contrast gate

Colour decisions are measured, not asserted in comments.

- `lib/design/contrast.ts` — oklch/hex parsing, OKLab → linear sRGB → gamma,
  WCAG relative luminance and ratio, alpha compositing over a declared
  backdrop, sRGB gamut detection, and `nearestPassingLightness` for fix hints.
- `lib/design/tokens.ts` — reads the shipping `app/globals.css`, splits
  `:root` / `.dark`, resolves `var()` chains.
- `lib/design/contrast-pairs.ts` — the manifest: 48 pairs per theme, each with
  the ratio it must clear and a note saying what breaks if it does not.
- `scripts/check-contrast.mjs` — `pnpm check:contrast`, with `--hint` and
  `--json`.
- `tests/design-tokens-contrast.test.ts` — the same manifest under vitest, so
  a bad colour fails `pnpm test` before the browser suite starts.

All three measure the same source, so a ratio shown on `/design-system` and a
ratio asserted in CI cannot disagree. Writing this gate first paid for itself
immediately: it caught seven token pairs below target and an accent ladder
specified outside sRGB, all in the first draft of this palette.

Structural checks run alongside the ratios: every semantic role must have a
dark-theme value, every role must resolve in both themes, and every `--np-*`
colour must be inside sRGB — a clamped colour means the value in the file is not the value on
screen.

## What this does not change

The backend, the database, the API contracts, `naba_session`, the DB roles and
the CI database names are anchors, exactly as in the previous rebuild. One
`<main>` per page still belongs to `components/app-shell/page-frame.tsx`, and
the pinned axe rules (`heading-order`, `page-has-heading-one`,
`landmark-no-duplicate-main`) still govern every screen.
