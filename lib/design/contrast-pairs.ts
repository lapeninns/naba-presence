/**
 * The contrast contract: every foreground/background pair the product
 * actually paints, with the ratio it must clear.
 *
 * A pair here is a promise. Adding a role without adding its pair means the
 * gate cannot see it, so new roles come with new rows.
 */

import {
  contrastRatio,
  nearestPassingLightness,
  parseColor,
  roundRatio,
  type ParsedColor,
} from "./contrast"
import {
  resolveToken,
  semanticTokenNames,
  TokenResolutionError,
  type ParsedTokens,
  type ThemeName,
  type TokenSet,
} from "./tokens"

/** 4.5:1 for body text, 3:1 for large text and non-text indicators. */
export type PairKind = "text" | "large-text" | "graphic"

export type ContrastPair = {
  fg: string
  bg: string
  kind: PairKind
  /** What breaks if this pair fails, in the reviewer's terms. */
  note: string
}

const MINIMUM: Record<PairKind, number> = {
  text: 4.5,
  "large-text": 3,
  graphic: 3,
}

const statusPairs = (status: "success" | "warning" | "danger" | "info"): ContrastPair[] => [
  {
    fg: `--np-${status}-ink`,
    bg: "--np-surface-canvas",
    kind: "text",
    note: `${status} message text on the page background`,
  },
  {
    fg: `--np-${status}-ink`,
    bg: `--np-${status}-tint`,
    kind: "text",
    note: `${status} pill and banner text on its own tint`,
  },
  {
    fg: `--np-${status}-on-solid`,
    bg: `--np-${status}-solid`,
    kind: "text",
    note: `text on a solid ${status} fill`,
  },
  {
    fg: `--np-${status}-line`,
    bg: "--np-surface-canvas",
    kind: "graphic",
    note: `${status} banner border`,
  },
]

