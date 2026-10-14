import { z } from "zod"

import { legacyScheduleActionSchema } from "@/lib/contracts/publication-schedules"
import { dismissLegacySchedule } from "@/lib/server/publication-schedules"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid(), legacyId: z.uuid() })

/** Dismiss one old per-post time: an owner or administrator's call. */
export const PATCH = route({
  maxDuration,
  roles: ["owner", "admin"],
  params,
  body: legacyScheduleActionSchema,
  handler: async ({ session, params, requestId }) =>
    dismissLegacySchedule(session, params.id, params.legacyId, requestId),
})
