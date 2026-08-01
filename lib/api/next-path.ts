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
