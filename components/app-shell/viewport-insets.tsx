"use client"

import { useEffect, useSyncExternalStore } from "react"

/*
 * The on-screen keyboard, as CSS can read it.
 *
 * Android Chrome, told `interactive-widget=resizes-content` (app/layout.tsx),
 * shrinks the layout viewport when the keyboard opens, so `bottom: 0` lands
 * above it on its own. iOS Safari does not: the keyboard overlays the layout
 * viewport and only the visual viewport shrinks, leaving a fixed bottom bar
 * — the composer's actions, the tab bar — underneath it. `visualViewport`
 * is the one API that sees the difference, so this file turns it into:
 *
 *   --np-keyboard-inset          px of the layout viewport the keyboard covers
 *   --np-visual-viewport-height  px of what is actually visible
 *   <html data-keyboard="open">  while the inset is a keyboard, not a toolbar
 *
 * Android reports an inset of ~0 here (its layout viewport already shrank),
 * so CSS that adds the inset is correct on both without branching.
 */

export const KEYBOARD_INSET_PROPERTY = "--np-keyboard-inset"
export const VISUAL_VIEWPORT_HEIGHT_PROPERTY = "--np-visual-viewport-height"

/**
 * Safari's collapsing toolbars and the form-assistant bar move the visual
 * viewport by 40-90px with no keyboard in sight. The smallest phone keyboard
 * is well over 200px, so 120px separates the two with room either side.
 */
export const KEYBOARD_OPEN_THRESHOLD = 120

/**
 * Pinch zoom shrinks the visual viewport too, which the formula below would
 * read as a keyboard. Past a token zoom the inset is reported as 0: a zoomed
 * reader is panning the page, and a bar chasing the viewport would fight them.
 */
const ZOOMED_SCALE = 1.05

export type ViewportInsets = {
  readonly keyboardInset: number
  readonly visualViewportHeight: number
}

function readInsets(): ViewportInsets | null {
  if (typeof window === "undefined") return null
  const viewport = window.visualViewport
  if (!viewport) return null
  const zoomed = (viewport.scale ?? 1) > ZOOMED_SCALE
  // Whole pixels: iOS reports fractional heights mid-animation, and a CSS
  // variable rewritten every sub-pixel would restyle the page for nothing.
  const keyboardInset = zoomed
    ? 0
    : Math.max(
        0,
        Math.round(window.innerHeight - viewport.height - viewport.offsetTop)
      )
  return {
    keyboardInset,
    visualViewportHeight: Math.round(viewport.height),
  }
}

/*
 * One set of visualViewport listeners for every reader. `resize` covers the
 * keyboard opening and closing; `scroll` covers iOS panning the visual
 * viewport to reveal a focused field, which moves `offsetTop` without a
 * resize. Both fire many times per frame during the keyboard animation, so
 * readers are told at most once per animation frame, and only on a change.
 */
const listeners = new Set<() => void>()
let latest: ViewportInsets | null = null
let frame = 0
let detach: (() => void) | null = null

function publish() {
  frame = 0
  const next = readInsets()
  if (
    next?.keyboardInset === latest?.keyboardInset &&
    next?.visualViewportHeight === latest?.visualViewportHeight
  ) {
    return
  }
  latest = next
  for (const listener of listeners) listener()
}

function schedule() {
  if (frame) return
  frame = window.requestAnimationFrame(publish)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!detach && typeof window !== "undefined" && window.visualViewport) {
    const viewport = window.visualViewport
    latest = readInsets()
    viewport.addEventListener("resize", schedule)
    viewport.addEventListener("scroll", schedule)
    detach = () => {
      viewport.removeEventListener("resize", schedule)
      viewport.removeEventListener("scroll", schedule)
      if (frame) window.cancelAnimationFrame(frame)
      frame = 0
      latest = null
    }
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && detach) {
      detach()
      detach = null
    }
  }
}

function getKeyboardInset(): number {
  // Between subscribe and the first frame `latest` is the reading taken at
  // subscribe time; without a subscriber, read the viewport directly.
  return (latest ?? readInsets())?.keyboardInset ?? 0
}

/**
 * Pixels of the layout viewport the on-screen keyboard covers right now: 0
 * on the server, without visualViewport, on Android (whose layout viewport
 * resizes instead) and whenever no keyboard is up. Prefer the CSS variable
 * for positioning; this is for logic such as scrolling a field into the
 * space that is left.
 */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, getKeyboardInset, () => 0)
}

function write(root: HTMLElement) {
  const insets = latest ?? readInsets()
  if (!insets) return
  root.style.setProperty(KEYBOARD_INSET_PROPERTY, `${insets.keyboardInset}px`)
  root.style.setProperty(
    VISUAL_VIEWPORT_HEIGHT_PROPERTY,
    `${insets.visualViewportHeight}px`
  )
  if (insets.keyboardInset > KEYBOARD_OPEN_THRESHOLD) {
    root.dataset.keyboard = "open"
  } else {
    delete root.dataset.keyboard
  }
}

/**
 * Mount once, in the root layout. Renders nothing; keeps the variables on
 * <html> current for as long as it is mounted and removes them after. CSS
 * must read them with a fallback — `var(--np-keyboard-inset, 0px)` — for
 * the server render and browsers without visualViewport.
 */
export function ViewportInsets() {
  useEffect(() => {
    if (!window.visualViewport) return
    const root = document.documentElement
    const unsubscribe = subscribe(() => write(root))
    write(root)
    return () => {
      unsubscribe()
      root.style.removeProperty(KEYBOARD_INSET_PROPERTY)
      root.style.removeProperty(VISUAL_VIEWPORT_HEIGHT_PROPERTY)
      delete root.dataset.keyboard
    }
  }, [])
  return null
}
