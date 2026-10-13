"use client"

import { createContext, useContext, useSyncExternalStore } from "react"

import { readClock, subscribeClock } from "@/lib/time/clock"

/**
 * The server's clock at the moment it rendered this page, carried to the
 * browser with the page's prefetched data (see
 * lib/queries/hydration-boundary.tsx). Null outside a hydrated page.
 */
const ServerNowContext = createContext<number | null>(null)

const ServerNowProvider = ServerNowContext.Provider

/**
 * "Now" for a time threshold or an age decided during render (a check is
 * overdue after an hour, an age filter's hour boundary).
 *
 * On the server and while the browser hydrates that HTML it is the SERVER's
 * clock, so both render the same thing however far the device clock is
 * off (React rejects the page when they differ). Straight after hydration,
 * and in any render that is not hydrating, it is the browser's own clock,
 * kept current by the shared tick.
 */
function useNow(): number {
  const serverNow = useContext(ServerNowContext)
  return useSyncExternalStore(
    subscribeClock,
    readClock,
    () => serverNow ?? readClock()
  )
}

export { ServerNowProvider, useNow }
