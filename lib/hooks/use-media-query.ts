"use client"

import { useSyncExternalStore } from "react"

import { useHydrated } from "@/lib/hooks/use-hydrated"
import { mediaQuery, type MediaQueryName } from "@/lib/ui/breakpoints"

/*
 * The rule: LAYOUT switches in CSS, BEHAVIOUR switches in JS.
 *
 * The server cannot know the viewport, so anything it renders from a JS
 * media query is a guess that a phone paints before hydration corrects it.
 * Layout — which column shows, whether a sidebar is a rail, how a toolbar
 * wraps — therefore lives in CSS: render both trees and hide one with a
 * breakpoint variant, or draw one tree that restyles itself. The first
 * paint is then right on every device.
 *
 * These hooks are for what CSS cannot express: push navigation versus a
 * split view, whether selecting a row opens a sheet, whether a route change
 * should close a drawer, whether to auto-select the first review. Even
 * then, prefer reading `matchMedia` inside the event handler (see
 * components/inbox/inbox-view.tsx) over subscribing a render to it.
 *
 * When a render genuinely depends on the answer, the `serverDefault` is the
 * trade: `true` draws the wide behaviour first (the desk's primary device),
 * so a phone may act wide for the hydration render. If that frame is
 * visible — an element that only one branch mounts — use
 * `useHydratedBreakpoint`, which says "unknown" until the client knows, and
 * render the CSS-only shape for unknown:
 *
 *   const wide = useHydratedBreakpoint("md")
 *   if (wide === null) return <BothPanesCssSwitched />
 *   return wide ? <SplitView /> : <PushNavigation />
 */

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

/**
 * Whether the viewport is at least as wide as a named breakpoint (or inside
 * the `controls` / `capsules` variant), using the same values as the
 * Tailwind prefix of that name. "Below md" is `!useBreakpoint("md")`.
 */
export function useBreakpoint(
  name: MediaQueryName,
  serverDefault = true
): boolean {
  return useMediaQuery(mediaQuery(name), serverDefault)
}

/**
 * `useBreakpoint` that answers `null` in the server render and the
 * hydration render, so nothing is decided on a guess. Render the CSS-only
 * (both-trees) shape for `null`; the real answer lands one render later.
 */
export function useHydratedBreakpoint(name: MediaQueryName): boolean | null {
  const hydrated = useHydrated()
  const matches = useBreakpoint(name)
  return hydrated ? matches : null
}
