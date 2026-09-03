import { describe, expect, it } from "vitest"

import {
  normalizeGooglePerformanceResponse,
  normalizeGoogleSearchKeywordResponse,
} from "@/lib/server/google"
import { normalizeGoogleSearchKeywordPage } from "@/lib/server/google/performance"
import { keywordMonths } from "@/lib/server/keywords"
import { performanceDateWindow } from "@/lib/server/performance"

describe("Google Performance", () => {
  it("uses an 18-month initial window and a ten-day restatement window", () => {
    expect(
      performanceDateWindow(new Date("2026-07-31T14:00:00Z"), null)
    ).toEqual({
      startDate: "2025-01-31",
      endDate: "2026-07-31",
    })
    expect(
      performanceDateWindow(new Date("2026-07-31T23:59:00Z"), "2026-07-25")
    ).toEqual({ startDate: "2026-07-22", endDate: "2026-07-31" })
  })

  it("reaches back to the watermark when a location has fallen behind", () => {
    const now = new Date("2026-07-31T14:00:00Z")
    // A 30-day gap must be re-requested in full, not just the last ten days.
    expect(performanceDateWindow(now, "2026-07-01")).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    })
    // A 600-day gap stops at the 18-month floor: Google serves no further
    // back, and retention has already purged it.
    expect(performanceDateWindow(now, "2024-12-08")).toEqual({
      startDate: "2025-01-31",
      endDate: "2026-07-31",
    })
  })

  it("normalises valid points and ignores unknown or malformed values", () => {
    const points = normalizeGooglePerformanceResponse(
      {
        multiDailyMetricTimeSeries: [
          {
            dailyMetricTimeSeries: {
              dailyMetric: "CALL_CLICKS",
              timeSeries: {
                datedValues: [
                  { date: { year: 2026, month: 7, day: 30 }, value: "12" },
                  { date: { year: 2026, month: 7, day: 31 }, value: "-1" },
                ],
              },
            },
          },
          {
            dailyMetricTimeSeries: {
              dailyMetric: "A_FUTURE_GOOGLE_METRIC",
              timeSeries: {
                datedValues: [
                  { date: { year: 2026, month: 7, day: 30 }, value: "99" },
                ],
              },
            },
          },
        ],
      },
      ["CALL_CLICKS"]
    )

    expect(points).toEqual([
      { metric: "CALL_CLICKS", date: "2026-07-30", value: 12 },
    ])
  })

  it("normalises exact and privacy-thresholded search keyword values", () => {
    expect(
      normalizeGoogleSearchKeywordResponse({
        searchKeywordsCounts: [
          {
            searchKeyword: "  Nepalese Food  ",
            insightsValue: { value: "42" },
          },
          {
            searchKeyword: "pub near me",
            insightsValue: { threshold: "15" },
          },
          {
            searchKeyword: "invalid",
            insightsValue: { value: "2", threshold: "5" },
          },
        ],
      })
    ).toEqual([
      { keyword: "nepalese food", impressions: 42, threshold: null },
      { keyword: "pub near me", impressions: null, threshold: 15 },
    ])
  })

  it("distinguishes an empty keyword month from an unrecognised body", () => {
    expect(
      normalizeGoogleSearchKeywordPage({ searchKeywordsCounts: [] })
    ).toEqual({ points: [], sawCountsArray: true, dropped: 0 })
    // A 200 that carries no counts array at all must not read as "this month
    // has no keywords" — restating a month deletes it before inserting.
    expect(normalizeGoogleSearchKeywordPage({ nextPageToken: "" })).toEqual({
      points: [],
      sawCountsArray: false,
      dropped: 0,
    })
    expect(
      normalizeGoogleSearchKeywordPage({
        searchKeywordsCounts: [
          {
            searchKeyword: "invalid",
            insightsValue: { value: "2", threshold: "5" },
          },
        ],
      })
    ).toEqual({ points: [], sawCountsArray: true, dropped: 1 })
  })

  it("backfills eighteen keyword months then restates the latest two", () => {
    const now = new Date("2026-07-31T14:00:00Z")
    const initial = keywordMonths(now, null)
    expect(initial).toHaveLength(18)
    expect(initial[0]).toBe("2025-02")
    expect(initial.at(-1)).toBe("2026-07")
    expect(keywordMonths(now, "2026-07-01")).toEqual(["2026-06", "2026-07"])
  })

  it("reaches back to the keyword watermark after a pause", () => {
    const now = new Date("2026-07-31T14:00:00Z")
    // Three months paused: every missed month is re-requested, plus the
    // stored month as the restatement overlap.
    expect(keywordMonths(now, "2026-03-01")).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
    ])
    // Older than the 18-month floor collapses onto the initial window.
    expect(keywordMonths(now, "2023-01-01")).toEqual(keywordMonths(now, null))
  })
})
