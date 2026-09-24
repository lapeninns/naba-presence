import {
  clientIdParamsSchema,
  clientResponseSchema,
  clientUpdateSchema,
  type ClientResponse,
} from "@/lib/contracts/clients"
import { writeAudit } from "@/lib/server/audit"
import { loadClientSummary, uniqueClientSlug } from "@/lib/server/clients"
import { ApiError } from "@/lib/server/http"
import {
  requireClientAccess,
  visibilityPredicate,
} from "@/lib/server/permissions"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  params: clientIdParamsSchema,
  handler: async ({ session, params, tenant }): Promise<ClientResponse> => {
    const result = await tenant(async (sql) => {
      await requireClientAccess(sql, session, params.clientId)
      const client = await loadClientSummary(sql, session, params.clientId)
      if (!client) {
        throw new ApiError(
          404,
          "client_not_found",
          "The requested client was not found."
        )
      }
      const locations = await sql`
        select
          l.id::text as "locationId",
          l.name,
          l.address_json as address,
          l.timezone,
          l.client_id::text as "clientId",
          c.name as "clientName",
          ll.id::text as "linkId",
          e.id::text as "externalLocationId",
          e.google_location_name as "googleLocationName",
          e.title as "googleTitle",
          e.verified,
          coalesce(e.access_state = 'access_lost', false) as "accessLost"
        from location l
        left join client c on c.id = l.client_id
        left join location_link ll on ll.location_id = l.id and ll.is_active
        left join external_location e on e.id = ll.external_location_id
        where l.client_id = ${params.clientId}
          and ${visibilityPredicate(sql, session, sql`l.id`)}
        order by lower(l.name)
      `
      return { client, locations }
    })
    return clientResponseSchema.parse(result)
  },
})

export const PATCH = route({
  roles: ["owner", "admin"],
  params: clientIdParamsSchema,
  body: clientUpdateSchema,
  handler: async ({ session, params, body, requestId, tenant }) => {
    const client = await tenant(async (sql) => {
      await requireClientAccess(sql, session, params.clientId)

      if (body.archived === true) {
        const [attached] = await sql<{ count: number }[]>`
          select count(*)::int as count from location where client_id = ${params.clientId}
        `
        // Archiving a client that still owns listings would strand them out
        // of every filter and report, so it takes a deliberate second answer.
        if ((attached?.count ?? 0) > 0 && !body.detachLocations) {
          throw new ApiError(
            409,
            "client_has_locations",
            `This client still has ${attached!.count} location${attached!.count === 1 ? "" : "s"}. Move them to another client first, or confirm that they should become unassigned.`
          )
        }
        if (body.detachLocations) {
          await sql`update location set client_id = null where client_id = ${params.clientId}`
        }
      }

      const slug = body.name ? await uniqueClientSlug(sql, body.name) : null
      await sql`
        update client set
          name = coalesce(${body.name ?? null}, name),
          slug = coalesce(${slug}, slug),
          colour = ${body.colour === undefined ? sql`colour` : body.colour},
          notes = ${body.notes === undefined ? sql`notes` : body.notes},
          archived_at = ${
            body.archived === undefined
              ? sql`archived_at`
              : body.archived
                ? sql`now()`
                : null
          }
        where id = ${params.clientId}
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action:
          body.archived === true
            ? "client.archived"
            : body.archived === false
              ? "client.restored"
              : "client.updated",
        subjectType: "client",
        subjectId: params.clientId,
        requestId,
        metadata: { fields: Object.keys(body) },
      })
      // Read back archived or not: archiving answers the archived client, so
      // the caller can offer Undo, and restoring answers the restored one.
      return loadClientSummary(sql, session, params.clientId, {
        includeArchived: true,
      })
    })
    return { client }
  },
})
