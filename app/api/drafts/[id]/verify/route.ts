import { reviewIdParamsSchema, type VerifyResult } from "@/lib/contracts/reviews"
import { writeAudit } from "@/lib/server/audit"
import { verifyStoredDraft } from "@/lib/server/drafts"
import { ApiError } from "@/lib/server/http"
import { requireLocationAccess } from "@/lib/server/permissions"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

export const POST = route({
  roles: ["owner", "admin", "member"],
  params: reviewIdParamsSchema,
  handler: async ({ session, params, requestId, clientRequestId, tenant }) => {
    const { id } = params
    const result = await tenant(async (sql) => {
      const [draft] = await sql<
        {
          id: string
          body: string
          review_id: string
          review_text: string | null
          reviewer_name: string | null
          location_name: string
          rating: number | null
          detected_language_code: string | null
          location_id: string
        }[]
      >`
        select
          d.id::text as id,
          d.body,
          d.review_id::text as review_id,
          r.review_text,
          r.reviewer_display_name as reviewer_name,
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
        requestId,
        metadata: {
          draftId: id,
          verdict: verification.verdict,
          clientRequestId,
        },
      })
      return verification
    })
    return { verification: result } satisfies VerifyResult
  },
})
