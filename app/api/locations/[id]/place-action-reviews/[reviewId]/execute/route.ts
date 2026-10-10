import { z } from "zod"
import { placeActionApprovalSchema } from "@/lib/contracts/place-action-review"
import { readPlaceActionAttempt } from "@/lib/server/place-action-attempts"
import { executePlaceAction, refreshPlaceActionAttempt } from "@/lib/server/place-action-execution"
import { route } from "@/lib/server/route"
export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid(), reviewId: z.uuid() })
export const GET = route({ roles: ["owner", "admin"], params,
  handler: async ({ session, params }) => ({ attempt: await readPlaceActionAttempt(session, params.id, params.reviewId) }),
})
export const POST = route({ roles: ["owner", "admin"], params, body: placeActionApprovalSchema,
  handler: async ({ session, params, body, requestId }) => ({ attempt: await executePlaceAction(session, params.id, params.reviewId, body.expectedPayloadHash, requestId) }),
})
export const PATCH = route({ roles: ["owner", "admin"], params, body: z.strictObject({}),
  handler: async ({ session, params, requestId }) => ({ attempt: await refreshPlaceActionAttempt(session, params.id, params.reviewId, requestId) }),
})
