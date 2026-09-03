import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { parseTokens, resolveToken } from "@/lib/design/tokens"

const globals = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8"
)
const tokens = parseTokens(globals)

const pageFrame = readFileSync(
  new URL("../components/app-shell/page-frame.tsx", import.meta.url),
  "utf8"
)

const primitiveNames = [
  "button",
  "card",
  "badge",
  "alert",
  "skeleton",
  "spinner",
  "field",
  "input",
  "label",
  "dialog",
  "sheet",
  "toast",
]
const primitiveSource = primitiveNames
  .map((name) =>
    readFileSync(
      new URL(`../components/ui/${name}.tsx`, import.meta.url),
      "utf8"
    )
  )
  .join("\n")

/**
 * The semantic roles every component is entitled to read. Renaming or dropping
 * one is a breaking change to the design system, so the list is pinned.
 */
const SEMANTIC_ROLES = [
  "--np-surface-canvas",
  "--np-surface",
  "--np-surface-raised",
  "--np-surface-sunken",
  "--np-surface-overlay",
  "--np-ink",
  "--np-ink-muted",
  "--np-ink-faint",
  "--np-ink-inverse",
  "--np-line-subtle",
  "--np-line",
  "--np-line-strong",
  "--np-line-focus",
  "--np-accent",
  "--np-accent-hover",
  "--np-accent-active",
  "--np-accent-tint",
  "--np-accent-ink",
  "--np-ink-on-accent",
  "--np-selection-bg",
  "--np-hover-bg",
  "--np-focus-ring",
  "--np-rating",
  "--np-chart-1",
  "--np-chart-6",
  "--np-chart-grid",
  "--np-chart-axis",
  "--np-radius-tag",
  "--np-radius-control",
  "--np-radius-field",
  "--np-radius-card",
  "--np-radius-panel",
  "--np-radius-modal",
  "--np-radius-pill",
  "--np-shadow-raised",
  "--np-shadow-pop",
  "--np-shadow-modal",
  "--np-duration-fast",
  "--np-duration-standard",
  "--np-duration-overlay",
  "--np-ease-standard",
  "--np-sidebar-width",
  "--np-page-pad-x",
  "--np-page-max-width",
  "--np-row-py",
  "--np-row-h",
  "--np-cell-px",
  "--np-control-h",
  "--np-field-h",
  "--np-table-header-bg",
]

for (const status of ["success", "warning", "danger", "info"]) {
  SEMANTIC_ROLES.push(
    `--np-${status}-ink`,
    `--np-${status}-tint`,
    `--np-${status}-solid`,
    `--np-${status}-on-solid`,
    `--np-${status}-line`
  )
}

/**
 * Legacy names screens still use. They must keep RESOLVING while the migration
 * runs; the B6 codemod deletes the alias block and flips this expectation.
 */
const LEGACY_ALIASES = [
  "--nr-sidebar-width",
  "--nr-page-pad-x",
  "--nr-page-max-width",
  "--nr-radius-control",
  "--nr-radius-card",
  "--nr-radius-panel",
  "--nr-radius-modal",
  "--nr-radius-field",
  "--nr-radius-tag",
  "--nr-radius-pill",
  "--nr-shadow-card",
  "--nr-shadow-float",
  "--nr-shadow-modal",
  "--nr-duration-fast",
  "--nr-duration-standard",
  "--nr-duration-overlay",
  "--nr-ease-standard",
  "--nr-gap-card",
  "--nr-gap-section",
]

