import { z } from "zod"

import type { ListingSummariesResponse } from "@/lib/contracts/location-summary"
import type { ListingCompletenessResponse } from "@/lib/listings/completeness-contract"
import { readListingCompleteness } from "@/lib/server/listing-completeness"
import { readListingSummaries } from "@/lib/server/location-summary"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Every visible listing's state in one pass, for the Listings board. The
 * same handful of queries as one overview, scoped to the whole directory.
 *
 * `?view=completeness` answers each listing's completeness checks instead
 * (`{ completeness }`), optionally for one `locationId`. Also DB-only; the
 * default response is unchanged, so the board's summaries don't pay for it.
 */
export const GET = route({
  query: z.object({
    view: z.enum(["summary", "completeness"]).default("summary"),
    locationId: z.uuid().optional(),
  }),
  handler: async ({ session, tenant, query }) => {
    if (query.view === "completeness") {
      return {
        completeness: await tenant((sql) =>
          readListingCompleteness(
            sql,
            session,
            query.locationId ? [query.locationId] : undefined
          )
        ),
      } satisfies ListingCompletenessResponse
    }
    return {
      summaries: await tenant((sql) => readListingSummaries(sql, session)),
    } satisfies ListingSummariesResponse
  },
})
