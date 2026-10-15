import { useCallback, useEffect, useRef } from "react"
import type { RefObject } from "react"

/**
 * Keeps focus from falling to the page when a button removes itself. An
 * action bar's "Save here" leaves once it has done its work, and focus on a
 * removed element drops to the body (a keyboard or screen-reader user then
 * starts again from the top).
 *
 * Call the returned `arm()` from the action's handler. Once the focused
 * element has gone, focus moves to `region` (give it `tabIndex={-1}`), or to
 * the editor frame around it when the whole region has gone. Nothing moves
 * while focus is still on a real element, so a failed save leaves it alone.
 */
export function useReturnFocus(region: RefObject<HTMLElement | null>) {
  const frame = useRef<HTMLElement | null>(null)
  const armed = useRef(false)

  useEffect(() => {
    const current = region.current
    if (current) frame.current = current.closest("[data-slot=editor-frame]")
    if (!armed.current) return
    const active = document.activeElement
    if (active && active !== document.body) return
    armed.current = false
    ;(current ?? frame.current)?.focus()
  })

  // The region left with its bar (the footer unmounted): the effect above
  // no longer runs, so settle focus on the way out.
  useEffect(
    () => () => {
      if (armed.current && document.activeElement === document.body) {
        frame.current?.focus()
      }
    },
    []
  )

  return useCallback(() => {
    armed.current = true
  }, [])
}
