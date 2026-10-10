import { onboardingAccessibleMatchesResponseSchema } from "@/lib/contracts/google-onboarding-accessible-matches"
import { apiFetch, type RequestOptions } from "./client"

export function fetchOnboardingAccessibleMatches(target: { readonly accountId: string; readonly draftId: string; readonly expectedRevision: number; readonly expectedMatchCheckedAt: string }, options?: RequestOptions) {
  const query = new URLSearchParams({ expectedRevision: String(target.expectedRevision), expectedMatchCheckedAt: target.expectedMatchCheckedAt })
  return apiFetch(`/api/google/accounts/${encodeURIComponent(target.accountId)}/drafts/${encodeURIComponent(target.draftId)}/accessible-matches?${query}`, { schema: onboardingAccessibleMatchesResponseSchema, ...options })
}
