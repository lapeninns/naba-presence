"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  assignLocationsToClient,
  attachClientConnection,
  createClient,
  fetchArchivedClients,
  fetchClient,
  fetchClients,
  fetchClientSetup,
  unassignLocationsFromClient,
  updateClient,
} from "@/lib/api/clients"
import { summariseHealth, type ClientHealth } from "@/lib/clients/health"
import { invalidateReviewBatch } from "@/lib/queries/invalidate"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"

/** Every client the signed-in user can see, with counts and health. */
export function useClients({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.clients,
    queryFn: (ctx) => fetchClients(requestOptions(ctx)),
    enabled,
    // The shell reads this for its health chip, so it has to notice a client's
    // connection breaking without the operator reloading. A minute is short
    // enough to matter and long enough not to be chatter.
    refetchInterval: 60_000,
  })
}

/** Archived clients, fetched only while the Archived view is open. */
export function useArchivedClients(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.clientsArchived,
    queryFn: (ctx) => fetchArchivedClients(requestOptions(ctx)),
    enabled,
  })
}

export function useClient(clientId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.client(clientId ?? "none"),
    queryFn: (ctx) => fetchClient(clientId!, requestOptions(ctx)),
    enabled: Boolean(clientId),
  })
}

export function useClientSetup(clientId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.clientSetup(clientId ?? "none"),
    queryFn: (ctx) => fetchClientSetup(clientId!, requestOptions(ctx)),
    enabled: Boolean(clientId),
  })
}

/**
 * One client's health, for the shell chip and the hub header.
 *
 * Reads the list rather than fetching per client: the shell already needs the
 * list for its navigation, so a per-client request would be a second round
 * trip for a value that is already in the cache.
 */
export function useClientHealth(clientId: string | null | undefined): {
  health: ClientHealth | null
  isPending: boolean
} {
  const clients = useClients()
  const found = clients.data?.items.find((client) => client.id === clientId)
  return { health: found?.health ?? null, isPending: clients.isPending }
}

/**
 * The org-wide roll-up for pages that belong to no single client. Counts
 * rather than a worst-case word, because "2 clients need attention" tells an
 * agency where to go and "attention" does not.
 */
export function useOrgHealth(mode: "agency" | "business" = "agency") {
  const clients = useClients()
  const summary = summariseHealth(
    clients.data?.items.map((client) => client.health) ?? [],
    mode
  )
  return { ...summary, isPending: clients.isPending }
}

export function useClientMutations() {
  const queryClient = useQueryClient()
  // Client membership changes what the inbox, the reports and the location
  // directory show, so every mutation clears those too rather than trying to
  // predict which filters are live.
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.locations })
    // Lists, counts and the clients themselves.
    invalidateReviewBatch(queryClient)
  }

  return {
    create: useMutation({
      mutationFn: createClient,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (input: { clientId: string } & Parameters<typeof updateClient>[1]) =>
        updateClient(input.clientId, input),
      onSuccess: invalidate,
    }),
    assignLocations: useMutation({
      mutationFn: (input: {
        clientId: string
        locationIds: string[]
        grantToClientMembers?: boolean
      }) =>
        assignLocationsToClient(input.clientId, {
          locationIds: input.locationIds,
          grantToClientMembers: input.grantToClientMembers ?? true,
        }),
      onSuccess: invalidate,
    }),
    attachConnection: useMutation({
      mutationFn: (input: { clientId: string; connectionId: string }) =>
        attachClientConnection(input.clientId, {
          connectionId: input.connectionId,
        }),
      onSuccess: (response, input) => {
        // The wizard decides where it is from this query, so it has to hold
        // the new state before the step changes, not after a refetch.
        queryClient.setQueryData(queryKeys.clientSetup(input.clientId), response)
        invalidate()
      },
    }),
    unassignLocations: useMutation({
      mutationFn: (input: { clientId: string; locationIds: string[] }) =>
        unassignLocationsFromClient(input.clientId, input.locationIds),
      onSuccess: invalidate,
    }),
  }
}
