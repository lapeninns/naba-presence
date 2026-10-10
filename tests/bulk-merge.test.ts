import { describe, expect, it } from "vitest"

import {
  bulkOperationInputSchema,
  googlePeriod,
  mergeAttributes,
  mergeHours,
} from "@/lib/domain/bulk-merge"

const d = (date: string) => {
  const [year, month, day] = date.split("-").map(Number)
  return { year, month, day }
}

describe("bulk merge", () => {
  it("writes overnight periods closing on the next day", () => {
    expect(googlePeriod(5, "22:00", "02:00")).toEqual({
      openDay: "FRIDAY",
      openTime: { hours: 22, minutes: 0 },
      closeDay: "SATURDAY",
      closeTime: { hours: 2, minutes: 0 },
    })
    expect(googlePeriod(6, "20:00", "01:00").closeDay).toBe("SUNDAY")
    expect(googlePeriod(1, "09:00", "17:00").closeDay).toBe("MONDAY")
  })

  it("replaces only regular hours", () => {
    const input = bulkOperationInputSchema.parse({
      operation: "regular_hours",
      days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        isClosed: dayOfWeek === 0,
        periods:
          dayOfWeek === 0 ? [] : [{ opensAt: "11:00", closesAt: "23:00" }],
      })),
    })
    const merged = mergeHours(input as never, {
      regularHours: { periods: [] },
      specialHours: {
        specialHourPeriods: [{ startDate: d("2026-12-25"), closed: true }],
      },
    })
    expect(merged).toMatchObject({ updateMask: "regularHours" })
    expect(
      "proposed" in merged &&
        (merged.proposed as { periods: unknown[] }).periods
    ).toHaveLength(6)
  })

  it("merges special hours by date, preserving unrelated dates exactly", () => {
    const christmas = {
      startDate: d("2026-12-25"),
      endDate: d("2026-12-25"),
      closed: true,
    }
    const boxing = {
      startDate: d("2026-12-26"),
      endDate: d("2026-12-26"),
      openTime: { hours: 12 },
      closeTime: { hours: 18 },
      closed: false,
    }
    const newYear = {
      startDate: d("2027-01-01"),
      endDate: d("2027-01-01"),
      closed: true,
    }
    const input = bulkOperationInputSchema.parse({
      operation: "special_hours",
      dates: [
        {
          action: "open",
          date: "2026-12-26",
          opensAt: "10:00",
          closesAt: "16:00",
        },
        { action: "clear", date: "2027-01-01" },
        { action: "closed", date: "2026-12-31" },
      ],
    })
    const merged = mergeHours(input as never, {
      specialHours: { specialHourPeriods: [christmas, boxing, newYear] },
    })
    expect(merged).toEqual({
      updateMask: "specialHours",
      current: { specialHourPeriods: [christmas, boxing, newYear] },
      proposed: {
        specialHourPeriods: [
          christmas,
          {
            startDate: d("2026-12-26"),
            endDate: d("2026-12-26"),
            openTime: { hours: 10, minutes: 0 },
            closeTime: { hours: 16, minutes: 0 },
            closed: false,
          },
          {
            startDate: d("2026-12-31"),
            endDate: d("2026-12-31"),
            closed: true,
          },
        ],
      },
    })
  })

  it("changes one exact service-hours type, keeps the others and skips listings without it", () => {
    const input = bulkOperationInputSchema.parse({
      operation: "more_hours",
      hoursTypeId: "KITCHEN",
      periods: [{ dayOfWeek: 5, opensAt: "18:00", closesAt: "00:30" }],
    })
    const brunch = { hoursTypeId: "BRUNCH", periods: [{ openDay: "SUNDAY" }] }
    const supported = {
      categories: {
        primaryCategory: {
          moreHoursTypes: [
            { hoursTypeId: "KITCHEN" },
            { hoursTypeId: "BRUNCH" },
          ],
        },
      },
      moreHours: [brunch, { hoursTypeId: "KITCHEN", periods: [] }],
    }
    expect(mergeHours(input as never, supported)).toEqual({
      updateMask: "moreHours",
      current: supported.moreHours,
      proposed: [
        brunch,
        {
          hoursTypeId: "KITCHEN",
          periods: [googlePeriod(5, "18:00", "00:30")],
        },
      ],
    })
    expect(
      mergeHours(input as never, {
        categories: {
          primaryCategory: { moreHoursTypes: [{ hoursTypeId: "BRUNCH" }] },
        },
      })
    ).toEqual({ skip: "hours_type_not_supported" })
  })

  it("changes only the named attributes and skips a listing that does not offer one", () => {
    const input = bulkOperationInputSchema.parse({
      operation: "attributes",
      changes: [
        {
          name: "attributes/has_wheelchair_accessible_entrance",
          values: [true],
        },
      ],
    })
    const current = [
      {
        name: "attributes/has_wheelchair_accessible_entrance",
        values: [false],
      },
      { name: "attributes/has_wifi", values: [true] },
    ]
    expect(
      mergeAttributes(
        input as never,
        current,
        new Set([
          "attributes/has_wheelchair_accessible_entrance",
          "attributes/has_wifi",
        ])
      )
    ).toEqual({
      attributeMask: ["attributes/has_wheelchair_accessible_entrance"],
      current: [current[0]],
      proposed: [
        {
          name: "attributes/has_wheelchair_accessible_entrance",
          values: [true],
        },
      ],
    })
    expect(
      mergeAttributes(input as never, current, new Set(["attributes/has_wifi"]))
    ).toMatchObject({ skip: "attribute_not_offered" })
  })

  it("rejects ambiguous or unbounded input", () => {
    expect(
      bulkOperationInputSchema.safeParse({
        operation: "special_hours",
        dates: [
          { action: "closed", date: "2026-12-25" },
          { action: "clear", date: "2026-12-25" },
        ],
      }).success
    ).toBe(false)
    expect(
      bulkOperationInputSchema.safeParse({
        operation: "special_hours",
        dates: [],
      }).success
    ).toBe(false)
    expect(
      bulkOperationInputSchema.safeParse({
        operation: "place_action",
        action: "upsert",
        placeActionType: "SHOP_ONLINE",
        uri: "javascript:alert(1)",
      }).success
    ).toBe(false)
    expect(
      bulkOperationInputSchema.safeParse({
        operation: "arbitrary_json",
        payload: {},
      }).success
    ).toBe(false)
  })
})
