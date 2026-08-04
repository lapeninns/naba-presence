"use client"

import {
  Images,
  LayoutDashboard,
  MapPin,
  Megaphone,
  Settings,
  Star,
  Store,
  TrendingUp,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

// Labels are the single-business vocabulary; the hrefs deliberately are not.
// /home and /inbox keep their paths because moving a URL that already ships,
// already has redirects pointing at it, and already has test coverage buys the
// user nothing — nobody reads the address bar. The page <h1>s match these
// labels so aria-current never points at a link whose name disagrees with the
// heading it lands on.
// Deliberately flat — no "Manage"/"Account" section headings. The ARIA-correct
// way to group these puts an <h2> in the sidebar ahead of the page <h1>, and
// `heading-order` plus `page-has-heading-one` are pinned axe rules across the
// e2e suite. The visual break before Settings comes from `dividerBefore`,
// which renders as a border on the <li> and touches nothing in the a11y tree.
const NAV_ITEMS = [
  { href: "/home", label: "Overview", icon: LayoutDashboard, prefetch: true },
  { href: "/inbox", label: "Reviews", icon: Star, prefetch: true },
  { href: "/profile", label: "Business profile", icon: Store, prefetch: true },
  { href: "/photos", label: "Photos", icon: Images, prefetch: true },
  { href: "/posts", label: "Posts", icon: Megaphone, prefetch: true },
  { href: "/performance", label: "Performance", icon: TrendingUp, prefetch: true },
  { href: "/settings", label: "Settings", icon: Settings, prefetch: true, dividerBefore: true },
] as const

// Delisted from the default nav: the flat IA resolves one primary business, so
// a directory is noise for the single-location owner this product is for. It
// comes back for orgs that genuinely have more than one location — otherwise
// they would see one business with no in-app route to the others, which is the
// same harm as redirecting their bookmarks, just arriving by omission.
//
// `/locations` and every `/locations/[id]/*` route keep working either way.
const LOCATIONS_ITEM = {
  href: "/locations",
  label: "Locations",
  icon: MapPin,
  prefetch: true,
  dividerBefore: true,
} as const

function navItemsFor({ multiLocation }: { multiLocation: boolean }) {
  if (!multiLocation) return NAV_ITEMS
  const settingsIndex = NAV_ITEMS.findIndex((item) => item.href === "/settings")
  return [
    ...NAV_ITEMS.slice(0, settingsIndex),
    LOCATIONS_ITEM,
    ...NAV_ITEMS.slice(settingsIndex),
  ]
}

function isActivePath(pathname: string | null, href: string) {
  if (!pathname) return false
  return pathname === href || pathname.startsWith(`${href}/`)
}

function Nav({
  onNavigate,
  multiLocation = false,
}: {
  onNavigate?: () => void
  multiLocation?: boolean
}) {
  const pathname = usePathname()
  const items = navItemsFor({ multiLocation })
  return (
    <nav aria-label="Primary">
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon
          // Nothing here lights up on /locations/[id]/* when Locations is
          // delisted, and that is correct: the workspace's own tab nav is the
          // wayfinding signal there, and highlighting flat "Photos" would
          // claim a different business's photos.
          const active = isActivePath(pathname, item.href)
          return (
            <li
              key={item.href}
              className={cn(
                "dividerBefore" in item && item.dividerBefore &&
                  "mt-2 border-t border-sidebar-border/70 pt-2"
              )}
            >
              {/* Every primary route ships and is prefetched. */}
              <Link
                href={item.href}
                prefetch={item.prefetch}
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

export { Nav, NAV_ITEMS, LOCATIONS_ITEM, navItemsFor }
