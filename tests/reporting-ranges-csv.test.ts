import { describe, expect, it } from "vitest"

import { csvCell, csvFilename, toCsv } from "@/lib/reporting/csv"
import {
  formatPeriod,
  KEYWORD_RANGES,
  parseRange,
  PRESENCE_RANGES,
  REPLY_RANGES,
  resolvedPeriod,
  resolveTabRange,
} from "@/lib/reporting/ranges"

describe("report periods", () => {
  it("offers Reply and Google the same periods", () => {
    // Switching between the two tabs keeps the period on screen.
    expect(REPLY_RANGES.map((range) => range.id)).toEqual(
      PRESENCE_RANGES.map((range) => range.id)
    )
  })

  it("keeps a shared period across tabs and defaults the rest", () => {
    expect(parseRange("keywords", "12m")).toBe("12m")
    expect(parseRange("reply", "12m")).toBe("12m")
    expect(parseRange("keywords", "28d")).toBe("6m")
    expect(parseRange("google", "6m")).toBe("28d")
    expect(parseRange("reply", null)).toBe("28d")
  })

  it("resolves each period to the dates its endpoint uses", () => {
    const now = new Date("2026-09-24T15:00:00.000Z")
    expect(resolvedPeriod("google", "28d", now)).toEqual({
      from: "2026-08-28T00:00:00.000Z",
      to: "2026-09-24T00:00:00.000Z",
    })
    expect(resolvedPeriod("keywords", "6m", now).from).toBe(
      "2026-04-01T00:00:00.000Z"
    )
    expect(formatPeriod(resolvedPeriod("google", "28d", now), "UTC")).toMatch(
      /Aug – .*Sep/
    )
    expect(KEYWORD_RANGES.map((range) => range.id)).toContain("12m")
  })

  it("never throws on a date it cannot read", () => {
    expect(formatPeriod({ from: "a", to: "b" }, "UTC")).toBe("")
  })
})

describe("a tab's period (resolveTabRange)", () => {
  it("shows each tab's own choice and says nothing", () => {
    expect(resolveTabRange("google", { range: "90d" })).toEqual({
      id: "90d",
      note: null,
    })
    expect(resolveTabRange("keywords", { rangeKw: "1m" })).toEqual({
      id: "1m",
      note: null,
    })
    // Keywords' own choice wins over Google's, and neither changes the other.
    expect(
      resolveTabRange("keywords", { range: "28d", rangeKw: "12m" })
    ).toEqual({ id: "12m", note: null })
    expect(resolveTabRange("reply", { range: "28d", rangeKw: "12m" })).toEqual({
      id: "28d",
      note: null,
    })
  })

  it("shares 12 and 18 months between the tabs without a note", () => {
    expect(resolveTabRange("keywords", { range: "12m" })).toEqual({
      id: "12m",
      note: null,
    })
    expect(resolveTabRange("google", { rangeKw: "18m" })).toEqual({
      id: "18m",
      note: null,
    })
  })

  it("carries days to the nearest whole months and says so", () => {
    expect(resolveTabRange("keywords", { range: "28d" })).toEqual({
      id: "1m",
      note: "Keywords count whole months: showing the last month.",
    })
    expect(resolveTabRange("keywords", { range: "90d" })).toEqual({
      id: "6m",
      note: "Keywords count whole months: showing the last 6 months.",
    })
  })

  it("carries months back to the nearest days and says so", () => {
    expect(resolveTabRange("google", { rangeKw: "1m" })).toEqual({
      id: "28d",
      note: "This tab counts in days: showing the last 28 days.",
    })
    expect(resolveTabRange("reply", { rangeKw: "6m" })).toEqual({
      id: "90d",
      note: "This tab counts in days: showing the last 90 days.",
    })
  })

  it("opens an older link that put a month period in ?range=", () => {
    expect(resolveTabRange("keywords", { range: "6m" })).toEqual({
      id: "6m",
      note: null,
    })
  })

  it("falls back to each tab's default, unannounced", () => {
    expect(resolveTabRange("reply", {})).toEqual({ id: "28d", note: null })
    expect(resolveTabRange("keywords", { range: "nonsense" })).toEqual({
      id: "6m",
      note: null,
    })
  })
})

describe("csv", () => {
  it("quotes text, keeps numbers bare and leaves missing figures empty", () => {
    expect(
      toCsv([
        ["Location", "Rate"],
        ['The "Crown"', 0.5],
        ["Bell", null],
      ])
    ).toBe('"Location","Rate"\r\n"The ""Crown""",0.5\r\n"Bell",')
  })

  it("defuses text a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`)
    expect(csvCell(-3)).toBe("-3")
  })

  it("names files plainly", () => {
    expect(csvFilename("Reply performance by location", "Last 28 days")).toBe(
      "reply-performance-by-location-last-28-days.csv"
    )
  })
})
