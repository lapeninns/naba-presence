/**
 * The element that had focus when an action asked for step-up (the Save or
 * Publish that was refused), read at the moment of the event: the prompt
 * opens from state, with no trigger for Base UI to return focus to.
 */
export function stepUpFocusOrigin(): HTMLElement | null {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body
    ? active
    : null
}

/**
 * Where focus goes when the step-up prompt closes: back to the control that
 * asked for it while it is still on screen, else the page's own heading or
 * `#main` (both focusable by script), never <body>.
 */
export function stepUpFinalFocus(
  origin: HTMLElement | null
): HTMLElement | true {
  if (origin?.isConnected && origin.getClientRects().length > 0) return origin
  const main = document.getElementById("main")
  const heading = main?.querySelector<HTMLElement>("h1[tabindex]")
  if (heading && heading.getClientRects().length > 0) return heading
  return main ?? true
}
