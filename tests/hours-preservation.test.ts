import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  buildGoogleHoursPatch,
  hashHours,
  normalizeGoogleHours,
} from "@/lib/domain/hours"
import {
  hoursInputSchema,
  normalizedHoursSchema,
} from "@/lib/contracts/location-hours"

import { mixedHoursFixture } from "./fixtures/hours-preservation"

function legacyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(legacyJson).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${legacyJson(entry)}`)
      .join(",")}}`
  return JSON.stringify(value)
}

describe("hours preservation", () => {
  it("round trips split, overnight, rollover, equal times, 24h, special dates and distinct synthetic services", () => {
    const normalized = normalizeGoogleHours(mixedHoursFixture)
    const patch = buildGoogleHoursPatch({
      canonical: normalized,
      googleLocation: mixedHoursFixture,
    })
    expect(patch.payload.regularHours).toEqual({
      periods: [
        mixedHoursFixture.regularHours?.periods?.[3],
        mixedHoursFixture.regularHours?.periods?.[0],
        mixedHoursFixture.regularHours?.periods?.[1],
        mixedHoursFixture.regularHours?.periods?.[4],
        mixedHoursFixture.regularHours?.periods?.[5],
        mixedHoursFixture.regularHours?.periods?.[2],
      ],
    })
    expect(patch.payload.moreHours).toEqual([
      mixedHoursFixture.moreHours?.[1],
      mixedHoursFixture.moreHours?.[0],
    ])
    expect(patch.payload.specialHours).toMatchObject({
      specialHourPeriods: [{ endDate: { year: 2027, month: 1, day: 1 } }],
    })
  })

  it("retains provider boundaries through both wire schemas and saves 24:00", () => {
    const normalized = normalizeGoogleHours(mixedHoursFixture)
    expect(hoursInputSchema.safeParse(normalized).success).toBe(true)
    expect(normalizedHoursSchema.parse(normalized)).toEqual(normalized)
  })

  it("preserves existing unknown services without category metadata on a venue-only edit", () => {
    const canonical = normalizeGoogleHours(mixedHoursFixture)
    canonical.regular[1].periods[0].opensAt = "10:00"
    const patch = buildGoogleHoursPatch({
      canonical,
      googleLocation: mixedHoursFixture,
    })
    expect(patch.payload.moreHours).toEqual([
      mixedHoursFixture.moreHours?.[1],
      mixedHoursFixture.moreHours?.[0],
    ])
  })

  it("rejects duplicate service identifiers instead of replacing two entries with one identity", () => {
    const canonical = normalizeGoogleHours(mixedHoursFixture)
    canonical.moreHours.push(canonical.moreHours[0])
    expect(hoursInputSchema.safeParse(canonical).success).toBe(false)
  })

  it("retains the historical same-day hash when explicit boundaries are added", () => {
    const legacy = {
      regular: [
        {
          dayOfWeek: 1,
          isClosed: false,
          periods: [{ opensAt: "11:00", closesAt: "23:00" }],
        },
      ],
      special: [
        {
          effectiveDate: "2026-12-25",
          isClosed: true,
          opensAt: null,
          closesAt: null,
        },
      ],
      moreHours: [
        {
          hoursTypeId: "KITCHEN",
          periods: [{ dayOfWeek: 1, opensAt: "12:00", closesAt: "15:00" }],
        },
      ],
    }
    const explicit = {
      ...legacy,
      regular: [
        {
          ...legacy.regular[0],
          periods: [{ ...legacy.regular[0].periods[0], closeDayOfWeek: 1 }],
        },
      ],
      special: [{ ...legacy.special[0], endDate: "2026-12-25" }],
      moreHours: [
        {
          ...legacy.moreHours[0],
          periods: [{ ...legacy.moreHours[0].periods[0], closeDayOfWeek: 1 }],
        },
      ],
    }
    const oldHash = createHash("sha256")
      .update(legacyJson(legacy))
      .digest("hex")
    expect(hashHours(explicit)).toBe(oldHash)
  })
})

describe("hours replacement guards", () => {
  it("blocks new service IDs when metadata is absent without remapping them", () => {
    const canonical = normalizeGoogleHours({})
    canonical.moreHours = [
      {
        hoursTypeId: "SYNTHETIC_UNSUPPORTED",
        periods: [
          {
            dayOfWeek: 1,
            closeDayOfWeek: 1,
            opensAt: "12:00",
            closesAt: "15:00",
          },
        ],
      },
    ]
    const patch = buildGoogleHoursPatch({ canonical, googleLocation: {} })
    expect(patch.blockingIssues.length).toBe(1)
    expect(patch.payload.moreHours).toMatchObject([
      { hoursTypeId: "SYNTHETIC_UNSUPPORTED" },
    ])
  })

  it("permits distinct IDs advertised by primary and additional category metadata", () => {
    const canonical = normalizeGoogleHours(mixedHoursFixture)
    const patch = buildGoogleHoursPatch({
      canonical,
      googleLocation: {
        categories: {
          primaryCategory: { moreHoursTypes: [{ hoursTypeId: "KITCHEN" }] },
          additionalCategories: [{ moreHoursTypes: [{ hoursTypeId: "BAR" }] }],
        },
      },
    })
    expect(patch.blockingIssues).toEqual([])
    expect(patch.payload.moreHours).toMatchObject([
      { hoursTypeId: "BAR" },
      { hoursTypeId: "KITCHEN" },
    ])
  })

  it("blocks a lossy provider read with sub-minute time precision", () => {
    const location = {
      regularHours: {
        periods: [
          {
            openDay: "MONDAY",
            closeDay: "MONDAY",
            openTime: { hours: 12, seconds: 30 },
            closeTime: { hours: 15 },
          },
        ],
      },
    }
    const patch = buildGoogleHoursPatch({
      canonical: normalizeGoogleHours(location),
      googleLocation: location,
    })
    expect(patch.blockingIssues.length).toBeGreaterThan(0)
  })

  it("preserves provider periods beyond the editor creation limit", () => {
    const canonical = normalizeGoogleHours({})
    canonical.regular[1] = {
      dayOfWeek: 1,
      isClosed: false,
      periods: Array.from({ length: 4 }, (_, index) => ({
        opensAt: `${10 + index * 2}:00`,
        closesAt: `${11 + index * 2}:00`,
        closeDayOfWeek: 1,
      })),
    }
    expect(hoursInputSchema.parse(canonical).regular[1].periods).toHaveLength(4)
  })
})
