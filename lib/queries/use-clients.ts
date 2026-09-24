"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  assignLocationsToClient,
  attachClientConnection,
  createClient,
  fetchClient,
  fetchClients,
  fetchClientSetup,
  unassignLocationsFromClient,
  updateClient,
} from "@/lib/api/clients"
import { summariseHealth, type ClientHealth } from "@/lib/clients/health"
import { queryKeys } from "@/lib/queries/keys"

/** Every client the signed-in user can see, with counts and health. */
export function useClients({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.clients,
    queryFn: ({ signal }) => fetchClients(signal),
    enabled,
    // The shell reads this for its health chip, so it has to notice a client's
    // connection breaking without the operator reloading. A minute is short
    // enough to matter and long enough not to be chatter.
    refetchInterval: 60_000,
  })
}

export function useClient(clientId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.client(clientId ?? "none"),
    queryFn: ({ signal }) => fetchClient(clientId!, signal),
    enabled: Boolean(clientId),
  })
}

export function useClientSetup(clientId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.clientSetup(clientId ?? "none"),
    queryFn: ({ signal }) => fetchClientSetup(clientId!, signal),
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
export function useOrgHealth() {
  const clients = useClients()
  const summary = summariseHealth(
    clients.data?.items.map((client) => client.health) ?? []
  )
  return { ...summary, isPending: clients.isPending }
}

export function useClientMutations() {
  const queryClient = useQueryClient()
  // Client membership changes what the inbox, the reports and the location
  // directory show, so every mutation clears those too rather than trying to
  // predict which filters are live.
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll })
    void queryClient.invalidateQueries({ queryKey: queryKeys.locations })
    void queryClient.invalidateQueries({ queryKey: queryKeys.reviewsAll })
    void queryClient.invalidateQueries({ queryKey: queryKeys.reviewCountsAll })
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
