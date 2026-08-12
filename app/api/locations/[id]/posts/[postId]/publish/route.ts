import { NextResponse } from "next/server"

import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { requestOrPublishLocalPost } from "@/lib/server/posts"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; postId: string }> }
) {
  try {
    if (!getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(503, "publishing_paused", "Google Posts publishing is paused.")
    }
    const rid = serverRequestId(request)
    const session = await requireSession()
    const { id, postId } = await context.params
    const outcome = await requestOrPublishLocalPost({
      organisationId: session.organisationId,
      session,
      locationId: id,
      postId,
      requestId: rid.id,
    })
    return NextResponse.json(
      outcome,
      { status: outcome.status === "awaiting_approval" ? 202 : 200 }
    )
  } catch (error) {
    return apiError(error)
  }
}
