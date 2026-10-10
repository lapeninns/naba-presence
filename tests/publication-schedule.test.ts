import { describe, expect, it } from "vitest"

import {
  clockChangeCountNote,
  clockChangeNote,
  contentExpired,
  expandSchedule,
  occurrenceEventDates,
  resolveLocalTime,
  scheduleRuleSchema,
  selectDueOccurrences,
  timezoneSchema,
} from "@/lib/domain/publication-schedule"

const LONDON = "Europe/London"

describe("resolveLocalTime", () => {
  it("maps an ordinary London time in winter and summer", () => {
    expect(resolveLocalTime("2026-01-15", "09:30", LONDON)).toEqual({
      instant: new Date("2026-01-15T09:30:00Z"),
      adjustment: "none",
    })
    expect(resolveLocalTime("2026-07-15", "09:30", LONDON)).toEqual({
      instant: new Date("2026-07-15T08:30:00Z"),
      adjustment: "none",
    })
  })
  it("moves a spring-forward time to the first valid local time", () => {
    // 29 March 2026: 01:00 GMT becomes 02:00 BST, so 01:30 never happens.
    expect(resolveLocalTime("2026-03-29", "01:30", LONDON)).toEqual({
      instant: new Date("2026-03-29T01:00:00Z"),
      adjustment: "moved_forward",
    })
  })
  it("runs a repeated autumn time once, at the earlier instant", () => {
    // 25 October 2026: 02:00 BST becomes 01:00 GMT, so 01:30 happens twice.
    expect(resolveLocalTime("2026-10-25", "01:30", LONDON)).toEqual({
      instant: new Date("2026-10-25T00:30:00Z"),
      adjustment: "earlier_of_repeated",
    })
  })
  it("handles a zone without DST", () => {
    expect(
      resolveLocalTime("2026-03-29", "01:30", "Asia/Kolkata").instant
    ).toEqual(new Date("2026-03-28T20:00:00Z"))
  })
})

describe("expandSchedule", () => {
  it("expands a one-time schedule", () => {
    const rule = scheduleRuleSchema.parse({
      frequency: "once",
      startDate: "2026-10-01",
      localTime: "10:00",
    })
    expect(expandSchedule(rule, LONDON).occurrences).toEqual([
      {
        intendedAt: "2026-10-01T09:00:00.000Z",
        localDate: "2026-10-01",
        localTime: "10:00",
        adjustment: "none",
      },
    ])
  })
  it("expands daily across the autumn change without a duplicate", () => {
    const rule = scheduleRuleSchema.parse({
      frequency: "daily",
      startDate: "2026-10-24",
      localTime: "01:30",
      end: { type: "date", date: "2026-10-26" },
    })
    const { occurrences } = expandSchedule(rule, LONDON)
    expect(occurrences.map((occurrence) => occurrence.intendedAt)).toEqual([
      "2026-10-24T00:30:00.000Z",
      "2026-10-25T00:30:00.000Z",
      "2026-10-26T01:30:00.000Z",
    ])
    expect(occurrences[1].adjustment).toBe("earlier_of_repeated")
  })
  it("shows the moved spring-forward time as the actual local run time", () => {
    const rule = scheduleRuleSchema.parse({
      frequency: "daily",
      startDate: "2026-03-29",
      localTime: "01:30",
      end: { type: "count", count: 2 },
    })
    expect(
      expandSchedule(rule, LONDON).occurrences.map((o) => [
        o.localTime,
        o.adjustment,
      ])
    ).toEqual([
      ["02:00", "moved_forward"],
      ["01:30", "none"],
    ])
  })
  it("expands chosen weekdays up to the occurrence count", () => {
    const rule = scheduleRuleSchema.parse({
      frequency: "weekly",
      startDate: "2026-10-01",
      localTime: "08:00",
      weekdays: [1, 3],
      end: { type: "count", count: 4 },
    })
    expect(
      expandSchedule(rule, LONDON).occurrences.map((o) => o.localDate)
    ).toEqual(["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14"])
  })
  it("skips months without the chosen day and counts only real runs", () => {
    const rule = scheduleRuleSchema.parse({
      frequency: "monthly",
      startDate: "2026-01-31",
      localTime: "09:00",
      dayOfMonth: 31,
      end: { type: "count", count: 3 },
    })
    const expansion = expandSchedule(rule, LONDON)
    expect(expansion.occurrences.map((o) => o.localDate)).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
    ])
    expect(expansion.skippedDates).toEqual(["2026-02", "2026-04"])
  })
  it("stops a monthly rule at its end date", () => {
    const rule = scheduleRuleSchema.parse({
      frequency: "monthly",
      startDate: "2026-01-15",
      localTime: "09:00",
      dayOfMonth: 15,
      end: { type: "date", date: "2026-03-14" },
    })
    expect(
      expandSchedule(rule, LONDON).occurrences.map((o) => o.localDate)
    ).toEqual(["2026-01-15", "2026-02-15"])
  })
  it("rejects unbounded, reversed or invalid rules", () => {
    expect(
      scheduleRuleSchema.safeParse({
        frequency: "daily",
        startDate: "2026-10-01",
        localTime: "09:00",
      }).success
    ).toBe(false)
    expect(
      scheduleRuleSchema.safeParse({
        frequency: "daily",
        startDate: "2026-10-01",
        localTime: "09:00",
        end: { type: "date", date: "2026-09-01" },
      }).success
    ).toBe(false)
    expect(
      scheduleRuleSchema.safeParse({
        frequency: "once",
        startDate: "2026-02-30",
        localTime: "09:00",
      }).success
    ).toBe(false)
    expect(
      scheduleRuleSchema.safeParse({
        frequency: "daily",
        startDate: "2026-10-01",
        localTime: "09:00",
        end: { type: "count", count: 367 },
      }).success
    ).toBe(false)
    expect(timezoneSchema.safeParse("Mars/Olympus").success).toBe(false)
  })
})

