import "server-only"
import { z } from "zod"
import { administrationAccessAttemptSchema, administrationAccessObservationSchema, type AdministrationAccessAttempt } from "@/lib/contracts/google-administration-attempt"
import { googleAdminNameSchema, reviewedAdministrationPayloadSchema } from "@/lib/contracts/google-administration-review"
import { gbpConfirmationStateSchema, gbpExecutionStateSchema } from "@/lib/contracts/gbp-management"
import { administrationAccessConfirmation } from "@/lib/domain/google-administration-confirmation"
import { jsonColumn, withTenant } from "@/lib/server/db"
import { auditGbpMutation, gbpManagementAttemptStore } from "@/lib/server/gbp-management"
import { administrationBaselineSchema, currentAdministrationContext, scopedAdministrationTarget } from "@/lib/server/google-administration-state"
import { observeAdministrationPostcondition } from "@/lib/server/google-administration-observation"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

const rowSchema = z.object({
  id: z.uuid(), reviewId: z.uuid(), payloadHash: z.string().length(64),
  status: z.enum(["started", "validated", "succeeded", "failed", "ambiguous"]),
  executionState: gbpExecutionStateSchema, confirmationState: gbpConfirmationStateSchema,
  target: z.string(), accountId: z.uuid(), operation: z.string(), resourceType: z.string(),
  requested: reviewedAdministrationPayloadSchema, baseline: administrationBaselineSchema,
  providerResponse: z.unknown(), observation: z.unknown(), createdAt: z.date(),
  confirmationError: z.string().nullable(),
})
export type AdministrationAttemptRow = z.infer<typeof rowSchema>
const receiptSchema = z.object({ name: googleAdminNameSchema, admin: z.string().optional(), account: z.string().optional() })

export async function loadAdministrationAccessAttempt(session: Session, locationId: string, reviewId: string) {
  const linked = await currentAdministrationContext(session, locationId, false)
  const [raw] = await withTenant(session.organisationId, (sql) => sql`
    select m.id, m.change_set_id as "reviewId", c.payload_hash as "payloadHash", m.status,
      m.execution_state as "executionState", m.confirmation_state as "confirmationState",
      m.target_resource_name as target, m.google_account_id as "accountId", m.operation,
      m.resource_type as "resourceType", m.requested_payload as requested, c.baseline,
      m.google_response as "providerResponse", m.confirmation_response as observation,
      m.created_at as "createdAt", m.confirmation_error_code as "confirmationError"
    from gbp_management_mutation m join gbp_change_set c on c.id = m.change_set_id
    where m.location_id = ${locationId} and m.change_set_id = ${reviewId}
      and c.resource_type = 'administration_access'
  `)
  if (!raw) return null
  const parsed = rowSchema.safeParse(raw)
  if (!parsed.success) throw new ApiError(409, "administration_attempt_unreadable", "This administration outcome cannot be read safely. Continue in Google before another change.")
  const row = parsed.data
  const target = scopedAdministrationTarget(row.requested.request, linked)
  if (row.accountId !== linked.googleAccountId || row.requested.connectionId !== linked.connectionId || row.target !== target.target || row.operation !== row.requested.request.operation || row.resourceType !== target.resourceType || row.baseline.collection !== target.collection) throw new ApiError(409, "administration_target_changed", "The linked Google target changed. This earlier attempt cannot be checked against another target.")
  return { linked, row }
}

export function projectAdministrationAttempt(row: AdministrationAttemptRow, idempotent: boolean): AdministrationAccessAttempt {
  const parsed = administrationAccessObservationSchema.safeParse(row.observation)
  const observation = parsed.success ? parsed.data : null
  const receipt = receiptSchema.safeParse(row.providerResponse)
  const confirmation = observation ? administrationAccessConfirmation({ request: row.requested.request, baseline: row.baseline, observation, receipt: receipt.success ? receipt.data : null }) : null
  return administrationAccessAttemptSchema.parse({
    id: row.id, reviewId: row.reviewId, payloadHash: row.payloadHash,
    request: row.requested.request, target: row.target, status: row.status,
    executionState: row.executionState, confirmationState: row.confirmationState, idempotent,
    observation, postcondition: confirmation?.postcondition ?? "unknown", pendingInvitation: confirmation?.pendingInvitation ?? null,
    error: row.executionState === "rejected" ? "provider_rejected" : row.confirmationError === "administration_refresh_failed" ? "refresh_unavailable" : row.confirmationState === "unresolved" ? "outcome_unresolved" : null,
  })
}

export async function readAdministrationAccessAttempt(session: Session, locationId: string, reviewId: string, idempotent = true) {
  const attempt = await loadAdministrationAccessAttempt(session, locationId, reviewId)
  if (!attempt) throw new ApiError(404, "administration_attempt_not_found", "No administration request is recorded for this review.")
  return projectAdministrationAttempt(attempt.row, idempotent)
}

export async function refreshAdministrationObservation(session: Session, locationId: string, row: AdministrationAttemptRow, requestId: string) {
  let observation: z.infer<typeof administrationAccessObservationSchema> | null = null
  try { observation = await observeAdministrationPostcondition(session, locationId, row.requested.request, row.baseline) }
  catch (error) { if (!(error instanceof Error)) throw error }
  const receipt = receiptSchema.safeParse(row.providerResponse)
  const prior = administrationAccessObservationSchema.safeParse(row.observation)
  const selected = observation ?? (prior.success ? prior.data : null)
  const confirmation = selected ? administrationAccessConfirmation({ request: row.requested.request, baseline: row.baseline, observation: selected, receipt: receipt.success ? receipt.data : null }) : null
  const confirmed = confirmation?.confirmed === true && (observation !== null || row.confirmationState === "confirmed")
  await withTenant(session.organisationId, async (sql) => {
    await sql`
    update gbp_management_mutation set confirmation_state = ${confirmed ? "confirmed" : "unresolved"},
      confirmation_response = ${selected ? jsonColumn(sql, selected) : null},
      confirmation_observed_at = ${selected ? new Date(selected.observedAt) : null},
      confirmation_error_code = ${observation === null ? "administration_refresh_failed" : confirmed ? null : "administration_postcondition_unconfirmed"}
    where id = ${row.id}
    `
    await gbpManagementAttemptStore.settle(sql, { id: row.id, status: confirmed ? "succeeded" : "ambiguous", response: row.providerResponse, errorCode: confirmed ? null : "administration_postcondition_unconfirmed" })
  })
  await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.administration.observed", subjectType: "location", subjectId: locationId, requestId, metadata: { reviewId: row.reviewId, mutationId: row.id, executionState: row.executionState, confirmationState: confirmed ? "confirmed" : "unresolved", refreshUnavailable: observation === null } })
  return readAdministrationAccessAttempt(session, locationId, row.reviewId, false)
}
