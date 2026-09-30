import { z } from "zod"
import { verificationExecuteSchema } from "@/lib/contracts/google-verification-attempt"
import { executeVerificationStart, readVerificationAttempt, refreshVerificationAttempt } from "@/lib/server/google-verification-execution"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid(), reviewId: z.uuid() })
export const GET = route({ roles: ["owner", "admin"], params,
  handler: async ({ session, params }) => ({ attempt: await readVerificationAttempt(session, params.id, params.reviewId) }),
})
export const POST = route({ roles: ["owner", "admin"], params, body: verificationExecuteSchema,
  handler: async ({ session, params, body, requestId }) => ({ attempt: await executeVerificationStart(session, params.id, params.reviewId, body.expectedPayloadHash, requestId) }),
})
export const PATCH = route({ roles: ["owner", "admin"], params, body: z.strictObject({}),
  handler: async ({ session, params, requestId }) => ({ attempt: await refreshVerificationAttempt(session, params.id, params.reviewId, requestId) }),
})
