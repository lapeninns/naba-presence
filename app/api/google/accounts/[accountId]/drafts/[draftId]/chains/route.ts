import { z } from "zod"
import { onboardingChainsQuerySchema } from "@/lib/contracts/google-onboarding-chains"
import { searchOnboardingChains } from "@/lib/server/google-onboarding-chains"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// Not 60: its Google calls (token, account check and chain search in a row) do
// not stop at ctx.deadline yet, so this keeps the platform default it ran
// under.
export const maxDuration = 300
export const GET = route({
  maxDuration,
  roles: ["owner", "admin"],
  params: z.object({ accountId: z.uuid(), draftId: z.uuid() }),
  query: onboardingChainsQuerySchema,
  handler: ({ session, params, query }) => searchOnboardingChains(session, params.accountId, params.draftId, query),
})
