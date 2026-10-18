import { describe, expect, it, vi, afterEach } from "vitest"

import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatShortDate,
  formatShortDateRange,
  type ShortDateOptions,
} from "@/lib/format"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

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
        formatRangeToParts: (start: Date | number, end: Date | number) =>
          real
            .formatRangeToParts(start, end)
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
    expect(
      formatShortDate(new Date("2026-09-18T10:00:00Z"), {
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    ).toBe("18 Sept 2026")
    expect(
      formatShortDateRange(
        new Date("2026-09-18T10:00:00Z"),
        new Date("2026-10-16T10:00:00Z"),
        { day: "numeric", year: "numeric", timeZone: "UTC" }
      )
    ).toBe("18 Sept\u2009–\u200916 Oct 2026")
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

describe("formatShortDate", () => {
  it.each(
    [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sept",
      "Oct",
      "Nov",
      "Dec",
    ].map((month, monthIndex) => ({ month, monthIndex }))
  )(
    "uses the fixed $month spelling without changing the year policy",
    ({ month, monthIndex }) => {
      const date = new Date(Date.UTC(2026, monthIndex, 5, 12))
      expect(formatShortDate(date, { day: "numeric", timeZone: "UTC" })).toBe(
        `5 ${month}`
      )
      expect(
        formatShortDate(date, {
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })
      ).toBe(`5 ${month} 2026`)
    }
  )

  it.each<ShortDateOptions>([
    { day: "numeric" },
    { weekday: "short", day: "numeric", year: "numeric" },
    { day: "numeric", hour: "2-digit", minute: "2-digit" },
    { day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" },
    { day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: true },
    { day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  ])("preserves Intl fields, literals and the runtime zone: %j", (options) => {
    const date = new Date("2026-08-31T23:30:00Z")
    const expected = new Intl.DateTimeFormat("en-GB", {
      ...options,
      month: "short",
    }).format(date)
    expect(formatShortDate(date, options)).toBe(
      expected.replace(/\bSep\b/g, "Sept")
    )
  })

  it.each<ShortDateOptions>([
    { day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" },
    {
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
    },
    {
      weekday: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC",
    },
  ])("normalizes WebKit's month and date/time connector: %j", (options) => {
    const Real = Intl.DateTimeFormat
    const date = new Date("2026-09-12T13:05:00Z")
    const native = new Real("en-GB", { ...options, month: "short" })
    const expected = native.format(date)
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
      locales?: string | string[],
      nativeOptions?: Intl.DateTimeFormatOptions
    ) {
      const real = new Real(locales, nativeOptions)
      if (nativeOptions?.month !== "short") return real
      return {
        format: (value?: Date | number) =>
          real
            .format(value)
            .replace("Sept", "Sep")
            .replace(/, (?=\d{2}:)/, " at "),
        formatToParts: (value?: Date | number) => {
          const parts = real.formatToParts(value)
          return parts.map((part, index) =>
            part.type === "month"
              ? { ...part, value: part.value.replace("Sept", "Sep") }
              : part.type === "literal" && parts[index + 1]?.type === "hour"
                ? { ...part, value: " at " }
                : part
          )
        },
      } as Intl.DateTimeFormat
    } as unknown as typeof Intl.DateTimeFormat)
    expect(formatShortDate(date, options)).toBe(expected)
  })

  it.each([
    ["2026-08-31T23:30:00Z", "UTC", "31 Aug 2026"],
    ["2026-08-31T23:30:00Z", "Europe/London", "1 Sept 2026"],
    ["2026-09-30T23:30:00Z", "Europe/London", "1 Oct 2026"],
    ["2026-09-01T00:30:00Z", "America/Los_Angeles", "31 Aug 2026"],
    ["2026-12-31T23:30:00Z", "Australia/Sydney", "1 Jan 2027"],
    ["2027-01-01T00:30:00Z", "America/Los_Angeles", "31 Dec 2026"],
  ])("uses the displayed month at %s in %s", (iso, timeZone, expected) => {
    expect(
      formatShortDate(new Date(iso), {
        day: "numeric",
        year: "numeric",
        timeZone,
      })
    ).toBe(expected)
  })

  it.each([
    ["Europe/London", "2026-10-25T01:00:00Z"],
    ["America/Los_Angeles", "2026-03-08T10:00:00Z"],
    ["Australia/Sydney", "2026-10-03T16:00:00Z"],
    ["Australia/Lord_Howe", "2026-10-03T15:30:00Z"],
    ["Pacific/Chatham", "2026-04-04T14:00:00Z"],
  ])("preserves the clock across DST in %s", (timeZone, transition) => {
    const options = {
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    } as const
    const native = new Intl.DateTimeFormat("en-GB", {
      ...options,
      month: "short",
    })
    for (let minutes = -120; minutes <= 120; minutes += 5) {
      const date = new Date(Date.parse(transition) + minutes * 60_000)
      expect(formatShortDate(date, options)).toBe(native.format(date))
    }
  })

  it("throws for an invalid date or zone, as direct Intl formatting does", () => {
    expect(() =>
      formatShortDate(new Date("invalid"), { day: "numeric" })
    ).toThrow(RangeError)
    expect(() =>
      formatShortDate(new Date("2026-09-12T12:00:00Z"), {
        timeZone: "Invalid/Zone",
      })
    ).toThrow(RangeError)
  })
})

describe("formatShortDateRange", () => {
  it.each([
    ["2026-09-12T12:00:00Z", "2026-09-12T12:00:00Z"],
    ["2026-09-12T12:00:00Z", "2026-09-18T12:00:00Z"],
    ["2026-08-31T12:00:00Z", "2026-09-01T12:00:00Z"],
    ["2026-09-30T12:00:00Z", "2026-10-01T12:00:00Z"],
    ["2026-12-31T12:00:00Z", "2027-01-01T12:00:00Z"],
    ["2026-09-12T12:00:00Z", "2027-09-12T12:00:00Z"],
    ["2028-02-28T12:00:00Z", "2028-03-01T12:00:00Z"],
  ])("preserves Intl range collapse from %s to %s", (from, to) => {
    const start = new Date(from)
    const end = new Date(to)
    const options = {
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    } as const
    const native = new Intl.DateTimeFormat("en-GB", {
      ...options,
      month: "short",
    })
    expect(formatShortDateRange(start, end, options)).toBe(
      native.formatRange(start, end).replace(/\bSep\b/g, "Sept")
    )
  })

  it("gets each source month in the requested zone and preserves range clocks", () => {
    const start = new Date("2026-08-31T23:30:00Z")
    const end = new Date("2026-09-30T23:30:00Z")
    const options = {
      weekday: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Europe/London",
    } as const
    const native = new Intl.DateTimeFormat("en-GB", {
      ...options,
      month: "short",
    })
    const result = formatShortDateRange(start, end, options)
    expect(result).toBe(
      native.formatRange(start, end).replace(/\bSep\b/g, "Sept")
    )
    expect(result).toContain("Sept")
    expect(result).toContain("Oct")
    expect(result).not.toContain("Aug")
  })

  it("uses the runtime zone when one is omitted", () => {
    const start = new Date("2026-08-31T23:30:00Z")
    const end = new Date("2026-09-01T01:30:00Z")
    const options = { day: "numeric", year: "numeric" } as const
    const native = new Intl.DateTimeFormat("en-GB", {
      ...options,
      month: "short",
    })
    expect(formatShortDateRange(start, end, options)).toBe(
      native.formatRange(start, end).replace(/\bSep\b/g, "Sept")
    )
  })

  it("preserves native reversed-range behavior", () => {
    const start = new Date("2026-09-12T12:00:00Z")
    const end = new Date("2026-09-11T12:00:00Z")
    const options = {
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    } as const
    const native = new Intl.DateTimeFormat("en-GB", {
      ...options,
      month: "short",
    })
    expect(formatShortDateRange(start, end, options)).toBe(
      native.formatRange(start, end).replace(/\bSep\b/g, "Sept")
    )
  })

  it("preserves Intl errors for invalid dates and invalid zones", () => {
    const date = new Date("2026-09-12T12:00:00Z")
    const invalid = new Date("invalid")
    expect(() => formatShortDateRange(invalid, date, {})).toThrow(RangeError)
    expect(() => formatShortDateRange(date, invalid, {})).toThrow(RangeError)
    expect(() =>
      formatShortDateRange(date, date, { timeZone: "Invalid/Zone" })
    ).toThrow(RangeError)
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
