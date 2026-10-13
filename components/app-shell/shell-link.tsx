"use client"

import Link from "next/link"
import * as React from "react"

type ShellLinkProps = Omit<React.ComponentProps<typeof Link>, "prefetch"> & {
  /**
   * What to prefetch once the person shows intent. `"auto"` fetches the
   * route down to its nearest loading boundary; `true` fetches the full
   * route, for the primary destinations where the extra payload pays off.
   */
  intentPrefetch?: "auto" | true
}

/**
 * A `next/link` for the shell's chrome (sidebar, rail, tab bar, More sheet,
 * toolbar) that never prefetches on entering the viewport. The chrome links
 * to every destination on every page, so viewport prefetch downloaded the
 * other routes' JavaScript and RSC payloads on each cold load. Instead the
 * link starts prefetching on intent: a pointer over it, keyboard focus, or
 * the start of a touch, which on a phone is ~100ms before the click lands.
 *
 * The pattern is Next.js's own hover-prefetch recipe (prefetching guide):
 * flipping `prefetch` from `false` lets the Link register and fetch itself,
 * so there is no router dependency and the dedupe is the router cache's.
 * It renders exactly the anchor `Link` would.
 */
function ShellLink({
  intentPrefetch = "auto",
  onPointerEnter,
  onFocus,
  onTouchStart,
  ...props
}: ShellLinkProps) {
  const [intent, setIntent] = React.useState(false)
  const arm = () => {
    if (!intent) setIntent(true)
  }
  return (
    <Link
      {...props}
      prefetch={intent ? intentPrefetch : false}
      onPointerEnter={(event) => {
        arm()
        onPointerEnter?.(event)
      }}
      onFocus={(event) => {
        arm()
        onFocus?.(event)
      }}
      onTouchStart={(event) => {
        arm()
        onTouchStart?.(event)
      }}
    />
  )
}

export { ShellLink }
