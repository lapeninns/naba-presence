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

/**
 * One segmented control of links (see LocationTabNav for why links and not
 * ARIA tabs): a grey track with a white thumb on the current area from `md`,
 * and a scrolling capsule strip below it.
 */
export function ProfileNav({ role }: { role: string | null }) {
  const pathname = usePathname()
  const canManageConsoles = role === "owner" || role === "admin"
  const visible = AREAS.filter(
    (area) => !area.consoleGated || canManageConsoles
  )

  return (
    <nav
      aria-label="Business profile sections"
      className="-mx-5 overflow-x-auto px-5 md:mx-0 md:px-0"
    >
      <ul className="flex min-w-max items-center gap-1 md:inline-flex md:h-(--np-control-h) md:min-w-0 md:gap-0.5 md:rounded-(--np-radius-control) md:bg-fill md:p-0.5">
        {visible.map((area) => {
          // Exact match for the index route, prefix for the rest — otherwise
          // /profile would light up on every sub-route.
          const isActive =
            area.href === "/profile"
              ? pathname === "/profile"
              : pathname === area.href || pathname.startsWith(`${area.href}/`)
          return (
            <li key={area.href} className="flex md:h-full">
              <Link
                href={area.href}
                prefetch
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center rounded-(--np-radius-pill) bg-fill px-3 text-ui font-medium whitespace-nowrap text-ink-muted focus-halo select-none",
                  "transition-[color,background-color,transform,box-shadow] duration-(--np-duration-fast) ease-spring-snappy",
                  "hover:text-ink active:scale-[0.98]",
                  "md:h-full md:rounded-[calc(var(--np-radius-control)-2px)] md:bg-transparent",
                  isActive &&
                    "bg-accent-tint text-accent-ink md:bg-surface md:text-ink md:shadow-(--np-shadow-raised)"
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
