import "server-only"
import type { TransactionSql } from "postgres"

import { jsonColumnOrNull, withTenant } from "@/lib/server/db"

/** The editors served from a stored Google read (WP-11). */
export type ObservedEditorResource =
  | "profile"
  | "hours"
  | "posts"
  | "placeActions"
  | "businessInformation"

/** Records an editor's Google read only after its linked location was authorized. */
export async function recordResourceObservation(
  sql: TransactionSql,
  input: {
    organisationId: string
    locationId: string
    resource: "foodMenus" | ObservedEditorResource
    attemptedAt: Date
    errorCode?: string
    /**
     * What Google returned, kept so the editor can be served from storage
     * within its staleness budget. Absent, the stored payload is left as it
     * is (a failed read keeps the last good one).
     */
    googlePayload?: unknown
  }
) {
  const succeeded = input.errorCode === undefined
  await sql`
    insert into presence_resource_reconcile_state (
      organisation_id, location_id, resource, status, last_attempt_at, last_succeeded_at, last_error_code,
      observation_attempted_at, observed_at, observation_error_code, observed_google_payload
    )
    select ${input.organisationId}, l.id, ${input.resource}, ${succeeded ? "succeeded" : "failed"},
      ${input.attemptedAt}, ${succeeded ? input.attemptedAt : null}, ${input.errorCode ?? null},
      ${input.attemptedAt}, ${succeeded ? input.attemptedAt : null}, ${input.errorCode ?? null},
      ${jsonColumnOrNull(sql, succeeded ? (input.googlePayload ?? null) : null)}
    from location l where l.id = ${input.locationId} and l.organisation_id = ${input.organisationId}
    on conflict (organisation_id, location_id, resource) do update set
      status = case when presence_resource_reconcile_state.reconciliation_started_at > excluded.observation_attempted_at then presence_resource_reconcile_state.status else excluded.status end, last_attempt_at = case when presence_resource_reconcile_state.reconciliation_started_at > excluded.observation_attempted_at then presence_resource_reconcile_state.last_attempt_at else excluded.last_attempt_at end, last_error_code = case when presence_resource_reconcile_state.reconciliation_started_at > excluded.observation_attempted_at then presence_resource_reconcile_state.last_error_code else excluded.last_error_code end,
      last_succeeded_at = case when ${succeeded} then greatest(excluded.last_succeeded_at, presence_resource_reconcile_state.last_succeeded_at) else presence_resource_reconcile_state.last_succeeded_at end,
      observation_attempted_at = excluded.observation_attempted_at,
      observed_at = case when ${succeeded} then excluded.observed_at else presence_resource_reconcile_state.observed_at end,
      observation_error_code = excluded.observation_error_code,
      observed_google_payload = coalesce(excluded.observed_google_payload, presence_resource_reconcile_state.observed_google_payload)
    where presence_resource_reconcile_state.observation_attempted_at is null
      or excluded.observation_attempted_at > presence_resource_reconcile_state.observation_attempted_at
  `
}

/**
 * The Google payload an editor may be served from, and whether the latest
 * attempt on the resource (a read or the sweep) failed. Read only.
 */
export async function readObservedGooglePayload(
  sql: TransactionSql,
  input: {
    organisationId: string
    locationId: string
    resource: Exclude<ObservedEditorResource, "hours">
  }
): Promise<{ payload: unknown; failed: boolean } | null> {
  const [row] = await sql<{ payload: unknown; failed: boolean }[]>`
    select observed_google_payload as payload,
      ((status = 'failed' and last_error_code is distinct from 'proposal_raise_failed')
        or observation_error_code is not null) as failed
    from presence_resource_reconcile_state
    where organisation_id = ${input.organisationId}
      and location_id = ${input.locationId} and resource = ${input.resource}
  `
  return row ?? null
}

/**
 * Drops the stored Google payload of a location's editors, so their next
 * open reads Google. Called by every Google write to the fields they show
 * that does not record its own readback as the observation: before the
 * PATCH, so an uncertain write is covered too.
 */
export async function forgetObservedGooglePayload(input: {
  organisationId: string
  locationId: string
  resources: readonly ObservedEditorResource[]
}) {
  await withTenant(
    input.organisationId,
    (sql) => sql`
      update presence_resource_reconcile_state set observed_google_payload = null
      where organisation_id = ${input.organisationId}
        and location_id = ${input.locationId}
        and resource = any(${input.resources as string[]}::text[])
        and observed_google_payload is not null
    `
  )
}
