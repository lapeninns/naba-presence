"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchNotificationSetting, saveNotificationSetting } from "@/lib/api/notifications"
import { queryKeys } from "./keys"

export function useNotificationSetting(accountId: string | null) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.notificationSetting(accountId),
    queryFn: () => fetchNotificationSetting(accountId as string),
    enabled: accountId !== null,
    staleTime: 30_000,
  })
  const save = useMutation({
    mutationFn: (input: { accountId: string; pubsubTopic: string; notificationTypes: string[] }) =>
      saveNotificationSetting(input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.notificationSetting(accountId) }),
  })
  return { query, save }
}
