import type { LocationResourceKey } from "@/lib/contracts/location-capabilities"

/**
 * The areas of a listing: the registry every listing surface reads.
 *
 * One list, so the overview's cards, the editors' headers, the breadcrumb
 * and the redirect table cannot disagree about what a listing is made of.
 * `model` is what the area's status pill and its banner say about where a
 * change goes; it is the one thing that used to differ silently from editor
 * to editor.
 */
export type ListingAreaKey =
  | "profile"
  | "hours"
  | "booking"
  | "photos"
  | "posts"
  | "menu"
  | "people"
  | "verification"
  | "suggestions"
  | "reviewLink"

export type ListingAreaModel =
  /** A NabaPresence copy, reviewed and then published to Google. */
  | "canonical"
  /** Written to Google as soon as the operator confirms. */
  | "google_direct"
  /** Its own draft → approval → publish lifecycle. */
  | "lifecycle"
  /** An exact reviewed operation, followed by independent confirmation. */
  | "reviewed"
  /** Google's changes, accepted or ignored here. */
  | "inbound"
  /** NabaPresence's own, never written to Google (the review link). */
  | "local"

export type ListingArea = {
  key: ListingAreaKey
  label: string
  /** What the area holds, in the operator's words. */
  description: string
  /** Path segment under `/listings/[id]`. */
  segment: string
  model: ListingAreaModel
  /** The capabilities resource that gates it, if any. */
  capability?: LocationResourceKey
  /** Owner/admin-only console. */
  consoleGated?: boolean
}

export const LISTING_AREAS: readonly ListingArea[] = [
  {
    key: "profile",
    label: "Business profile",
    description:
      "Name, categories, contact details, description and attributes",
    segment: "profile",
    model: "canonical",
    capability: "profile",
  },
  {
    key: "hours",
    label: "Opening hours",
    description: "Regular hours and special days",
    segment: "hours",
    model: "canonical",
    capability: "hours",
  },
  {
    key: "booking",
    label: "Booking links",
    description: "Reserve, order and book buttons on the listing",
    segment: "booking",
    model: "google_direct",
    capability: "booking",
  },
  {
    key: "photos",
    label: "Photos",
    description: "The listing's photo library and logo",
    segment: "photos",
    model: "google_direct",
    capability: "photos",
  },
  {
    key: "posts",
    label: "Posts",
    description: "Updates, events and offers",
    segment: "posts",
    model: "lifecycle",
    capability: "posts",
  },
  {
    key: "menu",
    label: "Food menu",
    description: "Sections, items and prices",
    segment: "menu",
    model: "canonical",
    capability: "menu",
  },
  {
    key: "people",
    label: "People with access",
    description: "Who may edit the listing on Google, and invitations",
    segment: "people",
    model: "reviewed",
    capability: "administration",
    consoleGated: true,
  },
  {
    key: "verification",
    label: "Verification",
    description: "Whether Google has verified the listing, and how to",
    segment: "verification",
    model: "reviewed",
    capability: "administration",
    consoleGated: true,
  },
  {
    key: "suggestions",
    label: "Suggested updates",
    description: "Changes Google made that NabaPresence has not taken yet",
    segment: "suggestions",
    model: "inbound",
    capability: "profile",
  },
  {
    key: "reviewLink",
    label: "Review link",
    description: "A short link and QR code to the listing’s Google review form",
    segment: "review-link",
    // Nothing is written to Google; the link only reads the review form's
    // address from the listing. No capability gates it: it is
    // NabaPresence's own link, managed by anyone who may edit here.
    model: "local",
  },
]

export function listingArea(key: ListingAreaKey): ListingArea {
  const area = LISTING_AREAS.find((entry) => entry.key === key)
  if (!area) throw new Error(`Unknown listing area: ${key}`)
  return area
}

export function areaForSegment(segment: string): ListingArea | undefined {
  return LISTING_AREAS.find((area) => area.segment === segment)
}

export function visibleListingAreas(canManageConsoles: boolean): ListingArea[] {
  return LISTING_AREAS.filter((area) => !area.consoleGated || canManageConsoles)
}

export function listingHref(locationId: string, segment?: string): string {
  const base = `/listings/${locationId}`
  return segment ? `${base}/${segment}` : base
}

/** What the model means for the operator, said once. */
export function modelNote(
  model: ListingAreaModel,
  area?: ListingAreaKey
): string {
  // Booking links have no NabaPresence draft, but nothing goes out unreviewed:
  // each change is prepared, reviewed and approved, then sent separately.
  if (area === "reviewLink")
    return "Nothing here changes the listing on Google: the link sends guests to Google’s own review form."
  if (area === "booking")
    return "No draft is kept here: review each link change, approve it, then send it to Google as a separate step."
  if (area === "people")
    return "Administrator and invitation changes are reviewed and approved before sending. Google's acknowledgement and independent access confirmation are separate."
  // One path for the profile: every edit goes through Review changes, which
  // lists both kinds together and says where each goes.
  if (area === "profile")
    return "Review changes lists every edit before anything reaches Google. The name, description, phone and website can also be saved here first."
  switch (model) {
    case "canonical":
      return "Saved here first; nothing reaches Google until you review and publish."
    case "google_direct":
      return "Changes here go to Google straight away."
    case "lifecycle":
      return "Each post is drafted, approved if your policy asks, then published."
    case "reviewed":
      return "Review the exact request, approve it, then send. Google confirmation is checked separately."
    case "inbound":
      return "Google's changes wait here until you accept or ignore them. Accepting changes NabaPresence's copy only."
    case "local":
      return "Nothing here changes your Google listing. The link and QR code just send guests to Google’s own review form."
  }
}
