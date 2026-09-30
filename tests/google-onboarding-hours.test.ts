import { expect, it } from "vitest"
import { googleOnboardingPayloadSchema } from "@/lib/contracts/google-onboarding"
import { googleOnboardingMoreHoursSchema, googleOnboardingRegularHoursSchema, googleOnboardingSpecialHoursSchema, onboardingHoursMatch, unsupportedOnboardingHoursTypes } from "@/lib/domain/google-onboarding-hours"
import { googleServiceCategorySchema } from "@/lib/domain/google-services"
import { onboardingPayloadMatches } from "@/lib/domain/google-onboarding-confirmation"

const monday = { openDay: "MONDAY", closeDay: "MONDAY", openTime: {}, closeTime: { hours: 12 } } as const
const overnight = { openDay: "SATURDAY", closeDay: "SUNDAY", openTime: { hours: 22 }, closeTime: { hours: 2 } } as const
const date = { year: 2026, month: 12, day: 24 }

it("preserves exact provider hour types and checks support across all selected categories", () => {
  const hours = [{ hoursTypeId: "provider:delivery", periods: [monday, overnight] }]
  expect(googleOnboardingPayloadSchema.parse({ moreHours: hours })).toEqual({ moreHours: hours })
  const primary = googleServiceCategorySchema.parse({ name: "gcid:restaurant" })
  const additional = googleServiceCategorySchema.parse({ name: "gcid:shop", moreHoursTypes: [{ hoursTypeId: "provider:delivery", localizedDisplayName: "Delivery" }] })
  expect(unsupportedOnboardingHoursTypes(hours, [primary, additional])).toEqual([])
  expect(unsupportedOnboardingHoursTypes(hours, [primary])).toEqual(["provider:delivery"])
  expect(unsupportedOnboardingHoursTypes([{ ...hours[0], hoursTypeId: "DELIVERY" }], [additional])).toEqual(["DELIVERY"])
})

it.each([
  [], [{ hoursTypeId: " ", periods: [monday] }],
  [{ hoursTypeId: "delivery", periods: [] }],
  [{ hoursTypeId: "delivery", periods: [monday, monday] }],
  [{ hoursTypeId: "delivery", periods: [monday], displayName: "Delivery" }],
  [{ hoursTypeId: "delivery", periods: [monday] }, { hoursTypeId: "delivery", periods: [overnight] }],
].map((hours) => ({ hours })))("rejects invalid or ambiguous additional hours %j", ({ hours }) => {
  expect(googleOnboardingMoreHoursSchema.safeParse(hours).success).toBe(false)
})

it("confirms reordered service schedules and periods while rejecting missing, duplicated or changed schedules", () => {
  const delivery = { hoursTypeId: "provider:delivery", periods: [monday, overnight] }
  const pickup = { hoursTypeId: "provider:pickup", periods: [monday] }
  const expected = { moreHours: [delivery, pickup] }
  expect(onboardingPayloadMatches(expected, { moreHours: [pickup, { ...delivery, periods: [overnight, { ...monday, openTime: { hours: 0, minutes: 0 } }] }] })).toBe(true)
  for (const moreHours of [[delivery], [delivery, delivery], [delivery, { ...pickup, hoursTypeId: "pickup" }], [delivery, { ...pickup, periods: [overnight] }]]) {
    expect(onboardingPayloadMatches(expected, { moreHours })).toBe(false)
  }
})

it("retains exact overnight days and minute precision in creation drafts", () => {
  const payload = { regularHours: { periods: [monday, overnight] }, specialHours: { specialHourPeriods: [{ startDate: date, endDate: { ...date, day: 25 }, openTime: { hours: 13, minutes: 1 }, closeTime: { hours: 11, minutes: 59 } }] } }
  expect(googleOnboardingPayloadSchema.parse(payload)).toEqual(payload)
})

