// Server-only (imports node:crypto). The client-safe vocabulary and the
// normalisers live in lib/domain/google-change-watch-vocabulary.ts and are
// re-exported here.
//
// The rule: a protected field is "changed on Google" when Google's value
// moved off the one we last published (or accepted), as the existing
// baselines record it, AND it still differs from ours once both sides are
// normalised. Without a baseline nothing is known about who moved, so
// nothing is raised (the existing classifiers call that a conflict, which
// would alert on every listing never published from here). A local edit
// Google has not seen is ours, not Google's: it is flagged, never reported
// as Google's. No write ever follows from detection: it only records and
// alerts.
import { createHash } from "node:crypto"

import {
  changedHoursKeys,
  comparableSignature,
  isHoursField,
  upcomingSpecialHours,
  type GoogleChangeResolution,
  type GoogleChangeStatus,
  type WatchedField,
  type WatchedValue,
} from "@/lib/domain/google-change-watch-vocabulary"

export * from "@/lib/domain/google-change-watch-vocabulary"

/** The hours part baseline (lib/domain/hours-vocabulary.ts). */
type PartBaseline = {
  complete: boolean
  parts: Record<string, [string | null, string | null]>
}

/** The hash a detected value is deduplicated and pinned by. */
export function watchedValueHash(value: WatchedValue): string {
  return createHash("sha256").update(comparableSignature(value)).digest("hex")
}

export type FieldMovement = {
  /** Google's value moved off the baseline. False when none is known. */
  googleMoved: boolean
  /** Ours moved off it too: we have edits Google has not seen. */
  oursMoved: boolean
  /**
   * Hours only: the part keys (`regular:<day>`, `special:<date>`) Google
   * moved. Absent: every part that differs (ours is the baseline).
   */
  googleParts?: readonly string[]
}

type Hashes = {
  canonicalHash: string
  googleHash: string
  baselineCanonicalHash: string | null
  baselineGoogleHash: string | null
}

/** A profile field from its profile_field_state hashes and baselines. */
export function profileFieldMovement(input: Hashes): FieldMovement {
  return {
    googleMoved:
      input.baselineGoogleHash !== null &&
      input.googleHash !== input.baselineGoogleHash,
    oursMoved:
      input.baselineCanonicalHash !== null &&
      input.canonicalHash !== input.baselineCanonicalHash,
  }
}

/**
 * One hours field from the per-part hashes and the part baseline
 * (`comparison_part_hashes`). A differing part the baseline has no history
 * for is skipped: nobody knows which side moved. With no part baseline, the
 * whole-schedule hashes decide; ours unchanged since the baseline means
 * every differing part is Google's.
 */
export function hoursFieldMovement(input: {
  field: "regularHours" | "specialHours"
  canonicalParts: Record<string, string>
  googleParts: Record<string, string>
  baseline: PartBaseline | null
  whole: Hashes
}): FieldMovement {
  if (!input.baseline) return profileFieldMovement(input.whole)
  const prefix = input.field === "regularHours" ? "regular:" : "special:"
  const keys = [
    ...new Set([
      ...Object.keys(input.canonicalParts),
      ...Object.keys(input.googleParts),
    ]),
  ]
    .filter((key) => key.startsWith(prefix))
    .sort()
  const moved: string[] = []
  let oursMoved = false
  for (const key of keys) {
    const canonical = input.canonicalParts[key] ?? null
    const google = input.googleParts[key] ?? null
    if (canonical === google) continue
    const base =
      input.baseline.parts[key] ??
      (input.baseline.complete ? ([null, null] as const) : undefined)
    if (!base) continue
    if (google !== base[1]) moved.push(key)
    if (canonical !== base[0]) oursMoved = true
  }
  return { googleMoved: moved.length > 0, oursMoved, googleParts: moved }
}

/**
 * Primary category has no published baseline anywhere else, so the watch
 * keeps one: the category we last published or accepted. With none yet the
 * caller seeds it from this observation (`seed`), which never alerts.
 */
export function categoryMovement(input: {
  baseline: string | null
  google: string | null
}): { movement: FieldMovement; seed: boolean } {
  return {
    movement: {
      googleMoved: input.baseline !== null && input.baseline !== input.google,
      oursMoved: false,
    },
    seed: input.baseline === null,
  }
}

export type FieldObservation = {
  ours: WatchedValue
  google: WatchedValue
  movement: FieldMovement
}

export type DetectedGoogleChange = {
  field: WatchedField
  ours: WatchedValue
  google: WatchedValue
  oursHash: string
  googleHash: string
  /** We also have edits Google has not seen; ours is not what was last published. */
  localEdits: boolean
  /** Hours only: the weekdays (0 = Sunday) and dates Google changed. */
  regularDays: number[]
  specialDates: string[]
}

function upcoming(
  value: WatchedValue,
  today: string | undefined
): WatchedValue {
  return value.field === "specialHours" && today
    ? { field: "specialHours", value: upcomingSpecialHours(value.value, today) }
    : value
}