describe("NabaPresence design tokens", () => {
  it.each(SEMANTIC_ROLES)("defines the %s role", (role) =>
    expect(globals).toContain(`${role}:`)
  )

  it.each(LEGACY_ALIASES)("keeps %s resolvable during the migration", (alias) => {
    expect(() => resolveToken(tokens.light, alias, "light")).not.toThrow()
    expect(() => resolveToken(tokens.dark, alias, "dark")).not.toThrow()
  })

  it("routes every legacy alias through a --np-* role", () => {
    // An alias holding its own literal value would drift from the role it is
    // supposed to shadow, and the two would diverge silently.
    const literalAliases = Object.entries(tokens.light)
      .filter(([name]) => name.startsWith("--nr-"))
      .filter(([, value]) => /oklch\(|#[0-9a-f]{3}/i.test(value))
      .map(([name]) => name)
    expect(literalAliases).toEqual([])
  })

  it("maps the shadcn contract onto the roles", () => {
    for (const contractToken of [
      "--background",
      "--foreground",
      "--primary",
      "--primary-foreground",
      "--muted",
      "--muted-foreground",
      "--accent",
      "--accent-foreground",
      "--destructive",
      "--border",
      "--input",
      "--ring",
      "--sidebar",
    ]) {
      expect(tokens.light[contractToken]).toMatch(/^var\(--np-/)
    }
  })

  it("collapses all animation under prefers-reduced-motion", () => {
    expect(globals).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.01ms/
    )
  })

  it("does not import the prototype runtime", () => {
    expect(globals).not.toContain(".nr-btn")
    expect(globals).not.toContain("injectCss")
  })

  it("has no dead spacing scale", () => {
    expect(globals).not.toMatch(/--np-space-\d/)
    expect(globals).not.toMatch(/--nr-space-\d/)
  })
})

describe("type roles", () => {
  it("defines the seven named roles at their agreed sizes", () => {
    for (const role of [
      "--text-caption: 0.75rem", // 12px
      "--text-ui: 0.8125rem", // 13px
      "--text-body: 0.875rem", // 14px
      "--text-title: 1rem", // 16px
      "--text-section: 1.125rem", // 18px
      "--text-page-title: 1.625rem", // 26px
      "--text-display: 2rem", // 32px
    ]) {
      expect(globals).toContain(role)
    }
  })

  it("gives every type role a line height", () => {
    for (const role of [
      "caption",
      "ui",
      "body",
      "title",
      "section",
      "page-title",
      "display",
    ]) {
      expect(globals).toContain(`--text-${role}--line-height:`)
    }
  })

  it("keeps a display family distinct from the UI family", () => {
    expect(globals).toContain("--font-display: var(--font-newsreader)")
    expect(globals).toContain("--font-heading: var(--font-display)")
  })
})

describe("density", () => {
  it("varies spacing only, never the type scale", () => {
    const compact = globals.slice(globals.indexOf('[data-density="compact"]'))
    const block = compact.slice(0, compact.indexOf("}"))
    expect(block).toContain("--np-row-py")
    expect(block).toContain("--np-control-h")
    expect(block).not.toContain("--text-")
  })

  it("keeps compact controls above the 24px target-size floor", () => {
    const compact = globals.slice(globals.indexOf('[data-density="compact"]'))
    const height = /--np-control-h:\s*(\d+)px/.exec(compact)
    expect(height).not.toBeNull()
    expect(Number(height![1])).toBeGreaterThanOrEqual(24)
  })
})

describe("primitives read tokens, not literals", () => {
  it("uses purpose-specific radius and motion tokens", () => {
    expect(primitiveSource).toContain("--nr-radius-control")
    expect(primitiveSource).toContain("--nr-radius-card")
    expect(primitiveSource).toContain("--nr-duration-fast")
    expect(primitiveSource).toContain("--nr-radius-field")
  })

  it("keeps overlays on tokenised durations and shadows", () => {
    expect(primitiveSource).toContain("--nr-duration-standard")
    expect(primitiveSource).toContain("--nr-radius-modal")
    expect(primitiveSource).toContain("--nr-shadow-modal")
    for (const hardCodedDuration of ["duration-1", "duration-2", "duration-5"]) {
      expect(primitiveSource).not.toContain(hardCodedDuration)
    }
  })

  it("supports all three PageFrame width modes", () => {
    expect(pageFrame).toContain('width?: "standard" | "wide" | "workspace"')
    expect(pageFrame).toContain(
      'width === "standard" && "max-w-(--nr-page-max-width)"'
    )
    expect(pageFrame).toContain('width === "wide" && "max-w-7xl"')
    expect(pageFrame).toContain(
      'width === "workspace" && "h-full max-w-none min-h-0 overflow-hidden"'
    )
  })
})
