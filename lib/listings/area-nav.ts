/**
 * The listing's area navigation as one list of items, so the desk's tab row
 * and the phone's area list cannot disagree about which areas exist, which
 * one is current, which can't be used here (and why) or where Review &
 * publish sits. Pure and client-safe: both renderers read it.
 */
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { suggestionCount } from "@/lib/listings/area-state"
import {
  listingArea,
  listingHref,
  visibleListingAreas,
  type ListingAreaKey,
} from "@/lib/listings/areas"
import { googleUnreachable, unpublishedCount } from "@/lib/listings/health"
import {
  resourceDisabledReason,
  type LocationCapabilities,
} from "@/lib/locations/gating"

/** Where a listing page sits: its overview, one area, or Review & publish. */
export type ListingPageKey = ListingAreaKey | "overview" | "changes"

export type ListingAreaNavItem = {
  key: ListingPageKey
  href: string
  label: string
  current: boolean
  /**
   * Why this area can't be used on this listing. The link still opens (the
   * page explains more); both renderers draw it muted with this reason.
   */
  unavailableReason: string | null
  /** A count after the label (suggestions waiting, changes to publish). */
  count: number
  /** What the count is, for assistive tech: ", 3 waiting". */
  countNoun: string
}

/** Blocked only because this role may not publish: the area still opens. */
const ROLE_LIMITS = new Set(["publish_not_allowed", "publishing_paused"])

/**
 * Why an area can't be used on this listing, by the same rule the overview
 * cards use: not linked, or a capability that is unavailable or blocked for
 * a reason other than this role's publishing limits (a read-only role can
 * still open an area, to look).
 */
export function areaUnavailableReason(
  caps: LocationCapabilities | undefined,
  linked: boolean,
  capability: string | undefined
): string | null {
  if (!linked) return "Not linked to Google"
  if (!caps || !capability) return null
  const resource = caps.resources?.[capability]
  if (!resource) return null
  if (resource.state === "unavailable")
    return resourceDisabledReason(caps, capability, true)
  if (
    resource.state === "blocked" &&
    !ROLE_LIMITS.has(resource.reasonCode ?? "")
  )
    return resourceDisabledReason(caps, capability, true)
  return null
}

/** The page's title: the area's label, "Review & publish", or "Overview". */
export function listingPageLabel(page: ListingPageKey): string {
  if (page === "overview") return "Overview"
  if (page === "changes") return "Review & publish"
  return listingArea(page).label
}

/**
 * Overview, every area this role may open, then Review & publish last.
 * Console-gated areas (People with access, Verification) only for owners
 * and admins. Selection comes from the route.
 */
export function listingAreaNavItems({
  locationId,
  current,
  canManageConsoles,
  summary,
  caps,
  linked,
}: {
  locationId: string
  current: ListingPageKey
  canManageConsoles: boolean
  summary: ListingSummary | undefined
  caps: LocationCapabilities | undefined
  linked: boolean
}): ListingAreaNavItem[] {
  const waiting = suggestionCount(summary)
  const toPublish =
    summary && !googleUnreachable(summary) ? unpublishedCount(summary) : 0
  return [
    {
      key: "overview",
      href: listingHref(locationId),
      label: "Overview",
      current: current === "overview",
      unavailableReason: null,
      count: 0,
      countNoun: "",
    },
    ...visibleListingAreas(canManageConsoles).map(
      (area): ListingAreaNavItem => ({
        key: area.key,
        href: listingHref(locationId, area.segment),
        label: area.label,
        current: area.key === current,
        unavailableReason: areaUnavailableReason(caps, linked, area.capability),
        count: area.key === "suggestions" ? waiting : 0,
        countNoun: "waiting",
      })
    ),
    {
      key: "changes",
      href: listingHref(locationId, "changes"),
      label: "Review & publish",
      current: current === "changes",
      unavailableReason: null,
      count: toPublish,
      countNoun: "to publish",
    },
  ]
}
