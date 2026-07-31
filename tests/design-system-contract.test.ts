import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const globals = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8"
)

// re-enabled as the primitive is re-admitted (rebuild M1 T7/T8)
/*
const primitiveSource = ["button", "card", "input", "textarea", "badge", "item"]
  .map((name) =>
    readFileSync(
      new URL(`../components/ui/${name}.tsx`, import.meta.url),
      "utf8"
    )
  )
  .join("\n")
*/

// re-enabled once components/naba-presence/shared.tsx is re-admitted (rebuild M1 T9)
/*
const shared = readFileSync(
  new URL("../components/naba-presence/shared.tsx", import.meta.url),
  "utf8"
)
*/

// re-enabled as the primitive is re-admitted (rebuild M1 T7/T8)
/*
const card = readFileSync(
  new URL("../components/ui/card.tsx", import.meta.url),
  "utf8"
)
*/

// re-enabled as deleted sections and primitives are re-admitted to
// app/design-system/page.tsx (rebuild M1 T7-T9)
/*
const proof = readFileSync(
  new URL("../app/design-system/page.tsx", import.meta.url),
  "utf8"
)
*/

// re-enabled once components/naba-presence/shared.tsx is re-admitted (rebuild M1 T9)
/*
const sharedFunction = (name: string, nextName: string) =>
  shared.slice(
    shared.indexOf(`export function ${name}`),
    shared.indexOf(`export function ${nextName}`)
  )
*/

const tokens = [
  "--nr-sidebar-width",
  "--nr-page-pad-x",
  "--nr-page-max-width",
  "--nr-radius-control",
  "--nr-radius-card",
  "--nr-radius-panel",
  "--nr-radius-modal",
  "--nr-shadow-card",
  "--nr-shadow-float",
  "--nr-shadow-modal",
  "--nr-surface-glass",
  "--nr-surface-glass-strong",
  "--nr-surface-card-translucent",
  "--nr-duration-fast",
  "--nr-duration-overlay",
  "--nr-ease-standard",
]

