import { NextResponse } from "next/server"
import { z } from "zod"

import { executeBulkOperation } from "@/lib/server/bulk-listings"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
const params = z.object({ id: z.uuid() })

/** Queues the approved children; the job tick runs them. 202 with the operation. */
export const POST = route({
  roles: ["owner", "admin"], params,
  handler: async ({ session, params, requestId }) => NextResponse.json({ operation: await executeBulkOperation(session, params.id, requestId) }, { status: 202 }),
})
