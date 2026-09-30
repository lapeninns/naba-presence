import { notificationPreferencesUpdateSchema } from "@/lib/contracts/operational-notifications"
import { readNotificationPreferences, updateNotificationPreferences } from "@/lib/server/notifications/inbox"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/** The signed-in person's own notification choices, separate from Google's notification settings. */
export const GET = route({ handler: async ({ session }) => readNotificationPreferences(session) })
export const PUT = route({
  body: notificationPreferencesUpdateSchema,
  handler: async ({ session, body, requestId }) => updateNotificationPreferences(session, body, requestId),
})
