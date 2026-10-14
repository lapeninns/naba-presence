import { NextResponse } from "next/server"
import { z } from "zod"

import { executeBulkOperation } from "@/lib/server/bulk-listings"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid() })

/** Queues the approved children; the job tick runs them. 202 with the operation. */
export const POST = route({
  maxDuration,
  mfa: "step_up",
  roles: ["owner", "admin"], params,
  handler: async ({ session, params, requestId }) => NextResponse.json({ operation: await executeBulkOperation(session, params.id, requestId) }, { status: 202 }),
})
