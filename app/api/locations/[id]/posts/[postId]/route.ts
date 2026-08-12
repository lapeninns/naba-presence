import { NextResponse } from "next/server"

import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import {
  deleteLocalPost,
  localPostInputSchema,
  requestOrPublishLocalPost,
  updateLocalPostDraft,
} from "@/lib/server/posts"
import { requireSession } from "@/lib/server/session"

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; postId: string }> }
) {
  try {
    const rid = serverRequestId(request)
    const session = await requireSession()
    const { id, postId } = await context.params
    const post = await updateLocalPostDraft(
      session.organisationId,
      session,
      id,
      postId,
      localPostInputSchema.parse(await request.json()),
      rid.id
    )
    if (post.status === "published") {
      if (!getServerEnv().PUBLISH_ENABLED) {
        throw new ApiError(503, "publishing_paused", "Publishing is paused.")
      }
      return NextResponse.json(
        await requestOrPublishLocalPost({
          organisationId: session.organisationId,
          session,
          locationId: id,
          postId,
          requestId: rid.id,
        })
      )
    }
    return NextResponse.json({ post })
  } catch (error) {
    return apiError(error)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; postId: string }> }
) {
  try {
    if (!getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(503, "publishing_paused", "Publishing is paused.")
    }
    const rid = serverRequestId(request)
    const session = await requireSession()
    const { id, postId } = await context.params
    return NextResponse.json(
      await deleteLocalPost({
        organisationId: session.organisationId,
        session,
        locationId: id,
        postId,
        requestId: rid.id,
      })
    )
  } catch (error) {
    return apiError(error)
  }
}
