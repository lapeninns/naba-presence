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
  "--np-shadow-hairline",
  "--np-duration-fast",
  "--np-duration-standard",
  "--np-duration-overlay",
  "--np-ease-standard",
  "--np-ease-spring",
  "--np-ease-spring-snappy",
  "--np-sidebar-width",
  "--np-toolbar-h",
  "--np-page-pad-x",
  "--np-page-max-width",
  "--np-ink-quaternary",
  "--np-fill",
  "--np-fill-secondary",
  "--np-fill-tertiary",
  "--np-accent-tint-strong",
  "--np-accent-vivid",
  "--np-focus-halo",
  "--np-material-sidebar",
  "--np-material-toolbar",
  "--np-material-popover",
  "--np-scrim",
  "--np-radius-sheet",
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
 * The shape tokens every screen reads. They were `--nr-*` names shadowing
 * `--np-*` roles through a compatibility block; the block is gone and these
 * are the roles themselves.
 */
const SHAPE_TOKENS = [
  "--np-sidebar-width",
  "--np-page-pad-x",
  "--np-page-max-width",
  "--np-radius-control",
  "--np-radius-card",
  "--np-radius-panel",
  "--np-radius-modal",
  "--np-radius-field",
  "--np-radius-tag",
  "--np-radius-pill",
  "--np-shadow-raised",
  "--np-shadow-modal",
  "--np-duration-fast",
  "--np-duration-standard",
  "--np-duration-overlay",
  "--np-ease-standard",
  "--np-gap-card",
  "--np-gap-section",
]

describe("NabaPresence design tokens", () => {
  it.each(SEMANTIC_ROLES)("defines the %s role", (role) =>
    expect(globals).toContain(`${role}:`)
  )

  it.each(SHAPE_TOKENS)("resolves %s in both themes", (token) => {
    expect(() => resolveToken(tokens.light, token, "light")).not.toThrow()
    expect(() => resolveToken(tokens.dark, token, "dark")).not.toThrow()
  })

  it("has retired the --nr-* compatibility layer entirely", () => {
    // The aliases existed so unmigrated screens kept rendering during the
    // rebuild. Every screen is migrated, so a new `--nr-` name would be a
    // second vocabulary starting up again.
    expect(globals).not.toMatch(/--nr-/)
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

  it("degrades materials to opaque twins under reduced transparency", () => {
    expect(globals).toMatch(
      /prefers-reduced-transparency: reduce[\s\S]*--np-material-sidebar: var\(--np-material-sidebar-opaque\)/
    )
    expect(globals).toMatch(/@supports not \(backdrop-filter: blur\(1px\)\)/)
  })

  it("encodes motion as springs, not fades", () => {
    expect(globals).toMatch(/--np-ease-spring:\s*linear\(/)
    expect(globals).toMatch(/--np-ease-spring-snappy:\s*linear\(/)
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
      "--text-title: 0.9375rem", // 15px
      "--text-section: 1.0625rem", // 17px
      "--text-page-title: 1.5rem", // 24px
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

  it("gives every type role a tracking value", () => {
    for (const role of [
      "caption",
      "ui",
      "body",
      "title",
      "section",
      "page-title",
      "display",
    ]) {
      expect(globals).toContain(`--text-${role}--letter-spacing:`)
    }
  })

  it("carries hierarchy in one family: display resolves to the UI family", () => {
    // Weight and tracking make the hierarchy, never a second typeface.
    expect(globals).toContain("--font-display: var(--font-sans)")
    expect(globals).toContain("--font-heading: var(--font-display)")
    expect(globals).not.toContain("newsreader")
  })

  it("puts the platform font first and Inter as the fallback", () => {
    expect(globals).toMatch(/--font-sans:\s*-apple-system, BlinkMacSystemFont, var\(--font-inter\)/)
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
    expect(primitiveSource).toContain("--np-radius-control")
    expect(primitiveSource).toContain("--np-radius-card")
    expect(primitiveSource).toContain("--np-duration-fast")
    expect(primitiveSource).toContain("--np-radius-field")
  })

  it("keeps overlays on tokenised durations and shadows", () => {
    expect(primitiveSource).toContain("--np-duration-standard")
    expect(primitiveSource).toContain("--np-radius-modal")
    expect(primitiveSource).toContain("--np-shadow-modal")
    for (const hardCodedDuration of ["duration-1", "duration-2", "duration-5"]) {
      expect(primitiveSource).not.toContain(hardCodedDuration)
    }
  })

  it("supports all three PageFrame width modes", () => {
    expect(pageFrame).toContain('width?: "standard" | "wide" | "workspace"')
    expect(pageFrame).toContain(
      'width === "standard" && "max-w-(--np-page-max-width)"'
    )
    expect(pageFrame).toContain('width === "wide" && "max-w-7xl"')
    expect(pageFrame).toContain(
      'width === "workspace" && "h-full max-w-none min-h-0 overflow-hidden"'
    )
  })
})
