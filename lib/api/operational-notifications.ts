import {
  notificationListResponseSchema,
  notificationPreferencesResponseSchema,
  type notificationPreferencesUpdateSchema,
} from "@/lib/contracts/operational-notifications"
import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"

export type NotificationFilter = "all" | "unread" | "open"

export function fetchNotifications(filter: NotificationFilter, cursor?: string, options?: RequestOptions) {
  const query = new URLSearchParams({ filter })
  if (cursor) query.set("cursor", cursor)
  return apiFetch(`/api/notifications?${query}`, { schema: notificationListResponseSchema, ...options })
}
export const markNotificationsRead = (incidentIds: string[], read = true) =>
  apiFetch("/api/notifications/read", { method: "POST", body: { incidentIds, read }, schema: z.object({ updated: z.number() }) })
export const resolveNotification = (incidentId: string) =>
  apiFetch(`/api/notifications/${incidentId}/resolve`, { method: "POST", body: {}, schema: z.object({ resolved: z.boolean() }) })
export const fetchNotificationPreferences = (options?: RequestOptions) =>
  apiFetch("/api/notifications/preferences", { schema: notificationPreferencesResponseSchema, ...options })
export const updateNotificationPreferences = (changes: z.infer<typeof notificationPreferencesUpdateSchema>["changes"]) =>
  apiFetch("/api/notifications/preferences", { method: "PUT", body: { changes }, schema: notificationPreferencesResponseSchema })
