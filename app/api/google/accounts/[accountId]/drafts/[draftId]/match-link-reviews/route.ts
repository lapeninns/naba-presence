import { z } from "zod"
import { onboardingMatchLinkInputSchema } from "@/lib/contracts/google-onboarding-match-link"
import { previewOnboardingMatchLink } from "@/lib/server/google-onboarding-match-link-reviews"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// Not 60: its Google calls (up to 100 location pages, then a location read) do
// not stop at ctx.deadline yet, so this keeps the platform default it ran
// under.
export const maxDuration = 300
export const POST = route({
  maxDuration,
  roles: ["owner", "admin"], params: z.object({ accountId: z.uuid(), draftId: z.uuid() }), body: onboardingMatchLinkInputSchema,
  handler: ({ session, params, body, requestId }) => previewOnboardingMatchLink(session, params.accountId, params.draftId, body, requestId),
})
