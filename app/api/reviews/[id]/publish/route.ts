import { NextResponse } from "next/server"
import { z } from "zod"

import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { executePublish } from "@/lib/server/publishing"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

const inputSchema = z.object({
  draftId: z.uuid(),
  expectedReviewUpdateTime: z.string().min(1),
})

export const POST = route({
  params: z.object({ id: z.uuid() }),
  body: inputSchema,
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
      serverRequestId: requestId,
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
