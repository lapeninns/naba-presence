"use client"

import { useSyncExternalStore } from "react"

/**
 * Whether a media query matches, kept in sync with the viewport.
 *
 * The server and any environment without matchMedia (jsdom, a bare test
 * double) read `serverDefault`, so the first paint on a phone draws the wide
 * layout for a frame and corrects itself once the client knows its width —
 * the same trade the inbox's desktop-layout hook already makes.
 */
export function useMediaQuery(query: string, serverDefault = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (
        typeof window === "undefined" ||
        typeof window.matchMedia !== "function"
      ) {
        return () => {}
      }
      const list = window.matchMedia(query)
      if (typeof list?.addEventListener !== "function") return () => {}
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    () => {
      if (
        typeof window === "undefined" ||
        typeof window.matchMedia !== "function"
      ) {
        return serverDefault
      }
      const list = window.matchMedia(query)
      return list ? Boolean(list.matches) : serverDefault
    },
    () => serverDefault
  )
}
