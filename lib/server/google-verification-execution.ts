import "server-only"

import { z } from "zod"
import type { VerificationAttempt } from "@/lib/contracts/google-verification-attempt"
import { gbpConfirmationStateSchema, gbpExecutionStateSchema } from "@/lib/contracts/gbp-management"
import { verificationStateResponseSchema } from "@/lib/contracts/google-verification-state"
import { jsonColumn, withSessionConnection, withTenant } from "@/lib/server/db"
import { approvedGbpChange, readGbpChangeSet } from "@/lib/server/gbp-change-sets"
import { auditGbpMutation, settleGbpMutation, startGbpMutation } from "@/lib/server/gbp-management"
import { googleVerificationApi, GoogleMutationAmbiguousError } from "@/lib/server/google"
import { assertVerificationReviewCurrent, readVerificationReview } from "@/lib/server/google-verification-reviews"
import { assertVerificationCompletionCurrent, readVerificationCompletionReview } from "@/lib/server/google-verification-completion-reviews"
import { assertVerificationPinBinding } from "@/lib/server/google-verification-pin-binding"
import { currentVerificationContext, loadGoogleVerificationState } from "@/lib/server/google-verification-state"
import { prepareVerificationCompletion, recordedVerificationResponse, verificationFailure } from "@/lib/server/google-verification-transient"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

const rowSchema = z.object({
  id: z.uuid(), reviewId: z.uuid(), payloadHash: z.string().length(64),
  status: z.enum(["started", "validated", "succeeded", "failed", "ambiguous"]),
  executionState: gbpExecutionStateSchema, confirmationState: gbpConfirmationStateSchema,
  target: z.string(), accountId: z.uuid(), createdAt: z.date(),
  operation: z.enum(["start_verification", "complete_verification"]), reviewedName: z.string().nullable(),
  requested: z.object({ method: z.string(), name: z.string().optional(), connectionId: z.uuid(), credentialGeneration: z.number().int() }),
  providerResponse: z.unknown(), observation: z.unknown(), observedAt: z.date().nullable(),
  confirmationError: z.string().nullable(),
})
type AttemptRow = z.infer<typeof rowSchema>
const operations = { verification_start: "start_verification", verification_complete: "complete_verification" } as const
type ReviewResource = keyof typeof operations
type AttemptOptions = { readonly idempotent?: boolean; readonly resourceType?: ReviewResource }
const identitySchema = z.object({ name: z.string().optional(), verification: z.object({ name: z.string().optional() }).optional() })
function returnedName(response: unknown) {
  const parsed = identitySchema.safeParse(response)
  return parsed.success ? parsed.data.verification?.name ?? parsed.data.name ?? null : null
}

async function loadAttempt(session: Session, locationId: string, reviewId: string, resourceType: ReviewResource = "verification_start") {
  const linked = await currentVerificationContext(session, locationId, { requireActiveConnection: false })
  const [raw] = await withTenant(session.organisationId, (sql) => sql`
    select m.id, m.change_set_id as "reviewId", c.payload_hash as "payloadHash", m.status,
      m.execution_state as "executionState", m.confirmation_state as "confirmationState",
      m.target_resource_name as target, m.google_account_id as "accountId", m.created_at as "createdAt",
      m.operation, c.payload ->> 'name' as "reviewedName", m.requested_payload as requested, m.google_response as "providerResponse",
      m.confirmation_response as observation, m.confirmation_observed_at as "observedAt", m.confirmation_error_code as "confirmationError"
    from gbp_management_mutation m join gbp_change_set c on c.id = m.change_set_id
    where m.location_id = ${locationId} and m.change_set_id = ${reviewId}
      and m.resource_type = 'verification' and m.operation = ${operations[resourceType]}
      and c.resource_type = ${resourceType}
  `)
  if (!raw) return null
  const parsed = rowSchema.safeParse(raw)
  if (!parsed.success) throw new ApiError(409, "verification_attempt_unreadable", "This verification outcome is unreadable. Continue in Google before starting again.")
  const row = parsed.data
  const targetMatches = resourceType === "verification_start" ? row.target === linked.googleLocationName
    : row.target === row.reviewedName && row.target === row.requested.name && /^locations\/[A-Za-z0-9_-]+\/verifications\/[A-Za-z0-9_-]+$/.test(row.target) && row.target.startsWith(`${linked.googleLocationName}/verifications/`)
  if (!targetMatches || row.accountId !== linked.googleAccountId || row.requested.connectionId !== linked.connectionId) throw new ApiError(409, "google_target_changed", "The linked Google business changed. The earlier request cannot be checked against this target.")
  return { row, linked }
}

