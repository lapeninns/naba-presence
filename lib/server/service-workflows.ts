import "server-only"
import { serviceWorkflowCursorSchema, serviceWorkflowsResponseSchema, type ServiceWorkflowQuery } from "@/lib/contracts/service-workflows"
import { withTenant } from "./db"
import { ApiError } from "./http"
import { requireLocationAccess } from "./permissions"
import { requireRole, type Session } from "./session"

function cursor(value: string | undefined, locationId: string) {
  if (!value) return null
  try {
    const parsed = serviceWorkflowCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")))
    if (parsed.locationId !== locationId) throw new Error("Different location")
    return parsed
  } catch { throw new ApiError(400, "invalid_request", "Invalid saved services cursor.") }
}
export async function listServiceWorkflows(session: Session, locationId: string, query: ServiceWorkflowQuery) {
  requireRole(session, ["owner", "admin"])
  const after = cursor(query.cursor, locationId)
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    const [location] = await sql`select id from location where id = ${locationId}`
    if (!location) throw new ApiError(404, "location_not_found", "The location was not found.")
    const rows = await sql<{ id: string; createdAt: string; changeSet: unknown; attemptId: string | null }[]>`
      select c.id, to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt", m.id as "attemptId",
        json_build_object('id',c.id,'locationName',l.name,'targetResourceName',c.target_resource_name,
          'payloadHash',c.payload_hash,'baselineHash',c.baseline_hash,'payload',c.payload,'baseline',c.baseline,
          'updateMask',c.update_mask,'requestedBy',c.requested_by,'approvedBy',c.approved_by,
          'requiresSecondApprover',c.require_two_person_approval,'canApprove',
          (not c.require_two_person_approval or c.requested_by <> ${session.userId}::uuid),
          'expiresAt',to_char(c.approval_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) as "changeSet"
      from gbp_change_set c join location l on l.id = c.location_id
        left join gbp_management_mutation m on m.change_set_id = c.id and m.resource_type = 'business_info' and m.update_mask = array['serviceItems']::text[]
      where c.location_id = ${locationId} and c.resource_type = 'business_info' and c.update_mask = array['serviceItems']::text[]
        and (c.approval_expires_at > now() or m.id is not null)
        and (${!after} or (c.created_at,c.id) < (${after?.createdAt ?? "9999-01-01T00:00:00Z"}::text::timestamptz,${after?.id ?? "ffffffff-ffff-ffff-ffff-ffffffffffff"}::uuid))
      order by c.created_at desc,c.id desc limit ${query.limit + 1}
    `
    const visible = rows.slice(0, query.limit), last = visible.at(-1)
    return serviceWorkflowsResponseSchema.parse({ items: visible.map((row) => ({ changeSet: row.changeSet, attemptId: row.attemptId })),
      nextCursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify({ locationId, createdAt: last.createdAt, id: last.id })).toString("base64url") : null })
  })
}
