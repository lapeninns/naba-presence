"use client"

import {
  HydrationBoundary as TanStackHydrationBoundary,
  type HydrationBoundaryProps,
  type QueryClient,
  useQueryClient,
} from "@tanstack/react-query"
import { useMemo } from "react"

import { ServerNowProvider } from "@/lib/time/server-now"

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
 * TanStack's `HydrationBoundary`, hydration-stable under clock skew: the
 * prefetched queries are aligned to the browser's clock (above), and the
 * server's clock is handed down for render-time thresholds (`useNow`).
 * Use it instead of the TanStack export everywhere a page hands
 * prefetched data to the browser.
 */
export function HydrationBoundary({ state, ...props }: HydrationBoundaryProps) {
  const client = useQueryClient(props.queryClient)
  const serverNow = useMemo(() => serverNowOf(state), [state])
  const aligned = useMemo(() => alignForCache(state, client), [state, client])
  return (
    <ServerNowProvider value={serverNow}>
      <TanStackHydrationBoundary state={aligned} {...props} />
    </ServerNowProvider>
  )
}
