import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
const tokens = [
  "--nr-space-1", "--nr-space-14", "--nr-sidebar-width",
  "--nr-page-pad-x", "--nr-page-max-width", "--nr-radius-control",
  "--nr-radius-card", "--nr-radius-panel", "--nr-radius-modal",
  "--nr-shadow-card", "--nr-shadow-float", "--nr-shadow-modal",
  "--nr-surface-glass", "--nr-surface-glass-strong",
  "--nr-surface-card-translucent", "--nr-duration-fast",
  "--nr-duration-overlay", "--nr-ease-standard",
]

describe("NabaReview design system", () => {
  it.each(tokens)("defines %s", (token) => expect(globals).toContain(`${token}:`))
  it("provides motion and blur fallbacks", () => {
    expect(globals).toContain("prefers-reduced-motion: reduce")
    expect(globals).toContain("@supports not ((backdrop-filter: blur(1px))")
  })
  it("does not import the prototype runtime", () => {
    expect(globals).not.toContain(".nr-btn")
    expect(globals).not.toContain("injectCss")
  })
})
