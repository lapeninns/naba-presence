"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useToastManager } from "@/components/ui/toast"
import { disconnectConnection, fetchConnections, startGoogleConnect } from "@/lib/api/connections"
import { describeActionError } from "@/lib/settings/action-errors"
import { queryKeys } from "./keys"

export function useConnectionWorkspace() {
  const client = useQueryClient()
  const toast = useToastManager()
  const query = useQuery({
    queryKey: queryKeys.connections,
    queryFn: fetchConnections,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
  const connect = useMutation({
    mutationFn: startGoogleConnect,
    onSuccess: (result) => {
      // Hand off to Google — the browser leaves the app here.
      window.location.assign(result.authorizationUrl)
    },
    // Surface a failed handshake (503 google_not_configured / 403 permission_denied);
    // the Connect button, ReconnectAlert and OAuthReturn "Try again" all call this bare.
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })
  const disconnect = useMutation({
    mutationFn: (id: string) => disconnectConnection(id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.connections }),
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })
  return { query, connect, disconnect }
}
