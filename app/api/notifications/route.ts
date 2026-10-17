import { requestHasCapability } from "@/lib/contracts/client-capabilities"
import { notificationListQuerySchema } from "@/lib/contracts/operational-notifications"
import { listNotifications } from "@/lib/server/notifications/inbox"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * This viewer's operational notifications, newest first, with their own read
 * state. Owners and admins see account incidents; everyone else sees only
 * incidents for locations they can see. RLS keeps other tenants out.
 * `incidents` keeps the earlier response shape for existing callers.
 */
export const GET = route({
  query: notificationListQuerySchema,
  handler: async ({ session, query, request }) => {
    const page = await listNotifications(session, query, {
      addressedKinds: requestHasCapability(request, "notification-kinds-2"),
    })
    return {
      ...page,
      incidents: page.items.map((item) => ({
        id: item.id, kind: item.kind, subjectType: item.subjectType, subjectId: item.subjectId,
        status: item.status, summary: item.summary, openedAt: item.openedAt, resolvedAt: item.resolvedAt,
      })),
    }
  },
})
