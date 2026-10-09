import "server-only"

import type { Fragment, TransactionSql } from "postgres"

import type {
  ReviewRow,
  ReviewSort,
  ReviewsCursor,
  ReviewsQuery,
} from "@/lib/contracts/reviews"
import { sha256 } from "@/lib/server/crypto"
import { visibilityPredicate } from "@/lib/server/permissions"
import { queuePredicate } from "@/lib/server/review-queues"
import type { Session } from "@/lib/server/session"

/** The decoded wire query (lib/contracts/reviews.ts) plus the caller. */
export type InboxFilters = ReviewsQuery & {
  role: Session["role"]
  userId: string
  canPublish: boolean
  /** Organisation setting; decides whether a requester may approve their own. */
  requireTwoPersonApproval: boolean
}

/**
 * The location filter as one array. `location_id` on the wire may carry a
 * single id (every existing deep link) or a comma list (the multi-select), so
 * both shapes collapse here and the SQL below only ever sees a list.
 */
export function locationIdsFor(filters: Pick<ReviewsQuery, "locationId" | "locationIds">) {
  const ids = [...(filters.locationIds ?? []), ...(filters.locationId ? [filters.locationId] : [])]
  return ids.length > 0 ? [...new Set(ids)] : undefined
}

/**
 * One list row as the SQL below returns it: the contract's `ReviewRow` minus
 * `capabilities` (added by the route), with timestamps still `Date`s until
 * `NextResponse.json` serialises them.
 */
export type InboxQueryRow = Omit<
  ReviewRow,
  "capabilities" | "createTime" | "updateTime"
> & {
  createTime: Date | string
  updateTime: Date | string
}

// Per-sort ordering and keyset predicate, keyed by the contract's sort
// vocabulary so a new `ReviewSort` fails to compile until both are defined.
const ORDER_BY: Record<ReviewSort, (sql: TransactionSql) => Fragment> = {
  updated_desc: (sql) => sql`order by r.update_time desc, r.id desc`,
  updated_asc: (sql) => sql`order by r.update_time asc, r.id asc`,
  rating_desc: (sql) => sql`order by
    r.star_rating desc nulls last,
    r.update_time desc,
    r.id desc`,
  rating_asc: (sql) => sql`order by
    r.star_rating asc nulls last,
    r.update_time desc,
    r.id desc`,
}

// Rating sorts place nulls last, so a null-rated boundary row continues
// within the null block; a rated boundary row admits lower/higher ratings,
// every null, or the same rating further down the (update_time, id) key.
function ratingCursor(
  sql: TransactionSql,
  cursor: ReviewsCursor,
  direction: "<" | ">"
): Fragment {
  if (cursor.rating === null || cursor.rating === undefined) {
    return sql`and r.star_rating is null
      and (r.update_time, r.id) < (${cursor.updateTime}, ${cursor.id})`
  }
  const beyond =
    direction === "<"
      ? sql`r.star_rating < ${cursor.rating}`
      : sql`r.star_rating > ${cursor.rating}`
  return sql`and (
    ${beyond}
    or r.star_rating is null
    or (
      r.star_rating = ${cursor.rating}
      and (r.update_time, r.id) < (${cursor.updateTime}, ${cursor.id})
    )
  )`
}

const CURSOR_PREDICATE: Record<
  ReviewSort,
  (sql: TransactionSql, cursor: ReviewsCursor) => Fragment
> = {
  updated_desc: (sql, cursor) =>
    sql`and (r.update_time, r.id) < (${cursor.updateTime}, ${cursor.id})`,
  updated_asc: (sql, cursor) =>
    sql`and (r.update_time, r.id) > (${cursor.updateTime}, ${cursor.id})`,
  rating_desc: (sql, cursor) => ratingCursor(sql, cursor, "<"),
  rating_asc: (sql, cursor) => ratingCursor(sql, cursor, ">"),
}

export function buildInboxQuery(
  sql: TransactionSql,
  filters: InboxFilters
) {
  return sql<InboxQueryRow[]>`
    select
      r.id::text as id,
      json_build_object(
        'id', l.id::text,
        'name', l.name,
        'clientId', l.client_id::text,
        'clientName', client_row.name
      ) as location,
      json_build_object(
        'displayName', r.reviewer_display_name,
        'isAnonymous', r.reviewer_is_anonymous,
        'profilePhotoUrl', r.reviewer_profile_photo_url
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
    ${
      filters.search
        ? sql`
          join search_review_ids(
            nullif(
              current_setting('app.organisation_id', true),
              ''
            )::uuid,
            ${filters.search},
            ${sha256(filters.search)}
          ) search_match on search_match.review_id = r.id
        `
        : sql``
    }
    join location l on l.id = r.location_id
    left join client client_row on client_row.id = l.client_id
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
        locationIdsFor(filters)
          ? sql`and r.location_id in ${sql(locationIdsFor(filters)!)}`
          : sql``
      }
      ${
        filters.clientId
          ? sql`and l.client_id = ${filters.clientId}`
          : sql``
      }
      ${
        filters.queue
          ? sql`and ${queuePredicate(
              sql,
              { userId: filters.userId, role: filters.role, canPublish: filters.canPublish },
              filters.queue,
              { requireTwoPersonApproval: filters.requireTwoPersonApproval }
            )}`
          : sql``
      }
      ${
        filters.assignee === "unassigned"
          ? sql`and r.assigned_to is null`
          : filters.assignee === "me"
            ? sql`and r.assigned_to = ${filters.userId}`
            : filters.assignee
              ? sql`and r.assigned_to = ${filters.assignee}`
              : sql``
      }
      ${
        filters.ratings?.length
          ? sql`and r.star_rating in ${sql(filters.ratings)}`
          : sql``
      }
      ${
        // Same test as the draft route's isRatingOnly: whitespace is no text.
        filters.written === "rating_only"
          ? sql`and coalesce(btrim(r.review_text), '') = ''`
          : filters.written === "with_text"
            ? sql`and coalesce(btrim(r.review_text), '') <> ''`
            : sql``
      }
      ${
        filters.statuses?.length
          ? sql`and r.workflow_status in ${sql(filters.statuses)}`
          : sql``
      }
      ${
        filters.replyState === "replied"
          ? sql`and rr.current_body is not null`
          : filters.replyState === "unreplied"
            ? sql`and rr.current_body is null`
            : sql``
      }
      ${
        filters.dateFrom
          ? sql`and r.update_time >= ${filters.dateFrom}`
          : sql``
      }
      ${
        // Exclusive: the inbox sends the start of the day after the one
        // picked (lib/inbox/url-state.ts), so the picked day is whole.
        filters.dateTo ? sql`and r.update_time < ${filters.dateTo}` : sql``
      }
      ${
        filters.cursor
          ? CURSOR_PREDICATE[filters.sort](sql, filters.cursor)
          : sql``
      }
      and ${visibilityPredicate(
        sql,
        { role: filters.role, userId: filters.userId },
        sql`r.location_id`
      )}
    ${ORDER_BY[filters.sort](sql)}
    limit ${filters.pageSize + 1}
  `
}
