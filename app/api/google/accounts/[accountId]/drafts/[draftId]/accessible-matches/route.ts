import { z } from "zod"
import { onboardingAccessibleMatchesQuerySchema } from "@/lib/contracts/google-onboarding-accessible-matches"
import { discoverOnboardingAccessibleMatches } from "@/lib/server/google-onboarding-accessible-matches"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
export const GET = route({
  maxDuration,
  roles: ["owner", "admin"],
  params: z.object({ accountId: z.uuid(), draftId: z.uuid() }),
  query: onboardingAccessibleMatchesQuerySchema,
  handler: ({ session, params, query }) => discoverOnboardingAccessibleMatches(session, params.accountId, params.draftId, query),
})
