import { NextResponse } from "next/server"

import { draftInputSchema, reviewIdParamsSchema } from "@/lib/contracts/reviews"
import { createReviewDraft } from "@/lib/server/review-drafts"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Drafts, checks and charges a reply (lib/server/review-drafts.ts). A retry
 * under the same Idempotency-Key replays the stored draft with 200 instead
 * of generating (and charging) again.
 */
export const POST = route({
  maxDuration,
  entitlement: "ai",
  roles: ["owner", "admin", "member"],
  params: reviewIdParamsSchema,
  body: draftInputSchema,
  // Counted before the kill switch and credit reservation, so a burst is
  // refused without touching the AI allowance.
  limits: ({ session }) => ({
    scope: "ai_draft",
    user: session.userId,
    organisation: session.organisationId,
  }),
  handler: async ({
    session,
    params,
    body: input,
    requestId,
    clientRequestId,
    tenant,
    deadline,
  }) => {
    const { replayed, ...result } = await createReviewDraft({
      session,
      reviewId: params.id,
      input,
      requestId,
      clientRequestId,
      tenant,
      deadline,
    })
    return replayed
      ? NextResponse.json(result)
      : NextResponse.json(result, { status: 201 })
  },
})
