import "server-only"

import type { TransactionSql } from "postgres"

import { sha256 } from "@/lib/server/crypto"
import type { Session } from "@/lib/server/session"

export type InboxFilters = {
  locationId?: string
  ratings?: number[]
  statuses?: string[]
  replyStates?: string[]
  verificationStatuses?: string[]
  publishStatuses?: string[]
  syncStatuses?: string[]
  dateFrom?: string
  dateTo?: string
  search?: string
  sort: "updated_desc" | "rating_desc" | "rating_asc"
  pageSize: number
  cursor?: {
    updateTime: string
    id: string
    rating?: number
  }
  role: Session["role"]
  userId: string
}

export function buildInboxQuery(
  sql: TransactionSql,
  filters: InboxFilters
) {
  return sql`
    select
      r.id::text as id,
      json_build_object(
        'id', l.id::text,
        'name', l.name
      ) as location,
      json_build_object(
        'displayName', r.reviewer_display_name,
        'isAnonymous', r.reviewer_is_anonymous
      ) as reviewer,
      r.star_rating as rating,
      r.review_text as text,
      r.detected_language_code as "detectedLanguageCode",
      r.language_confidence::float as "languageConfidence",
      r.create_time as "createTime",
      r.update_time as "updateTime",
      r.has_media as "hasMedia",
      r.workflow_status as "workflowStatus",
      d.id::text as "draftId",
      d.body as "draftBody",
      d.verification_status as "verificationStatus",
      rr.publish_status as "replyStatus",
      rr.google_reply_state as "googleReplyState",
      rr.google_policy_violation as "googlePolicyViolation",
      rr.current_body as "replyBody",
      sc.status as "syncStatus"
    from review r
    join location l on l.id = r.location_id
    left join lateral (
      select id, body, verification_status
      from draft
      where review_id = r.id
      order by created_at desc
      limit 1
    ) d on true
    left join review_reply rr on rr.review_id = r.id
    left join lateral (
      select status
      from sync_checkpoint
      where external_location_id = r.external_location_id
      order by updated_at desc
      limit 1
    ) sc on true
    where r.organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid
      and r.provider_deleted_at is null
      ${
        filters.locationId
          ? sql`and r.location_id = ${filters.locationId}`
          : sql``
      }
      ${
        filters.ratings?.length
          ? sql`and r.star_rating in ${sql(filters.ratings)}`
          : sql``
      }
      ${
        filters.statuses?.length
          ? sql`and r.workflow_status in ${sql(filters.statuses)}`
          : sql``
      }
      ${
        filters.replyStates?.length === 1
          ? filters.replyStates[0] === "replied"
            ? sql`and rr.current_body is not null`
            : sql`and rr.current_body is null`
          : sql``
      }
      ${
        filters.verificationStatuses?.length
          ? sql`and coalesce(d.verification_status, 'pending')
              in ${sql(filters.verificationStatuses)}`
          : sql``
      }
      ${
        filters.publishStatuses?.length
          ? sql`and coalesce(rr.publish_status, 'not_published')
              in ${sql(filters.publishStatuses)}`
          : sql``
      }
      ${
        filters.syncStatuses?.length
          ? sql`and sc.status in ${sql(filters.syncStatuses)}`
          : sql``
      }
      ${
        filters.dateFrom
          ? sql`and r.update_time >= ${filters.dateFrom}`
          : sql``
      }
      ${filters.dateTo ? sql`and r.update_time <= ${filters.dateTo}` : sql``}
      ${
        filters.search
          ? sql`and (
              to_tsvector(
                'simple',
                coalesce(r.review_text, '') || ' ' ||
                coalesce(r.reviewer_display_name, '')
              ) @@ websearch_to_tsquery('simple', ${filters.search})
              or r.google_review_id_hash = ${sha256(filters.search)}
              or r.google_review_name_hash = ${sha256(filters.search)}
            )`
          : sql``
      }
      ${
        filters.cursor && filters.sort === "updated_desc"
          ? sql`and (r.update_time, r.id) < (
              ${filters.cursor.updateTime}, ${filters.cursor.id}
            )`
          : filters.cursor &&
              filters.sort === "rating_desc" &&
              filters.cursor.rating
            ? sql`and (
                r.star_rating < ${filters.cursor.rating}
                or (
                  r.star_rating = ${filters.cursor.rating}
                  and (r.update_time, r.id) < (
                    ${filters.cursor.updateTime}, ${filters.cursor.id}
                  )
                )
              )`
            : filters.cursor &&
                filters.sort === "rating_asc" &&
                filters.cursor.rating
              ? sql`and (
                  r.star_rating > ${filters.cursor.rating}
                  or (
                    r.star_rating = ${filters.cursor.rating}
                    and (r.update_time, r.id) < (
                      ${filters.cursor.updateTime}, ${filters.cursor.id}
                    )
                  )
                )`
              : sql``
      }
      ${
        filters.role === "owner" || filters.role === "admin"
          ? sql``
          : sql`and (
              not exists (
                select 1 from location_member lm
                where lm.user_id = ${filters.userId}
              )
              or exists (
                select 1 from location_member lm
                where lm.user_id = ${filters.userId}
                  and lm.location_id = r.location_id
              )
            )`
      }
    ${
      filters.sort === "rating_desc"
        ? sql`order by r.star_rating desc, r.update_time desc, r.id desc`
        : filters.sort === "rating_asc"
          ? sql`order by r.star_rating asc, r.update_time desc, r.id desc`
          : sql`order by r.update_time desc, r.id desc`
    }
    limit ${filters.pageSize + 1}
  `
}
