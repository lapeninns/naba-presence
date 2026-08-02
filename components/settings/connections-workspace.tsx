"use client"

import { ConnectionCard } from "@/components/settings/connection-card"
import { OAuthReturn } from "@/components/settings/oauth-return"
import { ReconnectAlert } from "@/components/settings/reconnect-alert"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"

export function ConnectionsWorkspace() {
  const { query } = useConnectionWorkspace()
  const hasConnection = (query.data?.connections.length ?? 0) > 0

  return (
    <div className="flex flex-col gap-8">
      <OAuthReturn />
      <ReconnectAlert />
      <ConnectionCard />
      {/* CONNECTION-CARDS: Task 8 (AccountPickerCard) / Task 9 (ImportCard) / Task 10 (BackfillCard, NotificationsCard) render below when hasConnection. */}
      {hasConnection ? null : null}
    </div>
  )
}
