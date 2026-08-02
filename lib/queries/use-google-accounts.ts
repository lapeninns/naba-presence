"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchGoogleAccounts, saveActiveAccounts } from "@/lib/api/google-accounts"
import { queryKeys } from "./keys"

export function useGoogleAccounts(connectionId: string | null) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.googleAccounts(connectionId),
    queryFn: () => fetchGoogleAccounts(connectionId),
    staleTime: 30_000,
  })
  const save = useMutation({
    mutationFn: (accountIds: string[]) => saveActiveAccounts(accountIds),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.googleAccounts(connectionId) }),
  })
  return { query, save }
}
