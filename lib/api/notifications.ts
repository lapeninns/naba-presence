import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"
import { GOOGLE_NOTIFICATION_TYPES } from "@/lib/domain/google-contract"

export const notificationSettingSchema = z.object({
  name: z.string(),
  pubsubTopic: z.string().optional(),
  notificationTypes: z.array(z.enum(GOOGLE_NOTIFICATION_TYPES)).optional(),
})

const settingResponseSchema = z.object({ setting: notificationSettingSchema })

export type NotificationSetting = z.infer<typeof notificationSettingSchema>

export function fetchNotificationSetting(accountId: string, options?: RequestOptions) {
  return apiFetch(`/api/google/notifications?account_id=${encodeURIComponent(accountId)}`, {
    schema: settingResponseSchema,
    ...options,
  })
}

export function saveNotificationSetting(input: {
  accountId: string
  pubsubTopic: string
  notificationTypes: string[]
}) {
  return apiFetch("/api/google/notifications", {
    method: "PATCH",
    body: input,
    schema: settingResponseSchema,
  })
}
