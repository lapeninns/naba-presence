import { onboardingMatchLinkOperationSchema, onboardingMatchLinkReviewSchema, type OnboardingMatchLinkInput } from "@/lib/contracts/google-onboarding-match-link"
import { ApiClientError, apiFetch, type RequestOptions } from "./client"

type Target = { readonly accountId: string; readonly draftId: string }
function path(target: Target) {
  return `/api/google/accounts/${encodeURIComponent(target.accountId)}/drafts/${encodeURIComponent(target.draftId)}/match-link-reviews`
}
export function previewOnboardingMatchLink(target: Target, input: OnboardingMatchLinkInput, options?: RequestOptions) {
  return apiFetch(path(target), { method: "POST", body: input, schema: onboardingMatchLinkReviewSchema, ...options })
}
export function fetchOnboardingMatchLinkReview(target: Target, reviewId: string, options?: RequestOptions) {
  return apiFetch(`${path(target)}/${encodeURIComponent(reviewId)}`, { schema: onboardingMatchLinkReviewSchema, ...options })
}
export function approveOnboardingMatchLink(target: Target, reviewId: string, expectedReviewHash: string, options?: RequestOptions) {
  return apiFetch(`${path(target)}/${encodeURIComponent(reviewId)}`, { method: "POST", body: { expectedReviewHash }, schema: onboardingMatchLinkReviewSchema, ...options })
}
function operationPath(target: Target) {
  return `/api/google/accounts/${encodeURIComponent(target.accountId)}/drafts/${encodeURIComponent(target.draftId)}/match-link`
}
export async function fetchOnboardingMatchLink(target: Target, options?: RequestOptions) {
  try {
    return await apiFetch(operationPath(target), { schema: onboardingMatchLinkOperationSchema, ...options })
  } catch (error) {
    if (error instanceof ApiClientError && error.code === "onboarding_match_link_not_found") return null
    throw error
  }
}
export function submitOnboardingMatchLink(target: Target, reviewId: string, expectedReviewHash: string, options?: RequestOptions) {
  return apiFetch(operationPath(target), { method: "POST", body: { reviewId, expectedReviewHash }, schema: onboardingMatchLinkOperationSchema, ...options })
}
