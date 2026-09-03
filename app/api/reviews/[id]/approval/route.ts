import { NextResponse } from "next/server"

import { approvalInputSchema, reviewIdParamsSchema } from "@/lib/contracts/reviews"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import {
  completeApproval,
  recordApprovalDecision,
} from "@/lib/server/review-approval"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Approve or reject one reply. The rules live in
 * `lib/server/review-approval.ts` so this route and the bulk endpoint cannot
 * drift — approval is the human boundary in front of a provider write.
 */
export const POST = route({
  params: reviewIdParamsSchema,
  body: approvalInputSchema,
  handler: async ({
    session,
    params,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    if (!getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(503, "publishing_paused", "Publishing is temporarily paused.")
    }
    const decision = await tenant((sql) =>
      recordApprovalDecision(sql, session, params.id, input, {
        requestId,
        clientRequestId,
      })
    )
    const result = await completeApproval(session, params.id, decision, requestId)
    return NextResponse.json(result)
  },
})
