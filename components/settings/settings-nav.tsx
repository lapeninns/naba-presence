"use client"

import { usePathname } from "next/navigation"

import { TabNav } from "@/components/ui/tabs"
import { settingsGatingFromRole } from "@/lib/settings/gating"

// Team is now a primary destination, not a settings tab: for an agency, who
// can act on which client is daily work. Listing is gone entirely — it
// administered a location from a page nowhere near it, and that now lives in
// the location's own Access section.
//
// Compliance is gone too. Data-subject requests, legal holds
// and record export are still served by `app/api/privacy/**` and
// `app/api/legal-holds`. Operations returned for owners and admins as the
// operational recovery view (scheduler, sync freshness, queued work,
// unresolved writes, email delivery) the GBP operations brief requires.
const AREAS: {
  href: string
  label: string
  capability: "always" | "canManageConnections"
}[] = [
  { href: "/settings", label: "Policy", capability: "always" },
  { href: "/settings/notifications", label: "Notifications", capability: "always" },
  {
    href: "/settings/connections",
    label: "Google connections",
    capability: "canManageConnections",
  },
  {
    href: "/settings/operations",
    label: "Operations",
    capability: "canManageConnections",
  },
]

/**
 * The settings sub-navigation (reference `settings-subnav`): link tabs under
 * each settings page's header, the current one underlined in ink. A member
 * or viewer sees only Policy; Google connections is for owners and admins.
 */
export function SettingsNav({
  role,
  className,
}: {
  role: string | null
  className?: string
}) {
  const pathname = usePathname()
  const caps = settingsGatingFromRole(role)
  const items = AREAS.filter(
    (area) => area.capability === "always" || caps[area.capability]
  ).map((area) => ({
    href: area.href,
    label: area.label,
    current:
      area.href === "/settings"
        ? pathname === "/settings"
        : pathname === area.href || pathname.startsWith(`${area.href}/`),
  }))

  return (
    <TabNav
      aria-label="Settings sections"
      items={items}
      className={className}
    />
  )
}
