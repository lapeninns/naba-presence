"use client"

import {
  BarChart3,
  Building2,
  ChevronDown,
  ChevronRight,
  Inbox,
  Settings,
  Store,
  Users,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { healthLabel, healthTone } from "@/lib/clients/health"
import { settingsGatingFromRole } from "@/lib/settings/gating"
import type { ClientHealth } from "@/lib/clients/health"
import { TONE_CLASSES } from "@/lib/ui/status-tone"
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
  { href: "/reports", label: "Reports", icon: BarChart3 },
] as const

/**
 * Team and Settings are organisation admin, visited to change who may do
 * what rather than to do it. They sit behind one disclosure row so the
 * primary list stays four items long, and the disclosure opens itself
 * whenever one of them is the current page.
 */
const MORE_ITEMS: readonly {
  href: string
  label: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  /** Owners and admins only; see `Nav`'s `role`. */
  adminOnly?: boolean
}[] = [
  { href: "/team", label: "Team", icon: Users, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
]

/** Recent clients shown beneath the Clients item. */
const MAX_PINNED_CLIENTS = 6

const MORE_STORAGE_KEY = "np.nav.more"

export type NavClient = { id: string; name: string; health: ClientHealth }

/**
 * `responsive` is the persistent column: a 240px sidebar above 1180px and a
 * 64px icon rail from 768 to 1180, drawn by the same markup so the two never
 * disagree. `full` always shows labels; the mobile sheet uses it.
 */
type NavLayout = "full" | "responsive"

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
 * The sidebar row: an accent tint and a 3px accent bar when current (so the
 * current page reads in greyscale and forced colours too), a grey fill on
 * hover. Shared by the destinations and the More disclosure so they never
 * drift apart in shape. 34px where a cursor drives it, 44px on touch and in
 * the phone sheet.
 */
function rowClass(layout: NavLayout) {
  return cn(
    "relative flex min-h-[34px] w-full items-center gap-2.5 rounded-md px-2.5 text-left text-ui font-medium text-ink",
    "transition-colors duration-(--np-duration-fast) ease-out-strong hover:bg-fill",
    "focus-halo focus-visible:outline-none",
    "max-md:min-h-11 pointer-coarse:min-h-11",
    "aria-[current=page]:bg-accent-tint aria-[current=page]:font-semibold aria-[current=page]:text-accent-ink",
    "aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-[7px] aria-[current=page]:before:left-0 aria-[current=page]:before:w-[3px] aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-primary aria-[current=page]:before:content-['']",
    // The icon rail band (768-1180px), written out in full so Tailwind's
    // scanner sees every class.
    layout === "responsive" &&
      "md:max-[1181px]:min-h-10 md:max-[1181px]:justify-center md:max-[1181px]:px-0 md:max-[1181px]:aria-[current=page]:before:-left-2"
  )
}

/** A label that the rail hides visually but keeps as the accessible name. */
function railLabel(layout: NavLayout) {
  return cn("truncate", layout === "responsive" && "md:max-[1181px]:sr-only")
}

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
 *
 * On a More page the toggle still works: collapsing there is remembered for
 * that page only (arriving on it again opens the group, so the current row
 * is never hidden by a choice made elsewhere), and the collapsed row carries
 * the current-page accent so the operator can still see where they are.
 */
function useMoreOpen(pathname: string | null) {
  const active = isMoreActive(pathname)
  const chosen = React.useSyncExternalStore(
    subscribeMore,
    readStoredMore,
    () => null
  )
  const [collapsedOn, setCollapsedOn] = React.useState<string | null>(null)

  const open = active ? collapsedOn !== pathname : chosen === true
  const toggle = () => {
    if (active) {
      setCollapsedOn(open ? pathname : null)
      return
    }
    writeStoredMore(!open)
  }
  return { open, toggle, currentInside: active && !open }
}

/**
 * In the icon rail the label is only an accessible name, so a sighted
 * pointer user gets it back as a tooltip to the right of the icon. Outside
 * the rail the element renders as it is.
 */
function RailTip({
  rail,
  label,
  children,
}: {
  rail: boolean
  label: string
  children: React.ReactElement
}) {
  if (!rail) return children
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function NavRow({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
  count,
  countLabel,
  layout,
  rail,
}: {
  href: string
  label: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  active: boolean
  onNavigate?: () => void
  count?: number
  countLabel?: string
  layout: NavLayout
  rail: boolean
}) {
  const countId = React.useId()
  const showCount = typeof count === "number" && count > 0
  return (
    <>
      <RailTip rail={rail} label={label}>
        <Link
          href={href}
          prefetch
          aria-current={active ? "page" : undefined}
          // The count describes the row rather than naming it, so "Inbox"
          // stays the link's name for every locator and screen-reader list.
          // The description lives outside the link for the same reason.
          aria-describedby={showCount ? countId : undefined}
          onClick={onNavigate}
          className={rowClass(layout)}
        >
          <Icon
            className={cn(
              "size-4 shrink-0",
              active ? "text-accent-ink" : "text-ink-muted"
            )}
            strokeWidth={1.75}
            aria-hidden
          />
          <span className={railLabel(layout)}>{label}</span>
          {showCount ? (
            <span
              aria-hidden
              className={cn(
                "ml-auto font-mono text-[0.71875rem] tabular-nums",
                active ? "text-accent-ink" : "text-ink-muted",
                layout === "responsive" && "md:max-[1181px]:hidden"
              )}
            >
              {count}
            </span>
          ) : null}
          {showCount && layout === "responsive" ? (
            // The icon rail hides the count column, so the number rides on
            // the icon as a badge there instead of disappearing.
            <span
              aria-hidden
              data-slot="rail-count"
              className="absolute top-0.5 left-1/2 ml-0.5 hidden h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] leading-none text-primary-foreground tabular-nums md:max-[1181px]:inline-flex"
            >
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </Link>
      </RailTip>
      {showCount ? (
        <span id={countId} hidden>
          {countLabel ?? `${count}`}
        </span>
      ) : null}
    </>
  )
}

function Nav({
  onNavigate,
  clients = [],
  needsReply,
  layout = "full",
  rail = false,
  role,
}: {
  onNavigate?: () => void
  clients?: NavClient[]
  /** The Inbox's needs-reply count, when the app has it. */
  needsReply?: number
  layout?: NavLayout
  /** True while the responsive nav is drawn as the icon rail. */
  rail?: boolean
  /**
   * The session's role. Team is for owners and admins (the page answers
   * everyone else with Access denied), so it is left out for the rest, the
   * same rule the settings tabs apply. Undefined while unknown shows all.
   */
  role?: string | null
}) {
  const pathname = usePathname()
  const pinned = clients.slice(0, MAX_PINNED_CLIENTS)
  const more = useMoreOpen(pathname)
  const moreListId = React.useId()
  const moreCurrentId = React.useId()
  const moreItems = MORE_ITEMS.filter(
    (item) =>
      role === undefined ||
      item.adminOnly !== true ||
      settingsGatingFromRole(role).canManageTeam
  )
  const MoreIcon = more.open ? ChevronDown : ChevronRight

  return (
    <nav aria-label="Primary" className="flex flex-col">
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
                  layout={layout}
                  rail={rail}
                  count={item.href === "/inbox" ? needsReply : undefined}
                  countLabel={
                    item.href === "/inbox" && needsReply
                      ? `${needsReply} ${needsReply === 1 ? "review needs" : "reviews need"} a reply`
                      : undefined
                  }
                />
              </li>
              {item.href === "/clients" && pinned.length > 0
                ? pinned.map((client) => {
                    const href = `/clients/${client.id}`
                    const clientActive = pathname === href
                    return (
                      <li
                        key={client.id}
                        className={cn(
                          layout === "responsive" && "md:max-[1181px]:hidden"
                        )}
                      >
                        <Link
                          href={href}
                          aria-current={clientActive ? "page" : undefined}
                          onClick={onNavigate}
                          className={cn(
                            rowClass("full"),
                            "min-h-[30px] gap-2 pl-9 font-normal text-ink-secondary"
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              TONE_CLASSES[healthTone(client.health)].dot
                            )}
                          />
                          <span className="truncate">{client.name}</span>
                          <span className="sr-only">
                            , {healthLabel(client.health)}
                          </span>
                        </Link>
                      </li>
                    )
                  })
                : null}
            </React.Fragment>
          )
        })}

        <li>
          <RailTip rail={rail} label="More">
            <button
              type="button"
              aria-expanded={more.open}
              aria-controls={moreListId}
              aria-describedby={more.currentInside ? moreCurrentId : undefined}
              onClick={more.toggle}
              className={cn(
                rowClass(layout),
                more.currentInside && "text-accent-ink"
              )}
            >
              <MoreIcon
                className={cn(
                  "size-4 shrink-0",
                  more.currentInside ? "text-accent-ink" : "text-ink-muted"
                )}
                strokeWidth={1.75}
                aria-hidden
              />
              <span className={railLabel(layout)}>More</span>
            </button>
          </RailTip>
          {more.currentInside ? (
            <span id={moreCurrentId} hidden>
              Contains the current page
            </span>
          ) : null}
          <ul
            id={moreListId}
            hidden={!more.open}
            className="mt-0.5 flex flex-col gap-0.5"
          >
            {moreItems.map((item) => (
              <li key={item.href}>
                <NavRow
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={isActivePath(pathname, item.href)}
                  onNavigate={onNavigate}
                  layout={layout}
                  rail={rail}
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
