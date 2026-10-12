import { getBillingOverview } from "@/lib/server/billing/overview"
import { loadPauseSnapshot } from "@/lib/server/pause-controls"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * The organisation's billing state, access, billable locations and the plan
 * catalog for its workspace mode (plan P07-S5). Any member may read it; the
 * billing mutations beside it are owner-only.
 */
export const GET = route({
  handler: async ({ session, tenant }) => {
    const pauses = await loadPauseSnapshot()
    return tenant((sql) => getBillingOverview(sql, session, pauses))
  },
})
