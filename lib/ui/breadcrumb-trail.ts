import type { Crumb } from "@/components/ui/breadcrumb"
import { SETTINGS_SECTION_LABELS } from "@/lib/settings/areas"

export type TrailInput = {
  pathname: string
  clients: { id: string; name: string }[]
  locations: {
    id: string
    name: string
    clientId?: string | null
    clientName?: string | null
  }[]
  /** Business mode has no client layer: no client crumbs, no /clients trail. */
  mode?: "business" | "agency"
}

const LISTING_AREAS: Record<string, string> = {
  profile: "Business profile",
  hours: "Opening hours",
  booking: "Booking links",
  photos: "Photos",
  posts: "Posts",
  menu: "Food menu",
  people: "People",
  verification: "Verification",
  suggestions: "Suggested updates",
  changes: "Review & publish",
}

const TOP_LEVEL: Record<string, string> = {
  inbox: "Inbox",
  listings: "Listings",
  clients: "Clients",
  calendar: "Calendar",
  reports: "Reports",
  notifications: "Notifications",
  team: "Team",
  settings: "Settings",
  setup: "Setup",
}

// The section names the Settings tabs use, read from the one settings area
// list (lib/settings/areas.ts), so the trail and the phone back control name
// every /settings/<section> page the way its tab and h1 do, with no second
// copy to fall out of step. /settings itself is just "Settings".
const SETTINGS_SECTIONS = SETTINGS_SECTION_LABELS

/**
 * The breadcrumb trail for a path.
 *
 * Derived from the URL plus the client and location lists the shell already
 * has, rather than pushed up from the page through context. Pages sit behind
 * their own client-component boundaries, so a context set deep in the tree and
 * read in the topbar is both fragile and late — this way the trail is correct
 * on the first paint and there is one place to read it from.
 *
 * Pure, so the mapping is testable without rendering anything.
 */
export function breadcrumbTrail({
  pathname,
  clients,
  locations,
  mode = "agency",
}: TrailInput): Crumb[] {
  const business = mode === "business"
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 0) return []
  const [first, second, third] = segments

  // Composing a bulk change and following one are both "Bulk change", and
  // both go back up to Listings, where a bulk change starts.
  if (first === "listings" && second === "bulk") {
    return [{ label: "Listings", href: "/listings" }, { label: "Bulk change" }]
  }

  if (first === "listings" && second) {
    const location = locations.find((entry) => entry.id === second)
    if (!location) return [{ label: "Listings", href: "/listings" }]
    const area = third ? LISTING_AREAS[third] : undefined
    return [
      { label: "Listings", href: "/listings" },
      ...(business
        ? []
        : location.clientId && location.clientName
          ? [
              {
                label: location.clientName,
                href: `/clients/${location.clientId}`,
              },
            ]
          : // A listing nobody has filed yet says so, which is what the operator
            // needs to know when they arrive here from a search.
            [{ label: "Unfiled", href: "/listings" }]),
      area
        ? { label: location.name, href: `/listings/${location.id}` }
        : { label: location.name },
      ...(area ? [{ label: area }] : []),
    ]
  }

  if (business && first === "clients") return []

  // Setup lives under Clients, or under Listings in a business (SET-11), so
  // its trail says so, as the tab bar and the sidebar do.
  if (first === "setup") {
    return [
      business
        ? { label: "Listings", href: "/listings" }
        : { label: "Clients", href: "/clients" },
      { label: "Setup" },
    ]
  }

  if (first === "clients" && second) {
    if (second === "new") {
      return [{ label: "Clients", href: "/clients" }, { label: "New client" }]
    }
    const client = clients.find((entry) => entry.id === second)
    const clientCrumb = client
      ? { label: client.name, href: `/clients/${client.id}` }
      : { label: "Client" }
    return [
      { label: "Clients", href: "/clients" },
      third ? clientCrumb : { label: clientCrumb.label },
      ...(third === "settings" ? [{ label: "Settings" }] : []),
    ]
  }

  if (first === "settings") {
    // An own key only, so a stray /settings/constructor isn't "named" by
    // the object prototype.
    const section =
      second && Object.hasOwn(SETTINGS_SECTIONS, second)
        ? SETTINGS_SECTIONS[second]
        : undefined
    return [
      { label: "Settings", href: section ? "/settings" : undefined },
      ...(section ? [{ label: section }] : []),
    ]
  }

  const label = TOP_LEVEL[first]
  return label ? [{ label }] : []
}

/** A trail drawn with its middle folded into one "…" entry. */
export type FoldedCrumb = Crumb & {
  /** The crumbs the "…" stands for, in trail order (never empty). */
  folded?: Crumb[]
}

/**
 * The desk toolbar's trail, folded so it never grows past `max` entries: the
 * first crumb (where the trail starts), a "…" standing for the middle ones,
 * and the last (the page). A listing area is Listings / client / listing /
 * area, and the listing's name already sits in the page header beside its
 * switcher, so repeating it here only crowded the strip (DSK-05). A trail
 * that fits is returned as it is.
 */
export function foldTrail(crumbs: Crumb[], max = 3): FoldedCrumb[] {
  if (max < 3 || crumbs.length <= max) return crumbs
  const keepAtEnd = max - 2
  return [
    crumbs[0],
    { label: "…", folded: crumbs.slice(1, crumbs.length - keepAtEnd) },
    ...crumbs.slice(crumbs.length - keepAtEnd),
  ]
}
