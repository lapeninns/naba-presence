"use client"

import { useQuery, type QueryClient } from "@tanstack/react-query"

import { fetchShellStatus } from "@/lib/api/shell-status"
import type { ConnectionsResponse } from "@/lib/contracts/connections"
import type { ShellStatusResponse } from "@/lib/contracts/shell-status"
import { queryKeys } from "./keys"

/**
 * How often the shell re-reads its badges and connections. One request per
 * tick, where four keys used to poll once a minute each (R2-X1 multiplier
 * M4, W5-07): an idle visible tab now makes about 8 requests in 10 minutes
 * (this, plus the clients list every `CLIENTS_POLL_MS`) instead of 40.
 */
export const SHELL_POLL_MS = 90_000

/**
 * The clients list is the heaviest read in the shell (a summary per
 * location), so it polls slowly. A connection breaking — what its health
 * chip most needs to notice — refreshes it at once (see `seedShellKeys`).
 */
export const CLIENTS_POLL_MS = 5 * 60_000

/**
 * Options for a shell reader of a key this poll seeds: it does not poll or
 * refetch on focus itself, and data the poll wrote counts as fresh until
 * the next tick. Its own queryFn still runs for a first load and whenever
 * the key is invalidated (a review write, marking notifications read).
 */
export const SEEDED_BY_SHELL = {
  staleTime: SHELL_POLL_MS,
  refetchOnWindowFocus: false,
} as const

function connectionsSignature(data: ConnectionsResponse | undefined) {
  return JSON.stringify(
    (data?.connections ?? [])
      .map((c) => [c.id, c.status, c.reconnectRequired])
      .sort()
  )
}

/** Write each part into the key its own route's readers use. */
export function seedShellKeys(
  client: QueryClient,
  status: ShellStatusResponse
) {
  const previous = client.getQueryData<ConnectionsResponse>(
    queryKeys.connections
  )
  const connections = { connections: status.connections }
  client.setQueryData(queryKeys.reviewCounts("organisation"), status.counts)
  client.setQueryData(queryKeys.connections, connections)
  client.setQueryData(queryKeys.notifications("badge"), status.notifications)
  if (
    previous &&
    connectionsSignature(previous) !== connectionsSignature(connections)
  ) {
    void client.invalidateQueries({ queryKey: queryKeys.clientsAll })
  }
}

/**
 * The shell's one poll. Mounted once, by the app shell. Like every interval
 * here it pauses while the tab is hidden; returning to the tab refetches it
 * once if it is stale.
 *
 * Nothing reads its data: it only seeds. It starts empty and fresh, so the
 * first read is the first tick rather than a mount-time duplicate of the
 * badges' own first loads.
 */
export function useShellStatus(enabled = true) {
  return useQuery<ShellStatusResponse | null>({
    enabled,
    queryKey: queryKeys.shellStatus,
    queryFn: async ({ client, signal }) => {
      // A badge is not worth a sign-in redirect: always background.
      const status = await fetchShellStatus({ signal, background: true })
      seedShellKeys(client, status)
      return status
    },
    initialData: null,
    staleTime: SHELL_POLL_MS,
    refetchInterval: SHELL_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  })
}
