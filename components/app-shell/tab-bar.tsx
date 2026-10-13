"use client"

import { MoreHorizontal } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

import {
  destinationHref,
  isActivePath,
  moreDestinations,
  tabDestinations,
  type Destination,
  type NavigationContext,
} from "@/lib/navigation/destinations"
import { cn } from "@/lib/utils"

import {
  notificationsName,
  useUnreadNotificationCount,
} from "./notifications-link"
import { inboxName, useNeedsReplyCount } from "./use-needs-reply-count"

/**
 * A tab: the icon above a visible label, the whole 56px cell the target.
 * The current tab takes the accent and a heavier label, so it reads in
 * greyscale too; forced-colours mode keeps the label weight.
 */
const TAB_CLASS = cn(
  "relative flex h-full min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-md px-0.5 text-caption font-medium text-ink-muted",
  "transition-colors duration-(--np-duration-fast) hover:text-ink",
  "focus-halo focus-visible:outline-none focus-visible:ring-inset",
  "aria-[current=page]:font-semibold aria-[current=page]:text-accent-ink",
  "data-[current=true]:font-semibold data-[current=true]:text-accent-ink"
)

/**
 * The count on a tab's icon. It is set in the caption role, the smallest
 * size the type scale allows on touch (13px), so the pill is 20px tall to
 * hold it; it starts 4px right of the 24px icon's centre (`left-4`).
 */
function CountBadge({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      data-slot="tab-count"
      className="absolute -top-1.5 left-4 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 font-mono text-caption leading-none font-semibold text-primary-foreground tabular-nums"
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

/**
 * The phone's primary navigation: a bottom tab bar, below 768px only.
 *
 * Four destinations from the registry (lib/navigation/destinations.ts
 * `tabDestinations`: agency Inbox, Listings, Clients, Reports; business
 * Inbox, Listings, Calendar, Reports) and More, which opens the More sheet
 * holding the rest and the account. Settings and Team are two taps away.
 *
 * Fixed to the bottom edge, padded for the home indicator. It renders
 * `data-slot="tab-bar"`, the chrome contract globals.css keys on: while a
 * task's ActionBar is docked to the bottom (`data-docked="bottom"`), or the
 * on-screen keyboard is up, CSS hides this bar so one bar owns the edge.
 *
 * Counts are part of a tab's accessible name ("Inbox, 2 need a reply"), so
 * the visible label always starts the name (WCAG 2.5.3) and the number is
 * heard where it is seen.
 */
function TabBar({
  context,
  scopeClientId,
  moreOpen,
  onOpenMore,
  moreTriggerRef,
  sessionReady = true,
}: {
  context: NavigationContext
  /** Counts wait for the session bootstrap (AppShell's useSessionReady). */
  sessionReady?: boolean
  scopeClientId: string | null
  moreOpen: boolean
  onOpenMore: () => void
  moreTriggerRef?: React.Ref<HTMLButtonElement>
}) {
  const pathname = usePathname()
  const needsReply = useNeedsReplyCount(sessionReady)
  const unread = useUnreadNotificationCount(sessionReady)
  const tabs = tabDestinations(context)
  const moreCurrentId = React.useId()
  // More is current while the page is one of the destinations it holds.
  const moreCurrent = moreDestinations(context).some((destination) =>
    isActivePath(pathname, destination.href)
  )

  const countFor = (destination: Destination) =>
    destination.id === "inbox"
      ? (needsReply ?? 0)
      : destination.id === "notifications"
        ? unread
        : 0
  const nameFor = (destination: Destination) =>
    destination.id === "inbox"
      ? inboxName(needsReply)
      : destination.id === "notifications"
        ? notificationsName(unread)
        : undefined

  return (
    <nav
      aria-label="Primary"
      data-slot="tab-bar"
      className="fixed inset-x-0 bottom-0 z-chrome bg-canvas px-safe pb-safe shadow-np-edge-top md:hidden print:hidden"
    >
      <ul className="grid h-(--np-tabbar-h) grid-cols-5 items-stretch px-1">
        {tabs.map((destination) => {
          const Icon = destination.icon
          const active = isActivePath(pathname, destination.href)
          const count = countFor(destination)
          return (
            <li key={destination.id} className="flex min-w-0">
              <Link
                href={destinationHref(destination, context.mode, scopeClientId)}
                aria-current={active ? "page" : undefined}
                aria-label={nameFor(destination)}
                className={TAB_CLASS}
              >
                <span className="relative flex">
                  <Icon className="size-6" strokeWidth={1.75} aria-hidden />
                  {count > 0 ? <CountBadge count={count} /> : null}
                </span>
                <span className="max-w-full truncate">{destination.label}</span>
              </Link>
            </li>
          )
        })}
        <li className="flex min-w-0">
          <button
            ref={moreTriggerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-describedby={moreCurrent ? moreCurrentId : undefined}
            data-current={moreCurrent ? "true" : undefined}
            onClick={onOpenMore}
            className={TAB_CLASS}
          >
            <MoreHorizontal className="size-6" strokeWidth={1.75} aria-hidden />
            <span>More</span>
          </button>
          {moreCurrent ? (
            <span id={moreCurrentId} hidden>
              Contains the current page
            </span>
          ) : null}
        </li>
      </ul>
    </nav>
  )
}

export { TabBar }