function attemptName(row: AttemptRow) { return row.operation === "complete_verification" ? row.target : returnedName(row.providerResponse) }
function confirmablePhase(row: AttemptRow, phase: string): boolean {
  switch (row.operation) {
    case "start_verification": return phase !== "unknown"
    case "complete_verification": return phase === "completed" || phase === "failed"
  }
}

function projectAttempt(row: AttemptRow, idempotent: boolean): VerificationAttempt {
  const parsed = verificationStateResponseSchema.safeParse(row.observation)
  const state = parsed.success ? parsed.data : null
  const name = attemptName(row)
  return {
    id: row.id, reviewId: row.reviewId, payloadHash: row.payloadHash, status: row.status,
    executionState: row.executionState, confirmationState: row.confirmationState, operation: row.operation, idempotent,
    verification: state?.verifications.find((item) => item.name === name) ?? null,
    merchant: state?.merchant ?? null, observedAt: row.observedAt?.toISOString() ?? null,
    error: row.status === "failed" ? row.operation === "start_verification" ? "start_rejected" : row.confirmationState === "confirmed" ? "verification_failed" : "completion_rejected" : row.confirmationError === "verification_refresh_failed" ? "refresh_unavailable" : row.confirmationState === "unresolved" ? "outcome_unresolved" : null,
  }
}

export async function readVerificationAttempt(session: Session, locationId: string, reviewId: string, options: AttemptOptions = {}): Promise<VerificationAttempt> {
  const attempt = await loadAttempt(session, locationId, reviewId, options.resourceType)
  if (!attempt) throw new ApiError(404, "verification_attempt_not_found", "No verification request is recorded for this review.")
  return projectAttempt(attempt.row, options.idempotent ?? true)
}

async function withVerificationLock<T>(session: Session, locationId: string, work: () => Promise<T>) {
  return withSessionConnection((connection) => connection.begin(async (lock) => {
    const [claim] = await lock<{ readonly acquired: boolean }[]>`select pg_try_advisory_xact_lock(hashtextextended(${`${session.organisationId}:${locationId}:verification`}, 0)) as acquired`
    if (!claim?.acquired) throw new ApiError(409, "verification_in_progress", "Another verification request is being checked or sent. Refresh its status.")
    return work()
  }))
}

