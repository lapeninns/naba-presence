import "server-only"

import { z } from "zod"

import { verificationContextSchema, verificationChoiceSchema, verificationStartPayloadSchema } from "@/lib/contracts/google-verification-options"
import type { VerificationReview, VerificationReviewInput } from "@/lib/contracts/google-verification-review"
import { verificationDestinationMatches } from "@/lib/domain/google-verification-options"
import { decryptSecret, encryptSecret } from "@/lib/server/crypto"
import { approveGbpChange, readGbpChangeSet, saveGbpChangeSet } from "@/lib/server/gbp-change-sets"
import { stableGoogleHash } from "@/lib/server/gbp-management"
import { loadGoogleVerificationOptions } from "@/lib/server/google-verification-options"
import { currentVerificationContext, loadGoogleVerificationState } from "@/lib/server/google-verification-state"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

const storedPayloadSchema = z.object({ contextHash: z.string().length(64), contextProvided: z.boolean(), optionId: z.string().length(64) })
const privateReviewSchema = z.strictObject({ choice: verificationChoiceSchema, context: verificationContextSchema.optional() })

export async function previewVerificationStart(session: Session, locationId: string, input: VerificationReviewInput, requestId: string): Promise<VerificationReview> {
  const linked = await currentVerificationContext(session, locationId)
  if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot start verification for this listing.")
  const discovered = await loadGoogleVerificationOptions(session, locationId, { languageCode: input.payload.languageCode, context: input.payload.context })
  if (discovered.googleLocationName !== linked.googleLocationName) throw new ApiError(409, "google_target_changed", "The linked Google business changed. Refresh and review again.")
  if (discovered.customerLocationOnly === true && !input.payload.context) throw new ApiError(400, "verification_context_required", "Supply the service business verification address before reviewing this request.")
  const choice = discovered.options.find((option) => option.id === input.optionId)
  if (!choice || !verificationDestinationMatches(choice, input.payload)) throw new ApiError(409, "verification_option_changed", "The chosen method or destination is no longer eligible. Refresh and review again.")
  const { context, ...publicInput } = input.payload
  const payload = { ...publicInput, contextHash: discovered.contextHash, contextProvided: Boolean(context), optionId: choice.id }
  const state = await loadGoogleVerificationState(session, locationId)
  const current = await currentVerificationContext(session, locationId)
  if (current.googleLocationName !== linked.googleLocationName || current.connectionId !== linked.connectionId || current.googleAccountId !== linked.googleAccountId || current.credentialGeneration !== linked.credentialGeneration) throw new ApiError(409, "google_target_changed", "The Google connection changed during review. Refresh again.")
  const baseline = { choiceId: choice.id, choiceHash: stableGoogleHash(choice), customerLocationOnly: discovered.customerLocationOnly, googleLocationName: discovered.googleLocationName, credentialGeneration: linked.credentialGeneration, verificationStateHash: verificationObservationHash(state) }
  const privatePayload = encryptSecret(JSON.stringify({ choice, ...(context ? { context } : {}) }))
  const changeSet = await saveGbpChangeSet({ session, linked, resourceType: "verification_start", baseline, payload, updateMask: [], requestId, privatePayload })
  return { changeSet, choice, payload: input.payload }
}

export async function readVerificationReview(session: Session, locationId: string, reviewId: string): Promise<VerificationReview> {
  const { changeSet, privatePayload } = await readGbpChangeSet(session, locationId, reviewId, "verification_start")
  const stored = storedPayloadSchema.safeParse(changeSet.payload)
  if (!stored.success || !privatePayload || stableGoogleHash(changeSet.baseline) !== changeSet.baselineHash) throw new ApiError(409, "approval_stale", "The saved verification review is unreadable. Generate a new review.")
  let privateReview: z.infer<typeof privateReviewSchema>
  try { privateReview = privateReviewSchema.parse(JSON.parse(decryptSecret(privatePayload))) }
  catch (error) {
    if (error instanceof Error) throw new ApiError(409, "approval_stale", "The private verification context could not be restored. Generate a new review.")
    throw error
  }
  const { choice, context } = privateReview
  if (changeSet.baseline.choiceId !== choice.id || changeSet.baseline.choiceHash !== stableGoogleHash(choice)) throw new ApiError(409, "approval_stale", "The reviewed Google choice changed. Generate a new review.")
  if (stored.data.contextProvided !== Boolean(context) || stableGoogleHash(context ?? null) !== stored.data.contextHash) throw new ApiError(409, "approval_stale", "The private verification context changed. Generate a new review.")
  const publicInput = { ...changeSet.payload }
  delete publicInput.contextHash
  delete publicInput.contextProvided
  delete publicInput.optionId
  const payload = verificationStartPayloadSchema.safeParse({ ...publicInput, ...(context ? { context } : {}) })
  if (!payload.success || choice.id !== stored.data.optionId || !verificationDestinationMatches(choice, payload.data)) throw new ApiError(409, "approval_stale", "The reviewed destination changed. Generate a new review.")
  return { changeSet, choice, payload: payload.data }
}

export async function approveVerificationReview(session: Session, locationId: string, reviewId: string, expectedPayloadHash: string, requestId: string): Promise<VerificationReview> {
  const review = await readVerificationReview(session, locationId, reviewId)
  if (review.changeSet.payloadHash !== expectedPayloadHash) throw new ApiError(409, "approval_stale", "The reviewed content changed. Generate a new review.")
  await assertVerificationReviewCurrent(session, locationId, review)
  await approveGbpChange({ session, locationId, changeSetId: reviewId, expectedPayloadHash, requestId, resourceType: "verification_start" })
  return readVerificationReview(session, locationId, reviewId)
}

function verificationObservationHash(state: Awaited<ReturnType<typeof loadGoogleVerificationState>>) {
  return stableGoogleHash({ verifications: [...state.verifications].sort((left, right) => left.name.localeCompare(right.name)), merchant: state.merchant })
}

/** Approval and execution share the exact relevant eligibility/state baseline. */
export async function assertVerificationReviewCurrent(session: Session, locationId: string, review: VerificationReview) {
  const linked = await currentVerificationContext(session, locationId)
  const fresh = await loadGoogleVerificationOptions(session, locationId, { languageCode: review.payload.languageCode, context: review.payload.context })
  const state = await loadGoogleVerificationState(session, locationId)
  const choice = fresh.options.find((option) => option.id === review.choice.id)
  const baseline = { choiceId: choice?.id, choiceHash: stableGoogleHash(choice ?? null), customerLocationOnly: fresh.customerLocationOnly, googleLocationName: fresh.googleLocationName, credentialGeneration: linked.credentialGeneration, verificationStateHash: verificationObservationHash(state) }
  if (!choice || !verificationDestinationMatches(choice, review.payload) || stableGoogleHash(baseline) !== review.changeSet.baselineHash) throw new ApiError(409, "verification_option_changed", "Google verification eligibility changed after review. Generate a new review.")
  return { linked, state }
}
