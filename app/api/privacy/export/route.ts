import { NextResponse } from "next/server"

import { privacyExportBodySchema } from "@/lib/contracts/privacy"
import { writeAudit } from "@/lib/server/audit"
import { decryptSecret, sha256 } from "@/lib/server/crypto"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * How many matched reviews one export returns. The cap is not the problem --
 * reporting a capped export as though it were the whole set is, so the body
 * and the audit row carry `totalMatched` and `truncated` beside it. An Art.
 * 15 response handed over with the oldest matches silently missing is a wrong
 * answer given with no signal that it is wrong.
 */
const EXPORT_LIMIT = 1000

export const POST = route({
  roles: ["owner"],
  body: privacyExportBodySchema,
  handler: async ({
    session,
    body: query,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    const exported = await tenant(async (sql) => {
      const encryptedReviews = await sql`
        select
          count(*) over () as "totalMatched",
          r.id::text as id,
          r.google_review_id_ciphertext as "googleReviewIdCiphertext",
          r.reviewer_display_name as "reviewerDisplayName",
          r.reviewer_is_anonymous as "reviewerIsAnonymous",
          r.reviewer_profile_photo_url as "reviewerProfilePhotoUrl",
          r.star_rating as rating,
          r.review_text as text,
          r.create_time as "createTime",
          r.update_time as "updateTime",
          r.raw_content_expires_at as "rawContentExpiresAt",
          r.restricted_at as "restrictedAt",
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
        limit ${EXPORT_LIMIT}
      `
      // The window count is evaluated over the whole match set before LIMIT,
      // so it is the true total and needs no second round trip.
      const totalMatched = Number(
        (encryptedReviews[0] as { totalMatched?: string | number } | undefined)
          ?.totalMatched ?? 0
      )
      const reviews = encryptedReviews.map((row) => {
        const record = row as Record<string, unknown> & {
          googleReviewIdCiphertext: Buffer
        }
        const { googleReviewIdCiphertext, ...review } = record
        // The window count is a property of the query, not of a review.
        delete review.totalMatched
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
        requestId,
        metadata: {
          records: reviews.length,
          totalMatched,
          truncated: totalMatched > reviews.length,
          clientRequestId,
        },
      })
      return {
        generatedAt: new Date().toISOString(),
        organisationId: session.organisationId,
        subjectReference: query.subject,
        note: "Null text or media indicates content already removed by the retention policy.",
        totalMatched,
        returned: reviews.length,
        truncated: totalMatched > reviews.length,
        reviews,
      }
    })
    return NextResponse.json(exported, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": 'attachment; filename="privacy-export.json"',
      },
    })
  },
})
