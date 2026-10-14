import "server-only"

import type { TransactionSql } from "postgres"

import {
  DEFAULT_REVIEW_SORT,
  encodeReviewsCursor,
  type ReviewCapabilities,
  type ReviewsCursor,
  type ReviewsQuery,
} from "@/lib/contracts/reviews"
import {
  reviewCapabilities,
  reviewCapabilitiesForLocations,
} from "@/lib/server/capabilities"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { visibilityPredicate } from "@/lib/server/permissions"
import {
  boundedSearchMatches,
  buildInboxQuery,
} from "@/lib/server/reviews-query"
import type { Session } from "@/lib/server/session"

/**
 * The inbox's two reads: THE ONLY implementations.
 *
 * `GET /api/reviews` and `GET /api/reviews/{id}` call these inside their
 * tenant transaction, and the /inbox page's server prefetch
 * (lib/server/prefetch.ts) calls them too, so the rows and the review that
 * paint in the first HTML are produced exactly as a later client fetch
 * produces them. Both return the route's raw body (Dates and all); the
 * prefetch pushes it through the same JSON round trip and contract schema
 * the browser applies.
 */

const NO_CAPABILITIES = {
  canPublish: false,
  canEdit: false,
  canRequestApproval: false,
} satisfies ReviewCapabilities

/** One page of the inbox list for a decoded `ReviewsQuery`. */
export async function readReviewsPage(
  sql: TransactionSql,
  session: Session,
  query: ReviewsQuery
) {
  // The two-person setting decides whether the requester of an approval
  // may also grant it, which is what separates "awaiting my approval"
  // from "awaiting others". Read once per request, not per row.
  const [settings] = await sql<{ requireTwoPersonApproval: boolean }[]>`
    select require_two_person_approval as "requireTwoPersonApproval"
    from organisation
    where id = ${session.organisationId}
  `
  const queried = await buildInboxQuery(sql, {
    ...query,
    role: session.role,
    userId: session.userId,
    canPublish: session.canPublish,
    requireTwoPersonApproval: settings?.requireTwoPersonApproval ?? false,
    searchReviewIds: query.search
      ? await boundedSearchMatches(sql, query.search)
      : undefined,
  })
  const capabilities = await reviewCapabilitiesForLocations(
    sql,
    session,
    queried.map((row) => row.location.id)
  )
  const rows = queried.map((row) => ({
    ...row,
    capabilities: capabilities.get(row.location.id) ?? NO_CAPABILITIES,
  }))
  const hasMore = rows.length > query.pageSize
  const items = hasMore ? rows.slice(0, query.pageSize) : rows
  const last = items.at(-1)
  const nextCursor =
    hasMore && last
      ? encodeReviewsCursor({
          updateTime:
            last.updateTime instanceof Date
              ? last.updateTime.toISOString()
              : last.updateTime,
          id: last.id,
          rating: last.rating,
        } satisfies ReviewsCursor)
      : null
  return { items, nextCursor }
}

/**
 * One review with its drafts, reply, media, latest verification, last
 * rejection, timeline and capabilities. A review the session cannot see, or
 * one Google deleted, is a 404 `review_not_found`.
 */
