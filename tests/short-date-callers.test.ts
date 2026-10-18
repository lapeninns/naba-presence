import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { mockWebkitShortSeptember } from "./helpers/webkit-short-month"
import { describeChildChange } from "@/components/bulk/bulk-change-summary"
import {
  formatWallDay,
  scheduleWhen,
} from "@/components/locations/posts/schedule-dates"
import { formatResetDate } from "@/lib/contracts/ai-credits-format"
import { formatSpecialDate } from "@/lib/editors/hours-presentation"
import { formatDateRangeChip } from "@/lib/inbox/filter-labels"
import { formatMediaDate } from "@/lib/locations/media-labels"
import { formatPostTimestamp, postSchedule } from "@/lib/locations/post-display"
import {
  describeRecurrence,
  NO_RECURRENCE,
} from "@/lib/locations/post-recurrence"
import { formatDay } from "@/lib/settings/roles"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("short-date caller contracts under WebKit's September spelling", () => {
  beforeEach(() => {
    vi.stubEnv("TZ", "America/Los_Angeles")
    mockWebkitShortSeptember()
  })

  it("exercises the raw September and date-time differences the callers must remove", () => {
    const date = new Date("2026-09-01T12:00:00Z")
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    expect(formatter.format(date)).toBe("1 Sep 2026 at 12:00")
    expect(formatter.formatToParts(date)).toContainEqual({
      type: "literal",
      value: " at ",
    })
    expect(
      date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    ).toBe("1 Sep")
  })

  it("keeps role and media dates on their original clocks, always with a year", () => {
    const instant = "2026-10-01T00:30:00Z"
    expect(formatDay(instant)).toBe("30 Sept 2026")
    expect(formatDay(instant, "UTC")).toBe("1 Oct 2026")
    expect(formatMediaDate(instant)).toBe("30 Sept 2026")
    expect(formatDay("2027-01-01T00:30:00Z", "Pacific/Chatham")).toBe(
      "1 Jan 2027"
    )
    expect(formatMediaDate("2027-01-01T00:30:00Z")).toBe("31 Dec 2026")
  })

  it("keeps post timestamps in the listing zone and retries an unknown zone locally", () => {
    const instant = "2026-09-30T23:30:00Z"
    expect(formatPostTimestamp(instant, "UTC")).toBe("30 Sept 2026, 23:30")
    expect(formatPostTimestamp(instant, "Europe/London")).toBe(
      "1 Oct 2026, 00:30"
    )
    expect(formatPostTimestamp(instant, "Mars/Olympus")).toBe(
      "30 Sept 2026, 16:30"
    )
    expect(formatPostTimestamp(instant)).toBe("30 Sept 2026, 16:30")
  })

  it("keeps local wall dates and optional endpoint times in Google post schedules", () => {
    expect(
      postSchedule({
        event: {
          schedule: {
            startDate: { year: 2026, month: 9, day: 30 },
            startTime: { hours: 0 },
            endDate: { year: 2026, month: 10, day: 1 },
          },
        },
      })
    ).toBe("30 Sept, 00:00 – 1 Oct")
    expect(
      postSchedule({
        event: {
          schedule: {
            endDate: { year: 2026, month: 9, day: 1 },
            endTime: { minutes: 5 },
          },
        },
      })
    ).toBe("1 Sept, 00:05")
    expect(
      postSchedule({
        event: {
          schedule: {
            startDate: { year: 2026, month: 12, day: 31 },
            startTime: { hours: 23, minutes: 59 },
            endDate: { year: 2027, month: 1, day: 1 },
            endTime: { hours: 0, minutes: 0 },
          },
        },
      })
    ).toBe("31 Dec, 23:59 – 1 Jan, 00:00")
    expect(postSchedule({ event: null })).toBe("")
    expect(
      postSchedule({ event: { schedule: { startDate: { year: 2026 } } } })
    ).toBe("")
  })

  it("keeps special-hours noon and recurrence dates as local calendar dates", () => {
    expect(formatSpecialDate("2026-09-01")).toBe("Tue, 1 Sept 2026")
    expect(formatSpecialDate("2027-01-01")).toBe("Fri, 1 Jan 2027")
    expect(
      describeRecurrence(
        { ...NO_RECURRENCE, repeat: "daily", seriesEnd: "2026-09-30" },
        "2026-09-01"
      )
    ).toBe("Repeats daily until 30 Sept 2026")
    // The existing parser normalises overflow instead of rejecting it.
    expect(
      describeRecurrence(
        { ...NO_RECURRENCE, repeat: "daily", seriesEnd: "2026-09-31" },
        "2026-09-01"
      )
    ).toBe("Repeats daily until 1 Oct 2026")
  })

  it("keeps credit resets and filter chips in UTC without adding a year", () => {
    expect(formatResetDate("2026-09-01T00:30:00Z")).toBe("1 Sept")
    expect(formatResetDate("2026-09-30T23:30:00-07:00")).toBe("1 Oct")
    expect(formatDateRangeChip("2026-09-01T00:00:00Z", "2026-09-30")).toBe(
      "Date range: 1 Sept – 30 Sept"
    )
    expect(formatDateRangeChip("2026-12-31", "2027-01-01")).toBe(
      "Date range: 31 Dec – 1 Jan"
    )
    expect(formatDateRangeChip(undefined, "2026-09-01")).toBe(
      "Date range: to 1 Sept"
    )
  })

  it("keeps schedule wall dates and bulk summaries in UTC with their own year policies", () => {
    expect(formatWallDay("2026-09-01")).toBe("Tue 1 Sept")
    expect(formatWallDay("2027-01-01")).toBe("Fri 1 Jan")
    expect(
      describeChildChange({
        operation: "special_hours",
        input: {
          operation: "special_hours",
          dates: [{ action: "closed", date: "2026-09-01" }],
        },
        currentValue: null,
        proposedValue: {
          specialHourPeriods: [
            { startDate: { year: 2026, month: 9, day: 1 }, closed: true },
          ],
        },
        updateMask: [],
      })
    ).toEqual([
      { label: "Tue, 1 Sept 2026", current: "Not set", proposed: "Closed" },
    ])
  })

  it("retains each caller's invalid or absent-input policy", () => {
    expect(formatDay("invalid")).toBe("")
    expect(() => formatDay("2026-09-01", "Mars/Olympus")).toThrow(RangeError)
    expect(formatMediaDate(null)).toBeNull()
    expect(formatMediaDate("")).toBeNull()
    expect(formatMediaDate("invalid")).toBeNull()
    expect(formatPostTimestamp("invalid", "Mars/Olympus")).toBe("")
    expect(formatSpecialDate("")).toBe("No date")
    expect(formatSpecialDate("not-a-date")).toBe("not-a-date")
    expect(formatResetDate("invalid")).toBe("Invalid Date")
    expect(formatDateRangeChip("not-a-date-trailing", undefined)).toBe(
      "Date range: from not-a-date"
    )
    expect(formatDateRangeChip("2026-09-31", undefined)).toBe(
      "Date range: from 1 Oct"
    )
    expect(() => formatDateRangeChip("2026-13-01", undefined)).toThrow(
      RangeError
    )
    expect(() => formatWallDay("invalid")).toThrow(RangeError)
    expect(
      describeRecurrence(
        { ...NO_RECURRENCE, repeat: "daily", seriesEnd: "invalid" },
        "2026-09-01"
      )
    ).toBe("Repeats daily")
  })
})

