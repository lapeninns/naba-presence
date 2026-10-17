import { describe, expect, it } from "vitest"

import {
  binDailySeries,
  binUnitFor,
  daysInWindow,
  formatBinLabel,
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

describe("formatBinLabel", () => {
  // The server (Node) says "Sept" and WebKit's en-GB data says "Sep": a label
  // that came from the engine's month name failed hydration (#418).
  it("writes September the same way in every engine", () => {
    expect(formatBinLabel("2026-09-19", "day", "UTC")).toBe("19 Sept")
    expect(formatBinLabel("2026-09-01", "month", "UTC")).toBe("Sept 2026")
  })

  it("reads a bare date as a calendar day, whatever the zone", () => {
    // UTC midnight on 5 Oct is still 4 Oct in Los Angeles.
    expect(formatBinLabel("2026-10-05", "day", "America/Los_Angeles")).toBe(
      "5 Oct"
    )
    expect(formatBinLabel("2026-07-01", "month", "America/New_York")).toBe(
      "Jul 2026"
    )
  })

  it("formats a bucket instant on the organisation's clock", () => {
    // Midnight on 5 Oct in Auckland (NZDT) is 11:00 UTC on 4 Oct.
    expect(
      formatBinLabel("2026-10-04T11:00:00.000Z", "day", "Pacific/Auckland")
    ).toBe("5 Oct")
    // Midnight on 1 Jul in London (BST) is 23:00 UTC on 30 Jun.
    expect(
      formatBinLabel("2026-06-30T23:00:00.000Z", "month", "Europe/London")
    ).toBe("Jul 2026")
  })
})
