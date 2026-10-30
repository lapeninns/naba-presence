import { describe, expect, it } from "vitest"

import {
  englandBankHolidays,
  londonDate,
  nextBankHoliday,
} from "@/lib/listings/completeness-calendar"

function dates(year: number): string[] {
  return englandBankHolidays(year).map((h) => h.date)
}

function holiday(year: number, date: string) {
  return englandBankHolidays(year).find((h) => h.date === date)
}

describe("englandBankHolidays", () => {
  it("lists the 2026 England and Wales bank holidays, with the Boxing Day substitute", () => {
    expect(dates(2026)).toEqual([
      "2026-01-01",
      "2026-04-03",
      "2026-04-06",
      "2026-05-04",
      "2026-05-25",
      "2026-08-31",
      "2026-12-25",
      "2026-12-26",
      "2026-12-28",
    ])
  })

  it("lists 2027, where Christmas falls on a Saturday (two substitute days)", () => {
    expect(dates(2027)).toEqual([
      "2027-01-01",
      "2027-03-26",
      "2027-03-29",
      "2027-05-03",
      "2027-05-31",
      "2027-08-30",
      "2027-12-25",
      "2027-12-26",
      "2027-12-27",
      "2027-12-28",
    ])
  })

  it("returns dates in ascending order with a name on every entry", () => {
    for (const year of [2022, 2023, 2026, 2027, 2028]) {
      const list = dates(year)
      expect(list).toEqual([...list].sort())
      for (const h of englandBankHolidays(year)) {
        expect(h.date).toMatch(new RegExp(`^${year}-\\d{2}-\\d{2}$`))
        expect(h.name.length).toBeGreaterThan(0)
      }
    }
  })

  it("names Good Friday, Christmas Day and Boxing Day", () => {
    expect(holiday(2026, "2026-04-03")?.name).toContain("Good Friday")
    expect(holiday(2026, "2026-12-25")?.name).toContain("Christmas Day")
    expect(holiday(2026, "2026-12-26")?.name).toContain("Boxing Day")
  })

  it("names substitute days after the holiday they replace", () => {
    // 2026: Boxing Day is a Saturday, substitute Monday 28th.
    const boxingSub = holiday(2026, "2026-12-28")
    expect(boxingSub?.name).toContain("Boxing Day")
    expect(boxingSub?.name.endsWith("(substitute day)")).toBe(true)

    // 2027: Christmas Saturday → Mon 27 (Christmas), Tue 28 (Boxing Day).
    const xmasSub = holiday(2027, "2027-12-27")
    expect(xmasSub?.name).toContain("Christmas Day")
    expect(xmasSub?.name.endsWith("(substitute day)")).toBe(true)
    const boxing2027 = holiday(2027, "2027-12-28")
    expect(boxing2027?.name).toContain("Boxing Day")
    expect(boxing2027?.name.endsWith("(substitute day)")).toBe(true)
  })

  it("does not mark actual-date holidays as substitutes", () => {
    for (const date of ["2026-12-25", "2026-12-26", "2026-01-01"]) {
      expect(holiday(2026, date)?.name).not.toContain("substitute")
    }
  })

  it("adds a Monday 3 January substitute when New Year's Day is a Saturday", () => {
    // 1 Jan 2022 and 1 Jan 2028 are Saturdays.
    for (const year of [2022, 2028]) {
      const list = dates(year)
      expect(list).toContain(`${year}-01-01`)
      expect(list).toContain(`${year}-01-03`)
      expect(list).not.toContain(`${year}-01-02`)
      expect(
        holiday(year, `${year}-01-03`)?.name.endsWith("(substitute day)")
      ).toBe(true)
    }
  })

  it("adds a Monday 2 January substitute when New Year's Day is a Sunday", () => {
    // 1 Jan 2023 is a Sunday.
    const list = dates(2023)
    expect(list).toContain("2023-01-01")
    expect(list).toContain("2023-01-02")
    expect(list).not.toContain("2023-01-03")
    expect(holiday(2023, "2023-01-02")?.name.endsWith("(substitute day)")).toBe(
      true
    )
  })

  it("has no New Year substitute when 1 January is a weekday", () => {
    // 2026-01-01 Thu, 2027-01-01 Fri.
    expect(dates(2026).filter((d) => d.startsWith("2026-01"))).toEqual([
      "2026-01-01",
    ])
    expect(dates(2027).filter((d) => d.startsWith("2027-01"))).toEqual([
      "2027-01-01",
    ])
  })

  it("moves Christmas to Tuesday 27th when 25 December is a Sunday", () => {
    // 25 Dec 2022 is a Sunday: Boxing Day Mon 26 is itself, Christmas sub Tue 27.
    const december = dates(2022).filter((d) => d.startsWith("2022-12"))
    expect(december).toEqual(["2022-12-25", "2022-12-26", "2022-12-27"])
    const sub = holiday(2022, "2022-12-27")
    expect(sub?.name).toContain("Christmas Day")
    expect(sub?.name.endsWith("(substitute day)")).toBe(true)
    expect(holiday(2022, "2022-12-26")?.name).not.toContain("substitute")
  })

  it("has no Christmas substitutes when 25 and 26 December are weekdays", () => {
    // 25 Dec 2024 Wed, 25 Dec 2025 Thu.
    expect(dates(2024).filter((d) => d.startsWith("2024-12"))).toEqual([
      "2024-12-25",
      "2024-12-26",
    ])
    expect(dates(2025).filter((d) => d.startsWith("2025-12"))).toEqual([
      "2025-12-25",
      "2025-12-26",
    ])
  })

  it.each([
    [2024, "2024-03-29", "2024-04-01"], // Easter 31 Mar
    [2025, "2025-04-18", "2025-04-21"], // Easter 20 Apr
    [2026, "2026-04-03", "2026-04-06"], // Easter 5 Apr
    [2027, "2027-03-26", "2027-03-29"], // Easter 28 Mar
    [2038, "2038-04-23", "2038-04-26"], // Easter 25 Apr
  ])(
    "puts Good Friday and Easter Monday %i around Gregorian Easter",
    (year, goodFriday, easterMonday) => {
      const list = dates(year)
      expect(list).toContain(goodFriday)
      expect(list).toContain(easterMonday)
      expect(holiday(year, goodFriday)?.name).toContain("Good Friday")
    }
  )

  it("uses the first and last Mondays of May and the last Monday of August", () => {
    // 2025: May 5, May 26, Aug 25.
    const list = dates(2025)
    expect(list).toContain("2025-05-05")
    expect(list).toContain("2025-05-26")
    expect(list).toContain("2025-08-25")
  })
})

