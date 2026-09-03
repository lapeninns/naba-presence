import {
  clientIdParamsSchema,
  clientSetupResponseSchema,
  type ClientSetupResponse,
} from "@/lib/contracts/clients"
import { readClientSetup } from "@/lib/server/clients"
import { requireClientAccess } from "@/lib/server/permissions"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  roles: ["owner", "admin"],
  params: clientIdParamsSchema,
  handler: async ({ session, params, tenant }): Promise<ClientSetupResponse> => {
    const setup = await tenant(async (sql) => {
      await requireClientAccess(sql, session, params.clientId)
      return readClientSetup(sql, session, params.clientId)
    })
    return clientSetupResponseSchema.parse({ setup })
  },
})
