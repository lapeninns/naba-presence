import { z } from "zod"

import { bulkApprovalSchema } from "@/lib/contracts/bulk-listings"
import { approveBulkOperation } from "@/lib/server/bulk-listings"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
const params = z.object({ id: z.uuid() })

/** Approves an exact preview revision. */
export const POST = route({
  roles: ["owner", "admin"], params, body: bulkApprovalSchema,
  handler: async ({ session, params, body, requestId }) => ({ operation: await approveBulkOperation(session, params.id, body, requestId) }),
})
