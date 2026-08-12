/**
 * Job-oriented location workspace IA. URLs stay the same; only grouping and
 * presentation change (docs/frontend-backend-feature-map.md).
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
    id: "overview",
    label: "Overview",
    tabs: [{ segment: "", label: "Profile" }],
  },
  {
    id: "profile",
    label: "Profile",
    tabs: [
      { segment: "business-information", label: "Business info" },
      { segment: "hours", label: "Hours" },
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
    tabs: [
      { segment: "administration", label: "Administration", consoleGated: true },
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
