import { reviewCountsQuerySchema, type ReviewCounts } from "@/lib/contracts/reviews"
import { readReviewCounts } from "@/lib/server/review-counts"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  // Snake_case on the wire, camelCase in the contract — the default
  // searchParams mapping copies keys verbatim, so `group_by` has to be
  // named here or it silently never arrives.
  query: (searchParams) =>
    reviewCountsQuerySchema.parse({
      locationId: searchParams.get("location_id") ?? searchParams.get("locationId") ?? undefined,
      clientId: searchParams.get("client_id") ?? undefined,
      groupBy: searchParams.get("group_by") ?? undefined,
    }),
  handler: async ({ session, query, tenant }): Promise<ReviewCounts> =>
    tenant((sql) => readReviewCounts(sql, session, query)),
})
