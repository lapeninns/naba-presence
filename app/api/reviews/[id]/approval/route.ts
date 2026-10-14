import { NextResponse } from "next/server"

import { approvalInputSchema, reviewIdParamsSchema } from "@/lib/contracts/reviews"
import { requireScopesEnabled } from "@/lib/server/pause-controls"
import { REPLY_PUBLISHING_PAUSED } from "@/lib/server/publishing"
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
  maxDuration,
  mfa: "step_up",
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
    // The reply pipeline's own gate (env and operator pause table), before
    // the decision is recorded: a paused publish leaves no approval behind.
    await requireScopesEnabled("publish", REPLY_PUBLISHING_PAUSED)
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
