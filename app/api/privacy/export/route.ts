import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { decryptSecret, sha256 } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const querySchema = z.object({
  subject: z.string().trim().min(3).max(240),
})

export async function GET(request: Request) {
  try {
    const session = requireRole(await requireSession(), ["owner"])
    const query = querySchema.parse({
      subject: new URL(request.url).searchParams.get("subject"),
    })
    const exported = await withTenant(session.organisationId, async (sql) => {
      const encryptedReviews = await sql`
        select
          r.id::text as id,
          r.google_review_id_ciphertext as "googleReviewIdCiphertext",
          r.reviewer_display_name as "reviewerDisplayName",
          r.reviewer_is_anonymous as "reviewerIsAnonymous",
          r.star_rating as rating,
          r.review_text as text,
          r.create_time as "createTime",
          r.update_time as "updateTime",
          r.raw_content_expires_at as "rawContentExpiresAt",
          l.name as location,
          coalesce(
            (
              select json_agg(
                json_build_object(
                  'thumbnailUrl', m.thumbnail_url,
                  'thumbnailLabel', m.thumbnail_label,
                  'videoUrl', m.video_url
                )
              )
              from review_media_item m where m.review_id = r.id
            ),
            '[]'::json
          ) as media,
          (
            select json_build_object(
              'body', rr.current_body,
              'publishStatus', rr.publish_status,
              'googleReplyState', rr.google_reply_state,
              'updatedAt', rr.google_reply_updated_at
            )
            from review_reply rr where rr.review_id = r.id
          ) as reply
        from review r
        join location l on l.id = r.location_id
        where r.google_review_id_hash = ${sha256(query.subject)}
          or r.google_review_name_hash = ${sha256(query.subject)}
          or lower(coalesce(r.reviewer_display_name, ''))
            = lower(${query.subject})
        order by r.update_time desc
        limit 1000
      `
      const reviews = encryptedReviews.map((row) => {
        const record = row as Record<string, unknown> & {
          googleReviewIdCiphertext: Buffer
        }
        const { googleReviewIdCiphertext, ...review } = record
        return {
          ...review,
          googleReviewId: decryptSecret(googleReviewIdCiphertext),
        }
      })
      if (!reviews.length) {
        throw new ApiError(
          404,
          "privacy_subject_not_found",
          "No retained records matched that subject reference."
        )
      }
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "privacy.data.exported",
        subjectType: "privacy_subject",
        subjectId: query.subject,
        requestId: requestId(request),
        metadata: { records: reviews.length },
      })
      return {
        generatedAt: new Date().toISOString(),
        organisationId: session.organisationId,
        subjectReference: query.subject,
        note: "Null text or media indicates content already removed by the retention policy.",
        reviews,
      }
    })
    return NextResponse.json(exported, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": 'attachment; filename="privacy-export.json"',
      },
    })
  } catch (error) {
    return apiError(error)
  }
}
