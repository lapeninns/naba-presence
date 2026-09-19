"use client"

import {
  Building2,
  ChevronRight,
  Inbox,
  Settings,
  Store,
  TrendingUp,
  Users,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

import { StatusPill } from "@/components/ui/status-pill"
import { healthTone } from "@/lib/clients/health"
import type { ClientHealth } from "@/lib/clients/health"
import { cn } from "@/lib/utils"

/**
 * The four places an operator works, in the order they are visited.
 *
 * Home is gone: it was a page of numbers whose every link led to the Inbox,
 * so the Inbox is the landing page and the numbers live in its Today strip.
 * Listings is the Google Business Profiles themselves, health first; Clients
 * is who they belong to.
 */
const NAV_ITEMS = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/listings", label: "Listings", icon: Store },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/reports", label: "Reports", icon: TrendingUp },
] as const

/**
 * Team and Settings are organisation admin, visited to change who may do
 * what rather than to do it. They sit behind one disclosure row so the
 * primary list stays three items long, and the disclosure opens itself
 * whenever one of them is the current page.
 */
const MORE_ITEMS = [
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
] as const

/** Recent clients shown beneath the Clients item. */
const MAX_PINNED_CLIENTS = 6

const MORE_STORAGE_KEY = "np.nav.more"

export type NavClient = { id: string; name: string; health: ClientHealth }

function isActivePath(pathname: string | null, href: string) {
  if (!pathname) return false
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** `Clients` is the client pages only; a listing belongs to Listings. */
function isClientsActive(pathname: string | null) {
  return isActivePath(pathname, "/clients")
}

function isMoreActive(pathname: string | null) {
  return MORE_ITEMS.some((item) => isActivePath(pathname, item.href))
}

/**
 * The sidebar row: a selection pill when current, a soft grey on hover, and a
 * spring on press. Shared by the destinations, the More disclosure and the
 * pinned clients so the three never drift apart in shape.
 */
const NAV_ROW_CLASS = cn(
  "flex w-full items-center gap-2.5 rounded-(--np-radius-control) px-2.5 text-ui font-medium",
  "transition duration-(--np-duration-fast) ease-spring-snappy active:scale-[0.98]",
  "focus-halo focus-visible:outline-none",
  // 32px where a cursor drives the persistent sidebar, the 44px comfortable
  // target wherever the pointer is a finger — which is the same rows,
  // reached through the mobile navigation sheet.
  "h-8 pointer-coarse:h-11"
)

/**
 * The operator's last choice for the More disclosure, kept for the session.
 *
 * Read through `useSyncExternalStore` rather than an effect: the server
 * cannot see session storage, so its snapshot is "no choice yet" and the
 * client's first render agrees with it before the stored value takes over.
 */
const moreListeners = new Set<() => void>()

function subscribeMore(listener: () => void) {
  moreListeners.add(listener)
  return () => {
    moreListeners.delete(listener)
  }
}

function readStoredMore(): boolean | null {
  try {
    const raw = window.sessionStorage.getItem(MORE_STORAGE_KEY)
    return raw === null ? null : raw === "open"
  } catch {
    return null
  }
}

function writeStoredMore(open: boolean) {
  try {
    window.sessionStorage.setItem(MORE_STORAGE_KEY, open ? "open" : "closed")
  } catch {
    // Private mode or blocked storage: the disclosure simply forgets.
  }
  for (const listener of moreListeners) listener()
}

/**
 * Open while Team or Settings is the current page, otherwise whatever the
 * operator last chose this session.
 */
function useMoreOpen(pathname: string | null) {
  const active = isMoreActive(pathname)
  const chosen = React.useSyncExternalStore(
    subscribeMore,
    readStoredMore,
    () => null
  )

  const open = active || chosen === true
  const toggle = () => {
    // Collapsing while a More page is current would hide the current page's
    // own row, so the toggle is a no-op there; it reads as "already open".
    if (active) return
    writeStoredMore(!open)
  }
  return { open, toggle }
}

function NavRow({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
  nested,
}: {
  href: string
  label: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  active: boolean
  onNavigate?: () => void
  nested?: boolean
}) {
  return (
    <Link
      href={href}
      prefetch
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        NAV_ROW_CLASS,
        nested && "pl-9",
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
      <span className="truncate">{label}</span>
    </Link>
  )
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
  const more = useMoreOpen(pathname)
  const moreListId = React.useId()

  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      <ul className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/clients"
              ? isClientsActive(pathname)
              : isActivePath(pathname, item.href)
          return (
            <React.Fragment key={item.href}>
              <li>
                <NavRow
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={active}
                  onNavigate={onNavigate}
                />
              </li>
              {item.href === "/clients" && pinned.length > 0
                ? pinned.map((client) => {
                    const href = `/clients/${client.id}`
                    const clientActive = pathname === href
                    return (
                      <li key={client.id}>
                        <Link
                          href={href}
                          aria-current={clientActive ? "page" : undefined}
                          onClick={onNavigate}
                          className={cn(
                            NAV_ROW_CLASS,
                            "h-7 gap-2 pl-9 font-normal pointer-coarse:h-10",
                            clientActive
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
            </React.Fragment>
          )
        })}

        <li>
          <button
            type="button"
            aria-expanded={more.open}
            aria-controls={moreListId}
            onClick={more.toggle}
            className={cn(NAV_ROW_CLASS, "text-ink hover:bg-fill-tertiary")}
          >
            <ChevronRight
              className={cn(
                "size-4 shrink-0 text-ink-muted transition-transform duration-(--np-duration-fast) ease-spring-snappy",
                more.open && "rotate-90"
              )}
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="truncate">More</span>
          </button>
          <ul
            id={moreListId}
            hidden={!more.open}
            className="mt-0.5 flex flex-col gap-0.5"
          >
            {MORE_ITEMS.map((item) => (
              <li key={item.href}>
                <NavRow
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={isActivePath(pathname, item.href)}
                  onNavigate={onNavigate}
                  nested
                />
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </nav>
  )
}

export {
  Nav,
  NAV_ITEMS,
  MORE_ITEMS,
  MAX_PINNED_CLIENTS,
  isClientsActive,
  isMoreActive,
}
