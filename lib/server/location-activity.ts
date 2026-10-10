import "server-only"
import { z } from "zod"

import type {
  LocationActivityItem,
  LocationActivityQuery,
  LocationActivityState,
} from "@/lib/contracts/location-activity"
import { withTenant } from "@/lib/server/db"
import { retiredStoredGoogleResource, retiredGoogleMessage } from "@/lib/domain/google-support"
import { requireLocationAccess } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"
import { ApiError } from "@/lib/server/http"
import { locationActivityProjection } from "./location-activity-projection"
import { locationActivityItemSchema } from "@/lib/contracts/location-activity"

const cursorSchema = z.object({
  version: z.literal(1), locationId: z.uuid(),
  at: z.iso.datetime(), id: z.string().regex(/^(management|hours|profile|menus|links|media|posts|reviews):[0-9a-f-]{36}$/),
}).strict()

function parseCursor(value: string | undefined, locationId: string) {
  if (!value) return null
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")))
    if (cursor.locationId !== locationId) throw new ApiError(400, "invalid_cursor", "This cursor belongs to another location.")
    return cursor
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, "invalid_cursor", "The activity cursor is invalid.")
  }
}

// The item/state shapes are the wire contract
// (lib/contracts/location-activity.ts); re-exported for existing importers.
export type { LocationActivityItem, LocationActivityState }

export async function listLocationActivity(
  organisationId: string,
  session: Session,
  locationId: string,
  options: LocationActivityQuery = {}
): Promise<LocationActivityState> {
  const page = Math.max(1, Math.floor(options.page ?? 1))
  const pageSize = Math.min(50, Math.max(1, Math.floor(options.pageSize ?? 20)))
  const offset = (page - 1) * pageSize
  const cursor = parseCursor(options.cursor, locationId)

  return withTenant(organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    const [location] = await sql<{ id: string }[]>`select id from location where id = ${locationId}`
    if (!location) throw new ApiError(404, "location_not_found", "The location was not found.")
    const projection = locationActivityProjection(sql, locationId)
    const [countRow] = await sql<{ total: number }[]>`
      with activity as (${projection})
      select count(*)::integer as total
      from activity
    `
    const total = countRow?.total ?? 0
    const rows = await sql<(LocationActivityItem & { cursorTimestamp: string })[]>`
      with activity as (${projection})
      select
        m.id,
        m.source_id as "sourceId", m.source,
        m.resource_type as "resourceType",
        m.operation,
        m.status,
        m.execution_state as "executionState",
        m.confirmation_state as "confirmationState",
        m.can_confirm as "canConfirm",
        m.target_resource_name as "targetResourceName",
        m.last_error_code as "lastErrorCode",
        m.update_mask as "updateMask",
        m.created_at as "createdAt",
        m.finished_at as "finishedAt",
        m.actor_user_id::text as "actorUserId",
        u.display_name as "actorDisplayName",
        to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorTimestamp"
      from activity m
      left join app_user u on u.id = m.actor_user_id
      ${cursor ? sql`where (m.created_at, m.id) < (${cursor.at}::text::timestamptz, ${cursor.id}::text)` : sql``}
      order by m.created_at desc, m.id desc
      limit ${pageSize + 1} offset ${cursor ? 0 : offset}
    `
    const items = rows.slice(0, pageSize)
    const last = items.at(-1)
    const nextCursor = rows.length > pageSize && last
      ? Buffer.from(JSON.stringify({ version: 1, locationId, at: last.cursorTimestamp, id: last.id })).toString("base64url")
      : null
    return {
      canManage: session.role === "owner" || session.role === "admin",
      items: items.map((item) => locationActivityItemSchema.parse({
        ...item,
        ...historicalDetails(item.resourceType),
        createdAt: new Date(item.createdAt).toISOString(),
        finishedAt: item.finishedAt
          ? new Date(item.finishedAt).toISOString()
          : null,
      })),
      total,
      page,
      pageSize,
      nextCursor,
    }
  })
}

function historicalDetails(resourceType: string): { readonly historicalReason?: string } {
  const retired = retiredStoredGoogleResource(resourceType)
  return retired ? { historicalReason: retiredGoogleMessage(retired) } : {}
}
