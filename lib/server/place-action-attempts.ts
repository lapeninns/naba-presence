import "server-only"
import { z } from "zod"
import { placeActionAttemptSchema, reviewedPlaceActionPayloadSchema } from "@/lib/contracts/place-action-review"
import { jsonColumn, withTenant } from "@/lib/server/db"
import { auditGbpMutation } from "@/lib/server/gbp-management"
import { currentPlaceActionContext, observePlaceActions, placeActionBaselineSchema, placeActionPostcondition } from "@/lib/server/place-action-review-state"
import { ApiError } from "@/lib/server/http"
import { reportAttemptOutcome } from "@/lib/server/notifications/attempt-events"
import { requireLocationAccess } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

const rowSchema = z.object({
  id: z.uuid(), reviewId: z.uuid(), locationId: z.uuid(), target: z.string(), payloadHash: z.string(),
  executionState: placeActionAttemptSchema.shape.executionState, confirmationState: placeActionAttemptSchema.shape.confirmationState,
  requested: reviewedPlaceActionPayloadSchema, baseline: placeActionBaselineSchema,
  observedAt: z.date().nullable(), errorCode: z.string().nullable(), createdAt: z.date(), status: z.string(),
  observation: z.unknown(), googleAccountId: z.uuid(),
})
export type PlaceActionAttemptRow = z.infer<typeof rowSchema>
export async function loadPlaceActionAttempt(session: Session, locationId: string, reviewId: string) {
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    const [raw] = await sql`select m.id, m.change_set_id as "reviewId", m.location_id as "locationId",
      c.target_resource_name as target, c.payload_hash as "payloadHash", m.execution_state as "executionState",
      m.confirmation_state as "confirmationState", m.requested_payload as requested, c.baseline,
      m.confirmation_observed_at as "observedAt", m.confirmation_error_code as "errorCode",
      m.created_at as "createdAt", m.status, m.confirmation_response as observation, m.google_account_id as "googleAccountId"
      from place_action_mutation m join gbp_change_set c on c.id = m.change_set_id
      where m.location_id = ${locationId} and c.location_id = ${locationId} and m.change_set_id = ${reviewId}
        and c.resource_type = 'place_action' and m.google_account_id = c.google_account_id
        and m.operation = c.payload -> 'request' ->> 'operation' and m.requested_payload = c.payload`
    if (!raw) return null
    const parsed = rowSchema.safeParse(raw)
    if (!parsed.success) throw new ApiError(409, "place_action_attempt_unreadable", "The action link outcome needs an operational check before another write.")
    return parsed.data
  })
}
export function projectPlaceActionAttempt(row: PlaceActionAttemptRow, idempotent = true) {
  return placeActionAttemptSchema.parse({ ...row, request: row.requested.request, observedAt: row.observedAt?.toISOString() ?? null, idempotent })
}
export async function readPlaceActionAttempt(session: Session, locationId: string, reviewId: string, idempotent = true) {
  const row = await loadPlaceActionAttempt(session, locationId, reviewId)
  if (!row) throw new ApiError(404, "place_action_attempt_not_found", "No action link request is recorded for this review.")
  return projectPlaceActionAttempt(row, idempotent)
}
export async function refreshPlaceActionObservation(session: Session, locationId: string, row: PlaceActionAttemptRow, requestId: string) {
  // A confirmed outcome is settled evidence. A later Google edit to the same link is new
  // provider state, not a reason to reopen this request and block the account's writes.
  if (row.confirmationState === "confirmed") return projectPlaceActionAttempt(row)
  const linked = await currentPlaceActionContext(session, locationId, false)
  if (linked.connectionId !== row.requested.connectionId || linked.credentialGeneration !== row.requested.credentialGeneration || linked.googleLocationName !== row.target || linked.googleAccountId !== row.googleAccountId) throw new ApiError(409, "google_target_changed", "Reconnect the exact reviewed Google target before checking this saved outcome.")
  let observation: Awaited<ReturnType<typeof observePlaceActions>> | null = null
  try { observation = await observePlaceActions(linked) }
  catch (error) { if (!(error instanceof Error)) throw error }
  const confirmed = observation ? placeActionPostcondition(row.requested.request, row.baseline, observation.baseline) : false
  // Only the update that moves this row to confirmed emits the canonical audit event.
  const transitioned = await withTenant(session.organisationId, async (sql) => {
    const updated = await sql`update place_action_mutation set status = ${confirmed ? "succeeded" : "ambiguous"},
      confirmation_state = ${confirmed ? "confirmed" : "unresolved"},
      confirmation_response = ${observation ? jsonColumn(sql, observation.baseline) : row.observation ? jsonColumn(sql, row.observation) : null},
      confirmation_observed_at = ${observation ? new Date(observation.observedAt) : row.observedAt},
      confirmation_error_code = ${observation ? confirmed ? null : "place_action_postcondition_unconfirmed" : "place_action_refresh_failed"},
      finished_at = now() where id = ${row.id} and confirmation_state <> 'confirmed' returning id`
    return updated.length === 1
  })
  await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.place_action.observed", subjectType: "location", subjectId: locationId, requestId,
    metadata: { reviewId: row.reviewId, mutationId: row.id, executionState: row.executionState, confirmationState: confirmed ? "confirmed" : "unresolved", refreshUnavailable: observation === null } })
  if (transitioned) {
    await reportAttemptOutcome({ organisationId: session.organisationId, locationId, family: "links", attemptId: row.id,
      outcome: confirmed ? { kind: "publication_confirmed" }
        : { kind: "publication_unresolved", reason: observation === null ? "readback_failed" : row.executionState === "accepted" ? "readback_mismatch" : "response_ambiguous" } })
  }
  if (confirmed && transitioned) {
    const actions = { create: "place_action.created", update: "place_action.updated", delete: "place_action.deleted" }
    await auditGbpMutation({ organisationId: session.organisationId, session, action: actions[row.requested.request.operation], subjectType: "location", subjectId: locationId, requestId,
      metadata: { reviewId: row.reviewId, mutationId: row.id, executionState: row.executionState, confirmationState: "confirmed", observedAt: observation?.observedAt ?? null, request: row.requested.request } })
  }
  return readPlaceActionAttempt(session, locationId, row.reviewId, false)
}
