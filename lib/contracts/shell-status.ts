import { z } from "zod"

import { connectionSummarySchema } from "./connections"
import { notificationListResponseSchema } from "./operational-notifications"
import { reviewCountsSchema } from "./reviews"

/**
 * GET `/api/shell-status`: what the app shell's badges poll, in one request.
 *
 * Each part is exactly what its own route answers — the organisation-wide
 * `/api/reviews/counts`, `/api/google/connections` and the unread page of
 * `/api/notifications` — so the client seeds those caches from it
 * (lib/queries/use-shell-status.ts) and every reader keeps its own key.
 */
export const shellStatusResponseSchema = z.object({
  counts: reviewCountsSchema,
  connections: z.array(connectionSummarySchema),
  notifications: notificationListResponseSchema,
})
export type ShellStatusResponse = z.infer<typeof shellStatusResponseSchema>
