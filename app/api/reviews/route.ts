import { NextResponse } from "next/server"
import { z } from "zod"

import { decryptSecret, sha256 } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { apiError } from "@/lib/server/http"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const workflowStatuses = [
  "new",
  "drafted",
  "verified",
  "awaiting_approval",
  "publish_requested",
  "published",
  "rejected",
  "failed",
  "escalated",
] as const
const publishStatuses = [
  "not_published",
  "awaiting_approval",
  "accepted",
  "published",
  "rejected",
  "failed",
  "deleted",
] as const
const verificationStatuses = ["pass", "warn", "fail", "pending"] as const
const syncStatuses = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const
const sorts = ["updated_desc", "rating_desc", "rating_asc"] as const

const querySchema = z.object({
  locationId: z.uuid().optional(),
  ratings: z.array(z.number().int().min(1).max(5)).optional(),
  statuses: z.array(z.enum(workflowStatuses)).optional(),
  replyStates: z.array(z.enum(["replied", "unreplied"])).optional(),
  verificationStatuses: z.array(z.enum(verificationStatuses)).optional(),
  publishStatuses: z.array(z.enum(publishStatuses)).optional(),
  syncStatuses: z.array(z.enum(syncStatuses)).optional(),
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(sorts).default("updated_desc"),
  pageSize: z.number().int().min(1).max(100).default(50),
  cursor: z
    .object({
      updateTime: z.iso.datetime(),
      id: z.uuid(),
      rating: z.number().int().min(1).max(5).optional(),
    })
    .optional(),
})

function commaNumbers(value: string | null) {
  return value
    ? value
        .split(",")
        .map(Number)
        .filter((number) => Number.isInteger(number))
    : undefined
}

function commaStrings(value: string | null) {
  return value?.split(",").filter(Boolean)
}

function decodeCursor(value: string | null) {
  if (!value) return undefined
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
  } catch {
    return undefined
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const params = new URL(request.url).searchParams
    const query = querySchema.parse({
      locationId: params.get("location_id") ?? undefined,
      ratings: commaNumbers(params.get("rating")),
      statuses: commaStrings(params.get("status")),
      replyStates: commaStrings(params.get("reply_state")),
      verificationStatuses: commaStrings(params.get("verification")),
      publishStatuses: commaStrings(params.get("publish_status")),
      syncStatuses: commaStrings(params.get("sync_status")),
      dateFrom: params.get("date_from") ?? undefined,
      dateTo: params.get("date_to") ?? undefined,
      search: params.get("search") ?? undefined,
      sort: params.get("sort") ?? undefined,
      pageSize: params.get("page_size")
        ? Number(params.get("page_size"))
        : undefined,
      cursor: decodeCursor(params.get("cursor")),
    })
    const rawRows = await withTenant(
      session.organisationId,
      (sql) => sql`
      select
        r.id::text as id,
        r.google_review_name_ciphertext as "googleReviewNameCiphertext",
        r.google_review_id_ciphertext as "googleReviewIdCiphertext",
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
      where 1 = 1
        ${
          query.locationId
            ? sql`and r.location_id = ${query.locationId}`
            : sql``
        }
        ${
          query.ratings?.length
            ? sql`and r.star_rating in ${sql(query.ratings)}`
            : sql``
        }
        ${
          query.statuses?.length
            ? sql`and r.workflow_status in ${sql(query.statuses)}`
            : sql``
        }
        ${
          query.replyStates?.length === 1
            ? query.replyStates[0] === "replied"
              ? sql`and rr.current_body is not null`
              : sql`and rr.current_body is null`
            : sql``
        }
        ${
          query.verificationStatuses?.length
            ? sql`and coalesce(d.verification_status, 'pending')
                in ${sql(query.verificationStatuses)}`
            : sql``
        }
        ${
          query.publishStatuses?.length
            ? sql`and coalesce(rr.publish_status, 'not_published')
                in ${sql(query.publishStatuses)}`
            : sql``
        }
        ${
          query.syncStatuses?.length
            ? sql`and sc.status in ${sql(query.syncStatuses)}`
            : sql``
        }
        ${query.dateFrom ? sql`and r.update_time >= ${query.dateFrom}` : sql``}
        ${query.dateTo ? sql`and r.update_time <= ${query.dateTo}` : sql``}
        ${
          query.search
            ? sql`and (
                to_tsvector(
                  'simple',
                  coalesce(r.review_text, '') || ' ' ||
                  coalesce(r.reviewer_display_name, '') || ' ' ||
                  l.name
                ) @@ websearch_to_tsquery('simple', ${query.search})
                or r.google_review_id_hash = ${sha256(query.search)}
                or r.google_review_name_hash = ${sha256(query.search)}
              )`
            : sql``
        }
        ${
          query.cursor && query.sort === "updated_desc"
            ? sql`and (r.update_time, r.id) < (
                ${query.cursor.updateTime}, ${query.cursor.id}
              )`
            : query.cursor &&
                query.sort === "rating_desc" &&
                query.cursor.rating
              ? sql`and (
                  r.star_rating < ${query.cursor.rating}
                  or (
                    r.star_rating = ${query.cursor.rating}
                    and (r.update_time, r.id) < (
                      ${query.cursor.updateTime}, ${query.cursor.id}
                    )
                  )
                )`
              : query.cursor &&
                  query.sort === "rating_asc" &&
                  query.cursor.rating
                ? sql`and (
                    r.star_rating > ${query.cursor.rating}
                    or (
                      r.star_rating = ${query.cursor.rating}
                      and (r.update_time, r.id) < (
                        ${query.cursor.updateTime}, ${query.cursor.id}
                      )
                    )
                  )`
                : sql``
        }
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
      ${
        query.sort === "rating_desc"
          ? sql`order by r.star_rating desc, r.update_time desc, r.id desc`
          : query.sort === "rating_asc"
            ? sql`order by r.star_rating asc, r.update_time desc, r.id desc`
            : sql`order by r.update_time desc, r.id desc`
      }
      limit ${query.pageSize + 1}
    `
    )
    const rows = rawRows.map((row) => {
      const record = row as Record<string, unknown> & {
        googleReviewNameCiphertext: Buffer
        googleReviewIdCiphertext: Buffer
      }
      const { googleReviewNameCiphertext, googleReviewIdCiphertext, ...item } =
        record
      return {
        ...item,
        googleReviewName: decryptSecret(googleReviewNameCiphertext),
        googleReviewId: decryptSecret(googleReviewIdCiphertext),
      }
    })
    const hasMore = rows.length > query.pageSize
    const items = hasMore ? rows.slice(0, query.pageSize) : rows
    const last = items.at(-1) as
      { id: string; updateTime: string | Date; rating: number } | undefined
    const nextCursor =
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              updateTime:
                last.updateTime instanceof Date
                  ? last.updateTime.toISOString()
                  : last.updateTime,
              id: last.id,
              rating: last.rating,
            })
          ).toString("base64url")
        : null
    return NextResponse.json({ items, nextCursor })
  } catch (error) {
    return apiError(error)
  }
}
