import { onboardingChainsResponseSchema } from "@/lib/contracts/google-onboarding-chains"
import { apiFetch, type RequestOptions } from "./client"

export function fetchOnboardingChains(target: { readonly accountId: string; readonly draftId: string; readonly expectedRevision: number; readonly query: string }, options?: RequestOptions) {
  const query = new URLSearchParams({ expectedRevision: String(target.expectedRevision), query: target.query })
  return apiFetch(`/api/google/accounts/${encodeURIComponent(target.accountId)}/drafts/${encodeURIComponent(target.draftId)}/chains?${query}`, { schema: onboardingChainsResponseSchema, ...options })
}
