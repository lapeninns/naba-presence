import { NextResponse } from "next/server"
import { z } from "zod"

import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import { executePublish } from "@/lib/server/publishing"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const inputSchema = z.object({
  draftId: z.uuid(),
  expectedReviewUpdateTime: z.string().min(1),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    if (!getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(
        503,
        "publishing_paused",
        "Publishing is temporarily paused."
      )
    }
    const { id } = await context.params
    const input = inputSchema.parse(await request.json())
    const outcome = await executePublish({
      organisationId: session.organisationId,
      session,
      reviewId: id,
      draftId: input.draftId,
      expectedReviewUpdateTime: input.expectedReviewUpdateTime,
      serverRequestId: requestId(request),
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

    return NextResponse.json({
      reviewReplyId: outcome.reviewReplyId,
      publishAttemptId: outcome.attemptId,
      status: outcome.status,
      googleReplyState: outcome.googleReplyState,
      idempotent: outcome.idempotent,
    })
  } catch (error) {
    return apiError(error)
  }
}
