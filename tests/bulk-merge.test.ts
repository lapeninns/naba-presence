import { describe, expect, it } from "vitest"

import { bulkPreviewRequestSchema } from "@/lib/contracts/bulk-listings"
import {
  BULK_DISPATCH_TTL_MS,
  BULK_MAX_RUNNING_PER_ORGANISATION,
  BULK_MAX_TARGETS,
  BULK_PREVIEW_TTL_MS,
  bulkOperationInputSchema,
  bulkResourceKey,
  applyBulkHours,
  bulkHoursSelection,
  googlePeriod,
  mergeAttributes,
} from "@/lib/domain/bulk-merge"
import {
  buildGoogleHoursPatch,
  normalizeGoogleHours,
  type GoogleLocationHours,
} from "@/lib/domain/hours"

const d = (date: string) => {
  const [year, month, day] = date.split("-").map(Number)
  return { year, month, day }
}

describe("bulk limits (plan P09)", () => {
  const input = {
    operation: "special_hours",
    dates: [{ action: "closed", date: "2026-12-25" }],
  }
  const ids = (count: number) =>
    Array.from({ length: count }, () => crypto.randomUUID())

  it("caps a batch at 50 listings, with 15-minute previews, 24-hour dispatch and 2 running per organisation", () => {
    expect(BULK_MAX_TARGETS).toBe(50)
    expect(BULK_PREVIEW_TTL_MS).toBe(15 * 60_000)
    expect(BULK_DISPATCH_TTL_MS).toBe(24 * 3_600_000)
    expect(BULK_MAX_RUNNING_PER_ORGANISATION).toBe(2)
    expect(
      bulkPreviewRequestSchema.safeParse({ locationIds: ids(50), input }).success
    ).toBe(true)
    expect(
      bulkPreviewRequestSchema.safeParse({ locationIds: ids(51), input }).success
    ).toBe(false)
  })

  it("serialises the three hours families on one resource and keeps attributes and action links apart", () => {
    expect(bulkResourceKey("regular_hours")).toBe("hours")
    expect(bulkResourceKey("special_hours")).toBe("hours")
    expect(bulkResourceKey("more_hours")).toBe("hours")
    expect(bulkResourceKey("attributes")).toBe("attributes")
    expect(bulkResourceKey("place_action")).toBe("place_actions")
  })
})

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

  const google = (location: GoogleLocationHours) => ({
    location,
    hours: normalizeGoogleHours(location),
  })
  const publish = (
    input: Parameters<typeof applyBulkHours>[0],
    location: GoogleLocationHours
  ) => {
    const live = google(location)
    return buildGoogleHoursPatch({
      canonical: applyBulkHours(input, live.hours),
      googleLocation: location,
      selection: bulkHoursSelection(input),
    })
  }
  const monday = {
    openDay: "MONDAY",
    closeDay: "MONDAY",
    openTime: { hours: 9 },
    closeTime: { hours: 17 },
  }
  const tuesday = { ...monday, openDay: "TUESDAY", closeDay: "TUESDAY" }

  it("changes only the selected weekdays and writes the others back as Google holds them", () => {
    const input = bulkOperationInputSchema.parse({
      operation: "regular_hours",
      days: [
        {
          dayOfWeek: 5,
          isClosed: false,
          periods: [{ opensAt: "22:00", closesAt: "02:00" }],
        },
        { dayOfWeek: 2, isClosed: true, periods: [] },
      ],
    })
    if (input.operation !== "regular_hours") throw new Error("parse")
    expect(bulkHoursSelection(input)).toEqual({ regularDays: [2, 5] })
    const patch = publish(input, { regularHours: { periods: [monday, tuesday] } })
    expect(patch.blockingIssues).toEqual([])
    expect(patch.updateMask).toEqual(["regularHours"])
    expect(patch.payload.regularHours).toEqual({
      periods: [
        {
          openDay: "MONDAY",
          closeDay: "MONDAY",
          openTime: { hours: 9, minutes: 0 },
          closeTime: { hours: 17, minutes: 0 },
        },
        // Overnight: closes on the next day, explicitly.
        {
          openDay: "FRIDAY",
          closeDay: "SATURDAY",
          openTime: { hours: 22, minutes: 0 },
          closeTime: { hours: 2, minutes: 0 },
        },
      ],
    })
    // A whole week is all seven days.
    const week = bulkOperationInputSchema.parse({
      operation: "regular_hours",
      days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        isClosed: dayOfWeek === 0,
        periods:
          dayOfWeek === 0 ? [] : [{ opensAt: "11:00", closesAt: "23:00" }],
      })),
    })
    if (week.operation !== "regular_hours") throw new Error("parse")
    expect(bulkHoursSelection(week).regularDays).toHaveLength(7)
    expect(
      (publish(week, { regularHours: { periods: [monday] } }).payload
        .regularHours as { periods: unknown[] }).periods
    ).toHaveLength(6)
    expect(
      bulkOperationInputSchema.safeParse({
        operation: "regular_hours",
        days: [
          { dayOfWeek: 1, isClosed: true, periods: [] },
          { dayOfWeek: 1, isClosed: true, periods: [] },
        ],
      }).success
    ).toBe(false)
  })

  it("upserts and removes special dates by date, preserving unrelated dates exactly", () => {
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
    if (input.operation !== "special_hours") throw new Error("parse")
    expect(bulkHoursSelection(input)).toEqual({
      specialDates: ["2026-12-26", "2026-12-31", "2027-01-01"],
    })
    const patch = publish(input, {
      specialHours: { specialHourPeriods: [christmas, boxing, newYear] },
    })
    expect(patch.updateMask).toEqual(["specialHours"])
    expect(patch.payload.specialHours).toEqual({
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
    })
  })

  it("replaces or removes one exact service-hours type and keeps the others", () => {
    const input = bulkOperationInputSchema.parse({
      operation: "more_hours",
      hoursTypeId: "KITCHEN",
      periods: [{ dayOfWeek: 5, opensAt: "18:00", closesAt: "00:30" }],
    })
    if (input.operation !== "more_hours") throw new Error("parse")
    const brunch = {
      hoursTypeId: "BRUNCH",
      periods: [{ ...monday, openDay: "SUNDAY", closeDay: "SUNDAY" }],
    }
    const location = {
      categories: {
        primaryCategory: {
          moreHoursTypes: [
            { hoursTypeId: "KITCHEN" },
            { hoursTypeId: "BRUNCH" },
          ],
        },
      },
      moreHours: [brunch, { hoursTypeId: "KITCHEN", periods: [monday] }],
    }
    expect(bulkHoursSelection(input)).toEqual({ moreHoursTypes: ["KITCHEN"] })
    const patch = publish(input, location)
    expect(patch.blockingIssues).toEqual([])
    expect(
      normalizeGoogleHours({
        moreHours: patch.payload.moreHours,
      } as GoogleLocationHours).moreHours
    ).toEqual([
      normalizeGoogleHours({ moreHours: [brunch] }).moreHours[0],
      {
        hoursTypeId: "KITCHEN",
        periods: [
          {
            dayOfWeek: 5,
            opensAt: "18:00",
            closesAt: "00:30",
            closeDayOfWeek: 6,
          },
        ],
      },
    ])
    const removal = bulkOperationInputSchema.parse({
      operation: "more_hours",
      hoursTypeId: "KITCHEN",
      periods: [],
    })
    if (removal.operation !== "more_hours") throw new Error("parse")
    expect(
      applyBulkHours(removal, google(location).hours).moreHours.map(
        (entry) => entry.hoursTypeId
      )
    ).toEqual(["BRUNCH"])
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
