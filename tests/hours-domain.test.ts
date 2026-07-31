import { describe, expect, it } from "vitest"

import {
  buildGoogleHoursPatch,
  classifyHoursDrift,
  normalizeGoogleHours,
  type NormalizedHours,
} from "@/lib/domain/hours"

const canonical: NormalizedHours = {
  regular: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isClosed: dayOfWeek !== 1,
    periods: dayOfWeek === 1 ? [{ opensAt: "11:00", closesAt: "23:00" }] : [],
  })),
  special: [{ effectiveDate: "2026-12-25", isClosed: true, opensAt: null, closesAt: null }],
  moreHours: [{ hoursTypeId: "KITCHEN", periods: [{ dayOfWeek: 1, opensAt: "12:00", closesAt: "15:00" }] }],
}

describe("standalone hours domain", () => {
  it("normalizes Google schedules to the canonical NabaPresence shape", () => {
    const google = normalizeGoogleHours({
      regularHours: { periods: [{ openDay: "MONDAY", closeDay: "MONDAY", openTime: { hours: 11 }, closeTime: { hours: 23 } }] },
      specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 12, day: 25 }, closed: true }] },
      moreHours: [{ hoursTypeId: "KITCHEN", periods: [{ openDay: "MONDAY", closeDay: "MONDAY", openTime: { hours: 12 }, closeTime: { hours: 15 } }] }],
    })
    expect(google).toEqual(canonical)
  })

  it("distinguishes local, Google, and two-sided drift", () => {
    expect(classifyHoursDrift({ canonicalHash: "same", googleHash: "same", baselineCanonicalHash: null, baselineGoogleHash: null })).toBe("in_sync")
    expect(classifyHoursDrift({ canonicalHash: "local", googleHash: "base", baselineCanonicalHash: "base", baselineGoogleHash: "base" })).toBe("core_dirty")
    expect(classifyHoursDrift({ canonicalHash: "base", googleHash: "google", baselineCanonicalHash: "base", baselineGoogleHash: "base" })).toBe("google_dirty")
    expect(classifyHoursDrift({ canonicalHash: "local", googleHash: "google", baselineCanonicalHash: "base", baselineGoogleHash: "base" })).toBe("conflict")
  })

  it("builds the Google patch directly from NabaPresence canonical data", () => {
    const result = buildGoogleHoursPatch({
      canonical,
      googleLocation: { categories: { primaryCategory: { moreHoursTypes: [{ hoursTypeId: "KITCHEN" }] } } },
    })
    expect(result.updateMask).toEqual(["regularHours", "specialHours", "moreHours"])
    expect(result.payload).toMatchObject({
      regularHours: { periods: [{ openDay: "MONDAY", closeDay: "MONDAY", openTime: { hours: 11, minutes: 0 }, closeTime: { hours: 23, minutes: 0 } }] },
      specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 12, day: 25 }, closed: true }] },
      moreHours: [{ hoursTypeId: "KITCHEN", periods: [{ openDay: "MONDAY", closeDay: "MONDAY" }] }],
    })
  })
})
