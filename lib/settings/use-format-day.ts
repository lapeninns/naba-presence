"use client"

import { useCallback } from "react"

import { useHydrated } from "@/lib/hooks/use-hydrated"
import { formatDay } from "@/lib/settings/roles"

/**
 * The zone a day is written in while the server renders and the browser
 * hydrates that HTML: the product's default display zone, as RelativeTime's
 * title. Pinned so both sides write the same day whatever the server's
 * clock zone (UTC in production) and the device's.
 */
export const HYDRATION_DAY_ZONE = "Europe/London"

/**
 * `formatDay` for a list the server renders (Team, since P20 prefetches
 * it). A date near midnight is a different day in UTC and in the viewer's
 * zone, and React rejects the page when the server's text and the
 * hydrating browser's differ. So the server render and the hydration
 * render both use `HYDRATION_DAY_ZONE`, and the render straight after
 * hydration uses the viewer's own zone, as the browser always has.
 */
export function useFormatDay(): (iso: string) => string {
  const hydrated = useHydrated()
  return useCallback(
    (iso: string) => formatDay(iso, hydrated ? undefined : HYDRATION_DAY_ZONE),
    [hydrated]
  )
}