export function detectGoogleChanges(input: {
  protectedFields: readonly WatchedField[]
  observations: readonly FieldObservation[]
  /** The listing's own date (YYYY-MM-DD): special hours that ended are ignored. */
  today?: string
}): DetectedGoogleChange[] {
  const protectedSet = new Set(input.protectedFields)
  const detected: DetectedGoogleChange[] = []
  for (const observation of input.observations) {
    const field = observation.ours.field
    if (observation.google.field !== field) continue
    if (!protectedSet.has(field)) continue
    if (!observation.movement.googleMoved) continue
    const ours = upcoming(observation.ours, input.today)
    const google = upcoming(observation.google, input.today)
    const oursHash = watchedValueHash(ours)
    const googleHash = watchedValueHash(google)
    // Only a representation differs (24:00 against 00:00, provider order,
    // an omitted default): nobody changed anything.
    if (oursHash === googleHash) continue
    let { regularDays, specialDates } = changedHoursKeys(ours, google)
    const moved = observation.movement.googleParts
    if (moved) {
      const keys = new Set(moved)
      regularDays = regularDays.filter((day) => keys.has(`regular:${day}`))
      specialDates = specialDates.filter((date) => keys.has(`special:${date}`))
    }
    // Hours where only our own unpublished parts differ: not Google's change.
    if (isHoursField(field) && regularDays.length + specialDates.length === 0) {
      continue
    }
    detected.push({
      field,
      ours,
      google,
      oursHash,
      googleHash,
      localEdits: observation.movement.oursMoved,
      regularDays,
      specialDates,
    })
  }
  return detected
}

export type LedgerRow = {
  id: string
  field: WatchedField
  googleHash: string
  /** Our value as the row recorded it (the side a decision checks). */
  oursHash: string
  status: GoogleChangeStatus
}

export type LedgerPlan = {
  /** New field-and-value changes: a row each, and an alert each. */
  insert: DetectedGoogleChange[]
  /** Rows still describing Google as it is: nothing to do. */
  keep: string[]
  /**
   * Open rows kept for the same Google value whose own side moved (someone
   * saved a new value of the field since): the row takes this run's ours,
   * so a decision compares against what is saved now. Each is also in
   * `keep`.
   */
  refresh: Array<{ id: string; change: DetectedGoogleChange }>
  /** Google changed the field again: the row is replaced by a new one. */
  supersede: string[]
  /** Google holds ours again, or the field is no longer protected. */
  resolve: Array<{ id: string; reason: GoogleChangeResolution }>
}

/**
 * How a detection run moves the ledger. Only `open` and `reverting` rows are
 * live; the rest are history. A change is deduplicated per field and value:
 * while a live row has the same field and Google hash, nothing new is raised.
 * A field this run did not observe (its read failed) is left as it is: no
 * observation is not evidence that Google holds ours again.
 */
export function planLedger(input: {
  live: readonly LedgerRow[]
  detected: readonly DetectedGoogleChange[]
  observedFields: readonly WatchedField[]
  protectedFields: readonly WatchedField[]
}): LedgerPlan {
  const plan: LedgerPlan = {
    insert: [],
    keep: [],
    refresh: [],
    supersede: [],
    resolve: [],
  }
  const byField = new Map(
    input.detected.map((change) => [change.field, change])
  )
  const observed = new Set(input.observedFields)
  const protectedSet = new Set(input.protectedFields)
  const covered = new Set<WatchedField>()
  for (const row of input.live) {
    if (row.status !== "open" && row.status !== "reverting") continue
    if (!protectedSet.has(row.field)) {
      plan.resolve.push({ id: row.id, reason: "unwatched" })
      continue
    }
    if (!observed.has(row.field)) {
      plan.keep.push(row.id)
      covered.add(row.field)
      continue
    }
    const change = byField.get(row.field)
    if (!change) {
      // Includes ours now matching Google's: a saved value that caught up
      // with Google leaves nothing to decide.
      plan.resolve.push({ id: row.id, reason: "google_restored" })
    } else if (change.googleHash === row.googleHash) {
      plan.keep.push(row.id)
      covered.add(row.field)
      // A "reverting" row is bound to the value its put-back sends; only a
      // row still waiting for a decision follows our saved value.
      if (row.status === "open" && change.oursHash !== row.oursHash) {
        plan.refresh.push({ id: row.id, change })
      }
    } else {
      plan.supersede.push(row.id)
    }
  }
  for (const change of input.detected) {
    if (!covered.has(change.field)) plan.insert.push(change)
  }
  return plan
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The watched values a successful bulk business-information or category
 * write sent (its `bulk_listing_write_attempt.intended`, see
 * lib/server/bulk-families/write-attempts.ts): a set website or description,
 * a clear of either (no value), and a category write's primary category.
 * Labels and the open status are not watched; anything unreadable is
 * skipped, never guessed.
 */
export function bulkWrittenValues(
  family: string,
  intended: unknown
): WatchedValue[] {
  if (!isRecord(intended)) return []
  if (family === "categories") {
    const categories = intended.categories
    const primary = isRecord(categories) ? categories.primary : null
    return typeof primary === "string" && primary
      ? [
          {
            field: "primaryCategory",
            value: { name: primary, displayName: null },
          },
        ]
      : []
  }
  if (family !== "business_info" || !Array.isArray(intended.changes)) return []
  const values: WatchedValue[] = []
  for (const change of intended.changes) {
    if (!isRecord(change)) continue
    const field =
      change.field === "websiteUri"
        ? "website"
        : change.field === "profile.description"
          ? "description"
          : null
    if (!field) continue
    if (change.action === "clear") {
      values.push({ field, value: null })
    } else if (change.action === "set" && typeof change.value === "string") {
      values.push({ field, value: change.value })
    }
  }
  return values
}

/**
 * The notification subject: one incident per detected change (a ledger row,
 * itself unique per field and Google value while live), so a repeat
 * detection never notifies twice, and the same value coming back after it
 * was dealt with is a new incident.
 */
export function googleChangeSubjectId(input: {
  organisationId: string
  locationId: string
  changeId: string
}): string {
  return `${input.organisationId}:location:${input.locationId}:google_change:${input.changeId}`
}
