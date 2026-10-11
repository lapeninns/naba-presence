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
// extra history entry with the same address. The browser's back button then
// lands on the entry beneath it, still this page, where the guard can ask
// before anything unmounts.
//
// Both entries carry the same id in their history state: the sentinel under
// SENTINEL, the entry beneath it (its base) under BASE. A step back is "off
// the sentinel" only when it goes from a sentinel straight onto its own base,
// so a later visit to the same address, a sentinel replaced by a navigation
// or a forward step is never mistaken for one. `sentinelId` is the sentinel
// the armed guards stand on; `lastState` is the state of the entry the tab
// was on before the latest history step.
const SENTINEL = "__npLeaveGuard"
const BASE = "__npLeaveBase"
let sentinelId: string | null = null
let lastState: unknown = null
// A back press the prompt is holding: the page sits on the base entry until
// the operator stays (the sentinel goes back) or leaves.
let holding = false
let listening = false
let restoreHistory: (() => void) | null = null

function marker(state: unknown, key: string): string | null {
  if (typeof state !== "object" || state === null) return null
  const value = (state as Record<string, unknown>)[key]
  return typeof value === "string" ? value : null
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function pushSentinel() {
  // Reuse the id of the base the page already stands on (staying after a
  // back press); otherwise mark this entry as the base of a new sentinel.
  let id = marker(window.history.state, BASE)
  if (id === null) {
    id = newId()
    const state = window.history.state as Record<string, unknown> | null
    window.history.replaceState({ ...state, [BASE]: id }, "")
  }
  // No URL argument: the entry keeps this page's address, and Next's patched
  // pushState copies its own router state into it without dispatching a
  // navigation.
  window.history.pushState({ [SENTINEL]: id }, "")
  sentinelId = id
}

function sameAddress(url: string | URL | null | undefined): boolean {
  if (url === null || url === undefined) return true
  try {
    return new URL(url, window.location.href).href === window.location.href
  } catch {
    return false
  }
}

/**
 * Keep the markers on an entry that is rewritten in place. Next replaces the
 * current entry's state with only its own router state on `router.refresh()`,
 * on a `router.replace()` to the same address and when it renders a back
 * navigation; without this the sentinel would stop being one while the page
 * still stands on it.
 */
function keepMarkers(data: unknown, url: string | URL | null | undefined) {
  const current = window.history.state
  const sentinel = marker(current, SENTINEL)
  const base = marker(current, BASE)
  if (sentinel === null && base === null) return data
  if (data !== null && data !== undefined && typeof data !== "object")
    return data
  if (!sameAddress(url)) return data
  const next = { ...(data as Record<string, unknown> | null | undefined) }
  if (sentinel !== null && !(SENTINEL in next)) next[SENTINEL] = sentinel
  if (base !== null && !(BASE in next)) next[BASE] = base
  return next
}

function onPopState(event: PopStateEvent) {
  const previous = lastState
  lastState = event.state
  const id = marker(event.state, BASE)
  if (id === null || marker(previous, SENTINEL) !== id) return
  // The back button took the page off its sentinel.
  const guard = id === sentinelId ? armed.at(-1) : undefined
  if (guard) {
    holding = true
    guard.request({ kind: "back" })
  } else {
    // A sentinel left behind once the edits were saved or the editor closed:
    // the operator meant to go back past it, so carry on to the page before.
    if (id === sentinelId) sentinelId = null
    window.history.back()
  }
}

function onHashChange() {
  lastState = window.history.state
}

function listen() {
  if (listening || typeof window === "undefined") return
  listening = true
  const { history } = window
  const push = history.pushState
  const replace = history.replaceState
  // Track the entry the tab is on, which a popstate event no longer tells.
  const tracked: History["pushState"] = (data, unused, url) => {
    push.call(history, data, unused, url)
    lastState = history.state
  }
  const kept: History["replaceState"] = (data, unused, url) => {
    const moved = !sameAddress(url)
    replace.call(history, keepMarkers(data, url), unused, url)
    // A rewrite in place is still the same entry. Next makes one while it
    // renders a back navigation, which can come before the popstate event:
    // only an entry replaced by another address counts as a new one.
    if (moved) lastState = history.state
  }
  history.pushState = tracked
  history.replaceState = kept
  lastState = history.state
  // A reload keeps the history entries but not this module: adopt a sentinel
  // the page was reloaded on.
  sentinelId = marker(history.state, SENTINEL)
  // Capture phase, so this runs before Next's own popstate listener.
  window.addEventListener("popstate", onPopState, true)
  window.addEventListener("hashchange", onHashChange)
  restoreHistory = () => {
    if (history.pushState === tracked) history.pushState = push
    if (history.replaceState === kept) history.replaceState = replace
    window.removeEventListener("popstate", onPopState, true)
    window.removeEventListener("hashchange", onHashChange)
  }
}

function arm(guard: ArmedGuard): () => void {
  listen()
  armed.push(guard)
  const standing = marker(window.history.state, SENTINEL)
  // Already above a base (a sentinel left behind by an earlier save, or one
  // another guard pushed), or holding a back press whose Stay restores it.
  if (standing !== null) sentinelId = standing
  else if (!holding) pushSentinel()
  // Disarming leaves the sentinel where it is: rewinding history here could
  // race a navigation the editor itself starts after saving. The popstate
  // handler skips a stale sentinel when the operator next goes back.
  return () => {
    const index = armed.indexOf(guard)
    if (index >= 0) armed.splice(index, 1)
    // The prompt holding a back press went with the last guard.
    if (armed.length === 0) holding = false
  }
}

/** Test-only: forget the module state and give `history` its methods back. */
export function __resetLeaveGuardForTests() {
  restoreHistory?.()
  restoreHistory = null
  listening = false
  armed.length = 0
  sentinelId = null
  lastState = null
  holding = false
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
      if (pending?.kind === "back") {
        holding = false
        if (!confirmed.current) pushSentinel()
      }
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
      holding = false
      sentinelId = null
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
