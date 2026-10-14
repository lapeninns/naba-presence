import { z } from "zod"
import { onboardingMatchLinkApproveSchema } from "@/lib/contracts/google-onboarding-match-link"
import { approveOnboardingMatchLink, getOnboardingMatchLinkReview } from "@/lib/server/google-onboarding-match-link-reviews"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// Not 60: its Google calls (up to 100 location pages, then a location read) do
// not stop at ctx.deadline yet, so this keeps the platform default it ran
// under.
export const maxDuration = 300
const params = z.object({ accountId: z.uuid(), draftId: z.uuid(), reviewId: z.uuid() })
export const GET = route({
  maxDuration,
  roles: ["owner", "admin"], params,
  handler: ({ session, params }) => getOnboardingMatchLinkReview(session, params.accountId, params.draftId, params.reviewId),
})
export const POST = route({
  maxDuration,
  mfa: "step_up",
  roles: ["owner", "admin"], params, body: onboardingMatchLinkApproveSchema,
  handler: ({ session, params, body, requestId }) => approveOnboardingMatchLink(session, params.accountId, params.draftId, params.reviewId, body.expectedReviewHash, requestId),
})
