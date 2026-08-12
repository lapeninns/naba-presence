import { NextResponse } from "next/server"

import { apiError, serverRequestId } from "@/lib/server/http"
import {
  createLocalPostDraft,
  listLocalPosts,
  localPostInputSchema,
} from "@/lib/server/posts"
import { requireSession } from "@/lib/server/session"

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
