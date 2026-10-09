import "server-only"
import type { TransactionSql } from "postgres"

export type HoursObservation = {
  locationId: string
  googleHash: string | null
  comparisonCanonicalHash: string | null
  comparisonGoogleHash: string | null
  observedAt: Date | null
  attemptedAt: Date | null
  errorCode: string | null
  blocked: boolean
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
    }
)

/** Caller has already authorized the active linked location. */
export async function recordHoursObservation(
  sql: TransactionSql,
  input: ObservationInput
): Promise<HoursObservation> {
  const success = input.outcome === "observed"
  const matches =
    success && !input.blocked && input.canonicalHash === input.googleHash
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
      observed_at, observation_attempted_at, observation_error_code, comparison_blocked
    )
    select ${input.organisationId}, l.id, 'hours', ${success ? "succeeded" : "failed"},
      ${input.attemptedAt}, ${success ? input.attemptedAt : null}, ${success ? null : input.errorCode},
      ${success ? input.googleHash : null}, ${canonicalBaseline}, ${googleBaseline},
      ${success ? input.attemptedAt : null}, ${input.attemptedAt}, ${success ? null : input.errorCode}, ${success ? input.blocked : false}
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
      comparison_google_hash = case when ${matches} then excluded.comparison_google_hash else coalesce(presence_resource_reconcile_state.comparison_google_hash, excluded.comparison_google_hash) end
    where presence_resource_reconcile_state.observation_attempted_at is null
      or excluded.observation_attempted_at > presence_resource_reconcile_state.observation_attempted_at
  `
  const [row] = await sql<HoursObservation[]>`
    select location_id::text as "locationId", observed_google_hash as "googleHash",
      comparison_canonical_hash as "comparisonCanonicalHash", comparison_google_hash as "comparisonGoogleHash",
      observed_at as "observedAt", observation_attempted_at as "attemptedAt",
      observation_error_code as "errorCode", comparison_blocked as blocked
    from presence_resource_reconcile_state
    where organisation_id = ${input.organisationId} and location_id = ${input.locationId} and resource = 'hours'
  `
  if (!row) throw new Error("Authorized hours observation was not stored")
  return row
}
