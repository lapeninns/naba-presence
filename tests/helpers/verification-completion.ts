import type { VerificationCompletionReview } from "@/lib/contracts/google-verification-completion-review"
import type { VerificationAttempt } from "@/lib/contracts/google-verification-attempt"
import type { ObservedVerification } from "@/lib/contracts/google-verification-state"
import type { VerificationWorkflowItem } from "@/lib/contracts/google-verification-workflows"

export const completionLocationId = "00000000-0000-4000-8000-000000000001"
export const completionReviewId = "00000000-0000-4000-8000-000000000002"
export const completionHash = "a".repeat(64)
export const completionRequest: ObservedVerification = { name: "locations/camden/verifications/pending", method: "SMS", providerState: "PENDING", phase: "pending", createTime: "2026-09-30T01:00:00Z" }
export const completionReview: VerificationCompletionReview = {
  changeSet: { id: completionReviewId, locationName: "Camden Hotel", payloadHash: completionHash, baselineHash: completionHash, payload: {}, baseline: {}, updateMask: [], requestedBy: completionLocationId, approvedBy: null, requiresSecondApprover: false, canApprove: true, expiresAt: "2099-01-01T00:00:00Z" },
  verification: completionRequest, payload: { name: completionRequest.name, method: "SMS", credentialBindingHash: completionHash },
}
export const completionAttempt: VerificationAttempt = {
  id: completionReviewId, reviewId: completionReviewId, payloadHash: completionHash, status: "ambiguous", executionState: "accepted", confirmationState: "unresolved", operation: "complete_verification", idempotent: false,
  verification: completionRequest, merchant: { hasVoiceOfMerchant: false, hasBusinessAuthority: true, action: "verify", hasPendingVerification: true }, observedAt: "2026-09-30T01:00:00Z", error: "outcome_unresolved",
}
export const completionWorkflow: VerificationWorkflowItem = {
  reviewId: completionReviewId, createdAt: "2026-09-30T01:00:00Z", operation: "complete_verification", method: "SMS", payloadHash: completionHash, requestedBy: completionLocationId, approvedBy: null, requiresSecondApprover: false, expiresAt: completionReview.changeSet.expiresAt, canApprove: true, reviewReason: null, attempt: null,
}
