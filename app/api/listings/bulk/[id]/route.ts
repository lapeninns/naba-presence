import { z } from "zod"

import { readBulkOperation } from "@/lib/server/bulk-listings"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid() })

export const GET = route({ maxDuration, params, handler: async ({ session, params }) => ({ operation: await readBulkOperation(session, params.id) }) })
