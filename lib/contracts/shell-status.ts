import { z } from "zod"

import { outboxCountsSchema } from "@/lib/outbox/contract"

import { connectionSummarySchema } from "./connections"
import { notificationListResponseSchema } from "./operational-notifications"
import { reviewCountsSchema } from "./reviews"

/**
 * GET `/api/shell-status`: what the app shell's badges poll, in one request.
 *
 * Each part is exactly what its own route answers — the organisation-wide
 * `/api/reviews/counts`, `/api/google/connections` and the unread page of
 * `/api/notifications`, plus the unscoped `/api/outbox/counts` for anyone
 * with an Outbox — so the client seeds those caches from it
 * (lib/queries/use-shell-status.ts) and every reader keeps its own key.
 * `outbox` is absent for viewers and when the Outbox read fails.
 */
export const shellStatusResponseSchema = z.object({
  counts: reviewCountsSchema,
  connections: z.array(connectionSummarySchema),
  notifications: notificationListResponseSchema,
  outbox: outboxCountsSchema.optional(),
})
export type ShellStatusResponse = z.infer<typeof shellStatusResponseSchema>
