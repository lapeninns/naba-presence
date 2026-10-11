import { describe, expect, it } from "vitest"

import {
  keywordsResponseSchema,
  presenceResponseSchema,
} from "@/lib/contracts/analytics"
import { GOOGLE_PERFORMANCE_METRICS } from "@/lib/domain/google-contract"
import {
  summariseReportCoverage,
  totalsForCoverage,
} from "@/lib/domain/report-coverage"

const LOCATIONS = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Bravo" },
  { id: "c", name: "Charlie" },
]

describe("summariseReportCoverage", () => {
  it("counts expected vs covered, names the missing and takes the oldest watermark", () => {
    const summary = summariseReportCoverage(LOCATIONS, [
      { locationId: "a", status: "succeeded", watermark: "2026-10-08" },
      { locationId: "b", status: "succeeded", watermark: "2026-10-03" },
    ])
    expect(summary).toEqual({
      state: "partial",
      expected: 3,
      covered: 2,
      completeThrough: "2026-10-03",
      missing: [{ id: "c", name: "Charlie", reason: "pending" }],
      refreshFailed: [],
    })
  })

  it("is complete only when every location is covered and refreshed", () => {
    const summary = summariseReportCoverage(LOCATIONS.slice(0, 2), [
      { locationId: "a", status: "succeeded", watermark: "2026-10-08" },
      { locationId: "b", status: "running", watermark: "2026-10-07" },
    ])
    expect(summary.state).toBe("complete")
    expect(summary.completeThrough).toBe("2026-10-07")
  })

  it("keeps a failed location's older watermark and marks the report partial", () => {
    const summary = summariseReportCoverage(LOCATIONS.slice(0, 2), [
      { locationId: "a", status: "succeeded", watermark: "2026-10-08" },
      { locationId: "b", status: "failed", watermark: "2026-09-20" },
    ])
    expect(summary).toMatchObject({
      state: "partial",
      covered: 2,
      missing: [],
      completeThrough: "2026-09-20",
      refreshFailed: [{ id: "b", name: "Bravo" }],
    })
  })

  it("names why each location is missing", () => {
    const summary = summariseReportCoverage(LOCATIONS, [
      { locationId: "a", status: "failed", watermark: null },
      { locationId: "b", status: "succeeded", watermark: null },
    ])
    expect(summary.state).toBe("none")
    expect(summary.completeThrough).toBeNull()
    expect(summary.missing).toEqual([
      { id: "a", name: "Alpha", reason: "unavailable" },
      { id: "b", name: "Bravo", reason: "no_data" },
      { id: "c", name: "Charlie", reason: "pending" },
    ])
  })

  it("falls back to the newest stored date when a checkpoint has no watermark", () => {
    const summary = summariseReportCoverage(
      LOCATIONS.slice(0, 1),
      [{ locationId: "a", status: "succeeded", watermark: null }],
      new Map([["a", "2026-10-01"]])
    )
    expect(summary).toMatchObject({
      state: "complete",
      covered: 1,
      completeThrough: "2026-10-01",
    })
  })

  it("leaves every total missing, never zero, when no location is covered", () => {
    const none = summariseReportCoverage(LOCATIONS, [])
    expect(
      totalsForCoverage({ CALL_CLICKS: 0, WEBSITE_CLICKS: 4 }, none)
    ).toEqual({
      CALL_CLICKS: null,
      WEBSITE_CLICKS: null,
    })
    const some = summariseReportCoverage(LOCATIONS, [
      { locationId: "a", status: "succeeded", watermark: "2026-10-01" },
    ])
    expect(totalsForCoverage({ CALL_CLICKS: 0 }, some)).toEqual({
      CALL_CLICKS: 0,
    })
  })
})

describe("completeness on the wire", () => {
  it("parses a response from a server that predates it as null", () => {
    const presence = presenceResponseSchema.parse({
      range: "28d",
      from: "2026-09-13",
      to: "2026-10-10",
      state: "ready",
      freshThrough: "2026-10-08",
      locations: [],
      totals: Object.fromEntries(
        GOOGLE_PERFORMANCE_METRICS.map((metric) => [metric, null])
      ),
      series: [],
      unavailableReasons: [],
      keywordsEnabled: false,
      ingestionEnabled: true,
    })
    expect(presence.completeness).toBeNull()
    const keywords = keywordsResponseSchema.parse({
      range: "6m",
      from: "2026-05-01",
      state: "ready",
      locations: [],
      keywords: [],
      unavailableReasons: [],
    })
    expect(keywords.completeness).toBeNull()
  })
})
