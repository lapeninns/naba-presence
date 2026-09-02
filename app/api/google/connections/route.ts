import type { ConnectionsResponse } from "@/lib/contracts/connections"
import { listConnections } from "@/lib/server/connections"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  handler: async ({ session }) =>
    ({ connections: await listConnections(session) }) satisfies ConnectionsResponse,
})
