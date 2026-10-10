/**
 * Wire contract for the in-app operational notifications
 * (`/api/notifications/**`). Client-safe. Separate from
 * `lib/contracts/notifications.ts`, which configures Google's Pub/Sub feed.
 */
import { z } from "zod"

import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_KINDS,
} from "@/lib/domain/notification-preferences"

export const notificationEventKindSchema = z.enum(NOTIFICATION_EVENT_KINDS)

export const notificationItemSchema = z.object({
  id: z.uuid(),
  kind: notificationEventKindSchema,
  subjectType: z.string(),
  subjectId: z.string(),
  locationId: z.uuid().nullable(),
  locationName: z.string().nullable(),
  status: z.enum(["open", "resolved"]),
  reason: z.string().nullable(),
  summary: z.record(z.string(), z.unknown()),
  openedAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  /** This viewer's read state; reading never resolves the incident. */
  readAt: z.iso.datetime().nullable(),
  /** Whether this viewer may mark it resolved (event incidents, managers only). */
  canResolve: z.boolean(),
})
export type NotificationItem = z.infer<typeof notificationItemSchema>

export const notificationListQuerySchema = z.strictObject({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  filter: z.enum(["all", "unread", "open"]).default("all"),
})
export const notificationListResponseSchema = z.object({
  items: z.array(notificationItemSchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int().nonnegative(),
})
export type NotificationListResponse = z.infer<
  typeof notificationListResponseSchema
>

export const notificationReadRequestSchema = z.strictObject({
  incidentIds: z.array(z.uuid()).min(1).max(100),
  read: z.boolean().default(true),
})

export const notificationPreferenceSchema = z.object({
  kind: notificationEventKindSchema,
  channel: z.enum(NOTIFICATION_CHANNELS),
  mode: z.enum(["immediate", "digest", "off"]),
  /** False when the value is the default rather than a saved choice. */
  explicit: z.boolean(),
})
export const notificationPreferencesResponseSchema = z.object({
  preferences: z.array(notificationPreferenceSchema),
  emailConfigured: z.boolean(),
})
export type NotificationPreferencesResponse = z.infer<
  typeof notificationPreferencesResponseSchema
>
export const notificationPreferencesUpdateSchema = z.strictObject({
  changes: z
    .array(
      z
        .strictObject({
          kind: notificationEventKindSchema,
          channel: z.enum(NOTIFICATION_CHANNELS),
          mode: z.enum(["immediate", "digest", "off"]),
        })
        .refine(
          (change) => change.channel === "email" || change.mode !== "digest",
          "In-app notifications are immediate or off."
        )
    )
    .min(1)
    .max(40),
})
