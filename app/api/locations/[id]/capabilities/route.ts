import { z } from "zod"

import { locationCapabilities } from "@/lib/server/capabilities"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  params: z.object({ id: z.uuid() }),
  handler: async ({ session, params, tenant }) => ({
    capabilities: await tenant((sql) =>
      locationCapabilities(sql, session, params.id)
    ),
  }),
})