it.each([
  { ...monday, openDay: "DAY_OF_WEEK_UNSPECIFIED" },
  { ...monday, openTime: undefined },
  { ...monday, openTime: { hours: 24, minutes: 1 } },
  { ...monday, closeTime: { hours: 25 } },
  { ...monday, closeTime: { hours: 12, minutes: -1 } },
  { ...monday, closeTime: { seconds: 1 } },
  { ...monday, closeTime: {} },
  { ...monday, openTime: { hours: 24 }, closeDay: "TUESDAY", closeTime: {} },
  { ...monday, openDay: "SUNDAY", openTime: { hours: 24 }, closeTime: {} },
])("rejects invalid weekly periods %j", (period) => {
  expect(googleOnboardingRegularHoursSchema.safeParse({ periods: [period] }).success).toBe(false)
})

it("rejects duplicates and overlapping periods across the week boundary", () => {
  for (const periods of [[monday, monday], [overnight, { ...monday, openDay: "SUNDAY", closeDay: "SUNDAY", closeTime: { hours: 1 } }]]) {
    expect(googleOnboardingRegularHoursSchema.safeParse({ periods }).success).toBe(false)
  }
  expect(googleOnboardingRegularHoursSchema.safeParse({ periods: [monday, { ...monday, openTime: { hours: 12 }, closeTime: { hours: 24 } }] }).success).toBe(true)
})

it.each([
  { startDate: { ...date, month: 2, day: 30 }, closed: true },
  { startDate: date, openTime: {}, closeTime: { hours: 24 } },
  { startDate: date, endDate: { ...date, day: 26 }, openTime: { hours: 13 }, closeTime: { hours: 11 } },
  { startDate: date, endDate: { ...date, day: 25 }, openTime: { hours: 13 }, closeTime: { hours: 12 } },
  { startDate: date, openTime: { hours: 13 }, closeTime: { hours: 11 } },
])("rejects invalid special periods %j", (period) => {
  expect(googleOnboardingSpecialHoursSchema.safeParse({ specialHourPeriods: [period] }).success).toBe(false)
})

it("requires regular hours for special dates and prevents overlapping closed/open proposals", () => {
  const closed = { startDate: date, closed: true }
  expect(googleOnboardingPayloadSchema.safeParse({ specialHours: { specialHourPeriods: [closed] } }).success).toBe(false)
  expect(googleOnboardingSpecialHoursSchema.safeParse({ specialHourPeriods: [closed, { startDate: date, openTime: { hours: 9 }, closeTime: { hours: 17 } }] }).success).toBe(false)
})

it("omits provider-ignored values on closed special dates", () => {
  expect(googleOnboardingSpecialHoursSchema.parse({ specialHourPeriods: [{ startDate: date, closed: true, endDate: "ignored", openTime: {}, closeTime: { hours: 7 } }] })).toEqual({ specialHourPeriods: [{ startDate: date, closed: true }] })
})

it("confirms reordered regular hours and proto3 zeros but rejects changed days and missing periods", () => {
  const expected = { regularHours: { periods: [monday, overnight] } }
  expect(onboardingPayloadMatches(expected, { regularHours: { periods: [overnight, { ...monday, openTime: { hours: 0, minutes: 0 } }] } })).toBe(true)
  for (const periods of [[monday], [monday, monday], [monday, { ...overnight, closeDay: "MONDAY" }]]) {
    expect(onboardingPayloadMatches(expected, { regularHours: { periods } })).toBe(false)
  }
})

it("confirms default special end date and false values without accepting a changed date or closure", () => {
  const expected = { specialHourPeriods: [{ startDate: date, openTime: {}, closeTime: { hours: 2 } }, { startDate: { ...date, day: 25 }, closed: true }] }
  const observed = { specialHourPeriods: [{ startDate: { ...date, day: 25 }, closed: true, closeTime: { hours: 23 } }, { startDate: date, endDate: date, closed: false, openTime: { hours: 0 }, closeTime: { hours: 2, minutes: 0 } }] }
  expect(onboardingHoursMatch(expected, observed, true)).toBe(true)
  expect(onboardingHoursMatch(expected, { specialHourPeriods: [{ startDate: date, closed: true }] }, true)).toBe(false)
  expect(onboardingHoursMatch(expected, { specialHourPeriods: [] }, true)).toBe(false)
})
