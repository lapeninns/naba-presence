import { z } from "zod"

import { retryBulkOperation } from "@/lib/server/bulk-listings"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid() })

export const POST = route({
  maxDuration,
  mfa: "step_up",
  roles: ["owner", "admin", "member"], params,
  handler: async ({ session, params, requestId }) => ({ operation: await retryBulkOperation(session, params.id, requestId) }),
})
