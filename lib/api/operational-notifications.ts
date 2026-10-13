import type { notificationPreferencesUpdateSchema } from "@/lib/contracts/operational-notifications"
import type { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"

// Schemas load on demand (see `ResponseSchema` in ./client): the bell in the
// app bar reads unread notifications on every page, and the contract pulls
// in zod.
const contract = () => import("@/lib/contracts/operational-notifications")

export type NotificationFilter = "all" | "unread" | "open"

export function fetchNotifications(filter: NotificationFilter, cursor?: string, options?: RequestOptions) {
  const query = new URLSearchParams({ filter })
  if (cursor) query.set("cursor", cursor)
  return apiFetch(`/api/notifications?${query}`, { schema: () => contract().then((m) => m.notificationListResponseSchema), ...options })
}
export const markNotificationsRead = (incidentIds: string[], read = true) =>
  apiFetch("/api/notifications/read", { method: "POST", body: { incidentIds, read }, schema: () => contract().then((m) => m.notificationsReadResponseSchema) })
export const resolveNotification = (incidentId: string) =>
  apiFetch(`/api/notifications/${incidentId}/resolve`, { method: "POST", body: {}, schema: () => contract().then((m) => m.notificationResolvedResponseSchema) })
export const fetchNotificationPreferences = (options?: RequestOptions) =>
  apiFetch("/api/notifications/preferences", { schema: () => contract().then((m) => m.notificationPreferencesResponseSchema), ...options })
export const updateNotificationPreferences = (changes: z.infer<typeof notificationPreferencesUpdateSchema>["changes"]) =>
  apiFetch("/api/notifications/preferences", { method: "PUT", body: { changes }, schema: () => contract().then((m) => m.notificationPreferencesResponseSchema) })
