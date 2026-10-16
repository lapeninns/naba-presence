"use client"

import {
  HydrationBoundary as TanStackHydrationBoundary,
  type HydrationBoundaryProps,
  type QueryClient,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useMemo } from "react"

import type { SessionResponse } from "@/lib/contracts/session"
import { ServerNowProvider } from "@/lib/time/server-now"

import { queryKeys } from "./keys"
import { sessionScopeToken } from "./session-scope"

type DehydratedQueryTimes = {
  queryHash?: string
  dehydratedAt?: number
  state: { dataUpdatedAt: number; errorUpdatedAt: number }
}

/**
 * Prefetched queries with their timestamps moved onto this browser's clock.
 *
 * The server stamps each dehydrated query with its own clock. A device
 * clock a minute ahead then found the data already past `staleTime` on the
 * very first render: TanStack's optimistic result said "fetching" and the
 * list rendered busy where the server had rendered it idle, and React
 * rejected the page (#418, GF-7). Shifting every timestamp by
 * (browser now - the query's `dehydratedAt`) keeps each query exactly as old
 * as it was when the server sent it, whatever the skew.
 */
export function alignToClientClock<T>(
  state: T,
  now = Date.now(),
  skewOf: (query: DehydratedQueryTimes, skew: number) => number = (
    _query,
    skew
  ) => skew
): T {
  if (!state || typeof state !== "object" || !("queries" in state)) return state
  const queries = (state as { queries: DehydratedQueryTimes[] }).queries
  if (!Array.isArray(queries)) return state
  return {
    ...state,
    queries: queries.map((query) => {
      if (typeof query.dehydratedAt !== "number") return query
      const skew = skewOf(query, now - query.dehydratedAt)
      const shift = (at: number) => (at > 0 ? at + skew : at)
      return {
        ...query,
        dehydratedAt: query.dehydratedAt + skew,
        state: {
          ...query.state,
          dataUpdatedAt: shift(query.state.dataUpdatedAt),
          errorUpdatedAt: shift(query.state.errorUpdatedAt),
        },
      }
    }),
  }
}

/** When the server dehydrated this state, by its own clock. */
export function serverNowOf(state: unknown): number | null {
  if (!state || typeof state !== "object" || !("queries" in state)) return null
  const queries = (state as { queries: DehydratedQueryTimes[] }).queries
  if (!Array.isArray(queries)) return null
  let latest: number | null = null
  for (const query of queries)
    if (typeof query.dehydratedAt === "number")
      latest = Math.max(latest ?? 0, query.dehydratedAt)
  return latest
}

/**
 * The earliest `dehydratedAt` this page load has been handed, by the
 * server's clock. Per page load, not per cache: a QueryClient made later
 * (the dashboard layout remounted by a soft navigation) would otherwise
 * start from a much later render and loosen the bound below by the whole
 * time since the page loaded. Browser only; on the server it would be
 * shared by every request.
 */
type PageClock = { first: number }
const browserPage: PageClock = { first: Number.POSITIVE_INFINITY }

/**
 * `alignToClientClock` for a payload arriving in `client`'s cache.
 *
 * A query the cache doesn't hold yet is aligned by this payload's own skew,
 * as above: that is the first-render case. One it already holds is a
 * refresh, and TanStack replaces the cached data only when the payload's
 * `dataUpdatedAt` is newer. Dated by arrival, a snapshot read before a save
 * but delivered after the save's own refetch looked newer and put the old
 * value back (#195).
 *
 * So a held query is dated by a lower bound on the clocks' offset instead:
 * the first server render this page load received came after its
 * navigation started, so (navigation start - its `dehydratedAt`) is never more than the
 * offset. Dated that way a snapshot is never later than the moment it was
 * read on the server, and anything the browser fetched after that read
 * keeps its place. A refresh read within the first page's own load time of
 * a browser fetch can lose to it; the browser's copy is that recent anyway.
 */
