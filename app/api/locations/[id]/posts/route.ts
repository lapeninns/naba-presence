import { NextResponse } from "next/server"

import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import {
  createLocalPostDraft,
  listLocalPosts,
  localPostInputSchema,
} from "@/lib/server/posts"
import { requireSession } from "@/lib/server/session"

function requirePostsEnabled() {
  if (!getServerEnv().GBP_POSTS_ENABLED) {
    throw new ApiError(503, "posts_paused", "Google Posts are paused.")
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    return NextResponse.json(
      await listLocalPosts(session.organisationId, session, id)
    )
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    requirePostsEnabled()
    const rid = serverRequestId(request)
    const session = await requireSession()
    const { id } = await context.params
    const input = localPostInputSchema.parse(await request.json())
    const post = await createLocalPostDraft(
      session.organisationId,
      session,
      id,
      input,
      rid.id
    )
    return NextResponse.json({ post }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