describe("timestamp clock-change boundaries", () => {
  it.each([
    ["2026-03-29T00:59:00Z", "Europe/London", "29 Mar 2026, 00:59"],
    ["2026-03-29T01:00:00Z", "Europe/London", "29 Mar 2026, 02:00"],
    ["2026-10-25T00:30:00Z", "Europe/London", "25 Oct 2026, 01:30"],
    ["2026-10-25T01:30:00Z", "Europe/London", "25 Oct 2026, 01:30"],
    ["2026-10-03T15:29:00Z", "Australia/Lord_Howe", "4 Oct 2026, 01:59"],
    ["2026-10-03T15:30:00Z", "Australia/Lord_Howe", "4 Oct 2026, 02:30"],
    ["2026-09-26T13:59:00Z", "Pacific/Chatham", "27 Sept 2026, 02:44"],
    ["2026-09-26T14:00:00Z", "Pacific/Chatham", "27 Sept 2026, 03:45"],
  ])("formats %s on the %s clock", (instant, zone, expected) => {
    expect(formatPostTimestamp(instant, zone)).toBe(expected)
  })

  it("keeps the schedule row's date, time and fold-specific zone abbreviation", () => {
    const rule = {
      frequency: "once" as const,
      startDate: "2026-10-25",
      localTime: "01:30",
    }
    expect(scheduleWhen(rule, "Europe/London", 60)).toBe(
      "Sun 25 Oct, 01:30 BST · Once"
    )
    expect(scheduleWhen(rule, "Europe/London", 0)).toBe(
      "Sun 25 Oct, 01:30 GMT · Once"
    )
  })
})
