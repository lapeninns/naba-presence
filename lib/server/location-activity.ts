import "server-only"

import { withTenant } from "@/lib/server/db"
import { requireLocationAccess } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

export type LocationActivityItem = {
  id: string
  resourceType: string
  operation: string
  status: string
  targetResourceName: string | null
  lastErrorCode: string | null
  updateMask: string[]
  createdAt: string
  finishedAt: string | null
  actorUserId: string
  actorDisplayName: string | null
}

export async function listLocationActivity(
  organisationId: string,
  session: Session,
  locationId: string,
  options: { page?: number; pageSize?: number } = {}
) {
  const page = Math.max(1, Math.floor(options.page ?? 1))
  const pageSize = Math.min(50, Math.max(1, Math.floor(options.pageSize ?? 20)))
  const offset = (page - 1) * pageSize

  return withTenant(organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    const [countRow] = await sql<{ total: number }[]>`
      select count(*)::integer as total
      from gbp_management_mutation
      where location_id = ${locationId}
    `
    const total = countRow?.total ?? 0
    const items = await sql<
      {
        id: string
        resourceType: string
        operation: string
        status: string
        targetResourceName: string | null
        lastErrorCode: string | null
        updateMask: string[]
        createdAt: string
        finishedAt: string | null
        actorUserId: string
        actorDisplayName: string | null
      }[]
    >`
      select
        m.id::text as id,
        m.resource_type as "resourceType",
        m.operation,
        m.status,
        m.target_resource_name as "targetResourceName",
        m.last_error_code as "lastErrorCode",
        m.update_mask as "updateMask",
        m.created_at as "createdAt",
        m.finished_at as "finishedAt",
        m.actor_user_id::text as "actorUserId",
        u.display_name as "actorDisplayName"
      from gbp_management_mutation m
      left join app_user u on u.id = m.actor_user_id
      where m.location_id = ${locationId}
      order by m.created_at desc
      limit ${pageSize} offset ${offset}
    `
    return {
      items: items.map((item) => ({
        ...item,
        createdAt: new Date(item.createdAt).toISOString(),
        finishedAt: item.finishedAt
          ? new Date(item.finishedAt).toISOString()
          : null,
      })),
      total,
      page,
      pageSize,
    }
  })
}
