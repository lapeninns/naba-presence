import "server-only"
import { googleLifecycleBaselineSchema, type GoogleLifecycleRequest } from "@/lib/contracts/google-lifecycle"
import { lifecycleReviewSchema, reviewedLifecyclePayloadSchema, type LifecycleReview } from "@/lib/contracts/google-lifecycle-review"
import { lifecycleBaselineState, lifecyclePreflightReason } from "@/lib/domain/google-lifecycle"
import { approveGbpChange, readGbpChangeSet, saveGbpChangeSet } from "@/lib/server/gbp-change-sets"
import { stableGoogleHash } from "@/lib/server/gbp-management"
import { currentAdministrationContext } from "@/lib/server/google-administration-state"
import { observeLifecycleBaseline } from "@/lib/server/google-lifecycle-observation"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

function project(changeSet: LifecycleReview["changeSet"]): LifecycleReview {
  const payload = reviewedLifecyclePayloadSchema.parse(changeSet.payload)
  const baseline = googleLifecycleBaselineSchema.parse({ ...changeSet.baseline, observedAt: payload.observedAt })
  return lifecycleReviewSchema.parse({ changeSet, request: payload.request, baseline })
}
function requireEligibility(request: GoogleLifecycleRequest, baseline: LifecycleReview["baseline"]) {
  const reason = lifecyclePreflightReason(request, baseline)
  if (reason) throw new ApiError(409, reason, "Google has not confirmed the access, exact account membership or eligibility needed for this lifecycle request. Refresh before reviewing again.")
}
function requireSameBinding(before: Awaited<ReturnType<typeof currentAdministrationContext>>, after: Awaited<ReturnType<typeof currentAdministrationContext>>) {
  if (before.connectionId !== after.connectionId || before.googleAccountId !== after.googleAccountId || before.googleLocationName !== after.googleLocationName || before.credentialGeneration !== after.credentialGeneration) throw new ApiError(409, "google_target_changed", "The linked Google target or credentials changed. Create a fresh lifecycle review.")
}
export async function previewLifecycle(session: Session, locationId: string, request: GoogleLifecycleRequest, requestId: string) {
  const { linked, baseline } = await observeLifecycleBaseline(session, locationId, request)
  requireEligibility(request, baseline)
  const current = await currentAdministrationContext(session, locationId)
  requireSameBinding(linked, current)
  const payload = reviewedLifecyclePayloadSchema.parse({ request, connectionId: current.connectionId, credentialGeneration: current.credentialGeneration, observedAt: baseline.observedAt })
  return project(await saveGbpChangeSet({ session, linked: current, resourceType: "location_lifecycle", baseline: lifecycleBaselineState(baseline), payload, updateMask: [], requestId }))
}
export async function readLifecycleReview(session: Session, locationId: string, reviewId: string) {
  const { changeSet } = await readGbpChangeSet(session, locationId, reviewId, "location_lifecycle")
  return project(changeSet)
}
export async function assertLifecycleCurrent(session: Session, locationId: string, review: LifecycleReview) {
  const payload = reviewedLifecyclePayloadSchema.parse(review.changeSet.payload)
  const { linked, baseline } = await observeLifecycleBaseline(session, locationId, payload.request)
  if (payload.connectionId !== linked.connectionId || payload.credentialGeneration !== linked.credentialGeneration) throw new ApiError(409, "google_connection_changed", "The Google connection changed after review. Create a fresh lifecycle review.")
  const state = lifecycleBaselineState(baseline)
  if (stableGoogleHash(state) !== review.changeSet.baselineHash) {
    // Name the destination when only its access or inventory moved, so the
    // reviewer is told which account to check before reviewing again.
    const reviewed = lifecycleBaselineState(review.baseline)
    const onlyDestination = stableGoogleHash({ ...state, destination: null }) === stableGoogleHash({ ...reviewed, destination: null })
    if (onlyDestination) throw new ApiError(409, "google_destination_changed", "The destination account's access or locations on Google changed after review. Create a fresh lifecycle review.")
    throw new ApiError(409, "google_baseline_stale", "Google account access or location membership changed after review. Create a fresh lifecycle review.")
  }
  requireEligibility(payload.request, baseline)
  return { linked, payload }
}
export async function approveLifecycle(session: Session, locationId: string, reviewId: string, expectedPayloadHash: string, requestId: string) {
  const review = await readLifecycleReview(session, locationId, reviewId)
  await assertLifecycleCurrent(session, locationId, review)
  return project(await approveGbpChange({ session, locationId, changeSetId: reviewId, expectedPayloadHash, requestId, resourceType: "location_lifecycle" }))
}
