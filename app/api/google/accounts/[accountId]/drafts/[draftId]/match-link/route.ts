import { z } from "zod"
import { onboardingMatchLinkSubmitSchema } from "@/lib/contracts/google-onboarding-match-link"
import { getOnboardingMatchLink, submitOnboardingMatchLink } from "@/lib/server/google-onboarding-match-link"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
const params = z.object({ accountId: z.uuid(), draftId: z.uuid() })
export const GET = route({
  roles: ["owner", "admin"], params,
  handler: ({ session, params, requestId }) => getOnboardingMatchLink(session, params.accountId, params.draftId, requestId),
})
export const POST = route({
  roles: ["owner", "admin"], params, body: onboardingMatchLinkSubmitSchema,
  handler: ({ session, params, body, requestId }) => submitOnboardingMatchLink(session, params.accountId, params.draftId, body.reviewId, body.expectedReviewHash, requestId),
})