export const CONTRAST_PAIRS: ContrastPair[] = [
  // Ink on every surface it can land on.
  { fg: "--np-ink", bg: "--np-surface-canvas", kind: "text", note: "body text on the page" },
  { fg: "--np-ink", bg: "--np-surface", kind: "text", note: "body text in a card" },
  { fg: "--np-ink", bg: "--np-surface-raised", kind: "text", note: "text on a raised surface" },
  { fg: "--np-ink", bg: "--np-surface-sunken", kind: "text", note: "text in a table header or well" },
  { fg: "--np-ink", bg: "--np-surface-overlay", kind: "text", note: "text in a popover or dialog" },
  { fg: "--np-ink-muted", bg: "--np-surface-canvas", kind: "text", note: "captions and secondary text" },
  { fg: "--np-ink-muted", bg: "--np-surface", kind: "text", note: "secondary text in a card" },
  { fg: "--np-ink-muted", bg: "--np-surface-sunken", kind: "text", note: "table column headers" },
  { fg: "--np-ink-muted", bg: "--np-hover-bg", kind: "text", note: "secondary text on a hovered row" },
  { fg: "--np-ink-inverse", bg: "--np-ink", kind: "text", note: "text on an inverted surface" },
  // DECORATIVE ONLY: separators and inert icons. Gated at the non-text
  // threshold precisely because it is not allowed to carry words — anything
  // readable uses --np-ink-muted, which is measured at 4.5:1 above.
  { fg: "--np-ink-faint", bg: "--np-surface-canvas", kind: "graphic", note: "separators and inert icons" },
  { fg: "--np-ink-faint", bg: "--np-surface", kind: "graphic", note: "inert icons inside a card" },

  // Fill ladder: the grey a control is made of.
  { fg: "--np-ink", bg: "--np-fill", kind: "text", note: "grey button label and segmented control thumb text" },
  { fg: "--np-ink-muted", bg: "--np-fill", kind: "text", note: "unselected segment label on the track" },
  { fg: "--np-ink", bg: "--np-fill-secondary", kind: "text", note: "text in a search field or keycap" },
  { fg: "--np-ink-muted", bg: "--np-fill-secondary", kind: "text", note: "placeholder in a search field" },
  { fg: "--np-ink-muted", bg: "--np-fill-tertiary", kind: "text", note: "secondary text on a subtle well" },
  { fg: "--np-accent-ink", bg: "--np-fill", kind: "text", note: "tinted action inside a grey control" },

  // The third surface step and the counter surfaces.
  { fg: "--np-ink", bg: "--np-surface-alt", kind: "text", note: "text on a list row or panel" },
  { fg: "--np-ink-muted", bg: "--np-surface-alt", kind: "text", note: "secondary text on a list row or panel" },
  { fg: "--np-accent-ink", bg: "--np-surface-alt", kind: "text", note: "link or selected label on a panel" },
  { fg: "--np-success-ink", bg: "--np-surface-alt", kind: "text", note: "status text on a list row" },
  { fg: "--np-warning-ink", bg: "--np-surface-alt", kind: "text", note: "attention text on a list row" },
  { fg: "--np-danger-ink", bg: "--np-surface-alt", kind: "text", note: "danger text on a list row" },
  { fg: "--np-info-ink", bg: "--np-surface-alt", kind: "text", note: "pending text on a list row" },
  { fg: "--np-line-strong", bg: "--np-surface-alt", kind: "graphic", note: "control edge on a panel" },
  { fg: "--np-rating", bg: "--np-surface-alt", kind: "graphic", note: "star rating on a list row" },
  { fg: "--np-ink-on-charcoal", bg: "--np-charcoal", kind: "text", note: "composer footer and bulk bar labels" },
  { fg: "--np-ink-muted-on-charcoal", bg: "--np-charcoal", kind: "text", note: "dark action bar meta" },

  // Materials, measured against their opaque twins: the translucent value
  // composites over content and cannot be measured, so the twin is the floor.
  { fg: "--np-ink", bg: "--np-material-sidebar-opaque", kind: "text", note: "sidebar item label" },
  { fg: "--np-ink-muted", bg: "--np-material-sidebar-opaque", kind: "text", note: "sidebar group label" },
  { fg: "--np-ink", bg: "--np-material-toolbar-opaque", kind: "text", note: "toolbar title" },
  { fg: "--np-ink-muted", bg: "--np-material-toolbar-opaque", kind: "text", note: "toolbar breadcrumb" },
  { fg: "--np-ink", bg: "--np-material-popover-opaque", kind: "text", note: "menu item label" },
  { fg: "--np-ink-muted", bg: "--np-material-popover-opaque", kind: "text", note: "menu item shortcut hint" },

  // Accent.
  { fg: "--np-ink-on-accent", bg: "--np-accent", kind: "text", note: "primary button label" },
  { fg: "--np-ink-on-accent", bg: "--np-accent-hover", kind: "text", note: "primary button label, hovered" },
  { fg: "--np-ink-on-accent", bg: "--np-accent-active", kind: "text", note: "primary button label, pressed" },
  { fg: "--np-accent-ink", bg: "--np-surface-canvas", kind: "text", note: "links on the page" },
  { fg: "--np-accent-ink", bg: "--np-surface", kind: "text", note: "links in a card" },
  { fg: "--np-accent-ink", bg: "--np-accent-tint", kind: "text", note: "active nav item and selected chip" },
  { fg: "--np-accent-ink", bg: "--np-selection-bg", kind: "text", note: "text in a selected row" },
  { fg: "--np-ink", bg: "--np-accent-tint", kind: "text", note: "primary text on a tinted card or selected row" },
  { fg: "--np-ink-muted", bg: "--np-accent-tint", kind: "text", note: "secondary text in a selected row" },
  { fg: "--np-success-ink", bg: "--np-accent-tint", kind: "text", note: "status text in a selected row" },
  { fg: "--np-warning-ink", bg: "--np-accent-tint", kind: "text", note: "attention text in a selected row" },
  { fg: "--np-danger-ink", bg: "--np-accent-tint", kind: "text", note: "danger text in a selected row" },
  { fg: "--np-info-ink", bg: "--np-accent-tint", kind: "text", note: "pending text in a selected row" },
  { fg: "--np-accent-ink", bg: "--np-accent-tint-strong", kind: "text", note: "text over a text selection" },
  { fg: "--np-ink", bg: "--np-accent-tint-strong", kind: "text", note: "selected text" },
  { fg: "--np-accent-vivid", bg: "--np-surface", kind: "graphic", note: "vivid accent used as a graphic: switch on-state, progress, active icon" },
  { fg: "--np-ink-on-accent", bg: "--np-accent-vivid", kind: "large-text", note: "switch knob glyph on the vivid accent" },

  // Lines and focus: 3:1 as non-text indicators.
  { fg: "--np-line-strong", bg: "--np-surface-canvas", kind: "graphic", note: "input and button borders" },
  { fg: "--np-line-strong", bg: "--np-surface", kind: "graphic", note: "control borders inside a card" },
  { fg: "--np-focus-ring", bg: "--np-surface-canvas", kind: "graphic", note: "focus ring on the page" },
  { fg: "--np-focus-ring", bg: "--np-surface", kind: "graphic", note: "focus ring inside a card" },

  ...statusPairs("success"),
  ...statusPairs("warning"),
  ...statusPairs("danger"),
  ...statusPairs("info"),

  // Data.
  { fg: "--np-chart-1", bg: "--np-surface", kind: "graphic", note: "chart series 1" },
  { fg: "--np-chart-2", bg: "--np-surface", kind: "graphic", note: "chart series 2" },
  { fg: "--np-chart-3", bg: "--np-surface", kind: "graphic", note: "chart series 3" },
  { fg: "--np-chart-4", bg: "--np-surface", kind: "graphic", note: "chart series 4" },
  { fg: "--np-chart-5", bg: "--np-surface", kind: "graphic", note: "chart series 5" },
  { fg: "--np-chart-6", bg: "--np-surface", kind: "graphic", note: "chart series 6" },
  { fg: "--np-chart-axis", bg: "--np-surface", kind: "text", note: "chart axis labels" },
  { fg: "--np-rating", bg: "--np-surface", kind: "graphic", note: "star rating fill" },

  // Component tokens.
  { fg: "--np-ink", bg: "--np-field-bg", kind: "text", note: "typed value in an input" },
  { fg: "--np-ink-muted", bg: "--np-field-bg", kind: "text", note: "input placeholder" },
  { fg: "--np-ink-muted", bg: "--np-table-header-bg", kind: "text", note: "table header label" },
  { fg: "--np-line-strong", bg: "--np-field-bg", kind: "graphic", note: "field edge" },
  { fg: "--np-danger-line", bg: "--np-field-bg", kind: "graphic", note: "invalid field edge" },
  { fg: "--np-success-solid", bg: "--np-surface", kind: "graphic", note: "healthy status dot" },
  { fg: "--np-danger-solid", bg: "--np-surface", kind: "graphic", note: "at-risk status dot" },
  { fg: "--np-info-solid", bg: "--np-surface", kind: "graphic", note: "pending status dot" },
  { fg: "--np-warning-ink", bg: "--np-surface", kind: "graphic", note: "attention status dot" },
]

