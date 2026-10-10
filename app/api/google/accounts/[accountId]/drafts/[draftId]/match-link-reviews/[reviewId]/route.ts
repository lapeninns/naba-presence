import { z } from "zod"
import { onboardingMatchLinkApproveSchema } from "@/lib/contracts/google-onboarding-match-link"
import { approveOnboardingMatchLink, getOnboardingMatchLinkReview } from "@/lib/server/google-onboarding-match-link-reviews"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
const params = z.object({ accountId: z.uuid(), draftId: z.uuid(), reviewId: z.uuid() })
export const GET = route({
  roles: ["owner", "admin"], params,
  handler: ({ session, params }) => getOnboardingMatchLinkReview(session, params.accountId, params.draftId, params.reviewId),
})
export const POST = route({
  roles: ["owner", "admin"], params, body: onboardingMatchLinkApproveSchema,
  handler: ({ session, params, body, requestId }) => approveOnboardingMatchLink(session, params.accountId, params.draftId, params.reviewId, body.expectedReviewHash, requestId),
})
