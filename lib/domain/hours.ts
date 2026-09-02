// Server-only (imports node:crypto). The client-safe vocabulary, normaliser
// and drift classifier live in lib/domain/hours-vocabulary.ts and are
// re-exported here so existing imports keep working.
import { createHash } from "node:crypto"

import type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"
import {
  GOOGLE_DAYS,
  type GoogleLocationHours,
  type NormalizedHours,
} from "@/lib/domain/hours-vocabulary"

export * from "@/lib/domain/hours-vocabulary"

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function hashHours(value: NormalizedHours): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function toGoogleTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number)
  return { hours, minutes }
}

function toGoogleDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return { year, month, day }
}

function kitchenHoursType(location: GoogleLocationHours): string | null {
  const current = location.moreHours?.find((entry) =>
    entry.hoursTypeId?.toLowerCase().includes("kitchen")
  )?.hoursTypeId
  if (current) return current
  const supported =
    location.categories?.primaryCategory?.moreHoursTypes?.find((entry) =>
      [
        entry.hoursTypeId,
        entry.displayName,
        entry.localizedDisplayName,
      ].some((value) => value?.toLowerCase().includes("kitchen"))
    )
  return supported?.hoursTypeId ?? null
}

export function buildGoogleHoursPatch(input: {
  canonical: NormalizedHours
  googleLocation: GoogleLocationHours
}): {
  payload: Record<string, unknown>
  updateMask: GoogleHoursUpdateMask[]
  warnings: string[]
} {
  const canonical = input.canonical
  const payload: Record<string, unknown> = {
    regularHours: {
      periods: canonical.regular.flatMap((day) =>
        day.isClosed
          ? []
          : day.periods.map((period) => ({
              openDay: GOOGLE_DAYS[day.dayOfWeek],
              closeDay: GOOGLE_DAYS[day.dayOfWeek],
              openTime: toGoogleTime(period.opensAt),
              closeTime: toGoogleTime(period.closesAt),
            }))
      ),
    },
    specialHours: {
      specialHourPeriods: canonical.special.map((period) => ({
        startDate: toGoogleDate(period.effectiveDate),
        endDate: toGoogleDate(period.effectiveDate),
        ...(period.isClosed
          ? { closed: true }
          : {
              openTime: toGoogleTime(period.opensAt ?? ""),
              closeTime: toGoogleTime(period.closesAt ?? ""),
              closed: false,
            }),
      })),
    },
  }
  const updateMask: GoogleHoursUpdateMask[] = [
    "regularHours",
    "specialHours",
  ]
  const warnings: string[] = []
  if (canonical.moreHours.length > 0) {
    const hoursTypeId = kitchenHoursType(input.googleLocation)
    if (hoursTypeId) {
      payload.moreHours = canonical.moreHours.map((entry) => ({
        hoursTypeId,
        periods: entry.periods.map((period) => ({
          openDay: GOOGLE_DAYS[period.dayOfWeek],
          closeDay: GOOGLE_DAYS[period.dayOfWeek],
          openTime: toGoogleTime(period.opensAt),
          closeTime: toGoogleTime(period.closesAt),
        })),
      }))
      updateMask.push("moreHours")
    } else {
      warnings.push(
        "Google does not advertise a supported kitchen-hours type for this location, so service periods will not be published."
      )
    }
  } else if ((input.googleLocation.moreHours?.length ?? 0) > 0) {
    payload.moreHours = []
    updateMask.push("moreHours")
  }
  return { payload, updateMask, warnings }
}
