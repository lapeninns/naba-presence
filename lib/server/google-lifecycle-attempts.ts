import "server-only"
import { z } from "zod"
import { googleLifecycleBaselineSchema, googleLifecycleObservationSchema } from "@/lib/contracts/google-lifecycle"
import { lifecycleAttemptSchema, reviewedLifecyclePayloadSchema } from "@/lib/contracts/google-lifecycle-review"
import { lifecycleConfirmation } from "@/lib/domain/google-lifecycle"
import { jsonColumn, withTenant } from "@/lib/server/db"
import { auditGbpMutation, gbpManagementAttemptStore } from "@/lib/server/gbp-management"
import { observeLifecyclePostcondition } from "@/lib/server/google-lifecycle-observation"
import { reconcileLifecycleTransfer } from "@/lib/server/google-lifecycle-reconciliation"
import { ApiError } from "@/lib/server/http"
import { requireLocationAccess } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

const rowSchema = z.object({
  id: z.uuid(), reviewId: z.uuid(), locationId: z.uuid(), payloadHash: z.string().length(64),
  status: z.enum(["started", "validated", "succeeded", "failed", "ambiguous"]),
  executionState: lifecycleAttemptSchema.shape.executionState,
  confirmationState: lifecycleAttemptSchema.shape.confirmationState,
  localReconciliation: lifecycleAttemptSchema.shape.localReconciliation,
  target: z.string(), operation: lifecycleAttemptSchema.shape.operation,
  requested: reviewedLifecyclePayloadSchema, baseline: z.record(z.string(), z.unknown()),
  observation: z.unknown(), providerResponse: z.unknown(), createdAt: z.date(), errorCode: z.string().nullable(),
})
export type LifecycleAttemptRow = z.infer<typeof rowSchema>
export async function loadLifecycleAttempt(session: Session, locationId: string, reviewId: string) {
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    const [raw] = await sql`
      select m.id, m.change_set_id as "reviewId", m.location_id as "locationId",
        c.payload_hash as "payloadHash", m.status, m.execution_state as "executionState",
        m.confirmation_state as "confirmationState", m.target_resource_name as target,
        m.local_reconciliation_state as "localReconciliation",
        m.operation, m.requested_payload as requested, c.baseline,
        m.confirmation_response as observation, m.google_response as "providerResponse",
        m.created_at as "createdAt", m.confirmation_error_code as "errorCode"
      from gbp_management_mutation m join gbp_change_set c on c.id = m.change_set_id
      where m.location_id = ${locationId} and c.location_id = ${locationId}
        and m.change_set_id = ${reviewId} and c.resource_type = 'location_lifecycle'
        and m.resource_type = 'location_lifecycle' and m.target_resource_name = c.target_resource_name
        and m.operation = c.payload -> 'request' ->> 'operation'
    `
    if (!raw) return null
    const parsed = rowSchema.safeParse(raw)
    if (!parsed.success) throw new ApiError(409, "lifecycle_attempt_unreadable", "The lifecycle outcome cannot be restored safely. An operational check is required before another write.")
    return parsed.data
  })
}
export function projectLifecycleAttempt(row: LifecycleAttemptRow, idempotent = true) {
  const baseline = googleLifecycleBaselineSchema.parse({ ...row.baseline, observedAt: row.requested.observedAt })
  const parsed = googleLifecycleObservationSchema.safeParse(row.observation)
  const observation = parsed.success ? parsed.data : null
  const postcondition = observation ? lifecycleConfirmation({ request: row.requested.request, baseline, observation }) : "unresolved"
  return lifecycleAttemptSchema.parse({
    id: row.id, reviewId: row.reviewId, locationId: row.locationId, operation: row.operation,
    target: row.target, payloadHash: row.payloadHash, request: row.requested.request, sourceAccount: baseline.source.account.name,
    executionState: row.executionState, confirmationState: row.confirmationState,
    localReconciliation: row.localReconciliation,
    postcondition, observedAt: observation?.observedAt ?? null, errorCode: row.errorCode, idempotent,
  })
}
export async function readLifecycleAttempt(session: Session, locationId: string, reviewId: string, idempotent = true) {
  const row = await loadLifecycleAttempt(session, locationId, reviewId)
  if (!row) throw new ApiError(404, "lifecycle_attempt_not_found", "No lifecycle request is recorded for this review.")
  return projectLifecycleAttempt(row, idempotent)
}
export async function refreshLifecycleObservation(session: Session, locationId: string, row: LifecycleAttemptRow, requestId: string) {
  const baseline = googleLifecycleBaselineSchema.parse({ ...row.baseline, observedAt: row.requested.observedAt })
  let observation: z.infer<typeof googleLifecycleObservationSchema> | null = null
  try { observation = await observeLifecyclePostcondition(session, locationId, row.requested, baseline) }
  catch (error) { if (!(error instanceof Error)) throw error }
  const prior = googleLifecycleObservationSchema.safeParse(row.observation)
  const selected = observation ?? (prior.success ? prior.data : null)
  const postcondition = selected ? lifecycleConfirmation({ request: row.requested.request, baseline, observation: selected }) : "unresolved"
  const confirmed = postcondition !== "unresolved" && (observation !== null || row.confirmationState === "confirmed")
  const reconciliation = row.requested.request.operation === "delete_location" ? "not_required"
    : observation && confirmed ? await reconcileLifecycleTransfer(session, locationId, row.requested, baseline, observation)
    : row.localReconciliation === "applied" ? "applied" : "pending"
  await withTenant(session.organisationId, async (sql) => {
    await sql`update gbp_management_mutation set confirmation_state = ${confirmed ? "confirmed" : "unresolved"},
      confirmation_response = ${selected ? jsonColumn(sql, selected) : null},
      confirmation_observed_at = ${selected ? new Date(selected.observedAt) : null},
      confirmation_error_code = ${observation === null ? "lifecycle_refresh_failed" : confirmed ? null : "lifecycle_postcondition_unconfirmed"},
      local_reconciliation_state = ${reconciliation}
      where id = ${row.id}`
    await gbpManagementAttemptStore.settle(sql, { id: row.id, status: confirmed ? "succeeded" : "ambiguous", response: row.providerResponse, errorCode: confirmed ? null : "lifecycle_postcondition_unconfirmed" })
  })
  await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.lifecycle.observed", subjectType: "location", subjectId: locationId, requestId, metadata: { reviewId: row.reviewId, mutationId: row.id, executionState: row.executionState, confirmationState: confirmed ? "confirmed" : "unresolved", postcondition, refreshUnavailable: observation === null } })
  return readLifecycleAttempt(session, locationId, row.reviewId, false)
}
