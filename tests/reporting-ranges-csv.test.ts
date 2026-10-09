import { describe, expect, it } from "vitest"

import { csvCell, csvFilename, toCsv } from "@/lib/reporting/csv"
import {
  formatPeriod,
  KEYWORD_RANGES,
  parseRange,
  PRESENCE_RANGES,
  REPLY_RANGES,
  resolvedPeriod,
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
