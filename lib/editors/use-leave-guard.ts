"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

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
 * What the operator was about to do when the prompt opened: follow a link,
 * go back in the browser's history, or a programmatic navigation
 * (`useGuardedRouter`).
 */
type LeaveRequest =
  | { kind: "link"; anchor: HTMLAnchorElement; href: string }
  | { kind: "back" }
  | { kind: "run"; run: () => void }

type ArmedGuard = {
  /** Open this guard's prompt for a navigation it has to hold. */
  request: (request: LeaveRequest) => void
  /** The operator agreed to leave: forget this guard's edits. */
  leave: () => void
}

// Every mounted guard with unsaved edits, newest last. One prompt is enough
// for a navigation however many editors are dirty: the newest guard asks, and
// agreeing to leave forgets every armed guard's edits.
const armed: ArmedGuard[] = []

// The back-button sentinel. While any guard is armed, the page sits on an
// extra history entry with the same address, marked in its state. The
// browser's back button then lands on the entry beneath it, still this page,
// where the guard can ask before anything unmounts. `sentinelUrl` is the
// address of the sentinel this tab believes is above the current entry.
const SENTINEL = "__npLeaveGuard"
let sentinelUrl: string | null = null
let listening = false

function isSentinel(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>)[SENTINEL] === true
  )
}

function pushSentinel() {
  // No URL argument: the entry keeps this page's address, and Next's patched
  // pushState copies its own router state into it without dispatching a
  // navigation.
  window.history.pushState({ [SENTINEL]: true }, "")
  sentinelUrl = window.location.href
}

function onPopState(event: PopStateEvent) {
  // Forward onto a sentinel (or back onto one from a later page): this page,
  // nothing to hold.
  if (isSentinel(event.state)) return
  if (sentinelUrl === null || window.location.href !== sentinelUrl) return
  // The back button took the page off its sentinel.
  sentinelUrl = null
  const guard = armed.at(-1)
  if (guard) {
    guard.request({ kind: "back" })
  } else {
    // A sentinel left behind once the edits were saved or the editor closed:
    // the operator meant to go back past it, so carry on to the page before.
    window.history.back()
  }
}

function listen() {
  if (listening || typeof window === "undefined") return
  listening = true
  // A reload keeps the history entries but not this module: adopt a sentinel
  // the page was reloaded on.
  if (isSentinel(window.history.state)) sentinelUrl = window.location.href
  window.addEventListener("popstate", onPopState)
}

function arm(guard: ArmedGuard): () => void {
  listen()
  armed.push(guard)
  if (isSentinel(window.history.state)) sentinelUrl = window.location.href
  else pushSentinel()
  // Disarming leaves the sentinel where it is: rewinding history here could
  // race a navigation the editor itself starts after saving. The popstate
  // handler skips a stale sentinel when the operator next goes back.
  return () => {
    const index = armed.indexOf(guard)
    if (index >= 0) armed.splice(index, 1)
  }
}

/**
 * Ask before an in-app navigation throws unsaved edits away.
 *
 * `beforeunload` only covers a reload or a closed tab; a click on the
 * sidebar, a breadcrumb or another area tab is a client-side navigation that
 * unmounts the editor without asking. While `when` is true this:
 *
 *   - listens for link clicks in the capture phase (before Next's <Link>
 *     handler sees them), holds the navigation and opens the prompt.
 *     Confirming clicks the same link again, so the navigation is exactly the
 *     one the operator asked for (prefetching, scroll and transitions
 *     included) with no router instance needed here;
 *   - keeps a sentinel history entry above the page, so the browser's back
 *     button lands on this page again and opens the prompt. Staying puts the
 *     sentinel back; leaving goes back for real;
 *   - holds a programmatic navigation started through `useGuardedRouter`.
 *
 * Confirming calls `onLeave` (the editor marks its drafts as discarded), and
 * the `onLeave` of every other guard armed at the time, before navigating.
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
  const [pending, setPending] = useState<LeaveRequest | null>(null)
  const bypass = useRef(false)
  // Set by `onConfirm`, so the close that follows it doesn't count as Stay.
  const confirmed = useRef(false)
  const latestOnLeave = useRef(onLeave)
  // This guard's entry in `armed` while it is armed.
  const self = useRef<ArmedGuard | null>(null)
  useEffect(() => {
    latestOnLeave.current = onLeave
  })

  useEffect(() => {
    if (!when) return
    const request = (next: LeaveRequest) => {
      confirmed.current = false
      setPending(next)
    }
    const handler = (event: MouseEvent) => {
      if (bypass.current) return
      const link = guardedHref(event)
      if (!link) return
      event.preventDefault()
      event.stopImmediatePropagation()
      request({ kind: "link", ...link })
    }
    document.addEventListener("click", handler, true)
    const guard: ArmedGuard = {
      request,
      leave: () => latestOnLeave.current?.(),
    }
    self.current = guard
    const disarm = arm(guard)
    return () => {
      self.current = null
      document.removeEventListener("click", handler, true)
      disarm()
    }
  }, [when])

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) return
      // Staying after the back button: put the sentinel back, so the next
      // back press asks again.
      if (!confirmed.current && pending?.kind === "back") pushSentinel()
      confirmed.current = false
      setPending(null)
    },
    [pending]
  )

  const onConfirm = useCallback(() => {
    if (!pending) return
    confirmed.current = true
    const guards = [...armed]
    if (!self.current || !guards.includes(self.current))
      latestOnLeave.current?.()
    for (const guard of guards) guard.leave()
    if (pending.kind === "back") {
      window.history.back()
    } else if (pending.kind === "run") {
      pending.run()
    } else {
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
    }
  }, [pending])

  return { open: pending !== null, onOpenChange, onConfirm }
}

/**
 * Hold a navigation the code starts itself (a command palette entry, a
 * workspace switch) behind the leave prompt of whichever editor has unsaved
 * edits, the way `useLeaveGuard` holds a link click. With nothing dirty it
 * navigates at once.
 */
export function guardNavigation(run: () => void) {
  const guard = armed.at(-1)
  if (guard) guard.request({ kind: "run", run })
  else run()
}

/**
 * `useRouter()` whose `push` and `replace` ask first when an editor holds
 * unsaved edits (`guardNavigation`). Use it for programmatic navigation that
 * can leave an editor; a `replace` that only rewrites this page's own query
 * string doesn't need it.
 */
type AppRouter = ReturnType<typeof useRouter>

export function useGuardedRouter(): AppRouter {
  const router = useRouter()
  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<AppRouter["push"]>) =>
        guardNavigation(() => router.push(...args)),
      replace: (...args: Parameters<AppRouter["replace"]>) =>
        guardNavigation(() => router.replace(...args)),
    }),
    [router]
  )
}
