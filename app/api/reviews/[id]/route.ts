import { NextResponse } from "next/server"

import { reviewCapabilities } from "@/lib/server/capabilities"
import { withTenant } from "@/lib/server/db"
import { ApiError, apiError } from "@/lib/server/http"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const review = await withTenant(session.organisationId, async (sql) => {
      const [row] = await sql`
        select
          r.id::text as id,
          r.reviewer_display_name as "reviewerDisplayName",
          r.reviewer_is_anonymous as "reviewerIsAnonymous",
          r.reviewer_profile_photo_url as "reviewerProfilePhotoUrl",
          r.star_rating as rating,
          r.review_text as text,
          r.detected_language_code as "detectedLanguageCode",
          r.language_confidence::float as "languageConfidence",
          r.create_time as "createTime",
          r.update_time as "updateTime",
          r.has_media as "hasMedia",
          r.workflow_status as "workflowStatus",
          l.id::text as "locationId",
          l.name as "locationName",
          l.timezone,
          e.verified,
          coalesce(
            (
              select json_agg(
                json_build_object(
                  'id', m.id::text,
                  'thumbnailUrl', m.thumbnail_url,
                  'thumbnailLabel', m.thumbnail_label,
                  'videoUrl', m.video_url
                )
              )
              from review_media_item m where m.review_id = r.id
            ),
            '[]'::json
          ) as media,
          coalesce(
            (
              select json_agg(draft_data order by draft_data."createdAt" desc)
              from (
                select
                  d.id::text as id,
                  d.source,
                  d.body,
                  d.body_bytes as "bodyBytes",
                  d.evidence_hash as "evidenceHash",
                  d.model_name as "modelName",
                  d.verification_status as "verificationStatus",
                  d.created_at as "createdAt"
                from draft d
                where d.review_id = r.id
                order by d.created_at desc
                limit 20
              ) draft_data
            ),
            '[]'::json
          ) as drafts,
          (
            select json_build_object(
              'id', rr.id::text,
              'body', rr.current_body,
              'publishStatus', rr.publish_status,
              'googleReplyState', rr.google_reply_state,
              'googlePolicyViolation', rr.google_policy_violation,
              'googleReplyUpdatedAt', rr.google_reply_updated_at
            )
            from review_reply rr where rr.review_id = r.id
          ) as reply
          ,
          (
            select json_build_object('verdict', vr.verdict, 'reasons', vr.reasons)
            from verification_result vr
            where vr.draft_id = (
              select d2.id
              from draft d2
              where d2.review_id = r.id
              order by d2.created_at desc
              limit 1
            )
            order by vr.created_at desc
            limit 1
          ) as "latestVerification"
        from review r
        join location l on l.id = r.location_id
        join external_location e on e.id = r.external_location_id
        where r.id = ${id}
          and r.provider_deleted_at is null
          ${
            session.role === "owner" || session.role === "admin"
              ? sql``
              : sql`and (
                  not exists (
                    select 1 from location_member lm
                    where lm.user_id = ${session.userId}
                  )
                  or exists (
                    select 1 from location_member lm
                    where lm.user_id = ${session.userId}
                      and lm.location_id = r.location_id
                  )
                )`
          }
        limit 1
      `
      if (!row) {
        throw new ApiError(404, "review_not_found", "Review not found.")
      }
      const timeline = await sql`
        select
          a.action,
          a.created_at as "createdAt",
          u.display_name as "actorName",
          case
            when a.metadata = '{}'::jsonb then null
            else 'Additional audit details recorded'
          end as "metadataSummary"
        from audit_log a
        left join app_user u on u.id = a.actor_user_id
        where a.subject_type = 'review' and a.subject_id = ${id}
        order by a.created_at desc
        limit 100
      `
      const capabilities = await reviewCapabilities(
        sql,
        session,
        row.locationId as string
      )
      return {
        ...row,
        timeline,
        capabilities,
      }
    })
    return NextResponse.json({ review })
  } catch (error) {
    return apiError(error)
  }
}
