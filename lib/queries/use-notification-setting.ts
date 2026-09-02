"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchNotificationSetting, saveNotificationSetting } from "@/lib/api/notifications"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useNotificationSetting(accountId: string | null) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.notificationSetting(accountId),
    queryFn: (ctx) => fetchNotificationSetting(accountId as string, requestOptions(ctx)),
    enabled: accountId !== null,
  })
  const save = useMutation({
    mutationFn: (input: { accountId: string; pubsubTopic: string; notificationTypes: string[] }) =>
      saveNotificationSetting(input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.notificationSetting(accountId) }),
  })
  return { query, save }
}
