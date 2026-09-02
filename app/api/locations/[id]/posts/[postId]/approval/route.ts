import { z } from "zod"

import {
  postApprovalDecisionSchema,
  type PostApprovalOutcome,
} from "@/lib/contracts/location-posts"
import { writeAudit } from "@/lib/server/audit"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { requireLocationAccess } from "@/lib/server/permissions"
import { requestOrPublishLocalPost } from "@/lib/server/posts"
import { route } from "@/lib/server/route"

export const POST = route({
  params: z.object({ id: z.string(), postId: z.string() }),
  body: postApprovalDecisionSchema,
  handler: async ({ session, params, body, requestId, tenant }) => {
    if (!getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(503, "publishing_paused", "Google Posts publishing is paused.")
    }
    const { id, postId } = params
    if (body.decision === "reject") {
      await tenant(async (sql) => {
        await requireLocationAccess(sql, session, id)
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
          requestId,
        })
      })
      return { status: "draft" } satisfies PostApprovalOutcome
    }
    return (await requestOrPublishLocalPost({
      organisationId: session.organisationId,
      session,
      locationId: id,
      postId,
      requestId,
      approval: true,
    })) satisfies PostApprovalOutcome
  },
})
