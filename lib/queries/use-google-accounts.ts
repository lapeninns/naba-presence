"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchGoogleAccounts, saveActiveAccounts } from "@/lib/api/google-accounts"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

/**
 * `clientId` scopes a save to that client's logins (setup); without it a save
 * is scoped to `connectionId` alone.
 */
export function useGoogleAccounts(
  connectionId: string | null,
  options: { clientId?: string } = {}
) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.googleAccounts(connectionId),
    queryFn: (ctx) => fetchGoogleAccounts(connectionId, requestOptions(ctx)),
  })
  const save = useMutation({
    mutationFn: (accountIds: string[]) =>
      saveActiveAccounts(accountIds, {
        clientId: options.clientId,
        connectionId: connectionId ?? undefined,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.googleAccounts(connectionId) })
      if (options.clientId) {
        void client.invalidateQueries({ queryKey: queryKeys.clientSetup(options.clientId) })
      }
    },
  })
  return { query, save }
}
