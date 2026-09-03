import {
  clientAssignLocationsSchema,
  clientIdParamsSchema,
} from "@/lib/contracts/clients"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import { requireClientAccess } from "@/lib/server/permissions"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Assign locations to a client.
 *
 * `grantToClientMembers` closes a gap that would otherwise generate support
 * tickets: a member who can already see every OTHER location of this client
 * plainly should see the new one too, but per-location grants are explicit,
 * so without this they silently would not. Only members who hold the whole
 * client are extended — a member scoped to one branch stays scoped to it.
 */
export const POST = route({
  roles: ["owner", "admin"],
  params: clientIdParamsSchema,
  body: clientAssignLocationsSchema,
  handler: async ({ session, params, body, requestId, tenant }) => {
    const assigned = await tenant(async (sql) => {
      await requireClientAccess(sql, session, params.clientId)

      const existing = await sql<{ id: string }[]>`
        select id::text as id from location where client_id = ${params.clientId}
      `
      const updated = await sql<{ id: string }[]>`
        update location
           set client_id = ${params.clientId}
         where id in ${sql(body.locationIds)}
        returning id::text as id
      `
      if (updated.length !== body.locationIds.length) {
        throw new ApiError(
          404,
          "location_not_found",
          "One or more of those locations no longer exists."
        )
      }

      if (body.grantToClientMembers && existing.length > 0) {
        await sql`
          insert into location_member (organisation_id, location_id, user_id, can_publish)
          select ${session.organisationId}, new_location.id, holder.user_id, holder.can_publish
          from unnest(${sql.array(body.locationIds)}::uuid[]) as new_location(id)
          join lateral (
            select lm.user_id, bool_or(lm.can_publish) as can_publish
            from location_member lm
            where lm.location_id in ${sql(existing.map((row) => row.id))}
            group by lm.user_id
            having count(distinct lm.location_id) = ${existing.length}
          ) holder on true
          on conflict (location_id, user_id) do nothing
        `
      }

      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "client.locations_assigned",
        subjectType: "client",
        subjectId: params.clientId,
        requestId,
        metadata: { locationIds: body.locationIds, granted: body.grantToClientMembers },
      })
      return updated.map((row) => row.id)
    })
    return { assigned }
  },
})

export const DELETE = route({
  roles: ["owner", "admin"],
  params: clientIdParamsSchema,
  body: clientAssignLocationsSchema.pick({ locationIds: true }),
  handler: async ({ session, params, body, requestId, tenant }) => {
    const unassigned = await tenant(async (sql) => {
      const rows = await sql<{ id: string }[]>`
        update location set client_id = null
         where client_id = ${params.clientId}
           and id in ${sql(body.locationIds)}
        returning id::text as id
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "client.locations_assigned",
        subjectType: "client",
        subjectId: params.clientId,
        requestId,
        metadata: { removed: rows.map((row) => row.id) },
      })
      return rows.map((row) => row.id)
    })
    return { unassigned }
  },
})
