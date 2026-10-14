import "server-only"
import type { TransactionSql } from "postgres"

import {
  HOURS_PART_UNKNOWN,
  type HoursComparisonParts,
  type HoursDriftStatus,
} from "@/lib/domain/hours-vocabulary"
import { jsonColumnOrNull } from "@/lib/server/db"

export type HoursObservation = {
  locationId: string
  googleHash: string | null
  comparisonCanonicalHash: string | null
  comparisonGoogleHash: string | null
  observedAt: Date | null
  attemptedAt: Date | null
  errorCode: string | null
  blocked: boolean
  /** Google's per-part hashes at the latest successful observation. */
  observedGoogleParts?: Record<string, string> | null
  /** The per-part comparison baseline; null falls back to the whole hashes. */
  comparisonParts?: HoursComparisonParts | null
}

type ObservationInput = {
  organisationId: string
  locationId: string
  attemptedAt: Date
} & (
  | { outcome: "failed"; errorCode: string }
  | {
      outcome: "observed"
      googleHash: string
      canonicalHash: string
      baselineCanonicalHash: string | null
      baselineGoogleHash: string | null
      blocked: boolean
      canonicalParts?: Record<string, string>
      googleParts?: Record<string, string>
      /**
       * A verified publish: the published pair becomes the comparison
       * baseline even though the schedules differ. "all" for a whole-schedule
       * publish; part keys for a selective one, which moves only those parts'
       * baselines and keeps the others. `priorStatus` is the whole-schedule
       * drift before the publish, which seeds the unwritten parts when no
       * part baseline exists yet.
       */
      establish?: HoursEstablish
      /**
       * What Google returned, kept so the editor can be served from storage
       * within its staleness budget (`readStoredHours`). Absent (a publish
       * readback), the previous payload stays; it no longer hashes to the
       * new `googleHash`, so the next open reads Google.
       */
      googlePayload?: unknown
    }
)

type HoursEstablish = {
  keys: string[] | "all"
  priorStatus?: HoursDriftStatus
}

/**
 * The baseline pair that keeps a differing part classified as `status`:
 * the changed side gets the unknown marker, the other side its live hash.
 */
function seededPair(
  status: HoursDriftStatus,
  canonical: string | null,
  google: string | null
): [string | null, string | null] {
  if (status === "core_dirty") return [HOURS_PART_UNKNOWN, google]
  if (status === "google_dirty") return [canonical, HOURS_PART_UNKNOWN]
  return [HOURS_PART_UNKNOWN, HOURS_PART_UNKNOWN]
}

/**
 * The next per-part baseline. A part that matches (and is not blocked) is
 * its own baseline; an established part takes the published pair; every
 * other part keeps its previous baseline. With no previous part baseline and
 * nothing established, there is none (the whole hashes decide).
 *
 * A selective publish with no previous part baseline starts a complete one:
 * every part is known at that moment. A differing part it did not write has
 * no history of its own, so it is seeded with the whole-schedule verdict
 * from before the publish (`priorStatus`; a conflict when unknown). A Google
 * edit there keeps needing confirmation instead of turning local.
 */
export function nextComparisonParts(input: {
  previous: HoursComparisonParts | null
  canonicalParts: Record<string, string>
  googleParts: Record<string, string>
  blocked: boolean
  establish?: HoursEstablish
}): HoursComparisonParts | null {
  const keys = [
    ...new Set([
      ...Object.keys(input.canonicalParts),
      ...Object.keys(input.googleParts),
    ]),
  ].sort()
  const pair = (key: string): [string | null, string | null] => [
    input.canonicalParts[key] ?? null,
    input.googleParts[key] ?? null,
  ]
  const allMatch = keys.every((key) => {
    const [canonical, google] = pair(key)
    return canonical === google
  })
  if (input.establish?.keys === "all" || (allMatch && !input.blocked)) {
    return {
      complete: true,
      parts: Object.fromEntries(keys.map((key) => [key, pair(key)])),
    }
  }
  const established = input.establish?.keys ?? []
  if (!input.previous && established.length === 0) return null
  if (!input.previous) {
    const selected = new Set(established)
    const prior = input.establish?.priorStatus ?? "conflict"
    return {
      complete: true,
      parts: Object.fromEntries(
        keys.map((key) => {
          const [canonical, google] = pair(key)
          return [
            key,
            selected.has(key) || canonical === google
              ? pair(key)
              : seededPair(prior, canonical, google),
          ]
        })
      ),
    }
  }
  const next: HoursComparisonParts = {
    complete: input.previous.complete,
    parts: { ...input.previous.parts },
  }
  if (!input.blocked) {
    for (const key of keys) {
      const [canonical, google] = pair(key)
      if (canonical === google) next.parts[key] = [canonical, google]
    }
  }
  for (const key of established) next.parts[key] = pair(key)
  return next
}

