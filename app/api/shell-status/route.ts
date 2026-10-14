import type { ShellStatusResponse } from "@/lib/contracts/shell-status"
import { listConnections } from "@/lib/server/connections"
import { listNotifications } from "@/lib/server/notifications/inbox"
import { readReviewCounts } from "@/lib/server/review-counts"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * The shell's poll (R2-X1 multiplier M4): the needs-reply count, the
 * connections and the unread notifications in one request, where the shell
 * used to poll three routes once a minute each. Read-only; each part is the
 * same read its own route makes for this session.
 */
export const GET = route({
  handler: async ({ session, tenant }): Promise<ShellStatusResponse> => {
    const counts = await tenant((sql) => readReviewCounts(sql, session))
    const connections = await listConnections(session)
    const notifications = await listNotifications(session, {
      filter: "unread",
      limit: 20,
    })
    return { counts, connections, notifications }
  },
})