export type PairResult = {
  pair: ContrastPair
  theme: ThemeName
  ratio: number
  minimum: number
  passes: boolean
  fgValue: string
  bgValue: string
  /** Nearest lightness that would pass, when the pair fails and fg is oklch. */
  hint: number | null
  /** Set when a colour is specified outside sRGB and the browser clamps it. */
  outOfGamut: boolean
}

export type StructuralIssue = { kind: "structural"; theme: ThemeName; message: string }

function measure(tokens: TokenSet, pair: ContrastPair, theme: ThemeName): PairResult | StructuralIssue {
  let fgValue: string
  let bgValue: string
  try {
    fgValue = resolveToken(tokens, pair.fg, theme)
    bgValue = resolveToken(tokens, pair.bg, theme)
  } catch (error) {
    if (error instanceof TokenResolutionError) {
      return { kind: "structural", theme, message: error.message }
    }
    throw error
  }

  const fg = parseColor(fgValue)
  const bg = parseColor(bgValue)
  if (!fg || !bg) {
    const bad = fg ? `${pair.bg} = ${bgValue}` : `${pair.fg} = ${fgValue}`
    return { kind: "structural", theme, message: `Cannot parse ${bad} as a colour` }
  }

  const minimum = MINIMUM[pair.kind]
  const ratio = roundRatio(contrastRatio(fg, bg))
  const passes = ratio >= minimum
  return {
    pair,
    theme,
    ratio,
    minimum,
    passes,
    fgValue,
    bgValue,
    hint: passes ? null : hintFor(fg, bg, minimum),
    outOfGamut: Boolean(fg.outOfGamut || bg.outOfGamut),
  }
}

