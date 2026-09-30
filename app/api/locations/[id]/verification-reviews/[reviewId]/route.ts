import { z } from "zod"
import { verificationReviewApprovalSchema } from "@/lib/contracts/google-verification-review"
import { approveVerificationReview, readVerificationReview } from "@/lib/server/google-verification-reviews"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid(), reviewId: z.uuid() })
export const GET = route({ roles: ["owner", "admin"], params,
  handler: async ({ session, params }) => ({ review: await readVerificationReview(session, params.id, params.reviewId) }),
})
export const POST = route({ roles: ["owner", "admin"], params, body: verificationReviewApprovalSchema,
  handler: async ({ session, params, body, requestId }) => ({ review: await approveVerificationReview(session, params.id, params.reviewId, body.expectedPayloadHash, requestId) }),
})
