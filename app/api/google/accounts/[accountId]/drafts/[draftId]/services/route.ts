import { z } from "zod"
import { onboardingServicesQuerySchema } from "@/lib/contracts/google-onboarding-services"
import { getOnboardingServices } from "@/lib/server/google-onboarding-services"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const GET = route({
  roles: ["owner", "admin"],
  params: z.object({ accountId: z.uuid(), draftId: z.uuid() }),
  query: onboardingServicesQuerySchema,
  handler: ({ session, params, query }) => getOnboardingServices(session, { ...params, ...query }),
})
