import "server-only"

import { resolvePrimaryLocation } from "@/lib/server/primary-location"

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
 */
export async function flatRouteTarget(segment: string): Promise<string> {
  const primary = await resolvePrimaryLocation()
  if (primary.locationCount === 1 && primary.locationId) {
    return segment
      ? `/listings/${primary.locationId}/${segment}`
      : `/listings/${primary.locationId}`
  }
  return "/clients"
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
