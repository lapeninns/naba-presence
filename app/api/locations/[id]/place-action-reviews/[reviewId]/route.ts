import { z } from "zod"
import { placeActionApprovalSchema } from "@/lib/contracts/place-action-review"
import { approvePlaceActionReview, readPlaceActionReview } from "@/lib/server/place-action-reviews"
import { route } from "@/lib/server/route"
export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid(), reviewId: z.uuid() })
export const GET = route({ roles: ["owner", "admin"], params,
  handler: async ({ session, params }) => ({ review: await readPlaceActionReview(session, params.id, params.reviewId) }),
})
export const POST = route({ roles: ["owner", "admin"], params, body: placeActionApprovalSchema,
  handler: async ({ session, params, body, requestId }) => ({ review: await approvePlaceActionReview(session, params.id, params.reviewId, body.expectedPayloadHash, requestId) }),
})
