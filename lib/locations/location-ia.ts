/**
 * The location workspace's sections.
 *
 * "Overview" is gone: it held a single tab labelled Profile, which meant the
 * first thing a user saw was a section heading duplicating the tab beneath it.
 * The profile IS the overview of a location, so it opens the Profile section
 * directly.
 *
 * Administration is relabelled "Access", which is what it actually contains:
 * who may edit the listing on Google, and whether it is verified.
 */
export type LocationTabSegment =
  | ""
  | "hours"
  | "photos"
  | "posts"
  | "booking"
  | "menu"
  | "performance"
  | "business-information"
  | "industry"
  | "administration"

export type LocationTabDef = {
  segment: LocationTabSegment
  label: string
  /** Owner/admin-only consoles (GET 403 for other roles). */
  consoleGated?: boolean
}

export type LocationIaSection = {
  id: string
  label: string
  tabs: LocationTabDef[]
}

export const LOCATION_IA_SECTIONS: LocationIaSection[] = [
  {
    id: "profile",
    label: "Profile",
    tabs: [
      { segment: "", label: "Profile" },
      // Two tabs editing one listing is the duplication this IA exists to
      // remove, but they still have separate save models; B5 merges them into
      // one editor at the section root and leaves this as a redirect. Until
      // then both stay reachable rather than one becoming a dead end.
      { segment: "business-information", label: "Business info" },
      { segment: "hours", label: "Hours" },
      // Industry stays a separate tab only while it remains a provider-shaped
      // console. B5 folds lodging, calls and healthcare into the profile
      // sections they belong to, gated by capability.
      { segment: "industry", label: "Industry", consoleGated: true },
    ],
  },
  {
    id: "content",
    label: "Content",
    tabs: [
      { segment: "photos", label: "Photos" },
      { segment: "posts", label: "Posts" },
      { segment: "menu", label: "Menu" },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    tabs: [{ segment: "booking", label: "Booking" }],
  },
  {
    id: "access",
    label: "Access",
    tabs: [{ segment: "administration", label: "Access", consoleGated: true }],
  },
  {
    id: "insights",
    label: "Insights",
    tabs: [{ segment: "performance", label: "Performance" }],
  },
]

export function visibleLocationSections(
  canManageConsoles: boolean
): LocationIaSection[] {
  return LOCATION_IA_SECTIONS.map((section) => ({
    ...section,
    tabs: section.tabs.filter(
      (tab) => !tab.consoleGated || canManageConsoles
    ),
  })).filter((section) => section.tabs.length > 0)
}
