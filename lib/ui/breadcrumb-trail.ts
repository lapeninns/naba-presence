import type { Crumb } from "@/components/ui/breadcrumb"

export type TrailInput = {
  pathname: string
  clients: { id: string; name: string }[]
  locations: { id: string; name: string; clientId?: string | null; clientName?: string | null }[]
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
  reports: "Reports",
  team: "Team",
  settings: "Settings",
  setup: "Setup",
}

const SETTINGS_SECTIONS: Record<string, string> = {
  connections: "Connections",
}

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
export function breadcrumbTrail({ pathname, clients, locations }: TrailInput): Crumb[] {
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 0) return []
  const [first, second, third] = segments

  if (first === "listings" && second) {
    const location = locations.find((entry) => entry.id === second)
    if (!location) return [{ label: "Listings", href: "/listings" }]
    const area = third ? LISTING_AREAS[third] : undefined
    return [
      { label: "Listings", href: "/listings" },
      ...(location.clientId && location.clientName
        ? [{ label: location.clientName, href: `/clients/${location.clientId}` }]
        : // A listing nobody has filed yet says so, which is what the operator
          // needs to know when they arrive here from a search.
          [{ label: "Unfiled", href: "/listings" }]),
      area
        ? { label: location.name, href: `/listings/${location.id}` }
        : { label: location.name },
      ...(area ? [{ label: area }] : []),
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
    const section = second ? SETTINGS_SECTIONS[second] : undefined
    return [
      { label: "Settings", href: section ? "/settings" : undefined },
      ...(section ? [{ label: section }] : []),
    ]
  }

  const label = TOP_LEVEL[first]
  return label ? [{ label }] : []
}
