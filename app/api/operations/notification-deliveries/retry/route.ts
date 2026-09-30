import { retryNotificationDeliveries } from "@/lib/server/notifications/retry"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/** Guarded requeue of failed notification email; see retryableDelivery. */
export const POST = route({
  roles: ["owner", "admin"],
  handler: async ({ session, requestId }) => retryNotificationDeliveries(session, requestId),
})
