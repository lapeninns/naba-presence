import { analyticsOverviewQuerySchema } from "@/lib/contracts/analytics"
import { loadAnalyticsOverview } from "@/lib/server/analytics-overview"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

// The SQL lives in lib/server/analytics-overview.ts so the /home server
// prefetch can reuse it; this route only parses the query string.
export const GET = route({
  query: (searchParams) =>
    analyticsOverviewQuerySchema.parse({
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      granularity: searchParams.get("granularity") ?? undefined,
    }),
  handler: ({ session, query, tenant }) =>
    tenant((sql) => loadAnalyticsOverview(sql, session, query)),
})
