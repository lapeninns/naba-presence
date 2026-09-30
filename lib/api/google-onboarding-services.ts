import { onboardingServicesResponseSchema } from "@/lib/contracts/google-onboarding-services"
import { apiFetch, type RequestOptions } from "./client"

export function fetchOnboardingServices(target: { readonly accountId: string; readonly draftId: string; readonly expectedRevision: number }, options?: RequestOptions) {
  const query = new URLSearchParams({ expectedRevision: String(target.expectedRevision) })
  return apiFetch(`/api/google/accounts/${encodeURIComponent(target.accountId)}/drafts/${encodeURIComponent(target.draftId)}/services?${query}`, { schema: onboardingServicesResponseSchema, ...options })
}
