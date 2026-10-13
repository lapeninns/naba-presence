"use client"

import { ChevronDown, ChevronRight } from "lucide-react"
import { usePathname } from "next/navigation"
import * as React from "react"

import { healthLabel, healthTone } from "@/lib/clients/health"
import type { ClientHealth } from "@/lib/clients/health"
import {
  DESTINATIONS,
  destinationHref,
  isActivePath,
  sidebarDestinations,
  type Destination,
} from "@/lib/navigation/destinations"
import { TONE_CLASSES } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"
import type { WorkspaceMode } from "@/lib/workspace/terms"

import { CountBadge } from "./count-badge"
import { ShellLink } from "./shell-link"

/**
 * The primary destinations for a workspace mode, as the desk sidebar lists
 * them (lib/navigation/destinations.ts holds the one registry; this is its
 * sidebar view, kept under the name the shell's tests import).
 */
export function navItemsFor(mode: WorkspaceMode, hideCalendar = false) {
  return sidebarDestinations({ role: "owner", mode, hideCalendar }).primary
}

/** Recent clients shown beneath Clients in the full sidebar. */
const MAX_PINNED_CLIENTS = 6

const MORE_STORAGE_KEY = "np.nav.more"

export type NavClient = { id: string; name: string; health: ClientHealth }

/** `Clients` is the client pages only; a listing belongs to Listings. */
function isClientsActive(pathname: string | null) {
  return isActivePath(pathname, "/clients")
}

function isMoreActive(pathname: string | null) {
  return DESTINATIONS.some(
    (destination) =>
      destination.group === "more" && isActivePath(pathname, destination.href)
  )
}

/**
 * The persistent column's row, drawn by one markup at two widths:
 *
 * - from 1180px (`wide`), a 240px sidebar row: icon, label and count in a
 *   line, 34px where a cursor drives it, 44px on touch;
 * - from 768 to 1180, a rail tile: the icon above a visible label (an
 *   iPad cannot hover, so a tooltip was no label at all), at least 56px
 *   tall.
 *
 * An accent tint and a 3px accent bar mark the current page, so it reads
 * in greyscale and forced colours too.
 */
const ROW_CLASS = cn(
  "relative flex min-h-[34px] w-full items-center gap-2.5 rounded-md px-2.5 text-left text-ui font-medium text-ink",
  "transition-colors duration-(--np-duration-fast) ease-out-strong hover:bg-fill",
  "focus-halo focus-visible:outline-none pointer-coarse:min-h-11",
  "aria-[current=page]:bg-accent-tint aria-[current=page]:font-semibold aria-[current=page]:text-accent-ink",
  "aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-[7px] aria-[current=page]:before:left-0 aria-[current=page]:before:w-[3px] aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-primary aria-[current=page]:before:content-['']",
  "md:max-wide:min-h-14 md:max-wide:flex-col md:max-wide:justify-center md:max-wide:gap-1 md:max-wide:px-0.5 md:max-wide:py-1.5 md:max-wide:text-center md:max-wide:text-caption md:max-wide:aria-[current=page]:before:-left-1"
)

const LABEL_CLASS = "min-w-0 truncate md:max-wide:w-full"

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

function NavRow({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
  count,
  countLabel,
}: {
  href: string
  label: string
  icon: Destination["icon"]
  active: boolean
  onNavigate?: () => void
  count?: number
  countLabel?: string
}) {
  const countId = React.useId()
  const showCount = typeof count === "number" && count > 0
  return (
    <>
      <ShellLink
        href={href}
        intentPrefetch
        aria-current={active ? "page" : undefined}
        // The count describes the row rather than naming it, so "Inbox"
        // stays the link's name for every locator and screen-reader list.
        // The description lives outside the link for the same reason.
        aria-describedby={showCount ? countId : undefined}
        onClick={onNavigate}
        className={ROW_CLASS}
      >
        <span className="relative flex shrink-0">
          <Icon
            className={cn(
              "size-4 shrink-0 md:max-wide:size-5",
              active ? "text-accent-ink" : "text-ink-muted"
            )}
            strokeWidth={1.75}
            aria-hidden
          />
          {showCount ? (
            // The rail has no count column, so the number rides on the
            // icon as a badge there instead of disappearing.
            <CountBadge
              count={count}
              slot="rail-count"
              className="absolute -top-2 left-3 hidden md:max-wide:inline-flex"
            />
          ) : null}
        </span>
        <span className={LABEL_CLASS}>{label}</span>
        {showCount ? (
          <span
            aria-hidden
            className={cn(
              "ml-auto font-mono text-[0.71875rem] tabular-nums md:max-wide:hidden",
              active ? "text-accent-ink" : "text-ink-muted"
            )}
          >
            {count}
          </span>
        ) : null}
      </ShellLink>
      {showCount ? (
        <span id={countId} hidden>
          {countLabel ?? `${count}`}
        </span>
      ) : null}
    </>
  )
}

