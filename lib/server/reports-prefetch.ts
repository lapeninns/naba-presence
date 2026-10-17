import "server-only"

import { analyticsOverviewSchema } from "@/lib/contracts/analytics"
import { queryKeys } from "@/lib/queries/keys"
import { loadAnalyticsOverview } from "@/lib/server/analytics-overview"
import { withTenant } from "@/lib/server/db"
import { throughWire, type PrefetchEntry } from "@/lib/server/prefetch"
import type { Session } from "@/lib/server/session"
import { resolveReplyRange, type ReplyRangeId } from "@/lib/reporting/ranges"

/**
 * /reports, Reply tab: the two overview reads (this period and the one before
 * it, for the change badges) the tab makes on mount. Read on the server, they
 * are in the first HTML, so the figures paint with the page instead of after
 * two client requests (the phone LCP: the first figure was the last thing to
 * arrive on Slow 4G).
 *
 * The keys must be the ones `ReplyPerformanceTab` builds, and they carry the
 * window's `from`/`to` to the millisecond, so both sides resolve the window
 * from the same `now`: the page passes it down as a prop (`windowNow`), and
 * the tab resolves its windows from it. A key that differs only reads as a
 * cache miss, but the hydrated page would then render loading where the server
 * rendered figures (#418), so there is one `now`, not two clocks.
 */
export function replyReportPrefetch(input: {
  rangeId: ReplyRangeId
  clientId?: string
  now: Date
}): (session: Session) => PrefetchEntry[] {
  return (session) => {
    const { current, previous } = resolveReplyRange(input.rangeId, input.now)
    return [current, previous].map((window) => {
      const params = { ...window, clientId: input.clientId }
      return {
        queryKey: queryKeys.analytics("overview", params),
        load: async () =>
          throughWire(
            analyticsOverviewSchema,
            await withTenant(session.organisationId, (sql) =>
              loadAnalyticsOverview(sql, session, params)
            )
          ),
      }
    })
  }
}
