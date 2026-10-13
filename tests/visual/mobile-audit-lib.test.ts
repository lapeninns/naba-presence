import { describe, expect, it } from "vitest"

import {
  aggregate,
  checkBudget,
  chromeBudget,
  circleIntersectsRect,
  circlesIntersect,
  compactTotals,
  componentKey,
  DEFAULT_ROUTES,
  evaluateTargetSize,
  focusVerdict,
  parseArgs,
  parseRouteFile,
  parseRouteSpec,
  renderMarkdown,
  resolvePath,
  textStats,
  topOffenders,
  touchTargetFailures,
  unionLength,
} from "./mobile-audit-lib.mjs"

const target = (
  id: number,
  x: number,
  y: number,
  w: number,
  h: number,
  extra = {}
) => ({
  id,
  x,
  y,
  w,
  h,
  inline: false,
  related: [] as number[],
  ...extra,
})

describe("route specs", () => {
  it("parses role prefixes and defaults to owner", () => {
    expect(parseRouteSpec("/inbox")).toEqual({
      label: "/inbox",
      role: "owner",
      path: "/inbox",
    })
    expect(parseRouteSpec("viewer:/inbox")).toEqual({
      label: "viewer:/inbox",
      role: "viewer",
      path: "/inbox",
    })
    expect(() => parseRouteSpec("ghost:/inbox")).toThrow(/Unknown role/)
    expect(() => parseRouteSpec("inbox")).toThrow(/must start/)
  })

  it("reads route files and resolves placeholders", () => {
    expect(
      parseRouteFile("# comment\n/inbox\n\nanon:/sign-in # trailing\n")
    ).toEqual(["/inbox", "anon:/sign-in"])
    const state = {
      primaryLocationId: "L1",
      approvalReview: { locationId: "L2" },
      clientId: "C1",
      directReview: { id: "R1" },
    }
    expect(
      resolvePath("/listings/{loc}/x/{loc2}/{client}?selected={review}", state)
    ).toBe("/listings/L1/x/L2/C1?selected=R1")
  })

  it("covers every main route once", () => {
    expect(new Set(DEFAULT_ROUTES).size).toBe(DEFAULT_ROUTES.length)
    expect(DEFAULT_ROUTES).toContain("viewer:/inbox")
    expect(DEFAULT_ROUTES).toContain("/settings/usage")
    expect(DEFAULT_ROUTES).toContain("/listings/{loc}/changes")
    expect(DEFAULT_ROUTES.map(parseRouteSpec)).toHaveLength(
      DEFAULT_ROUTES.length
    )
  })

  it("parses flags with and without values", () => {
    expect(parseArgs(["--widths", "320,390", "--full", "--out", "x"])).toEqual({
      widths: "320,390",
      full: true,
      out: "x",
    })
  })
})

describe("geometry", () => {
  it("detects circle/rect and circle/circle intersection", () => {
    expect(
      circleIntersectsRect(
        { x: 0, y: 0, r: 12 },
        { x: 11, y: -5, w: 10, h: 10 }
      )
    ).toBe(true)
    expect(
      circleIntersectsRect({ x: 0, y: 0, r: 12 }, { x: 12, y: 0, w: 10, h: 10 })
    ).toBe(false)
    expect(
      circlesIntersect({ x: 0, y: 0, r: 12 }, { x: 23, y: 0, r: 12 })
    ).toBe(true)
    expect(
      circlesIntersect({ x: 0, y: 0, r: 12 }, { x: 24, y: 0, r: 12 })
    ).toBe(false)
  })

  it("measures the union of overlapping intervals", () => {
    expect(
      unionLength(
        [
          [0, 10],
          [5, 20],
          [30, 40],
        ],
        0,
        100
      )
    ).toBe(30)
    expect(
      unionLength(
        [
          [-10, 10],
          [90, 120],
        ],
        0,
        100
      )
    ).toBe(20)
    expect(unionLength([], 0, 100)).toBe(0)
  })
})

