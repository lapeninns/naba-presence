import { z } from "zod"
import { onboardingCategoryQuerySchema } from "@/lib/contracts/google-onboarding-categories"
import { searchOnboardingCategories } from "@/lib/server/google-onboarding-categories"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
export const GET = route({
  maxDuration,
  roles: ["owner", "admin"],
  params: z.object({ accountId: z.uuid() }),
  query: onboardingCategoryQuerySchema,
  handler: ({ session, params, query }) =>
    searchOnboardingCategories(session, params.accountId, query),
})
