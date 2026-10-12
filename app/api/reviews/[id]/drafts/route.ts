import { NextResponse } from "next/server"

import { draftInputSchema, reviewIdParamsSchema } from "@/lib/contracts/reviews"
import { createReviewDraft } from "@/lib/server/review-drafts"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/** Drafts, checks and charges a reply (lib/server/review-drafts.ts). */
export const POST = route({
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
  }) => {
    const result = await createReviewDraft({
      session,
      reviewId: params.id,
      input,
      requestId,
      clientRequestId,
      tenant,
    })
    return NextResponse.json(result, { status: 201 })
  },
})
