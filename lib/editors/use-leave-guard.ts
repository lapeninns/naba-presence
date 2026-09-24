"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * The link a click would follow inside this app, or null when the click is
 * one the guard must leave alone: a modified or non-primary click, a new tab
 * or a download, another origin (beforeunload covers leaving the app), or a
 * link to this same page (an in-page jump such as the profile's section
 * index).
 */
export function guardedHref(event: MouseEvent): {
  anchor: HTMLAnchorElement
  href: string
} | null {
  if (event.defaultPrevented) return null
  if (event.button !== 0) return null
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return null
  const target = event.target
  if (!(target instanceof Element)) return null
  const anchor = target.closest("a")
  if (!anchor || !anchor.hasAttribute("href")) return null
  if (anchor.target && anchor.target !== "_self") return null
  if (anchor.hasAttribute("download")) return null
  let url: URL
  try {
    url = new URL(anchor.href, window.location.href)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  if (
    url.pathname === window.location.pathname &&
    url.search === window.location.search
  )
    return null
  return { anchor, href: url.pathname + url.search + url.hash }
}

export type LeavePrompt = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

/**
 * Ask before an in-app link throws unsaved edits away.
 *
 * `beforeunload` only covers a reload or a closed tab; a click on the
 * sidebar, a breadcrumb or another area tab is a client-side navigation that
 * unmounts the editor without asking. While `when` is true this listens for
 * link clicks in the capture phase (before Next's <Link> handler sees them),
 * holds the navigation and opens the prompt. Confirming calls `onLeave` (the
 * editor marks its drafts as discarded) and clicks the same link again, so
 * the navigation is exactly the one the operator asked for — prefetching,
 * scroll and transitions included — with no router instance needed here.
 *
 * Spread the result into a `<DiscardDialog />`.
 */
export function useLeaveGuard({
  when,
  onLeave,
}: {
  when: boolean
  onLeave?: () => void
}): LeavePrompt {
  const [pending, setPending] = useState<{
    anchor: HTMLAnchorElement
    href: string
  } | null>(null)
  const bypass = useRef(false)
  const latestOnLeave = useRef(onLeave)
  useEffect(() => {
    latestOnLeave.current = onLeave
  })

  useEffect(() => {
    if (!when) return
    const handler = (event: MouseEvent) => {
      if (bypass.current) return
      const link = guardedHref(event)
      if (!link) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setPending(link)
    }
    document.addEventListener("click", handler, true)
    return () => document.removeEventListener("click", handler, true)
  }, [when])

  const onOpenChange = useCallback((open: boolean) => {
    if (!open) setPending(null)
  }, [])

  const onConfirm = useCallback(() => {
    if (!pending) return
    latestOnLeave.current?.()
    const { anchor, href } = pending
    if (anchor.isConnected) {
      bypass.current = true
      try {
        anchor.click()
      } finally {
        bypass.current = false
      }
    } else {
      window.location.assign(href)
    }
  }, [pending])

  return { open: pending !== null, onOpenChange, onConfirm }
}
