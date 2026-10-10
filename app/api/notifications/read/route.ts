import { notificationReadRequestSchema } from "@/lib/contracts/operational-notifications"
import { markNotificationsRead } from "@/lib/server/notifications/inbox"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/** Marks notifications read or unread for this person only; never resolves them. */
export const POST = route({
  body: notificationReadRequestSchema,
  handler: async ({ session, body }) => markNotificationsRead(session, body.incidentIds, body.read),
})
