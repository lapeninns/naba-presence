import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { auditTokens, CONTRAST_PAIRS } from "@/lib/design/contrast-pairs"
import {
  composite,
  contrastRatio,
  isOutOfGamut,
  nearestPassingLightness,
  oklchToRgb,
  parseColor,
} from "@/lib/design/contrast"
import { parseTokens, resolveToken } from "@/lib/design/tokens"

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
const parsed = parseTokens(css)
const report = auditTokens(parsed)

// The same measurement `pnpm check:contrast` runs, wired into `pnpm test` so a
// bad colour fails before the browser suite ever starts.
describe("design token contrast", () => {
  it("resolves every token the manifest names, in both themes", () => {
    expect(report.issues).toEqual([])
  })

  it.each(
    report.results.map((result) => [
      `${result.theme}: ${result.pair.fg} on ${result.pair.bg}`,
      result,
    ] as const)
  )("%s clears its target", (_label, result) => {
    expect({
      ratio: result.ratio,
      target: result.minimum,
      note: result.pair.note,
    }).toEqual({
      ratio: expect.any(Number),
      target: result.minimum,
      note: result.pair.note,
    })
    expect(result.ratio).toBeGreaterThanOrEqual(result.minimum)
  })

  it("specifies every measured colour inside sRGB", () => {
    // A colour outside the gamut is silently clamped by the browser, so the
    // value in the file stops being the value on screen.
    const clamped = report.results.filter((result) => result.outOfGamut)
    expect(clamped.map((result) => `${result.theme}: ${result.pair.fg}/${result.pair.bg}`)).toEqual([])
  })

  it("measures both themes", () => {
    expect(report.results.filter((r) => r.theme === "light")).toHaveLength(CONTRAST_PAIRS.length)
    expect(report.results.filter((r) => r.theme === "dark")).toHaveLength(CONTRAST_PAIRS.length)
  })
})

describe("contrast maths", () => {
  it("matches known WCAG ratios", () => {
    const white = parseColor("#ffffff")!
    const black = parseColor("#000000")!
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5)
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
    // #767676 is the canonical "smallest grey that passes AA on white".
    expect(contrastRatio(parseColor("#767676")!, white)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(parseColor("#777777")!, white)).toBeLessThan(4.54)
  })

  it("round-trips oklch through sRGB", () => {
    // oklch(1 0 0) is white and oklch(0 0 0) is black by definition.
    expect(contrastRatio(oklchToRgb(0, 0, 0), oklchToRgb(1, 0, 0))).toBeCloseTo(21, 4)
  })

  it("parses the syntaxes the token file uses", () => {
    expect(parseColor("oklch(0.5 0.1 200)")).toMatchObject({ a: 1 })
    expect(parseColor("oklch(0.5 0.1 200 / 50%)")).toMatchObject({ a: 0.5 })
    expect(parseColor("#abc")).toEqual(parseColor("#aabbcc"))
    expect(parseColor("white")).toEqual({ r: 1, g: 1, b: 1, a: 1 })
    expect(parseColor("rgb(1 2 3)")).toBeNull()
  })

  it("composites a translucent foreground before measuring", () => {
    const half = { r: 0, g: 0, b: 0, a: 0.5 }
    const onWhite = composite(half, { r: 1, g: 1, b: 1, a: 1 })
    expect(onWhite).toMatchObject({ r: 0.5, g: 0.5, b: 0.5, a: 1 })
    // A 50% black rule on white must measure as mid-grey, not as black.
    expect(contrastRatio(half, { r: 1, g: 1, b: 1, a: 1 })).toBeLessThan(21)
  })

  it("flags colours outside sRGB", () => {
    expect(isOutOfGamut(0.6, 0.4, 150)).toBe(true)
    expect(isOutOfGamut(0.6, 0.05, 150)).toBe(false)
  })

  it("hints a lightness that actually passes", () => {
    const white = parseColor("#ffffff")!
    const failing = { l: 0.85, c: 0.1, h: 80 }
    const hint = nearestPassingLightness(failing, white, 4.5)
    expect(hint).not.toBeNull()
    expect(contrastRatio(oklchToRgb(hint!, failing.c, failing.h), white)).toBeGreaterThanOrEqual(4.5)
  })
})

describe("token file structure", () => {
  it("keeps every legacy --nr-* name resolvable", () => {
    // Screens still on the old names must render identically until the B6
    // codemod; an alias that stops resolving is a silent visual regression.
    const legacy = Object.keys(parsed.light).filter((name) => name.startsWith("--nr-"))
    expect(legacy.length).toBeGreaterThan(20)
    for (const name of legacy) {
      expect(() => resolveToken(parsed.light, name, "light")).not.toThrow()
      expect(() => resolveToken(parsed.dark, name, "dark")).not.toThrow()
    }
  })

  it("refuses color-mix in a role the gate has to measure", () => {
    const mixed = Object.entries(parsed.light)
      .filter(([name, value]) => name.startsWith("--np-") && /color-mix/i.test(value))
      .map(([name]) => name)
    expect(mixed).toEqual([])
  })
})
