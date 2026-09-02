/**
 * Wire contract for `/api/google/notifications`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The route parses
 * the PATCH body with `notificationPatchSchema`; `lib/api/notifications.ts`
 * parses responses with `notificationSettingResponseSchema`.
 */
import { z } from "zod"

import { GOOGLE_NOTIFICATION_TYPES } from "@/lib/domain/google-contract"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** PATCH `/api/google/notifications` body. */
export const notificationPatchSchema = z.object({
  accountId: z.uuid(),
  pubsubTopic: z
    .string()
    .regex(
      /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][\w.-]{2,254}$/
    )
    .or(z.literal("")),
  notificationTypes: z
    .array(z.enum(GOOGLE_NOTIFICATION_TYPES))
    .transform((items) => [...new Set(items)])
    .default([...GOOGLE_NOTIFICATION_TYPES]),
})
export type NotificationPatchInput = z.input<typeof notificationPatchSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const notificationSettingSchema = z.object({
  name: z.string(),
  pubsubTopic: z.string().optional(),
  notificationTypes: z.array(z.enum(GOOGLE_NOTIFICATION_TYPES)).optional(),
})
export type NotificationSetting = z.infer<typeof notificationSettingSchema>

/** GET and PATCH `/api/google/notifications` response. */
export const notificationSettingResponseSchema = z.object({
  setting: notificationSettingSchema,
})
export type NotificationSettingResponse = z.infer<
  typeof notificationSettingResponseSchema
>
