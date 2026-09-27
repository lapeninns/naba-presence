// Server-only (imports node:crypto). The client-safe vocabulary, normaliser
// and drift classifier live in lib/domain/hours-vocabulary.ts and are
// re-exported here so existing imports keep working.
import { createHash } from "node:crypto"

import type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"
import {
  GOOGLE_DAYS,
  semanticHours,
  hoursBoundaryReconciliationRequired,
  supportedHoursTypes,
  googleHoursRepresentationIssues,
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
  return createHash("sha256")
    .update(canonicalJson(semanticHours(value)))
    .digest("hex")
}

/** Reproduces the old import hash only when comparing an actual legacy baseline. */
export function legacyHoursHash(value: NormalizedHours): string {
  return hashHours({
    regular: value.regular.map((day) => ({
      ...day,
      periods: day.periods.map((period) => ({
        opensAt: period.opensAt,
        closesAt: period.closesAt,
      })),
    })),
    special: value.special.map((period) => ({
      effectiveDate: period.effectiveDate,
      isClosed: period.isClosed,
      opensAt: period.opensAt,
      closesAt: period.closesAt,
    })),
    moreHours: value.moreHours.map((entry) => ({
      ...entry,
      periods: entry.periods.map((period) => ({
        dayOfWeek: period.dayOfWeek,
        opensAt: period.opensAt,
        closesAt: period.closesAt,
      })),
    })),
  })
}

function toGoogleTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number)
  return { hours, minutes }
}

function toGoogleDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return { year, month, day }
}

export function buildGoogleHoursPatch(input: {
  canonical: NormalizedHours
  googleLocation: GoogleLocationHours
}): {
  payload: Record<string, unknown>
  updateMask: GoogleHoursUpdateMask[]
  warnings: string[]
  blockingIssues: string[]
} {
  const canonical = input.canonical
  const payload: Record<string, unknown> = {
    regularHours: {
      periods: canonical.regular.flatMap((day) =>
        day.isClosed
          ? []
          : day.periods.map((period) => ({
              openDay: GOOGLE_DAYS[day.dayOfWeek],
              closeDay: GOOGLE_DAYS[period.closeDayOfWeek ?? day.dayOfWeek],
              openTime: toGoogleTime(period.opensAt),
              closeTime: toGoogleTime(period.closesAt),
            }))
      ),
    },
    specialHours: {
      specialHourPeriods: canonical.special.map((period) => ({
        startDate: toGoogleDate(period.effectiveDate),
        endDate: toGoogleDate(period.endDate ?? period.effectiveDate),
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
  const updateMask: GoogleHoursUpdateMask[] = ["regularHours", "specialHours"]
  const blockingIssues = googleHoursRepresentationIssues(input.googleLocation)
  if (hoursBoundaryReconciliationRequired(canonical, input.googleLocation)) {
    blockingIssues.push(
      "Some saved periods have no confirmed closing day or date. Compare them with Google and explicitly save their end boundaries before publishing."
    )
  }
  const supported = new Set(
    supportedHoursTypes(input.googleLocation).map((entry) => entry.hoursTypeId)
  )
  const existing = new Set(
    (input.googleLocation.moreHours ?? []).map((entry) => entry.hoursTypeId)
  )
  const ids = canonical.moreHours.map((entry) => entry.hoursTypeId)
  if (new Set(ids).size !== ids.length)
    blockingIssues.push(
      "Duplicate service identifiers must be resolved before publishing."
    )
  for (const entry of canonical.moreHours) {
    if (!supported.has(entry.hoursTypeId) && !existing.has(entry.hoursTypeId)) {
      blockingIssues.push(
        `Google does not advertise ${entry.hoursTypeId} for this location. Existing schedules are preserved, but unsupported services cannot be created.`
      )
    }
  }
  if (canonical.moreHours.length > 0 || existing.size > 0) {
    payload.moreHours = canonical.moreHours.map((entry) => ({
      hoursTypeId: entry.hoursTypeId,
      periods: entry.periods.map((period) => ({
        openDay: GOOGLE_DAYS[period.dayOfWeek],
        closeDay: GOOGLE_DAYS[period.closeDayOfWeek ?? period.dayOfWeek],
        openTime: toGoogleTime(period.opensAt),
        closeTime: toGoogleTime(period.closesAt),
      })),
    }))
    updateMask.push("moreHours")
  }
  return { payload, updateMask, warnings: [...blockingIssues], blockingIssues }
}
