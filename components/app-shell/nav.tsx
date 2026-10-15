"use client"

import { usePathname } from "next/navigation"
import * as React from "react"

import { healthLabel, healthTone } from "@/lib/clients/health"
import type { ClientHealth } from "@/lib/clients/health"
import { useBreakpoint } from "@/lib/hooks/use-media-query"
import {
  currentHref,
  destinationHref,
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

export type NavClient = { id: string; name: string; health: ClientHealth }

/**
 * The persistent column's row, drawn by one markup at two widths:
 *
 * - from 1180px (`wide`), a 240px sidebar row: icon, label and the count
 *   as plain right-aligned figures (Notion Mail's drawer, no pill) in a
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

function NavRow({
  href,
  label,
  icon: Icon,
  active,
  containsCurrent = false,
  onNavigate,
  count,
  countLabel,
}: {
  href: string
  label: string
  icon: Destination["icon"]
  active: boolean
  /**
   * A row nested under this one is the current page: the parent takes the
   * accent text but no tint, bar or `aria-current`, so one row only is "the"
   * current page.
   */
  containsCurrent?: boolean
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
        className={cn(ROW_CLASS, containsCurrent && "text-accent-ink")}
      >
        <span className="relative flex shrink-0">
          <Icon
            className={cn(
              "size-4 shrink-0 md:max-wide:size-5",
              active || containsCurrent ? "text-accent-ink" : "text-ink-muted"
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
              "ml-auto text-count font-normal tabular-nums md:max-wide:hidden",
              active || containsCurrent ? "text-accent-ink" : "text-ink-muted"
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
 * Team and Settings sit in their own "Workspace" group beneath the daily
 * list, always visible (the sidebar has the height; a disclosure only added
 * a click).
 *
 * Exactly one row is marked as the current page: the longest href that
 * matches the path, so a pinned client wins over Clients and a nested route
 * never lights two rows.
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
  const workspaceLabelId = React.useId()
  const groups = sidebarDestinations({
    role: role ?? null,
    mode,
    hideCalendar,
  })
  // The rail draws no pinned clients, so below `wide` their rows are not in
  // the page and Clients is the current row for a client page. Which row
  // carries the mark is behaviour, so it reads the viewport; where the rows
  // go is still CSS.
  const wide = useBreakpoint("wide")
  const current = currentHref(pathname, [
    ...groups.primary.map((item) => item.href),
    ...(wide ? pinned : []).map((client) => `/clients/${client.id}`),
    ...groups.more.map((item) => item.href),
  ])

  return (
    <nav aria-label="Primary" className="flex flex-col">
      <ul className="flex flex-col gap-0.5">
        {groups.primary.map((item) => {
          const active = current === item.href
          const containsCurrent =
            item.id === "clients" &&
            !active &&
            pinned.some((client) => current === `/clients/${client.id}`)
          return (
            <React.Fragment key={item.href}>
              <li>
                <NavRow
                  href={destinationHref(item, mode, scopeClientId)}
                  label={item.label}
                  icon={item.icon}
                  active={active}
                  containsCurrent={containsCurrent}
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
                    const clientActive = current === href
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
            {/* The group's label, quiet like Notion Mail's drawer headings.
                It is a sidebar affordance: the rail lists these rows as
                tiles with no label, so it hides there. Not a heading: the
                axe suite pins `heading-order`. */}
            <span
              id={workspaceLabelId}
              // The list is named from this text, so it is hidden from
              // browse mode rather than read a second time.
              aria-hidden
              className="px-2.5 pt-4 pb-1 text-caption font-medium text-ink-muted max-wide:hidden"
            >
              Workspace
            </span>
            <ul
              aria-labelledby={workspaceLabelId}
              className="flex flex-col gap-0.5"
            >
              {groups.more.map((item) => (
                <li key={item.href}>
                  <NavRow
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    active={current === item.href}
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

export { Nav, MAX_PINNED_CLIENTS }
