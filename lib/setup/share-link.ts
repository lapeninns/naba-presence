/**
 * The setup address a colleague needs to reach the same review, and only
 * that.
 *
 * The address bar can carry more than the review: Google's OAuth return
 * (`google`, `status`, `rid`, `reason`, see GOOGLE_RETURN_PARAMS) and anything
 * else a redirect appended. None of that should leave this browser, so the
 * shared URL is rebuilt from an allow-list rather than copied: this origin,
 * the /setup path, and the params below in this order. Any other param, the
 * hash and any path under a different route are dropped.
 */
export const SHAREABLE_SETUP_PARAMS = [
  "client",
  "step",
  "onboardingAccount",
  "onboardingDraft",
  "onboardingReview",
  "onboardingMatchLinkReview",
] as const

export function setupShareUrl(href: string): string {
  const current = new URL(href)
  const shared = new URL("/setup", current.origin)
  for (const key of SHAREABLE_SETUP_PARAMS) {
    const value = current.searchParams.get(key)
    if (value) shared.searchParams.set(key, value)
  }
  return shared.toString()
}

/**
 * Hand a setup link to someone else: the phone's share sheet where there is
 * one, otherwise the clipboard.
 *
 * `navigator.share` is checked at click time, not at render, so the server
 * render and the first client render agree, and a browser that grows or loses
 * the API (a desktop with a share extension) is read as it is now.
 *
 * Resolves to what happened, so the caller can say it in words:
 *   "shared"    the share sheet completed;
 *   "cancelled" the person closed the share sheet (not an error);
 *   "copied"    the link is on the clipboard;
 *   "failed"    neither was possible; show the link to copy by hand.
 */
export type ShareOutcome = "shared" | "cancelled" | "copied" | "failed"

export async function shareLink({
  url,
  title,
  text,
}: {
  url: string
  title: string
  text?: string
}): Promise<ShareOutcome> {
  const nav: Partial<Navigator> | undefined =
    typeof navigator === "undefined" ? undefined : navigator
  const data = { url, title, ...(text ? { text } : {}) }
  if (
    typeof nav?.share === "function" &&
    (typeof nav.canShare !== "function" || nav.canShare(data))
  ) {
    try {
      await nav.share(data)
      return "shared"
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        return "cancelled"
      // A share sheet that refused (not allowed here, no targets) falls
      // through to the clipboard rather than leaving the person stuck.
    }
  }
  try {
    if (!nav?.clipboard?.writeText) return "failed"
    await nav.clipboard.writeText(url)
    return "copied"
  } catch {
    return "failed"
  }
}