/** Caller has already authorized the active linked location. */
export async function recordHoursObservation(
  sql: TransactionSql,
  input: ObservationInput
): Promise<HoursObservation> {
  const success = input.outcome === "observed"
  const establish = success && input.establish !== undefined
  const matches =
    success &&
    !input.blocked &&
    (input.canonicalHash === input.googleHash || establish)
  let comparisonParts: HoursComparisonParts | null = null
  let observedGoogleParts: Record<string, string> | null = null
  if (success && input.canonicalParts && input.googleParts) {
    observedGoogleParts = input.googleParts
    const [previous] = await sql<{ parts: HoursComparisonParts | null }[]>`
      select comparison_part_hashes as parts from presence_resource_reconcile_state
      where organisation_id = ${input.organisationId} and location_id = ${input.locationId} and resource = 'hours'
      for update
    `
    comparisonParts = nextComparisonParts({
      previous: previous?.parts ?? null,
      canonicalParts: input.canonicalParts,
      googleParts: input.googleParts,
      blocked: input.blocked,
      establish: input.establish,
    })
  }
  const canonicalBaseline = success
    ? matches
      ? input.canonicalHash
      : input.baselineCanonicalHash
    : null
  const googleBaseline = success
    ? matches
      ? input.googleHash
      : input.baselineGoogleHash
    : null
  await sql`
    insert into presence_resource_reconcile_state (
      organisation_id, location_id, resource, status,
      last_attempt_at, last_succeeded_at, last_error_code,
      observed_google_hash, comparison_canonical_hash, comparison_google_hash,
      observed_at, observation_attempted_at, observation_error_code, comparison_blocked,
      observed_google_part_hashes, comparison_part_hashes, observed_google_payload
    )
    select ${input.organisationId}, l.id, 'hours', ${success ? "succeeded" : "failed"},
      ${input.attemptedAt}, ${success ? input.attemptedAt : null}, ${success ? null : input.errorCode},
      ${success ? input.googleHash : null}, ${canonicalBaseline}, ${googleBaseline},
      ${success ? input.attemptedAt : null}, ${input.attemptedAt}, ${success ? null : input.errorCode}, ${success ? input.blocked : false},
      ${jsonColumnOrNull(sql, observedGoogleParts)}, ${jsonColumnOrNull(sql, comparisonParts)},
      ${jsonColumnOrNull(sql, success ? (input.googlePayload ?? null) : null)}
    from location l where l.id = ${input.locationId} and l.organisation_id = ${input.organisationId}
    on conflict (organisation_id, location_id, resource) do update set
      status = case when presence_resource_reconcile_state.reconciliation_started_at > excluded.observation_attempted_at then presence_resource_reconcile_state.status else excluded.status end,
      last_attempt_at = case when presence_resource_reconcile_state.reconciliation_started_at > excluded.observation_attempted_at then presence_resource_reconcile_state.last_attempt_at else excluded.last_attempt_at end,
      last_error_code = case when presence_resource_reconcile_state.reconciliation_started_at > excluded.observation_attempted_at then presence_resource_reconcile_state.last_error_code else excluded.last_error_code end,
      last_succeeded_at = case when ${success} then greatest(excluded.last_succeeded_at, presence_resource_reconcile_state.last_succeeded_at) else presence_resource_reconcile_state.last_succeeded_at end,
      observed_google_hash = case when ${success} then excluded.observed_google_hash else presence_resource_reconcile_state.observed_google_hash end,
      observed_at = case when ${success} then excluded.observed_at else presence_resource_reconcile_state.observed_at end,
      observation_attempted_at = excluded.observation_attempted_at,
      observation_error_code = excluded.observation_error_code,
      comparison_blocked = case when ${success} then excluded.comparison_blocked else presence_resource_reconcile_state.comparison_blocked end,
      comparison_canonical_hash = case when ${matches} then excluded.comparison_canonical_hash else coalesce(presence_resource_reconcile_state.comparison_canonical_hash, excluded.comparison_canonical_hash) end,
      comparison_google_hash = case when ${matches} then excluded.comparison_google_hash else coalesce(presence_resource_reconcile_state.comparison_google_hash, excluded.comparison_google_hash) end,
      observed_google_part_hashes = case when ${success} then excluded.observed_google_part_hashes else presence_resource_reconcile_state.observed_google_part_hashes end,
      comparison_part_hashes = coalesce(excluded.comparison_part_hashes, presence_resource_reconcile_state.comparison_part_hashes),
      observed_google_payload = coalesce(excluded.observed_google_payload, presence_resource_reconcile_state.observed_google_payload)
    where presence_resource_reconcile_state.observation_attempted_at is null
      or excluded.observation_attempted_at > presence_resource_reconcile_state.observation_attempted_at
  `
  const row = await readHoursObservation(sql, input)
  if (!row) throw new Error("Authorized hours observation was not stored")
  return row
}