/**
 * The persistent navigation column: the tablet rail (768-1180) and the desk
 * sidebar (from 1180). Phones use the bottom tab bar and the More sheet
 * instead (tab-bar.tsx, more-sheet.tsx); all of them read one registry.
 *
 * In the rail every destination shows as a labelled tile; in the sidebar
 * Team and Settings sit behind the More disclosure, so the daily list stays
 * short and the disclosure opens itself on one of their pages.
 */
function Nav({
  onNavigate,
  clients = [],
  needsReply,
  role,
  scopeClientId = null,
  mode = "agency",
  hideCalendar = false,
}: {
  onNavigate?: () => void
  clients?: NavClient[]
  /**
   * The client the switcher has in scope. Inbox, Listings and Reports link
   * to it (`?clientId=`), so moving between them keeps the scope; null
   * links to every client.
   */
  scopeClientId?: string | null
  /** The Inbox's needs-reply count, when the app has it. */
  needsReply?: number
  /**
   * The session's role. Team is for owners and admins (the page answers
   * everyone else with Access denied), so it is left out for the rest, and
   * while the role is unknown.
   */
  role?: string | null
  /** `business` leaves out Clients, the pinned clients and `?clientId=`. */
  mode?: WorkspaceMode
  /**
   * The organisation's `post_scheduling` feature is off, so Calendar (the
   * scheduled publications) has nothing to show and is left out (P08-R5).
   */
  hideCalendar?: boolean
}) {
  const pathname = usePathname()
  const business = mode === "business"
  const pinned = business ? [] : clients.slice(0, MAX_PINNED_CLIENTS)
  const more = useMoreOpen(pathname)
  const moreListId = React.useId()
  const moreCurrentId = React.useId()
  const groups = sidebarDestinations({
    role: role ?? null,
    mode,
    hideCalendar,
  })
  const MoreIcon = more.open ? ChevronDown : ChevronRight

  return (
    <nav aria-label="Primary" className="flex flex-col">
      <ul className="flex flex-col gap-0.5">
        {groups.primary.map((item) => {
          const active =
            item.id === "clients"
              ? isClientsActive(pathname)
              : isActivePath(pathname, item.href)
          return (
            <React.Fragment key={item.href}>
              <li>
                <NavRow
                  href={destinationHref(item, mode, scopeClientId)}
                  label={item.label}
                  icon={item.icon}
                  active={active}
                  onNavigate={onNavigate}
                  count={item.id === "inbox" ? needsReply : undefined}
                  countLabel={
                    item.id === "inbox" && needsReply
                      ? `${needsReply} ${needsReply === 1 ? "review needs" : "reviews need"} a reply`
                      : undefined
                  }
                />
              </li>
              {item.id === "clients" && pinned.length > 0
                ? pinned.map((client) => {
                    const href = `/clients/${client.id}`
                    const clientActive = pathname === href
                    return (
                      // Recent clients need the sidebar's width; the rail
                      // keeps to the destinations.
                      <li key={client.id} className="max-wide:hidden">
                        <ShellLink
                          href={href}
                          aria-current={clientActive ? "page" : undefined}
                          onClick={onNavigate}
                          className={cn(
                            ROW_CLASS,
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
                        </ShellLink>
                      </li>
                    )
                  })
                : null}
            </React.Fragment>
          )
        })}

        {groups.more.length > 0 ? (
          <li className="flex flex-col">
            {/* The disclosure is a sidebar affordance; the rail lists its
                items as tiles, so it hides there and its list always shows. */}
            <button
              type="button"
              aria-expanded={more.open}
              aria-controls={moreListId}
              aria-describedby={more.currentInside ? moreCurrentId : undefined}
              onClick={more.toggle}
              className={cn(
                ROW_CLASS,
                "max-wide:hidden",
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
              <span className={LABEL_CLASS}>More</span>
            </button>
            {more.currentInside ? (
              <span id={moreCurrentId} hidden>
                Contains the current page
              </span>
            ) : null}
            <ul
              id={moreListId}
              className={cn(
                "mt-0.5 flex flex-col gap-0.5",
                !more.open && "wide:hidden"
              )}
            >
              {groups.more.map((item) => (
                <li key={item.href}>
                  <NavRow
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    active={isActivePath(pathname, item.href)}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
    </nav>
  )
}

export { Nav, MAX_PINNED_CLIENTS, isClientsActive, isMoreActive }
