"use client"

import { useSyncExternalStore } from "react"

const subscribeNever = () => () => {}

/** The viewer's own zone; null on the server and during hydration. */
export function useViewerTimeZone(): string | null {
  return useSyncExternalStore(
    subscribeNever,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null
  )
}
