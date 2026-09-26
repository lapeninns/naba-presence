import { describe, expect, it } from "vitest"

import {
  NO_RECURRENCE,
  describeRecurrence,
  googleRecurrence,
  monthlyOptions,
  nthWeekdayOf,
  postRecurrence,
  recurrenceFields,
  weekdayOf,
} from "@/lib/locations/post-recurrence"

describe("post recurrence", () => {
  it("reads a start date's weekday and its place in the month", () => {
    expect(weekdayOf("2026-10-02")).toBe("FRIDAY")
    expect(nthWeekdayOf("2026-10-02")).toBe("FIRST")
    expect(nthWeekdayOf("2026-10-30")).toBe("LAST")
    expect(weekdayOf("")).toBeNull()
  })

  it("offers the last weekday only when the start date is one", () => {
    expect(monthlyOptions("2026-10-09").map((o) => o.label)).toEqual([
      "On day 9",
      "On the second Friday",
    ])
    // 27 Nov 2026 is both the fourth and the last Friday.
    expect(monthlyOptions("2026-11-27").map((o) => o.value)).toEqual([
      "date",
      "nth",
      "last",
    ])
    // 30 Oct is a fifth Friday, which repeats only as "last".
    expect(monthlyOptions("2026-10-30").map((o) => o.value)).toEqual([
      "date",
      "last",
    ])
  })

  it("writes each pattern in Google's shape", () => {
    expect(googleRecurrence(NO_RECURRENCE, "2026-10-02")).toBeNull()
    expect(
      googleRecurrence({ ...NO_RECURRENCE, repeat: "daily" }, "2026-10-02")
    ).toEqual({ dailyPattern: {} })
    expect(
      googleRecurrence(
        {
          ...NO_RECURRENCE,
          repeat: "weekly",
          weekdays: ["SATURDAY", "FRIDAY"],
          seriesEnd: "2026-12-31",
        },
        "2026-10-02"
      )
    ).toEqual({
      weeklyPattern: { daysOfWeek: ["FRIDAY", "SATURDAY"] },
      seriesEndTime: "2026-12-31T23:59:59Z",
    })
    expect(
      googleRecurrence(
        { ...NO_RECURRENCE, repeat: "monthly", monthly: "date" },
        "2026-10-09"
      )
    ).toEqual({ monthlyPattern: { dayOfMonth: 9 } })
    expect(
      googleRecurrence(
        { ...NO_RECURRENCE, repeat: "monthly", monthly: "nth" },
        "2026-10-09"
      )
    ).toEqual({ monthlyPattern: { dayOfWeekOccurrence: "SECOND" } })
  })

  it("round-trips Google's recurrence into the composer's fields", () => {
    const fields = {
      ...NO_RECURRENCE,
      repeat: "monthly" as const,
      monthly: "last" as const,
      seriesEnd: "2027-03-31",
    }
    const event = {
      schedule: { startDate: { year: 2026, month: 10, day: 30 } },
      recurrenceInfo: googleRecurrence(fields, "2026-10-30"),
    }
    expect(recurrenceFields(event)).toEqual(fields)
    expect(recurrenceFields({ title: "One-off" })).toEqual(NO_RECURRENCE)
  })

  it("describes a repeat in words", () => {
    expect(
      describeRecurrence(
        { ...NO_RECURRENCE, repeat: "weekly", seriesEnd: "2026-12-31" },
        "2026-10-02"
      )
    ).toBe("Repeats weekly on Fri until 31 Dec 2026")
    expect(
      postRecurrence({
        schedule: { startDate: { year: 2026, month: 10, day: 9 } },
        recurrenceInfo: { monthlyPattern: { dayOfWeekOccurrence: "SECOND" } },
      })
    ).toBe("Repeats monthly on the second Friday")
    expect(postRecurrence(null)).toBe("")
  })
})
