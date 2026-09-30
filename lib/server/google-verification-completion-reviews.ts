import "server-only"

import { verificationCompletionPayloadSchema, type VerificationCompletionInput, type VerificationCompletionReview } from "@/lib/contracts/google-verification-completion-review"
import { observedVerificationSchema } from "@/lib/contracts/google-verification-state"
import { approveGbpChange, readGbpChangeSet, saveGbpChangeSet } from "@/lib/server/gbp-change-sets"
import { stableGoogleHash } from "@/lib/server/gbp-management"
import { assertVerificationPinBinding, bindVerificationPin } from "@/lib/server/google-verification-pin-binding"
import { currentVerificationContext, loadGoogleVerificationState } from "@/lib/server/google-verification-state"
import { prepareVerificationCompletion } from "@/lib/server/google-verification-transient"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

async function pendingCompletion(session: Session, locationId: string, name: string) {
  const linked = await currentVerificationContext(session, locationId)
  if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot complete verification for this listing.")
  if (!name.startsWith(`${linked.googleLocationName}/verifications/`)) throw new ApiError(400, "invalid_verification_completion", "Select a verification belonging to this listing.")
  const state = await loadGoogleVerificationState(session, locationId)
  const verification = state.verifications.find((item) => item.name === name)
  if (!verification || verification.phase !== "pending") throw new ApiError(409, "verification_not_pending", "Google no longer reports this request as pending. Refresh verification status.")
  const method = verificationCompletionPayloadSchema.shape.method.safeParse(verification.method)
  if (!method.success) throw new ApiError(409, "verification_external_method", "This verification method cannot accept a PIN here. Continue in Google and refresh its status.")
  const current = await currentVerificationContext(session, locationId)
  if (current.googleLocationName !== linked.googleLocationName || current.googleAccountId !== linked.googleAccountId || current.connectionId !== linked.connectionId || current.credentialGeneration !== linked.credentialGeneration) throw new ApiError(409, "google_target_changed", "The Google connection changed during review. Refresh again.")
  return { linked: current, verification, method: method.data, baseline: { verification, googleLocationName: current.googleLocationName, credentialGeneration: current.credentialGeneration } }
}

export async function previewVerificationCompletion(session: Session, locationId: string, input: VerificationCompletionInput, requestId: string): Promise<VerificationCompletionReview> {
  const linked = await currentVerificationContext(session, locationId)
  const normalized = prepareVerificationCompletion(input, linked.googleLocationName)
  const current = await pendingCompletion(session, locationId, normalized.name)
  const binding = bindVerificationPin(normalized)
  const payload = { name: normalized.name, method: current.method, credentialBindingHash: binding.credentialBindingHash }
  const changeSet = await saveGbpChangeSet({ session, linked: current.linked, resourceType: "verification_complete", baseline: current.baseline, payload, updateMask: [], requestId, privatePayload: binding.privatePayload })
  return { changeSet, verification: current.verification, payload }
}

/** Restoring or approving a review never restores the PIN. Execution must receive it again transiently. */
export async function readVerificationCompletionReview(session: Session, locationId: string, reviewId: string): Promise<VerificationCompletionReview> {
  const { changeSet, privatePayload } = await readGbpChangeSet(session, locationId, reviewId, "verification_complete")
  const payload = verificationCompletionPayloadSchema.safeParse(changeSet.payload)
  const verification = observedVerificationSchema.safeParse(changeSet.baseline.verification)
  if (!payload.success || !verification.success || !privatePayload || stableGoogleHash(changeSet.baseline) !== changeSet.baselineHash || verification.data.name !== payload.data.name || verification.data.method !== payload.data.method || verification.data.phase !== "pending") throw new ApiError(409, "approval_stale", "The saved completion review is unreadable. Generate a new review.")
  const linked = await currentVerificationContext(session, locationId)
  if (!payload.data.name.startsWith(`${linked.googleLocationName}/verifications/`)) throw new ApiError(409, "google_target_changed", "The reviewed verification belongs to a different listing.")
  assertVerificationPinBinding(privatePayload, payload.data.credentialBindingHash)
  return { changeSet, verification: verification.data, payload: payload.data }
}

export async function assertVerificationCompletionCurrent(session: Session, locationId: string, review: VerificationCompletionReview) {
  const current = await pendingCompletion(session, locationId, review.payload.name)
  if (stableGoogleHash(current.baseline) !== review.changeSet.baselineHash) throw new ApiError(409, "verification_state_changed", "The Google verification changed after review. Generate a new review.")
  return current
}

export async function approveVerificationCompletionReview(session: Session, locationId: string, reviewId: string, expectedPayloadHash: string, requestId: string): Promise<VerificationCompletionReview> {
  const review = await readVerificationCompletionReview(session, locationId, reviewId)
  if (review.changeSet.payloadHash !== expectedPayloadHash) throw new ApiError(409, "approval_stale", "The reviewed content changed. Generate a new review.")
  await assertVerificationCompletionCurrent(session, locationId, review)
  await approveGbpChange({ session, locationId, changeSetId: reviewId, expectedPayloadHash, requestId, resourceType: "verification_complete" })
  return readVerificationCompletionReview(session, locationId, reviewId)
}