async function observeAttempt(session: Session, locationId: string, row: AttemptRow, requestId: string) {
  let observation: Awaited<ReturnType<typeof loadGoogleVerificationState>> | null = null
  try { observation = await loadGoogleVerificationState(session, locationId) }
  catch (error) { if (!(error instanceof Error)) throw error }
  const name = attemptName(row)
  const exact = observation?.verifications.find((item) => item.name === name && item.method === row.requested.method && confirmablePhase(row, item.phase))
  const prior = verificationStateResponseSchema.safeParse(row.observation)
  const priorExact = prior.success && prior.data.verifications.some((item) => item.name === name && item.method === row.requested.method && confirmablePhase(row, item.phase))
  const retainConfirmed = observation === null && row.confirmationState === "confirmed" && priorExact
  const confirmed = Boolean(exact) || retainConfirmed
  const terminalFailure = row.operation === "complete_verification" && exact?.phase === "failed"
  const execution = row.executionState === "accepted" ? "accepted" : "unknown"
  await withTenant(session.organisationId, (sql) => sql`
    update gbp_management_mutation set execution_state = ${execution}, confirmation_state = ${confirmed ? "confirmed" : "unresolved"},
      confirmation_response = ${observation ? jsonColumn(sql, observation) : row.observation == null ? null : jsonColumn(sql, row.observation)},
      confirmation_observed_at = ${observation ? new Date() : row.observedAt},
      confirmation_error_code = ${observation === null ? "verification_refresh_failed" : confirmed ? null : "verification_identity_unconfirmed"}
    where id = ${row.id}
  `)
  await settleGbpMutation({ organisationId: session.organisationId, mutationId: row.id, status: terminalFailure ? "failed" : confirmed ? "succeeded" : "ambiguous", response: row.providerResponse, errorCode: terminalFailure ? "verification_failed" : confirmed ? undefined : "verification_identity_unconfirmed" })
  await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.verification.observed", subjectType: "location", subjectId: locationId, requestId, metadata: { reviewId: row.reviewId, mutationId: row.id, executionState: execution, confirmationState: confirmed ? "confirmed" : "unresolved", refreshUnavailable: observation === null } })
  return readVerificationAttempt(session, locationId, row.reviewId, { idempotent: false, resourceType: row.operation === "complete_verification" ? "verification_complete" : "verification_start" })
}

/** One durable claim per approved review. No retry path sends a second provider request. */
export async function executeVerificationStart(session: Session, locationId: string, reviewId: string, expectedPayloadHash: string, requestId: string): Promise<VerificationAttempt> {
  return withVerificationLock(session, locationId, async () => {
    const existing = await loadAttempt(session, locationId, reviewId)
    if (existing) {
      if (existing.row.payloadHash !== expectedPayloadHash) throw new ApiError(409, "approval_stale", "The reviewed request changed.")
      return projectAttempt(existing.row, true)
    }
    const review = await readVerificationReview(session, locationId, reviewId)
    if (review.changeSet.payloadHash !== expectedPayloadHash) throw new ApiError(409, "approval_stale", "The reviewed request changed.")
    const initial = await currentVerificationContext(session, locationId)
    await approvedGbpChange({ session, linked: initial, changeSetId: reviewId, payload: review.changeSet.payload, updateMask: [], resourceType: "verification_start" })
    const { linked, state } = await assertVerificationReviewCurrent(session, locationId, review)
    if (state.verifications.some((item) => item.phase === "pending") || state.merchant?.hasPendingVerification === true) throw new ApiError(409, "verification_already_pending", "A Google verification is already pending. Complete or refresh it before starting again.")
    if (state.merchant?.hasVoiceOfMerchant === true) throw new ApiError(409, "verification_not_required", "Google already reports merchant standing. Refresh the listing instead.")
    if (!state.merchant || state.merchant.action !== "verify" || state.merchant.hasPendingVerification !== false || state.verifications.some((item) => item.phase === "unknown")) throw new ApiError(409, "verification_state_unknown", "Google has not established that a new verification can start here. Refresh or continue in Google.")
    const current = await currentVerificationContext(session, locationId)
    if (current.credentialGeneration !== linked.credentialGeneration) throw new ApiError(409, "google_target_changed", "The Google connection changed after review. Refresh again.")
    const change = await approvedGbpChange({ session, linked: current, changeSetId: reviewId, payload: review.changeSet.payload, updateMask: [], resourceType: "verification_start" })
    const token = await current.accessToken()
    const claim = await startGbpMutation({ organisationId: session.organisationId, session, locationId, googleAccountId: current.googleAccountId, resourceType: "verification", operation: "start_verification", targetResourceName: current.googleLocationName, requestId: reviewId, expectedGoogleHash: change.baseline_hash, payload: { ...change.payload, connectionId: current.connectionId, credentialGeneration: current.credentialGeneration }, changeSetId: reviewId, blockUnresolved: true, lockHeld: true })
    if (claim.idempotent) return readVerificationAttempt(session, locationId, reviewId)
    await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.verification.requested", subjectType: "location", subjectId: locationId, requestId, metadata: { reviewId, mutationId: claim.id, payloadHash: review.changeSet.payloadHash } })
    await withTenant(session.organisationId, (sql) => sql`update gbp_management_mutation set execution_state = 'pending', confirmation_state = 'pending' where id = ${claim.id}`)
    try {
      const response = recordedVerificationResponse(await googleVerificationApi(token, { path: `${current.googleLocationName}:verify`, method: "POST", payload: review.payload }, { connectionKey: current.connectionId, mutation: true }))
      const name = returnedName(response)
      if (name && !name.startsWith(`${current.googleLocationName}/verifications/`)) throw new GoogleMutationAmbiguousError("Google returned a different verification identity.")
      await withTenant(session.organisationId, (sql) => sql`update gbp_management_mutation set execution_state = 'accepted', google_response = ${jsonColumn(sql, response)} where id = ${claim.id}`)
    } catch (error) {
      const failure = verificationFailure(error)
      const rejected = !(failure instanceof GoogleMutationAmbiguousError)
      await withTenant(session.organisationId, (sql) => sql`update gbp_management_mutation set status = ${rejected ? "failed" : "ambiguous"}, execution_state = ${rejected ? "rejected" : "unknown"}, confirmation_state = ${rejected ? "unrecorded" : "unresolved"}, last_error_code = ${failure.code} where id = ${claim.id}`)
      if (rejected) {
        await settleGbpMutation({ organisationId: session.organisationId, mutationId: claim.id, status: "failed", errorCode: failure.code })
        await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.verification.rejected", subjectType: "location", subjectId: locationId, requestId, metadata: { reviewId, mutationId: claim.id, errorCode: failure.code } })
        return readVerificationAttempt(session, locationId, reviewId, { idempotent: false })
      }
    }
    const attempt = await loadAttempt(session, locationId, reviewId)
    if (!attempt) throw new ApiError(409, "verification_attempt_not_found", "The start request needs an operational check before another request.")
    return observeAttempt(session, locationId, attempt.row, requestId)
  })
}

