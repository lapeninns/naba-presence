import "server-only"
import type { TransactionSql } from "postgres"

import type { HoursComparisonParts } from "@/lib/domain/hours-vocabulary"
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
       * baselines and keeps the others.
       */
      establish?: { keys: string[] | "all" }
    }
)

/**
 * The next per-part baseline. A part that matches (and is not blocked) is
 * its own baseline; an established part takes the published pair; every
 * other part keeps its previous baseline. With no previous part baseline and
 * nothing established, there is none (the whole hashes decide).
 */
export function nextComparisonParts(input: {
  previous: HoursComparisonParts | null
  canonicalParts: Record<string, string>
  googleParts: Record<string, string>
  blocked: boolean
  establish?: { keys: string[] | "all" }
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
  const next: HoursComparisonParts = {
    complete: input.previous?.complete ?? false,
    parts: { ...(input.previous?.parts ?? {}) },
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
      observed_google_part_hashes, comparison_part_hashes
    )
    select ${input.organisationId}, l.id, 'hours', ${success ? "succeeded" : "failed"},
      ${input.attemptedAt}, ${success ? input.attemptedAt : null}, ${success ? null : input.errorCode},
      ${success ? input.googleHash : null}, ${canonicalBaseline}, ${googleBaseline},
      ${success ? input.attemptedAt : null}, ${input.attemptedAt}, ${success ? null : input.errorCode}, ${success ? input.blocked : false},
      ${jsonColumnOrNull(sql, observedGoogleParts)}, ${jsonColumnOrNull(sql, comparisonParts)}
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
      comparison_part_hashes = coalesce(excluded.comparison_part_hashes, presence_resource_reconcile_state.comparison_part_hashes)
    where presence_resource_reconcile_state.observation_attempted_at is null
      or excluded.observation_attempted_at > presence_resource_reconcile_state.observation_attempted_at
  `
  const [row] = await sql<HoursObservation[]>`
    select location_id::text as "locationId", observed_google_hash as "googleHash",
      comparison_canonical_hash as "comparisonCanonicalHash", comparison_google_hash as "comparisonGoogleHash",
      observed_at as "observedAt", observation_attempted_at as "attemptedAt",
      observation_error_code as "errorCode", comparison_blocked as blocked,
      observed_google_part_hashes as "observedGoogleParts", comparison_part_hashes as "comparisonParts"
    from presence_resource_reconcile_state
    where organisation_id = ${input.organisationId} and location_id = ${input.locationId} and resource = 'hours'
  `
  if (!row) throw new Error("Authorized hours observation was not stored")
  return row
}
