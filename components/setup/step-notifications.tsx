"use client"

import { BellIcon } from "lucide-react"

import { NotificationsCard } from "@/components/settings/notifications-card"

/**
 * Real-time review notifications.
 *
 * Optional, and honest about it: without this reviews still arrive on the
 * scheduled sync, just later. Presenting it as required would make an operator
 * think setup had failed when Google's Pub/Sub is unavailable. It also says
 * up front what turning it on takes (a Pub/Sub topic most operators don't
 * have), so skipping reads as the normal path rather than a failure.
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
            Optional. Turning this on needs a Google Cloud Pub/Sub topic from
            whoever runs NabaPresence. If you don’t have one, skip this step.
            Reviews still arrive on the next scheduled check, just later.
          </p>
          <p className="text-body text-pretty text-ink-muted">
            These are updates from Google to NabaPresence, not phone
            notifications, so your device won’t ask for permission.
          </p>
        </div>
      </div>
      <NotificationsCard />
    </>
  )
}

export { StepNotifications }
