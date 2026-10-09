import { presenceQuerySchema } from "@/lib/contracts/analytics"
import { loadPresenceReport } from "@/lib/server/presence-report"
import { route } from "@/lib/server/route"

// The SQL lives in lib/server/presence-report.ts so the public client report
// can reuse it; this route only parses the query string.
export const GET = route({
  query: (searchParams) =>
    presenceQuerySchema.parse({
      range: searchParams.get("range") ?? undefined,
      locationId: searchParams.get("locationId") ?? undefined,
      clientId: searchParams.get("clientId") ?? undefined,
    }),
  handler: ({ session, query, tenant }) =>
    tenant((sql) => loadPresenceReport(sql, session, query)),
})
