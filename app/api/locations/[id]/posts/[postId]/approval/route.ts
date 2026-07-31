import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { requestOrPublishLocalPost } from "@/lib/server/posts"
import { requireSession } from "@/lib/server/session"

const inputSchema = z.object({ decision: z.enum(["approve", "reject"]) })

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; postId: string }> }
) {
  try {
    if (!getServerEnv().GBP_POSTS_ENABLED || !getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(503, "publishing_paused", "Google Posts publishing is paused.")
    }
    const rid = serverRequestId(request)
    const session = await requireSession()
    const { id, postId } = await context.params
    const { decision } = inputSchema.parse(await request.json())
    if (decision === "reject") {
      await withTenant(session.organisationId, async (sql) => {
        const [post] = await sql<{ id: string }[]>`
          update gbp_local_post
          set status = 'draft', approval_requested_by = null
          where id = ${postId}
            and location_id = ${id}
            and status = 'awaiting_approval'
          returning id::text as id
        `
        if (!post) throw new ApiError(409, "approval_not_pending", "This post is not awaiting approval.")
        await writeAudit(sql, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          action: "post.approval.rejected",
          subjectType: "local_post",
          subjectId: postId,
          requestId: rid.id,
        })
      })
      return NextResponse.json({ status: "draft" })
    }
    return NextResponse.json(
      await requestOrPublishLocalPost({
        organisationId: session.organisationId,
        session,
        locationId: id,
        postId,
        requestId: rid.id,
        approval: true,
      })
    )
  } catch (error) {
    return apiError(error)
  }
}
