import "server-only"
import type { z } from "zod"
import { lifecycleWorkflowCursorSchema, lifecycleWorkflowsQuerySchema, lifecycleWorkflowsResponseSchema } from "@/lib/contracts/google-lifecycle-workflows"
import { reviewedLifecyclePayloadSchema } from "@/lib/contracts/google-lifecycle-review"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { requireLocationAccess } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

function decodeCursor(value: string | undefined, locationId: string) {
  if (!value) return undefined
  try {
    const cursor = lifecycleWorkflowCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")))
    if (cursor.locationId !== locationId) throw new Error("Wrong location cursor")
    return cursor
  } catch { throw new ApiError(400, "invalid_request", "Invalid lifecycle saved-work cursor.") }
}
export async function listLifecycleWorkflows(session: Session, locationId: string, query: z.infer<typeof lifecycleWorkflowsQuerySchema>) {
  const cursor = decodeCursor(query.cursor, locationId)
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    const [location] = await sql<{ id: string }[]>`select id from location where id = ${locationId}`
    if (!location) throw new ApiError(404, "location_not_found", "Location not found.")
    const rows = await sql<{ reviewId: string; createdAt: string; payload: unknown; attemptId: string | null }[]>`
      select c.id as "reviewId", to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt", c.payload, m.id as "attemptId"
      from gbp_change_set c left join gbp_management_mutation m on m.change_set_id = c.id and m.location_id = c.location_id
      where c.location_id = ${locationId} and c.resource_type = 'location_lifecycle'
        and (c.approval_expires_at > now() or m.id is not null)
        and (${!cursor} or (c.created_at, c.id) < (${cursor?.createdAt ?? "9999-01-01T00:00:00.000000Z"}::text::timestamptz, ${cursor?.id ?? "ffffffff-ffff-ffff-ffff-ffffffffffff"}::uuid))
      order by c.created_at desc, c.id desc limit ${query.limit + 1}
    `
    const visible = rows.slice(0, query.limit), last = visible.at(-1)
    return lifecycleWorkflowsResponseSchema.parse({ items: visible.map((row) => ({ reviewId: row.reviewId, createdAt: row.createdAt, attemptId: row.attemptId, request: reviewedLifecyclePayloadSchema.parse(row.payload).request })),
      nextCursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify({ locationId, createdAt: last.createdAt, id: last.reviewId })).toString("base64url") : null })
  })
}
