import { z } from "zod"
import { GOOGLE_DAYS } from "./hours-vocabulary"
import type { GoogleServiceCategory } from "./google-services"

const daySchema = z.enum(GOOGLE_DAYS)
export const googleHoursTimeSchema = z.object({
  hours: z.number().int().min(0).max(24).optional(),
  minutes: z.number().int().min(0).max(59).optional(),
  seconds: z.literal(0).optional(),
  nanos: z.literal(0).optional(),
}).strict().refine((time) => time.hours !== 24 || (time.minutes ?? 0) === 0, "24:00 must have zero minutes.")
type Time = z.infer<typeof googleHoursTimeSchema>

function minutes(time: Time) { return (time.hours ?? 0) * 60 + (time.minutes ?? 0) }
export function googleHoursTimeLabel(time: Time) {
  return `${String(time.hours ?? 0).padStart(2, "0")}:${String(time.minutes ?? 0).padStart(2, "0")}`
}

export const googleHoursPeriodSchema = z.object({
  openDay: daySchema, openTime: googleHoursTimeSchema,
  closeDay: daySchema, closeTime: googleHoursTimeSchema,
}).strict().refine((period) => {
  const difference = (GOOGLE_DAYS.indexOf(period.closeDay) - GOOGLE_DAYS.indexOf(period.openDay)) * 1440 + minutes(period.closeTime) - minutes(period.openTime)
  return difference % 10080 !== 0 && (period.openDay !== period.closeDay || difference > 0)
}, "Closing time must follow opening time; choose the next closing day for overnight hours.")
export type GoogleHoursPeriod = z.infer<typeof googleHoursPeriodSchema>

function interval(period: GoogleHoursPeriod) {
  const start = GOOGLE_DAYS.indexOf(period.openDay) * 1440 + minutes(period.openTime)
  const endDay = GOOGLE_DAYS.indexOf(period.closeDay)
  const end = endDay * 1440 + minutes(period.closeTime)
  return { start, end: end > start ? end : end + 10080 }
}

export const googleOnboardingRegularHoursSchema = z.object({
  periods: z.array(googleHoursPeriodSchema).min(1).max(100),
}).strict().superRefine((hours, context) => {
  const intervals = hours.periods.map(interval)
  for (let index = 0; index < intervals.length; index++) {
    const current = intervals[index]
    for (const other of intervals.slice(0, index)) {
      if ([-10080, 0, 10080].some((offset) => current.start < other.end + offset && current.end > other.start + offset)) {
        context.addIssue({ code: "custom", path: ["periods", index], message: "Opening periods cannot overlap or repeat." })
        break
      }
    }
  }
})
export type GoogleOnboardingRegularHours = z.infer<typeof googleOnboardingRegularHoursSchema>

export const googleOnboardingMoreHoursSchema = z.array(googleOnboardingRegularHoursSchema.safeExtend({
  hoursTypeId: z.string().min(1).refine((value) => value.trim().length > 0, "Choose a supported hours type."),
})).min(1).max(100).refine((hours) => new Set(hours.map((item) => item.hoursTypeId)).size === hours.length, "Each hours type must have one schedule.")
export type GoogleOnboardingMoreHours = z.infer<typeof googleOnboardingMoreHoursSchema>

export function unsupportedOnboardingHoursTypes(hours: GoogleOnboardingMoreHours, categories: readonly GoogleServiceCategory[]) {
  const supported = new Set(categories.flatMap((category) => (category.moreHoursTypes ?? []).map((type) => type.hoursTypeId)))
  return hours.filter((item) => !supported.has(item.hoursTypeId)).map((item) => item.hoursTypeId)
}

export function onboardingMoreHoursMatch(expected: unknown, observed: unknown) {
  const wanted = googleOnboardingMoreHoursSchema.safeParse(expected)
  const found = googleOnboardingMoreHoursSchema.safeParse(observed)
  return wanted.success && found.success && wanted.data.length === found.data.length && wanted.data.every((schedule) => {
    const actual = found.data.find((item) => item.hoursTypeId === schedule.hoursTypeId)
    return actual !== undefined && onboardingHoursMatch({ periods: schedule.periods }, { periods: actual.periods }, false)
  })
}

const dateSchema = z.object({ year: z.number().int().min(1).max(9999), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) }).strict()
  .refine((date) => z.iso.date().safeParse(googleHoursDateLabel(date)).success, "Enter a valid calendar date.")
