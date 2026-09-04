import "server-only"

import { sanitiseNextPath } from "@/lib/api/next-path"

/**
 * Where the Google OAuth callback may send a browser.
 *
 * `sanitiseNextPath` already refuses anything that resolves off-origin, so
 * this is not about open redirects. It is about scope: the value survives a
 * round trip through Google and comes back as a redirect the user did not
 * re-consent to, so it may only name the handful of screens the connect flow
 * legitimately returns to.
 */
const ALLOWED_PREFIXES = ["/setup", "/clients/", "/settings/connections"]

export const DEFAULT_OAUTH_RETURN = "/settings/connections"

export function safeOAuthReturn(value: string | null | undefined): string {
  const path = sanitiseNextPath(value)
  if (!path) return DEFAULT_OAUTH_RETURN
  const [pathname] = path.split("?")
  const allowed = ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  )
  return allowed ? path : DEFAULT_OAUTH_RETURN
}

/** Appends the callback's own status parameters to a return path. */
export function withOAuthStatus(
  returnTo: string,
  params: Record<string, string>
): string {
  const [pathname, search] = returnTo.split("?")
  const query = new URLSearchParams(search)
  for (const [key, value] of Object.entries(params)) query.set(key, value)
  return `${pathname}?${query}`
}