describe("WCAG 2.5.8 target size", () => {
  it("passes targets of at least 24x24", () => {
    const result = evaluateTargetSize([
      target(0, 0, 0, 24, 24),
      target(1, 24, 0, 24, 24),
    ])
    expect(result.map((r) => r.status)).toEqual(["pass", "pass"])
  })

  it("applies the spacing exception to isolated undersized targets", () => {
    // Two 16px icons with centres 24px apart: circles just touch, no overlap.
    const result = evaluateTargetSize([
      target(0, 0, 0, 16, 16),
      target(1, 24, 0, 16, 16),
    ])
    expect(result.map((r) => r.status)).toEqual([
      "pass-spacing",
      "pass-spacing",
    ])
  })

  it("fails undersized targets whose circles overlap", () => {
    const result = evaluateTargetSize([
      target(0, 0, 0, 16, 16),
      target(1, 20, 0, 16, 16),
    ])
    expect(result.map((r) => r.status)).toEqual(["fail", "fail"])
    expect(result[0].conflictWith).toBe(1)
  })

  it("fails an undersized target whose circle reaches a large neighbour", () => {
    const result = evaluateTargetSize([
      target(0, 0, 0, 16, 16),
      target(1, 18, -10, 100, 40),
    ])
    expect(result[0].status).toBe("fail")
    expect(result[1].status).toBe("pass")
  })

  it("exempts inline links and nested targets", () => {
    const result = evaluateTargetSize([
      target(0, 0, 0, 40, 14, { inline: true }),
      target(1, 0, 20, 200, 60, { related: [2] }),
      target(2, 10, 30, 16, 16, { related: [1] }),
    ])
    expect(result.map((r) => r.status)).toEqual([
      "exempt-inline",
      "pass",
      "pass-spacing",
    ])
  })

  it("flags project touch targets below 44px but not inline links", () => {
    const failures = touchTargetFailures([
      target(0, 0, 0, 44, 44),
      target(1, 0, 0, 120, 36),
      target(2, 0, 0, 30, 14, { inline: true }),
    ])
    expect(failures.map((f) => f.id)).toEqual([1])
  })
})

describe("chrome budget", () => {
  it("sums top and bottom chrome and ignores full-height boxes", () => {
    const result = chromeBudget(
      [
        { top: 0, bottom: 56 },
        { top: 40, bottom: 96 }, // overlaps the header
        { top: 780, bottom: 844 },
        { top: 0, bottom: 844 }, // sidebar/overlay
        { top: 900, bottom: 960 }, // below the viewport
      ],
      844
    )
    expect(result).toMatchObject({
      topPx: 96,
      bottomPx: 64,
      totalPx: 160,
      totalPct: 19,
    })
  })
})

describe("text stats", () => {
  it("computes smallest size and small-text shares", () => {
    expect(textStats({ "10.5": 2, "12": 3, "13": 1, "16": 4 })).toEqual({
      nodes: 10,
      smallest: 10.5,
      under12: 2,
      under14: 6,
      under12Pct: 20,
      under14Pct: 60,
    })
    expect(textStats({}).smallest).toBeNull()
  })
})

describe("focus verdict", () => {
  it("is obscured only when every sample is covered", () => {
    expect(
      focusVerdict([{ obscuredBy: "header" }, { obscuredBy: "header" }])
    ).toEqual({
      obscured: true,
      offscreen: false,
      by: "header",
    })
    expect(
      focusVerdict([{ obscuredBy: "header" }, { obscuredBy: null }]).obscured
    ).toBe(false)
    expect(focusVerdict([])).toMatchObject({ obscured: false, offscreen: true })
  })
})

