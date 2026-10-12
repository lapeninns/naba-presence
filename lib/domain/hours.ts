// Server-only (imports node:crypto). The client-safe vocabulary, normaliser
// and drift classifier live in lib/domain/hours-vocabulary.ts and are
// re-exported here so existing imports keep working.
import { createHash } from "node:crypto"

import type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"
import {
  GOOGLE_DAYS,
  canonicalJson,
  hoursPartSignatures,
  hoursSelectionKeys,
  hoursSelectionMask,
  mergeSelectedHours,
  normalizeGoogleHours,
  semanticHours,
  hoursBoundaryReconciliationRequired,
  supportedHoursTypes,
  googleHoursRepresentationIssues,
  type GoogleLocationHours,
  type HoursSelection,
  type NormalizedHours,
} from "@/lib/domain/hours-vocabulary"

export * from "@/lib/domain/hours-vocabulary"

export function hashHours(value: NormalizedHours): string {
  return createHash("sha256")
    .update(canonicalJson(semanticHours(value)))
    .digest("hex")
}

/** One hash per present part (see `hoursPartSignatures`). */
export function hoursPartHashes(
  value: NormalizedHours
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(hoursPartSignatures(value)).map(([key, signature]) => [
      key,
      createHash("sha256").update(signature).digest("hex"),
    ])
  )
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

function googleRegularHours(regular: NormalizedHours["regular"]) {
  return {
    periods: regular.flatMap((day) =>
      day.isClosed
        ? []
        : day.periods.map((period) => ({
            openDay: GOOGLE_DAYS[day.dayOfWeek],
            closeDay: GOOGLE_DAYS[period.closeDayOfWeek ?? day.dayOfWeek],
            openTime: toGoogleTime(period.opensAt),
            closeTime: toGoogleTime(period.closesAt),
          }))
    ),
  }
}

function googleSpecialHours(special: NormalizedHours["special"]) {
  return {
    specialHourPeriods: special.map((period) => ({
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
  }
}

function googleMoreHours(moreHours: NormalizedHours["moreHours"]) {
  return moreHours.map((entry) => ({
    hoursTypeId: entry.hoursTypeId,
    periods: entry.periods.map((period) => ({
      openDay: GOOGLE_DAYS[period.dayOfWeek],
      closeDay: GOOGLE_DAYS[period.closeDayOfWeek ?? period.dayOfWeek],
      openTime: toGoogleTime(period.opensAt),
      closeTime: toGoogleTime(period.closesAt),
    })),
  }))
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const

/** Problems that make a selection unpublishable against this schedule. */
function selectionIssues(input: {
  canonical: NormalizedHours
  google: NormalizedHours
  selection: HoursSelection
  supported: Set<string>
}): string[] {
  const issues: string[] = []
  const { canonical, google, selection } = input
  if (hoursSelectionKeys(selection).length === 0)
    issues.push("Choose at least one day, date or service to publish.")
  // A selected weekday is replaced wholesale, so the saved schedule must
  // hold it exactly once; a whole-week replacement therefore needs all 7.
  for (const dayOfWeek of selection.regularDays ?? []) {
    const count = canonical.regular.filter(
      (day) => day.dayOfWeek === dayOfWeek
    ).length
    if (count !== 1)
      issues.push(
        `${DAY_NAMES[dayOfWeek] ?? `Day ${dayOfWeek}`} must appear exactly once in the saved schedule before it can be published.`
      )
  }
  const types = new Set(selection.moreHoursTypes ?? [])
  const selectedIds = canonical.moreHours
    .map((entry) => entry.hoursTypeId)
    .filter((id) => types.has(id))
  if (new Set(selectedIds).size !== selectedIds.length)
    issues.push(
      "Duplicate service identifiers must be resolved before publishing."
    )
  const existing = new Set(google.moreHours.map((entry) => entry.hoursTypeId))
  for (const id of new Set(selectedIds)) {
    if (!input.supported.has(id) && !existing.has(id))
      issues.push(
        `Google does not advertise ${id} for this location. Existing schedules are preserved, but unsupported services cannot be created.`
      )
  }
  // A kept Google period must not overlap an upserted saved one: Google
  // would hold two answers for the same day.
  const dates = new Set(selection.specialDates ?? [])
  const kept = google.special.filter((entry) => !dates.has(entry.effectiveDate))
  for (const entry of canonical.special.filter((item) =>
    dates.has(item.effectiveDate)
  )) {
    const end = entry.endDate ?? entry.effectiveDate
    const overlap = kept.find(
      (other) =>
        other.effectiveDate <= end &&
        entry.effectiveDate <= (other.endDate ?? other.effectiveDate)
    )
    if (overlap)
      issues.push(
        `Special hours for ${entry.effectiveDate} overlap Google’s ${overlap.effectiveDate} entry, which is not selected. Select both dates to publish them together.`
      )
  }
  return issues
}

/**
 * The Google PATCH for the hours surface. Without a selection the whole
 * saved schedule replaces Google's regular and special hours (and more
 * hours, when either side has any). With one, only the selected parts are
 * taken from the saved schedule; every other day, date and service in a
 * written field is written back exactly as live Google holds it, and fields
 * with nothing selected are left out of the mask.
 */
export function buildGoogleHoursPatch(input: {
  canonical: NormalizedHours
  googleLocation: GoogleLocationHours
  selection?: HoursSelection
}): {
  payload: Record<string, unknown>
  updateMask: GoogleHoursUpdateMask[]
  warnings: string[]
  blockingIssues: string[]
  /** What Google should hold once the patch applies. */
  intended: NormalizedHours
} {
  const canonical = input.canonical
  const blockingIssues = googleHoursRepresentationIssues(input.googleLocation)
  if (hoursBoundaryReconciliationRequired(canonical, input.googleLocation)) {
    blockingIssues.push(
      "Some saved periods have no confirmed closing day or date. Compare them with Google and explicitly save their end boundaries before publishing."
    )
  }
  const supported = new Set(
    supportedHoursTypes(input.googleLocation).map((entry) => entry.hoursTypeId)
  )

  if (input.selection) {
    const google = normalizeGoogleHours(input.googleLocation)
    blockingIssues.push(
      ...selectionIssues({
        canonical,
        google,
        selection: input.selection,
        supported,
      })
    )
    const intended = mergeSelectedHours({
      canonical,
      google,
      selection: input.selection,
    })
    const updateMask = hoursSelectionMask(input.selection)
    const payload: Record<string, unknown> = {}
    if (updateMask.includes("regularHours"))
      payload.regularHours = googleRegularHours(intended.regular)
    if (updateMask.includes("specialHours"))
      payload.specialHours = googleSpecialHours(intended.special)
    if (updateMask.includes("moreHours"))
      payload.moreHours = googleMoreHours(intended.moreHours)
    return {
      payload,
      updateMask,
      warnings: [...blockingIssues],
      blockingIssues,
      intended,
    }
  }

  const payload: Record<string, unknown> = {
    regularHours: googleRegularHours(canonical.regular),
    specialHours: googleSpecialHours(canonical.special),
  }
  const updateMask: GoogleHoursUpdateMask[] = ["regularHours", "specialHours"]
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
    payload.moreHours = googleMoreHours(canonical.moreHours)
    updateMask.push("moreHours")
  }
  return {
    payload,
    updateMask,
    warnings: [...blockingIssues],
    blockingIssues,
    intended: canonical,
  }
}
