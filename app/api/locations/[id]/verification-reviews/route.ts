import { z } from "zod"
import { verificationReviewInputSchema } from "@/lib/contracts/google-verification-review"
import { previewVerificationStart } from "@/lib/server/google-verification-reviews"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
export const POST = route({
  roles: ["owner", "admin"], params: z.object({ id: z.uuid() }), body: verificationReviewInputSchema,
  handler: async ({ session, params, body, requestId }) => ({ review: await previewVerificationStart(session, params.id, body, requestId) }),
})
