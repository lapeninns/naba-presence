import { z } from "zod"
import { verificationCompletionExecuteSchema } from "@/lib/contracts/google-verification-attempt"
import { executeVerificationCompletion, readVerificationAttempt, refreshVerificationAttempt } from "@/lib/server/google-verification-execution"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid(), reviewId: z.uuid() })
export const GET = route({ roles: ["owner", "admin"], params,
  handler: async ({ session, params }) => ({ attempt: await readVerificationAttempt(session, params.id, params.reviewId, { resourceType: "verification_complete" }) }),
})
export const POST = route({ roles: ["owner", "admin"], params, body: verificationCompletionExecuteSchema,
  handler: async ({ session, params, body, requestId }) => ({ attempt: await executeVerificationCompletion(session, params.id, params.reviewId, body.expectedPayloadHash, body.pin, requestId) }),
})
export const PATCH = route({ roles: ["owner", "admin"], params, body: z.strictObject({}),
  handler: async ({ session, params, requestId }) => ({ attempt: await refreshVerificationAttempt(session, params.id, params.reviewId, requestId, "verification_complete") }),
})
