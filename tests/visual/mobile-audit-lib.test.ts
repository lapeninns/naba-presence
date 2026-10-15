import { describe, expect, it } from "vitest"

import {
  aggregate,
  checkBudget,
  chromeBudget,
  circleIntersectsRect,
  circlesIntersect,
  compactTotals,
  componentKey,
  cssLength,
  DEFAULT_ROUTES,
  effectiveHitArea,
  evaluateTargetSize,
  focusVerdict,
  parseArgs,
  parseRouteFile,
  parseRouteSpec,
  renderMarkdown,
  resolvePath,
  textStats,
  topOffenders,
  touchBoxFailures,
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

describe("effective hit area (MEA-01)", () => {
  type Box = { left: number; top: number; right: number; bottom: number }
  const pad = (x: number, y: number, w: number, h: number): Box => ({
    left: x,
    top: y,
    right: x + w,
    bottom: y + h,
  })
  // A pseudo-element as the probe records it: resolved offsets, the
  // containing block's padding box and the clipping ancestors.
  const part = (
    block: Box,
    offsets: Partial<
      Record<"left" | "top" | "right" | "bottom" | "width" | "height", string>
    >,
    clips: (Box & { x: boolean; y: boolean })[] = []
  ) => ({
    left: "auto",
    top: "auto",
    right: "auto",
    bottom: "auto",
    width: "auto",
    height: "auto",
    ...offsets,
    block,
    clips,
  })
  const sized = (t: { w: number; h: number }) => [t.w, t.h]

  it("extends an sm button vertically to 44px but keeps its width", () => {
    // `after:inset-x-0 after:inset-y-[calc((100%-44px)/2)]` on a 151x32 box.
    const button = target(0, 10, 100, 151, 32, {
      hit: [
        part(pad(10, 100, 151, 32), {
          left: "0px",
          right: "0px",
          top: "-6px",
          bottom: "-6px",
          width: "151px",
          height: "44px",
        }),
      ],
    })
    const effective = effectiveHitArea(button)
    expect(sized(effective)).toEqual([151, 44])
    expect(effective.y).toBe(94)
    expect(effective.box).toEqual({ x: 10, y: 100, w: 151, h: 32 })
    expect(effective).not.toHaveProperty("hit")
    expect(touchTargetFailures([effective])).toEqual([])
    expect(touchBoxFailures([effective]).map((f) => f.id)).toEqual([0])
  })

  it("extends a switch and a checkbox to 44x44", () => {
    // Switch: `before:-inset-x-1 before:inset-y-[calc((100%-44px)/2)]`.
    const toggle = target(0, 300, 200, 36, 20, {
      hit: [
        part(pad(300, 200, 36, 20), {
          left: "-4px",
          right: "-4px",
          top: "-12px",
          bottom: "-12px",
          width: "44px",
          height: "44px",
        }),
      ],
    })
    // Checkbox: `after:inset-[calc((100%-44px)/2)]` on a 20px box, with
    // only start offsets and sizes resolved.
    const checkbox = target(1, 20, 400, 20, 20, {
      hit: [
        part(pad(20, 400, 20, 20), {
          left: "-12px",
          top: "-12px",
          width: "44px",
          height: "44px",
        }),
      ],
    })
    const effective = [toggle, checkbox].map(effectiveHitArea)
    expect(effective.map(sized)).toEqual([
      [44, 44],
      [44, 44],
    ])
    expect(touchTargetFailures(effective)).toEqual([])
    expect(touchBoxFailures(effective).map((f) => f.id)).toEqual([0, 1])
  })

  it("still fails a genuinely small target and a narrow extended one", () => {
    const icon = target(0, 0, 0, 20, 20)
    // A chip only extends vertically, so a 30px-wide one stays too narrow.
    const chip = target(1, 50, 0, 30, 32, {
      hit: [
        part(pad(50, 0, 30, 32), {
          left: "0px",
          right: "0px",
          top: "-6px",
          bottom: "-6px",
        }),
      ],
    })
    const effective = [icon, chip].map(effectiveHitArea)
    expect(effective.map(sized)).toEqual([
      [20, 20],
      [30, 44],
    ])
    expect(touchTargetFailures(effective).map((f) => f.id)).toEqual([0, 1])
  })

  it("clips the extension to an ancestor that hides overflow", () => {
    // A chip in a 36px-tall horizontal scroller: the scroller clips the
    // vertical extension back to the drawn box.
    const chip = target(0, 100, 102, 80, 32, {
      hit: [
        part(
          pad(100, 102, 80, 32),
          { left: "0px", right: "0px", top: "-6px", bottom: "-6px" },
          [{ ...pad(0, 100, 390, 36), x: true, y: true }]
        ),
      ],
    })
    const effective = effectiveHitArea(chip)
    expect(sized(effective)).toEqual([80, 36])
    expect(effective.y).toBe(100)
    // Never smaller than the drawn box: only the extension is clipped.
    const clippedAway = effectiveHitArea(
      target(1, 500, 102, 80, 32, {
        hit: [
          part(
            pad(500, 102, 80, 32),
            { left: "0px", right: "0px", top: "-6px", bottom: "-6px" },
            [{ ...pad(0, 100, 390, 36), x: true, y: true }]
          ),
        ],
      })
    )
    expect(sized(clippedAway)).toEqual([80, 32])
  })

  it("treats a stretched card link's card as its target", () => {
    // `after:absolute after:inset-0` with the card as containing block.
    const link = target(0, 32, 40, 20, 20, {
      hit: [
        part(pad(16, 16, 358, 120), {
          left: "0px",
          top: "0px",
          right: "0px",
          bottom: "0px",
        }),
      ],
    })
    const effective = effectiveHitArea(link)
    expect([effective.x, effective.y, effective.w, effective.h]).toEqual([
      16, 16, 358, 120,
    ])
    expect(touchTargetFailures([effective])).toEqual([])
  })

  it("resolves percentage and calc() insets against the containing block", () => {
    expect(cssLength("12px", 100)).toBe(12)
    expect(cssLength("-4.5px", 100)).toBe(-4.5)
    expect(cssLength("50%", 20)).toBe(10)
    expect(cssLength("calc(50% - 22px)", 20)).toBe(-12)
    expect(cssLength("calc(50% + 2px)", 20)).toBe(12)
    expect(cssLength("auto", 20)).toBeNull()
    // A switch whose vertical insets Chrome left as calc(50% - 22px).
    const toggle = target(0, 0, 100, 36, 20, {
      hit: [
        part(pad(0, 100, 36, 20), {
          left: "-4px",
          right: "-4px",
          top: "calc(50% - 22px)",
          bottom: "calc(50% - 22px)",
        }),
      ],
    })
    expect(sized(effectiveHitArea(toggle))).toEqual([44, 44])
  })

  it("ignores offsets it can't resolve", () => {
    const button = target(0, 0, 0, 32, 32, {
      hit: [part(pad(0, 0, 32, 32), { left: "min(1px, 2%)", top: "-6px" })],
    })
    expect(sized(effectiveHitArea(button))).toEqual([32, 32])
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
    touchBoxes: [
      { tag: "button", slot: "button", slotDepth: 0, w: 32, h: 32 },
      { tag: "svg", slot: "button", slotDepth: 1, w: 32, h: 32 },
      {
        tag: "button",
        slot: "switch",
        slotDepth: 0,
        w: 44,
        h: 44,
        box: { x: 0, y: 0, w: 36, h: 20 },
      },
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
      touchBoxBelow44: 3,
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
