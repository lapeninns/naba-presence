import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const globals = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8"
)
const primitiveSource = ["button", "card", "input", "textarea", "badge", "item"]
  .map((name) =>
    readFileSync(
      new URL(`../components/ui/${name}.tsx`, import.meta.url),
      "utf8"
    )
  )
  .join("\n")
const shared = readFileSync(
  new URL("../components/naba-review/shared.tsx", import.meta.url),
  "utf8"
)
const card = readFileSync(
  new URL("../components/ui/card.tsx", import.meta.url),
  "utf8"
)
const sharedFunction = (name: string, nextName: string) =>
  shared.slice(
    shared.indexOf(`export function ${name}`),
    shared.indexOf(`export function ${nextName}`)
  )
const tokens = [
  "--nr-space-1",
  "--nr-space-14",
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

describe("NabaReview design system", () => {
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
  it("uses purpose-specific tokens in primitives", () => {
    expect(primitiveSource).toContain("--nr-radius-control")
    expect(primitiveSource).toContain("--nr-radius-card")
    expect(primitiveSource).toContain("--nr-radius-field")
    expect(primitiveSource).toContain("--nr-duration-fast")
  })
  it("owns shared product compositions", () => {
    expect(shared).toContain("export function PageFrame")
    expect(shared).toContain("export function PageHeader")
    expect(shared).toContain("export function BusinessContext")
  })
  it("supports all three PageFrame width modes", () => {
    const pageFrame = sharedFunction("PageFrame", "PageHeader")

    expect(pageFrame).toContain('width?: "standard" | "wide" | "workspace"')
    expect(pageFrame).toContain('width === "standard" && "max-w-(--nr-page-max-width)"')
    expect(pageFrame).toContain('width === "wide" && "max-w-7xl"')
    expect(pageFrame).toContain('width === "workspace" && "max-w-none"')
  })
  it("limits the semantic translucent surface to business and metric cards", () => {
    const businessContext = sharedFunction("BusinessContext", "readControlValue")
    const metricCard = sharedFunction("MetricCard", "chartConfig")

    expect(businessContext).toContain("--nr-surface-card-translucent")
    expect(metricCard).toContain("--nr-surface-card-translucent")
    expect(card).toContain("bg-card")
    expect(card).not.toContain("--nr-surface-card-translucent")
  })
  it("requires a labelled textual BusinessContext status", () => {
    const businessContext = sharedFunction("BusinessContext", "readControlValue")

    expect(businessContext).toContain("status?: { label: string; value: string }")
    expect(businessContext).toContain("{status.label}</span>")
    expect(businessContext).toContain("{status.value}</span>")
  })
})
