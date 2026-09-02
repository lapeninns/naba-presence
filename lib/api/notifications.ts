import { apiFetch, type RequestOptions } from "./client"
import {
  notificationSettingResponseSchema,
  type NotificationPatchInput,
} from "@/lib/contracts/notifications"

export {
  notificationSettingSchema,
  type NotificationSetting,
} from "@/lib/contracts/notifications"

export function fetchNotificationSetting(accountId: string, options?: RequestOptions) {
  return apiFetch(`/api/google/notifications?account_id=${encodeURIComponent(accountId)}`, {
    schema: notificationSettingResponseSchema,
    ...options,
  })
}

// `notificationTypes` is accepted as `string[]` here: the hook widens its
// checkbox state before calling, and the server validates against the
// contract enum.
export function saveNotificationSetting(
  input: Omit<NotificationPatchInput, "notificationTypes"> & { notificationTypes: string[] }
) {
  return apiFetch("/api/google/notifications", {
    method: "PATCH",
    body: input,
    schema: notificationSettingResponseSchema,
  })
}
