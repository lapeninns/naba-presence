import type { SessionUser } from "@/lib/contracts/session"

// Shared by the browser (useScopeReset, HydrationBoundary) and the server
// (lib/server/prefetch.ts stamps each prefetched payload with it), so it
// lives outside the "use client" scope-reset module.

/**
 * Everything about a session that decides what its cached data may show:
 * who, in which organisation, with which role and publish right, and the
 * server's scope fingerprint (location scope and grants; the membership's
 * security version once it exists). Two sessions with the same token may
 * share a cache; any difference resets it.
 */
export function sessionScopeToken(
  session: SessionUser | null | undefined
): string {
  if (!session) return ""
  return [
    session.userId,
    session.organisationId,
    session.role,
    session.canPublish ? "publish" : "no-publish",
    session.scopeFingerprint ?? "",
  ].join("\n")
}
