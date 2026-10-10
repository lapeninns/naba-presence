import { afterEach, describe, expect, it, vi } from "vitest"
import { assertBusinessInformationMask, businessInformationPayloadSchema, openingDatesMatch } from "@/lib/domain/business-information"
import { buildLocationUpdate, draftFromLocation } from "@/lib/locations/business-information-draft"
import { locationDiffRows } from "@/lib/locations/google-values"
import { businessInformationLocationUpdateSchema } from "@/lib/contracts/location-business-information"
import { parseListingDraft } from "@/lib/locations/forms/listing-draft"

function parseDate(openingDate: unknown) {
  return businessInformationPayloadSchema.safeParse({ openInfo: { status: "OPEN", openingDate } })
}

afterEach(() => vi.useRealTimers())

describe("Google opening dates", () => {
  it("restores valid date drafts and rejects malformed saved values", () => {
    const initial = draftFromLocation({})
    expect(parseListingDraft(initial)).toEqual(initial)
    expect(parseListingDraft({ ...initial, openingDate: { year: "2000", month: "2", day: "" } })?.openingDate).toEqual({ year: "2000", month: "2", day: "" })
    expect(parseListingDraft({ ...initial, openingDate: { year: 2000, month: 2, day: 1 } })).toBeNull()
    expect(parseListingDraft({ ...initial, openingDate: "yesterday" })).toBeNull()
  })
  it("reviews set and clear without replacing open status or inventing a day", () => {
    const initial = draftFromLocation({ openInfo: { status: "OPEN", openingDate: { year: 2000, month: 3, day: 1 } } })
    const partial = { ...initial, openingDate: { year: "2001", month: "4", day: "" } }
    const update = buildLocationUpdate(initial, partial)
    expect(update).toEqual({ updateMask: ["openInfo.openingDate"], payload: { openInfo: { status: "OPEN", openingDate: { year: 2001, month: 4 } } } })
    expect(locationDiffRows(update.updateMask, initial, partial)[0]).toMatchObject({ currentValue: "1 March 2000", nextValue: "April 2001" })
    const cleared = buildLocationUpdate(initial, { ...initial, openingDate: null })
    expect(cleared).toEqual({ updateMask: ["openInfo.openingDate"], payload: { openInfo: { status: "OPEN" } } })
    expect(() => assertBusinessInformationMask(cleared.payload, cleared.updateMask)).not.toThrow()
    expect(openingDatesMatch({ year: 2000, month: 3 }, undefined)).toBe(false)
    expect(openingDatesMatch(undefined, undefined)).toBe(true)
    expect(openingDatesMatch({}, undefined)).toBe(true)
    expect(openingDatesMatch({ year: 2001, month: 4, day: 0 }, { year: 2001, month: 4 })).toBe(true)
    expect(openingDatesMatch({ year: 2001, month: 4, day: 1 }, { year: 2001, month: 4 })).toBe(false)
  })
  it.each([
    { year: 2024, month: 2 },
    { year: 2024, month: 2, day: 0 },
    { year: 2024, month: 2, day: 29 },
    { year: 2000, month: 2, day: 29 },
    { year: 999, month: 12, day: 31 },
  ])("preserves the supplied precision for %j", (openingDate) => {
    const parsed = parseDate(openingDate)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.openInfo?.openingDate).toEqual(openingDate)
  })

  it.each([
    { year: 2024 },
    { year: 2024, day: 1 },
    { year: 0, month: 2 },
    { year: 2024, month: 0 },
    { year: 2023, month: 2, day: 29 },
    { year: 1900, month: 2, day: 29 },
    { year: 2024, month: 4, day: 31 },
    { year: 2024, month: 2, day: 30 },
    { year: 2024, month: 2, day: -1 },
    { year: 2024, month: 2, day: 1, timezone: "Europe/London" },
  ])("rejects invalid or unsupported dates %j", (openingDate) => {
    expect(parseDate(openingDate).success).toBe(false)
  })

  it("keeps an absent opening date absent", () => {
    expect(businessInformationPayloadSchema.parse({ openInfo: { status: "OPEN" } })).toEqual({ openInfo: { status: "OPEN" } })
  })

  it("bounds future dates without inventing a day for a partial date", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-09-29T12:00:00Z"))
    expect(parseDate({ year: 2027, month: 9, day: 29 }).success).toBe(true)
    expect(parseDate({ year: 2027, month: 9 }).success).toBe(true)
    expect(parseDate({ year: 2027, month: 9, day: 0 }).success).toBe(true)
    expect(parseDate({ year: 2027, month: 9, day: 30 }).success).toBe(false)
    expect(parseDate({ year: 2027, month: 10 }).success).toBe(false)
  })

  it("uses the last valid February day for the next-year limit", () => {
    vi.useFakeTimers().setSystemTime(new Date("2024-02-29T12:00:00Z"))
    expect(parseDate({ year: 2025, month: 2, day: 28 }).success).toBe(true)
    expect(parseDate({ year: 2025, month: 3, day: 1 }).success).toBe(false)
  })

  it("changes only open status when Google holds an opening date and other siblings", () => {
    const initial = draftFromLocation({ openInfo: {
      status: "OPEN", openingDate: { year: 2000, month: 3 }, canReopen: true,
      futureProviderField: "preserve",
    } })
    const draft = { ...initial, openStatus: "CLOSED_TEMPORARILY" }
    const update = buildLocationUpdate(initial, draft)
    expect(update).toEqual({ updateMask: ["openInfo.status"], payload: { openInfo: { status: "CLOSED_TEMPORARILY" } } })
    expect(businessInformationLocationUpdateSchema.safeParse({
      ...update, operation: "update_location", confirmation: "publish_business_information_to_google",
      expectedGoogleHash: "a".repeat(64),
    }).success).toBe(true)
    expect(() => assertBusinessInformationMask(update.payload, update.updateMask)).not.toThrow()
    expect(() => assertBusinessInformationMask({}, update.updateMask)).toThrow("open status is missing")
    expect(locationDiffRows(update.updateMask, initial, draft)).toEqual([
      { key: "openInfo.status", label: "Open status", currentValue: "Open", nextValue: "Temporarily closed" },
    ])
  })
})
