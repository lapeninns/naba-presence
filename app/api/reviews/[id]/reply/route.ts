import { NextResponse } from "next/server"

import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import { executeReplyDelete } from "@/lib/server/publishing"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

export async function DELETE(
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
    const outcome = await executeReplyDelete({
      organisationId: session.organisationId,
      session,
      reviewId: id,
      serverRequestId: requestId(request),
    })
    if (outcome.status === "ambiguous") {
      throw new ApiError(
        502,
        "google_mutation_ambiguous",
        "Google may have deleted the reply. Its state must be checked before retrying."
      )
    }
    return NextResponse.json({
      status: outcome.status,
      publishAttemptId: outcome.attemptId,
    })
  } catch (error) {
    return apiError(error)
  }
}
