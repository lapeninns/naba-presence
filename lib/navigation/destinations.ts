import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Inbox,
  Settings,
  Store,
  Users,
} from "lucide-react"
import type * as React from "react"

import { withClientScope } from "@/lib/clients/scope"
import { settingsGatingFromRole } from "@/lib/settings/gating"
import type { WorkspaceMode } from "@/lib/workspace/terms"

/**
 * The one list of places an operator can go.
 *
 * The phone tab bar, the More sheet, the tablet rail, the desk sidebar, the
 * command palette's "Go to" group and the 404 page's "Where to go instead"
 * all read this list through `visibleDestinations`, so a destination is
 * added, renamed, re-iconed or gated in exactly one place. Five copies of it
 * had drifted apart (Calendar missing from the palette and the 404 page,
 * Notifications missing from the navigation, two different Reports icons).
 *
 * Home is gone: it was a page of numbers whose every link led to the Inbox,
 * so the Inbox is the landing page and the numbers live in its Today strip.
 * Listings is the Google Business Profiles themselves, health first; Clients
 * is who they belong to.
 */

export type DestinationId =
  | "inbox"
  | "listings"
  | "clients"
  | "calendar"
  | "reports"
  | "notifications"
  | "team"
  | "settings"

export type Destination = {
  id: DestinationId
  href: string
  label: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  /** One line for the 404 page's "Where to go instead". */
  description: { agency: string; business: string }
  /**
   * Where the desk sidebar puts it: `primary` is the daily work, `more` the
   * organisation admin behind the sidebar's More disclosure (visited to
   * change who may do what rather than to do it).
   */
  group: "primary" | "more"
  /**
   * Whether the page follows the client scope. `true`: the link carries the
   * remembered `?clientId=` (lib/clients/scope.ts CLIENT_SCOPED_PATHS), so
   * moving between Inbox, Listings and Reports keeps the client. `false`:
   * the page is organisation-wide and ignores the scope, so the phone app
   * bar shows search and the bell there instead of the scope chip. Left out,
   * the page has no scope of its own but the chip stays (Clients, Calendar).
   */
  scoped?: boolean
  /** Agency only: a business has one home client behind the scenes. */
  agencyOnly?: true
  /**
   * Owners and admins only: the page answers everyone else with Access
   * denied. While the role is unknown it stays hidden, so it never appears
   * and then vanishes.
   */
  managersOnly?: true
  /**
   * Needs the organisation's `post_scheduling` feature (P08-R5): Calendar
   * holds scheduled publications only. The dashboard layout reads the flag
   * server-side and passes `hideCalendar`.
   */
  needsPostScheduling?: true
  /**
   * The page has its own search field (the Inbox's "Search reviews"), so
   * the phone app bar leaves its palette button out there rather than show
   * two magnifiers that answer different questions. The palette stays one
   * tap away in the More sheet and on Cmd/Ctrl+K.
   */
  ownSearch?: true
}

export const DESTINATIONS: readonly Destination[] = [
  {
    id: "inbox",
    href: "/inbox",
    label: "Inbox",
    icon: Inbox,
    description: {
      agency: "Reviews that need a reply, an approval or a retry",
      business: "Reviews that need a reply, an approval or a retry",
    },
    group: "primary",
    scoped: true,
    ownSearch: true,
  },
  {
    id: "listings",
    href: "/listings",
    label: "Listings",
    icon: Store,
    description: {
      agency: "Every Google Business Profile, health first",
      business: "Every Google Business Profile, health first",
    },
    group: "primary",
    scoped: true,
  },
  {
    id: "clients",
    href: "/clients",
    label: "Clients",
    icon: Building2,
    description: {
      agency: "The businesses you look after and their Google connections",
      business: "",
    },
    group: "primary",
    agencyOnly: true,
  },
  {
    id: "calendar",
    href: "/calendar",
    label: "Calendar",
    icon: CalendarDays,
    description: {
      agency: "Scheduled posts across every listing",
      business: "Scheduled posts across every listing",
    },
    group: "primary",
    needsPostScheduling: true,
  },
  {
    id: "reports",
    href: "/reports",
    label: "Reports",
    icon: BarChart3,
    description: {
      agency: "Ratings, reply times and profile views by client",
      business: "Ratings, reply times and profile views by location",
    },
    group: "primary",
    scoped: true,
  },
  {
    id: "notifications",
    href: "/notifications",
    label: "Notifications",
    icon: Bell,
    description: {
      agency: "Connection, sync and publishing problems that need you",
      business: "Connection, sync and publishing problems that need you",
    },
    group: "more",
    scoped: false,
  },
  {
    id: "team",
    href: "/team",
    label: "Team",
    icon: Users,
    description: {
      agency: "People and what each can reach",
      business: "People and what each can reach",
    },
    group: "more",
    scoped: false,
    managersOnly: true,
  },
  {
    id: "settings",
    href: "/settings",
    label: "Settings",
    icon: Settings,
    description: {
      agency: "Reply policy, Google connections and notifications",
      business: "Reply policy, Google connections and notifications",
    },
    group: "more",
    scoped: false,
  },
]

export type NavigationContext = {
  /** The session's role; null while unknown. */
  role: string | null
  mode: WorkspaceMode
  /** The organisation's `post_scheduling` feature is off. */
  hideCalendar?: boolean
}

