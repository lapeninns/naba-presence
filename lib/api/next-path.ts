/**
 * Only same-site absolute paths may be a post-auth destination. The value is
 * parsed with the WHATWG URL parser against an unroutable placeholder origin;
 * anything that resolves to a different origin — protocol-relative ("//host"),
 * backslash-smuggled ("/\\host"), scheme-bearing ("https:", "javascript:"), or
 * control-character-smuggled ("/\n//host", which the browser strips at the
 * navigation sink) — is refused so ?next= cannot become an open redirect.
 */
export function sanitiseNextPath(
  value: string | null | undefined
): string | null {
  if (!value) return null
  if (!value.startsWith("/")) return null
  let url: URL
  try {
    url = new URL(value, "https://placeholder.invalid")
  } catch {
    return null
  }
  if (url.origin !== "https://placeholder.invalid") return null
  return url.pathname + url.search + url.hash
}

/**
 * Request header `proxy.ts` sets to the requested path + query, so a server
 * layout can send a signed-out visitor back where they were going.
 */
export const REQUEST_PATH_HEADER = "x-naba-request-path"

/**
 * The sign-in URL for a signed-out visitor who asked for `requested`. The
 * path is sanitised here too, so a forged header cannot smuggle an off-site
 * destination into `?next=`; the sign-in page sanitises it again on read.
 */
export function signInPathFor(requested: string | null | undefined): string {
  const next = sanitiseNextPath(requested)
  if (!next || next === "/" || next.startsWith("/sign-in")) return "/sign-in"
  return `/sign-in?${new URLSearchParams({ next }).toString()}`
}
