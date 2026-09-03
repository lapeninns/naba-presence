"use client"

import {
  Building2,
  Home,
  Inbox,
  Settings,
  TrendingUp,
  Users,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { StatusPill } from "@/components/ui/status-pill"
import { healthTone, type ClientHealth } from "@/lib/clients/health"
import { cn } from "@/lib/utils"

// Six items in three groups. The group labels are plain <span>s referenced by
// aria-labelledby on each list -- NOT headings. `heading-order` and
// `page-has-heading-one` are pinned axe rules across the e2e suite, and the
// ARIA-correct way to title a group with a heading would put an <h2> in the
// sidebar ahead of the page's own <h1>.
const NAV_GROUPS = [
  {
    id: "work",
    label: "Work",
    items: [
      { href: "/home", label: "Home", icon: Home },
      { href: "/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    id: "clients",
    label: "Clients",
    items: [{ href: "/clients", label: "Clients", icon: Building2 }],
  },
  {
    id: "org",
    label: "Organisation",
    items: [
      { href: "/reports", label: "Reports", icon: TrendingUp },
      { href: "/team", label: "Team", icon: Users },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
] as const

/** Recent clients shown beneath the Clients item. */
const MAX_PINNED_CLIENTS = 6

export type NavClient = { id: string; name: string; health: ClientHealth }

function isActivePath(pathname: string | null, href: string) {
  if (!pathname) return false
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * `Clients` also lights up on `/locations/*`: the location workspace is
 * reached through a client and its breadcrumb says so, so leaving the sidebar
 * with nothing selected there would strand the user.
 */
function isClientsActive(pathname: string | null) {
  return isActivePath(pathname, "/clients") || isActivePath(pathname, "/locations")
}

function Nav({
  onNavigate,
  clients = [],
}: {
  onNavigate?: () => void
  clients?: NavClient[]
}) {
  const pathname = usePathname()
  const pinned = clients.slice(0, MAX_PINNED_CLIENTS)

  return (
    <nav aria-label="Primary" className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => {
        const labelId = `nav-group-${group.id}`
        return (
          <div key={group.id} role="group" aria-labelledby={labelId}>
            <span
              id={labelId}
              className="block px-2.5 pb-1 text-caption font-medium tracking-wide text-ink-faint uppercase"
            >
              {group.label}
            </span>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const active =
                  item.href === "/clients"
                    ? isClientsActive(pathname)
                    : isActivePath(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      prefetch
                      aria-current={active ? "page" : undefined}
                      onClick={onNavigate}
                      className={cn(
                        "flex items-center gap-2.5 rounded-(--np-radius-control) px-2.5 py-1.5 text-ui font-medium transition-colors duration-(--np-duration-fast)",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar focus-visible:outline-none",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/75 hover:bg-[var(--np-hover-bg)] hover:text-sidebar-foreground"
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                )
              })}
              {group.id === "clients" && pinned.length > 0
                ? pinned.map((client) => {
                    const href = `/clients/${client.id}`
                    const active = pathname === href
                    return (
                      <li key={client.id}>
                        <Link
                          href={href}
                          aria-current={active ? "page" : undefined}
                          onClick={onNavigate}
                          className={cn(
                            "flex items-center gap-2 rounded-(--np-radius-control) py-1 pr-2.5 pl-9 text-ui transition-colors duration-(--np-duration-fast)",
                            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar focus-visible:outline-none",
                            active
                              ? "bg-surface-sunken font-medium text-ink"
                              : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
                          )}
                        >
                          <StatusPill tone={healthTone(client.health)} variant="dot" />
                          <span className="truncate">{client.name}</span>
                        </Link>
                      </li>
                    )
                  })
                : null}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

export { Nav, NAV_GROUPS, MAX_PINNED_CLIENTS, isClientsActive }
