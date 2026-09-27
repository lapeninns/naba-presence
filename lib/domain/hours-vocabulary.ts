// Client-safe hours vocabulary: types, enums and the pure normaliser/drift
// classifier. No node:crypto — hashing lives in lib/domain/hours.ts, which
// re-exports everything here. See lib/domain/README.md.
import type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"

type GoogleTime =
  | string
  | { hours?: number; minutes?: number; seconds?: number; nanos?: number }
  | null

export type GoogleHoursType = {
  readonly hoursTypeId?: string
  readonly displayName?: string
  readonly localizedDisplayName?: string
}

export type GoogleHoursCategory = {
  readonly name?: string
  readonly moreHoursTypes?: GoogleHoursType[]
}

export type GoogleLocationHours = {
  languageCode?: string
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
    primaryCategory?: GoogleHoursCategory
    additionalCategories?: GoogleHoursCategory[]
  }

  metadata?: Record<string, unknown>
}

export type NormalizedHours = {
  regular: Array<{
    dayOfWeek: number
    isClosed: boolean
    periods: Array<{
      opensAt: string
      closesAt: string
      closeDayOfWeek?: number
    }>
  }>
  special: Array<{
    effectiveDate: string
    endDate?: string
    isClosed: boolean
    opensAt: string | null
    closesAt: string | null
  }>
  moreHours: Array<{
    hoursTypeId: string
    periods: Array<{
      dayOfWeek: number
      closeDayOfWeek?: number
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
  if (!value) return null
  return `${String(value.hours ?? 0).padStart(2, "0")}:${String(
    Number.isInteger(value.minutes) ? value.minutes : 0
  ).padStart(2, "0")}`
}

function dayNumber(value: string | undefined): number | null {
  const index = GOOGLE_DAYS.indexOf(
    value?.toUpperCase() as (typeof GOOGLE_DAYS)[number]
  )
  return index >= 0 ? index : null
}

function dateString(
  value: { year?: number; month?: number; day?: number } | undefined
): string | null {
  if (
    !value ||
    !Number.isInteger(value.year) ||
    !Number.isInteger(value.month) ||
    !Number.isInteger(value.day)
  ) {
    return null
  }
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(
    2,
    "0"
  )}-${String(value.day).padStart(2, "0")}`
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
    const closeDayOfWeek = dayNumber(period.closeDay)
    regular[dayOfWeek].periods.push({
      opensAt,
      closesAt,
      ...(closeDayOfWeek === null ? {} : { closeDayOfWeek }),
    })
  }
  for (const day of regular) {
    day.periods.sort((left, right) => left.opensAt.localeCompare(right.opensAt))
  }

  const special = (location.specialHours?.specialHourPeriods ?? [])
    .flatMap((period) => {
      const effectiveDate = dateString(period.startDate)
      if (!effectiveDate) return []
      const isClosed = period.closed === true
      return [
        {
          effectiveDate,
          endDate: dateString(period.endDate) ?? effectiveDate,
          isClosed,
          opensAt: isClosed ? null : normalizeTime(period.openTime),
          closesAt: isClosed ? null : normalizeTime(period.closeTime),
        },
      ]
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
          : [
              {
                dayOfWeek,
                opensAt,
                closesAt,
                ...(dayNumber(period.closeDay) === null
                  ? {}
                  : {
                      closeDayOfWeek: dayNumber(period.closeDay) ?? dayOfWeek,
                    }),
              },
            ]
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
  const coreChanged = input.canonicalHash !== input.baselineCanonicalHash
  const googleChanged = input.googleHash !== input.baselineGoogleHash
  if (coreChanged && googleChanged) return "conflict"
  if (googleChanged) return "google_dirty"
  return "core_dirty"
}

/** Same-day boundaries are redundant; omitting them preserves historical hashes. */
export function semanticHours(value: NormalizedHours): NormalizedHours {
  return {
    regular: value.regular.map((day) => ({
      ...day,
      periods: day.periods.map(({ closeDayOfWeek, ...period }) => ({
        ...period,
        ...(closeDayOfWeek === undefined || closeDayOfWeek === day.dayOfWeek
          ? {}
          : { closeDayOfWeek }),
      })),
    })),
    special: value.special.map(({ endDate, ...period }) => ({
      ...period,
      ...(endDate === undefined || endDate === period.effectiveDate
        ? {}
        : { endDate }),
    })),
    moreHours: value.moreHours.map((entry) => ({
      ...entry,
      periods: entry.periods.map(({ closeDayOfWeek, ...period }) => ({
        ...period,
        ...(closeDayOfWeek === undefined || closeDayOfWeek === period.dayOfWeek
          ? {}
          : { closeDayOfWeek }),
      })),
    })),
  }
}

export function supportedHoursTypes(
  location: GoogleLocationHours
): Array<{ hoursTypeId: string; displayName: string }> {
  const types = new Map<string, { hoursTypeId: string; displayName: string }>()
  for (const category of [
    location.categories?.primaryCategory,
    ...(location.categories?.additionalCategories ?? []),
  ]) {
    for (const type of category?.moreHoursTypes ?? []) {
      if (type.hoursTypeId)
        types.set(type.hoursTypeId, {
          hoursTypeId: type.hoursTypeId,
          displayName:
            type.localizedDisplayName ?? type.displayName ?? type.hoursTypeId,
        })
    }
  }
  return [...types.values()]
}

/** A legacy end boundary is uncertain when it could have been discarded on import. */
export function hoursBoundaryReconciliationRequired(
  canonical: NormalizedHours,
  location: GoogleLocationHours
): boolean {
  const google = normalizeGoogleHours(location)
  const weekly = (
    periods: NormalizedHours["moreHours"][number]["periods"],
    observed: NormalizedHours["moreHours"][number]["periods"]
  ) =>
    periods.some(
      (period) =>
        period.closeDayOfWeek === undefined &&
        (period.closesAt <= period.opensAt ||
          observed.some(
            (other) =>
              other.dayOfWeek === period.dayOfWeek &&
              other.opensAt === period.opensAt &&
              other.closesAt === period.closesAt &&
              other.closeDayOfWeek !== period.dayOfWeek
          ))
    )
  if (
    weekly(
      canonical.regular.flatMap((day) =>
        day.periods.map((period) => ({ ...period, dayOfWeek: day.dayOfWeek }))
      ),
      google.regular.flatMap((day) =>
        day.periods.map((period) => ({ ...period, dayOfWeek: day.dayOfWeek }))
      )
    )
  )
    return true
  if (
    canonical.moreHours.some((entry) =>
      weekly(
        entry.periods,
        google.moreHours.find(
          (other) => other.hoursTypeId === entry.hoursTypeId
        )?.periods ?? []
      )
    )
  )
    return true
  return canonical.special.some(
    (period) =>
      !period.isClosed &&
      period.endDate === undefined &&
      ((period.closesAt ?? "") <= (period.opensAt ?? "") ||
        google.special.some(
          (other) =>
            other.effectiveDate === period.effectiveDate &&
            other.opensAt === period.opensAt &&
            other.closesAt === period.closesAt &&
            other.endDate !== period.effectiveDate
        ))
  )
}

/** Only the explicit reconciliation action may use this candidate; it never changes local times. */
export function reconcileLegacyHoursBoundaries(
  canonical: NormalizedHours,
  google: NormalizedHours
): NormalizedHours {
  const resolve = (
    periods: NormalizedHours["moreHours"][number]["periods"],
    observed: NormalizedHours["moreHours"][number]["periods"]
  ) =>
    periods.map((period) => {
      if (period.closeDayOfWeek !== undefined) return { ...period }
      const matches = observed.filter(
        (other) =>
          other.dayOfWeek === period.dayOfWeek &&
          other.opensAt === period.opensAt &&
          other.closesAt === period.closesAt
      )
      return matches.length === 1 && matches[0].closeDayOfWeek !== undefined
        ? { ...period, closeDayOfWeek: matches[0].closeDayOfWeek }
        : { ...period }
    })
  return {
    regular: canonical.regular.map((day) => ({
      ...day,
      periods: resolve(
        day.periods.map((period) => ({ ...period, dayOfWeek: day.dayOfWeek })),
        google.regular.flatMap((entry) =>
          entry.periods.map((period) => ({
            ...period,
            dayOfWeek: entry.dayOfWeek,
          }))
        )
      ).map(({ opensAt, closesAt, closeDayOfWeek }) => ({
        opensAt,
        closesAt,
        ...(closeDayOfWeek === undefined ? {} : { closeDayOfWeek }),
      })),
    })),
    moreHours: canonical.moreHours.map((entry) => ({
      ...entry,
      periods: resolve(
        entry.periods,
        google.moreHours.find(
          (other) => other.hoursTypeId === entry.hoursTypeId
        )?.periods ?? []
      ),
    })),
    special: canonical.special.map((period) => {
      if (period.endDate !== undefined) return { ...period }
      const matches = google.special.filter(
        (other) =>
          other.effectiveDate === period.effectiveDate &&
          other.isClosed === period.isClosed &&
          other.opensAt === period.opensAt &&
          other.closesAt === period.closesAt
      )
      return matches.length === 1
        ? { ...period, endDate: matches[0].endDate }
        : { ...period }
    }),
  }
}

/** Never let a lossy read become a whole-resource replacement. */
export function googleHoursRepresentationIssues(
  location: GoogleLocationHours
): string[] {
  const issues: string[] = []
  const validTime = (value: GoogleTime | undefined) => {
    const normalized = normalizeTime(value)
    if (!normalized || !/^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(normalized))
      return false
    if (typeof value === "string")
      return /^\d{1,2}:\d{2}(?::00(?:\.0+)?)?$/.test(value)
    return !value?.seconds && !value?.nanos
  }
  const weekly = [
    ...(location.regularHours?.periods ?? []),
    ...(location.moreHours ?? []).flatMap((entry) => entry.periods ?? []),
  ]
  if (
    weekly.some(
      (period) =>
        dayNumber(period.openDay) === null ||
        dayNumber(period.closeDay) === null ||
        !validTime(period.openTime) ||
        !validTime(period.closeTime)
    )
  ) {
    issues.push(
      "Google contains weekly hours this editor cannot represent exactly. Publishing is blocked to preserve them."
    )
  }
  const ids = (location.moreHours ?? []).map((entry) => entry.hoursTypeId)
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
    issues.push(
      "Google contains missing or duplicate service identifiers. Publishing is blocked to preserve them."
    )
  if (
    (location.specialHours?.specialHourPeriods ?? []).some(
      (period) =>
        !dateString(period.startDate) ||
        (period.endDate !== undefined && !dateString(period.endDate)) ||
        (!period.closed &&
          (!validTime(period.openTime) || !validTime(period.closeTime)))
    )
  ) {
    issues.push(
      "Google contains special hours this editor cannot represent exactly. Publishing is blocked to preserve them."
    )
  }
  return issues
}

export function hasLegacyHoursBoundaries(hours: NormalizedHours): boolean {
  return (
    hours.regular.some((day) =>
      day.periods.some((period) => period.closeDayOfWeek === undefined)
    ) ||
    hours.moreHours.some((entry) =>
      entry.periods.some((period) => period.closeDayOfWeek === undefined)
    ) ||
    hours.special.some((period) => period.endDate === undefined)
  )
}
