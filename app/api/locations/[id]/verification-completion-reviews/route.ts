import { z } from "zod"
import { verificationCompletionInputSchema } from "@/lib/contracts/google-verification-completion-review"
import { previewVerificationCompletion } from "@/lib/server/google-verification-completion-reviews"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
export const POST = route({ roles: ["owner", "admin"], params: z.object({ id: z.uuid() }), body: verificationCompletionInputSchema,
  handler: async ({ session, params, body, requestId }) => ({ review: await previewVerificationCompletion(session, params.id, body, requestId) }),
})
