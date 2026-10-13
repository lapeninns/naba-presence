"use client"

import {
  HydrationBoundary as TanStackHydrationBoundary,
  type HydrationBoundaryProps,
} from "@tanstack/react-query"
import { useMemo } from "react"

import { ServerNowProvider } from "@/lib/time/server-now"

type DehydratedQueryTimes = {
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
export function alignToClientClock<T>(state: T, now = Date.now()): T {
  if (!state || typeof state !== "object" || !("queries" in state)) return state
  const queries = (state as { queries: DehydratedQueryTimes[] }).queries
  if (!Array.isArray(queries)) return state
  return {
    ...state,
    queries: queries.map((query) => {
      if (typeof query.dehydratedAt !== "number") return query
      const skew = now - query.dehydratedAt
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
 * TanStack's `HydrationBoundary`, hydration-stable under clock skew: the
 * prefetched queries are aligned to the browser's clock (above), and the
 * server's clock is handed down for render-time thresholds (`useNow`).
 * Use it instead of the TanStack export everywhere a page hands
 * prefetched data to the browser.
 */
export function HydrationBoundary({ state, ...props }: HydrationBoundaryProps) {
  const serverNow = useMemo(() => serverNowOf(state), [state])
  const aligned = useMemo(() => alignToClientClock(state), [state])
  return (
    <ServerNowProvider value={serverNow}>
      <TanStackHydrationBoundary state={aligned} {...props} />
    </ServerNowProvider>
  )
}
