import { NextResponse } from "next/server"

import { encodeCursor, decodeCursor } from "@/lib/contracts/cursor"
import {
  privacyExportBodySchema,
  privacyExportCursorSchema,
  type PrivacyExportResponse,
} from "@/lib/contracts/privacy"
import { writeAudit } from "@/lib/server/audit"
import { decryptSecret, sha256 } from "@/lib/server/crypto"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * A subject export is served in keyset pages (`update_time desc, id desc`) so
 * any match size completes: each page returns `nextCursor` until the last
 * one, and an interrupted download resumes from the last cursor it received.
 * Nothing about an export in progress is kept server-side -- the cursor holds
 * the position, a page index and a subject fingerprint, and every page is
 * re-read from the reviews themselves. `totalMatched` is counted over the
 * whole match set on every page, and every page writes its own audit row
 * with its page index, so the audit trail shows exactly what was handed over.
 *
 * The cursor timestamp is carried at the database's microsecond precision:
 * a millisecond cursor would skip or repeat reviews whose update times differ
 * only below the millisecond.
 */
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
    const subjectHash = sha256(query.subject)
    const subjectFingerprint = subjectHash.slice(0, 16)
    const cursor = decodeCursor(query.cursor, privacyExportCursorSchema)
    if (query.cursor && (!cursor || cursor.subject !== subjectFingerprint)) {
      throw new ApiError(
        400,
        "invalid_cursor",
        "The export cursor is invalid or belongs to another subject."
      )
    }
    const page = cursor?.page ?? 1
    const pageSize = query.pageSize

    const exported = await tenant(async (sql) => {
      const matches = sql`(
        r.google_review_id_hash = ${subjectHash}
        or r.google_review_name_hash = ${subjectHash}
        or lower(coalesce(r.reviewer_display_name, ''))
          = lower(${query.subject})
      )`
      const [{ totalMatched }] = await sql<{ totalMatched: number }[]>`
        select count(*)::int as "totalMatched"
        from review r
        where ${matches}
      `
      const encryptedReviews = await sql`
        select
          to_char(
            r.update_time at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) as "cursorUpdateTime",
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
        where ${matches}
          ${
            cursor
              ? // Bound as text, then cast: a parameter typed timestamptz
                // goes through the driver's Date serialiser, which drops
                // the microseconds the cursor exists to carry.
                sql`and (r.update_time, r.id)
                  < (${cursor.updateTime}::text::timestamptz, ${cursor.id}::uuid)`
              : sql``
          }
        order by r.update_time desc, r.id desc
        limit ${pageSize + 1}
      `
      const hasMore = encryptedReviews.length > pageSize
      const pageRows = encryptedReviews.slice(0, pageSize)
      const reviews = pageRows.map((row) => {
        const record = row as Record<string, unknown> & {
          googleReviewIdCiphertext: Buffer
        }
        const { googleReviewIdCiphertext, ...review } = record
        // The keyset position is a property of the page, not of a review.
        delete review.cursorUpdateTime
        return {
          ...review,
          googleReviewId: decryptSecret(googleReviewIdCiphertext),
        }
      })
      // Only a first page with nothing in it means the subject is unknown. A
      // resumed export whose remaining reviews were erased meanwhile simply
      // ends.
      if (!cursor && !reviews.length) {
        throw new ApiError(
          404,
          "privacy_subject_not_found",
          "No retained records matched that subject reference."
        )
      }
      const last = pageRows.at(-1) as
        | { cursorUpdateTime: string; id: string }
        | undefined
      const nextCursor =
        hasMore && last
          ? encodeCursor({
              v: 1,
              subject: subjectFingerprint,
              page: page + 1,
              updateTime: last.cursorUpdateTime,
              id: last.id,
            })
          : null
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "privacy.data.exported",
        subjectType: "privacy_subject",
        subjectId: query.subject,
        requestId,
        metadata: {
          page,
          pageSize,
          records: reviews.length,
          totalMatched,
          complete: !hasMore,
          truncated: hasMore,
          clientRequestId,
        },
      })
      const response: PrivacyExportResponse = {
        generatedAt: new Date().toISOString(),
        organisationId: session.organisationId,
        subjectReference: query.subject,
        note: "Null text or media indicates content already removed by the retention policy.",
        page,
        pageSize,
        totalMatched,
        returned: reviews.length,
        truncated: hasMore,
        nextCursor,
        reviews,
      }
      return response
    })
    return NextResponse.json(exported, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${
          exported.page === 1
            ? "privacy-export.json"
            : `privacy-export-page-${exported.page}.json`
        }"`,
      },
    })
  },
})
