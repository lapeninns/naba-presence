import { NextResponse } from "next/server"

import {
  publishInputSchema,
  reviewIdParamsSchema,
} from "@/lib/contracts/reviews"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { executePublish } from "@/lib/server/publishing"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

// Response shape: `PublishResult` (lib/contracts/reviews.ts). Not `satisfies`-
// checked here because `PublishOutcome.reviewReplyId` is declared optional in
// lib/server/publishing/types.ts although every non-failed outcome sets it.
export const POST = route({
  params: reviewIdParamsSchema,
  body: publishInputSchema,
  handler: async ({ session, params, body: input, requestId }) => {
    if (!getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(
        503,
        "publishing_paused",
        "Publishing is temporarily paused."
      )
    }
    const outcome = await executePublish({
      organisationId: session.organisationId,
      session,
      reviewId: params.id,
      draftId: input.draftId,
      expectedReviewUpdateTime: input.expectedReviewUpdateTime,
      requestId,
    })

    if (outcome.status === "awaiting_approval") {
      return NextResponse.json(
        {
          reviewReplyId: outcome.reviewReplyId,
          publishAttemptId: outcome.attemptId,
          status: outcome.status,
          googleReplyState: outcome.googleReplyState,
        },
        { status: 202 }
      )
    }
    if (outcome.status === "ambiguous") {
      throw new ApiError(
        502,
        "google_mutation_ambiguous",
        "Google may have applied the reply. Its state must be checked before retrying."
      )
    }
    if (outcome.status === "failed") {
      const providerError = outcome.providerError
      throw new ApiError(
        providerError?.status === 429 ? 429 : 409,
        providerError?.code ?? "google_publish_failed",
        providerError?.message ?? "Google rejected the reply."
      )
    }

    return {
      reviewReplyId: outcome.reviewReplyId,
      publishAttemptId: outcome.attemptId,
      status: outcome.status,
      googleReplyState: outcome.googleReplyState,
      idempotent: outcome.idempotent,
    }
  },
})