/** Recovery remains read-only and independent of review expiry, publishing flags and old approval policy. */
export async function refreshVerificationAttempt(session: Session, locationId: string, reviewId: string, requestId: string, resourceType: ReviewResource = "verification_start"): Promise<VerificationAttempt> {
  return withVerificationLock(session, locationId, async () => {
    const attempt = await loadAttempt(session, locationId, reviewId, resourceType)
    if (!attempt) throw new ApiError(404, "verification_attempt_not_found", "No verification request is recorded for this review.")
    if (attempt.row.status === "failed") return projectAttempt(attempt.row, true)
    if ((attempt.row.status === "started" || attempt.row.status === "validated") && attempt.row.createdAt.getTime() > Date.now() - 5 * 60_000) throw new ApiError(409, "verification_not_ready", "An interrupted request can be checked after five minutes. Refresh the saved status first.")
    return observeAttempt(session, locationId, attempt.row, requestId)
  })
}

/** The reviewed PIN is supplied transiently; repeat execution only returns the durable outcome. */
export async function executeVerificationCompletion(session: Session, locationId: string, reviewId: string, expectedPayloadHash: string, pin: string, requestId: string): Promise<VerificationAttempt> {
  const resourceType = "verification_complete"
  const options = { resourceType } as const
  return withVerificationLock(session, locationId, async () => {
    const existing = await loadAttempt(session, locationId, reviewId, resourceType)
    if (existing) {
      if (existing.row.payloadHash !== expectedPayloadHash) throw new ApiError(409, "approval_stale", "The reviewed request changed.")
      return projectAttempt(existing.row, true)
    }
    const review = await readVerificationCompletionReview(session, locationId, reviewId)
    if (review.changeSet.payloadHash !== expectedPayloadHash) throw new ApiError(409, "approval_stale", "The reviewed request changed.")
    const initial = await currentVerificationContext(session, locationId)
    await approvedGbpChange({ session, linked: initial, changeSetId: reviewId, payload: review.payload, updateMask: [], resourceType })
    const { privatePayload } = await readGbpChangeSet(session, locationId, reviewId, resourceType)
    if (!privatePayload) throw new ApiError(409, "approval_stale", "The private completion review is unavailable. Generate a new review.")
    const input = prepareVerificationCompletion({ name: review.payload.name, pin }, initial.googleLocationName)
    assertVerificationPinBinding(privatePayload, review.payload.credentialBindingHash, input)
    const { linked } = await assertVerificationCompletionCurrent(session, locationId, review)
    const current = await currentVerificationContext(session, locationId)
    if (current.credentialGeneration !== linked.credentialGeneration) throw new ApiError(409, "google_target_changed", "The Google connection changed after review. Refresh again.")
    const change = await approvedGbpChange({ session, linked: current, changeSetId: reviewId, payload: review.payload, updateMask: [], resourceType })
    const token = await current.accessToken()
    const claim = await startGbpMutation({ organisationId: session.organisationId, session, locationId, googleAccountId: current.googleAccountId, resourceType: "verification", operation: "complete_verification", targetResourceName: review.payload.name, requestId: reviewId, expectedGoogleHash: change.baseline_hash, payload: { ...review.payload, connectionId: current.connectionId, credentialGeneration: current.credentialGeneration }, changeSetId: reviewId, blockUnresolved: true, unresolvedScope: { operation: "complete_verification", targetResourceName: review.payload.name }, lockHeld: true })
    if (claim.idempotent) return readVerificationAttempt(session, locationId, reviewId, options)
    await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.verification.completion_requested", subjectType: "location", subjectId: locationId, requestId, metadata: { reviewId, mutationId: claim.id, payloadHash: review.changeSet.payloadHash } })
    await withTenant(session.organisationId, (sql) => sql`update gbp_management_mutation set execution_state = 'pending', confirmation_state = 'pending' where id = ${claim.id}`)
    try {
      const response = recordedVerificationResponse(await googleVerificationApi(token, { path: `${input.name}:complete`, method: "POST", payload: { pin: input.pin } }, { connectionKey: current.connectionId, mutation: true }))
      const name = returnedName(response)
      if (name && name !== input.name) throw new GoogleMutationAmbiguousError("Google returned a different verification identity.")
      await withTenant(session.organisationId, (sql) => sql`update gbp_management_mutation set execution_state = 'accepted', google_response = ${jsonColumn(sql, response)} where id = ${claim.id}`)
    } catch (error) {
      const failure = verificationFailure(error)
      const rejected = !(failure instanceof GoogleMutationAmbiguousError)
      await withTenant(session.organisationId, (sql) => sql`update gbp_management_mutation set status = ${rejected ? "failed" : "ambiguous"}, execution_state = ${rejected ? "rejected" : "unknown"}, confirmation_state = ${rejected ? "unrecorded" : "unresolved"}, last_error_code = ${failure.code} where id = ${claim.id}`)
      if (rejected) {
        await settleGbpMutation({ organisationId: session.organisationId, mutationId: claim.id, status: "failed", errorCode: failure.code })
        await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.verification.completion_rejected", subjectType: "location", subjectId: locationId, requestId, metadata: { reviewId, mutationId: claim.id, errorCode: failure.code } })
        return readVerificationAttempt(session, locationId, reviewId, { ...options, idempotent: false })
      }
    }
    const attempt = await loadAttempt(session, locationId, reviewId, resourceType)
    if (!attempt) throw new ApiError(409, "verification_attempt_not_found", "The completion request needs an operational check before another request.")
    return observeAttempt(session, locationId, attempt.row, requestId)
  })
}
