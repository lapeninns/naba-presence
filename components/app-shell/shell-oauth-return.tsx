"use client"

import dynamic from "next/dynamic"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"

// The result panel and its retry (the connection workspace, alert and
// toast code) load only when a Google callback actually returned here.
const OAuthReturn = dynamic(() =>
  import("@/components/settings/oauth-return").then((m) => m.OAuthReturn)
)

/** Pages that read the OAuth callback's result themselves. */
const OWN_RESULT = ["/setup", "/settings/connections"]

/**
 * The result of a Google connect or reconnect, on whichever page it returned
 * to. The org-wide reconnect banner sends people back to the page they were
 * on, so the confirmation (or the error, with a "Try again" that keeps the
 * same target) has to be readable anywhere, not only in Settings.
 */
export function ShellOAuthReturn() {
  const pathname = usePathname()
  if (OWN_RESULT.some((prefix) => pathname.startsWith(prefix))) return null
  return (
    <Suspense fallback={null}>
      <OAuthReturnSlot />
    </Suspense>
  )
}

/**
 * Mounts the result panel once the callback's `google=` parameter appears,
 * and keeps it mounted: the panel strips the parameters from the address
 * straight away and goes on showing its outcome.
 */
function OAuthReturnSlot() {
  const google = useSearchParams().get("google")
  const [returned, setReturned] = useState(false)
  const active = returned || google === "connected" || google === "error"
  if (active && !returned) setReturned(true)
  if (!active) return null
  return (
    <div className="px-5 pt-3 empty:hidden md:px-(--np-page-pad-x)">
      <OAuthReturn />
    </div>
  )
}
