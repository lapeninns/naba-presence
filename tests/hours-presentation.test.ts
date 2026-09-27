import { describe, expect, it } from "vitest"
import {
  validateHours,
  withSplitPeriod,
} from "@/lib/editors/hours-presentation"
import { emptyHours } from "@/lib/locations/forms/hours"

describe("hours editor boundary validation", () => {
  it.each(["25:00", "24:01", "noon", "9:61"])(
    "points malformed time %s at its editable field",
    (value) => {
      const hours = emptyHours()
      hours.regular[1] = {
        dayOfWeek: 1,
        isClosed: false,
        periods: [{ opensAt: value, closesAt: "17:00", closeDayOfWeek: 1 }],
      }
      expect(
        validateHours(hours).some(
          (issue) => issue.fieldId === "hours-1-0-opens"
        )
      ).toBe(true)
    }
  )

  it("accepts explicit overnight and 24-hour periods without guessing equal times", () => {
    const hours = emptyHours()
    hours.regular[0] = {
      dayOfWeek: 0,
      isClosed: false,
      periods: [{ opensAt: "18:00", closesAt: "02:00", closeDayOfWeek: 1 }],
    }
    hours.regular[2] = {
      dayOfWeek: 2,
      isClosed: false,
      periods: [{ opensAt: "00:00", closesAt: "24:00", closeDayOfWeek: 2 }],
    }
    hours.regular[4] = {
      dayOfWeek: 4,
      isClosed: false,
      periods: [{ opensAt: "10:00", closesAt: "10:00", closeDayOfWeek: 5 }],
    }
    expect(validateHours(hours)).toEqual([])
  })

  it("rejects an earlier special closing date and overlapping split periods", () => {
    const hours = emptyHours()
    hours.special = [
      {
        effectiveDate: "2026-12-31",
        endDate: "2026-12-30",
        isClosed: false,
        opensAt: "18:00",
        closesAt: "02:00",
      },
    ]
    expect(
      validateHours(hours).some((issue) => issue.fieldId === "special-0-end")
    ).toBe(true)
    hours.special = [
      {
        effectiveDate: "2026-12-31",
        endDate: "2027-01-01",
        isClosed: false,
        opensAt: "18:00",
        closesAt: "02:00",
      },
      {
        effectiveDate: "2027-01-01",
        endDate: "2027-01-01",
        isClosed: false,
        opensAt: "01:00",
        closesAt: "04:00",
      },
    ]
    expect(
      validateHours(hours).some((issue) => issue.fieldId === "special-1-date")
    ).toBe(true)
  })

  it("accepts distinct split special periods on the same date", () => {
    const hours = emptyHours()
    hours.special = [
      {
        effectiveDate: "2026-12-31",
        endDate: "2026-12-31",
        isClosed: false,
        opensAt: "12:00",
        closesAt: "15:00",
      },
      {
        effectiveDate: "2026-12-31",
        endDate: "2027-01-01",
        isClosed: false,
        opensAt: "18:00",
        closesAt: "02:00",
      },
    ]
    expect(validateHours(hours)).toEqual([])
  })

  it("does not split an overnight period by dropping its closing boundary", () => {
    const original = [
      { opensAt: "18:00", closesAt: "02:00", closeDayOfWeek: 1 },
    ]
    expect(withSplitPeriod(original, 0)).toEqual(original)
  })
})
