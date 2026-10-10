import "server-only"
import { placeActionReviewSchema, reviewedPlaceActionPayloadSchema, type PlaceActionReview, type ReviewedPlaceActionRequest } from "@/lib/contracts/place-action-review"
import { approveGbpChange, readGbpChangeSet, saveGbpChangeSet } from "@/lib/server/gbp-change-sets"
import { stableGoogleHash } from "@/lib/server/gbp-management"
import { currentPlaceActionContext, observePlaceActions, requirePlaceActionProposal } from "@/lib/server/place-action-review-state"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

export function projectPlaceActionReview(changeSet: PlaceActionReview["changeSet"]) {
  const payload = reviewedPlaceActionPayloadSchema.safeParse(changeSet.payload)
  if (!payload.success) throw new ApiError(409, "place_action_review_unreadable", "This action link review cannot be restored safely. Create a fresh review.")
  const target = changeSet.targetResourceName
  if (!target) throw new ApiError(409, "place_action_review_unreadable", "This action link review has no exact Google target.")
  return placeActionReviewSchema.parse({ changeSet, request: payload.data.request, target, observedAt: payload.data.observedAt })
}
export function requireSamePlaceActionBinding(before: Awaited<ReturnType<typeof currentPlaceActionContext>>, after: Awaited<ReturnType<typeof currentPlaceActionContext>>) {
  if (before.connectionId !== after.connectionId || before.googleAccountId !== after.googleAccountId || before.googleLocationName !== after.googleLocationName || before.credentialGeneration !== after.credentialGeneration) throw new ApiError(409, "google_target_changed", "The linked Google target or credentials changed. Create a fresh action link review.")
}
export async function previewPlaceAction(session: Session, locationId: string, request: ReviewedPlaceActionRequest, requestId: string) {
  const linked = await currentPlaceActionContext(session, locationId)
  const observation = await observePlaceActions(linked)
  requirePlaceActionProposal(request, observation.baseline)
  const current = await currentPlaceActionContext(session, locationId)
  requireSamePlaceActionBinding(linked, current)
  const payload = reviewedPlaceActionPayloadSchema.parse({ request, connectionId: linked.connectionId, credentialGeneration: linked.credentialGeneration, observedAt: observation.observedAt })
  return projectPlaceActionReview(await saveGbpChangeSet({ session, linked: current, resourceType: "place_action", baseline: observation.baseline, payload, updateMask: [], requestId }))
}
export async function readPlaceActionReview(session: Session, locationId: string, reviewId: string) {
  return projectPlaceActionReview((await readGbpChangeSet(session, locationId, reviewId, "place_action")).changeSet)
}
export async function assertPlaceActionCurrent(session: Session, locationId: string, review: PlaceActionReview) {
  const linked = await currentPlaceActionContext(session, locationId)
  const payload = reviewedPlaceActionPayloadSchema.parse(review.changeSet.payload)
  if (payload.connectionId !== linked.connectionId || payload.credentialGeneration !== linked.credentialGeneration) throw new ApiError(409, "google_connection_changed", "The Google connection changed after review. Create a fresh review.")
  const observation = await observePlaceActions(linked)
  if (stableGoogleHash(observation.baseline) !== review.changeSet.baselineHash) throw new ApiError(409, "google_baseline_stale", "Google action links or supported action types changed after review. Refresh and review again.")
  requirePlaceActionProposal(payload.request, observation.baseline)
  return { linked, payload, observation }
}
export async function approvePlaceActionReview(session: Session, locationId: string, reviewId: string, expectedPayloadHash: string, requestId: string) {
  await assertPlaceActionCurrent(session, locationId, await readPlaceActionReview(session, locationId, reviewId))
  return projectPlaceActionReview(await approveGbpChange({ session, locationId, changeSetId: reviewId, expectedPayloadHash, requestId, resourceType: "place_action" }))
}
