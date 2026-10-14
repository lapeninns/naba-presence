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

const HOUR_MS = 3_600_000

function readHour(): number {
  return Math.floor(readClock() / HOUR_MS)
}

/**
 * `useNow`, to the hour: the start of the current hour in milliseconds. The
 * shared tick still runs every 15 s, but the snapshot only changes on the
 * hour, so React re-renders a caller once an hour rather than four times a
 * minute. For a view that only needs the hour (the inbox's age presets),
 * where re-rendering the whole tree with every tick was the cost.
 */
function useNowHour(): number {
  const serverNow = useContext(ServerNowContext)
  const hour = useSyncExternalStore(subscribeClock, readHour, () =>
    Math.floor((serverNow ?? readClock()) / HOUR_MS)
  )
  return hour * HOUR_MS
}

export { ServerNowProvider, useNow, useNowHour }
