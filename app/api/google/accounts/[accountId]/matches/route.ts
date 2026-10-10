import { z } from "zod"
import { googleAccountMatchInputSchema } from "@/lib/contracts/google-onboarding"
import { searchOnboardingMatches } from "@/lib/server/google-onboarding"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

export const POST = route({
  roles: ["owner", "admin"],
  params: z.object({ accountId: z.uuid() }),
  body: googleAccountMatchInputSchema,
  handler: ({ session, params, body }) => searchOnboardingMatches(session, params.accountId, body),
})
