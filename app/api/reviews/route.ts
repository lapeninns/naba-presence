import { z } from "zod"

import { reviewCapabilitiesForLocations } from "@/lib/server/capabilities"
import { ApiError } from "@/lib/server/http"
import { buildInboxQuery } from "@/lib/server/reviews-query"
import { route } from "@/lib/server/route"

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
const sorts = [
  "updated_desc",
  "updated_asc",
  "rating_desc",
  "rating_asc",
] as const

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
      rating: z.number().int().min(1).max(5).nullable().optional(),
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

function decodeCursor(value: string | null, sort: string | null) {
  if (!value) return undefined
  try {
    const cursor = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    )
    if (
      (sort === "rating_desc" || sort === "rating_asc") &&
      (typeof cursor !== "object" ||
        cursor === null ||
        !Object.hasOwn(cursor, "rating") ||
        (typeof cursor.rating !== "number" && cursor.rating !== null))
    ) {
      throw new ApiError(
        400,
        "invalid_cursor",
        "Rating cursors must include a rating."
      )
    }
    return cursor
  } catch (error) {
    if (error instanceof ApiError) throw error
    return undefined
  }
}

export const GET = route({
  // Bespoke decoding: comma-separated lists and a base64url cursor, so the
  // raw searchParams are mapped by hand before the zod schema runs.
  query: (params) =>
    querySchema.parse({
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
      cursor: decodeCursor(params.get("cursor"), params.get("sort")),
    }),
  handler: async ({ session, query, tenant }) => {
    const rawRows = await tenant(async (sql) => {
      const queried = (await buildInboxQuery(sql, {
        ...query,
        role: session.role,
        userId: session.userId,
      })) as unknown as (Record<string, unknown> & {
        location: { id: string }
      })[]
      const capabilities = await reviewCapabilitiesForLocations(
        sql,
        session,
        queried.map((row) => row.location.id)
      )
      return queried.map((row) => ({
        ...row,
        capabilities: capabilities.get(row.location.id) ?? {
          canPublish: false,
          canEdit: false,
        },
      }))
    })
    const rows = rawRows
    const hasMore = rows.length > query.pageSize
    const items = hasMore ? rows.slice(0, query.pageSize) : rows
    const last = items.at(-1) as
      | { id: string; updateTime: string | Date; rating: number | null }
      | undefined
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
    return { items, nextCursor }
  },
})
