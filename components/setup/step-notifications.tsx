"use client"

import { BellIcon } from "lucide-react"

import { NotificationsCard } from "@/components/settings/notifications-card"

/**
 * Real-time review notifications.
 *
 * Optional, and honest about it: without this reviews still arrive on the
 * scheduled sync, just later. Presenting it as required would make an operator
 * think setup had failed when Google's Pub/Sub is unavailable.
 *
 * Laid out as Notion Mail's "turn on notifications" step (a neutral tile and
 * plain words over the one control), but saying what these are: Google
 * telling NabaPresence about new reviews, not a push to this phone, so no
 * device permission is asked for.
 */
function StepNotifications() {
  return (
    <>
      <div className="flex max-w-(--np-measure-reading) items-start gap-3">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-lg bg-fill text-ink [&_svg]:size-5"
        >
          <BellIcon strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-body text-pretty text-ink">
            These are updates Google sends to NabaPresence when a review
            arrives. They aren’t phone notifications, so your device won’t ask
            for permission.
          </p>
          <p className="text-body text-pretty text-ink-muted">
            Optional. Without this, reviews still arrive on the next scheduled
            check, just later.
          </p>
        </div>
      </div>
      <NotificationsCard />
    </>
  )
}

export { StepNotifications }