describe("aggregation and budgets", () => {
  const phone = {
    route: "/inbox",
    width: 390,
    theme: "light",
    overflow: {
      overflowPx: 12,
      offenders: [{ tag: "div", slot: "card", slotDepth: 0 }],
    },
    clipped: [],
    targetSize: [{ tag: "button", slot: "button", slotDepth: 0, w: 16, h: 16 }],
    touchTargets: [
      { tag: "button", slot: "button", slotDepth: 0, w: 32, h: 32 },
      { tag: "svg", slot: "button", slotDepth: 1, w: 32, h: 32 },
    ],
    iosZoom: [{ tag: "input", slot: "input", slotDepth: 0, fontSize: 14 }],
    text: { under12: 3, under14: 5, smallest: 11 },
    axe: [
      {
        id: "color-contrast",
        impact: "serious",
        help: "",
        nodes: 4,
        targets: [],
      },
      { id: "label", impact: "critical", help: "", nodes: 1, targets: [] },
    ],
    focus: {
      obscured: [
        { element: { tag: "a", slot: "nav-link", slotDepth: 0 }, by: "header" },
      ],
    },
    chrome: { load: { totalPct: 30 } },
    landmarks: { main: 1, h1: 2, skipLink: true },
    consoleErrors: ["x"],
    pageErrors: [],
  }
  const desktop = { ...phone, width: 1280, chrome: { load: { totalPct: 60 } } }
  const failed = {
    route: "/team",
    width: 390,
    theme: "light",
    error: "timeout",
  }

  it("counts touch-only metrics on phones only", () => {
    const summary = aggregate([phone, desktop, failed])
    expect(summary.totals).toMatchObject({
      pages: 3,
      loadErrors: 1,
      horizontalOverflow: 2,
      targetSize: 2,
      touchTargetBelow44: 2,
      iosZoomInputs: 1,
      textUnder12: 6,
      textUnder14Phone: 5,
      axeViolations: 4,
      axeNodes: 10,
      axeCritical: 2,
      axeSerious: 8,
      focusObscured: 2,
      chromeOver25Pct: 1,
      h1Not1: 2,
      consoleErrors: 2,
    })
    expect(summary.extremes).toEqual({
      phoneChromeMaxPct: 30,
      smallestTextPx: 11,
      maxOverflowPx: 12,
    })
    expect(Object.keys(summary.perRoute)).toEqual(["/inbox", "/team"])
    expect(summary.perRoute["/team"].loadErrors).toBe(1)
  })

  it("groups offenders by component key", () => {
    expect(componentKey({ tag: "button", slot: "button", slotDepth: 0 })).toBe(
      "[data-slot=button]"
    )
    expect(componentKey({ tag: "svg", slot: "button", slotDepth: 2 })).toBe(
      "svg in [data-slot=button]"
    )
    expect(componentKey({ tag: "a", role: "tab", cls: "a b c d" })).toBe(
      "a[role=tab].a.b.c"
    )
    const rows = topOffenders([phone, desktop], "touchTargetBelow44")
    expect(rows.map((row) => [row.key, row.count])).toEqual([
      ["[data-slot=button]", 1],
      ["svg in [data-slot=button]", 1],
    ])
  })

  it("reports exceeded budgets globally and per route", () => {
    const summary = aggregate([phone, desktop])
    expect(
      checkBudget(summary, {
        global: { axeNodes: 10, focusObscured: 1, phoneChromeMaxPct: 25 },
        routes: { "/inbox": { iosZoomInputs: 0 }, "/missing": { axeNodes: 0 } },
      })
    ).toEqual([
      { scope: "global", metric: "focusObscured", value: 2, max: 1 },
      { scope: "global", metric: "phoneChromeMaxPct", value: 30, max: 25 },
      { scope: "/inbox", metric: "iosZoomInputs", value: 1, max: 0 },
    ])
  })

  it("renders markdown and compact totals deterministically", () => {
    const summary = aggregate([phone, failed])
    const config = {
      base: "http://localhost:3200",
      widths: [390],
      themes: ["light"],
      routes: ["/inbox", "/team"],
      durationS: 1,
    }
    const markdown = renderMarkdown({ summary, pages: [phone, failed], config })
    expect(markdown).toContain("| /inbox |")
    expect(markdown).toContain("## Load errors")
    const compact = compactTotals(summary, config)
    expect(Object.keys(compact.totals)).toEqual(
      [...Object.keys(compact.totals)].sort()
    )
    expect(JSON.stringify(compactTotals(summary, config))).toBe(
      JSON.stringify(compact)
    )
  })
})
