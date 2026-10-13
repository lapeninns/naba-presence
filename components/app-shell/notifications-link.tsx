"use client"

import { useQuery } from "@tanstack/react-query"
import { Bell } from "lucide-react"
import Link from "next/link"

import { fetchNotifications } from "@/lib/api/operational-notifications"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { cn } from "@/lib/utils"

/**
 * This person's open-and-unread notification count. One query key, so the
 * app bar's bell, the desk toolbar's bell and the More sheet's row share a
 * single 60s poll however many of them are mounted.
 */
export function useUnreadNotificationCount(enabled = true): number {
  const query = useQuery({
    enabled,
    queryKey: queryKeys.notifications("badge"),
    queryFn: (context) =>
      fetchNotifications("unread", undefined, {
        ...requestOptions(context),
        background: true,
      }),
    refetchInterval: 60_000,
  })
  return query.data?.unreadCount ?? 0
}

/** "Notifications, 3 unread": the count is part of the name. */
export function notificationsName(count: number) {
  return count ? `Notifications, ${count} unread` : "Notifications"
}

/** The bar's way to /notifications, with this person's open-and-unread count. */
export function NotificationsLink({ className }: { className?: string }) {
  const count = useUnreadNotificationCount()
  return (
    <Link
      href="/notifications"
      aria-label={notificationsName(count)}
      className={cn(
        "relative grid size-11 shrink-0 place-items-center rounded-md text-ink focus-halo transition-colors duration-(--np-duration-fast) hover:bg-fill focus-visible:outline-none desk:size-9",
        className
      )}
    >
      <Bell className="size-5 desk:size-4" strokeWidth={1.75} aria-hidden />
      {count ? (
        <span
          aria-hidden
          className="absolute top-1 right-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  )
}
