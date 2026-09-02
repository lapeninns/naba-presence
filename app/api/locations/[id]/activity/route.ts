import { z } from "zod"

import {
  locationActivityQuerySchema,
  type LocationActivityResponse,
} from "@/lib/contracts/location-activity"
import { listLocationActivity } from "@/lib/server/location-activity"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  params: z.object({ id: z.uuid() }),
  query: locationActivityQuerySchema,
  handler: async ({ session, params, query }) =>
    ({
      activity: await listLocationActivity(
        session.organisationId,
        session,
        params.id,
        query
      ),
    }) satisfies LocationActivityResponse,
})
