"use client"

import { usePathname } from "next/navigation"
import * as React from "react"

/** How long to wait for a streaming page's h1 before settling for #main. */
const HEADING_WAIT_MS = 3000

/**
 * Moves focus to the new page after a client-side navigation (WCAG 2.4.3).
 *
 * Without it, focus stays on the tab, rail row or palette entry that was
 * activated, or falls to <body> when that element unmounts, and a keyboard
 * or screen-reader user has to find the page they just opened. The page's
 * `h1` gets focus (made focusable with tabIndex=-1 for the purpose), which
 * also reads its text; Next's route announcer reads the new document title
 * as well. A page without an h1 yet (still streaming) is waited for; if
 * none arrives, `#main` takes focus.
 *
 * Only the PATH counts as a navigation. The Inbox keeps its selection and
 * filters in the query string, and stealing focus on every one of those
 * changes would yank the operator out of the list.
 *
 * Never on the first load (the browser and the skip link handle that), and
 * never when something inside the page already took focus on its own (an
 * autofocused field, a dialog the page opened): only focus left on <body>
 * or on the shell's own chrome is moved.
 */
function RouteFocus() {
  const pathname = usePathname()
  const previous = React.useRef(pathname)

  React.useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname

    const main = document.getElementById("main")
    if (!main) return

    const shouldMove = () => {
      const active = document.activeElement
      if (!active || active === document.body) return true
      if (main.contains(active)) return false
      // Focus still on the chrome that started the navigation (a tab, a
      // rail row, the back control) or in a sheet that has just closed.
      return (
        Boolean(
          active.closest(
            '[data-slot="app-bar"], [data-slot="toolbar"], [data-slot="tab-bar"], [data-slot="sidebar"]'
          )
        ) || !active.isConnected
      )
    }

    const focusHeading = (heading: HTMLElement) => {
      if (!shouldMove()) return
      if (!heading.hasAttribute("tabindex")) {
        heading.setAttribute("tabindex", "-1")
        // A focus ring on a heading reads as a bug; the move is for
        // assistive technology and the keyboard's next Tab.
        heading.classList.add("outline-none")
      }
      heading.focus({ preventScroll: true })
    }

    const find = () => main.querySelector<HTMLElement>("h1")
    const heading = find()
    if (heading) {
      focusHeading(heading)
      return
    }

    const observer = new MutationObserver(() => {
      const next = find()
      if (!next) return
      observer.disconnect()
      window.clearTimeout(timeout)
      focusHeading(next)
    })
    observer.observe(main, { childList: true, subtree: true })
    const timeout = window.setTimeout(() => {
      observer.disconnect()
      if (shouldMove()) main.focus({ preventScroll: true })
    }, HEADING_WAIT_MS)

    return () => {
      observer.disconnect()
      window.clearTimeout(timeout)
    }
  }, [pathname])

  return null
}

export { RouteFocus }