type DateValue = { readonly year: number; readonly month: number; readonly day: number }
export function googleHoursDateLabel(date: DateValue) { return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}` }

const closedPeriodSchema = z.object({
  startDate: dateSchema, closed: z.literal(true),
  endDate: z.unknown().optional(), openTime: z.unknown().optional(), closeTime: z.unknown().optional(),
}).strict().transform((period) => ({ startDate: period.startDate, closed: true as const }))
const openPeriodSchema = z.object({
  startDate: dateSchema, endDate: dateSchema.optional(), closed: z.literal(false).optional(),
  openTime: googleHoursTimeSchema, closeTime: googleHoursTimeSchema,
}).strict().refine((period) => {
  const dayDifference = (Date.parse(googleHoursDateLabel(period.endDate ?? period.startDate)) - Date.parse(googleHoursDateLabel(period.startDate))) / 86400000
  const duration = dayDifference * 1440 + minutes(period.closeTime) - minutes(period.openTime)
  return (dayDifference === 0 || dayDifference === 1) && duration > 0 && duration < 1440 && (dayDifference === 0 || minutes(period.closeTime) < 720)
}, "Special hours must last less than 24 hours and end on the same date or before noon on the following date.")
export const googleSpecialHourPeriodSchema = z.union([closedPeriodSchema, openPeriodSchema])
export type GoogleSpecialHourPeriod = z.infer<typeof googleSpecialHourPeriodSchema>
export const googleOnboardingSpecialHoursSchema = z.object({
  specialHourPeriods: z.array(googleSpecialHourPeriodSchema).min(1).max(366),
}).strict().superRefine((hours, context) => {
  for (const [index, period] of hours.specialHourPeriods.entries()) {
    const start = Date.parse(googleHoursDateLabel(period.startDate)) / 60000 + (period.closed ? 0 : minutes(period.openTime))
    const end = period.closed ? start + 1440 : Date.parse(googleHoursDateLabel(period.endDate ?? period.startDate)) / 60000 + minutes(period.closeTime)
    for (const other of hours.specialHourPeriods.slice(0, index)) {
      const otherStart = Date.parse(googleHoursDateLabel(other.startDate)) / 60000 + (other.closed ? 0 : minutes(other.openTime))
      const otherEnd = other.closed ? otherStart + 1440 : Date.parse(googleHoursDateLabel(other.endDate ?? other.startDate)) / 60000 + minutes(other.closeTime)
      if (start < otherEnd && end > otherStart) {
        context.addIssue({ code: "custom", path: ["specialHourPeriods", index], message: "Special dates cannot contain overlapping hours or both closed and open periods." })
        break
      }
    }
  }
})
export type GoogleOnboardingSpecialHours = z.infer<typeof googleOnboardingSpecialHoursSchema>

export function googleHoursPeriodLabel(period: GoogleHoursPeriod) {
  const dayLabel = (day: string) => day.charAt(0) + day.slice(1).toLowerCase()
  return `${dayLabel(period.openDay)} ${googleHoursTimeLabel(period.openTime)} to ${dayLabel(period.closeDay)} ${googleHoursTimeLabel(period.closeTime)}`
}
export function googleSpecialHoursPeriodLabel(period: GoogleSpecialHourPeriod) {
  return period.closed ? `${googleHoursDateLabel(period.startDate)}: Closed` : `${googleHoursDateLabel(period.startDate)} ${googleHoursTimeLabel(period.openTime)} to ${googleHoursDateLabel(period.endDate ?? period.startDate)} ${googleHoursTimeLabel(period.closeTime)}`
}

export function onboardingHoursMatch(expected: unknown, observed: unknown, special: boolean) {
  if (special) {
    const wanted = googleOnboardingSpecialHoursSchema.safeParse(expected)
    const found = googleOnboardingSpecialHoursSchema.safeParse(observed)
    return wanted.success && found.success && JSON.stringify(wanted.data.specialHourPeriods.map(googleSpecialHoursPeriodLabel).sort()) === JSON.stringify(found.data.specialHourPeriods.map(googleSpecialHoursPeriodLabel).sort())
  }
  const wanted = googleOnboardingRegularHoursSchema.safeParse(expected)
  const found = googleOnboardingRegularHoursSchema.safeParse(observed)
  return wanted.success && found.success && JSON.stringify(wanted.data.periods.map(googleHoursPeriodLabel).sort()) === JSON.stringify(found.data.periods.map(googleHoursPeriodLabel).sort())
}
