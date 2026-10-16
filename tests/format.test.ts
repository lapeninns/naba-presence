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

// #418 on /reports: the server (Node) wrote "18 Sept" and WebKit, whose en-GB
// data says "Sep", wrote "18 Sep", so React rejected the hydrated page. The
// month is taken from its number, so what the engine calls it cannot leak.
describe("formatDate across engines", () => {
  it("writes the same month words whatever the engine's en-GB short months are", () => {
    vi.useFakeTimers({ now: new Date("2026-10-16T12:00:00Z") })
    const Real = Intl.DateTimeFormat
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
      locales?: string | string[],
      options?: Intl.DateTimeFormatOptions
    ) {
      const real = new Real(locales, options)
      if (options?.month !== "short") return real
      // Safari's wording for the month the others spell "Sept".
      return {
        format: (date?: Date | number) =>
          real.format(date).replace("Sept", "Sep"),
        formatToParts: (date?: Date | number) =>
          real
            .formatToParts(date)
            .map((part) =>
              part.type === "month"
                ? { ...part, value: part.value.replace("Sept", "Sep") }
                : part
            ),
        resolvedOptions: () => real.resolvedOptions(),
      } as Intl.DateTimeFormat
    } as unknown as typeof Intl.DateTimeFormat)
    expect(formatDate("2026-09-18T10:00:00Z", "UTC")).toBe("18 Sept")
    expect(formatDateTime("2025-09-04T20:25:00Z", "Europe/London")).toBe(
      "4 Sept 2025, 21:25"
    )
    vi.restoreAllMocks()
  })

  it("keeps every other month's short name", () => {
    vi.useFakeTimers({ now: new Date("2026-10-16T12:00:00Z") })
    const names = Array.from({ length: 12 }, (_, month) =>
      formatDate(new Date(Date.UTC(2026, month, 5, 12)).toISOString(), "UTC")
    )
    expect(names).toEqual([
      "5 Jan",
      "5 Feb",
      "5 Mar",
      "5 Apr",
      "5 May",
      "5 Jun",
      "5 Jul",
      "5 Aug",
      "5 Sept",
      "5 Oct",
      "5 Nov",
      "5 Dec",
    ])
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
