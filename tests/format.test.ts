import { describe, expect, it, vi, afterEach } from "vitest"

import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/format"

afterEach(() => vi.useRealTimers())

describe("formatDateTime", () => {
  it("omits the year for the current year, in the org timezone", () => {
    vi.useFakeTimers({ now: new Date("2026-07-31T12:00:00Z") })
    expect(formatDateTime("2026-07-29T18:27:00Z", "Europe/London")).toBe(
      "29 Jul, 19:27"
    )
  })
  it("includes the year for other years", () => {
    vi.useFakeTimers({ now: new Date("2026-07-31T12:00:00Z") })
    expect(formatDateTime("2025-09-04T20:25:00Z", "Europe/London")).toBe(
      "4 Sept 2025, 21:25"
    )
  })
  it("respects non-UK zones", () => {
    vi.useFakeTimers({ now: new Date("2026-07-31T12:00:00Z") })
    expect(formatDateTime("2026-01-15T23:30:00Z", "Australia/Sydney")).toBe(
      "16 Jan, 10:30"
    )
  })
})

describe("formatDate", () => {
  it("matches formatDateTime's date part", () => {
    vi.useFakeTimers({ now: new Date("2026-07-31T12:00:00Z") })
    expect(formatDate("2025-09-04T20:25:00Z", "Europe/London")).toBe(
      "4 Sept 2025"
    )
  })
})

describe("formatDuration", () => {
  it("handles null and NaN", () => {
    expect(formatDuration(null)).toBe("—")
    expect(formatDuration(Number.NaN)).toBe("—")
  })
  it("never emits 60 minutes", () => {
    expect(formatDuration(3599)).toBe("1h 0m")
    expect(formatDuration(7199)).toBe("2h 0m")
  })
  it("rolls up to days", () => {
    expect(formatDuration(195_000)).toBe("2d 6h")
  })
  it("formats sub-hour", () => {
    expect(formatDuration(2700)).toBe("45m")
  })
})

describe("numbers", () => {
  it("groups thousands en-GB", () => {
    expect(formatNumber(1234567)).toBe("1,234,567")
  })
  it("rounds percentages", () => {
    expect(formatPercent(38.4)).toBe("38%")
  })
})
