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

// The server cannot know the viewport. It assumes the two-pane workspace;
// a phone sees the list first and swaps to the review once the client knows
// its width.
function getServerSnapshot(): boolean {
  return true
}

/**
 * Whether the inbox is wide enough for the queue and the review side by side
 * (768px and up). Below it the two take turns: the review replaces the list.
 */
export function useDesktopLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
