import { NextResponse } from "next/server"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { verifyStoredDraft } from "@/lib/server/drafts"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import { requireLocationAccess } from "@/lib/server/permissions"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = requireRole(await requireSession(), [
      "owner",
      "admin",
      "member",
    ])
    const { id } = await context.params
    const result = await withTenant(session.organisationId, async (sql) => {
      const [draft] = await sql<
        {
          id: string
          body: string
          review_id: string
          review_text: string | null
          location_name: string
          rating: number
          detected_language_code: string | null
          location_id: string
        }[]
      >`
        select
          d.id::text as id,
          d.body,
          d.review_id::text as review_id,
          r.review_text,
          r.detected_language_code,
          r.location_id::text as location_id,
          l.name as location_name,
          r.star_rating as rating
        from draft d
        join review r on r.id = d.review_id
        join location l on l.id = r.location_id
        where d.id = ${id}
        limit 1
      `
      if (!draft) {
        throw new ApiError(404, "draft_not_found", "Draft not found.")
      }
      await requireLocationAccess(sql, session, draft.location_id)
      const verification = await verifyStoredDraft(sql, draft)
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "review.draft.verified",
        subjectType: "review",
        subjectId: draft.review_id,
        requestId: requestId(request),
        metadata: { draftId: id, verdict: verification.verdict },
      })
      return verification
    })
    return NextResponse.json({ verification: result })
  } catch (error) {
    return apiError(error)
  }
}
