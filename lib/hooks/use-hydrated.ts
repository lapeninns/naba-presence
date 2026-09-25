"use client"

import { useSyncExternalStore } from "react"

const subscribeNever = () => () => {}

/**
 * False in the server render and in the first client render (hydration), true
 * from then on. Use it to hold back values the server and the browser can
 * see differently, so the hydrated markup matches the server's exactly and
 * the real value lands one render later.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  )
}
