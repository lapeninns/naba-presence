"use client"

import { AccountPickerCard } from "@/components/settings/account-picker-card"
import { BackfillCard } from "@/components/settings/backfill-card"
import { ConnectionCard } from "@/components/settings/connection-card"
import { ImportCard } from "@/components/settings/import-card"
import { NotificationsCard } from "@/components/settings/notifications-card"
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
      {hasConnection ? <AccountPickerCard /> : null}
      {hasConnection ? <ImportCard /> : null}
      {hasConnection ? <BackfillCard /> : null}
      {hasConnection ? <NotificationsCard /> : null}
    </div>
  )
}
