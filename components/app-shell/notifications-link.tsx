"use client"

import { useQuery } from "@tanstack/react-query"
import { Bell } from "lucide-react"
import Link from "next/link"

import { fetchNotifications } from "@/lib/api/operational-notifications"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"

/** The toolbar's way to /notifications, with this person's open-and-unread count. */
export function NotificationsLink() {
  const query = useQuery({
    queryKey: queryKeys.notifications("badge"),
    queryFn: (context) => fetchNotifications("unread", undefined, { ...requestOptions(context), background: true }),
    refetchInterval: 60_000,
  })
  const count = query.data?.unreadCount ?? 0
  return (
    <Link
      href="/notifications"
      aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
      className="relative grid size-11 shrink-0 place-items-center rounded-md text-ink focus-halo transition-colors duration-(--np-duration-fast) hover:bg-fill focus-visible:outline-none md:size-9"
    >
      <Bell className="size-5 md:size-4" strokeWidth={1.75} aria-hidden />
      {count ? (
        <span aria-hidden className="absolute top-1 right-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  )
}
