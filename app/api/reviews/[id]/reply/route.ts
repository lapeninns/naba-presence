import { NextResponse } from "next/server"

import { writeAudit } from "@/lib/server/audit"
import { decryptSecret } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { connectionAccessToken, deleteGoogleReply } from "@/lib/server/google"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import {
  canPublishLocation,
  requireLocationAccess,
} from "@/lib/server/permissions"
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
    await withTenant(session.organisationId, async (sql) => {
      const [record] = await sql<
        {
          google_review_name_ciphertext: Buffer
          connection_id: string
          location_id: string
        }[]
      >`
        select
          r.google_review_name_ciphertext,
          r.location_id::text as location_id,
          e.google_connection_id::text as connection_id
        from review r
        join external_location e on e.id = r.external_location_id
        join review_reply rr on rr.review_id = r.id
        where r.id = ${id}
          and rr.publish_status not in ('deleted', 'not_published')
        limit 1
      `
      if (!record) {
        throw new ApiError(404, "reply_not_found", "Published reply not found.")
      }
      await requireLocationAccess(sql, session, record.location_id)
      if (!(await canPublishLocation(sql, session, record.location_id))) {
        throw new ApiError(
          403,
          "publish_permission_required",
          "You do not have publish permission for this location."
        )
      }
      const accessToken = await connectionAccessToken(sql, record.connection_id)
      await deleteGoogleReply(
        accessToken,
        decryptSecret(record.google_review_name_ciphertext)
      )
      await sql`
        update review_reply
        set
          current_body = null,
          google_reply_state = null,
          google_policy_violation = null,
          publish_status = 'deleted',
          google_reply_updated_at = now()
        where review_id = ${id}
      `
      await sql`update review set workflow_status = 'new' where id = ${id}`
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "review.reply.deleted",
        subjectType: "review",
        subjectId: id,
        requestId: requestId(request),
      })
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return apiError(error)
  }
}
