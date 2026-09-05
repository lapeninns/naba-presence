"use client"

import { useSyncExternalStore } from "react"

import { DESKTOP_MEDIA_QUERY } from "@/lib/inbox/url-state"

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {}
  }
  const query = window.matchMedia(DESKTOP_MEDIA_QUERY)
  // A test double may hand back a bare `{ matches }`; nothing to subscribe to.
  if (typeof query?.addEventListener !== "function") return () => {}
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true
  }
  return Boolean(window.matchMedia(DESKTOP_MEDIA_QUERY)?.matches)
}

// The server cannot know the viewport. It assumes the desktop workspace,
// which is what the CSS breakpoints already paint for a phone (the inspector
// column is `hidden lg:flex`), so a narrow screen sees the list first and the
// detail sheet slides up once the client knows its width.
function getServerSnapshot(): boolean {
  return true
}

/**
 * Whether the inbox is wide enough for the three-column workspace. Below the
 * `lg` breakpoint the review detail is a bottom sheet over the list rather
 * than an inspector column beside it.
 */
export function useDesktopLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
