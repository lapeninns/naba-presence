import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const globals = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8"
)

// Rebuild M1 T7/T8: scoped to the batch-1/batch-2 primitives re-admitted so
// far. Extend with "textarea"/"native-select" once they land (rebuild M1
// T9+).
const primitiveSource = [
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
  .map((name) =>
    readFileSync(
      new URL(`../components/ui/${name}.tsx`, import.meta.url),
      "utf8"
    )
  )
  .join("\n")

// PageFrame lives here, not components/naba-presence/shared.tsx (rebuild M1
// T9 deliberately did not re-admit that file) - see "supports all three
// PageFrame width modes" below.
const pageFrame = readFileSync(
  new URL("../components/app-shell/page-frame.tsx", import.meta.url),
  "utf8"
)

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

  it("uses purpose-specific tokens in primitives", () => {
    expect(primitiveSource).toContain("--nr-radius-control")
    expect(primitiveSource).toContain("--nr-radius-card")
    expect(primitiveSource).toContain("--nr-duration-fast")
    expect(primitiveSource).toContain("--nr-radius-field")
  })

  it("re-admitted overlays use modal tokens, not hard-coded durations", () => {
    // dialog.tsx/sheet.tsx/toast.tsx (rebuild M1 T8): every duration-NNN
    // Tailwind utility the old (git history) files hard-coded is replaced by
    // an --nr-* token — guards against a future re-admission regressing back
    // to e.g. `duration-100` or `shadow-xl`.
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