export async function readReviewDetail(
  sql: TransactionSql,
  session: Session,
  id: string
) {
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
      -- Only an https link leaves as a link: the payload is Google's,
      -- but the inbox renders this as an anchor.
      case
        when r.raw_payload->>'reviewReplyUrl' ~ '^https://'
        then r.raw_payload->>'reviewReplyUrl'
      end as "googleReplyUrl",
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
          'googleReplyUpdatedAt', rr.google_reply_updated_at,
          -- The newest attempt's provider code, so a failed publish can
          -- be worded by its cause (content refused, connection lost,
          -- Google unavailable) instead of one sentence for all three.
          'lastErrorCode', (
            select pa.provider_error_code
            from publish_attempt pa
            where pa.review_reply_id = rr.id
            order by pa.started_at desc
            limit 1
          )
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
      ) as "latestVerification",
      -- The approver's reason for returning the reply, while it is still
      -- the latest decision and the reply has not been resubmitted
      -- (drafted, or re-checked after an edit). Without this the note the
      -- reject dialog asks for was stored and never shown.
      (
        select json_build_object(
          'note', ad.note,
          'decidedByName', du.display_name,
          'decidedAt', ad.created_at
        )
        from approval_decision ad
        left join app_user du on du.id = ad.decided_by
        where ad.review_id = r.id
          and r.workflow_status in ('drafted', 'verified')
          and ad.decision = 'rejected'
          and ad.created_at = (
            select max(ad2.created_at)
            from approval_decision ad2
            where ad2.review_id = r.id
          )
        limit 1
      ) as "lastRejection"
    from review r
    join location l on l.id = r.location_id
    join external_location e on e.id = r.external_location_id
    where r.id = ${id}
      and r.provider_deleted_at is null
      and ${visibilityPredicate(sql, session, sql`r.location_id`)}
    limit 1
  `
  if (!row) {
    throw new ApiError(404, "review_not_found", "Review not found.")
  }
  const timeline = await reviewTimelineQuery(sql, id)
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
}

/**
 * A review's newest 100 audit rows. The tenant comes from RLS, so the query
 * seeks `audit_log_subject_idx` on (organisation, subject) and reads it in
 * `created_at desc` order (W4-04).
 */
export function reviewTimelineQuery(sql: TransactionSql, reviewId: string) {
  return sql`
    select
      a.action,
      a.created_at as "createdAt",
      u.display_name as "actorName",
      case
        when a.metadata = '{}'::jsonb then null
        -- A rejection's note is the one detail the author needs.
        when a.action = 'review.approval.rejected'
          and nullif(a.metadata->>'note', '') is not null
          then 'Note: ' || (a.metadata->>'note')
        else 'Additional audit details recorded'
      end as "metadataSummary"
    from audit_log a
    left join app_user u on u.id = a.actor_user_id
    where a.subject_type = 'review' and a.subject_id = ${reviewId}
    order by a.created_at desc
    limit 100
  `
}

/**
 * One review as a list row: the same projection and capabilities as
 * `readReviewsPage`, for a write to hand back the row it changed. Null when
 * the session cannot see it (or Google deleted it).
 */
export async function readReviewRow(
  sql: TransactionSql,
  session: Session,
  id: string
) {
  const [row] = await buildInboxQuery(sql, {
    reviewId: id,
    sort: DEFAULT_REVIEW_SORT,
    pageSize: 1,
    role: session.role,
    userId: session.userId,
    canPublish: session.canPublish,
    // Decides queue membership only; no queue filter is applied here.
    requireTwoPersonApproval: false,
  })
  if (!row) return null
  const capabilities = await reviewCapabilitiesForLocations(sql, session, [
    row.location.id,
  ])
  return {
    ...row,
    capabilities: capabilities.get(row.location.id) ?? NO_CAPABILITIES,
  }
}

/**
 * The review after a write, read in a fresh transaction once the write has
 * committed: `row` in the list's shape and `detail` in the detail route's, so
 * the client patches both caches from the response instead of refetching
 * every loaded list page (lib/queries/invalidate.ts).
 *
 * Best effort. The write has already happened, so a failed read must not turn
 * it into an error: the fields are left out and the client falls back to
 * refetching the detail.
 */
export async function readReviewWriteSnapshot(
  tenant: <T>(fn: (sql: TransactionSql) => Promise<T>) => Promise<T>,
  session: Session,
  id: string,
  requestId?: string
) {
  try {
    return await tenant(async (sql) => {
      const review = await readReviewDetail(sql, session, id)
      const row = await readReviewRow(sql, session, id)
      return { ...(row ? { row } : {}), detail: { review } }
    })
  } catch (error) {
    log.warn("review.write_snapshot_failed", { requestId, reviewId: id, error })
    return {}
  }
}
