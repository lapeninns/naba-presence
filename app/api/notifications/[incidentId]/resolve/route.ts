import { z } from "zod"

import { resolveNotification } from "@/lib/server/notifications/inbox"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
const params = z.object({ incidentId: z.uuid() })

export const POST = route({
  roles: ["owner", "admin"],
  params,
  handler: async ({ session, params, requestId }) => resolveNotification(session, params.incidentId, requestId),
})
