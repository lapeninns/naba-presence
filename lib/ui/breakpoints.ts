/**
 * The one TypeScript copy of the viewport breakpoints.
 *
 * CSS owns the breakpoints: Tailwind v4 reads `--breakpoint-*` from the
 * `@theme` block in app/globals.css (or its own defaults when none is set),
 * and the `controls` / `capsules` / `desk` / `tall` custom variants carry their own media
 * query. This file mirrors those values for the few places JavaScript has to
 * ask the same question — `matchMedia` for behaviour, never for layout (see
 * lib/hooks/use-media-query.ts). tests/breakpoints.test.ts parses
 * globals.css and fails the moment the two disagree, so changing a value is
 * one edit in CSS plus the matching edit here.
 *
 * Values are rem because Tailwind's are. A rem in a media query is always the
 * browser's initial font size (16px), never the root element's, so `px` is an
 * exact conversion rather than an estimate.
 */

const REM_PX = 16

/**
 * Tailwind's named widths, plus `wide`: the shell's switch from the 72px
 * icon rail to the full 240px sidebar, declared in globals.css as
 * `--breakpoint-wide` (so `wide:` / `max-wide:` exist as Tailwind
 * variants).
 */
const BREAKPOINT_REM = {
  sm: 40,
  md: 48,
  lg: 64,
  wide: 73.75,
  xl: 80,
  "2xl": 96,
} as const

export type BreakpointName = keyof typeof BREAKPOINT_REM

export type Breakpoint = { readonly rem: number; readonly px: number }

export const BREAKPOINTS = Object.fromEntries(
  Object.entries(BREAKPOINT_REM).map(([name, rem]) => [
    name,
    { rem, px: rem * REM_PX },
  ])
) as { readonly [Name in BreakpointName]: Breakpoint }

/**
 * The height floor of the `controls` variant: tall enough for stacked
 * segmented controls. globals.css explains why 34rem; the width half of the
 * condition is `md`.
 */
export const CONTROLS_MIN_HEIGHT: Breakpoint = { rem: 34, px: 34 * REM_PX }

/**
 * The height floor of the `tall` variant: room for a sticky header block
 * on top of the content (globals.css explains it). 38.75rem is 620px.
 */
export const TALL_MIN_HEIGHT: Breakpoint = { rem: 38.75, px: 38.75 * REM_PX }

/**
 * `min-width` / `max-width` rather than the range syntax Tailwind emits
 * (`width >= 48rem`): both mean the same thing, and the older form is the
 * one every engine's matchMedia parses.
 */
function minWidth(name: BreakpointName): string {
  return `(min-width: ${BREAKPOINTS[name].rem}rem)`
}

const controls = `${minWidth("md")} and (min-height: ${CONTROLS_MIN_HEIGHT.rem}rem)`

/**
 * The height under which a touch screen is too short for a centred dialog
 * (a phone in landscape is 390-430px tall). See `phoneOverlay` below.
 */
export const PHONE_OVERLAY_MAX_HEIGHT: Breakpoint = { rem: 30, px: 30 * REM_PX }

/**
 * Just under a breakpoint, for the one query that has to say "narrower
 * than": `phoneOverlay` is a list of two queries, and a list cannot be
 * negated as a whole the way `capsules` negates `controls`.
 */
function below(rem: number): string {
  return `${(rem - 0.001).toFixed(3)}rem`
}

/**
 * When an `auto` overlay presents as a bottom sheet (components/ui/overlay.tsx):
 * below `sm`, or a touch screen shorter than 30rem.
 */
const PHONE_OVERLAY = `(max-width: ${below(BREAKPOINTS.sm.rem)}), (pointer: coarse) and (max-height: ${below(PHONE_OVERLAY_MAX_HEIGHT.rem)})`

/**
 * The `desk` custom variant: a fine pointer with at least `md` of width,
 * where the size tokens step down to the operator's-desk scale. Behaviour
 * that must agree with the density (a compact list, hover affordances)
 * asks this, not a width.
 */
const DESK = `${minWidth("md")} and (pointer: fine)`

/**
 * Media queries by name. Each breakpoint name means "at least this wide",
 * exactly like the Tailwind prefix of the same name; `controls`,
 * `capsules`, `desk` and `tall` are the custom variants, word for word.
 *
 * There is deliberately no `max-*` entry: "below md" is `!matches("md")`,
 * which avoids the 0.02px gap a hand-written `max-width: 47.98rem` leaves.
 * `phoneOverlay` is the exception, for the reason given above it.
 */
export const MEDIA_QUERIES = {
  sm: minWidth("sm"),
  md: minWidth("md"),
  lg: minWidth("lg"),
  xl: minWidth("xl"),
  "2xl": minWidth("2xl"),
  wide: minWidth("wide"),
  controls,
  desk: DESK,
  capsules: `not all and ${controls}`,
  phoneOverlay: PHONE_OVERLAY,
  tall: `(min-height: ${TALL_MIN_HEIGHT.rem}rem)`,
} as const satisfies Record<
  BreakpointName | "controls" | "capsules" | "desk" | "phoneOverlay" | "tall",
  string
>

export type MediaQueryName = keyof typeof MEDIA_QUERIES

/** The `matchMedia` string for a named breakpoint or variant. */
export function mediaQuery(name: MediaQueryName): string {
  return MEDIA_QUERIES[name]
}
