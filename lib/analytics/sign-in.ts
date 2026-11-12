export const SIGN_IN_ANALYTICS_ORIGIN = "https://nabapresence.com"
export const SIGN_IN_ANALYTICS_PATH = "/sign-in"

export function signInAnalyticsId(value: string | undefined): string | null {
  return value && /^G-[A-Z0-9]{10}$/.test(value) ? value : null
}

export function isAnalyticsEntry(
  location: Pick<Location, "origin" | "pathname" | "search" | "hash">
): boolean {
  return (
    location.origin === SIGN_IN_ANALYTICS_ORIGIN &&
    location.pathname === SIGN_IN_ANALYTICS_PATH &&
    !location.search &&
    (!location.hash || location.hash === "#main")
  )
}

/** Keep the referring site for acquisition reporting, but never its path or
 * query. First-party links can contain account, invite or report identifiers. */
export function signInReferrer(referrer: string): string | null {
  try {
    const url = new URL(referrer)
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !/(^|\.)nabapresence\.com$/.test(url.hostname)
    ) {
      return url.origin
    }
  } catch {
    // A missing or invalid referrer is treated as direct traffic.
  }
  return null
}
