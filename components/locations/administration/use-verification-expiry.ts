"use client"

import { useCallback, useSyncExternalStore } from "react"

export function useVerificationExpiry(expiresAt: string) {
  const deadline = new Date(expiresAt).getTime()
  const subscribe = useCallback((notify: () => void) => {
    const timer = setTimeout(notify, Math.min(2_147_483_647, Math.max(0, deadline - Date.now())))
    return () => clearTimeout(timer)
  }, [deadline])
  return useSyncExternalStore(subscribe, () => deadline <= Date.now(), () => true)
}
