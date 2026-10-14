import { z } from "zod"
import { onboardingCategoryQuerySchema } from "@/lib/contracts/google-onboarding-categories"
import { searchOnboardingCategories } from "@/lib/server/google-onboarding-categories"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// Not 60: its Google calls (token, account check and category read in a row) do
// not stop at ctx.deadline yet, so this keeps the platform default it ran
// under.
export const maxDuration = 300
export const GET = route({
  maxDuration,
  roles: ["owner", "admin"],
  params: z.object({ accountId: z.uuid() }),
  query: onboardingCategoryQuerySchema,
  handler: ({ session, params, query }) =>
    searchOnboardingCategories(session, params.accountId, query),
})
