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
  | "suggestions"
  | "photos"
  | "posts"
  | "booking"
  | "menu"
  | "performance"
  | "access"
  | "verification"

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
      // One tab, one listing. "Business info" and "Industry" were separate tabs
      // editing the same profile through different Google APIs; they are now
      // sections of this editor, and their old paths redirect here.
      { segment: "", label: "Business profile" },
      { segment: "hours", label: "Hours" },
      // Its own segment, not a card above two editors' fields: accepting what
      // Google changed is a different job from editing the listing.
      { segment: "suggestions", label: "Suggested updates" },
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
    tabs: [
      { segment: "access", label: "People", consoleGated: true },
      { segment: "verification", label: "Verification", consoleGated: true },
    ],
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