export function alignForCache<T>(
  state: T,
  client: QueryClient,
  {
    now = Date.now(),
    navigationStart = globalThis.performance?.timeOrigin,
    page = typeof window === "undefined"
      ? { first: Number.POSITIVE_INFINITY }
      : browserPage,
  }: { now?: number; navigationStart?: number; page?: PageClock } = {}
): T {
  if (!state || typeof state !== "object" || !("queries" in state)) return state
  const queries = (state as { queries: DehydratedQueryTimes[] }).queries
  if (!Array.isArray(queries)) return state
  for (const query of queries)
    if (typeof query.dehydratedAt === "number")
      page.first = Math.min(page.first, query.dehydratedAt)
  const first = page.first
  const cache = client.getQueryCache()
  return alignToClientClock(state, now, (query, skew) =>
    navigationStart !== undefined &&
    query.queryHash !== undefined &&
    cache.get(query.queryHash)?.state.dataUpdatedAt
      ? Math.min(skew, navigationStart - first)
      : skew
  )
}

/**
 * `state` if it may be hydrated into `client`, otherwise nothing.
 *
 * `prefetch` (lib/server/prefetch.ts) stamps each payload with the scope it
 * was read under: who, in which organisation, with which role and grants.
 * Next can hand an old payload back without running the page again (Back
 * restores it from the router cache), so an admin's Team payload could
 * reach the same browser after a downgrade to viewer, once useScopeReset
 * had emptied the cache, and be shown with no request to check the role
 * (#195). A stamped payload is hydrated only into a cache whose session has
 * exactly that scope; otherwise the page's hooks fetch, and the server
 * answers for the session as it is now. A payload without a stamp (the
 * dashboard layout's, which carries the session itself) is left as it is.
 */
export function inLiveScope<T>(state: T, client: QueryClient): T | undefined {
  if (!state || typeof state !== "object" || !("scope" in state)) return state
  const live = sessionScopeToken(
    client.getQueryData<SessionResponse>(queryKeys.session)?.session
  )
  return live !== "" && live === state.scope ? state : undefined
}

/**
 * Each payload aligned once per page load, by the clock when it first
 * arrived. Back and Forward mount the same payload again from the router
 * cache; aligned anew it would look as fresh as the moment of the Back.
 * It would then win over (or, once the query was dropped, stand in for)
 * anything saved since. And once the dashboard has been left and entered
 * again, the layout's old session would look freshly fetched in the new
 * cache, so no refetch would tell the shell its scope had changed. Kept as
 * first aligned, both look as old as they are and are fetched again.
 * Browser only: on the server every request's payload is new.
 */
const alignedPayloads = new WeakMap<object, unknown>()

function alignOnce<T>(state: T, client: QueryClient): T {
  if (!state || typeof state !== "object" || typeof window === "undefined")
    return alignForCache(state, client)
  if (alignedPayloads.has(state)) return alignedPayloads.get(state) as T
  const aligned = alignForCache(state, client)
  alignedPayloads.set(state, aligned)
  return aligned
}

/**
 * TanStack's `HydrationBoundary`, hydration-stable under clock skew: the
 * prefetched queries are aligned to the browser's clock (above), and the
 * server's clock is handed down for render-time thresholds (`useNow`). A
 * payload read for another scope is not hydrated at all (`inLiveScope`).
 * Use it instead of the TanStack export everywhere a page hands
 * prefetched data to the browser.
 */
export function HydrationBoundary({ state, ...props }: HydrationBoundaryProps) {
  const client = useQueryClient(props.queryClient)
  const serverNow = useMemo(() => serverNowOf(state), [state])
  // Checked on every mount (the session may have changed since the payload
  // was last shown); aligned once per payload.
  const scoped = useMemo(() => inLiveScope(state, client), [state, client])
  const aligned = useMemo(
    () => (scoped ? alignOnce(scoped, client) : undefined),
    [scoped, client]
  )
  // A payload for another scope means this cache's session is out of date
  // (or the payload is): ask the server who this is now, which resets the
  // cache if the scope has changed (useScopeReset).
  const refused = Boolean(state) && !scoped
  useEffect(() => {
    if (refused)
      void client
        .invalidateQueries({ queryKey: queryKeys.session })
        .catch(() => undefined)
  }, [refused, client])
  return (
    <ServerNowProvider value={serverNow}>
      <TanStackHydrationBoundary state={aligned} {...props} />
    </ServerNowProvider>
  )
}
