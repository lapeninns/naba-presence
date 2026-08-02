"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

const TABS = [
  { segment: "", label: "Profile" },
  { segment: "hours", label: "Hours" },
  { segment: "photos", label: "Photos" },
  { segment: "posts", label: "Posts" },
  { segment: "booking", label: "Booking" },
  { segment: "menu", label: "Menu" },
  { segment: "performance", label: "Performance" },
  { segment: "business-information", label: "Business info" },
  { segment: "industry", label: "Industry", consoleGated: true },
  { segment: "administration", label: "Administration", consoleGated: true },
] as const

export function LocationTabNav({
  locationId,
  canManageConsoles,
}: {
  locationId: string
  canManageConsoles: boolean
}) {
  const pathname = usePathname()
  const base = `/locations/${locationId}`
  const activeSegment = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, "") : ""
  const activeRef = useRef<HTMLAnchorElement | null>(null)
  // Industry and Administration GET are owner/admin-only server-side —
  // hiding them for other roles here avoids a reachable 403 on tab click.
  const tabs = TABS.filter((tab) => !("consoleGated" in tab && tab.consoleGated) || canManageConsoles)

  useEffect(() => {
    // jsdom (unit tests) doesn't implement scrollIntoView — guard so the
    // scroll affordance is a no-op there instead of throwing.
    if (typeof activeRef.current?.scrollIntoView === "function") {
      activeRef.current.scrollIntoView({ inline: "nearest", block: "nearest" })
    }
  }, [activeSegment])

  return (
    <nav aria-label="Location sections" className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {tabs.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base
          const isActive = activeSegment === tab.segment
          return (
            <li key={tab.label}>
              <Link
                ref={isActive ? activeRef : undefined}
                href={href}
                prefetch
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center border-b-2 px-3 py-2 text-ui font-medium transition-colors duration-(--nr-duration-fast) focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
