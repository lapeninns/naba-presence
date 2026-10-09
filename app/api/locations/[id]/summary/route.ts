import { z } from "zod"

import type { ListingSummaryResponse } from "@/lib/contracts/location-summary"
import { ApiError } from "@/lib/server/http"
import { readListingSummaries } from "@/lib/server/location-summary"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/** The listing's state without opening any editor. DB-only; never Google. */
export const GET = route({
  params: z.object({ id: z.uuid() }),
  handler: async ({ session, params, tenant }) => {
    const [summary] = await tenant((sql) =>
      readListingSummaries(sql, session, [params.id])
    )
    if (!summary) {
      throw new ApiError(
        404,
        "location_not_found",
        "The requested location was not found."
      )
    }
    return { summary } satisfies ListingSummaryResponse
  },
})