describe("londonDate", () => {
  it("uses GMT after the clocks go back", () => {
    expect(londonDate(new Date("2026-10-30T23:30:00Z"))).toBe("2026-10-30")
  })

  it("uses BST in summer, rolling over to the next day before UTC midnight", () => {
    expect(londonDate(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02")
  })

  it("is the plain UTC date at midday", () => {
    expect(londonDate(new Date("2026-11-15T12:00:00Z"))).toBe("2026-11-15")
  })
})

describe("nextBankHoliday", () => {
  it("is null when the next holiday is beyond the window", () => {
    // Christmas is 56 days after 30 Oct 2026.
    expect(nextBankHoliday(new Date("2026-10-30T12:00:00Z"), 45)).toBeNull()
  })

  it("finds Christmas Day from mid-November", () => {
    const h = nextBankHoliday(new Date("2026-11-15T12:00:00Z"), 45)
    expect(h?.date).toBe("2026-12-25")
    expect(h?.name).toContain("Christmas Day")
  })

  it("includes the last day of the window", () => {
    // 15 Nov → 25 Dec is exactly 40 days.
    expect(nextBankHoliday(new Date("2026-11-15T12:00:00Z"), 40)?.date).toBe(
      "2026-12-25"
    )
    expect(nextBankHoliday(new Date("2026-11-15T12:00:00Z"), 39)).toBeNull()
  })

  it("returns the holiday on the day itself", () => {
    expect(nextBankHoliday(new Date("2026-12-25T10:00:00Z"), 0)?.date).toBe(
      "2026-12-25"
    )
    expect(nextBankHoliday(new Date("2026-12-25T10:00:00Z"), 45)?.date).toBe(
      "2026-12-25"
    )
  })

  it("finds a substitute day", () => {
    const h = nextBankHoliday(new Date("2026-12-27T12:00:00Z"), 45)
    expect(h?.date).toBe("2026-12-28")
    expect(h?.name).toContain("Boxing Day")
  })

  it("looks into next year", () => {
    const h = nextBankHoliday(new Date("2026-12-29T12:00:00Z"), 45)
    expect(h?.date).toBe("2027-01-01")
  })

  it("counts from today's date in London, not UTC", () => {
    // 23:30 UTC on 30 Aug 2026 is already 31 Aug (Summer bank holiday) in BST.
    expect(nextBankHoliday(new Date("2026-08-30T23:30:00Z"), 0)?.date).toBe(
      "2026-08-31"
    )
  })
})
