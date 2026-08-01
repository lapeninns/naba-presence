/**
 * Only same-site absolute paths may be used as a post-auth destination.
 * Anything protocol-relative ("//host"), backslash-smuggled ("/\\host"),
 * scheme-bearing, or relative is refused so ?next= cannot become an open
 * redirect.
 */
export function sanitiseNextPath(
  value: string | null | undefined
): string | null {
  if (!value) return null
  if (!value.startsWith("/")) return null
  if (value.startsWith("//") || value.startsWith("/\\")) return null
  return value
}
