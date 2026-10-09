import type { ListingSummariesResponse } from "@/lib/contracts/location-summary"
import { readListingSummaries } from "@/lib/server/location-summary"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Every visible listing's state in one pass, for the Listings board. The
 * same handful of queries as one overview, scoped to the whole directory.
 */
export const GET = route({
  handler: async ({ session, tenant }) =>
    ({
      summaries: await tenant((sql) => readListingSummaries(sql, session)),
    }) satisfies ListingSummariesResponse,
})
