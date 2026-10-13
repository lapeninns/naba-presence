/**
 * The one TypeScript copy of the viewport breakpoints.
 *
 * CSS owns the breakpoints: Tailwind v4 reads `--breakpoint-*` from the
 * `@theme` block in app/globals.css (or its own defaults when none is set),
 * and the `controls` / `capsules` custom variants carry their own media
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
 * Tailwind's named widths, plus `sidebar`: the shell's switch from the 64px
 * icon rail to the full 240px sidebar. The shell still writes `sidebar` as
 * the arbitrary `min-[1181px]:` / `max-[1181px]:` variants; once globals.css
 * declares `--breakpoint-sidebar: 73.8125rem` those become `sidebar:` and
 * `max-sidebar:` and the test reads the value from @theme instead.
 */
const BREAKPOINT_REM = {
  sm: 40,
  md: 48,
  lg: 64,
  xl: 80,
  "2xl": 96,
  sidebar: 1181 / REM_PX,
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
 * `min-width` / `max-width` rather than the range syntax Tailwind emits
 * (`width >= 48rem`): both mean the same thing, and the older form is the
 * one every engine's matchMedia parses.
 */
function minWidth(name: BreakpointName): string {
  return `(min-width: ${BREAKPOINTS[name].rem}rem)`
}

const controls = `${minWidth("md")} and (min-height: ${CONTROLS_MIN_HEIGHT.rem}rem)`

/**
 * Media queries by name. Each breakpoint name means "at least this wide",
 * exactly like the Tailwind prefix of the same name; `controls` and
 * `capsules` are the custom variants, word for word.
 *
 * There is deliberately no `max-*` entry: "below md" is `!matches("md")`,
 * which avoids the 0.02px gap a hand-written `max-width: 47.98rem` leaves.
 */
export const MEDIA_QUERIES = {
  sm: minWidth("sm"),
  md: minWidth("md"),
  lg: minWidth("lg"),
  xl: minWidth("xl"),
  "2xl": minWidth("2xl"),
  sidebar: minWidth("sidebar"),
  controls,
  capsules: `not all and ${controls}`,
} as const satisfies Record<BreakpointName | "controls" | "capsules", string>

export type MediaQueryName = keyof typeof MEDIA_QUERIES

/** The `matchMedia` string for a named breakpoint or variant. */
export function mediaQuery(name: MediaQueryName): string {
  return MEDIA_QUERIES[name]
}
