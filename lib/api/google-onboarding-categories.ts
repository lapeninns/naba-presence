import {
  onboardingCategoryPageSchema,
  type OnboardingCategoryQuery,
} from "@/lib/contracts/google-onboarding-categories"
import { apiFetch, type RequestOptions } from "./client"

export function fetchOnboardingCategories(
  accountId: string,
  input: OnboardingCategoryQuery,
  options?: RequestOptions
) {
  const query = new URLSearchParams({
    connectionId: input.connectionId,
    regionCode: input.regionCode,
    languageCode: input.languageCode,
    query: input.query,
  })
  if (input.clientId) query.set("clientId", input.clientId)
  if (input.pageToken) query.set("pageToken", input.pageToken)
  return apiFetch(
    `/api/google/accounts/${encodeURIComponent(accountId)}/categories?${query}`,
    {
      schema: onboardingCategoryPageSchema,
      ...options,
    }
  )
}
