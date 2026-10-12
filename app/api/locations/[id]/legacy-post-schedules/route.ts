import { z } from "zod"

import { listLegacySchedules } from "@/lib/server/publication-schedules"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
const params = z.object({ id: z.uuid() })

/** Pre-WP7 per-post times waiting for an owner or administrator's review (0240, P08-R5). */
export const GET = route({
  roles: ["owner", "admin"],
  params,
  handler: async ({ session, params }) =>
    listLegacySchedules(session, params.id),
})