function hintFor(fg: ParsedColor, bg: ParsedColor, minimum: number): number | null {
  return fg.oklch ? nearestPassingLightness(fg.oklch, bg, minimum) : null
}

export type AuditReport = {
  results: PairResult[]
  issues: StructuralIssue[]
  failures: PairResult[]
}

/**
 * Measures every pair in both themes and runs the structural checks:
 * a `--np-*` role defined for one theme but not the other is a bug even when
 * every measured pair happens to pass, because a later value change would
 * silently fall back to the light value on a dark surface.
 */
export function auditTokens(parsed: ParsedTokens): AuditReport {
  const results: PairResult[] = []
  const issues: StructuralIssue[] = []

  for (const theme of ["light", "dark"] as const) {
    const tokens = parsed[theme]
    for (const pair of CONTRAST_PAIRS) {
      const outcome = measure(tokens, pair, theme)
      if ("kind" in outcome) issues.push(outcome)
      else results.push(outcome)
    }
  }

  // Every semantic role the light theme declares must be answered by the dark
  // block, unless it is theme-independent (shape, motion, spacing, density).
  const themeIndependent =
    /^--np-(radius|corner|duration|ease|stagger|sidebar-width|rail-width|touch|toolbar|page|gap|card|panel|row|cell|control|list|field-h|pill|menu|material-blur|material-saturate|measure|focus-halo)/
  const lightNames = semanticTokenNames(parsed.light)
  const darkOwn = new Set(
    Object.keys(parsed.dark).filter((name) => parsed.dark[name] !== parsed.light[name])
  )
  for (const name of lightNames) {
    if (themeIndependent.test(name)) continue
    if (name.startsWith("--np-ramp-")) continue
    if (name.startsWith("--np-shadow-")) continue
    if (!darkOwn.has(name) && !name.startsWith("--np-chart-grid") && !name.startsWith("--np-chart-axis")) {
      // A role that resolves through another role it DOES override is fine.
      const light = parsed.light[name]
      if (light?.startsWith("var(")) continue
      issues.push({
        kind: "structural",
        theme: "dark",
        message: `${name} has no dark-theme value; it would inherit the light one`,
      })
    }
  }

  for (const theme of ["light", "dark"] as const) {
    const tokens = parsed[theme]
    for (const name of semanticTokenNames(tokens)) {
      let value: string
      try {
        value = resolveToken(tokens, name, theme)
      } catch {
        continue // Non-colour roles (shape, motion) resolve fine; skip the rest.
      }
      const colour = parseColor(value)
      if (colour?.outOfGamut) {
        issues.push({
          kind: "structural",
          theme,
          message: `${name} = ${value} is outside sRGB; the browser clamps it, so the painted colour is not the specified one`,
        })
      }
    }
  }

  return { results, issues, failures: results.filter((result) => !result.passes) }
}
