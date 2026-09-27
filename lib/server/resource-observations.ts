import "server-only"
import type { TransactionSql } from "postgres"

/** Records a profile/menu read only after its linked location was authorized. */
export async function recordResourceObservation(
  sql: TransactionSql,
  input: {
    organisationId: string
    locationId: string
    resource: "profile" | "foodMenus"
    attemptedAt: Date
    errorCode?: string
  }
) {
  const succeeded = input.errorCode === undefined
  await sql`
    insert into presence_resource_reconcile_state (
      organisation_id, location_id, resource, status, last_attempt_at, last_succeeded_at, last_error_code,
      observation_attempted_at, observed_at, observation_error_code
    )
    select ${input.organisationId}, l.id, ${input.resource}, ${succeeded ? "succeeded" : "failed"},
      ${input.attemptedAt}, ${succeeded ? input.attemptedAt : null}, ${input.errorCode ?? null},
      ${input.attemptedAt}, ${succeeded ? input.attemptedAt : null}, ${input.errorCode ?? null}
    from location l where l.id = ${input.locationId} and l.organisation_id = ${input.organisationId}
    on conflict (organisation_id, location_id, resource) do update set
      status = case when presence_resource_reconcile_state.reconciliation_started_at > excluded.observation_attempted_at then presence_resource_reconcile_state.status else excluded.status end, last_attempt_at = case when presence_resource_reconcile_state.reconciliation_started_at > excluded.observation_attempted_at then presence_resource_reconcile_state.last_attempt_at else excluded.last_attempt_at end, last_error_code = case when presence_resource_reconcile_state.reconciliation_started_at > excluded.observation_attempted_at then presence_resource_reconcile_state.last_error_code else excluded.last_error_code end,
      last_succeeded_at = case when ${succeeded} then greatest(excluded.last_succeeded_at, presence_resource_reconcile_state.last_succeeded_at) else presence_resource_reconcile_state.last_succeeded_at end,
      observation_attempted_at = excluded.observation_attempted_at,
      observed_at = case when ${succeeded} then excluded.observed_at else presence_resource_reconcile_state.observed_at end,
      observation_error_code = excluded.observation_error_code
    where presence_resource_reconcile_state.observation_attempted_at is null
      or excluded.observation_attempted_at > presence_resource_reconcile_state.observation_attempted_at
  `
}
