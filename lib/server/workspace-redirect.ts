import "server-only"

import { redirect } from "next/navigation"

import { businessModeRedirect, withoutClientScopeParam } from "@/lib/workspace/terms"

/**
 * Sends a business-mode session out of the client layer: `/clients`,
 * `/clients/new` and `/clients/[id]/**` redirect to Listings (the client's
 * settings to Settings). Agency sessions, and no session at all, pass
 * through. Call it before reading anything the page would show.
 */
export function redirectOutOfClientLayer(
  session: { workspaceMode: "business" | "agency" } | null,
  pathname: string
): void {
  if (session?.workspaceMode !== "business") return
  const target = businessModeRedirect(pathname)
  if (target) redirect(target)
}

/**
 * Drops a `?clientId=` from a business session's address. Business pages have
 * no client scope, so this is enforced on the server rather than left to each
 * component to ignore.
 */
export function redirectOutOfClientScope(
  session: { workspaceMode: "business" | "agency" } | null,
  pathAndSearch: string | null
): void {
  if (session?.workspaceMode !== "business" || !pathAndSearch) return
  const target = withoutClientScopeParam(pathAndSearch)
  if (target) redirect(target)
}
