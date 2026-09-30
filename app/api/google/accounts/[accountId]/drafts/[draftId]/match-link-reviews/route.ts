import { z } from "zod"
import { onboardingMatchLinkInputSchema } from "@/lib/contracts/google-onboarding-match-link"
import { previewOnboardingMatchLink } from "@/lib/server/google-onboarding-match-link-reviews"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const POST = route({
  roles: ["owner", "admin"], params: z.object({ accountId: z.uuid(), draftId: z.uuid() }), body: onboardingMatchLinkInputSchema,
  handler: ({ session, params, body, requestId }) => previewOnboardingMatchLink(session, params.accountId, params.draftId, body, requestId),
})
