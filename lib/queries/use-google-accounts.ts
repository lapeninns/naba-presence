"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchGoogleAccounts, saveActiveAccounts } from "@/lib/api/google-accounts"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

/**
 * Discovery is not a cheap read: each fetch pages every Google account (or
 * every location of every active account) and rewrites the stored rows
 * (W3-01). So it runs on first view and when something asks for it — a
 * save invalidates it, Retry refetches — never on a focus return or a
 * retry of its own, and the server bounds it (`google_discovery` abuse
 * limit).
 */
export const DISCOVERY_READ = {
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  retry: 0,
} as const

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
    ...DISCOVERY_READ,
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
