import {
  clientCreateSchema,
  clientsResponseSchema,
  type ClientsResponse,
} from "@/lib/contracts/clients"
import { writeAudit } from "@/lib/server/audit"
import {
  listClientSummaries,
  loadClientSummary,
  uniqueClientSlug,
} from "@/lib/server/clients"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * The client list. `?archived=1` answers the archived clients instead, for
 * the Clients page's Archived view; they are left out of every other list.
 */
export const GET = route({
  query: (searchParams) => ({
    archived: searchParams.get("archived") === "1",
  }),
  handler: async ({ session, query, tenant }): Promise<ClientsResponse> => {
    const result = await tenant((sql) =>
      listClientSummaries(sql, session, {
        archived: query.archived ? "only" : "exclude",
      })
    )
    return clientsResponseSchema.parse(result)
  },
})

export const POST = route({
  roles: ["owner", "admin"],
  body: clientCreateSchema,
  handler: async ({ session, body, requestId, tenant }) => {
    const client = await tenant(async (sql) => {
      const slug = await uniqueClientSlug(sql, body.name)
      const [created] = await sql<{ id: string }[]>`
        insert into client (organisation_id, name, slug, colour, notes, created_by)
        values (
          ${session.organisationId},
          ${body.name},
          ${slug},
          ${body.colour ?? null},
          ${body.notes ?? null},
          ${session.userId}
        )
        on conflict (organisation_id, name) do nothing
        returning id::text as id
      `
      if (!created) {
        // The unique constraint is the check: two operators creating the same
        // client at once both pass a pre-read, and only one insert survives.
        throw new ApiError(
          409,
          "client_name_taken",
          "A client with that name already exists.",
          { fieldErrors: { name: "A client with that name already exists." } }
        )
      }
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "client.created",
        subjectType: "client",
        subjectId: created.id,
        requestId,
        metadata: { name: body.name },
      })
      return loadClientSummary(sql, session, created.id)
    })
    return { client }
  },
})
