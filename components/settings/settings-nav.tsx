"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { settingsGatingFromRole } from "@/lib/settings/gating"
import { cn } from "@/lib/utils"

// Team is now a primary destination, not a settings tab: for an agency, who
// can act on which client is daily work. Listing is gone entirely — it
// administered a location from a page nowhere near it, and that now lives in
// the location's own Access section.
const AREAS = [
  { href: "/settings", label: "Policy", capability: "always" as const },
  { href: "/settings/compliance", label: "Compliance", capability: "canViewCompliance" as const },
  { href: "/settings/connections", label: "Connections", capability: "canManageConnections" as const },
  { href: "/settings/ops", label: "Operations", capability: "canManageConnections" as const },
]

export function SettingsNav({ role }: { role: string | null }) {
  const pathname = usePathname()
  const caps = settingsGatingFromRole(role)
  const visible = AREAS.filter(
    (area) => area.capability === "always" || caps[area.capability]
  )

  return (
    <nav aria-label="Settings sections" className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {visible.map((area) => {
          const isActive =
            area.href === "/settings"
              ? pathname === "/settings"
              : pathname === area.href || pathname.startsWith(`${area.href}/`)
          return (
            <li key={area.href}>
              <Link
                href={area.href}
                prefetch
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center border-b-2 px-3 py-2 text-ui font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {area.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
