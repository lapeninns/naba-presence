import { z } from "zod"

import { scheduleDraftSchema } from "@/lib/contracts/publication-schedules"
import { createPublicationSchedule, listPublicationSchedules } from "@/lib/server/publication-schedules"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
const params = z.object({ id: z.uuid() })

export const GET = route({ params, handler: async ({ session, params }) => ({ schedules: await listPublicationSchedules(session, params.id) }) })
export const POST = route({
  params, body: scheduleDraftSchema,
  handler: async ({ session, params, body, requestId }) => ({ schedule: await createPublicationSchedule(session, params.id, body, requestId) }),
})
