"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

// Mirrors components/settings/settings-nav.tsx. Menu and Booking sit high
// because for a small business they are content the owner edits often, not
// advanced settings — but they stay sub-tabs rather than sidebar items so the
// primary nav doesn't grow past the point where it needs grouping.
//
// None of these labels may be "Photos", "Posts" or "Business profile": those
// are primary-nav labels, and routing.spec.ts looks links up by accessible
// name.
const AREAS = [
  { href: "/profile", label: "Profile", consoleGated: false },
  { href: "/profile/hours", label: "Hours", consoleGated: false },
  { href: "/profile/menu", label: "Menu", consoleGated: false },
  { href: "/profile/booking", label: "Booking", consoleGated: false },
  { href: "/profile/details", label: "Details", consoleGated: false },
  // GET /api/locations/[id]/industry is owner/admin-only server-side; hiding
  // the link for other roles avoids a reachable 403, same as LocationTabNav.
  { href: "/profile/industry", label: "Industry", consoleGated: true },
]

export function ProfileNav({ role }: { role: string | null }) {
  const pathname = usePathname()
  const canManageConsoles = role === "owner" || role === "admin"
  const visible = AREAS.filter((area) => !area.consoleGated || canManageConsoles)

  return (
    <nav aria-label="Business profile sections" className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {visible.map((area) => {
          // Exact match for the index route, prefix for the rest — otherwise
          // /profile would light up on every sub-route.
          const isActive =
            area.href === "/profile"
              ? pathname === "/profile"
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