/** Whether this session may see a destination at all. */
export function isDestinationVisible(
  destination: Destination,
  { role, mode, hideCalendar = false }: NavigationContext
): boolean {
  if (destination.agencyOnly && mode === "business") return false
  if (destination.needsPostScheduling && hideCalendar) return false
  if (destination.managersOnly && !settingsGatingFromRole(role).canManageTeam)
    return false
  return true
}

/** The destinations this session may see, in registry order. */
export function visibleDestinations(context: NavigationContext): Destination[] {
  return DESTINATIONS.filter((destination) =>
    isDestinationVisible(destination, context)
  )
}

/**
 * The phone tab bar's candidates in priority order; the first four this
 * session may see become tabs and More is always the fifth. A business has
 * no Clients, so Calendar takes the slot; with scheduling off too,
 * Notifications fills it rather than leaving a four-tab bar.
 */
const TAB_PRIORITY: Record<WorkspaceMode, readonly DestinationId[]> = {
  agency: [
    "inbox",
    "listings",
    "clients",
    "reports",
    "calendar",
    "notifications",
  ],
  business: ["inbox", "listings", "calendar", "reports", "notifications"],
}

/** Display order for the tabs, so a filled-in slot never jumps ahead of Reports. */
const TAB_ORDER: readonly DestinationId[] = [
  "inbox",
  "listings",
  "clients",
  "calendar",
  "reports",
  "notifications",
]

export const TAB_COUNT = 4

export function tabDestinations(context: NavigationContext): Destination[] {
  const visible = new Map(
    visibleDestinations(context).map((destination) => [
      destination.id,
      destination,
    ])
  )
  const chosen = TAB_PRIORITY[context.mode]
    .filter((id) => visible.has(id))
    .slice(0, TAB_COUNT)
  return TAB_ORDER.filter((id) => chosen.includes(id)).map((id) =>
    visible.get(id)!
  )
}

/**
 * Everything the tab bar has no room for, in the order the More sheet lists
 * it: Calendar (agency), Notifications, Team (owners and admins), Settings.
 */
export function moreDestinations(context: NavigationContext): Destination[] {
  const tabs = new Set(tabDestinations(context).map((d) => d.id))
  return visibleDestinations(context).filter((d) => !tabs.has(d.id))
}

/**
 * The desk sidebar's two groups (the tablet rail shows both at once).
 * Notifications is left out: from 768px the toolbar's bell is its place,
 * with the unread count, and a second link beside it would only drift.
 */
export function sidebarDestinations(context: NavigationContext): {
  primary: Destination[]
  more: Destination[]
} {
  const visible = visibleDestinations(context).filter(
    (d) => d.id !== "notifications"
  )
  return {
    primary: visible.filter((d) => d.group === "primary"),
    more: visible.filter((d) => d.group === "more"),
  }
}

/**
 * The link a destination should carry: scoped destinations keep the client
 * in scope (agency only; a business never has `?clientId=`).
 */
export function destinationHref(
  destination: Destination,
  mode: WorkspaceMode,
  scopeClientId: string | null
): string {
  if (!destination.scoped || mode === "business") return destination.href
  return withClientScope(destination.href, scopeClientId)
}

/** True on the destination's own page and anything beneath it. */
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The destination a path belongs to, or null (Setup, a 404). A listing
 * belongs to Listings even when reached from its client.
 */
export function destinationForPath(
  pathname: string | null
): Destination | null {
  return (
    DESTINATIONS.find((destination) =>
      isActivePath(pathname, destination.href)
    ) ?? null
  )
}

/**
 * A top-level page is a destination's own page: the phone app bar shows the
 * client switcher there (search and the bell on `scoped: false` pages).
 * Anything beneath one is a deep page and shows a labelled back control
 * instead.
 */
export function isTopLevelPath(pathname: string | null): boolean {
  if (!pathname) return true
  const destination = destinationForPath(pathname)
  if (!destination) return pathname.split("/").filter(Boolean).length <= 1
  return pathname === destination.href
}

/** The longest back label the phone app bar keeps whole beside the title. */
const SHORT_BACK_LABEL_MAX = 12

const ENTITY_BACK_LABELS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /^\/listings\/[^/]+$/, label: "Listing" },
  { pattern: /^\/clients\/[^/]+$/, label: "Client" },
]

/**
 * The back control's short label, for the phone app bar once the page title
 * is echoed beside it ("‹ Listing", not "‹ Old Crown Girton Kitchen"): a
 * name is replaced by what it is, a destination keeps its own label. A
 * label that already fits, or one with nothing shorter to say, is returned
 * as it is; the caller keeps the full label in `title`.
 */
export function shortBackLabel(target: {
  href: string
  label: string
}): string {
  if (target.label.length <= SHORT_BACK_LABEL_MAX) return target.label
  const path = target.href.split(/[?#]/)[0] ?? ""
  const entity = ENTITY_BACK_LABELS.find(({ pattern }) => pattern.test(path))
  if (entity) return entity.label
  // Only a destination's own page may take the destination's name: a deeper
  // target keeps its label (the bar truncates it, with `title` in full)
  // rather than announcing a page it isn't.
  const destination = destinationForPath(path)
  return destination &&
    destination.href === path &&
    destination.label.length < target.label.length
    ? destination.label
    : target.label
}
