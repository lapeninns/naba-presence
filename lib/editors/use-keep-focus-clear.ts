"use client"

import { useEffect, type RefObject } from "react"

/** Space kept between a focused field and the bar or keyboard edge. */
const GAP = 12
/** The sticky app toolbar at the top of the column. */
const TOP_CLEARANCE = 72

function scrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node)
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    )
      return node
    node = node.parentElement
  }
  return null
}

/**
 * Keyboard safety for an editor with a pinned footer bar.
 *
 * A browser only scrolls a focused field into view when it is off screen;
 * a field that is technically on screen but sitting under the sticky dark
 * bar — or under a phone keyboard that just opened — stays hidden. This
 * watches focus inside `root` (and the visual viewport shrinking when a
 * keyboard opens) and scrolls the nearest scroller just enough that the
 * field sits above whichever is higher: the bar, or the keyboard's edge.
 */
export function useKeepFocusClear(
  root: RefObject<HTMLElement | null>,
  footerSelector = "[data-slot=editor-frame-footer]"
) {
  useEffect(() => {
    const container = root.current
    if (!container) return

    function keepClear(target: Element | null) {
      if (!(target instanceof HTMLElement) || !container?.contains(target))
        return
      const footer = container.querySelector<HTMLElement>(footerSelector)
      if (footer?.contains(target)) return
      // The whole field (label, control, hint, error) when it is compact
      // enough, so an error message under the control is not left hidden.
      const field = target.closest<HTMLElement>("[data-slot=field]")
      const fieldRect = field?.getBoundingClientRect()
      const rect =
        fieldRect && fieldRect.height < window.innerHeight * 0.4
          ? {
              top: target.getBoundingClientRect().top,
              bottom: fieldRect.bottom,
            }
          : target.getBoundingClientRect()
      const viewport = window.visualViewport
      const viewportBottom = viewport
        ? viewport.offsetTop + viewport.height
        : window.innerHeight
      const barTop = footer
        ? footer.getBoundingClientRect().top
        : Number.POSITIVE_INFINITY
      const limit = Math.min(barTop, viewportBottom) - GAP
      let delta = 0
      if (rect.bottom > limit) delta = rect.bottom - limit
      else if (rect.top < TOP_CLEARANCE) delta = rect.top - TOP_CLEARANCE
      if (delta === 0) return
      const scroller = scrollParent(target)
      if (scroller) scroller.scrollBy({ top: delta })
      else window.scrollBy({ top: delta })
    }

    function onFocusIn(event: FocusEvent) {
      // After the browser's own focus scroll has settled.
      requestAnimationFrame(() => keepClear(event.target as Element))
    }
    function onViewportResize() {
      keepClear(document.activeElement)
    }

    container.addEventListener("focusin", onFocusIn)
    window.visualViewport?.addEventListener("resize", onViewportResize)
    return () => {
      container.removeEventListener("focusin", onFocusIn)
      window.visualViewport?.removeEventListener("resize", onViewportResize)
    }
  }, [root, footerSelector])
}
