import { z } from "zod"

import { scheduleActionSchema, scheduleRevisionSchema } from "@/lib/contracts/publication-schedules"
import { actOnPublicationSchedule, revisePublicationSchedule } from "@/lib/server/publication-schedules"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
const params = z.object({ id: z.uuid(), scheduleId: z.uuid() })

/** A material edit or reschedule: a new revision that needs approval again. */
export const PUT = route({
  params, body: scheduleRevisionSchema,
  handler: async ({ session, params, body, requestId }) => ({ schedule: await revisePublicationSchedule(session, params.id, params.scheduleId, body, requestId) }),
})
export const PATCH = route({
  params, body: scheduleActionSchema,
  handler: async ({ session, params, body, requestId }) => ({ schedule: await actOnPublicationSchedule(session, params.id, params.scheduleId, body.action, requestId) }),
})
