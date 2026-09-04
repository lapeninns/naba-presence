"use client"

import { NotificationsCard } from "@/components/settings/notifications-card"

/**
 * Real-time review notifications.
 *
 * Optional, and honest about it: without this reviews still arrive on the
 * scheduled sync, just later. Presenting it as required would make an operator
 * think setup had failed when Google's Pub/Sub is unavailable.
 */
function StepNotifications() {
  return <NotificationsCard />
}

export { StepNotifications }