describe("NabaPresence design system", () => {
  it.each(tokens)("defines %s", (token) =>
    expect(globals).toContain(`${token}:`)
  )
  it("provides motion and blur fallbacks", () => {
    expect(globals).toContain("prefers-reduced-motion: reduce")
    expect(globals).toContain("@supports not ((backdrop-filter: blur(1px))")
  })
  it("does not import the prototype runtime", () => {
    expect(globals).not.toContain(".nr-btn")
    expect(globals).not.toContain("injectCss")
  })

  // re-enabled as the primitive is re-admitted (rebuild M1 T7/T8)
  /*
  it("uses purpose-specific tokens in primitives", () => {
    expect(primitiveSource).toContain("--nr-radius-control")
    expect(primitiveSource).toContain("--nr-radius-card")
    expect(primitiveSource).toContain("--nr-radius-field")
    expect(primitiveSource).toContain("--nr-duration-fast")
  })
  */

  // re-enabled once components/naba-presence/shared.tsx is re-admitted (rebuild M1 T9)
  /*
  it("owns shared product compositions", () => {
    expect(shared).toContain("export function PageFrame")
    expect(shared).toContain("export function PageHeader")
    expect(shared).toContain("export function BusinessContext")
  })
  it("supports all three PageFrame width modes", () => {
    const pageFrame = sharedFunction("PageFrame", "PageHeader")

    expect(pageFrame).toContain('width?: "standard" | "wide" | "workspace"')
    expect(pageFrame).toContain(
      'width === "standard" && "max-w-(--nr-page-max-width)"'
    )
    expect(pageFrame).toContain('width === "wide" && "max-w-7xl"')
    expect(pageFrame).toContain('width === "workspace" && "max-w-none"')
  })
  */

  // re-enabled once components/naba-presence/shared.tsx and components/ui/card.tsx
  // are re-admitted (rebuild M1 T7/T9)
  /*
  it("limits the semantic translucent surface to business and metric cards", () => {
    const businessContext = sharedFunction(
      "BusinessContext",
      "readControlValue"
    )
    const metricCard = sharedFunction("MetricCard", "chartConfig")
    const translucentSurfaceOccurrences = shared.match(
      /--nr-surface-card-translucent/g
    )

    expect(businessContext).toContain("--nr-surface-card-translucent")
    expect(metricCard).toContain("--nr-surface-card-translucent")
    expect(translucentSurfaceOccurrences).toHaveLength(2)
    expect(card).toMatch(/(?:^|\s)bg-card(?=\s|")/)
    expect(card).not.toMatch(/\bbg-card\//)
    expect(card).not.toContain("--nr-surface-card-translucent")
  })
  */

  // re-enabled once components/naba-presence/shared.tsx is re-admitted (rebuild M1 T9)
  /*
  it("requires a labelled textual BusinessContext status", () => {
    const businessContext = sharedFunction(
      "BusinessContext",
      "readControlValue"
    )

    expect(businessContext).toContain(
      "status?: { label: string; value: string }"
    )
    expect(businessContext).toContain("{status.label}</span>")
    expect(businessContext).toContain("{status.value}</span>")
  })
  */

  // re-enabled as deleted sections are re-admitted to app/design-system/page.tsx
  // (rebuild M1 T7-T9)
  /*
  it("documents production foundations", () => {
    const sections = [
      "Foundations",
      "Typography",
      "Spacing and radius",
      "Elevation and glass",
      "Controls",
      "Status and feedback",
      "Product compositions",
    ]

    for (const section of sections) {
      expect(proof).toContain(`<Section title="${section}">`)
    }
    expect(proof.match(/<Section title=/g)).toHaveLength(7)
  })
  */

  // re-enabled as deleted primitives and shared compositions are re-admitted
  // (rebuild M1 T7-T9)
  /*
  it("builds proof specimens from required shipping components", () => {
    for (const component of [
      "BusinessContext",
      "MetricCard",
      "Stars",
      "StatusBadge",
    ]) {
      expect(proof).toMatch(
        new RegExp(
          `import[\\s\\S]*?\\b${component}\\b[\\s\\S]*?from \\"@/components/naba-presence/shared\\"`
        )
      )
      expect(proof).toContain(`<${component}`)
    }
    for (const component of [
      "Table",
      "TableBody",
      "TableCell",
      "TableHead",
      "TableHeader",
      "TableRow",
    ]) {
      expect(proof).toMatch(
        new RegExp(
          `import[\\s\\S]*?\\b${component}\\b[\\s\\S]*?from \\"@/components/ui/table\\"`
        )
      )
      expect(proof).toContain(`<${component}`)
    }
    for (const component of ["Tooltip", "TooltipContent", "TooltipTrigger"]) {
      expect(proof).toMatch(
        new RegExp(
          `import[\\s\\S]*?\\b${component}\\b[\\s\\S]*?from \\"@/components/ui/tooltip\\"`
        )
      )
      expect(proof).toContain(`<${component}`)
    }
  })
  */
})

describe("rebuild token contract", () => {
  const css = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8"
  )

  it("defines the named type roles", () => {
    for (const role of [
      "--text-caption: 0.6875rem",   // 11px
      "--text-ui: 0.8125rem",        // 13px
      "--text-body: 0.84375rem",     // 13.5px
      "--text-title: 0.9375rem",     // 15px
      "--text-page-title: 1.375rem", // 22px
    ]) {
      expect(css).toContain(role)
    }
  })

  it("has no dead spacing scale", () => {
    expect(css).not.toMatch(/--nr-space-\d/)
  })

  it("defines --info for dark mode", () => {
    const dark = css.slice(css.indexOf(".dark {"))
    expect(dark).toContain("--info:")
    expect(dark).toContain("--info-foreground:")
  })

  it("collapses all animation under prefers-reduced-motion", () => {
    expect(css).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.01ms/
    )
  })
})
