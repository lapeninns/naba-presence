import { z } from "zod"

import { retryBulkOperation } from "@/lib/server/bulk-listings"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
const params = z.object({ id: z.uuid() })

export const POST = route({
  roles: ["owner", "admin"], params,
  handler: async ({ session, params, requestId }) => ({ operation: await retryBulkOperation(session, params.id, requestId) }),
})
