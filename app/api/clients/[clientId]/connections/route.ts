import {
  clientAttachConnectionSchema,
  clientIdParamsSchema,
  clientSetupResponseSchema,
  type ClientSetupResponse,
} from "@/lib/contracts/clients"
import { writeAudit } from "@/lib/server/audit"
import { attachConnectionToClient, readClientSetup } from "@/lib/server/clients"
import { ApiError } from "@/lib/server/http"
import { requireClientAccess } from "@/lib/server/permissions"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Use a Google login the organisation already connected for this client.
 *
 * Only a working login can be picked: attaching an expired one would move
 * the wizard to a step whose account discovery fails straight away. The
 * response is the new setup state, so the wizard can move on without a
 * second round trip.
 */
export const POST = route({
  roles: ["owner", "admin"],
  params: clientIdParamsSchema,
  body: clientAttachConnectionSchema,
  handler: async ({
    session,
    params,
    body,
    requestId,
    clientRequestId,
    tenant,
  }): Promise<ClientSetupResponse> => {
    const setup = await tenant(async (sql) => {
      await requireClientAccess(sql, session, params.clientId)
      const [connection] = await sql<{ status: string; reconnect: boolean }[]>`
        select
          gc.status,
          exists (
            select 1 from connection_task ct
            where ct.google_connection_id = gc.id
              and ct.task_type = 'reconnect'
              and ct.status = 'open'
          ) as reconnect
        from google_connection gc
        where gc.id = ${body.connectionId}
      `
      if (!connection) {
        throw new ApiError(
          404,
          "connection_not_found",
          "That Google connection no longer exists."
        )
      }
      if (connection.status !== "active" || connection.reconnect) {
        throw new ApiError(
          409,
          "google_reconnect_required",
          "That Google account needs reconnecting before it can be used."
        )
      }
      const attached = await attachConnectionToClient(sql, {
        organisationId: session.organisationId,
        clientId: params.clientId,
        connectionId: body.connectionId,
        userId: session.userId,
      })
      if (!attached) {
        throw new ApiError(
          404,
          "connection_not_found",
          "That Google connection no longer exists."
        )
      }
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "client.connection_attached",
        subjectType: "client",
        subjectId: params.clientId,
        requestId,
        metadata: { connectionId: body.connectionId, clientRequestId },
      })
      return readClientSetup(sql, session, params.clientId)
    })
    return clientSetupResponseSchema.parse({ setup })
  },
})
