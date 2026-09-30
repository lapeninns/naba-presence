import { z } from "zod"
import { googleOnboardingSubmitSchema } from "@/lib/contracts/google-onboarding"
import { refreshOnboardingCreation, submitOnboardingCreation } from "@/lib/server/google-onboarding-creation"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ accountId: z.uuid(), draftId: z.uuid() })
export const POST = route({
  roles: ["owner", "admin"], params, body: googleOnboardingSubmitSchema,
  handler: ({ session, params, body, requestId }) => submitOnboardingCreation(session, params.accountId, params.draftId, body.reviewId, body.expectedReviewHash, requestId),
})
export const GET = route({
  roles: ["owner", "admin"], params,
  handler: ({ session, params }) => refreshOnboardingCreation(session, params.accountId, params.draftId),
})
