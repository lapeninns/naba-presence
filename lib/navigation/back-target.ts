import type { Crumb } from "@/components/ui/breadcrumb"
import type { WorkspaceMode } from "@/lib/workspace/terms"

import {
  adoptingDestination,
  destinationForPath,
  isTopLevelPath,
} from "./destinations"

export type BackTarget = { href: string; label: string }

/**
 * Where "up" goes from a deep page: the phone app bar's labelled back
 * control ("‹ Listings") and the tablet toolbar's.
 *
 * Derived from the route hierarchy (the breadcrumb trail), never from the
 * browser history: a deep link opened from an email has no history, and
 * "back" to whatever page came before is a different promise from "up" to
 * the page this one belongs to.
 *
 * - A top-level destination (Inbox, Listings, Settings, ...) has no back.
 * - An adopted page goes up to the destination it lives under: Setup to
 *   Clients, or to Listings in a business.
 * - A listing's overview goes up to Listings, not to its client: Listings is
 *   the tab it lives under, and the client crumb is context, not a parent
 *   the operator walked through.
 * - Otherwise the nearest ancestor crumb with a link (a listing area goes
 *   up to its listing, a settings section to Settings, a client's settings
 *   to the client).
 * - With no linked ancestor (the lists are still loading), the destination
 *   the path lives under.
 */
export function backTarget(
  pathname: string | null,
  trail: readonly Crumb[],
  mode: WorkspaceMode = "agency"
): BackTarget | null {
  if (!pathname) return null
  const adopting = adoptingDestination(pathname, mode)
  if (adopting) return { href: adopting.href, label: adopting.label }
  if (isTopLevelPath(pathname)) return null

  const segments = pathname.split("/").filter(Boolean)
  const destination = destinationForPath(pathname)

  if (segments[0] === "listings" && segments.length === 2) {
    return { href: "/listings", label: "Listings" }
  }

  for (let index = trail.length - 2; index >= 0; index -= 1) {
    const crumb = trail[index]
    if (crumb.href && crumb.href !== pathname) {
      return { href: crumb.href, label: crumb.label }
    }
  }

  return destination
    ? { href: destination.href, label: destination.label }
    : null
}
