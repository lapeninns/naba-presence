import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  clockChangeCountNote,
  clockChangeNote,
  contentExpired,
  describeScheduleRule,
  DISPATCH_WINDOW_MS,
  expandSchedule,
  formatUtcOffset,
  occurrenceEventDates,
  planOnceSlot,
  resolveLocalSlot,
  resolveLocalTime,
  scheduledPublishIntentId,
  SCHEDULE_MAX_LEAD_MS,
  SCHEDULE_MIN_LEAD_MS,
  slotProblemMessage,
  SLOT_PROBLEMS,
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

describe("resolveLocalSlot (strict, one-time)", () => {
  it("maps an ordinary time to one instant with its offset", () => {
    expect(resolveLocalSlot("2026-01-15", "09:30", LONDON)).toEqual({
      kind: "ok",
      instant: new Date("2026-01-15T09:30:00Z"),
      offsetMinutes: 0,
    })
    expect(resolveLocalSlot("2026-07-15", "09:30", LONDON)).toEqual({
      kind: "ok",
      instant: new Date("2026-07-15T08:30:00Z"),
      offsetMinutes: 60,
    })
  })
  it("refuses a London spring-forward time instead of moving it", () => {
    // 29 March 2026: 01:00 GMT becomes 02:00 BST, so 01:30 never happens.
    expect(resolveLocalSlot("2026-03-29", "01:30", LONDON)).toEqual({
      kind: "nonexistent",
    })
    // Either side of the gap is fine.
    expect(resolveLocalSlot("2026-03-29", "00:59", LONDON).kind).toBe("ok")
    expect(resolveLocalSlot("2026-03-29", "02:00", LONDON)).toMatchObject({
      kind: "ok",
      instant: new Date("2026-03-29T01:00:00Z"),
      offsetMinutes: 60,
    })
  })
  it("returns both London autumn-back instants, earlier first", () => {
    // 25 October 2026: 02:00 BST becomes 01:00 GMT, so 01:30 happens twice.
    expect(resolveLocalSlot("2026-10-25", "01:30", LONDON)).toEqual({
      kind: "ambiguous",
      choices: [
        { instant: new Date("2026-10-25T00:30:00Z"), offsetMinutes: 60 },
        { instant: new Date("2026-10-25T01:30:00Z"), offsetMinutes: 0 },
      ],
    })
    expect(resolveLocalSlot("2026-10-25", "02:00", LONDON).kind).toBe("ok")
  })
  it("handles New York, a half-hour shift and a zone without DST", () => {
    expect(
      resolveLocalSlot("2026-03-08", "02:30", "America/New_York").kind
    ).toBe("nonexistent")
    expect(
      resolveLocalSlot("2026-11-01", "01:30", "America/New_York")
    ).toMatchObject({
      kind: "ambiguous",
      choices: [{ offsetMinutes: -240 }, { offsetMinutes: -300 }],
    })
    // Lord Howe Island moves its clocks by 30 minutes: on 5 April 2026
    // 02:00 (+11:00) becomes 01:30 (+10:30).
    expect(
      resolveLocalSlot("2026-04-05", "01:45", "Australia/Lord_Howe")
    ).toMatchObject({
      kind: "ambiguous",
      choices: [{ offsetMinutes: 660 }, { offsetMinutes: 630 }],
    })
    expect(resolveLocalSlot("2026-03-29", "01:30", "Asia/Kolkata")).toEqual({
      kind: "ok",
      instant: new Date("2026-03-28T20:00:00Z"),
      offsetMinutes: 330,
    })
  })
})

