// Client-safe hours vocabulary: types, enums and the pure normaliser/drift
// classifier. No node:crypto — hashing lives in lib/domain/hours.ts, which
// re-exports everything here. See lib/domain/README.md.
import type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"

type GoogleTime = string | { hours?: number; minutes?: number } | null

export type GoogleLocationHours = {
  name?: string
  title?: string
  regularHours?: {
    periods?: Array<{
      openDay?: string
      closeDay?: string
      openTime?: GoogleTime
      closeTime?: GoogleTime
    }>
  }
  specialHours?: {
    specialHourPeriods?: Array<{
      startDate?: { year?: number; month?: number; day?: number }
      endDate?: { year?: number; month?: number; day?: number }
      openTime?: GoogleTime
      closeTime?: GoogleTime
      closed?: boolean
    }>
  }
  moreHours?: Array<{
    hoursTypeId?: string
    periods?: Array<{
      openDay?: string
      closeDay?: string
      openTime?: GoogleTime
      closeTime?: GoogleTime
    }>
  }>
  categories?: {
    primaryCategory?: {
      moreHoursTypes?: Array<{
        hoursTypeId?: string
        displayName?: string
        localizedDisplayName?: string
      }>
    }
  }
  metadata?: Record<string, unknown>
}

export type NormalizedHours = {
  regular: Array<{
    dayOfWeek: number
    isClosed: boolean
    periods: Array<{ opensAt: string; closesAt: string }>
  }>
  special: Array<{
    effectiveDate: string
    isClosed: boolean
    opensAt: string | null
    closesAt: string | null
  }>
  moreHours: Array<{
    hoursTypeId: string
    periods: Array<{
      dayOfWeek: number
      opensAt: string
      closesAt: string
    }>
  }>
}

export const HOURS_DRIFT_STATUSES = [
  "in_sync",
  "core_dirty",
  "google_dirty",
  "conflict",
] as const
export type HoursDriftStatus = (typeof HOURS_DRIFT_STATUSES)[number]

/**
 * The Google update-mask entries the hours surface can publish. `satisfies`
 * rejects members the Google contract does not know; an omitted member fails
 * where lib/server/hours.ts assigns its `GoogleHoursUpdateMask[]` to the wire
 * `HoursState`.
 */
export const HOURS_UPDATE_MASKS = [
  "regularHours",
  "specialHours",
  "moreHours",
] as const satisfies readonly GoogleHoursUpdateMask[]

export const GOOGLE_DAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const

function normalizeTime(value: GoogleTime | undefined): string | null {
  if (typeof value === "string") {
    const match = value.match(/^(\d{1,2}):(\d{2})/)
    if (!match) return null
    return `${match[1].padStart(2, "0")}:${match[2]}`
  }
  if (!value || !Number.isInteger(value.hours)) return null
  return `${String(value.hours).padStart(2, "0")}:${String(
    Number.isInteger(value.minutes) ? value.minutes : 0
  ).padStart(2, "0")}`
}

function dayNumber(value: string | undefined): number | null {
  const index = GOOGLE_DAYS.indexOf(
    value?.toUpperCase() as (typeof GOOGLE_DAYS)[number]
  )
  return index >= 0 ? index : null
}

function dateString(value:
  | { year?: number; month?: number; day?: number }
  | undefined
): string | null {
  if (
    !value ||
    !Number.isInteger(value.year) ||
    !Number.isInteger(value.month) ||
    !Number.isInteger(value.day)
  ) {
    return null
  }
  return `${String(value.year).padStart(4, "0")}-${String(
    value.month
  ).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`
}

function emptyRegular(): NormalizedHours["regular"] {
  return GOOGLE_DAYS.map((_, dayOfWeek) => ({
    dayOfWeek,
    isClosed: true,
    periods: [],
  }))
}

export function normalizeGoogleHours(
  location: GoogleLocationHours
): NormalizedHours {
  const regular = emptyRegular()
  for (const period of location.regularHours?.periods ?? []) {
    const dayOfWeek = dayNumber(period.openDay)
    const opensAt = normalizeTime(period.openTime)
    const closesAt = normalizeTime(period.closeTime)
    if (dayOfWeek === null || !opensAt || !closesAt) continue
    regular[dayOfWeek].isClosed = false
    regular[dayOfWeek].periods.push({ opensAt, closesAt })
  }
  for (const day of regular) {
    day.periods.sort((left, right) =>
      left.opensAt.localeCompare(right.opensAt)
    )
  }

  const special = (location.specialHours?.specialHourPeriods ?? [])
    .flatMap((period) => {
      const effectiveDate = dateString(period.startDate)
      if (!effectiveDate) return []
      const isClosed = period.closed === true
      return [{
        effectiveDate,
        isClosed,
        opensAt: isClosed ? null : normalizeTime(period.openTime),
        closesAt: isClosed ? null : normalizeTime(period.closeTime),
      }]
    })
    .sort((left, right) =>
      left.effectiveDate.localeCompare(right.effectiveDate)
    )

  const moreHours = (location.moreHours ?? [])
    .flatMap((entry) => {
      if (!entry.hoursTypeId) return []
      const periods = (entry.periods ?? []).flatMap((period) => {
        const dayOfWeek = dayNumber(period.openDay)
        const opensAt = normalizeTime(period.openTime)
        const closesAt = normalizeTime(period.closeTime)
        return dayOfWeek === null || !opensAt || !closesAt
          ? []
          : [{ dayOfWeek, opensAt, closesAt }]
      })
      return [{ hoursTypeId: entry.hoursTypeId, periods }]
    })
    .sort((left, right) => left.hoursTypeId.localeCompare(right.hoursTypeId))

  return { regular, special, moreHours }
}

export function classifyHoursDrift(input: {
  canonicalHash: string
  googleHash: string
  baselineCanonicalHash: string | null
  baselineGoogleHash: string | null
}): HoursDriftStatus {
  if (input.canonicalHash === input.googleHash) return "in_sync"
  if (!input.baselineCanonicalHash || !input.baselineGoogleHash) {
    return "core_dirty"
  }
  const coreChanged =
    input.canonicalHash !== input.baselineCanonicalHash
  const googleChanged = input.googleHash !== input.baselineGoogleHash
  if (coreChanged && googleChanged) return "conflict"
  if (googleChanged) return "google_dirty"
  return "core_dirty"
}
