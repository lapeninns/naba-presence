"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchGoogleAccounts, saveActiveAccounts } from "@/lib/api/google-accounts"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useGoogleAccounts(connectionId: string | null) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.googleAccounts(connectionId),
    queryFn: (ctx) => fetchGoogleAccounts(connectionId, requestOptions(ctx)),
  })
  const save = useMutation({
    mutationFn: (accountIds: string[]) => saveActiveAccounts(accountIds),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.googleAccounts(connectionId) }),
  })
  return { query, save }
}
