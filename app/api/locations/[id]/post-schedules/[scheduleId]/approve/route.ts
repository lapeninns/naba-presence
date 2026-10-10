import { z } from "zod"

import { scheduleApprovalSchema } from "@/lib/contracts/publication-schedules"
import { approvePublicationSchedule } from "@/lib/server/publication-schedules"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
const params = z.object({ id: z.uuid(), scheduleId: z.uuid() })

export const POST = route({
  roles: ["owner", "admin"], params, body: scheduleApprovalSchema,
  handler: async ({ session, params, body, requestId }) => ({ schedule: await approvePublicationSchedule(session, params.id, params.scheduleId, body, requestId) }),
})
