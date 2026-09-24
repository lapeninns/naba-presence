import { describe, expect, it } from "vitest"

import { formatKeywordImpressions } from "@/lib/reporting/keyword-impressions"
import { IMPRESSION_METRICS, metricLabel, ORDERED_METRICS } from "@/lib/reporting/metric-labels"
import { resolveReplyRange } from "@/lib/reporting/ranges"
import { canTriggerSync } from "@/lib/reporting/sync-permission"
import { humaniseUnavailableReasons } from "@/lib/reporting/unavailable-reasons"

describe("metricLabel", () => {
  it("humanises every one of the 11 metrics and never returns the raw enum", () => {
    expect(ORDERED_METRICS).toHaveLength(11)
    for (const metric of ORDERED_METRICS) {
      const label = metricLabel(metric)
      expect(label).not.toContain("_")
      expect(label).not.toBe(metric)
      expect(label.length).toBeGreaterThan(0)
    }
    expect(metricLabel("CALL_CLICKS")).toBe("Calls")
    expect(metricLabel("WEBSITE_CLICKS")).toBe("Website clicks")
    expect(IMPRESSION_METRICS).toHaveLength(4)
  })
})

describe("humaniseUnavailableReasons", () => {
  it("maps known codes, dedupes, and never leaks a raw code", () => {
    const out = humaniseUnavailableReasons([
      "google_rate_limited",
      "google_rate_limited",
      "performance_sync_failed",
      "some_unmapped_future_code",
    ])
    expect(out).toHaveLength(3) // rate-limited deduped
    expect(out.join(" ")).not.toMatch(/google_rate_limited|performance_sync_failed|some_unmapped_future_code/)
    expect(out.some((line) => /rate|busy|again/i.test(line))).toBe(true)
    expect(out.some((line) => /could not|couldn.t|unavailable|try again/i.test(line))).toBe(true)
  })
  it("returns [] for no codes", () => {
    expect(humaniseUnavailableReasons([])).toEqual([])
  })
})

describe("formatKeywordImpressions honesty", () => {
  it("shows an exact count when not thresholded", () => {
    expect(formatKeywordImpressions({ impressions: 1234, upperBound: 1234, thresholded: false })).toBe("1,234")
  })
  it("shows a lower-bounded '+' when Google gave a range", () => {
    expect(formatKeywordImpressions({ impressions: 1000, upperBound: 9999, thresholded: true })).toBe("1,000+")
  })
})

describe("resolveReplyRange", () => {
  it("produces adjacent, equal-length current + previous windows", () => {
    const now = new Date("2026-08-02T00:00:00.000Z")
    const { current, previous } = resolveReplyRange("28d", now)
    expect(current.granularity).toBe("day")
    expect(new Date(current.to).getTime()).toBeGreaterThan(new Date(current.from).getTime())
    // previous window ends exactly where the current window begins.
    expect(new Date(previous.to).getTime()).toBe(new Date(current.from).getTime())
    const currentLen = new Date(current.to).getTime() - new Date(current.from).getTime()
    const previousLen = new Date(previous.to).getTime() - new Date(previous.from).getTime()
    expect(previousLen).toBe(currentLen)
  })
})

describe("canTriggerSync", () => {
  it("is true only for owner and admin", () => {
    expect(canTriggerSync("owner")).toBe(true)
    expect(canTriggerSync("admin")).toBe(true)
    expect(canTriggerSync("member")).toBe(false)
    expect(canTriggerSync("viewer")).toBe(false)
    expect(canTriggerSync(null)).toBe(false)
    expect(canTriggerSync(undefined)).toBe(false)
  })
})
