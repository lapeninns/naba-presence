"use client"

import { useEffect, useState } from "react"

/** The toast column's widest extent from the right edge: 380px + 16px inset. */
const TOAST_COLUMN = 396

const COMPOSER_FOOTER = '[data-slot="composer-footer"][data-docked="bottom"]'
const ACTION_FOOTERS = [
  '[data-slot="sheet-content"] [data-slot="sheet-footer"]',
  '[data-slot="dialog-content"] [data-slot="dialog-footer"]',
  COMPOSER_FOOTER,
].join(", ")

/**
 * Lift the stack above action footers under the toast column. From 640px
 * the toasts sit bottom-right, where both a right-hand sheet and the Inbox
 * reply pane keep their primary action.
 */
export function toastFooterClearance(
  root: ParentNode,
  viewport: { width: number; height: number }
): number {
  let top = viewport.height
  for (const footer of root.querySelectorAll(ACTION_FOOTERS)) {
    const rect = footer.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (rect.right <= viewport.width - TOAST_COLUMN) continue
    if (rect.bottom <= 0 || rect.top >= viewport.height) continue
    top = Math.min(top, rect.top)
  }
  return Math.max(0, Math.ceil(viewport.height - top))
}

export function useToastFooterClearance() {
  const [clearance, setClearance] = useState(0)
  useEffect(() => {
    const measure = () =>
      setClearance(
        toastFooterClearance(document, {
          width: window.innerWidth,
          height: window.innerHeight,
        })
      )
    const observer = new MutationObserver(measure)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-open",
        "data-closed",
        "data-slot",
        "data-docked",
        "hidden",
      ],
    })
    window.addEventListener("resize", measure)
    // The reply footer sticks on shorter viewports. Measure its new position
    // as the page scrolls, but not when no such footer is mounted.
    let frame: number | undefined
    const onScroll = () => {
      if (frame !== undefined || !document.querySelector(COMPOSER_FOOTER))
        return
      frame = requestAnimationFrame(() => {
        frame = undefined
        measure()
      })
    }
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    })
    // A sheet slides in: measure again once its transition settles.
    document.addEventListener("transitionend", measure, true)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
      document.removeEventListener("scroll", onScroll, true)
      if (frame !== undefined) cancelAnimationFrame(frame)
      document.removeEventListener("transitionend", measure, true)
    }
  }, [])
  return clearance
}
