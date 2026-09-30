import { z } from "zod"
import { administrationAccessApprovalSchema } from "@/lib/contracts/google-administration-review"
import { approveAdministrationAccessReview, readAdministrationAccessReview } from "@/lib/server/google-administration-reviews"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid(), reviewId: z.uuid() })
export const GET = route({ roles: ["owner", "admin"], params,
  handler: async ({ session, params }) => ({ review: await readAdministrationAccessReview(session, params.id, params.reviewId) }),
})
export const POST = route({ roles: ["owner", "admin"], params, body: administrationAccessApprovalSchema,
  handler: async ({ session, params, body, requestId }) => ({ review: await approveAdministrationAccessReview(session, params.id, params.reviewId, body.expectedPayloadHash, requestId) }),
})
