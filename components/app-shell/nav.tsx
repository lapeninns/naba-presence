"use client"

import { TriangleAlert } from "lucide-react"
import { usePathname } from "next/navigation"
import * as React from "react"

import {
  currentHref,
  destinationHref,
  navigationPath,
  sidebarDestinations,
  type Destination,
} from "@/lib/navigation/destinations"
import { type InboxWaiting, waitingPhrase } from "@/lib/inbox/waiting"
import { cn } from "@/lib/utils"
import type { WorkspaceMode } from "@/lib/workspace/terms"

import { CountBadge } from "./count-badge"
import { ShellLink } from "./shell-link"
import { outboxFailuresPhrase } from "./use-outbox-failures"

/**
 * The primary destinations for a workspace mode, as the desk sidebar lists
 * them (lib/navigation/destinations.ts holds the one registry; this is its
 * sidebar view, kept under the name the shell's tests import).
 */
export function navItemsFor(
  mode: WorkspaceMode,
  hideCalendar = false,
  showOutbox = false
) {
  return sidebarDestinations({ role: "owner", mode, hideCalendar, showOutbox })
    .primary
}

/**
 * The persistent column's row, drawn by one markup at two widths:
 *
 * - from 1180px (`wide`), a 240px sidebar row: icon, label and the count
 *   as plain right-aligned figures (Notion Mail's drawer, no pill) in a
 *   line, 36px where a cursor drives it, 44px on touch;
 * - from 768 to 1180, a rail tile: the icon above a visible label (an
 *   iPad cannot hover, so a tooltip was no label at all), at least 56px
 *   tall.
 *
 * The current page uses the one neutral current-place grammar (DIRECTION
 * D4, SYSTEM §10): the fill, ink, a semibold label and a heavier icon
 * stroke. No accent and no bar, so it reads in greyscale and forced colours
 * (the weight survives both) and the accent stays for sends.
 */
const ROW_CLASS = cn(
  "relative flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-ui font-medium text-ink-secondary",
  "transition-colors duration-(--np-duration-fast) ease-out-strong hover-fine:hover:bg-fill hover-fine:hover:text-ink",
  "focus-halo focus-visible:outline-none pointer-coarse:min-h-11",
  "aria-[current=page]:bg-fill aria-[current=page]:font-semibold aria-[current=page]:text-ink",
  "md:max-wide:min-h-14 md:max-wide:flex-col md:max-wide:justify-center md:max-wide:gap-1 md:max-wide:px-0.5 md:max-wide:py-1.5 md:max-wide:text-center md:max-wide:text-caption",
  // A short window (below 640px tall) packs the rail's tiles to 48px, still
  // above the 44px touch floor, so more of them fit above the fold.
  "md:max-wide:short:min-h-12 md:max-wide:short:gap-0.5 md:max-wide:short:py-1"
)

const LABEL_CLASS = "min-w-0 truncate md:max-wide:w-full"

function NavRow({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
  count,
  countLabel,
  alert = false,
}: {
  href: string
  label: string
  icon: Destination["icon"]
  active: boolean
  onNavigate?: () => void
  count?: number
  countLabel?: string
  /**
   * The count is of failures (the Outbox): drawn in danger ink with a
   * warning glyph, never as the ink chrome badge, so it does not read as
   * one more thing waiting.
   */
  alert?: boolean
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
            data-slot="nav-icon"
            className={cn(
              "size-4 shrink-0 md:max-wide:size-5",
              active ? "text-ink" : "text-ink-muted"
            )}
            strokeWidth={active ? 2 : 1.75}
            aria-hidden
          />
          {showCount && alert ? (
            <TriangleAlert
              data-slot="rail-alert"
              aria-hidden
              strokeWidth={2}
              className="absolute -top-1.5 left-3 hidden size-3.5 rounded-full bg-canvas text-danger-ink md:max-wide:block"
            />
          ) : showCount ? (
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
            data-slot={alert ? "nav-alert" : undefined}
            className={cn(
              "ml-auto inline-flex items-center gap-1 text-count font-normal tabular-nums md:max-wide:hidden",
              alert
                ? "font-medium text-danger-ink"
                : active
                  ? "text-ink"
                  : "text-ink-muted"
            )}
          >
            {alert ? (
              <TriangleAlert
                className="size-3.5"
                strokeWidth={2}
                aria-hidden
              />
            ) : null}
            {count > 99 ? "99+" : count}
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
 * matches the path, so a nested route never lights two rows. Clients are
 * not pinned beneath Clients any more (DIRECTION D8): the sidebar's
 * "Working on" scope menu lists them with their health.
 */
function Nav({
  onNavigate,
  waiting,
  outboxFailures,
  role,
  scopeClientId = null,
  mode = "agency",
  hideCalendar = false,
  showOutbox = false,
}: {
  onNavigate?: () => void
  /**
   * The client the switcher has in scope. Inbox, Listings and Reports link
   * to it (`?clientId=`), so moving between them keeps the scope; null
   * links to every client.
   */
  scopeClientId?: string | null
  /** What the Inbox has waiting on this person (replies and approvals), when the app has it. */
  waiting?: InboxWaiting
  /** This person's failed sends, for the Outbox row's alert. */
  outboxFailures?: number
  /**
   * The session's role. Team is for owners and admins (the page answers
   * everyone else with Access denied), so it is left out for the rest, and
   * while the role is unknown; Outbox is left out for viewers.
   */
  role?: string | null
  /** `business` leaves out Clients and `?clientId=`. */
  mode?: WorkspaceMode
  /**
   * The organisation's `post_scheduling` feature is off, so Calendar (the
   * scheduled publications) has nothing to show and is left out (P08-R5).
   */
  hideCalendar?: boolean
  /** The Outbox route exists (lib/navigation/outbox.ts). */
  showOutbox?: boolean
}) {
  // Setup reads as the destination it lives under (Clients, or Listings
  // in a business), so a row is current there too.
  const pathname = navigationPath(usePathname(), mode)
  const workspaceLabelId = React.useId()
  const groups = sidebarDestinations({
    role: role ?? null,
    mode,
    hideCalendar,
    showOutbox,
  })
  const current = currentHref(pathname, [
    ...groups.primary.map((item) => item.href),
    ...groups.more.map((item) => item.href),
  ])

  return (
    <nav aria-label="Primary" className="flex flex-col">
      <ul className="flex flex-col gap-0.5">
        {groups.primary.map((item) => (
          <li key={item.href}>
            <NavRow
              href={destinationHref(item, mode, scopeClientId)}
              label={item.label}
              icon={item.icon}
              active={current === item.href}
              onNavigate={onNavigate}
              count={
                item.id === "inbox"
                  ? waiting?.total
                  : item.id === "outbox"
                    ? outboxFailures
                    : undefined
              }
              countLabel={
                item.id === "inbox" && waiting?.total
                  ? waitingPhrase(waiting, { reviews: true })
                  : item.id === "outbox" && outboxFailures
                    ? outboxFailuresPhrase(outboxFailures)
                    : undefined
              }
              alert={item.id === "outbox"}
            />
          </li>
        ))}

        {groups.more.length > 0 ? (
          <li className="flex flex-col">
            {/* The group's label, quiet like Notion Mail's drawer headings.
                It is a sidebar affordance: the rail separates these rows
                with space instead, so it hides there. Not a heading: the
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
              className="flex flex-col gap-0.5 md:max-wide:mt-3 md:max-wide:short:mt-1.5"
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

export { Nav }
