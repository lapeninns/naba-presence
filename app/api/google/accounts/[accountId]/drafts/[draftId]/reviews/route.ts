import { z } from "zod"
import { googleOnboardingReviewInputSchema } from "@/lib/contracts/google-onboarding"
import { previewOnboardingCreation } from "@/lib/server/google-onboarding-reviews"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
export const POST = route({
  roles: ["owner", "admin"], params: z.object({ accountId: z.uuid(), draftId: z.uuid() }),
  body: googleOnboardingReviewInputSchema,
  handler: ({ session, params, body, requestId }) => previewOnboardingCreation(session, params.accountId, params.draftId, body, requestId),
})
