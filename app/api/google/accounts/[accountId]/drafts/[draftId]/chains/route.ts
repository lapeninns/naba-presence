import { z } from "zod"
import { onboardingChainsQuerySchema } from "@/lib/contracts/google-onboarding-chains"
import { searchOnboardingChains } from "@/lib/server/google-onboarding-chains"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
export const GET = route({
  maxDuration,
  roles: ["owner", "admin"],
  params: z.object({ accountId: z.uuid(), draftId: z.uuid() }),
  query: onboardingChainsQuerySchema,
  handler: ({ session, params, query }) => searchOnboardingChains(session, params.accountId, params.draftId, query),
})
