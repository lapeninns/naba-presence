"use client"

import {
  Inbox,
  LayoutDashboard,
  Settings,
  Store,
  TrendingUp,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/home", label: "Home", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/locations", label: "Locations", icon: Store },
  { href: "/performance", label: "Performance", icon: TrendingUp },
  { href: "/settings", label: "Settings", icon: Settings },
] as const

function isActivePath(pathname: string | null, href: string) {
  if (!pathname) return false
  return pathname === href || pathname.startsWith(`${href}/`)
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Primary">
      <ul className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = isActivePath(pathname, item.href)
          return (
            <li key={item.href}>
              {/* Only /home ships this milestone; the other four 404. Next's
                  default viewport prefetch would fire a background RSC
                  request for all five links on every dashboard load, and
                  Chrome's real "chrome" channel (local test/dev runs) never
                  reports the tab network-idle while one of those 404
                  prefetches is outstanding - re-enable once each route has
                  a real page. */}
              <Link
                href={item.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2.5 rounded-(--nr-radius-control) px-3 py-2 text-ui font-medium text-sidebar-foreground/75 transition-colors duration-(--nr-duration-fast)",
                  "focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export { Nav, NAV_ITEMS }
