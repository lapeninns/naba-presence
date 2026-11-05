"use client"

import { Building2, ChevronRight, Search, TriangleAlert } from "lucide-react"
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
  hasOutbox,
  isActivePath,
  moreDestinations,
  navigationPath,
  type Destination,
  type NavigationContext,
} from "@/lib/navigation/destinations"
import { TONE_CLASSES } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

import { AccountPanel } from "./account-menu"
import type { ShellSession } from "./app-shell"
import { useContextHealth } from "./context-health-chip"
import {
  notificationsName,
  useUnreadNotificationCount,
} from "./notifications-link"
import { useScopeControl } from "./scope-sheet-model"
import { ShellLink } from "./shell-link"
import { outboxFailuresPhrase, useOutboxFailures } from "./use-outbox-failures"

/**
 * A drawer row, after Notion Mail's "Navigate to" list: 48px or more, a
 * 20px outline icon, the label, and any count as plain right-aligned text.
 * No dividers between rows. The current page uses the shell's one neutral
 * current-place grammar (DIRECTION D4): fill, ink, semibold and a heavier
 * icon stroke, so it reads in greyscale too and the accent stays for sends.
 */
const ROW_CLASS = cn(
  "flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-body text-ink",
  "transition-colors duration-(--np-duration-fast) active:bg-fill hover-fine:hover:bg-fill",
  "focus-halo focus-visible:outline-none",
  "aria-[current=page]:bg-fill aria-[current=page]:font-semibold aria-[current=page]:text-ink"
)

/** The search row, drawn as a field (it opens the palette). */
const SEARCH_ROW_CLASS = cn(
  "flex min-h-11 w-full items-center gap-3 rounded-(--np-radius-control) bg-fill px-3 text-left text-body text-ink-muted",
  "transition-colors duration-(--np-duration-fast) hover-fine:hover:text-ink",
  "focus-halo focus-visible:outline-none"
)

/** A group's label: sentence case, quiet, above its rows (D8). */
const GROUP_LABEL_CLASS = "px-3 pb-1 text-caption font-medium text-ink-muted"

const ICON_CLASS = "size-5 shrink-0 text-ink-muted"

/**
 * What the phone's tab bar has no room for, in one bottom sheet (DIRECTION
 * §7.2): the palette, the scope being worked with its health in words (so
 * it is one tap away on a deep page too, where the app bar shows the way
 * up instead of the scope chip), the remaining destinations (Outbox for
 * people who can send, Calendar for an agency, Notifications, Team for
 * owners and admins, Settings) and the account block (name, email, theme,
 * organisation switch, sign out).
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
  organisationName = null,
  onOpenPalette,
  onOpenClientScope,
  finalFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: NavigationContext
  session: ShellSession | null
  /**
   * The organisation's live name (the shell reads the session query, so a
   * rename shows at once), which a business's scope row reads.
   */
  organisationName?: string | null
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
              ? "Search, the location you are working on, the rest of NabaPresence and your account."
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
                organisationName={organisationName}
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
  organisationName,
  onClose,
  onOpenPalette,
  onOpenClientScope,
}: {
  destinations: Destination[]
  context: NavigationContext
  session: ShellSession | null
  organisationName: string | null
  onClose: () => void
  onOpenPalette: () => void
  onOpenClientScope: () => void
}) {
  const pathname = navigationPath(usePathname(), context.mode)
  const unread = useUnreadNotificationCount()
  const failures = useOutboxFailures(hasOutbox(context)) ?? 0
  const health = useContextHealth()
  const scope = useScopeControl(context.mode, organisationName)
  const agency = context.mode === "agency"
  const healthDetailId = React.useId()

  const goToLabelId = React.useId()

  return (
    <>
      {/* Groups are separated by space, not rules (Notion Mail's drawer). */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onOpenPalette}
          data-slot="more-search"
          className={SEARCH_ROW_CLASS}
        >
          <Search className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
          <span
            className="min-w-0 flex-1 truncate"
            title={
              agency
                ? "Search clients, listings and pages"
                : "Search listings and pages"
            }
          >
            {agency
              ? "Search clients, listings and pages"
              : "Search listings and pages"}
          </span>
        </button>

        <ul className="flex flex-col">
          {scope.ready && scope.switchable ? (
            <li>
              {/* The scope with its health in words: the retired health
                  chip's words live here (DIRECTION D8). */}
              <button
                type="button"
                aria-haspopup="dialog"
                // The visible action word stays in the name (WCAG 2.5.3).
                aria-label={`${scope.name}, Change`}
                onClick={onOpenClientScope}
                data-slot="more-scope"
                data-tone={scope.tone}
                className={ROW_CLASS}
              >
                <Building2
                  className={ICON_CLASS}
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span aria-hidden className="flex min-w-0 flex-1 flex-col">
                  <span className="text-caption text-ink-muted">
                    Working on
                  </span>
                  <span className="truncate font-medium" title={scope.title}>
                    {scope.title}
                  </span>
                  {scope.detail ? (
                    <span className="flex min-w-0 items-center gap-1.5 text-caption text-ink-muted">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          TONE_CLASSES[scope.tone].dot
                        )}
                      />
                      <span className="truncate" title={scope.detail}>
                        {scope.detail}
                      </span>
                    </span>
                  ) : null}
                </span>
                <span aria-hidden className="text-ui font-medium text-ink">
                  Change
                </span>
              </button>
            </li>
          ) : health.isPending ? null : (
            <li>
              {/* Nothing to switch: health in words still has a place,
                  never a dot alone. */}
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
                  <span className="truncate font-medium" title={health.label}>
                    {health.label}
                  </span>
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
            const count =
              destination.id === "notifications"
                ? unread
                : destination.id === "outbox"
                  ? failures
                  : 0
            const alert = destination.id === "outbox"
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
                      : alert && count > 0
                        ? `${destination.label}, ${outboxFailuresPhrase(count)}`
                        : undefined
                  }
                  className={ROW_CLASS}
                >
                  <Icon
                    className={cn(ICON_CLASS, current && "text-ink")}
                    strokeWidth={current ? 2 : 1.75}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {destination.label}
                  </span>
                  {count > 0 ? (
                    // Plain figures, not a pill: the count is in the name.
                    <span
                      aria-hidden
                      data-slot={alert ? "more-alert" : undefined}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 text-count font-normal tabular-nums",
                        alert
                          ? "font-medium text-danger-ink"
                          : current
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