export type StoredHoursObservation = HoursObservation & {
  googlePayload: unknown
  /** The latest attempt (a read or the sweep) failed. */
  reconcileFailed: boolean
}

/** The latest hours observation with its Google payload, if any. Read only. */
export async function readHoursObservation(
  sql: TransactionSql,
  input: { organisationId: string; locationId: string }
): Promise<StoredHoursObservation | null> {
  const [row] = await sql<StoredHoursObservation[]>`
    select location_id::text as "locationId", observed_google_hash as "googleHash",
      comparison_canonical_hash as "comparisonCanonicalHash", comparison_google_hash as "comparisonGoogleHash",
      observed_at as "observedAt", observation_attempted_at as "attemptedAt",
      observation_error_code as "errorCode", comparison_blocked as blocked,
      observed_google_part_hashes as "observedGoogleParts", comparison_part_hashes as "comparisonParts",
      observed_google_payload as "googlePayload", status = 'failed' as "reconcileFailed"
    from presence_resource_reconcile_state
    where organisation_id = ${input.organisationId} and location_id = ${input.locationId} and resource = 'hours'
  `
  return row ?? null
}

function samePairs(
  left: HoursComparisonParts | null | undefined,
  right: HoursComparisonParts | null | undefined
): boolean {
  if (!left || !right) return !left && !right
  const keys = Object.keys(left.parts).sort()
  return (
    left.complete === right.complete &&
    keys.join("\n") === Object.keys(right.parts).sort().join("\n") &&
    keys.every(
      (key) =>
        left.parts[key]?.[0] === right.parts[key]?.[0] &&
        left.parts[key]?.[1] === right.parts[key]?.[1]
    )
  )
}

/**
 * Whether recording this successful observation (no `establish`) would
 * leave the stored comparison state exactly as it is: the same Google hash,
 * blocked flag, whole baselines and part baselines. Mirrors
 * `recordHoursObservation`, so an editor served from storage classifies the
 * schedule as a live read would, and a read that would move a baseline (a
 * save that brought a part in line with Google) reads Google and records it.
 */
export function hoursObservationUnchanged(
  stored: HoursObservation,
  input: {
    googleHash: string
    canonicalHash: string
    baselineCanonicalHash: string | null
    baselineGoogleHash: string | null
    blocked: boolean
    canonicalParts: Record<string, string>
    googleParts: Record<string, string>
  }
): boolean {
  if (stored.googleHash !== input.googleHash) return false
  if (stored.blocked !== input.blocked) return false
  const matches = !input.blocked && input.canonicalHash === input.googleHash
  const comparisonCanonical = matches
    ? input.canonicalHash
    : (stored.comparisonCanonicalHash ?? input.baselineCanonicalHash)
  const comparisonGoogle = matches
    ? input.googleHash
    : (stored.comparisonGoogleHash ?? input.baselineGoogleHash)
  if (
    comparisonCanonical !== stored.comparisonCanonicalHash ||
    comparisonGoogle !== stored.comparisonGoogleHash
  )
    return false
  const next = nextComparisonParts({
    previous: stored.comparisonParts ?? null,
    canonicalParts: input.canonicalParts,
    googleParts: input.googleParts,
    blocked: input.blocked,
  })
  return samePairs(next ?? stored.comparisonParts, stored.comparisonParts)
}
