"use client"

import { useQuery } from "@tanstack/react-query"
import { Bell } from "lucide-react"

import { fetchNotifications } from "@/lib/api/operational-notifications"
import { usePendingUnreadDelta } from "@/lib/notifications/pending-changes"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { SEEDED_BY_SHELL } from "@/lib/queries/use-shell-status"
import { cn } from "@/lib/utils"

import { CountBadge } from "./count-badge"
import { ShellLink } from "./shell-link"

/**
 * This person's open-and-unread notification count. One query key, so the
 * app bar's bell, the desk toolbar's bell and the More sheet's row share it
 * however many of them are mounted; the shell's one poll refreshes it
 * (useShellStatus). A read or resolve still on its way to the server is
 * added to it (the notifications page adds the same one to its own count), so
 * the bell and the page agree and a refused change takes both back.
 */
export function useUnreadNotificationCount(enabled = true): number {
  const pending = usePendingUnreadDelta(queryKeys.notifications("badge"))
  const query = useQuery({
    enabled,
    queryKey: queryKeys.notifications("badge"),
    queryFn: (context) =>
      fetchNotifications("unread", undefined, {
        ...requestOptions(context),
        background: true,
      }),
    ...SEEDED_BY_SHELL,
  })
  return query.data ? Math.max(0, query.data.unreadCount + pending) : 0
}

/** "Notifications, 3 unread": the count is part of the name. */
export function notificationsName(count: number) {
  return count ? `Notifications, ${count} unread` : "Notifications"
}

/** The bar's way to /notifications, with this person's open-and-unread count. */
export function NotificationsLink({ className }: { className?: string }) {
  const count = useUnreadNotificationCount()
  return (
    <ShellLink
      href="/notifications"
      aria-label={notificationsName(count)}
      className={cn(
        // An outline icon button: muted at rest, ink under the pointer or
        // focus; 44px on touch, 36px on a desk.
        "relative grid size-11 shrink-0 place-items-center rounded-md text-ink-muted focus-halo transition-colors duration-(--np-duration-fast) hover:bg-fill hover:text-ink focus-visible:text-ink focus-visible:outline-none desk:size-9",
        className
      )}
    >
      <Bell className="size-5 desk:size-4" strokeWidth={1.75} aria-hidden />
      {count ? (
        <CountBadge
          count={count}
          slot="notifications-count"
          className="absolute top-0.5 right-0.5"
        />
      ) : null}
    </ShellLink>
  )
}
