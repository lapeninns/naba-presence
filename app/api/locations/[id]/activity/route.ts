import { z } from "zod"

import { listLocationActivity } from "@/lib/server/location-activity"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

const querySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
})

export const GET = route({
  params: z.object({ id: z.uuid() }),
  query: querySchema,
  handler: async ({ session, params, query }) => ({
    activity: await listLocationActivity(
      session.organisationId,
      session,
      params.id,
      query
    ),
  }),
})
