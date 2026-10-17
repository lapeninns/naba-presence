/**
 * FROZEN COPY of lib/contracts/operational-notifications.ts and the
 * shell-status contract as they were on main 3f335f82, the build before the
 * approval notification kinds (0149). A browser still running that build
 * during a deployment checks every answer against exactly these schemas
 * (strict kind enums), so tests/notification-client-compat.test.ts and the
 * route tests parse what the server sends an older client with them.
 * Never edit this file to make a test pass; add a new frozen copy for a new
 * baseline instead.
 */
/**
 * Wire contract for the in-app operational notifications
 * (`/api/notifications/**`). Client-safe. Separate from
 * `lib/contracts/notifications.ts`, which configures Google's Pub/Sub feed.
 */
import { z } from "zod"

// Unchanged by #214; only the notification part of shell-status is frozen.
import { connectionSummarySchema } from "@/lib/contracts/connections"
import { reviewCountsSchema } from "@/lib/contracts/reviews"

// Frozen from lib/domain/notification-preferences.ts on main 3f335f82: the
// kinds a browser on that build knows. Never update this list.
const NOTIFICATION_CHANNELS = ["in_app", "email"] as const
const NOTIFICATION_EVENT_KINDS = [
  "connection_reconnect",
  "listing_access_lost",
  "connection_owner_left",
  "listing_stale",
  "low_rating_review",
  "publication_failed",
  "publication_unresolved",
  "mutation_unconfirmed",
  "schedule_missed",
  "schedule_blocked",
  "bulk_completed_with_failures",
  "verification_changed",
  "suggestions_available",
  "resource_stale",
  "ai_credits_low",
  "ai_credits_exhausted",
] as const

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

/** POST `/api/notifications/read`: how many incidents changed. */
export const notificationsReadResponseSchema = z.object({ updated: z.number() })

/** POST `/api/notifications/{id}/resolve`. */
export const notificationResolvedResponseSchema = z.object({
  resolved: z.boolean(),
})


// lib/contracts/shell-status.ts on main 3f335f82, with the frozen list.
export const shellStatusResponseSchema = z.object({
  counts: reviewCountsSchema,
  connections: z.array(connectionSummarySchema),
  notifications: notificationListResponseSchema,
})
