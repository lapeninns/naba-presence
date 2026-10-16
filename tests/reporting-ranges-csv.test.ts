import { describe, expect, it } from "vitest"

import { csvCell, csvFilename, toCsv } from "@/lib/reporting/csv"
import {
  formatPeriod,
  KEYWORD_RANGES,
  parseRange,
  PRESENCE_RANGES,
  REPLY_RANGES,
  resolvedPeriod,
  periodToWriteOnTabSwitch,
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

  it("falls back to Reply and Google's default, unannounced", () => {
    expect(resolveTabRange("reply", {})).toEqual({ id: "28d", note: null })
    expect(resolveTabRange("google", {})).toEqual({ id: "28d", note: null })
  })

  // A direct landing on Keywords has nothing carried over, so it opens on its
  // own default and says nothing.
  it("opens Keywords on its own default, unannounced, with nothing in the address", () => {
    expect(resolveTabRange("keywords", {})).toEqual({ id: "6m", note: null })
    expect(resolveTabRange("keywords", { range: "nonsense" })).toEqual({
      id: "6m",
      note: null,
    })
  })

  // Picking 90 days and then 28 days again writes ?range=28d (the default
  // is no longer left out), so Keywords maps it and says so rather than
  // reverting to its own default in silence.
  it("carries a default period that was picked again", () => {
    expect(resolveTabRange("keywords", { range: "28d" })).toEqual({
      id: "1m",
      note: "Keywords count whole months: showing the last month.",
    })
  })

  // The same visible Google period must give the same Keywords period and
  // note, whether 28 days is the untouched default or was picked again.
  it("gives Keywords the same period for Google's default however it got there", () => {
    const fresh = periodToWriteOnTabSwitch("google", "keywords", {})
    expect(fresh).toEqual({ name: "range", value: "28d" })
    const viaFresh = resolveTabRange("keywords", { range: fresh!.value })
    const viaClicks = resolveTabRange("keywords", { range: "28d" })
    expect(viaFresh).toEqual(viaClicks)
    expect(viaFresh).toEqual({
      id: "1m",
      note: "Keywords count whole months: showing the last month.",
    })
  })
})

describe("what a tab switch writes (periodToWriteOnTabSwitch)", () => {
  it("writes the visible period when leaving Reply or Google for Keywords with none in the address", () => {
    expect(periodToWriteOnTabSwitch("reply", "keywords", {})).toEqual({
      name: "range",
      value: "28d",
    })
    expect(
      periodToWriteOnTabSwitch("google", "keywords", { range: "nonsense" })
    ).toEqual({ name: "range", value: "28d" })
  })

  it("writes Keywords' own period when leaving it with none in the address", () => {
    expect(periodToWriteOnTabSwitch("keywords", "google", {})).toEqual({
      name: "range_kw",
      value: "6m",
    })
  })

  it("writes nothing when a period is already in the address", () => {
    expect(
      periodToWriteOnTabSwitch("google", "keywords", { range: "90d" })
    ).toBeNull()
    expect(
      periodToWriteOnTabSwitch("keywords", "google", { rangeKw: "12m" })
    ).toBeNull()
    expect(
      periodToWriteOnTabSwitch("google", "keywords", { range: "1m" })
    ).toBeNull()
  })

  it("writes nothing between Reply and Google, which share one period", () => {
    expect(periodToWriteOnTabSwitch("reply", "google", {})).toBeNull()
    expect(periodToWriteOnTabSwitch("google", "reply", {})).toBeNull()
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
    expect(csvFilename("Reply performance by listing", "Last 28 days")).toBe(
      "reply-performance-by-listing-last-28-days.csv"
    )
  })
})
