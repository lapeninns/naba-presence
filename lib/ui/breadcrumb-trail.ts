import type { Crumb } from "@/components/ui/breadcrumb"

export type TrailInput = {
  pathname: string
  clients: { id: string; name: string }[]
  locations: { id: string; name: string; clientId?: string | null; clientName?: string | null }[]
}

const LOCATION_SECTIONS: Record<string, string> = {
  hours: "Hours",
  photos: "Photos",
  posts: "Posts",
  menu: "Menu",
  booking: "Booking",
  performance: "Performance",
  "business-information": "Business info",
  industry: "Industry",
  administration: "Access",
}

const TOP_LEVEL: Record<string, string> = {
  home: "Home",
  inbox: "Inbox",
  clients: "Clients",
  locations: "All locations",
  reports: "Reports",
  team: "Team",
  settings: "Settings",
  setup: "Setup",
}

const SETTINGS_SECTIONS: Record<string, string> = {
  compliance: "Compliance",
  connections: "Connections",
  ops: "Operations",
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

  if (first === "locations" && second) {
    const location = locations.find((entry) => entry.id === second)
    if (!location) return [{ label: "All locations", href: "/locations" }]
    const section = third ? LOCATION_SECTIONS[third] : undefined
    return [
      { label: "Clients", href: "/clients" },
      location.clientId && location.clientName
        ? { label: location.clientName, href: `/clients/${location.clientId}` }
        : // A listing nobody has filed yet says so, which is what the operator
          // needs to know when they arrive here from a search.
          { label: "Unassigned", href: "/locations" },
      { label: location.name, href: `/locations/${location.id}` },
      ...(section ? [{ label: section }] : []),
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
