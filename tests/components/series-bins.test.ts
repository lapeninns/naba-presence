import { describe, expect, it } from "vitest"

import {
  binDailySeries,
  binUnitFor,
  daysInWindow,
} from "@/lib/reporting/series-bins"

const KEYS = { calls: ["CALL_CLICKS"] } as const

describe("binDailySeries", () => {
  it("lays out every day of the report window, unreported days as null", () => {
    const bins = binDailySeries(
      [{ date: "2026-09-03", metrics: { CALL_CLICKS: 4 } }],
      KEYS,
      "day",
      { from: "2026-09-01", to: "2026-09-04" }
    )
    expect(bins.map((bin) => bin.start)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
    ])
    expect(bins.map((bin) => bin.values.calls)).toEqual([null, null, 4, null])
  })

  it("sums reported days into weeks starting on Monday", () => {
    const bins = binDailySeries(
      [
        { date: "2026-09-07", metrics: { CALL_CLICKS: 1 } },
        { date: "2026-09-13", metrics: { CALL_CLICKS: 2 } },
        { date: "2026-09-14", metrics: { CALL_CLICKS: 5 } },
      ],
      KEYS,
      "week",
      { from: "2026-09-07", to: "2026-09-27" }
    )
    expect(bins.map((bin) => [bin.start, bin.values.calls])).toEqual([
      ["2026-09-07", 3],
      ["2026-09-14", 5],
      ["2026-09-21", null],
    ])
  })

  it("picks the bar unit from the window length", () => {
    expect(binUnitFor(daysInWindow("2026-08-27", "2026-09-23").length)).toBe(
      "day"
    )
    expect(binUnitFor(90)).toBe("week")
    expect(binUnitFor(365)).toBe("month")
  })
})