describe("missed runs and expired content", () => {
  const now = new Date("2026-10-10T12:00:00Z")
  const at = (hours: number) => ({
    intendedAt: new Date(now.getTime() - hours * 3_600_000).toISOString(),
  })
  it("runs only the latest occurrence within 24 hours and marks the rest missed", () => {
    const due = [at(50), at(30), at(2)]
    expect(selectDueOccurrences(due, now)).toEqual({
      run: due[2],
      missed: [due[0], due[1]],
    })
  })
  it("runs nothing when the latest is outside the grace period", () => {
    const due = [at(49), at(25)]
    expect(selectDueOccurrences(due, now)).toEqual({ run: null, missed: due })
  })
  it("derives event dates from explicit offsets and refuses expired content", () => {
    expect(
      occurrenceEventDates("2026-10-30", { startDays: 1, endDays: 3 })
    ).toEqual({ startDate: "2026-10-31", endDate: "2026-11-02" })
    expect(contentExpired("2026-10-09", now, LONDON)).toBe(true)
    expect(contentExpired("2026-10-10", now, LONDON)).toBe(false)
    expect(contentExpired(null, now, LONDON)).toBe(false)
  })
})

describe("clock-change wording", () => {
  it("says a spring-forward time moved and an autumn-back time did not", () => {
    const forward = clockChangeNote("moved_forward")
    const back = clockChangeNote("earlier_of_repeated")
    expect(forward).toMatch(/Clocks go forward/)
    expect(forward).toMatch(/first valid time after it/)
    expect(back).toMatch(/Clocks go back/)
    expect(back).toMatch(/runs once, at the earlier of the two/)
    expect(back).not.toMatch(/moved/)
    expect(forward).not.toBe(back)
    expect(clockChangeNote("none")).toBeNull()
  })

  it("counts affected runs without claiming they all moved", () => {
    expect(clockChangeCountNote(0)).toBeNull()
    expect(clockChangeCountNote(1)).toBe("1 falls on a clock change (see each time below)")
    expect(clockChangeCountNote(2)).not.toMatch(/moved/)
  })
})
