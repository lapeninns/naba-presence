/**
 * Full-document navigation to a path inside this app.
 *
 * Use this, not `router.push`, when the next page must start from a clean
 * client: signing in or out, switching organisation, or any other change
 * of session. The reload discards every TanStack Query cache and in-memory
 * store that belongs to the previous session.
 *
 * Only same-origin, root-relative paths are accepted. Absolute URLs,
 * protocol-relative (`//host`) and backslash (`/\host`) forms throw instead
 * of navigating, so a caller-supplied path can never leave the origin.
 * External destinations (OAuth consent screens) call `location.assign`
 * directly. Resolving to an absolute URL also satisfies Next's
 * `no-location-assign-relative-destination` rule without disabling it.
 */
export function hardNavigate(path: string): void {
  window.location.assign(resolveSameOriginUrl(path, window.location.origin))
}

/** Pure resolver behind {@link hardNavigate}; exported for tests. */
export function resolveSameOriginUrl(path: string, origin: string): string {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.startsWith("/\\")
  ) {
    throw new Error(`hardNavigate only accepts a root-relative path: ${path}`)
  }
  const url = new URL(path, origin)
  if (url.origin !== new URL(origin).origin) {
    throw new Error(`hardNavigate refused an off-origin target: ${path}`)
  }
  return url.href
}
