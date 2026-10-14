import { z } from "zod"
import { onboardingServicesQuerySchema } from "@/lib/contracts/google-onboarding-services"
import { getOnboardingServices } from "@/lib/server/google-onboarding-services"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// Not 60: its Google calls (token, account check and service read in a row) do
// not stop at ctx.deadline yet, so this keeps the platform default it ran
// under.
export const maxDuration = 300
export const GET = route({
  maxDuration,
  roles: ["owner", "admin"],
  params: z.object({ accountId: z.uuid(), draftId: z.uuid() }),
  query: onboardingServicesQuerySchema,
  handler: ({ session, params, query }) => getOnboardingServices(session, { ...params, ...query }),
})
