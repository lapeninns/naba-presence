import { lifecycleAttemptSchema, lifecycleReviewSchema } from "@/lib/contracts/google-lifecycle-review"
import type { GoogleLifecycleRequest } from "@/lib/contracts/google-lifecycle"

export const lifecycleFixtureId = "11111111-1111-4111-8111-111111111111"
export function lifecycleReviewFixture(request: GoogleLifecycleRequest = { operation: "delete_location", payload: {} }) {
  const observedAt = "2026-09-30T08:00:00.000Z"
  const location = { name: "locations/hotel", placeId: "ChIJ_owned_fixture", canDelete: true }
  const baseline = { location, source: { account: { name: "accounts/source", role: "OWNER" }, complete: true, locations: [location] },
    destination: request.operation === "transfer_location" ? { account: { name: request.payload.destinationAccount, role: "MANAGER" }, complete: true, locations: [] } : null }
  return lifecycleReviewSchema.parse({ request, baseline: { ...baseline, observedAt }, changeSet: {
    id: lifecycleFixtureId, locationName: "Camden Hotel", targetResourceName: location.name,
    payloadHash: "a".repeat(64), baselineHash: "b".repeat(64),
    payload: { request, connectionId: lifecycleFixtureId, credentialGeneration: 1, observedAt }, baseline, updateMask: [],
    requestedBy: lifecycleFixtureId, approvedBy: null, requiresSecondApprover: false, canApprove: true,
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
  } })
}
export function lifecycleAttemptFixture() {
  const review = lifecycleReviewFixture()
  return lifecycleAttemptSchema.parse({ id: lifecycleFixtureId, reviewId: lifecycleFixtureId, locationId: lifecycleFixtureId,
    payloadHash: review.changeSet.payloadHash, request: review.request, sourceAccount: review.baseline.source.account.name,
    operation: review.request.operation, target: review.baseline.location.name, executionState: "accepted", confirmationState: "confirmed",
    localReconciliation: "not_required",
    postcondition: "location_absent_from_managed_account", observedAt: "2026-09-30T08:01:00.000Z", errorCode: null, idempotent: false,
  })
}
