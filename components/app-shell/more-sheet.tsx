"use client"

import { Building2, ChevronRight, Search } from "lucide-react"
import { usePathname } from "next/navigation"
import * as React from "react"

import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  isActivePath,
  moreDestinations,
  type Destination,
  type NavigationContext,
} from "@/lib/navigation/destinations"
import { TONE_CLASSES } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

import { AccountPanel } from "./account-menu"
import type { ShellSession } from "./app-shell"
import { useClientScopeLabel } from "./client-switcher"
import { useContextHealth } from "./context-health-chip"
import {
  notificationsName,
  useUnreadNotificationCount,
} from "./notifications-link"
import { ShellLink } from "./shell-link"

/**
 * A drawer row, after Notion Mail's "Navigate to" list: 48px or more, a
 * 20px outline icon, the label, and any count as plain right-aligned text.
 * No dividers between rows; the one green accent marks the current page
 * (tint, weight and accent ink, so it reads in greyscale too).
 */
const ROW_CLASS = cn(
  "flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-body text-ink",
  "transition-colors duration-(--np-duration-fast) hover:bg-fill",
  "focus-halo focus-visible:outline-none",
  "aria-[current=page]:bg-accent-tint aria-[current=page]:font-semibold aria-[current=page]:text-accent-ink"
)

/** A group's label: sentence case, quiet, above its rows (D8). */
const GROUP_LABEL_CLASS = "px-3 pb-1 text-caption font-medium text-ink-muted"

const ICON_CLASS = "size-5 shrink-0 text-ink-muted"

/**
 * What the phone's tab bar has no room for, in one bottom sheet: the
 * palette, the client being worked (agency), connection health in words,
 * the remaining destinations (Calendar for an agency, Notifications, Team
 * for owners and admins, Settings) and the account block (name, email,
 * theme, organisation switch, sign out).
 *
 * Every row is a link or a button a thumb can hit; destinations come from
 * the registry the tab bar uses, so the two together always cover every
 * destination exactly once.
 */
function MoreSheet({
  open,
  onOpenChange,
  context,
  session,
  onOpenPalette,
  onOpenClientScope,
  finalFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: NavigationContext
  session: ShellSession | null
  onOpenPalette: () => void
  onOpenClientScope: () => void
  /** Where focus goes when the sheet closes (the shell decides). */
  finalFocus?: React.ComponentProps<typeof SheetContent>["finalFocus"]
}) {
  const destinations = moreDestinations(context)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-slot="more-sheet"
        finalFocus={finalFocus}
        className="max-h-[calc(100dvh-var(--np-safe-top)-1.5rem)]"
      >
        <SheetHeader className="pb-1">
          <SheetTitle className="text-title">More</SheetTitle>
          {/* A business has no clients in its words (business-mode spec:
              never "client" or "agency"). */}
          <SheetDescription className="sr-only">
            {context.mode === "business"
              ? "Search, the rest of NabaPresence and your account."
              : "Search, the client you are working on, the rest of NabaPresence and your account."}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="gap-6 pb-[calc(--spacing(5)+var(--np-safe-bottom))]">
          {/* Only rendered while open, so the reads below cost nothing on
              pages where the sheet is never opened. */}
          {open ? (
            <React.Suspense fallback={null}>
              <MoreSheetContent
                destinations={destinations}
                context={context}
                session={session}
                onClose={() => onOpenChange(false)}
                onOpenPalette={onOpenPalette}
                onOpenClientScope={onOpenClientScope}
              />
            </React.Suspense>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function MoreSheetContent({
  destinations,
  context,
  session,
  onClose,
  onOpenPalette,
  onOpenClientScope,
}: {
  destinations: Destination[]
  context: NavigationContext
  session: ShellSession | null
  onClose: () => void
  onOpenPalette: () => void
  onOpenClientScope: () => void
}) {
  const pathname = usePathname()
  const unread = useUnreadNotificationCount()
  const health = useContextHealth()
  const scope = useClientScopeLabel()
  const agency = context.mode === "agency"
  const healthDetailId = React.useId()

  const goToLabelId = React.useId()

  return (
    <>
      {/* Groups are separated by space, not rules (Notion Mail's drawer). */}
      <div className="flex flex-col">
        <button type="button" onClick={onOpenPalette} className={ROW_CLASS}>
          <Search className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {agency
              ? "Search clients, listings and pages"
              : "Search listings and pages"}
          </span>
        </button>

        <ul className="flex flex-col">
          {agency && scope.visible ? (
            <li>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={onOpenClientScope}
                className={ROW_CLASS}
              >
                <Building2
                  className={ICON_CLASS}
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-caption text-ink-muted">
                    Working on
                  </span>
                  <span className="truncate font-medium">{scope.label}</span>
                  {scope.healthWords ? (
                    <span className="truncate text-caption text-ink-muted">
                      {scope.healthWords}
                    </span>
                  ) : null}
                </span>
                <span className="text-ui text-accent-ink">Change</span>
              </button>
            </li>
          ) : null}
          {health.isPending ? null : (
            <li>
              {/* Health in words, never a dot alone: the dot repeats the tone
                for a glance, the label says what it means. */}
              <ShellLink
                href={health.href}
                onClick={onClose}
                data-slot="health-row"
                data-tone={health.tone}
                aria-describedby={healthDetailId}
                className={ROW_CLASS}
              >
                <span
                  aria-hidden
                  className="grid size-5 shrink-0 place-items-center"
                >
                  <span
                    className={cn(
                      "size-2.5 rounded-full",
                      TONE_CLASSES[health.tone].dot
                    )}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-caption text-ink-muted">
                    Connections
                  </span>
                  <span className="truncate font-medium">{health.label}</span>
                </span>
                <ChevronRight
                  className={ICON_CLASS}
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span id={healthDetailId} hidden>
                  {health.scopedName
                    ? `Connection status for ${health.scopedName}`
                    : "Connection status"}
                </span>
              </ShellLink>
            </li>
          )}
        </ul>
      </div>

      {/* The landmark keeps its name, "More"; the visible label groups it. */}
      <nav aria-label="More" className="flex flex-col">
        <h3 id={goToLabelId} className={GROUP_LABEL_CLASS}>
          Go to
        </h3>
        <ul aria-labelledby={goToLabelId} className="flex flex-col">
          {destinations.map((destination) => {
            const Icon = destination.icon
            const count = destination.id === "notifications" ? unread : 0
            const current = isActivePath(pathname, destination.href)
            return (
              <li key={destination.id}>
                <ShellLink
                  href={destination.href}
                  onClick={onClose}
                  aria-current={current ? "page" : undefined}
                  aria-label={
                    destination.id === "notifications"
                      ? notificationsName(unread)
                      : undefined
                  }
                  className={ROW_CLASS}
                >
                  <Icon
                    className={cn(ICON_CLASS, current && "text-accent-ink")}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {destination.label}
                  </span>
                  {count > 0 ? (
                    // Plain figures, not a pill: the count is in the name.
                    <span
                      aria-hidden
                      className={cn(
                        "shrink-0 text-count font-normal tabular-nums",
                        current ? "text-accent-ink" : "text-ink-muted"
                      )}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  ) : null}
                </ShellLink>
              </li>
            )
          })}
        </ul>
      </nav>

      <AccountPanel session={session} />
    </>
  )
}

export { MoreSheet }
