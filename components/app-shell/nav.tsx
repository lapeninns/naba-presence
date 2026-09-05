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
  return (
    isActivePath(pathname, "/clients") || isActivePath(pathname, "/locations")
  )
}

/**
 * The sidebar row: a selection pill when current, a soft grey on hover, and a
 * spring on press. Shared by the six destinations and the pinned clients so
 * the two never drift apart in shape.
 */
const NAV_ROW_CLASS = cn(
  "flex items-center gap-2.5 rounded-(--np-radius-control) px-2.5 text-ui font-medium",
  "transition duration-(--np-duration-fast) ease-spring-snappy active:scale-[0.98]",
  "focus-halo focus-visible:outline-none"
)

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
              className="block px-2.5 pb-1.5 text-caption font-medium text-ink-muted"
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
                        NAV_ROW_CLASS,
                        "h-8",
                        active
                          ? "bg-accent-tint text-accent-ink"
                          : "text-ink hover:bg-fill-tertiary"
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-4 shrink-0",
                          active ? "text-accent-ink" : "text-ink-muted"
                        )}
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <span className="truncate">{item.label}</span>
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
                            NAV_ROW_CLASS,
                            "h-7 gap-2 pl-9 font-normal",
                            active
                              ? "bg-accent-tint font-medium text-accent-ink"
                              : "text-ink-muted hover:bg-fill-tertiary hover:text-ink"
                          )}
                        >
                          <StatusPill
                            tone={healthTone(client.health)}
                            variant="dot"
                          />
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