describe("planOnceSlot", () => {
  const rule = (startDate: string, localTime: string) => ({
    startDate,
    localTime,
  })
  const now = new Date("2026-10-11T12:00:00Z")
  it("plans an ordinary slot with its deadline 5 minutes after", () => {
    expect(
      planOnceSlot(rule("2026-10-12", "09:00"), LONDON, null, now)
    ).toEqual({
      ok: true,
      offsetMinutes: 60,
      deadlineAt: "2026-10-12T08:05:00.000Z",
      occurrence: {
        intendedAt: "2026-10-12T08:00:00.000Z",
        localDate: "2026-10-12",
        localTime: "09:00",
        adjustment: "none",
      },
    })
    expect(DISPATCH_WINDOW_MS).toBe(5 * 60_000)
  })
  it("refuses a nonexistent time and an ambiguous one without an offset", () => {
    const spring = new Date("2026-03-01T00:00:00Z")
    expect(
      planOnceSlot(rule("2026-03-29", "01:30"), LONDON, null, spring)
    ).toEqual({ ok: false, problem: "schedule_time_nonexistent", choices: [] })
    expect(
      planOnceSlot(rule("2026-10-25", "01:30"), LONDON, null, now)
    ).toMatchObject({
      ok: false,
      problem: "schedule_time_ambiguous",
      choices: [{ offsetMinutes: 60 }, { offsetMinutes: 0 }],
    })
  })
  it("takes the instant the explicit offset names", () => {
    const first = planOnceSlot(rule("2026-10-25", "01:30"), LONDON, 60, now)
    const second = planOnceSlot(rule("2026-10-25", "01:30"), LONDON, 0, now)
    expect(first).toMatchObject({
      ok: true,
      offsetMinutes: 60,
      occurrence: {
        intendedAt: "2026-10-25T00:30:00.000Z",
        adjustment: "none",
      },
    })
    expect(second).toMatchObject({
      ok: true,
      offsetMinutes: 0,
      occurrence: { intendedAt: "2026-10-25T01:30:00.000Z" },
    })
  })
  it("refuses an offset the time does not have", () => {
    expect(
      planOnceSlot(rule("2026-10-25", "01:30"), LONDON, 120, now)
    ).toMatchObject({ ok: false, problem: "schedule_offset_invalid" })
    // An unambiguous time accepts only its own offset.
    expect(planOnceSlot(rule("2026-10-12", "09:00"), LONDON, 60, now).ok).toBe(
      true
    )
    expect(
      planOnceSlot(rule("2026-10-12", "09:00"), LONDON, 0, now)
    ).toMatchObject({ ok: false, problem: "schedule_offset_invalid" })
  })
  it("enforces 5 minutes to 90 days ahead at the edges", () => {
    // 2026-10-11 12:00Z is 13:00 in London.
    const at = (instant: number) =>
      new Date(now.getTime() + instant).toISOString()
    const plan = (offset: number) => {
      const target = new Date(now.getTime() + offset)
      const local = new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(target)
      const part = (type: string) =>
        local.find((entry) => entry.type === type)!.value
      return planOnceSlot(
        rule(
          `${part("year")}-${part("month")}-${part("day")}`,
          `${part("hour")}:${part("minute")}`
        ),
        "UTC",
        null,
        now
      )
    }
    expect(plan(SCHEDULE_MIN_LEAD_MS)).toMatchObject({
      ok: true,
      occurrence: { intendedAt: at(SCHEDULE_MIN_LEAD_MS) },
    })
    expect(plan(SCHEDULE_MIN_LEAD_MS - 60_000)).toMatchObject({
      ok: false,
      problem: "schedule_too_soon",
    })
    expect(plan(-60 * 60_000)).toMatchObject({ problem: "schedule_too_soon" })
    expect(plan(SCHEDULE_MAX_LEAD_MS)).toMatchObject({ ok: true })
    expect(plan(SCHEDULE_MAX_LEAD_MS + 60_000)).toMatchObject({
      ok: false,
      problem: "schedule_too_far",
    })
  })
  it("skips the window when only displaying", () => {
    expect(
      planOnceSlot(rule("2020-01-01", "09:00"), LONDON, null, null).ok
    ).toBe(true)
  })
  it("words every problem and formats offsets", () => {
    for (const problem of SLOT_PROBLEMS)
      expect(slotProblemMessage(problem)).toMatch(/\.$/)
    expect(formatUtcOffset(60)).toBe("UTC+01:00")
    expect(formatUtcOffset(0)).toBe("UTC+00:00")
    expect(formatUtcOffset(-330)).toBe("UTC−05:30")
    expect(
      describeScheduleRule(
        { frequency: "once", startDate: "2026-10-25", localTime: "01:30" },
        LONDON,
        0
      )
    ).toBe("Once on 2026-10-25 at 01:30 (Europe/London, UTC+00:00)")
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
  const at = (minutes: number) => {
    const intended = now.getTime() - minutes * 60_000
    return {
      intendedAt: new Date(intended).toISOString(),
      deadlineAt: new Date(intended + DISPATCH_WINDOW_MS).toISOString(),
    }
  }
  it("runs the latest occurrence only inside its 5-minute window and marks the rest missed", () => {
    const due = [at(60 * 50), at(60 * 2), at(4)]
    expect(selectDueOccurrences(due, now)).toEqual({
      run: due[2],
      missed: [due[0], due[1]],
    })
  })
  it("runs nothing once the window has closed: there is no late catch-up", () => {
    // Exactly at the deadline is already too late.
    const due = [at(30), at(5)]
    expect(selectDueOccurrences(due, now)).toEqual({ run: null, missed: due })
    expect(selectDueOccurrences([at(6)], now)).toEqual({
      run: null,
      missed: [at(6)],
    })
  })
  it("derives a deterministic UUID intent per occurrence", () => {
    const hash = (input: string) =>
      createHash("sha256").update(input).digest("hex")
    const first = scheduledPublishIntentId(
      "8d4f6c1e-0d6a-4b8e-9a3c-1f2e3d4c5b6a",
      hash
    )
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(
      scheduledPublishIntentId("8d4f6c1e-0d6a-4b8e-9a3c-1f2e3d4c5b6a", hash)
    ).toBe(first)
    expect(
      scheduledPublishIntentId("8d4f6c1e-0d6a-4b8e-9a3c-1f2e3d4c5b6b", hash)
    ).not.toBe(first)
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
    expect(clockChangeCountNote(1)).toBe(
      "1 falls on a clock change (see each time below)"
    )
    expect(clockChangeCountNote(2)).not.toMatch(/moved/)
  })
})
