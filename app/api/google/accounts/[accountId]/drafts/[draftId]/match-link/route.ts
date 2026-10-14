import { z } from "zod"
import { onboardingMatchLinkSubmitSchema } from "@/lib/contracts/google-onboarding-match-link"
import { getOnboardingMatchLink, submitOnboardingMatchLink } from "@/lib/server/google-onboarding-match-link"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// Not 60: its Google calls (up to 100 location pages) do not stop at
// ctx.deadline yet, so this keeps the platform default it ran under.
export const maxDuration = 300
const params = z.object({ accountId: z.uuid(), draftId: z.uuid() })
export const GET = route({
  maxDuration,
  roles: ["owner", "admin"], params,
  handler: ({ session, params, requestId }) => getOnboardingMatchLink(session, params.accountId, params.draftId, requestId),
})
export const POST = route({
  maxDuration,
  mfa: "step_up",
  roles: ["owner", "admin"], params, body: onboardingMatchLinkSubmitSchema,
  handler: ({ session, params, body, requestId }) => submitOnboardingMatchLink(session, params.accountId, params.draftId, body.reviewId, body.expectedReviewHash, requestId),
})
