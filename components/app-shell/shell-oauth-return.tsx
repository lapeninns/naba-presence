"use client"

import { usePathname } from "next/navigation"
import { Suspense } from "react"

import { OAuthReturn } from "@/components/settings/oauth-return"

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
      <div className="empty:hidden px-5 pt-3 md:px-(--np-page-pad-x)">
        <OAuthReturn />
      </div>
    </Suspense>
  )
}
