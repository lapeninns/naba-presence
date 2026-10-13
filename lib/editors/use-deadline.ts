"use client"

import { useCallback, useSyncExternalStore } from "react"

/**
 * Whether a deadline (an ISO instant) has passed, re-rendering the moment it
 * does. Used for review and approval expiry: the clock is one source of
 * truth, a server-reported expiry is the other, and a caller shows whichever
 * came first.
 *
 * With no deadline it is never passed. On the server it is treated as passed,
 * so nothing renders an armed send button before the client has checked.
 */
export function useDeadline(deadlineAt: string | null | undefined): boolean {
  const deadline = deadlineAt ? new Date(deadlineAt).getTime() : Number.POSITIVE_INFINITY
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!Number.isFinite(deadline)) return () => {}
      const timer = setTimeout(
        notify,
        Math.min(2_147_483_647, Math.max(0, deadline - Date.now()))
      )
      return () => clearTimeout(timer)
    },
    [deadline]
  )
  return useSyncExternalStore(
    subscribe,
    () => deadline <= Date.now(),
    () => Number.isFinite(deadline)
  )
}
