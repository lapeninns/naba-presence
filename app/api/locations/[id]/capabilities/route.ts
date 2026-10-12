import { z } from "zod"

import type { LocationCapabilitiesResponse } from "@/lib/contracts/location-capabilities"
import { locationCapabilities } from "@/lib/server/capabilities"
import { loadPauseSnapshot } from "@/lib/server/pause-controls"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  params: z.object({ id: z.uuid() }),
  handler: async ({ session, params, tenant }) => {
    // Read before the transaction, never inside it (lib/server/db.ts).
    const pauses = await loadPauseSnapshot()
    return {
      capabilities: await tenant((sql) =>
        locationCapabilities(sql, session, params.id, pauses)
      ),
    } satisfies LocationCapabilitiesResponse
  },
})
