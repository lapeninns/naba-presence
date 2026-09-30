import { z } from "zod"
import { lifecycleApprovalSchema } from "@/lib/contracts/google-lifecycle-review"
import { approveLifecycle, readLifecycleReview } from "@/lib/server/google-lifecycle-reviews"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid(), reviewId: z.uuid() })
export const GET = route({ roles: ["owner", "admin"], params,
  handler: async ({ session, params }) => ({ review: await readLifecycleReview(session, params.id, params.reviewId) }),
})
export const POST = route({ roles: ["owner", "admin"], params, body: lifecycleApprovalSchema,
  handler: async ({ session, params, body, requestId }) => ({ review: await approveLifecycle(session, params.id, params.reviewId, body.expectedPayloadHash, requestId) }),
})
