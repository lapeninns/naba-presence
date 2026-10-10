import "server-only"

import { z } from "zod"
import {
  onboardingCategoryPageSchema,
  type OnboardingCategoryQuery,
} from "@/lib/contracts/google-onboarding-categories"
import { getDatabase } from "./db"
import {
  connectionAccessToken,
  googleAccountManagementApi,
  listGoogleCategories,
} from "./google"
import { resolveOnboardingAccount } from "./google-onboarding"
import { ApiError } from "./http"
import type { Session } from "./session"

export async function searchOnboardingCategories(
  session: Session,
  accountId: string,
  input: OnboardingCategoryQuery
) {
  const scope = {
    accountId,
    connectionId: input.connectionId,
    clientId: input.clientId,
  }
  const account = await resolveOnboardingAccount(session, scope)
  const token = await connectionAccessToken(
    getDatabase(),
    session.organisationId,
    account.connectionId
  )
  const access = await googleAccountManagementApi(
    token,
    { path: account.name },
    { connectionKey: account.connectionId }
  )
  if (!z.object({ name: z.literal(account.name) }).safeParse(access).success) {
    throw new ApiError(
      502,
      "onboarding_account_unconfirmed",
      "Google did not confirm access to this account. Refresh account discovery."
    )
  }
  const response = await listGoogleCategories(
    token,
    {
      regionCode: input.regionCode,
      languageCode: input.languageCode,
      query: input.query,
      pageToken: input.pageToken,
    },
    { connectionKey: account.connectionId }
  )
  const parsed = onboardingCategoryPageSchema.safeParse(response)
  if (!parsed.success)
    throw new ApiError(
      502,
      "onboarding_categories_invalid",
      "Google returned incomplete categories. Retry the search."
    )
  const current = await resolveOnboardingAccount(session, scope)
  if (current.name !== account.name)
    throw new ApiError(
      409,
      "onboarding_account_changed",
      "The Google account changed during search. Refresh account discovery."
    )
  return parsed.data
}
