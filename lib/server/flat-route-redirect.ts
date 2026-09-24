import "server-only"

import { resolvePrimaryLocation } from "@/lib/server/primary-location"

/** What a retired flat route's page received in its query string. */
export type FlatRouteSearchParams = Record<
  string,
  string | string[] | undefined
>

/**
 * Where a retired flat route should send someone.
 *
 * The single-business IA (`/profile`, `/photos`, `/posts`) assumed one
 * listing per organisation. An agency has many, so those paths can no longer
 * name a location on their own. They stay as redirects because bookmarks and
 * old links exist, and silently 404-ing them would be a worse answer than
 * landing somewhere sensible.
 *
 * With exactly one visible location the answer is unambiguous, so go straight
 * there. With several — or none — send the user to Clients, where they can say
 * which business they meant.
 *
 * The old link's query string comes along (a filter or a tab in a bookmark is
 * still meaningful), and a landing on Clients carries `?moved=<section>` so
 * the page can say in one line why the bookmark ended up there.
 */
export async function flatRouteTarget(
  segment: string,
  options: { searchParams?: FlatRouteSearchParams; moved?: string } = {}
): Promise<string> {
  const primary = await resolvePrimaryLocation()
  if (primary.locationCount === 1 && primary.locationId) {
    const path = segment
      ? `/listings/${primary.locationId}/${segment}`
      : `/listings/${primary.locationId}`
    return withForwardedQuery(path, options.searchParams)
  }
  return withForwardedQuery("/clients", options.searchParams, options.moved)
}

/**
 * `path` with the old query string forwarded and, when given, `moved` set.
 * Repeated keys stay repeated; a `moved` already in the old query is
 * replaced rather than duplicated.
 */
export function withForwardedQuery(
  path: string,
  searchParams: FlatRouteSearchParams = {},
  moved?: string
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) {
      query.append(key, item)
    }
  }
  if (moved) query.set("moved", moved)
  const search = query.toString()
  return search ? `${path}?${search}` : path
}

/** Old flat sub-path -> the location-workspace segment that replaced it. */
export const FLAT_SEGMENT_MAP: Record<string, string> = {
  "": "",
  hours: "hours",
  menu: "menu",
  booking: "booking",
  // "Business details" was the flat name for Business Information, which the
  // rebuilt profile editor absorbs as sections.
  details: "profile",
  industry: "profile",
}
