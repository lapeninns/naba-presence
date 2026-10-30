import { requestHasCapability } from "@/lib/contracts/client-capabilities"
import { notificationPreferencesUpdateSchema } from "@/lib/contracts/operational-notifications"
import {
  readNotificationPreferences,
  updateNotificationPreferences,
} from "@/lib/server/notifications/inbox"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/** The signed-in person's own notification choices, separate from Google's notification settings. */
// The approval kinds (0149), and the topic alert and Google change watch
// kinds after them, only to a build that reads them
// (lib/contracts/client-capabilities.ts).
const reads = (request: Request) => ({
  addressedKinds: requestHasCapability(request, "notification-kinds-2"),
  kinds3: requestHasCapability(request, "notification-kinds-3"),
})

export const GET = route({
  handler: async ({ session, request }) =>
    readNotificationPreferences(session, reads(request)),
})
export const PUT = route({
  entitlement: "exempt",
  body: notificationPreferencesUpdateSchema,
  handler: async ({ session, body, requestId, request }) =>
    updateNotificationPreferences(session, body, requestId, reads(request)),
})
