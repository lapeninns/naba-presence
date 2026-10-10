import { z } from "zod"
import { lifecycleApprovalSchema } from "@/lib/contracts/google-lifecycle-review"
import { readLifecycleAttempt } from "@/lib/server/google-lifecycle-attempts"
import { executeLifecycle, refreshLifecycleAttempt } from "@/lib/server/google-lifecycle-execution"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid(), reviewId: z.uuid() })
export const GET = route({ roles: ["owner", "admin"], params,
  handler: async ({ session, params }) => ({ attempt: await readLifecycleAttempt(session, params.id, params.reviewId) }),
})
export const POST = route({ roles: ["owner", "admin"], params, body: lifecycleApprovalSchema,
  handler: async ({ session, params, body, requestId }) => ({ attempt: await executeLifecycle(session, params.id, params.reviewId, body.expectedPayloadHash, requestId) }),
})
export const PATCH = route({ roles: ["owner", "admin"], params, body: z.strictObject({}),
  handler: async ({ session, params, requestId }) => ({ attempt: await refreshLifecycleAttempt(session, params.id, params.reviewId, requestId) }),
})
