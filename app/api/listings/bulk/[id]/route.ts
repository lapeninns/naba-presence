import { z } from "zod"

import { readBulkOperation } from "@/lib/server/bulk-listings"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
const params = z.object({ id: z.uuid() })

export const GET = route({ params, handler: async ({ session, params }) => ({ operation: await readBulkOperation(session, params.id) }) })
