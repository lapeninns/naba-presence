import { z } from "zod"
import { googleOnboardingApproveInputSchema } from "@/lib/contracts/google-onboarding"
import { approveOnboardingCreation, getOnboardingReview } from "@/lib/server/google-onboarding-reviews"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ accountId: z.uuid(), draftId: z.uuid(), reviewId: z.uuid() })
export const GET = route({
  maxDuration,
  roles: ["owner", "admin"], params,
  handler: ({ session, params }) => getOnboardingReview(session, params.accountId, params.draftId, params.reviewId),
})
export const POST = route({
  maxDuration,
  mfa: "step_up",
  roles: ["owner", "admin"], params, body: googleOnboardingApproveInputSchema,
  handler: ({ session, params, body, requestId }) => approveOnboardingCreation(session, params.accountId, params.draftId, params.reviewId, body.expectedReviewHash, requestId),
})
